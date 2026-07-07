import type {
  ChannelAuthChallengeRecord,
  ChannelAuthChallengeRepository,
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  ChannelSessionRecord,
  ChannelSessionRepository,
  TenantSecretCipher
} from "@hulee/db";
import type {
  ChannelConnectorHealthStatus,
  ChannelConnectorStatus,
  InternalChannelAuthChallengeStatus,
  InternalChannelAuthChallengeType,
  PlatformErrorCode
} from "@hulee/contracts";
import { randomUUID } from "node:crypto";

const primarySessionKey = "primary";
const defaultLeaseMs = 5 * 60_000;
const defaultBatchSize = 50;
const defaultProcessingConcurrency = 4;
const directAccountChannelTypes = new Set([
  "telegram_qr_bridge",
  "whatsapp_qr_bridge",
  "max_qr_bridge"
]);
const terminalChallengeStatuses = new Set([
  "succeeded",
  "failed",
  "expired",
  "cancelled"
]);

export type DirectAccountAuthPublicPayload = {
  qrImageDataUrl?: string;
  qrPayloadRef?: string;
  phoneNumber?: string;
  expiresAt?: string;
  operatorHint?: string;
};

export type DirectAccountAuthChallengePatch = {
  status?: InternalChannelAuthChallengeStatus;
  publicPayload?: DirectAccountAuthPublicPayload;
  secretPayload?: Record<string, unknown>;
  secretPayloadEncrypted?: string | null;
  errorCode?: PlatformErrorCode | null;
  errorMessage?: string | null;
  expiresAt?: Date | null;
  completedAt?: Date | null;
};

export type DirectAccountAuthHandlerInput = {
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  challenge: ChannelAuthChallengeRecord;
  challengeSecretPayload: Record<string, unknown>;
  now: Date;
  loadLatestChallenge(): Promise<{
    challenge: ChannelAuthChallengeRecord;
    challengeSecretPayload: Record<string, unknown>;
  } | null>;
  updateChallenge(patch: DirectAccountAuthChallengePatch): Promise<void>;
  encryptSecretPayload(payload: Record<string, unknown>): string | null;
};

export type DirectAccountAuthHandlerResult =
  | {
      status: "pending";
      challengeStatus?: InternalChannelAuthChallengeStatus;
      publicPayload?: DirectAccountAuthPublicPayload;
      secretPayload?: Record<string, unknown>;
      expiresAt?: Date | null;
      operatorHint?: string;
    }
  | {
      status: "completed";
      sessionEncrypted: string;
      sessionFingerprint?: string | null;
      externalAccountId?: string | null;
      displayAddress?: string | null;
      publicState?: unknown;
      metadata?: unknown;
      connectorDisplayName?: string;
      connectorConfig?: Record<string, unknown>;
      diagnostics?: Record<string, unknown>;
    }
  | {
      status: "failed";
      errorCode?: PlatformErrorCode;
      errorMessage: string;
      publicPayload?: DirectAccountAuthPublicPayload;
      retryable?: boolean;
    };

export type DirectAccountAuthHandler = {
  name: string;
  channelTypes: readonly string[];
  challengeTypes: readonly (InternalChannelAuthChallengeType | string)[];
  run(
    input: DirectAccountAuthHandlerInput
  ): Promise<DirectAccountAuthHandlerResult>;
};

export type DirectAccountAuthSweepOptions = {
  authChallengeRepository: ChannelAuthChallengeRepository;
  sessionRepository: ChannelSessionRepository;
  connectorRepository: ChannelConnectorRepository;
  handlers: readonly DirectAccountAuthHandler[];
  authChallengeCipher?: Pick<TenantSecretCipher, "encrypt" | "decrypt">;
  workerId?: string;
  now?: Date;
  limit?: number;
  leaseMs?: number;
  processingConcurrency?: number;
};

export type DirectAccountAuthSweepResult = {
  scanned: number;
  claimed: number;
  processed: number;
  pending: number;
  completed: number;
  failed: number;
  expired: number;
  skippedLeased: number;
  skippedUnsupported: number;
  skippedInactive: number;
};

