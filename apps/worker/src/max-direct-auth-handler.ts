import type { PlatformErrorCode } from "@hulee/contracts";
import type { TenantSecretCipher } from "@hulee/db";
import type { Logger } from "@hulee/observability";
import { randomUUID } from "node:crypto";

import type {
  DirectAccountAuthHandler,
  DirectAccountAuthHandlerInput,
  DirectAccountAuthHandlerResult,
  DirectAccountAuthPublicPayload
} from "./direct-account-auth-sweeper";
import {
  createMaxAuthTransportClientFactory,
  MaxSocketRequestError,
  type MaxAuthTransportClient,
  type MaxAuthTransportClientFactoryInput
} from "./max-direct-transport-client";
import {
  createMaxSessionHelpers,
  displayAddressForMaxUser,
  displayNameForMaxUser,
  encryptMaxSessionPayload,
  getMaxChallengeMethod,
  getMaxLoginToken,
  getMaxLoginViewerId,
  getMaxPasswordChallenge,
  getMaxPasswordTrackIdPayload,
  hasMaxLoginPayload,
  maskMaxPhoneNumber,
  normalizeMaxPhoneNumber,
  readMaxChallengeSecretPayload,
  resolveMaxRecoverableState,
  serializeMaxProfile,
  type MaxAuthStep,
  type MaxChallengeSecretPayload
} from "./max-direct-session";

const maxQrBridgeChannelType = "max_qr_bridge";
const maxPhoneCodeChallengeType = "phone_code";
const maxReauthChallengeType = "reauth";
const defaultMaxAuthTimeoutMs = 30_000;
const defaultMaxSocketHost = "api.oneme.ru";
const defaultMaxSocketPort = 443;
const defaultMaxAppVersion = "25.12.14";
const defaultMaxBuildNumber = 0x97cb;
const defaultMaxDeviceType = "DESKTOP";
const defaultMaxLocale = "ru";
const defaultMaxDeviceLocale = "ru";
const defaultMaxTimezone = "Europe/Moscow";
const defaultMaxScreen = "1080x1920 1.0x";
const defaultMaxUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const maxRateLimitOperatorHint =
  "MAX temporarily limited authorization attempts. Wait a few minutes before requesting or submitting a new code.";
const defaultMaxAllowedEarlyOpcodes = [
  5, 6, 17, 18, 19, 23, 101, 109, 110, 115, 116, 288, 289, 291
] as const;

export type MaxDirectAuthHandlerOptions = {
  sessionCipher?: Pick<TenantSecretCipher, "encrypt" | "decrypt">;
  authTimeoutMs?: number;
  socketHost?: string;
  socketPort?: number;
  transportAdapter?: string;
  transportEndpoint?: string;
  protocolVersion?: number;
  appVersion?: string;
  buildNumber?: number;
  deviceType?: string;
  defaultLocale?: string;
  defaultDeviceLocale?: string;
  defaultTimezone?: string;
  defaultScreen?: string;
  defaultUserAgent?: string;
  createTransportClient?: (
    input?: MaxAuthTransportClientFactoryInput
  ) => Pick<MaxAuthTransportClient, "auth" | "cmd" | "connect" | "close">;
  createDeviceId?: () => string;
  logger?: Pick<Logger, "warn">;
};

