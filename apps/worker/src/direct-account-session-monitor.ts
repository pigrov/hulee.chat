import type {
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  ChannelSessionRecord,
  ChannelSessionRepository
} from "@hulee/db";
import type {
  ChannelConnectorHealthStatus,
  ChannelConnectorStatus,
  PlatformErrorCode
} from "@hulee/contracts";
import { randomUUID } from "node:crypto";

const defaultMonitorIntervalMs = 10 * 60_000;
const defaultLeaseMs = 2 * 60_000;
const defaultBatchSize = 50;
const defaultProcessingConcurrency = 4;
const directAccountChannelTypes = new Set([
  "telegram_qr_bridge",
  "whatsapp_qr_bridge",
  "max_qr_bridge"
]);

export type DirectAccountSessionProbeInput = {
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  now: Date;
};

export type DirectAccountSessionProbeResult =
  | {
      status: "healthy";
      sessionEncrypted?: string;
      sessionFingerprint?: string | null;
      externalAccountId?: string | null;
      displayAddress?: string | null;
      publicState?: unknown;
      metadata?: unknown;
      connectorDisplayName?: string;
      connectorConfig?: Record<string, unknown>;
      diagnostics?: Record<string, unknown>;
      operatorHint?: string;
    }
  | {
      status: "degraded";
      errorCode?: PlatformErrorCode;
      errorMessage: string;
      diagnostics?: Record<string, unknown>;
      operatorHint?: string;
    }
  | {
      status: "reauth_required";
      errorCode?: PlatformErrorCode;
      errorMessage: string;
      diagnostics?: Record<string, unknown>;
      operatorHint?: string;
    };

export type DirectAccountSessionProbeHandler = {
  name: string;
  channelTypes: readonly string[];
  probe(
    input: DirectAccountSessionProbeInput
  ): Promise<DirectAccountSessionProbeResult>;
};

export type DirectAccountSessionMonitorOptions = {
  sessionRepository: ChannelSessionRepository;
  connectorRepository: ChannelConnectorRepository;
  handlers: readonly DirectAccountSessionProbeHandler[];
  workerId?: string;
  now?: Date;
  limit?: number;
  leaseMs?: number;
  monitorIntervalMs?: number;
  processingConcurrency?: number;
};

export type DirectAccountSessionMonitorResult = {
  scanned: number;
  claimed: number;
  checked: number;
  healthy: number;
  degraded: number;
  reauthRequired: number;
  skippedLeased: number;
  skippedUnsupported: number;
  skippedInactive: number;
};

export type DirectAccountSessionMonitor = {
  sweep(): Promise<DirectAccountSessionMonitorResult>;
};

export function createDirectAccountSessionMonitor(
  options: Omit<DirectAccountSessionMonitorOptions, "now">
): DirectAccountSessionMonitor {
  return {
    sweep() {
      return runDirectAccountSessionMonitor({
        ...options,
        now: new Date()
      });
    }
  };
}

export async function runDirectAccountSessionMonitor(
  options: DirectAccountSessionMonitorOptions
): Promise<DirectAccountSessionMonitorResult> {
  const now = options.now ?? new Date();
  const intervalMs = normalizeIntervalMs(options.monitorIntervalMs);
  const sessions = await options.sessionRepository.listRunnableSessions({
    status: "connected",
    heartbeatBefore: new Date(now.getTime() - intervalMs),
    limit: options.limit ?? defaultBatchSize
  });
  const result: DirectAccountSessionMonitorResult = {
    scanned: sessions.length,
    claimed: 0,
    checked: 0,
    healthy: 0,
    degraded: 0,
    reauthRequired: 0,
    skippedLeased: 0,
    skippedUnsupported: 0,
    skippedInactive: 0
  };

  await processSessionsWithConcurrency(
    sessions,
    normalizeProcessingConcurrency(options.processingConcurrency),
    (session) =>
      processSession({
        options,
        result,
        session,
        now
      })
  );

  return result;
}