export type DirectAccountAuthSweeper = {
  sweep(): Promise<DirectAccountAuthSweepResult>;
};

export function createDirectAccountAuthSweeper(
  options: Omit<DirectAccountAuthSweepOptions, "now">
): DirectAccountAuthSweeper {
  return {
    sweep() {
      return runDirectAccountAuthSweep({
        ...options,
        now: new Date()
      });
    }
  };
}

export async function runDirectAccountAuthSweep(
  options: DirectAccountAuthSweepOptions
): Promise<DirectAccountAuthSweepResult> {
  const now = options.now ?? new Date();
  const result: DirectAccountAuthSweepResult = {
    scanned: 0,
    claimed: 0,
    processed: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    expired: 0,
    skippedLeased: 0,
    skippedUnsupported: 0,
    skippedInactive: 0
  };
  const challenges = await options.authChallengeRepository.listActiveChallenges(
    {
      limit: options.limit ?? defaultBatchSize,
      now
    }
  );

  result.scanned = challenges.length;

  await processChallengesWithConcurrency(
    challenges,
    normalizeProcessingConcurrency(options.processingConcurrency),
    (challenge) =>
      processChallenge({
        options,
        result,
        challenge,
        now
      })
  );

  return result;
}

async function processChallenge(input: {
  options: DirectAccountAuthSweepOptions;
  result: DirectAccountAuthSweepResult;
  challenge: ChannelAuthChallengeRecord;
  now: Date;
}): Promise<void> {
  if (isChallengeExpired(input.challenge, input.now)) {
    await expireChallenge(input);
    return;
  }

  const connector = await input.options.connectorRepository.findConnector({
    tenantId: input.challenge.tenantId,
    connectorId: input.challenge.connectorId
  });

  if (!isRunnableDirectAccountConnector(connector)) {
    input.result.skippedInactive += 1;
    await cancelChallengeForInactiveConnector({
      options: input.options,
      challenge: input.challenge,
      connector,
      now: input.now
    });
    return;
  }

  const session = await input.options.sessionRepository.findConnectorSession({
    tenantId: input.challenge.tenantId,
    connectorId: input.challenge.connectorId,
    sessionKey: primarySessionKey
  });

  if (!session) {
    await markChallengeFailed({
      ...input,
      connector,
      session: undefined,
      errorCode: "validation.failed",
      errorMessage: "Primary channel session is missing."
    });
    return;
  }

  const claimedSession =
    await input.options.sessionRepository.claimSessionLease({
      tenantId: session.tenantId,
      sessionId: session.id,
      leaseOwner: input.options.workerId ?? "direct-account-auth-worker",
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
    await runClaimedChallenge({
      ...input,
      connector,
      session: claimedSession
    });
  } finally {
    await input.options.sessionRepository.releaseSessionLease({
      tenantId: claimedSession.tenantId,
      sessionId: claimedSession.id,
      leaseOwner: input.options.workerId ?? "direct-account-auth-worker",
      updatedAt: input.now
    });
  }
}

async function runClaimedChallenge(input: {
  options: DirectAccountAuthSweepOptions;
  result: DirectAccountAuthSweepResult;
  challenge: ChannelAuthChallengeRecord;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  now: Date;
}): Promise<void> {
  const handler = findHandler({
    handlers: input.options.handlers,
    connector: input.connector,
    challenge: input.challenge
  });

  if (!handler) {
    input.result.skippedUnsupported += 1;
    await input.options.sessionRepository.appendSessionEvent({
      id: createSessionEventId(),
      tenantId: input.session.tenantId,
      connectorId: input.connector.id,
      sessionId: input.session.id,
      eventType: "auth.handler_missing",
      severity: "warning",
      code: "provider.temporary_failure",
      message: "No direct account auth handler is registered.",
      metadata: {
        channelType: input.connector.channelType,
        challengeType: input.challenge.challengeType
      },
      occurredAt: input.now,
      updatedAt: input.now
    });
    return;
  }

  let currentChallenge = input.challenge;
  const encryptSecretPayload = (
    payload: Record<string, unknown>
  ): string | null => encryptAuthChallengePayload(input.options, payload);
  const updateChallenge = async (
    patch: DirectAccountAuthChallengePatch
  ): Promise<void> => {
    const latestChallenge =
      await input.options.authChallengeRepository.findChallenge({
        tenantId: input.challenge.tenantId,
        challengeId: input.challenge.id
      });

    if (!latestChallenge) {
      throw new Error("AUTH_CHALLENGE_MISSING");
    }

    currentChallenge = latestChallenge;

    if (isTerminalChallengeStatus(latestChallenge.status)) {
      throw new Error(`AUTH_CHALLENGE_${latestChallenge.status}`);
    }

    currentChallenge = await persistChallengePatch({
      repository: input.options.authChallengeRepository,
      challenge: latestChallenge,
      patch,
      cipher: input.options.authChallengeCipher,
      updatedAt: input.now
    });
  };
  const loadLatestChallenge = async (): Promise<{
    challenge: ChannelAuthChallengeRecord;
    challengeSecretPayload: Record<string, unknown>;
  } | null> => {
    const latestChallenge =
      await input.options.authChallengeRepository.findChallenge({
        tenantId: input.challenge.tenantId,
        challengeId: input.challenge.id
      });

    if (!latestChallenge) {
      return null;
    }

    return {
      challenge: latestChallenge,
      challengeSecretPayload: readAuthChallengePayload({
        cipher: input.options.authChallengeCipher,
        secretPayloadEncrypted: latestChallenge.secretPayloadEncrypted
      })
    };
  };

  try {
    const handlerResult = await handler.run({
      connector: input.connector,
      session: input.session,
      challenge: currentChallenge,
      challengeSecretPayload: readAuthChallengePayload({
        cipher: input.options.authChallengeCipher,
        secretPayloadEncrypted: currentChallenge.secretPayloadEncrypted
      }),
      now: input.now,
      loadLatestChallenge,
      updateChallenge,
      encryptSecretPayload
    });

    input.result.processed += 1;
    const latestState = await loadLatestRunnableChallengeState({
      options: input.options,
      challenge: currentChallenge,
      now: input.now
    });

    if (!latestState) {
      return;
    }

    await persistHandlerResult({
      ...input,
      connector: latestState.connector,
      challenge: latestState.challenge,
      handlerResult
    });
  } catch (error) {
    const latestState = await loadLatestRunnableChallengeState({
      options: input.options,
      challenge: currentChallenge,
      now: input.now
    });

    if (!latestState) {
      return;
    }

    await markChallengeFailed({
      ...input,
      connector: latestState.connector,
      challenge: latestState.challenge,
      errorCode: "provider.temporary_failure",
      errorMessage: errorMessage(error)
    });
  }
}

async function persistHandlerResult(input: {
  options: DirectAccountAuthSweepOptions;
  result: DirectAccountAuthSweepResult;
  challenge: ChannelAuthChallengeRecord;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  handlerResult: DirectAccountAuthHandlerResult;
  now: Date;
}): Promise<void> {
  const { handlerResult } = input;

  switch (handlerResult.status) {
    case "pending":
      await markChallengePending({
        ...input,
        handlerResult
      });
      return;
    case "completed":
      await markChallengeCompleted({
        ...input,
        handlerResult
      });
      return;
    case "failed":
      await markChallengeFailed({
        ...input,
        errorCode: handlerResult.errorCode ?? "provider.permanent_failure",
        errorMessage: handlerResult.errorMessage,
        publicPayload: handlerResult.publicPayload
      });
  }
}

async function markChallengePending(input: {
  options: DirectAccountAuthSweepOptions;
  result: DirectAccountAuthSweepResult;
  challenge: ChannelAuthChallengeRecord;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  handlerResult: Extract<DirectAccountAuthHandlerResult, { status: "pending" }>;
  now: Date;
}): Promise<void> {
  await persistChallengePatch({
    repository: input.options.authChallengeRepository,
    challenge: input.challenge,
    patch: {
      status: input.handlerResult.challengeStatus ?? "waiting",
      publicPayload: withOperatorHint(
        input.handlerResult.publicPayload,
        input.handlerResult.operatorHint
      ),
      secretPayload: input.handlerResult.secretPayload,
      expiresAt: input.handlerResult.expiresAt ?? input.challenge.expiresAt,
      errorCode: null,
      errorMessage: null
    },
    cipher: input.options.authChallengeCipher,
    updatedAt: input.now
  });
  await input.options.sessionRepository.upsertSession({
    ...sessionPersistenceInput(input.session),
    status: "pending_auth",
    publicState: mergeRecord(input.session.publicState, {
      stage: "authorizing",
      challengeId: input.challenge.id,
      challengeType: input.challenge.challengeType
    }),
    metadata: mergeRecord(input.session.metadata, {
      authHandlerStatus: "pending"
    }),
    challengeType: input.challenge.challengeType,
    challengeExpiresAt:
      input.handlerResult.expiresAt ?? input.challenge.expiresAt,
    updatedAt: input.now
  });
  await input.options.connectorRepository.upsertConnector({
    ...connectorPersistenceInput(input.connector),
    status: "authorizing",
    healthStatus: "unknown",
    diagnostics: mergeRecord(input.connector.diagnostics, {
      status: "authorizing",
      checkedAt: input.now.toISOString(),
      session: {
        sessionKey: primarySessionKey,
        status: "pending_auth"
      }
    }),
    updatedAt: input.now
  });
  await appendAuthSessionEvent({
    options: input.options,
    session: input.session,
    connector: input.connector,
    now: input.now,
    eventType: "auth.challenge_pending",
    severity: "info",
    metadata: {
      challengeId: input.challenge.id,
      challengeType: input.challenge.challengeType
    }
  });
  input.result.pending += 1;
}

async function markChallengeCompleted(input: {
  options: DirectAccountAuthSweepOptions;
  result: DirectAccountAuthSweepResult;
  challenge: ChannelAuthChallengeRecord;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  handlerResult: Extract<
    DirectAccountAuthHandlerResult,
    { status: "completed" }
  >;
  now: Date;
}): Promise<void> {
  await persistChallengePatch({
    repository: input.options.authChallengeRepository,
    challenge: input.challenge,
    patch: {
      status: "succeeded",
      completedAt: input.now,
      errorCode: null,
      errorMessage: null
    },
    cipher: input.options.authChallengeCipher,
    updatedAt: input.now
  });
  await input.options.sessionRepository.upsertSession({
    ...sessionPersistenceInput(input.session),
    status: "connected",
    sessionEncrypted: input.handlerResult.sessionEncrypted,
    sessionFingerprint:
      input.handlerResult.sessionFingerprint ??
      input.session.sessionFingerprint,
    externalAccountId:
      input.handlerResult.externalAccountId ?? input.session.externalAccountId,
    displayAddress:
      input.handlerResult.displayAddress ?? input.session.displayAddress,
    publicState:
      input.handlerResult.publicState ??
      mergeRecord(input.session.publicState, {
        stage: "connected"
      }),
    metadata: mergeRecord(input.session.metadata, input.handlerResult.metadata),
    challengeType: null,
    challengeExpiresAt: null,
    lastConnectedAt: input.now,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    updatedAt: input.now
  });
  await input.options.connectorRepository.upsertConnector({
    ...connectorPersistenceInput(input.connector),
    displayName:
      input.handlerResult.connectorDisplayName ?? input.connector.displayName,
    status: "connected",
    healthStatus: "healthy",
    config: mergeRecord(input.connector.config, {
      ...(input.handlerResult.connectorConfig ?? {}),
      ...(input.handlerResult.externalAccountId
        ? { channelExternalId: input.handlerResult.externalAccountId }
        : {})
    }),
    diagnostics: mergeRecord(input.connector.diagnostics, {
      ...(input.handlerResult.diagnostics ?? {}),
      status: "connected",
      checkedAt: input.now.toISOString(),
      session: {
        sessionKey: primarySessionKey,
        status: "connected",
        displayAddress:
          input.handlerResult.displayAddress ?? input.session.displayAddress
      }
    }),
    updatedAt: input.now
  });
  await appendAuthSessionEvent({
    options: input.options,
    session: input.session,
    connector: input.connector,
    now: input.now,
    eventType: "auth.challenge_succeeded",
    severity: "info",
    metadata: {
      challengeId: input.challenge.id,
      challengeType: input.challenge.challengeType,
      externalAccountId: input.handlerResult.externalAccountId ?? null
    }
  });
  input.result.completed += 1;
}

async function markChallengeFailed(input: {
  options: DirectAccountAuthSweepOptions;
  result: DirectAccountAuthSweepResult;
  challenge: ChannelAuthChallengeRecord;
  connector: ChannelConnectorRecord;
  session?: ChannelSessionRecord;
  errorCode: PlatformErrorCode;
  errorMessage: string;
  publicPayload?: DirectAccountAuthPublicPayload;
  now: Date;
}): Promise<void> {
  await persistChallengePatch({
    repository: input.options.authChallengeRepository,
    challenge: input.challenge,
    patch: {
      status: "failed",
      publicPayload: input.publicPayload,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      completedAt: input.now
    },
    cipher: input.options.authChallengeCipher,
    updatedAt: input.now
  });

  if (input.session) {
    await input.options.sessionRepository.upsertSession({
      ...sessionPersistenceInput(input.session),
      status: "error",
      publicState: mergeRecord(input.session.publicState, {
        stage: "failed",
        challengeId: input.challenge.id
      }),
      metadata: mergeRecord(input.session.metadata, {
        authHandlerStatus: "failed"
      }),
      lastErrorAt: input.now,
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
      updatedAt: input.now
    });
    await appendAuthSessionEvent({
      options: input.options,
      session: input.session,
      connector: input.connector,
      now: input.now,
      eventType: "auth.challenge_failed",
      severity: "error",
      code: input.errorCode,
      message: input.errorMessage,
      metadata: {
        challengeId: input.challenge.id,
        challengeType: input.challenge.challengeType
      }
    });
  }

  await input.options.connectorRepository.upsertConnector({
    ...connectorPersistenceInput(input.connector),
    status: "failed",
    healthStatus: "unhealthy",
    diagnostics: mergeRecord(input.connector.diagnostics, {
      status: "failed",
      checkedAt: input.now.toISOString(),
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage
    }),
    updatedAt: input.now
  });
  input.result.failed += 1;
}

async function expireChallenge(input: {
  options: DirectAccountAuthSweepOptions;
  result: DirectAccountAuthSweepResult;
  challenge: ChannelAuthChallengeRecord;
  now: Date;
}): Promise<void> {
  await persistChallengePatch({
    repository: input.options.authChallengeRepository,
    challenge: input.challenge,
    patch: {
      status: "expired",
      completedAt: input.now,
      publicPayload: {
        operatorHint: "Authorization challenge expired. Start a new one."
      }
    },
    cipher: input.options.authChallengeCipher,
    updatedAt: input.now
  });
  input.result.expired += 1;
}

async function persistChallengePatch(input: {
  repository: ChannelAuthChallengeRepository;
  challenge: ChannelAuthChallengeRecord;
  patch: DirectAccountAuthChallengePatch;
  cipher?: Pick<TenantSecretCipher, "encrypt" | "decrypt">;
  updatedAt: Date;
}): Promise<ChannelAuthChallengeRecord> {
  const secretPayloadEncrypted =
    input.patch.secretPayloadEncrypted !== undefined
      ? input.patch.secretPayloadEncrypted
      : input.patch.secretPayload
        ? encryptAuthChallengePayload(
            { authChallengeCipher: input.cipher },
            input.patch.secretPayload
          )
        : input.challenge.secretPayloadEncrypted;
  const nextChallenge: ChannelAuthChallengeRecord = {
    ...input.challenge,
    status: input.patch.status ?? input.challenge.status,
    publicPayload: mergePublicPayload(
      input.challenge.publicPayload,
      input.patch.publicPayload
    ),
    secretPayloadEncrypted,
    errorCode:
      input.patch.errorCode === undefined
        ? input.challenge.errorCode
        : input.patch.errorCode,
    errorMessage:
      input.patch.errorMessage === undefined
        ? input.challenge.errorMessage
        : input.patch.errorMessage,
    expiresAt:
      input.patch.expiresAt === undefined
        ? input.challenge.expiresAt
        : input.patch.expiresAt,
    completedAt:
      input.patch.completedAt === undefined
        ? input.challenge.completedAt
        : input.patch.completedAt,
    updatedAt: input.updatedAt
  };

  await input.repository.upsertChallenge({
    id: nextChallenge.id,
    tenantId: nextChallenge.tenantId,
    connectorId: nextChallenge.connectorId,
    challengeType: nextChallenge.challengeType,
    status: nextChallenge.status,
    publicPayload: nextChallenge.publicPayload,
    secretPayloadEncrypted: nextChallenge.secretPayloadEncrypted,
    errorCode: nextChallenge.errorCode,
    errorMessage: nextChallenge.errorMessage,
    expiresAt: nextChallenge.expiresAt,
    completedAt: nextChallenge.completedAt,
    createdByEmployeeId: nextChallenge.createdByEmployeeId,
    updatedAt: input.updatedAt
  });

  return nextChallenge;
}

function findHandler(input: {
  handlers: readonly DirectAccountAuthHandler[];
  connector: ChannelConnectorRecord;
  challenge: ChannelAuthChallengeRecord;
}): DirectAccountAuthHandler | undefined {
  return input.handlers.find(
    (handler) =>
      handler.channelTypes.includes(input.connector.channelType) &&
      handler.challengeTypes.includes(input.challenge.challengeType)
  );
}

async function processChallengesWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  processItem: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await processItem(item);
      }
    }
  );

  await Promise.all(workers);
}