export function createMaxDirectAuthHandler(
  options: MaxDirectAuthHandlerOptions
): DirectAccountAuthHandler {
  const authTimeoutMs = normalizeTimeoutMs(
    options.authTimeoutMs,
    defaultMaxAuthTimeoutMs
  );
  const socketHost = options.socketHost || defaultMaxSocketHost;
  const socketPort = options.socketPort ?? defaultMaxSocketPort;
  const transportAdapter = options.transportAdapter || socketHost;
  const transportEndpoint =
    options.transportEndpoint || `tls://${socketHost}:${socketPort}`;
  const defaultLocale = options.defaultLocale || defaultMaxLocale;
  const sessionHelpers = createMaxSessionHelpers({
    appVersion: options.appVersion || defaultMaxAppVersion,
    buildNumber: options.buildNumber ?? defaultMaxBuildNumber,
    defaultDeviceLocale: options.defaultDeviceLocale || defaultMaxDeviceLocale,
    defaultLocale,
    defaultScreen: options.defaultScreen || defaultMaxScreen,
    defaultTimezone: options.defaultTimezone || defaultMaxTimezone,
    defaultUserAgent: options.defaultUserAgent || defaultMaxUserAgent,
    deviceType: options.deviceType || defaultMaxDeviceType,
    transportAdapter,
    transportEndpoint
  });
  const createTransportClient =
    options.createTransportClient ??
    createMaxAuthTransportClientFactory({
      allowedEarlyOpcodes: defaultMaxAllowedEarlyOpcodes,
      authTimeoutMs,
      buildMaxHandshakePayload: sessionHelpers.buildMaxHandshakePayload,
      createDeviceId: options.createDeviceId,
      defaultLocale,
      protocolVersion: options.protocolVersion,
      socketHost,
      socketPort
    });

  return {
    name: "max-direct-auth",
    channelTypes: [maxQrBridgeChannelType],
    challengeTypes: [maxPhoneCodeChallengeType, maxReauthChallengeType],

    async run(
      input: DirectAccountAuthHandlerInput
    ): Promise<DirectAccountAuthHandlerResult> {
      if (!options.sessionCipher) {
        return failedResult({
          errorCode: "validation.failed",
          errorMessage: "Session encryption is not configured.",
          operatorHint:
            "Configure HULEE_SECRET_ENCRYPTION_KEY before authorizing direct MAX accounts."
        });
      }

      let secretPayload: MaxChallengeSecretPayload;

      try {
        secretPayload = readMaxChallengeSecretPayload(
          input.challengeSecretPayload
        );
      } catch (error) {
        return failedResult({
          errorCode: "validation.failed",
          errorMessage: errorMessage(error),
          operatorHint: "MAX verification code should contain 4 to 10 digits."
        });
      }

      if (!secretPayload.phoneNumber) {
        const phoneNumber = readPublicPhoneNumber(input);

        if (phoneNumber) {
          try {
            secretPayload = {
              ...secretPayload,
              phoneNumber: normalizeMaxPhoneNumber(phoneNumber)
            };
          } catch (error) {
            return failedResult({
              errorCode: "validation.failed",
              errorMessage: errorMessage(error),
              operatorHint:
                "MAX phone number should be in international format, for example +79991234567."
            });
          }
        }
      }

      const method = getMaxChallengeMethod(secretPayload);

      if (!method) {
        return failedResult({
          errorCode: "validation.failed",
          errorMessage: "MAX phone number is required.",
          operatorHint:
            "Start MAX authorization again and enter the account phone number."
        });
      }

      const deviceId =
        secretPayload.deviceId || options.createDeviceId?.() || randomUUID();
      const phoneNumber = secretPayload.phoneNumber ?? null;
      const phoneMasked = phoneNumber ? maskMaxPhoneNumber(phoneNumber) : null;

      await input.updateChallenge({
        status: "waiting",
        publicPayload: {
          phoneNumber: phoneMasked ?? undefined,
          operatorHint: "MAX authorization request is being processed."
        },
        secretPayload: {
          ...secretPayload,
          deviceId
        },
        errorCode: null,
        errorMessage: null
      });

      const client = createTransportClient({
        deviceId,
        locale: defaultLocale
      });

      try {
        await client.connect();

        if (method === "phone_number") {
          return await requestVerificationCode({
            client,
            input,
            deviceId,
            phoneNumber,
            defaultLocale
          });
        }

        if (method === "verification_code") {
          return await checkVerificationCode({
            client,
            input,
            cipher: options.sessionCipher,
            deviceId,
            defaultLocale,
            sessionHelpers,
            secretPayload,
            method
          });
        }

        return await checkPassword({
          client,
          input,
          cipher: options.sessionCipher,
          deviceId,
          defaultLocale,
          sessionHelpers,
          secretPayload,
          method
        });
      } catch (error) {
        options.logger?.warn("MAX direct auth failed.", {
          connectorId: input.connector.id,
          sessionId: input.session.id,
          challengeId: input.challenge.id,
          error: errorMessage(error)
        });

        return await recoverOrFail({
          input,
          error,
          method,
          deviceId,
          secretPayload,
          phoneMasked
        });
      } finally {
        await client.close();
      }
    }
  };
}

