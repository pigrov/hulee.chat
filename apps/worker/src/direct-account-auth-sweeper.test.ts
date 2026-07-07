import type {
  ChannelConnectorId,
  ChannelType,
  InternalChannelAuthChallengeStatus,
  InternalChannelAuthChallengeType,
  TenantId
} from "@hulee/contracts";
import type {
  AppendChannelSessionEventInput,
  ChannelAuthChallengeRecord,
  ChannelAuthChallengeRepository,
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  ChannelSessionEventRecord,
  ChannelSessionRecord,
  ChannelSessionRepository,
  ClaimChannelSessionLeaseInput,
  FindChannelAuthChallengeInput,
  FindChannelConnectorInput,
  FindConnectorChannelSessionInput,
  FindLatestActiveChannelAuthChallengeInput,
  ListActiveChannelAuthChallengesInput,
  ListActiveChannelConnectorsByTypeInput,
  ListChannelSessionEventsInput,
  ListRunnableChannelSessionsInput,
  ListTenantChannelConnectorsInput,
  ReleaseChannelSessionLeaseInput,
  UpsertChannelAuthChallengeInput,
  UpsertChannelConnectorInput,
  UpsertChannelSessionInput
} from "@hulee/db";
import { describe, expect, it } from "vitest";

import {
  runDirectAccountAuthSweep,
  type DirectAccountAuthHandler
} from "./direct-account-auth-sweeper";

const tenantId = "tenant_direct_auth" as TenantId;
const now = new Date("2026-07-07T10:00:00.000Z");
const fakeCipher = {
  encrypt(plainText: string): string {
    return `sealed:${Buffer.from(plainText, "utf8").toString("base64url")}`;
  },
  decrypt(sealedValue: string): string {
    return Buffer.from(
      sealedValue.replace(/^sealed:/, ""),
      "base64url"
    ).toString("utf8");
  }
};

