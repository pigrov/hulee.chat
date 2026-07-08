import type { TenantSecretCipher } from "@hulee/db";
import type { Logger } from "@hulee/observability";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type ConnectionState,
  type WASocket
} from "baileys";

import type {
  DirectAccountSessionProbeHandler,
  DirectAccountSessionProbeInput,
  DirectAccountSessionProbeResult
} from "./direct-account-session-monitor";
import {
  buildWhatsAppSelfUser,
  createWhatsAppSessionState,
  deserializeWhatsAppSessionPayload,
  displayAddressForWhatsAppUser,
  displayNameForWhatsAppUser,
  encryptWhatsAppSessionPayload,
  getWhatsAppDisconnectCode,
  getWhatsAppDisconnectMessage,
  readWhatsAppSelfUser,
  type WhatsAppDirectSessionPayload,
  type WhatsAppDirectSessionState,
  type WhatsAppSelfUser
} from "./whatsapp-direct-auth-handler";

const whatsappQrBridgeChannelType = "whatsapp_qr_bridge";
const defaultWhatsAppProbeTimeoutMs = 30_000;

export type WhatsAppSessionProbeConnectionInput = {
  sessionId: string;
  sessionState: WhatsAppDirectSessionState;
  timeoutMs: number;
};

export type WhatsAppSessionProbeConnectionResult =
  | {
      status: "healthy";
      user?: WhatsAppSelfUser;
    }
  | {
      status: "degraded";
      errorMessage: string;
    }
  | {
      status: "reauth_required";
      errorMessage: string;
    };

export type WhatsAppDirectSessionProbeHandlerOptions = {
  sessionCipher?: Pick<TenantSecretCipher, "encrypt" | "decrypt">;
  probeTimeoutMs?: number;
  connectWhatsAppSessionProbe?: (
    input: WhatsAppSessionProbeConnectionInput
  ) => Promise<WhatsAppSessionProbeConnectionResult>;
  fetchLatestVersion?: typeof fetchLatestBaileysVersion;
  makeWASocket?: typeof makeWASocket;
  logger?: Pick<Logger, "warn">;
};

export function createWhatsAppDirectSessionProbeHandler(
  options: WhatsAppDirectSessionProbeHandlerOptions
): DirectAccountSessionProbeHandler {
  const timeoutMs = normalizeTimeoutMs(options.probeTimeoutMs);
  const connectWhatsAppSessionProbe =
    options.connectWhatsAppSessionProbe ??
    createDefaultWhatsAppSessionProbe({
      fetchLatestVersion: options.fetchLatestVersion,
      makeSocket: options.makeWASocket,
      logger: options.logger
    });

  return {
    name: "whatsapp-direct-session-probe",
    channelTypes: [whatsappQrBridgeChannelType],

    async probe(
      input: DirectAccountSessionProbeInput
    ): Promise<DirectAccountSessionProbeResult> {
      if (!options.sessionCipher) {
        return degradedResult({
          errorMessage: "Session encryption is not configured.",
          operatorHint:
            "Configure HULEE_SECRET_ENCRYPTION_KEY before monitoring direct WhatsApp accounts."
        });
      }

      const sessionPayload = deserializeWhatsAppSessionPayload({
        cipher: options.sessionCipher,
        sessionEncrypted: input.session.sessionEncrypted
      });

      if (!sessionPayload) {
        return reauthRequiredResult(
          "Stored WhatsApp session is missing or unreadable."
        );
      }

      const sessionState = createWhatsAppSessionState({
        initialSessionPayload: sessionPayload
      });
      const probeResult = await connectWhatsAppSessionProbe({
        sessionId: input.session.id,
        sessionState,
        timeoutMs
      });

      if (probeResult.status === "degraded") {
        return degradedResult({
          errorMessage: probeResult.errorMessage,
          operatorHint:
            "WhatsApp session check failed temporarily. The worker will retry on the next monitor interval."
        });
      }

      if (probeResult.status === "reauth_required") {
        return reauthRequiredResult(probeResult.errorMessage);
      }

      const snapshot = sessionState.snapshot();
      const snapshotUser = buildWhatsAppSelfUser(snapshot);
      const user = {
        id: probeResult.user?.id ?? snapshotUser.id,
        name: probeResult.user?.name ?? snapshotUser.name
      };

      return healthyResult({
        cipher: options.sessionCipher,
        snapshot,
        user
      });
    }
  };
}

