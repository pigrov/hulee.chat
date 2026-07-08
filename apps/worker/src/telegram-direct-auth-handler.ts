import type { PlatformErrorCode } from "@hulee/contracts";
import type { TenantSecretCipher } from "@hulee/db";
import type { Logger } from "@hulee/observability";
import { toString as qrToString } from "qrcode";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import type {
  DirectAccountAuthHandler,
  DirectAccountAuthHandlerInput,
  DirectAccountAuthHandlerResult
} from "./direct-account-auth-sweeper";

const defaultTelegramAuthTimeoutMs = 7 * 60 * 1000;
const defaultTelegramPasswordTimeoutMs = 5 * 60 * 1000;
const defaultTelegramPasswordPollIntervalMs = 2_000;
const defaultTelegramConnectionRetries = 3;
const telegramQrBridgeChannelType = "telegram_qr_bridge";
const telegramQrChallengeType = "qr";
const telegramPhoneCodeChallengeType = "phone_code";
const telegramReauthChallengeType = "reauth";

export type TelegramSelfUser = {
  id?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

export type TelegramDirectSessionPayload = {
  sessionString: string;
  user?: TelegramSelfUser;
  updatedAt?: string;
};

export type TelegramAuthClient = {
  readonly session: {
    save(): string;
  };
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  signInUserWithQrCode(
    apiCredentials: { apiId: number; apiHash: string },
    authParams: {
      qrCode(qrCode: {
        token: Buffer | Uint8Array;
        expires: number;
      }): Promise<void>;
      password(hint?: string): Promise<string>;
      onError(error: Error): Promise<boolean> | boolean;
    }
  ): Promise<unknown>;
  signInUser(
    apiCredentials: { apiId: number; apiHash: string },
    authParams: {
      phoneNumber: string | (() => Promise<string>);
      phoneCode(isCodeViaApp?: boolean): Promise<string>;
      password(hint?: string): Promise<string>;
      onError(error: Error): Promise<boolean> | boolean;
    }
  ): Promise<unknown>;
};

export type CreateTelegramAuthClientInput = {
  sessionString: string;
  apiId: number;
  apiHash: string;
  connectionRetries: number;
};

export type TelegramDirectAuthHandlerOptions = {
  apiId?: number;
  apiHash?: string;
  sessionCipher?: Pick<TenantSecretCipher, "encrypt" | "decrypt">;
  authTimeoutMs?: number;
  passwordTimeoutMs?: number;
  passwordPollIntervalMs?: number;
  connectionRetries?: number;
  createTelegramClient?: (
    input: CreateTelegramAuthClientInput
  ) => TelegramAuthClient;
  createQrImageDataUrl?: (qrPayload: string) => Promise<string>;
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: Pick<Logger, "warn">;
};

export function createTelegramDirectAuthHandler(
  options: TelegramDirectAuthHandlerOptions
): DirectAccountAuthHandler {
  const authTimeoutMs = normalizeTimeoutMs(
    options.authTimeoutMs,
    defaultTelegramAuthTimeoutMs
  );
  const passwordTimeoutMs = normalizeTimeoutMs(
    options.passwordTimeoutMs,
    defaultTelegramPasswordTimeoutMs
  );
  const passwordPollIntervalMs = normalizePollIntervalMs(
    options.passwordPollIntervalMs
  );
  const connectionRetries = normalizeConnectionRetries(
    options.connectionRetries
  );
  const createTelegramClient =
    options.createTelegramClient ?? createDefaultTelegramAuthClient;
  const createQrImageDataUrl =
    options.createQrImageDataUrl ?? createQrSvgDataUrl;
  const wait = options.sleep ?? sleep;

  return {
    name: "telegram-direct-auth",
    channelTypes: [telegramQrBridgeChannelType],
    challengeTypes: [
      telegramQrChallengeType,
      telegramPhoneCodeChallengeType,
      telegramReauthChallengeType
    ],

    async run(
      input: DirectAccountAuthHandlerInput
    ): Promise<DirectAccountAuthHandlerResult> {
      const apiConfig = {
        apiId: options.apiId,
        apiHash: options.apiHash
      };

      if (!isTelegramApiConfigValid(apiConfig)) {
        return failedResult({
          errorCode: "validation.failed",
          errorMessage: "Telegram user API id/hash are not configured.",
          operatorHint:
            "Configure HULEE_TELEGRAM_USER_API_ID and HULEE_TELEGRAM_USER_API_HASH in the provider worker deployment."
        });
      }

      if (!options.sessionCipher) {
        return failedResult({
          errorCode: "validation.failed",
          errorMessage: "Session encryption is not configured.",
          operatorHint:
            "Configure HULEE_SECRET_ENCRYPTION_KEY before authorizing direct Telegram accounts."
        });
      }

      const existingSession = deserializeTelegramSessionPayload({
        cipher: options.sessionCipher,
        sessionEncrypted: input.session.sessionEncrypted
      });
      const client = createTelegramClient({
        sessionString: existingSession?.sessionString ?? "",
        apiId: apiConfig.apiId,
        apiHash: apiConfig.apiHash,
        connectionRetries
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let authErrorMessage: string | undefined;

      try {
        await client.connect();
        const authMode =
          input.challenge.challengeType === telegramPhoneCodeChallengeType
            ? "phone_code"
            : "qr";
        const onAuthError = async (error: Error): Promise<boolean> => {
          authErrorMessage ??= errorMessage(error);
          options.logger?.warn("Telegram direct auth error.", {
            connectorId: input.connector.id,
            challengeId: input.challenge.id,
            sessionId: input.session.id,
            error: errorMessage(error)
          });

          return true;
        };
        const password = async (hint?: string): Promise<string> => {
          await input.updateChallenge({
            status: "requires_password",
            publicPayload: {
              operatorHint: hint
                ? `Telegram requires a two-step verification password. Hint: ${hint}`
                : "Telegram requires a two-step verification password."
            }
          });

          return waitForPassword({
            input,
            passwordTimeoutMs,
            passwordPollIntervalMs,
            wait
          });
        };
        const authPromise =
          authMode === "phone_code"
            ? startTelegramPhoneCodeAuth({
                apiConfig,
                client,
                input,
                password,
                passwordTimeoutMs,
                passwordPollIntervalMs,
                wait,
                onAuthError
              })
            : startTelegramQrAuth({
                apiConfig,
                client,
                createQrImageDataUrl,
                input,
                password,
                onAuthError
              });
        authPromise.catch(() => undefined);

        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("TELEGRAM_QR_AUTH_TIMEOUT")),
            authTimeoutMs
          );
        });
        const user = serializeTelegramUser(
          await Promise.race([authPromise, timeoutPromise])
        );
        const sessionString = client.session.save();

        if (!sessionString) {
          throw new Error("TELEGRAM_SESSION_EMPTY");
        }

        return {
          status: "completed",
          sessionEncrypted: encryptTelegramSessionPayload({
            cipher: options.sessionCipher,
            payload: {
              sessionString,
              user,
              updatedAt: new Date().toISOString()
            }
          }),
          sessionFingerprint: user.id ? `telegram:${user.id}` : undefined,
          externalAccountId: user.id,
          displayAddress: displayAddressForTelegramUser(user),
          connectorDisplayName: displayNameForTelegramUser(user),
          publicState: {
            stage: "connected",
            user
          },
          metadata: {
            provider: "telegram",
            authMode
          },
          diagnostics: {
            lastAuthAt: new Date().toISOString()
          }
        };
      } catch (error) {
        return failedResult({
          errorCode: "provider.permanent_failure",
          errorMessage: authErrorMessage ?? errorMessage(error),
          operatorHint: telegramAuthOperatorHint(
            authErrorMessage ?? errorMessage(error)
          )
        });
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }

        try {
          await client.disconnect();
        } catch {
          // Auth workers only need the serialized MTProto session.
        }
      }
    }
  };
}