function normalizeProcessingConcurrency(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return defaultProcessingConcurrency;
  }

  return Math.max(1, Math.floor(value));
}

function isRunnableDirectAccountConnector(
  connector: ChannelConnectorRecord | null
): connector is ChannelConnectorRecord {
  return (
    Boolean(connector) &&
    connector?.channelClass === "user_bridge" &&
    directAccountChannelTypes.has(connector.channelType) &&
    connector.status !== "deleted" &&
    connector.status !== "disabled"
  );
}

async function loadLatestRunnableChallengeState(input: {
  options: DirectAccountAuthSweepOptions;
  challenge: ChannelAuthChallengeRecord;
  now: Date;
}): Promise<{
  challenge: ChannelAuthChallengeRecord;
  connector: ChannelConnectorRecord;
} | null> {
  const latestChallenge =
    await input.options.authChallengeRepository.findChallenge({
      tenantId: input.challenge.tenantId,
      challengeId: input.challenge.id
    });

  if (!latestChallenge) {
    return null;
  }

  if (isTerminalChallengeStatus(latestChallenge.status)) {
    return null;
  }

  const latestConnector = await input.options.connectorRepository.findConnector(
    {
      tenantId: latestChallenge.tenantId,
      connectorId: latestChallenge.connectorId
    }
  );

  if (!isRunnableDirectAccountConnector(latestConnector)) {
    await cancelChallengeForInactiveConnector({
      options: input.options,
      challenge: latestChallenge,
      connector: latestConnector,
      now: input.now
    });
    return null;
  }

  return {
    challenge: latestChallenge,
    connector: latestConnector
  };
}