async function requestVerificationCode(input: {
  client: Pick<MaxAuthTransportClient, "cmd">;
  input: DirectAccountAuthHandlerInput;
  deviceId: string;
  phoneNumber: string | null;
  defaultLocale: string;
}): Promise<DirectAccountAuthHandlerResult> {
  if (!input.phoneNumber) {
    return failedResult({
      errorCode: "validation.failed",
      errorMessage: "MAX phone number is required.",
      operatorHint:
        "Start MAX authorization again and enter the account phone number."
    });
  }

  const response = await input.client.cmd(17, {
    phone: input.phoneNumber,
    type: "START_AUTH",
    language: input.defaultLocale
  });
  const responseToken = readOptionalString(
    isRecord(response) ? response.token : undefined
  );

  if (!responseToken) {
    throw new Error("MAX_AUTH_TOKEN_MISSING");
  }

  const expiresAt = input.input.challenge.expiresAt;

  return {
    status: "pending",
    challengeStatus: "requires_code",
    publicPayload: {
      phoneNumber: maskMaxPhoneNumber(input.phoneNumber),
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {})
    },
    secretPayload: {
      deviceId: input.deviceId,
      phoneNumber: input.phoneNumber,
      maxAuthToken: responseToken
    },
    expiresAt,
    operatorHint:
      "MAX sent a verification code. Enter the code from the message."
  };
}

async function checkVerificationCode(input: {
  client: Pick<MaxAuthTransportClient, "auth" | "cmd">;
  input: DirectAccountAuthHandlerInput;
  cipher: Pick<TenantSecretCipher, "encrypt">;
  deviceId: string;
  defaultLocale: string;
  sessionHelpers: ReturnType<typeof createMaxSessionHelpers>;
  secretPayload: MaxChallengeSecretPayload;
  method: MaxAuthStep;
}): Promise<DirectAccountAuthHandlerResult> {
  const verificationCode = input.secretPayload.verificationCode;

  if (!verificationCode) {
    return {
      status: "pending",
      challengeStatus: "requires_code",
      publicPayload: publicPayloadForSecret(input.secretPayload),
      secretPayload: stripChallengeAnswer(input.secretPayload),
      operatorHint:
        "Enter the verification code from MAX to continue authorization."
    };
  }

  const response = await input.client.cmd(18, {
    token: input.secretPayload.maxAuthToken,
    verifyCode: verificationCode,
    authTokenType: "CHECK_CODE"
  });
  const passwordChallenge = getMaxPasswordChallenge(response);

  if (passwordChallenge) {
    const hint = [passwordChallenge.hint, passwordChallenge.email]
      .filter(Boolean)
      .join(" ");

    return {
      status: "pending",
      challengeStatus: "requires_password",
      publicPayload: publicPayloadForSecret(input.secretPayload),
      secretPayload: {
        deviceId: input.deviceId,
        phoneNumber: input.secretPayload.phoneNumber ?? null,
        maxAuthToken: input.secretPayload.maxAuthToken ?? null,
        passwordTrackId: String(passwordChallenge.trackId)
      },
      operatorHint: hint
        ? `MAX requires a two-step verification password. Hint: ${hint}`
        : "MAX requires a two-step verification password."
    };
  }

  if (!hasMaxLoginPayload(response)) {
    if (isRegisterTokenResponse(response)) {
      return failedResult({
        errorCode: "provider.permanent_failure",
        errorMessage: "MAX account is not fully registered.",
        operatorHint:
          "Use an existing registered MAX account for direct account authorization."
      });
    }

    throw new Error("MAX_LOGIN_RESPONSE_INVALID");
  }

  return await buildConnectedResult({
    client: input.client,
    cipher: input.cipher,
    deviceId: input.deviceId,
    defaultLocale: input.defaultLocale,
    sessionHelpers: input.sessionHelpers,
    method: input.method,
    loginPayload: response
  });
}

