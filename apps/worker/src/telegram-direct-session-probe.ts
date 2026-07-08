import type { TenantSecretCipher } from "@hulee/db";
import type { Logger } from "@hulee/observability";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import type {
  DirectAccountSessionProbeHandler,
  DirectAccountSessionProbeInput,
  DirectAccountSessionProbeResult
} from "./direct-account-session-monitor";
import {
  deserializeTelegramSessionPayload,
  displayAddressForTelegramUser,
  displayNameForTelegramUser,
  encryptTelegramSessionPayload,
  serializeTelegramUser,
  type TelegramSelfUser
} from "./telegram-direct-auth-handler";

const telegramQrBridgeChannelType = "telegram_qr_bridge";
const defaultTelegramConnectionRetries = 3;

export type TelegramSessionProbeClient = {
  readonly session: {
    save(): string;
  };
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getMe(): Promise<unknown>;
};

export type CreateTelegramSessionProbeClientInput = {
  sessionString: string;
  apiId: number;
  apiHash: string;
  connectionRetries: number;
};

export type TelegramDirectSessionProbeHandlerOptions = {
  apiId?: number;
  apiHash?: string;
  sessionCipher?: Pick<TenantSecretCipher, "encrypt" | "decrypt">;
  connectionRetries?: number;
  createTelegramClient?: (
    input: CreateTelegramSessionProbeClientInput
  ) => TelegramSessionProbeClient;
  logger?: Pick<Logger, "warn">;
};

export function createTelegramDirectSessionProbeHandler(
  options: TelegramDirectSessionProbeHandlerOptions
): DirectAccountSessionProbeHandler {
  const createTelegramClient =
    options.createTelegramClient ?? createDefaultTelegramSessionProbeClient;
  const connectionRetries = normalizeConnectionRetries(
    options.connectionRetries
  );

  return {
    name: "telegram-direct-session-probe",
    channelTypes: [telegramQrBridgeChannelType],

    async probe(
      input: DirectAccountSessionProbeInput
    ): Promise<DirectAccountSessionProbeResult> {
      const apiConfig = {
        apiId: options.apiId,
        apiHash: options.apiHash
      };

      if (!isTelegramApiConfigValid(apiConfig)) {
        return degradedResult({
          errorMessage: "Telegram user API id/hash are not configured.",
          operatorHint:
            "Configure HULEE_TELEGRAM_USER_API_ID and HULEE_TELEGRAM_USER_API_HASH in the provider worker deployment."
        });
      }

      if (!options.sessionCipher) {
        return degradedResult({
          errorMessage: "Session encryption is not configured.",
          operatorHint:
            "Configure HULEE_SECRET_ENCRYPTION_KEY before monitoring direct Telegram accounts."
        });
      }

      const sessionPayload = deserializeTelegramSessionPayload({
        cipher: options.sessionCipher,
        sessionEncrypted: input.session.sessionEncrypted
      });

      if (!sessionPayload) {
        return reauthRequiredResult(
          "Stored Telegram session is missing or unreadable."
        );
      }

      const client = createTelegramClient({
        sessionString: sessionPayload.sessionString,
        apiId: apiConfig.apiId,
        apiHash: apiConfig.apiHash,
        connectionRetries
      });

      try {
        await client.connect();
        const user = serializeTelegramUser(await client.getMe());
        const sessionString = client.session.save();

        if (!sessionString) {
          return reauthRequiredResult("Telegram session became empty.");
        }

        return healthyResult({
          cipher: options.sessionCipher,
          sessionString,
          user
        });
      } catch (error) {
        const message = errorMessage(error);
        options.logger?.warn("Telegram direct session probe failed.", {
          connectorId: input.connector.id,
          sessionId: input.session.id,
          error: message
        });

        if (isTelegramReauthError(message)) {
          return reauthRequiredResult(message);
        }

        return degradedResult({
          errorMessage: message,
          operatorHint:
            "Telegram session check failed temporarily. The worker will retry on the next monitor interval."
        });
      } finally {
        try {
          await client.disconnect();
        } catch {
          // Monitoring should not fail because the probe connection cleanup failed.
        }
      }
    }
  };
}

function createDefaultTelegramSessionProbeClient(
  input: CreateTelegramSessionProbeClientInput
): TelegramSessionProbeClient {
  return new TelegramClient(
    new StringSession(input.sessionString),
    input.apiId,
    input.apiHash,
    {
      connectionRetries: input.connectionRetries
    }
  ) as unknown as TelegramSessionProbeClient;
}

function healthyResult(input: {
  cipher: Pick<TenantSecretCipher, "encrypt">;
  sessionString: string;
  user: TelegramSelfUser;
}): DirectAccountSessionProbeResult {
  const displayAddress = displayAddressForTelegramUser(input.user);

  return {
    status: "healthy",
    sessionEncrypted: encryptTelegramSessionPayload({
      cipher: input.cipher,
      payload: {
        sessionString: input.sessionString,
        user: input.user,
        updatedAt: new Date().toISOString()
      }
    }),
    sessionFingerprint: input.user.id ? `telegram:${input.user.id}` : null,
    externalAccountId: input.user.id ?? null,
    displayAddress: displayAddress ?? null,
    connectorDisplayName: displayNameForTelegramUser(input.user),
    publicState: {
      stage: "connected",
      user: input.user
    },
    metadata: {
      provider: "telegram",
      authMode: "qr"
    },
    diagnostics: {
      sessionProbe: {
        provider: "telegram"
      }
    }
  };
}

function degradedResult(input: {
  errorMessage: string;
  operatorHint: string;
}): DirectAccountSessionProbeResult {
  return {
    status: "degraded",
    errorCode: "provider.temporary_failure",
    errorMessage: input.errorMessage,
    operatorHint: input.operatorHint
  };
}

function reauthRequiredResult(
  errorMessage: string
): DirectAccountSessionProbeResult {
  return {
    status: "reauth_required",
    errorCode: "provider.permanent_failure",
    errorMessage,
    operatorHint:
      "Telegram session is no longer authorized. Start a new QR login challenge."
  };
}

function isTelegramApiConfigValid(input: {
  apiId?: number;
  apiHash?: string;
}): input is { apiId: number; apiHash: string } {
  return (
    typeof input.apiId === "number" &&
    Number.isInteger(input.apiId) &&
    input.apiId > 0 &&
    typeof input.apiHash === "string" &&
    input.apiHash.trim().length > 0
  );
}

function isTelegramReauthError(message: string): boolean {
  const normalized = message.toUpperCase();

  return (
    normalized.includes("AUTH_KEY_UNREGISTERED") ||
    normalized.includes("AUTH_KEY_INVALID") ||
    normalized.includes("SESSION_REVOKED") ||
    normalized.includes("USER_DEACTIVATED") ||
    normalized.includes("UNAUTHORIZED") ||
    normalized.includes("401")
  );
}

function normalizeConnectionRetries(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return defaultTelegramConnectionRetries;
  }

  return Math.max(0, Math.min(Math.trunc(value), 10));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
