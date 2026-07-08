import type { PlatformErrorCode } from "@hulee/contracts";
import type { TenantSecretCipher } from "@hulee/db";
import type { Logger } from "@hulee/observability";
import makeWASocket, {
  Browsers,
  BufferJSON,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto as WAProto,
  type AuthenticationCreds,
  type AuthenticationState,
  type ConnectionState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type WASocket
} from "baileys";
import type { ILogger } from "baileys/lib/Utils/logger.js";
import { toString as qrToString } from "qrcode";

import type {
  DirectAccountAuthHandler,
  DirectAccountAuthHandlerInput,
  DirectAccountAuthHandlerResult
} from "./direct-account-auth-sweeper";

const defaultWhatsAppAuthTimeoutMs = 7 * 60 * 1000;
const defaultWhatsAppVersionCacheMs = 6 * 60 * 60 * 1000;
const whatsappQrBridgeChannelType = "whatsapp_qr_bridge";
const whatsappQrChallengeType = "qr";
const whatsappPhoneCodeChallengeType = "phone_code";
const whatsappReauthChallengeType = "reauth";

export type WhatsAppSelfUser = {
  id?: string;
  name?: string;
};

export type WhatsAppDirectSessionPayload = {
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
  user?: WhatsAppSelfUser;
  updatedAt?: string;
};

export type WhatsAppDirectSessionState = {
  state: AuthenticationState;
  saveCreds(update: Partial<AuthenticationCreds>): Promise<void>;
  snapshot(): WhatsAppDirectSessionPayload;
};

export type ConnectWhatsAppSocketLoopInput = {
  sessionId: string;
  sessionState: WhatsAppDirectSessionState;
  timeoutMs: number;
  onQr(qrPayload: string): Promise<void>;
  pairingPhoneNumber?: string;
  onPairingCode?(pairingCode: string): Promise<void>;
  onRestart?(): Promise<void>;
};

export type WhatsAppSocketHandle = {
  user?: unknown;
  end?(error?: Error): void;
};

export type WhatsAppDirectAuthHandlerOptions = {
  sessionCipher?: Pick<TenantSecretCipher, "encrypt" | "decrypt">;
  authTimeoutMs?: number;
  versionCacheMs?: number;
  connectWhatsAppSocketLoop?: (
    input: ConnectWhatsAppSocketLoopInput
  ) => Promise<WhatsAppSocketHandle>;
  createQrImageDataUrl?: (qrPayload: string) => Promise<string>;
  fetchLatestVersion?: typeof fetchLatestBaileysVersion;
  makeWASocket?: typeof makeWASocket;
  logger?: Pick<Logger, "warn">;
};