async function processSession(input: {
  options: DirectAccountSessionMonitorOptions;
  result: DirectAccountSessionMonitorResult;
  session: ChannelSessionRecord;
  now: Date;
}): Promise<void> {
  const claimedSession =
    await input.options.sessionRepository.claimSessionLease({
      tenantId: input.session.tenantId,
      sessionId: input.session.id,
      leaseOwner: input.options.workerId ?? "direct-account-session-monitor",
      leaseExpiresAt: new Date(
        input.now.getTime() + (input.options.leaseMs ?? defaultLeaseMs)
      ),
      now: input.now
    });

  if (!claimedSession) {
    input.result.skippedLeased += 1;
    return;
  }

  input.result.claimed += 1;

  try {
    const connector = await input.options.connectorRepository.findConnector({
      tenantId: claimedSession.tenantId,
      connectorId: claimedSession.connectorId
    });

    if (!isMonitorableDirectAccountConnector(connector)) {
      input.result.skippedInactive += 1;
      return;
    }

    const handler = findHandler({
      handlers: input.options.handlers,
      connector
    });

    if (!handler) {
      input.result.skippedUnsupported += 1;
      await appendMonitorSessionEvent({
        options: input.options,
        connector,
        session: claimedSession,
        now: input.now,
        eventType: "session.monitor_handler_missing",
        severity: "warning",
        code: "provider.temporary_failure",
        message: "No direct account session monitor handler is registered.",
        metadata: {
          channelType: connector.channelType
        }
      });
      return;
    }

    const probeResult = await runProbeSafely({
      handler,
      connector,
      session: claimedSession,
      now: input.now
    });

    input.result.checked += 1;
    await persistProbeResult({
      ...input,
      connector,
      session: claimedSession,
      probeResult
    });
  } finally {
    await input.options.sessionRepository.releaseSessionLease({
      tenantId: claimedSession.tenantId,
      sessionId: claimedSession.id,
      leaseOwner: input.options.workerId ?? "direct-account-session-monitor",
      updatedAt: input.now
    });
  }
}

async function runProbeSafely(input: {
  handler: DirectAccountSessionProbeHandler;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  now: Date;
}): Promise<DirectAccountSessionProbeResult> {
  try {
    return await input.handler.probe({
      connector: input.connector,
      session: input.session,
      now: input.now
    });
  } catch (error) {
    return {
      status: "degraded",
      errorCode: "provider.temporary_failure",
      errorMessage: errorMessage(error),
      operatorHint:
        "Direct account session probe failed. The worker will retry on the next monitor interval."
    };
  }
}

async function persistProbeResult(input: {
  options: DirectAccountSessionMonitorOptions;
  result: DirectAccountSessionMonitorResult;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  probeResult: DirectAccountSessionProbeResult;
  now: Date;
}): Promise<void> {
  const probeResult = input.probeResult;

  switch (probeResult.status) {
    case "healthy":
      await markSessionHealthy({
        options: input.options,
        connector: input.connector,
        session: input.session,
        probeResult,
        now: input.now
      });
      input.result.healthy += 1;
      return;
    case "degraded":
      await markSessionDegraded({
        options: input.options,
        connector: input.connector,
        session: input.session,
        probeResult,
        now: input.now
      });
      input.result.degraded += 1;
      return;
    case "reauth_required":
      await markSessionReauthRequired({
        options: input.options,
        connector: input.connector,
        session: input.session,
        probeResult,
        now: input.now
      });
      input.result.reauthRequired += 1;
      return;
  }
}

async function markSessionHealthy(input: {
  options: DirectAccountSessionMonitorOptions;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  probeResult: Extract<DirectAccountSessionProbeResult, { status: "healthy" }>;
  now: Date;
}): Promise<void> {
  const identityMismatch = detectExternalAccountMismatch({
    session: input.session,
    nextExternalAccountId: input.probeResult.externalAccountId
  });

  if (identityMismatch) {
    await markSessionReauthRequired({
      ...input,
      probeResult: {
        status: "reauth_required",
        errorCode: "provider.permanent_failure",
        errorMessage:
          "Connected account identity changed. Start a new QR login challenge before routing messages through this channel.",
        operatorHint:
          "The stored direct-account session resolved to a different provider account than the channel was bound to."
      }
    });
    return;
  }

  const displayAddress =
    input.probeResult.displayAddress ?? input.session.displayAddress;
  const externalAccountId =
    input.probeResult.externalAccountId ?? input.session.externalAccountId;

  await input.options.sessionRepository.upsertSession({
    ...sessionPersistenceInput(input.session),
    status: "connected",
    ...(input.probeResult.sessionEncrypted
      ? { sessionEncrypted: input.probeResult.sessionEncrypted }
      : {}),
    sessionFingerprint:
      input.probeResult.sessionFingerprint ?? input.session.sessionFingerprint,
    externalAccountId,
    displayAddress,
    publicState:
      input.probeResult.publicState ??
      mergeRecord(input.session.publicState, {
        stage: "connected"
      }),
    metadata: mergeRecord(input.session.metadata, input.probeResult.metadata),
    lastHeartbeatAt: input.now,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    updatedAt: input.now
  });
  await input.options.connectorRepository.upsertConnector({
    ...connectorPersistenceInput(input.connector),
    displayName:
      input.probeResult.connectorDisplayName ?? input.connector.displayName,
    status: "connected",
    healthStatus: "healthy",
    config: mergeRecord(input.connector.config, {
      ...(input.probeResult.connectorConfig ?? {}),
      ...(externalAccountId ? { channelExternalId: externalAccountId } : {})
    }),
    diagnostics: buildMonitorDiagnostics({
      connector: input.connector,
      session: input.session,
      status: "connected",
      probeStatus: "healthy",
      checkedAt: input.now,
      displayAddress,
      operatorHint: input.probeResult.operatorHint,
      extraDiagnostics: input.probeResult.diagnostics
    }),
    updatedAt: input.now
  });
  await appendMonitorSessionEvent({
    options: input.options,
    connector: input.connector,
    session: input.session,
    now: input.now,
    eventType: "session.monitor_healthy",
    severity: "info",
    metadata: {
      externalAccountId: externalAccountId ?? null
    }
  });
}