function createDefaultWhatsAppSessionProbe(input: {
  fetchLatestVersion?: typeof fetchLatestBaileysVersion;
  makeSocket?: typeof makeWASocket;
  logger?: Pick<Logger, "warn">;
}) {
  const fetchLatestVersion =
    input.fetchLatestVersion ?? fetchLatestBaileysVersion;
  const makeSocket = input.makeSocket ?? makeWASocket;
  const browser = Browsers?.macOS
    ? Browsers.macOS("Chrome")
    : (["Chrome", "Desktop", "1.0"] as [string, string, string]);

  return async function connectWhatsAppSessionProbe(
    options: WhatsAppSessionProbeConnectionInput
  ): Promise<WhatsAppSessionProbeConnectionResult> {
    let socket: WASocket | undefined;

    try {
      const versionResult = await fetchLatestVersion();
      const version = isValidWhatsAppVersion(versionResult?.version)
        ? versionResult.version
        : undefined;

      socket = makeSocket({
        auth: options.sessionState.state,
        browser,
        ...(version ? { version } : {}),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        getMessage: async () => undefined
      });

      socket.ev.on("creds.update", (update) => {
        options.sessionState.saveCreds(update).catch((error: unknown) => {
          input.logger?.warn("WhatsApp probe credentials persist failed.", {
            sessionId: options.sessionId,
            error: errorMessage(error)
          });
        });
      });

      return await waitForWhatsAppProbeResult({
        socket,
        timeoutMs: options.timeoutMs
      });
    } catch (error) {
      return {
        status: "degraded",
        errorMessage: errorMessage(error)
      };
    } finally {
      try {
        socket?.end?.(new Error("WHATSAPP_SESSION_PROBE_FINISHED"));
      } catch {
        // The monitor only needs a short-lived session probe.
      }
    }
  };
}

async function waitForWhatsAppProbeResult(input: {
  socket: WASocket;
  timeoutMs: number;
}): Promise<WhatsAppSessionProbeConnectionResult> {
  return await new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish({
        status: "degraded",
        errorMessage: "WHATSAPP_SESSION_PROBE_TIMEOUT"
      });
    }, input.timeoutMs);

    function finish(result: WhatsAppSessionProbeConnectionResult): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      input.socket.ev.off("connection.update", onConnectionUpdate);
      resolve(result);
    }

    function onConnectionUpdate(update: Partial<ConnectionState>): void {
      if (update.qr) {
        finish({
          status: "reauth_required",
          errorMessage: "WhatsApp requested a new QR login."
        });
        return;
      }

      if (update.connection === "open") {
        finish({
          status: "healthy",
          user: readWhatsAppSelfUser(input.socket.user)
        });
        return;
      }

      if (update.connection === "close") {
        const code = getWhatsAppDisconnectCode(update.lastDisconnect);
        const message = getWhatsAppDisconnectMessage(update.lastDisconnect);

        finish({
          status: isWhatsAppReauthDisconnectCode(code)
            ? "reauth_required"
            : "degraded",
          errorMessage: message
        });
      }
    }

    input.socket.ev.on("connection.update", onConnectionUpdate);
  });
}

function healthyResult(input: {
  cipher: Pick<TenantSecretCipher, "encrypt">;
  snapshot: WhatsAppDirectSessionPayload;
  user: WhatsAppSelfUser;
}): DirectAccountSessionProbeResult {
  const completedAt = new Date().toISOString();
  const displayAddress = displayAddressForWhatsAppUser(input.user);

  return {
    status: "healthy",
    sessionEncrypted: encryptWhatsAppSessionPayload({
      cipher: input.cipher,
      payload: {
        ...input.snapshot,
        user: input.user,
        updatedAt: completedAt
      }
    }),
    sessionFingerprint: input.user.id ? `whatsapp:${input.user.id}` : null,
    externalAccountId: input.user.id ?? null,
    displayAddress: displayAddress ?? null,
    connectorDisplayName: displayNameForWhatsAppUser(input.user),
    publicState: {
      stage: "connected",
      user: input.user
    },
    metadata: {
      provider: "whatsapp",
      authMode: "qr"
    },
    diagnostics: {
      sessionProbe: {
        provider: "whatsapp"
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
      "WhatsApp session is no longer authorized. Start a new QR login challenge."
  };
}

function isWhatsAppReauthDisconnectCode(code: number | null): boolean {
  return (
    code === DisconnectReason.badSession ||
    code === DisconnectReason.loggedOut ||
    code === DisconnectReason.connectionReplaced ||
    code === DisconnectReason.multideviceMismatch
  );
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return defaultWhatsAppProbeTimeoutMs;
  }

  return Math.max(10_000, Math.min(Math.trunc(value), 120_000));
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