export function createWhatsAppDirectAuthHandler(
  options: WhatsAppDirectAuthHandlerOptions
): DirectAccountAuthHandler {
  const authTimeoutMs = normalizeTimeoutMs(
    options.authTimeoutMs,
    defaultWhatsAppAuthTimeoutMs
  );
  const createQrImageDataUrl =
    options.createQrImageDataUrl ?? createQrSvgDataUrl;
  const connectWhatsAppSocketLoop =
    options.connectWhatsAppSocketLoop ??
    createWhatsAppSocketConnector({
      logger: options.logger,
      fetchLatestVersion: options.fetchLatestVersion,
      makeSocket: options.makeWASocket,
      versionCacheMs: options.versionCacheMs
    }).connectWhatsAppSocketLoop;

  return {
    name: "whatsapp-direct-auth",
    channelTypes: [whatsappQrBridgeChannelType],
    challengeTypes: [
      whatsappQrChallengeType,
      whatsappPhoneCodeChallengeType,
      whatsappReauthChallengeType
    ],

    async run(
      input: DirectAccountAuthHandlerInput
    ): Promise<DirectAccountAuthHandlerResult> {
      if (!options.sessionCipher) {
        return failedResult({
          errorCode: "validation.failed",
          errorMessage: "Session encryption is not configured.",
          operatorHint:
            "Configure HULEE_SECRET_ENCRYPTION_KEY before authorizing direct WhatsApp accounts."
        });
      }

      const existingSession = deserializeWhatsAppSessionPayload({
        cipher: options.sessionCipher,
        sessionEncrypted: input.session.sessionEncrypted
      });
      const sessionState = createWhatsAppSessionState({
        initialSessionPayload: existingSession,
        logger: createBaileysLogger(options.logger, {
          connectorId: input.connector.id,
          sessionId: input.session.id,
          component: "keystore"
        })
      });
      let socket: WhatsAppSocketHandle | undefined;
      const authMode =
        input.challenge.challengeType === whatsappPhoneCodeChallengeType
          ? "pairing_code"
          : "qr";
      let pairingPhoneNumber: string | undefined;

      if (authMode === "pairing_code") {
        try {
          pairingPhoneNumber = readWhatsAppPairingPhoneNumber(input.challenge);
        } catch (error) {
          return failedResult({
            errorCode: "validation.failed",
            errorMessage: errorMessage(error),
            operatorHint:
              "WhatsApp phone number should be in international format, for example +79991234567."
          });
        }
      }

      if (authMode === "pairing_code" && !pairingPhoneNumber) {
        return failedResult({
          errorCode: "validation.failed",
          errorMessage: "WhatsApp phone number is required.",
          operatorHint:
            "Start WhatsApp authorization again and enter the account phone number in international format."
        });
      }

      try {
        socket = await connectWhatsAppSocketLoop({
          sessionId: input.session.id,
          sessionState,
          timeoutMs: authTimeoutMs,
          pairingPhoneNumber,
          onQr: async (qrPayload) => {
            await input.updateChallenge({
              status: "waiting",
              publicPayload: {
                qrPayloadRef: qrPayload,
                qrImageDataUrl: await createQrImageDataUrl(qrPayload),
                expiresAt: input.challenge.expiresAt?.toISOString()
              }
            });
          },
          onPairingCode: async (pairingCode) => {
            await input.updateChallenge({
              status: "waiting",
              publicPayload: {
                phoneNumber: pairingPhoneNumber
                  ? `+${pairingPhoneNumber}`
                  : undefined,
                pairingCode: formatWhatsAppPairingCode(pairingCode),
                expiresAt: input.challenge.expiresAt?.toISOString(),
                operatorHint:
                  "Enter the pairing code in WhatsApp linked devices. The page will update after authorization."
              }
            });
          },
          onRestart: async () => {
            await input.updateChallenge({
              status: "waiting",
              publicPayload: {
                operatorHint:
                  "WhatsApp requested a connection restart. Keep the QR challenge open."
              }
            });
          }
        });

        const snapshot = sessionState.snapshot();
        const socketUser = readWhatsAppSelfUser(socket.user);
        const credsUser = buildWhatsAppSelfUser(snapshot);
        const user = {
          id: socketUser.id ?? credsUser.id,
          name: socketUser.name ?? credsUser.name
        };
        const completedAt = new Date().toISOString();

        return {
          status: "completed",
          sessionEncrypted: encryptWhatsAppSessionPayload({
            cipher: options.sessionCipher,
            payload: {
              ...snapshot,
              user,
              updatedAt: completedAt
            }
          }),
          sessionFingerprint: user.id ? `whatsapp:${user.id}` : undefined,
          externalAccountId: user.id,
          displayAddress: displayAddressForWhatsAppUser(user),
          connectorDisplayName: displayNameForWhatsAppUser(user),
          publicState: {
            stage: "connected",
            user
          },
          metadata: {
            provider: "whatsapp",
            authMode
          },
          diagnostics: {
            lastAuthAt: completedAt
          }
        };
      } catch (error) {
        return failedResult({
          errorCode: "provider.permanent_failure",
          errorMessage: errorMessage(error),
          operatorHint: whatsAppAuthOperatorHint(errorMessage(error))
        });
      } finally {
        try {
          socket?.end?.();
        } catch {
          // The auth worker only needs the encrypted Baileys session snapshot.
        }
      }
    }
  };
}