async function markSessionDegraded(input: {
  options: DirectAccountSessionMonitorOptions;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  probeResult: Extract<DirectAccountSessionProbeResult, { status: "degraded" }>;
  now: Date;
}): Promise<void> {
  await input.options.sessionRepository.upsertSession({
    ...sessionPersistenceInput(input.session),
    status: "connected",
    lastHeartbeatAt: input.now,
    lastErrorAt: input.now,
    lastErrorCode: input.probeResult.errorCode ?? "provider.temporary_failure",
    lastErrorMessage: input.probeResult.errorMessage,
    updatedAt: input.now
  });
  await input.options.connectorRepository.upsertConnector({
    ...connectorPersistenceInput(input.connector),
    status: "degraded",
    healthStatus: "degraded",
    diagnostics: buildMonitorDiagnostics({
      connector: input.connector,
      session: input.session,
      status: "degraded",
      probeStatus: "degraded",
      checkedAt: input.now,
      errorCode: input.probeResult.errorCode ?? "provider.temporary_failure",
      errorMessage: input.probeResult.errorMessage,
      operatorHint: input.probeResult.operatorHint,
      extraDiagnostics: input.probeResult.diagnostics
    }),
    updatedAt: input.now
  });
  await appendMonitorSessionEvent({
    options: input.options,
    connector: input.connector,
    session: input.session,
    now: input.now,
    eventType: "session.monitor_degraded",
    severity: "warning",
    code: input.probeResult.errorCode ?? "provider.temporary_failure",
    message: input.probeResult.errorMessage
  });
}

async function markSessionReauthRequired(input: {
  options: DirectAccountSessionMonitorOptions;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  probeResult: Extract<
    DirectAccountSessionProbeResult,
    { status: "reauth_required" }
  >;
  now: Date;
}): Promise<void> {
  await input.options.sessionRepository.upsertSession({
    ...sessionPersistenceInput(input.session),
    status: "disconnected",
    publicState: mergeRecord(input.session.publicState, {
      stage: "reauth_required"
    }),
    lastDisconnectedAt: input.now,
    lastHeartbeatAt: input.now,
    lastErrorAt: input.now,
    lastErrorCode: input.probeResult.errorCode ?? "provider.permanent_failure",
    lastErrorMessage: input.probeResult.errorMessage,
    updatedAt: input.now
  });
  await input.options.connectorRepository.upsertConnector({
    ...connectorPersistenceInput(input.connector),
    status: "reauth_required",
    healthStatus: "unhealthy",
    diagnostics: buildMonitorDiagnostics({
      connector: input.connector,
      session: input.session,
      status: "reauth_required",
      probeStatus: "reauth_required",
      checkedAt: input.now,
      errorCode: input.probeResult.errorCode ?? "provider.permanent_failure",
      errorMessage: input.probeResult.errorMessage,
      operatorHint: input.probeResult.operatorHint,
      extraDiagnostics: input.probeResult.diagnostics
    }),
    updatedAt: input.now
  });
  await appendMonitorSessionEvent({
    options: input.options,
    connector: input.connector,
    session: input.session,
    now: input.now,
    eventType: "session.reauth_required",
    severity: "error",
    code: input.probeResult.errorCode ?? "provider.permanent_failure",
    message: input.probeResult.errorMessage
  });
}