function createDefaultTelegramAuthClient(
  input: CreateTelegramAuthClientInput
): TelegramAuthClient {
  return new TelegramClient(
    new StringSession(input.sessionString),
    input.apiId,
    input.apiHash,
    {
      connectionRetries: input.connectionRetries
    }
  ) as unknown as TelegramAuthClient;
}

function startTelegramQrAuth(input: {
  apiConfig: { apiId: number; apiHash: string };
  client: TelegramAuthClient;
  createQrImageDataUrl(qrPayload: string): Promise<string>;
  input: DirectAccountAuthHandlerInput;
  password(hint?: string): Promise<string>;
  onAuthError(error: Error): Promise<boolean>;
}): Promise<unknown> {
  return input.client.signInUserWithQrCode(input.apiConfig, {
    qrCode: async ({ token, expires }) => {
      const qrPayload = buildTelegramQrUrl(token);
      await input.input.updateChallenge({
        status: "waiting",
        publicPayload: {
          qrPayloadRef: qrPayload,
          qrImageDataUrl: await input.createQrImageDataUrl(qrPayload),
          expiresAt: new Date(expires * 1000).toISOString()
        }
      });
    },
    password: input.password,
    onError: input.onAuthError
  });
}

function startTelegramPhoneCodeAuth(input: {
  apiConfig: { apiId: number; apiHash: string };
  client: TelegramAuthClient;
  input: DirectAccountAuthHandlerInput;
  password(hint?: string): Promise<string>;
  passwordTimeoutMs: number;
  passwordPollIntervalMs: number;
  wait(milliseconds: number): Promise<void>;
  onAuthError(error: Error): Promise<boolean>;
}): Promise<unknown> {
  const phoneNumber = readChallengePhoneNumber(input.input.challenge);

  if (!phoneNumber) {
    throw new Error("TELEGRAM_PHONE_NUMBER_REQUIRED");
  }

  return input.client.signInUser(input.apiConfig, {
    phoneNumber,
    phoneCode: async (isCodeViaApp?: boolean) => {
      await input.input.updateChallenge({
        status: "requires_code",
        publicPayload: {
          phoneNumber,
          operatorHint: isCodeViaApp
            ? "Telegram sent a login code to the Telegram app."
            : "Telegram sent a login code by SMS or phone call."
        }
      });

      return waitForCode({
        input: input.input,
        codeTimeoutMs: input.passwordTimeoutMs,
        pollIntervalMs: input.passwordPollIntervalMs,
        wait: input.wait
      });
    },
    password: input.password,
    onError: input.onAuthError
  });
}