async function cancelChallengeForInactiveConnector(input: {
  options: DirectAccountAuthSweepOptions;
  challenge: ChannelAuthChallengeRecord;
  connector: ChannelConnectorRecord | null;
  now: Date;
}): Promise<void> {
  if (
    isTerminalChallengeStatus(input.challenge.status) ||
    (input.connector &&
      input.connector.status !== "deleted" &&
      input.connector.status !== "disabled")
  ) {
    return;
  }

  await persistChallengePatch({
    repository: input.options.authChallengeRepository,
    challenge: input.challenge,
    patch: {
      status: "cancelled",
      completedAt: input.now,
      publicPayload: {
        operatorHint:
          "Authorization challenge was cancelled because the connector is inactive."
      }
    },
    cipher: input.options.authChallengeCipher,
    updatedAt: input.now
  });
}

function isTerminalChallengeStatus(status: string): boolean {
  return terminalChallengeStatuses.has(status);
}

function isChallengeExpired(
  challenge: ChannelAuthChallengeRecord,
  now: Date
): boolean {
  return (
    challenge.expiresAt !== null &&
    challenge.expiresAt.getTime() <= now.getTime()
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
    lastErrorMessage: session.lastErrorMessage,
    updatedAt: session.updatedAt
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
    createdByEmployeeId: connector.createdByEmployeeId,
    updatedAt: connector.updatedAt
  };
}