async function checkPassword(input: {
  client: Pick<MaxAuthTransportClient, "auth" | "cmd">;
  input: DirectAccountAuthHandlerInput;
  cipher: Pick<TenantSecretCipher, "encrypt">;
  deviceId: string;
  defaultLocale: string;
  sessionHelpers: ReturnType<typeof createMaxSessionHelpers>;
  secretPayload: MaxChallengeSecretPayload;
  method: MaxAuthStep;
}): Promise<DirectAccountAuthHandlerResult> {
  if (!input.secretPayload.password) {
    return {
      status: "pending",
      challengeStatus: "requires_password",
      publicPayload: publicPayloadForSecret(input.secretPayload),
      secretPayload: stripChallengeAnswer(input.secretPayload),
      operatorHint: "Enter the MAX two-step verification password."
    };
  }

  const response = await input.client.cmd(115, {
    trackId: getMaxPasswordTrackIdPayload(input.secretPayload.passwordTrackId),
    password: input.secretPayload.password
  });

  if (!hasMaxLoginPayload(response)) {
    throw new Error("MAX_LOGIN_RESPONSE_INVALID");
  }

  return await buildConnectedResult({
    client: input.client,
    cipher: input.cipher,
    deviceId: input.deviceId,
    defaultLocale: input.defaultLocale,
    sessionHelpers: input.sessionHelpers,
    method: input.method,
    loginPayload: response
  });
}

async function buildConnectedResult(input: {
  client: Pick<MaxAuthTransportClient, "auth" | "cmd">;
  cipher: Pick<TenantSecretCipher, "encrypt">;
  deviceId: string;
  defaultLocale: string;
  sessionHelpers: ReturnType<typeof createMaxSessionHelpers>;
  method: MaxAuthStep;
  loginPayload: unknown;
}): Promise<DirectAccountAuthHandlerResult> {
  const token =
    getMaxLoginToken(input.loginPayload) ?? input.client.auth?.token;
  const viewerId =
    getMaxLoginViewerId(input.loginPayload) ?? input.client.auth?.viewerId;

  if (!token || !viewerId) {
    throw new Error("MAX_LOGIN_TOKEN_MISSING");
  }

  let resyncPayload: unknown = null;

  try {
    resyncPayload = await input.client.cmd(
      19,
      input.sessionHelpers.buildMaxResyncPayload({
        token,
        locale: input.defaultLocale,
        sync: {
          chatsSync: 0,
          contactsSync: 0,
          presenceSync: -1,
          draftsSync: 0,
          configHash: ""
        }
      })
    );
  } catch {
    // The login token is still valid. A monitor sweep will re-check resync.
  }

  const user = serializeMaxProfile(
    isRecord(input.loginPayload) ? input.loginPayload.profile : undefined
  );
  const completedAt = new Date().toISOString();
  const sessionPayload = input.sessionHelpers.buildMaxSessionPayload({
    deviceId: input.deviceId,
    token,
    viewerId,
    profile: user,
    lastLogin: getLastLoginValue(resyncPayload),
    connectedAt: completedAt
  });
  const externalAccountId = user.id ?? viewerId;
  const displayAddress = displayAddressForMaxUser(user);

  return {
    status: "completed",
    sessionEncrypted: encryptMaxSessionPayload({
      cipher: input.cipher,
      payload: sessionPayload
    }),
    sessionFingerprint: `max:${externalAccountId}`,
    externalAccountId,
    displayAddress,
    connectorDisplayName: displayNameForMaxUser(user),
    publicState: {
      stage: "connected",
      user
    },
    metadata: {
      provider: "max",
      authMode:
        input.method === "password_2fa" ? "phone_code_password" : "phone_code"
    },
    diagnostics: {
      lastAuthAt: completedAt,
      sessionProbe: {
        provider: "max"
      }
    }
  };
}