describe("direct account auth sweeper", () => {
  it("publishes Telegram QR state and marks the session as pending auth", async () => {
    const connector = createConnector({
      channelType: "telegram_qr_bridge",
      provider: "telegram"
    });
    const session = createSession(connector);
    const challenge = createChallenge(connector, {
      challengeType: "qr",
      status: "waiting"
    });
    const repositories = createRepositories({
      connectors: [connector],
      sessions: [session],
      challenges: [challenge]
    });
    const handler: DirectAccountAuthHandler = {
      name: "telegram-test",
      channelTypes: ["telegram_qr_bridge"],
      challengeTypes: ["qr"],
      async run(input) {
        expect(input.connector.id).toBe(connector.id);

        return {
          status: "pending",
          publicPayload: {
            qrPayloadRef: "tg://login?token=test",
            expiresAt: "2026-07-07T10:05:00.000Z"
          }
        };
      }
    };

    await expect(
      runDirectAccountAuthSweep({
        ...repositories,
        handlers: [handler],
        authChallengeCipher: fakeCipher,
        workerId: "worker-1",
        now
      })
    ).resolves.toMatchObject({
      scanned: 1,
      claimed: 1,
      processed: 1,
      pending: 1
    });
    expect(
      repositories.authChallengeRepository.records.get(challenge.id)
        ?.publicPayload
    ).toMatchObject({
      qrPayloadRef: "tg://login?token=test"
    });
    expect(
      repositories.sessionRepository.records.get(session.id)
    ).toMatchObject({
      status: "pending_auth",
      challengeType: "qr",
      leaseOwner: null
    });
    expect(
      repositories.connectorRepository.records.get(connector.id)
    ).toMatchObject({
      status: "authorizing",
      healthStatus: "unknown"
    });
  });

  it("completes WhatsApp auth and persists encrypted session state", async () => {
    const connector = createConnector({
      channelType: "whatsapp_qr_bridge",
      provider: "whatsapp"
    });
    const session = createSession(connector);
    const challenge = createChallenge(connector, {
      challengeType: "qr",
      status: "waiting",
      secretPayloadEncrypted: fakeCipher.encrypt(
        JSON.stringify({
          code: "123456"
        })
      )
    });
    const repositories = createRepositories({
      connectors: [connector],
      sessions: [session],
      challenges: [challenge]
    });
    const handler: DirectAccountAuthHandler = {
      name: "whatsapp-test",
      channelTypes: ["whatsapp_qr_bridge"],
      challengeTypes: ["qr"],
      async run(input) {
        expect(input.challengeSecretPayload).toMatchObject({
          code: "123456"
        });

        return {
          status: "completed",
          sessionEncrypted: "encrypted-whatsapp-session",
          sessionFingerprint: "whatsapp:79990000000",
          externalAccountId: "79990000000@s.whatsapp.net",
          displayAddress: "+79990000000",
          connectorDisplayName: "WhatsApp (+79990000000)",
          publicState: {
            stage: "connected"
          }
        };
      }
    };

    await expect(
      runDirectAccountAuthSweep({
        ...repositories,
        handlers: [handler],
        authChallengeCipher: fakeCipher,
        workerId: "worker-1",
        now
      })
    ).resolves.toMatchObject({
      completed: 1,
      failed: 0
    });
    expect(
      repositories.authChallengeRepository.records.get(challenge.id)
    ).toMatchObject({
      status: "succeeded",
      completedAt: now
    });
    expect(
      repositories.sessionRepository.records.get(session.id)
    ).toMatchObject({
      status: "connected",
      sessionEncrypted: "encrypted-whatsapp-session",
      sessionFingerprint: "whatsapp:79990000000",
      lastConnectedAt: now,
      leaseOwner: null
    });
    expect(
      repositories.connectorRepository.records.get(connector.id)
    ).toMatchObject({
      displayName: "WhatsApp (+79990000000)",
      status: "connected",
      healthStatus: "healthy",
      config: {
        channelExternalId: "79990000000@s.whatsapp.net"
      }
    });
  });

  it("records MAX auth failures on challenge, session and connector", async () => {
    const connector = createConnector({
      channelType: "max_qr_bridge",
      provider: "max"
    });
    const session = createSession(connector);
    const challenge = createChallenge(connector, {
      challengeType: "phone_code",
      status: "waiting"
    });
    const repositories = createRepositories({
      connectors: [connector],
      sessions: [session],
      challenges: [challenge]
    });
    const handler: DirectAccountAuthHandler = {
      name: "max-test",
      channelTypes: ["max_qr_bridge"],
      challengeTypes: ["phone_code"],
      async run() {
        return {
          status: "failed",
          errorCode: "provider.permanent_failure",
          errorMessage: "MAX rejected the verification code.",
          publicPayload: {
            operatorHint: "Check the code and start authorization again."
          }
        };
      }
    };

    await expect(
      runDirectAccountAuthSweep({
        ...repositories,
        handlers: [handler],
        authChallengeCipher: fakeCipher,
        workerId: "worker-1",
        now
      })
    ).resolves.toMatchObject({
      completed: 0,
      failed: 1
    });
    expect(
      repositories.authChallengeRepository.records.get(challenge.id)
    ).toMatchObject({
      status: "failed",
      errorCode: "provider.permanent_failure",
      errorMessage: "MAX rejected the verification code."
    });
    expect(
      repositories.sessionRepository.records.get(session.id)
    ).toMatchObject({
      status: "error",
      lastErrorCode: "provider.permanent_failure",
      lastErrorMessage: "MAX rejected the verification code."
    });
    expect(
      repositories.connectorRepository.records.get(connector.id)
    ).toMatchObject({
      status: "failed",
      healthStatus: "unhealthy"
    });
    expect(repositories.sessionRepository.events).toHaveLength(1);
  });
});

function createRepositories(input: {
  connectors: readonly ChannelConnectorRecord[];
  sessions: readonly ChannelSessionRecord[];
  challenges: readonly ChannelAuthChallengeRecord[];
}): {
  connectorRepository: InMemoryChannelConnectorRepository;
  sessionRepository: InMemoryChannelSessionRepository;
  authChallengeRepository: InMemoryChannelAuthChallengeRepository;
} {
  return {
    connectorRepository: new InMemoryChannelConnectorRepository(
      input.connectors
    ),
    sessionRepository: new InMemoryChannelSessionRepository(input.sessions),
    authChallengeRepository: new InMemoryChannelAuthChallengeRepository(
      input.challenges
    )
  };
}

class InMemoryChannelAuthChallengeRepository implements ChannelAuthChallengeRepository {
  readonly records = new Map<string, ChannelAuthChallengeRecord>();

  constructor(records: readonly ChannelAuthChallengeRecord[]) {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  async findChallenge(
    input: FindChannelAuthChallengeInput
  ): Promise<ChannelAuthChallengeRecord | null> {
    const record = this.records.get(input.challengeId) ?? null;

    return record?.tenantId === input.tenantId ? record : null;
  }

  async findLatestActiveChallenge(
    input: FindLatestActiveChannelAuthChallengeInput
  ): Promise<ChannelAuthChallengeRecord | null> {
    return (
      [...this.records.values()]
        .filter(
          (record) =>
            record.tenantId === input.tenantId &&
            record.connectorId === input.connectorId &&
            (!input.challengeType ||
              record.challengeType === input.challengeType) &&
            isActiveChallengeStatus(record.status)
        )
        .sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
        )[0] ?? null
    );
  }