async function appendAuthSessionEvent(input: {
  options: DirectAccountAuthSweepOptions;
  session: ChannelSessionRecord;
  connector: ChannelConnectorRecord;
  now: Date;
  eventType: string;
  severity: "info" | "warning" | "error";
  code?: PlatformErrorCode;
  message?: string;
  metadata?: unknown;
}): Promise<void> {
  await input.options.sessionRepository.appendSessionEvent({
    id: createSessionEventId(),
    tenantId: input.session.tenantId,
    connectorId: input.connector.id,
    sessionId: input.session.id,
    eventType: input.eventType,
    severity: input.severity,
    code: input.code ?? null,
    message: input.message ?? null,
    metadata: input.metadata,
    occurredAt: input.now,
    updatedAt: input.now
  });
}

function readAuthChallengePayload(input: {
  cipher?: Pick<TenantSecretCipher, "decrypt">;
  secretPayloadEncrypted: string | null;
}): Record<string, unknown> {
  if (!input.cipher || !input.secretPayloadEncrypted) {
    return {};
  }

  try {
    const parsed = JSON.parse(
      input.cipher.decrypt(input.secretPayloadEncrypted)
    );

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function encryptAuthChallengePayload(
  input: { authChallengeCipher?: Pick<TenantSecretCipher, "encrypt"> },
  payload: Record<string, unknown>
): string | null {
  return input.authChallengeCipher
    ? input.authChallengeCipher.encrypt(JSON.stringify(payload))
    : null;
}

function mergeRecord(base: unknown, patch?: unknown): Record<string, unknown> {
  return {
    ...(isRecord(base) ? base : {}),
    ...(isRecord(patch) ? patch : {})
  };
}

function mergePublicPayload(
  base: unknown,
  patch?: DirectAccountAuthPublicPayload
): DirectAccountAuthPublicPayload {
  return {
    ...publicPayloadFromUnknown(base),
    ...publicPayloadFromUnknown(patch)
  };
}

function withOperatorHint(
  payload: DirectAccountAuthPublicPayload | undefined,
  operatorHint: string | undefined
): DirectAccountAuthPublicPayload | undefined {
  if (!operatorHint) {
    return payload;
  }

  return {
    ...(payload ?? {}),
    operatorHint
  };
}

function publicPayloadFromUnknown(
  value: unknown
): DirectAccountAuthPublicPayload {
  if (!isRecord(value)) {
    return {};
  }

  return {
    ...(readString(value.qrImageDataUrl)
      ? { qrImageDataUrl: readString(value.qrImageDataUrl) }
      : {}),
    ...(readString(value.qrPayloadRef)
      ? { qrPayloadRef: readString(value.qrPayloadRef) }
      : {}),
    ...(readString(value.phoneNumber)
      ? { phoneNumber: readString(value.phoneNumber) }
      : {}),
    ...(readString(value.expiresAt)
      ? { expiresAt: readString(value.expiresAt) }
      : {}),
    ...(readString(value.operatorHint)
      ? { operatorHint: readString(value.operatorHint) }
      : {})
  };
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

function createSessionEventId(): string {
  return `channel_session_event:${randomUUID()}`;
}