async function recoverOrFail(input: {
  input: DirectAccountAuthHandlerInput;
  error: unknown;
  method: MaxAuthStep;
  deviceId: string;
  secretPayload: MaxChallengeSecretPayload;
  phoneMasked: string | null;
}): Promise<DirectAccountAuthHandlerResult> {
  const details = readErrorDetails(input.error);

  if (
    details.code === "MAX_LOGIN_RESPONSE_INVALID" ||
    details.code === "MAX_AUTH_TOKEN_MISSING" ||
    details.code === "MAX_LOGIN_TOKEN_MISSING"
  ) {
    return failedResult({
      errorCode: "provider.permanent_failure",
      errorMessage:
        details.code === "MAX_LOGIN_RESPONSE_INVALID"
          ? "MAX login flow returned an unexpected payload."
          : "MAX transport did not return an auth token.",
      operatorHint:
        "MAX authorization did not return a usable account session. Start authorization again."
    });
  }

  const recovery = resolveMaxRecoverableState(input.method, details.code);

  if (isMaxRateLimitError(details.code)) {
    return failedResult({
      errorCode: "provider.temporary_failure",
      errorMessage: details.localizedMessage,
      operatorHint: maxRateLimitOperatorHint
    });
  }

  if (recovery.state === "phone_required") {
    return failedResult({
      errorCode: "provider.permanent_failure",
      errorMessage: details.localizedMessage,
      operatorHint:
        "MAX authorization expired or rejected the request. Start a new authorization challenge."
    });
  }

  return {
    status: "pending",
    challengeStatus:
      recovery.state === "code_required"
        ? "requires_code"
        : "requires_password",
    publicPayload: {
      ...(input.phoneMasked ? { phoneNumber: input.phoneMasked } : {})
    },
    secretPayload:
      recovery.state === "code_required"
        ? {
            deviceId: input.deviceId,
            phoneNumber: input.secretPayload.phoneNumber ?? null,
            maxAuthToken: input.secretPayload.maxAuthToken ?? null
          }
        : {
            deviceId: input.deviceId,
            phoneNumber: input.secretPayload.phoneNumber ?? null,
            maxAuthToken: input.secretPayload.maxAuthToken ?? null,
            passwordTrackId: input.secretPayload.passwordTrackId ?? null
          },
    operatorHint: maxOperatorHint(details.localizedMessage, recovery.state)
  };
}

function publicPayloadForSecret(
  secretPayload: MaxChallengeSecretPayload
): DirectAccountAuthPublicPayload {
  return {
    ...(secretPayload.phoneNumber
      ? { phoneNumber: maskMaxPhoneNumber(secretPayload.phoneNumber) }
      : {})
  };
}

function stripChallengeAnswer(
  secretPayload: MaxChallengeSecretPayload
): MaxChallengeSecretPayload {
  return {
    deviceId: secretPayload.deviceId,
    phoneNumber: secretPayload.phoneNumber ?? null,
    maxAuthToken: secretPayload.maxAuthToken ?? null,
    passwordTrackId: secretPayload.passwordTrackId ?? null
  };
}

function readPublicPhoneNumber(
  input: DirectAccountAuthHandlerInput
): string | undefined {
  const publicPayload = isRecord(input.challenge.publicPayload)
    ? input.challenge.publicPayload
    : {};

  return (
    readOptionalString(input.challengeSecretPayload.phoneNumber) ??
    readOptionalString(publicPayload.phoneNumber)
  );
}

function readErrorDetails(error: unknown): {
  code: string;
  message: string;
  localizedMessage: string;
} {
  if (error instanceof MaxSocketRequestError) {
    return {
      code: error.code,
      message: error.message,
      localizedMessage: error.localizedMessage
    };
  }

  if (error instanceof Error) {
    return {
      code: error.message,
      message: error.message,
      localizedMessage: error.message
    };
  }

  return {
    code: "unknown",
    message: String(error),
    localizedMessage: String(error)
  };
}

function isMaxRateLimitError(code: string): boolean {
  return code === "error.limit.violate";
}

function maxOperatorHint(
  message: string,
  state: "code_required" | "password_required"
): string {
  if (state === "code_required") {
    return `MAX did not accept the verification code. ${message}`;
  }

  return `MAX did not accept the two-step verification password. ${message}`;
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

function isRegisterTokenResponse(value: unknown): boolean {
  const record = isRecord(value) ? value : {};
  const tokenAttrs = isRecord(record.tokenAttrs) ? record.tokenAttrs : {};

  return isRecord(tokenAttrs.REGISTER);
}

function getLastLoginValue(resyncPayload: unknown): unknown {
  if (!isRecord(resyncPayload)) {
    return null;
  }

  return typeof resyncPayload.time === "bigint"
    ? resyncPayload.time.toString()
    : (resyncPayload.time ?? null);
}

function normalizeTimeoutMs(
  value: number | undefined,
  fallback: number
): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }

  return Math.max(5_000, Math.min(Math.trunc(value), 5 * 60_000));
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const maxDirectAuthHandlerTestUtils = {
  displayAddressForMaxUser,
  readErrorDetails
};