export function createWhatsAppSocketConnector(input: {
  logger?: Pick<Logger, "warn">;
  fetchLatestVersion?: typeof fetchLatestBaileysVersion;
  makeSocket?: typeof makeWASocket;
  versionCacheMs?: number;
}) {
  const getLatestWhatsAppVersion = createWhatsAppVersionResolver({
    logger: input.logger,
    fetchLatestVersion: input.fetchLatestVersion,
    cacheMs: input.versionCacheMs
  }).getLatestWhatsAppVersion;
  const makeSocket = input.makeSocket ?? makeWASocket;
  const browser = Browsers?.macOS
    ? Browsers.macOS("Chrome")
    : (["Chrome", "Desktop", "1.0"] as [string, string, string]);

  async function connectWhatsAppSocketAttempt(
    options: ConnectWhatsAppSocketLoopInput
  ): Promise<{ type: "open"; socket: WASocket } | { type: "restart" }> {
    const version = await getLatestWhatsAppVersion();
    const socket = makeSocket({
      auth: options.sessionState.state,
      browser,
      ...(version ? { version } : {}),
      logger: createBaileysLogger(input.logger, {
        sessionId: options.sessionId,
        component: "socket"
      }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      getMessage: async () => undefined
    });

    socket.ev.on("creds.update", (update) => {
      options.sessionState.saveCreds(update).catch((error: unknown) => {
        input.logger?.warn("WhatsApp credentials persist failed.", {
          sessionId: options.sessionId,
          error: errorMessage(error)
        });
      });
    });

    return await new Promise((resolve, reject) => {
      let settled = false;
      let pairingCodeRequested = false;
      const timeout = setTimeout(() => {
        try {
          socket.end(new Error("WHATSAPP_QR_AUTH_TIMEOUT"));
        } catch {
          // Best effort cleanup before the attempt fails.
        }
        finish(new Error("WHATSAPP_QR_AUTH_TIMEOUT"), true);
      }, options.timeoutMs);

      function finish(
        result:
          | { type: "open"; socket: WASocket }
          | { type: "restart" }
          | Error,
        isError = false
      ) {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        socket.ev.off("connection.update", onConnectionUpdate);

        if (isError) {
          reject(result);
        } else {
          resolve(
            result as { type: "open"; socket: WASocket } | { type: "restart" }
          );
        }
      }

      function onConnectionUpdate(update: Partial<ConnectionState>): void {
        void (async () => {
          try {
            if (update.qr && !options.pairingPhoneNumber) {
              await options.onQr(update.qr);
            }

            if (update.connection === "open") {
              finish({ type: "open", socket });
              return;
            }

            if (update.connection === "close") {
              const code = getWhatsAppDisconnectCode(update.lastDisconnect);

              input.logger?.warn("WhatsApp connection closed.", {
                sessionId: options.sessionId,
                statusCode: code,
                error: getWhatsAppDisconnectMessage(update.lastDisconnect)
              });

              if (code === DisconnectReason.restartRequired) {
                finish({ type: "restart" });
                return;
              }

              finish(
                new Error(getWhatsAppDisconnectMessage(update.lastDisconnect)),
                true
              );
            }
          } catch (error) {
            finish(
              error instanceof Error ? error : new Error(String(error)),
              true
            );
          }
        })();
      }

      socket.ev.on("connection.update", onConnectionUpdate);

      if (options.pairingPhoneNumber) {
        void requestPairingCode().catch((error: unknown) => {
          finish(
            error instanceof Error ? error : new Error(String(error)),
            true
          );
        });
      }

      async function requestPairingCode(): Promise<void> {
        if (
          pairingCodeRequested ||
          options.sessionState.state.creds.registered
        ) {
          return;
        }

        pairingCodeRequested = true;
        const pairingCode = await socket.requestPairingCode(
          options.pairingPhoneNumber as string
        );

        await options.onPairingCode?.(pairingCode);
      }
    });
  }

  async function connectWhatsAppSocketLoop(
    options: ConnectWhatsAppSocketLoopInput
  ): Promise<WASocket> {
    const deadline = Date.now() + options.timeoutMs;

    while (Date.now() < deadline) {
      const attempt = await connectWhatsAppSocketAttempt({
        ...options,
        timeoutMs: Math.max(10_000, deadline - Date.now())
      });

      if (attempt.type === "restart") {
        await options.onRestart?.();
        continue;
      }

      return attempt.socket;
    }

    throw new Error("WHATSAPP_QR_AUTH_TIMEOUT");
  }

  return {
    connectWhatsAppSocketAttempt,
    connectWhatsAppSocketLoop
  };
}

function createWhatsAppVersionResolver(
  input: {
    logger?: Pick<Logger, "warn">;
    cacheMs?: number;
    nowMs?: () => number;
    fetchLatestVersion?: typeof fetchLatestBaileysVersion;
  } = {}
) {
  const fetchLatestVersion =
    input.fetchLatestVersion ?? fetchLatestBaileysVersion;
  const cacheMs = normalizeTimeoutMs(
    input.cacheMs,
    defaultWhatsAppVersionCacheMs
  );
  const nowMs = input.nowMs ?? Date.now;
  let cachedVersion: [number, number, number] | null = null;
  let cachedAt = 0;
  let pending: Promise<[number, number, number] | null> | null = null;

  async function getLatestWhatsAppVersion(): Promise<
    [number, number, number] | null
  > {
    const now = nowMs();

    if (isValidWhatsAppVersion(cachedVersion) && now - cachedAt < cacheMs) {
      return cachedVersion;
    }

    if (pending) {
      return pending;
    }

    pending = (async () => {
      try {
        const result = await fetchLatestVersion();

        if (isValidWhatsAppVersion(result?.version)) {
          cachedVersion = result.version;
          cachedAt = nowMs();

          return cachedVersion;
        }
      } catch (error) {
        input.logger?.warn("Failed to resolve WhatsApp Baileys version.", {
          error: errorMessage(error)
        });
      } finally {
        pending = null;
      }

      return isValidWhatsAppVersion(cachedVersion) ? cachedVersion : null;
    })();

    return pending;
  }

  return {
    getLatestWhatsAppVersion
  };
}

export function createWhatsAppSessionState(
  input: {
    initialSessionPayload?: WhatsAppDirectSessionPayload | null;
    logger?: ILogger;
    persist?: (payload: WhatsAppDirectSessionPayload) => Promise<void>;
    createInitialCreds?: () => AuthenticationCreds;
  } = {}
): WhatsAppDirectSessionState {
  const persist = input.persist ?? (async () => undefined);
  const createInitialCreds = input.createInitialCreds ?? initAuthCreds;
  const creds = input.initialSessionPayload?.creds
    ? cloneWithBufferJson(input.initialSessionPayload.creds)
    : createInitialCreds();
  const keys: Record<string, Record<string, unknown>> = input
    .initialSessionPayload?.keys &&
  typeof input.initialSessionPayload.keys === "object" &&
  !Array.isArray(input.initialSessionPayload.keys)
    ? cloneWithBufferJson(input.initialSessionPayload.keys)
    : {};
  const baseStore: SignalKeyStore = {
    async get<T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[]
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
      const category =
        keys[type] && typeof keys[type] === "object" ? keys[type] : {};
      const data: Record<string, SignalDataTypeMap[T]> = {};

      for (const id of ids) {
        let value = category[id] as SignalDataTypeMap[T] | undefined;

        if (type === "app-state-sync-key" && value) {
          value = WAProto.Message.AppStateSyncKeyData.fromObject(
            value as Record<string, unknown>
          ) as unknown as SignalDataTypeMap[T];
        }

        if (value !== undefined && value !== null) {
          data[id] = value;
        }
      }

      return data;
    },

    async set(data: SignalDataSet): Promise<void> {
      for (const [category, values] of Object.entries(data)) {
        if (!keys[category] || typeof keys[category] !== "object") {
          keys[category] = {};
        }
        const target = keys[category];

        for (const [id, value] of Object.entries(values ?? {})) {
          if (value === null || value === undefined) {
            delete target[id];
          } else {
            target[id] = value;
          }
        }
      }

      await persist({ creds, keys });
    }
  };

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(
        baseStore,
        input.logger ?? createNoopBaileysLogger()
      )
    },
    async saveCreds(update: Partial<AuthenticationCreds>): Promise<void> {
      if (update && typeof update === "object") {
        Object.assign(creds, cloneWithBufferJson(update));
      }

      await persist({ creds, keys });
    },
    snapshot(): WhatsAppDirectSessionPayload {
      return {
        creds,
        keys
      };
    }
  };
}