function normalizeTimeoutMs(
  value: number | undefined,
  fallback: number
): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }

  return Math.max(30_000, Math.min(Math.trunc(value), 15 * 60_000));
}

function normalizePollIntervalMs(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return defaultTelegramPasswordPollIntervalMs;
  }

  return Math.max(250, Math.min(Math.trunc(value), 10_000));
}

function normalizeConnectionRetries(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return defaultTelegramConnectionRetries;
  }

  return Math.max(0, Math.min(Math.trunc(value), 10));
}

function isTelegramApiConfigValid(input: {
  apiId?: number;
  apiHash?: string;
}): input is { apiId: number; apiHash: string } {
  return (
    Number.isInteger(input.apiId) &&
    (input.apiId ?? 0) > 0 &&
    typeof input.apiHash === "string" &&
    input.apiHash.trim().length > 0
  );
}

async function waitForPassword(input: {
  input: DirectAccountAuthHandlerInput;
  passwordTimeoutMs: number;
  passwordPollIntervalMs: number;
  wait(milliseconds: number): Promise<void>;
}): Promise<string> {
  const deadline = Date.now() + input.passwordTimeoutMs;

  while (Date.now() < deadline) {
    const latest = await input.input.loadLatestChallenge();

    if (!latest) {
      throw new Error("TELEGRAM_AUTH_CHALLENGE_NOT_FOUND");
    }

    if (isTerminalChallengeStatus(latest.challenge.status)) {
      throw new Error(`TELEGRAM_AUTH_CHALLENGE_${latest.challenge.status}`);
    }

    const password = readChallengePassword(latest.challengeSecretPayload);

    if (password) {
      return password;
    }

    await input.wait(input.passwordPollIntervalMs);
  }

  throw new Error("TELEGRAM_2FA_PASSWORD_TIMEOUT");
}

async function waitForCode(input: {
  input: DirectAccountAuthHandlerInput;
  codeTimeoutMs: number;
  pollIntervalMs: number;
  wait(milliseconds: number): Promise<void>;
}): Promise<string> {
  const deadline = Date.now() + input.codeTimeoutMs;

  while (Date.now() < deadline) {
    const latest = await input.input.loadLatestChallenge();

    if (!latest) {
      throw new Error("TELEGRAM_AUTH_CHALLENGE_NOT_FOUND");
    }

    if (isTerminalChallengeStatus(latest.challenge.status)) {
      throw new Error(`TELEGRAM_AUTH_CHALLENGE_${latest.challenge.status}`);
    }

    const code = readChallengeCode(latest.challengeSecretPayload);

    if (code) {
      return code;
    }

    await input.wait(input.pollIntervalMs);
  }

  throw new Error("TELEGRAM_PHONE_CODE_TIMEOUT");
}