  async listActiveChallenges(
    input: ListActiveChannelAuthChallengesInput = {}
  ): Promise<ChannelAuthChallengeRecord[]> {
    const statuses = new Set(
      input.statuses ?? [
        "pending",
        "waiting",
        "requires_code",
        "requires_password"
      ]
    );
    const nowValue = input.now ?? new Date();

    return [...this.records.values()]
      .filter(
        (record) =>
          statuses.has(record.status) &&
          (!record.expiresAt || record.expiresAt.getTime() > nowValue.getTime())
      )
      .sort((left, right) => {
        const byUpdatedAt =
          left.updatedAt.getTime() - right.updatedAt.getTime();

        return byUpdatedAt === 0
          ? left.id.localeCompare(right.id)
          : byUpdatedAt;
      })
      .slice(0, input.limit ?? 100);
  }

  async upsertChallenge(input: UpsertChannelAuthChallengeInput): Promise<void> {
    const existing = this.records.get(input.id);

    this.records.set(input.id, {
      id: input.id,
      tenantId: input.tenantId,
      connectorId: String(input.connectorId) as ChannelConnectorId,
      challengeType: input.challengeType as InternalChannelAuthChallengeType,
      status: input.status as InternalChannelAuthChallengeStatus,
      publicPayload: input.publicPayload ?? {},
      secretPayloadEncrypted: input.secretPayloadEncrypted ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      expiresAt: input.expiresAt ?? null,
      completedAt: input.completedAt ?? null,
      createdByEmployeeId: input.createdByEmployeeId ?? null,
      createdAt: existing?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt
    });
  }
}

class InMemoryChannelConnectorRepository implements ChannelConnectorRepository {
  readonly records = new Map<string, ChannelConnectorRecord>();

  constructor(records: readonly ChannelConnectorRecord[]) {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  async findConnector(
    input: FindChannelConnectorInput
  ): Promise<ChannelConnectorRecord | null> {
    const record = this.records.get(String(input.connectorId)) ?? null;

    return record?.tenantId === input.tenantId ? record : null;
  }

  async findFirstConnectorByType(): Promise<ChannelConnectorRecord | null> {
    return null;
  }

  async listActiveConnectorsByType(
    input: ListActiveChannelConnectorsByTypeInput
  ): Promise<ChannelConnectorRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.channelType === input.channelType &&
        (record.status === "connected" || record.status === "degraded")
    );
  }

  async listTenantConnectors(
    input: ListTenantChannelConnectorsInput
  ): Promise<ChannelConnectorRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.tenantId === input.tenantId &&
        (input.includeDeleted || record.status !== "deleted")
    );
  }

  async findActiveConnectorByConfigString(): Promise<ChannelConnectorRecord | null> {
    return null;
  }

  async findActiveConnectorByExternalId(): Promise<ChannelConnectorRecord | null> {
    return null;
  }

  async upsertConnector(input: UpsertChannelConnectorInput): Promise<void> {
    const existing = this.records.get(String(input.id));

    this.records.set(String(input.id), {
      id: String(input.id) as ChannelConnectorId,
      tenantId: input.tenantId,
      channelType: input.channelType as ChannelType,
      channelClass: input.channelClass,
      provider: input.provider,
      displayName: input.displayName,
      status: input.status,
      healthStatus: input.healthStatus,
      capabilities: input.capabilities ?? {},
      onboardingState: input.onboardingState ?? {},
      config: input.config ?? {},
      diagnostics: input.diagnostics ?? {},
      createdByEmployeeId: input.createdByEmployeeId ?? null,
      createdAt: existing?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt
    });
  }
}

class InMemoryChannelSessionRepository implements ChannelSessionRepository {
  readonly records = new Map<string, ChannelSessionRecord>();
  readonly events: ChannelSessionEventRecord[] = [];