export function encryptWhatsAppSessionPayload(input: {
  cipher: Pick<TenantSecretCipher, "encrypt">;
  payload: WhatsAppDirectSessionPayload;
}): string {
  return input.cipher.encrypt(
    JSON.stringify(input.payload, BufferJSON.replacer)
  );
}

export function deserializeWhatsAppSessionPayload(input: {
  cipher: Pick<TenantSecretCipher, "decrypt">;
  sessionEncrypted: string | null;
}): WhatsAppDirectSessionPayload | null {
  if (!input.sessionEncrypted) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      input.cipher.decrypt(input.sessionEncrypted),
      BufferJSON.reviver
    ) as unknown;

    if (!isRecord(parsed) || !parsed.creds) {
      return null;
    }

    const keys = readWhatsAppSessionKeys(parsed.keys);

    if (!keys) {
      return null;
    }

    return {
      creds: parsed.creds as AuthenticationCreds,
      keys,
      user: readWhatsAppSelfUser(parsed.user),
      updatedAt: readString(parsed.updatedAt)
    };
  } catch {
    return null;
  }
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

export function buildWhatsAppSelfUser(
  sessionPayload: WhatsAppDirectSessionPayload
): WhatsAppSelfUser {
  const me = readRecord(sessionPayload.creds.me) ?? {};

  return {
    id: readString(me.id),
    name: readString(me.name)
  };
}