function isTerminalChallengeStatus(status: string): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "expired" ||
    status === "cancelled"
  );
}

function readChallengePassword(
  payload: Record<string, unknown>
): string | undefined {
  return (
    readString(payload.password) ??
    readString(payload.telegramPassword) ??
    readString(payload.twoFactorPassword)
  );
}

function readChallengeCode(
  payload: Record<string, unknown>
): string | undefined {
  return (
    readString(payload.code) ??
    readString(payload.telegramCode) ??
    readString(payload.phoneCode) ??
    readString(payload.verificationCode)
  );
}

function readChallengePhoneNumber(
  challenge: DirectAccountAuthHandlerInput["challenge"]
): string | undefined {
  if (!isRecord(challenge.publicPayload)) {
    return undefined;
  }

  return readString(challenge.publicPayload.phoneNumber);
}

function buildTelegramQrUrl(token: Buffer | Uint8Array): string {
  const tokenBuffer = Buffer.isBuffer(token) ? token : Buffer.from(token);

  return `tg://login?token=${tokenBuffer.toString("base64url")}`;
}

async function createQrSvgDataUrl(qrPayload: string): Promise<string> {
  const svg = await qrToString(qrPayload, {
    errorCorrectionLevel: "M",
    margin: 1,
    type: "svg",
    width: 240
  });

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString(
    "base64"
  )}`;
}

export function encryptTelegramSessionPayload(input: {
  cipher: Pick<TenantSecretCipher, "encrypt">;
  payload: TelegramDirectSessionPayload;
}): string {
  return input.cipher.encrypt(JSON.stringify(input.payload));
}

export function deserializeTelegramSessionPayload(input: {
  cipher: Pick<TenantSecretCipher, "decrypt">;
  sessionEncrypted: string | null;
}): TelegramDirectSessionPayload | null {
  if (!input.sessionEncrypted) {
    return null;
  }

  try {
    const parsed = JSON.parse(input.cipher.decrypt(input.sessionEncrypted));

    if (!isRecord(parsed)) {
      return null;
    }

    const sessionString = readString(parsed.sessionString);

    if (!sessionString) {
      return null;
    }

    return {
      sessionString,
      user: readTelegramSelfUser(parsed.user),
      updatedAt: readString(parsed.updatedAt)
    };
  } catch {
    return null;
  }
}

export function serializeTelegramUser(user: unknown): TelegramSelfUser {
  const record = isRecord(user) ? user : {};

  return {
    id: readId(record.id),
    username: readString(record.username),
    firstName: readString(record.firstName),
    lastName: readString(record.lastName)
  };
}

function readTelegramSelfUser(value: unknown): TelegramSelfUser | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    id: readId(value.id),
    username: readString(value.username),
    firstName: readString(value.firstName),
    lastName: readString(value.lastName)
  };
}

export function displayAddressForTelegramUser(
  user: TelegramSelfUser
): string | undefined {
  if (user.username) {
    return `@${user.username}`;
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return fullName || user.id;
}

export function displayNameForTelegramUser(user: TelegramSelfUser): string {
  const displayAddress = displayAddressForTelegramUser(user);

  return displayAddress
    ? `Telegram account (${displayAddress})`
    : "Telegram account";
}

function failedResult(input: {
  errorCode: PlatformErrorCode;
  errorMessage: string;
  operatorHint?: string;
}): DirectAccountAuthHandlerResult {
  return {
    status: "failed",
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    publicPayload: input.operatorHint
      ? {
          operatorHint: input.operatorHint
        }
      : undefined
  };
}

function telegramAuthOperatorHint(message: string): string {
  if (message.includes("TIMEOUT")) {
    return "Telegram authorization timed out. Start a new QR login challenge and scan the code again.";
  }

  if (message.includes("PASSWORD")) {
    return "Telegram two-step verification password was not accepted or was not provided in time.";
  }

  return "Telegram rejected the direct account authorization request.";
}

function readId(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }

  return readString(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export const telegramDirectAuthHandlerTestUtils = {
  buildTelegramQrUrl,
  deserializeTelegramSessionPayload,
  displayAddressForTelegramUser,
  isTelegramApiConfigValid,
  readChallengePassword,
  serializeTelegramUser
};