  constructor(records: readonly ChannelSessionRecord[]) {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  async findSession(): Promise<ChannelSessionRecord | null> {
    return null;
  }

  async findConnectorSession(
    input: FindConnectorChannelSessionInput
  ): Promise<ChannelSessionRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.tenantId === input.tenantId &&
          record.connectorId === input.connectorId &&
          record.sessionKey === input.sessionKey
      ) ?? null
    );
  }

  async listRunnableSessions(
    input: ListRunnableChannelSessionsInput
  ): Promise<ChannelSessionRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.status === input.status
    );
  }

  async upsertSession(input: UpsertChannelSessionInput): Promise<void> {
    const existing = this.records.get(input.id);

    this.records.set(input.id, {
      id: input.id,
      tenantId: input.tenantId,
      connectorId: String(input.connectorId) as ChannelConnectorId,
      sessionKey: input.sessionKey,
      status: input.status,
      sessionEncrypted: input.sessionEncrypted ?? null,
      sessionFingerprint: input.sessionFingerprint ?? null,
      externalAccountId: input.externalAccountId ?? null,
      displayAddress: input.displayAddress ?? null,
      publicState: input.publicState ?? {},
      metadata: input.metadata ?? {},
      challengeType: input.challengeType ?? null,
      challengeExpiresAt: input.challengeExpiresAt ?? null,
      leaseOwner: input.leaseOwner ?? null,
      leaseExpiresAt: input.leaseExpiresAt ?? null,
      lastConnectedAt: input.lastConnectedAt ?? null,
      lastDisconnectedAt: input.lastDisconnectedAt ?? null,
      lastHeartbeatAt: input.lastHeartbeatAt ?? null,
      lastInboundAt: input.lastInboundAt ?? null,
      lastOutboundAt: input.lastOutboundAt ?? null,
      lastErrorAt: input.lastErrorAt ?? null,
      lastErrorCode: input.lastErrorCode ?? null,
      lastErrorMessage: input.lastErrorMessage ?? null,
      createdAt: existing?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt
    });
  }

  async claimSessionLease(
    input: ClaimChannelSessionLeaseInput
  ): Promise<ChannelSessionRecord | null> {
    const existing = this.records.get(input.sessionId);

    if (!existing || existing.tenantId !== input.tenantId) {
      return null;
    }

    if (
      existing.leaseOwner &&
      existing.leaseOwner !== input.leaseOwner &&
      existing.leaseExpiresAt &&
      existing.leaseExpiresAt.getTime() > input.now.getTime()
    ) {
      return null;
    }

    const claimed = {
      ...existing,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: input.leaseExpiresAt,
      lastHeartbeatAt: input.now,
      updatedAt: input.now
    };
    this.records.set(input.sessionId, claimed);

    return claimed;
  }

  async releaseSessionLease(
    input: ReleaseChannelSessionLeaseInput
  ): Promise<void> {
    const existing = this.records.get(input.sessionId);

    if (!existing || existing.leaseOwner !== input.leaseOwner) {
      return;
    }

    this.records.set(input.sessionId, {
      ...existing,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: input.updatedAt
    });
  }

  async appendSessionEvent(
    input: AppendChannelSessionEventInput
  ): Promise<void> {
    this.events.push({
      id: input.id,
      tenantId: input.tenantId,
      connectorId: String(input.connectorId) as ChannelConnectorId,
      sessionId: input.sessionId,
      eventType: input.eventType,
      severity: input.severity ?? "info",
      code: input.code ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? {},
      occurredAt: input.occurredAt,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt
    });
  }

  async listSessionEvents(
    input: ListChannelSessionEventsInput
  ): Promise<ChannelSessionEventRecord[]> {
    return this.events
      .filter(
        (event) =>
          event.tenantId === input.tenantId &&
          event.sessionId === input.sessionId
      )
      .slice(0, input.limit ?? 50);
  }
}

function createConnector(input: {
  channelType: "telegram_qr_bridge" | "whatsapp_qr_bridge" | "max_qr_bridge";
  provider: "telegram" | "whatsapp" | "max";
}): ChannelConnectorRecord {
  const id = `${input.channelType}:connector-1` as ChannelConnectorId;

  return {
    id,
    tenantId,
    channelType: input.channelType,
    channelClass: "user_bridge",
    provider: input.provider,
    displayName: input.provider,
    status: "onboarding",
    healthStatus: "unknown",
    capabilities: {},
    onboardingState: {},
    config: {},
    diagnostics: {},
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}

function createSession(
  connector: ChannelConnectorRecord
): ChannelSessionRecord {
  return {
    id: `session:${connector.id}`,
    tenantId,
    connectorId: connector.id,
    sessionKey: "primary",
    status: "not_started",
    sessionEncrypted: null,
    sessionFingerprint: null,
    externalAccountId: null,
    displayAddress: null,
    publicState: {},
    metadata: {},
    challengeType: null,
    challengeExpiresAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastHeartbeatAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now
  };
}

function createChallenge(
  connector: ChannelConnectorRecord,
  input: {
    challengeType: InternalChannelAuthChallengeType;
    status: InternalChannelAuthChallengeStatus;
    secretPayloadEncrypted?: string;
  }
): ChannelAuthChallengeRecord {
  return {
    id: `challenge:${connector.id}`,
    tenantId,
    connectorId: connector.id,
    challengeType: input.challengeType,
    status: input.status,
    publicPayload: {},
    secretPayloadEncrypted: input.secretPayloadEncrypted ?? null,
    errorCode: null,
    errorMessage: null,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
    completedAt: null,
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}

function isActiveChallengeStatus(status: string): boolean {
  return (
    status === "pending" ||
    status === "waiting" ||
    status === "requires_code" ||
    status === "requires_password"
  );
}
