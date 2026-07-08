import type { TenantSecretCipher } from "@hulee/db";
import type { Logger } from "@hulee/observability";

import type {
  DirectAccountSessionProbeHandler,
  DirectAccountSessionProbeInput,
  DirectAccountSessionProbeResult
} from "./direct-account-session-monitor";
import {
  createMaxAuthTransportClientFactory,
  MaxSocketRequestError,
  type MaxAuthTransportClient,
  type MaxAuthTransportClientFactoryInput
} from "./max-direct-transport-client";
import {
  buildNextMaxSyncState,
  createMaxSessionHelpers,
  deserializeMaxSessionPayload,
  displayAddressForMaxUser,
  displayNameForMaxUser,
  encryptMaxSessionPayload
} from "./max-direct-session";

const maxQrBridgeChannelType = "max_qr_bridge";
const defaultMaxProbeTimeoutMs = 30_000;
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
const defaultMaxAllowedEarlyOpcodes = [5, 6, 19, 23] as const;

export type MaxDirectSessionProbeHandlerOptions = {
  sessionCipher?: Pick<TenantSecretCipher, "encrypt" | "decrypt">;
  probeTimeoutMs?: number;
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
  ) => Pick<MaxAuthTransportClient, "cmd" | "connect" | "close">;
  createDeviceId?: () => string;
  logger?: Pick<Logger, "warn">;
};

export function createMaxDirectSessionProbeHandler(
  options: MaxDirectSessionProbeHandlerOptions
): DirectAccountSessionProbeHandler {
  const probeTimeoutMs = normalizeTimeoutMs(
    options.probeTimeoutMs,
    defaultMaxProbeTimeoutMs
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
      authTimeoutMs: probeTimeoutMs,
      buildMaxHandshakePayload: sessionHelpers.buildMaxHandshakePayload,
      createDeviceId: options.createDeviceId,
      defaultLocale,
      protocolVersion: options.protocolVersion,
      socketHost,
      socketPort
    });

  return {
    name: "max-direct-session-probe",
    channelTypes: [maxQrBridgeChannelType],

    async probe(
      input: DirectAccountSessionProbeInput
    ): Promise<DirectAccountSessionProbeResult> {
      if (!options.sessionCipher) {
        return degradedResult({
          errorMessage: "Session encryption is not configured.",
          operatorHint:
            "Configure HULEE_SECRET_ENCRYPTION_KEY before monitoring direct MAX accounts."
        });
      }

      const sessionPayload = deserializeMaxSessionPayload({
        cipher: options.sessionCipher,
        sessionEncrypted: input.session.sessionEncrypted
      });

      if (!sessionPayload) {
        return reauthRequiredResult(
          "Stored MAX session is missing or unreadable."
        );
      }

      const client = createTransportClient({
        deviceId: sessionHelpers.getMaxSessionDeviceId(sessionPayload),
        locale: sessionHelpers.getMaxSessionLocale(sessionPayload)
      });

      try {
        await client.connect();

        const resyncPayload = await client.cmd(
          19,
          sessionHelpers.buildMaxResyncPayload({
            token: sessionPayload.auth.token,
            locale: sessionPayload.locale,
            sync: sessionPayload.sync
          }),
          {
            timeoutMs: probeTimeoutMs
          }
        );
        const nextSync = buildNextMaxSyncState(
          sessionPayload.sync,
          resyncPayload
        );
        const user = sessionPayload.profile ?? {};
        const externalAccountId = user.id ?? sessionPayload.auth.viewerId;
        const displayAddress = displayAddressForMaxUser(user);
        const updatedAt = input.now.toISOString();

        return {
          status: "healthy",
          sessionEncrypted: encryptMaxSessionPayload({
            cipher: options.sessionCipher,
            payload: {
              ...sessionPayload,
              sync: nextSync,
              connectedAt: sessionPayload.connectedAt ?? updatedAt
            }
          }),
          sessionFingerprint: `max:${externalAccountId}`,
          externalAccountId,
          displayAddress: displayAddress ?? null,
          connectorDisplayName: displayNameForMaxUser(user),
          publicState: {
            stage: "connected",
            user
          },
          metadata: {
            provider: "max",
            authMode: "phone_code"
          },
          diagnostics: {
            sessionProbe: {
              provider: "max"
            }
          }
        };
      } catch (error) {
        const message = errorMessage(error);
        options.logger?.warn("MAX direct session probe failed.", {
          connectorId: input.connector.id,
          sessionId: input.session.id,
          error: message
        });

        if (isMaxReauthError(error)) {
          return reauthRequiredResult(message);
        }

        return degradedResult({
          errorMessage: message,
          operatorHint:
            "MAX session check failed temporarily. The worker will retry on the next monitor interval."
        });
      } finally {
        await client.close();
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
      "MAX session is no longer authorized. Start a new phone authorization challenge."
  };
}

function isMaxReauthError(error: unknown): boolean {
  if (error instanceof MaxSocketRequestError) {
    return [
      "auth.token.invalid",
      "auth.token.expired",
      "auth.required",
      "unauthorized"
    ].includes(error.code);
  }

  const normalized = errorMessage(error).toLowerCase();

  return (
    normalized.includes("auth_required") ||
    normalized.includes("unauthorized") ||
    normalized.includes("auth.token.invalid") ||
    normalized.includes("auth.token.expired") ||
    normalized.includes("401")
  );
}

function normalizeTimeoutMs(
  value: number | undefined,
  fallback: number
): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }

  return Math.max(5_000, Math.min(Math.trunc(value), 120_000));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