function buildMonitorDiagnostics(input: {
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  status: string;
  probeStatus: DirectAccountSessionProbeResult["status"];
  checkedAt: Date;
  displayAddress?: string | null;
  errorCode?: string;
  errorMessage?: string;
  operatorHint?: string;
  extraDiagnostics?: Record<string, unknown>;
}): unknown {
  const checkedAt = input.checkedAt.toISOString();

  return mergeRecord(input.connector.diagnostics, {
    ...(input.extraDiagnostics ?? {}),
    status: input.status,
    checkedAt,
    monitor: {
      status: input.probeStatus,
      checkedAt,
      intervalMs: defaultMonitorIntervalMs,
      ...(input.operatorHint ? { operatorHint: input.operatorHint } : {})
    },
    session: {
      sessionKey: input.session.sessionKey,
      status:
        input.probeStatus === "reauth_required"
          ? "disconnected"
          : input.session.status,
      lastHeartbeatAt: checkedAt,
      ...(input.displayAddress ? { displayAddress: input.displayAddress } : {})
    },
    lastErrorCode: input.errorCode ?? null,
    lastErrorMessage: input.errorMessage ?? null
  });
}

function detectExternalAccountMismatch(input: {
  session: ChannelSessionRecord;
  nextExternalAccountId?: string | null;
}): boolean {
  return Boolean(
    input.session.externalAccountId &&
    input.nextExternalAccountId &&
    input.session.externalAccountId !== input.nextExternalAccountId
  );
}

function findHandler(input: {
  handlers: readonly DirectAccountSessionProbeHandler[];
  connector: ChannelConnectorRecord;
}): DirectAccountSessionProbeHandler | undefined {
  return input.handlers.find((handler) =>
    handler.channelTypes.includes(input.connector.channelType)
  );
}

function isMonitorableDirectAccountConnector(
  connector: ChannelConnectorRecord | null
): connector is ChannelConnectorRecord {
  return Boolean(
    connector &&
    connector.channelClass === "user_bridge" &&
    directAccountChannelTypes.has(connector.channelType) &&
    (connector.status === "connected" || connector.status === "degraded")
  );
}

function sessionPersistenceInput(session: ChannelSessionRecord) {
  return {
    id: session.id,
    tenantId: session.tenantId,
    connectorId: session.connectorId,
    sessionKey: session.sessionKey,
    status: session.status,
    sessionEncrypted: session.sessionEncrypted,
    sessionFingerprint: session.sessionFingerprint,
    externalAccountId: session.externalAccountId,
    displayAddress: session.displayAddress,
    publicState: session.publicState,
    metadata: session.metadata,
    challengeType: session.challengeType,
    challengeExpiresAt: session.challengeExpiresAt,
    leaseOwner: session.leaseOwner,
    leaseExpiresAt: session.leaseExpiresAt,
    lastConnectedAt: session.lastConnectedAt,
    lastDisconnectedAt: session.lastDisconnectedAt,
    lastHeartbeatAt: session.lastHeartbeatAt,
    lastInboundAt: session.lastInboundAt,
    lastOutboundAt: session.lastOutboundAt,
    lastErrorAt: session.lastErrorAt,
    lastErrorCode: session.lastErrorCode,
    lastErrorMessage: session.lastErrorMessage
  };
}

function connectorPersistenceInput(connector: ChannelConnectorRecord) {
  return {
    id: connector.id,
    tenantId: connector.tenantId,
    channelType: connector.channelType,
    channelClass: connector.channelClass,
    provider: connector.provider,
    displayName: connector.displayName,
    status: connector.status as ChannelConnectorStatus,
    healthStatus: connector.healthStatus as ChannelConnectorHealthStatus,
    capabilities: connector.capabilities,
    onboardingState: connector.onboardingState,
    config: connector.config,
    diagnostics: connector.diagnostics,
    createdByEmployeeId: connector.createdByEmployeeId
  };
}

async function appendMonitorSessionEvent(input: {
  options: DirectAccountSessionMonitorOptions;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  now: Date;
  eventType: string;
  severity?: "info" | "warning" | "error";
  code?: string;
  message?: string;
  metadata?: unknown;
}): Promise<void> {
  await input.options.sessionRepository.appendSessionEvent({
    id: `channel_session_event:${randomUUID()}`,
    tenantId: input.session.tenantId,
    connectorId: input.connector.id,
    sessionId: input.session.id,
    eventType: input.eventType,
    severity: input.severity ?? "info",
    code: input.code ?? null,
    message: input.message ?? null,
    metadata: input.metadata ?? {},
    occurredAt: input.now,
    updatedAt: input.now
  });
}

async function processSessionsWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  processor: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        await processor(items[currentIndex]);
      }
    })
  );
}

function normalizeProcessingConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return defaultProcessingConcurrency;
  }

  return Math.max(1, Math.min(Math.trunc(value), 20));
}

function normalizeIntervalMs(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return defaultMonitorIntervalMs;
  }

  return Math.max(60_000, Math.min(Math.trunc(value), 60 * 60_000));
}

function mergeRecord(base: unknown, patch: unknown): Record<string, unknown> {
  return {
    ...(isRecord(base) ? base : {}),
    ...(isRecord(patch) ? patch : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