function readWhatsAppSessionKeys(
  value: unknown
): Record<string, Record<string, unknown>> | null {
  if (!isRecord(value)) {
    return null;
  }

  const keys: Record<string, Record<string, unknown>> = {};

  for (const [category, entries] of Object.entries(value)) {
    if (isRecord(entries)) {
      keys[category] = entries;
    }
  }

  return keys;
}

export function readWhatsAppSelfUser(value: unknown): WhatsAppSelfUser {
  if (!isRecord(value)) {
    return {};
  }

  return {
    id: readString(value.id),
    name: readString(value.name)
  };
}

export function displayAddressForWhatsAppUser(
  user: WhatsAppSelfUser
): string | undefined {
  const phone = extractWhatsAppPhone(user.id);

  return phone ? `+${phone}` : (user.name ?? user.id);
}

export function displayNameForWhatsAppUser(user: WhatsAppSelfUser): string {
  const displayAddress = displayAddressForWhatsAppUser(user);

  return displayAddress
    ? `WhatsApp account (${displayAddress})`
    : "WhatsApp account";
}

function extractWhatsAppPhone(userId: string | undefined): string | undefined {
  const value = userId?.split("@")[0]?.split(":")[0];
  const digits = value?.replace(/\D/g, "");

  return digits && digits.length >= 10 ? digits : undefined;
}

function readWhatsAppPairingPhoneNumber(
  challenge: DirectAccountAuthHandlerInput["challenge"]
): string | undefined {
  if (!isRecord(challenge.publicPayload)) {
    return undefined;
  }

  const phoneNumber = readString(challenge.publicPayload.phoneNumber);

  return phoneNumber
    ? normalizeWhatsAppPairingPhoneNumber(phoneNumber)
    : undefined;
}

function normalizeWhatsAppPairingPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");

  if (digits.length < 10 || digits.length > 15) {
    throw new Error("WHATSAPP_PHONE_NUMBER_INVALID");
  }

  return digits;
}

function formatWhatsAppPairingCode(pairingCode: string): string {
  const normalized = pairingCode.replace(/\s+/g, "").toUpperCase();
  const groups = normalized.match(/.{1,4}/g);

  return groups ? groups.join("-") : normalized;
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

function whatsAppAuthOperatorHint(message: string): string {
  if (message.includes("TIMEOUT")) {
    return "WhatsApp QR authorization timed out. Start a new challenge and scan the QR code again.";
  }

  if (message.includes("logged out") || message.includes("401")) {
    return "WhatsApp rejected the session. Start a new QR login challenge.";
  }

  return "WhatsApp direct account authorization failed. Check the provider worker network route and try again.";
}

function createBaileysLogger(
  logger: Pick<Logger, "warn"> | undefined,
  bindings: Record<string, unknown> = {}
): ILogger {
  return {
    level: "info",
    child(extra: Record<string, unknown>) {
      return createBaileysLogger(logger, { ...bindings, ...extra });
    },
    trace() {},
    debug() {},
    info() {},
    warn(payload: unknown, message?: string) {
      logger?.warn(message ?? "WhatsApp provider warning.", {
        ...bindings,
        payload
      });
    },
    error(payload: unknown, message?: string) {
      logger?.warn(message ?? "WhatsApp provider error.", {
        ...bindings,
        payload
      });
    }
  };
}

function createNoopBaileysLogger(): ILogger {
  return createBaileysLogger(undefined);
}

export function getWhatsAppDisconnectCode(
  lastDisconnect: unknown
): number | null {
  const output = readRecord(readRecord(lastDisconnect)?.error)?.output;
  const statusCode = readRecord(output)?.statusCode;

  return typeof statusCode === "number" ? statusCode : null;
}

export function getWhatsAppDisconnectMessage(lastDisconnect: unknown): string {
  const error = readRecord(lastDisconnect)?.error;

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "WhatsApp connection closed";
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

function isValidWhatsAppVersion(
  value: unknown
): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => Number.isInteger(part) && part > 0)
  );
}

function cloneWithBufferJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, BufferJSON.replacer),
    BufferJSON.reviver
  ) as T;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
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

export const whatsappDirectAuthHandlerTestUtils = {
  buildWhatsAppSelfUser,
  createWhatsAppSessionState,
  deserializeWhatsAppSessionPayload,
  displayAddressForWhatsAppUser,
  extractWhatsAppPhone
};
