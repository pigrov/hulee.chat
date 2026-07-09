import type {
  AppendChannelSessionEventInput,
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  ChannelSessionEventRecord,
  ChannelSessionRecord,
  ChannelSessionRepository,
  ClaimChannelSessionLeaseInput,
  FindChannelConnectorInput,
  FindConnectorChannelSessionInput,
  ListChannelSessionEventsInput,
  ListRunnableChannelSessionsInput,
  SourceConnectionRecord,
  ReleaseChannelSessionLeaseInput,
  UpsertChannelConnectorInput,
  UpsertChannelSessionInput
} from "@hulee/db";
import type {
  ChannelConnectorId,
  SourceConnectionId,
  TenantId
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  runDirectAccountSessionMonitor,
  type DirectAccountSessionProbeHandler
} from "./direct-account-session-monitor";
import {
  createTestSourceConnection,
  InMemorySourceIntegrationRepository
} from "./test-source-integration-repository";

const tenantId = "tenant_direct_monitor" as TenantId;
const now = new Date("2026-07-08T10:00:00.000Z");

describe("direct account session monitor", () => {
  it("marks a connected direct account session healthy", async () => {
    const connector = createConnector();
    const session = createSession(connector, {
      lastHeartbeatAt: new Date("2026-07-08T09:40:00.000Z")
    });
    const repositories = createRepositories({
      connectors: [connector],
      sessions: [session],
      sourceConnections: [
        createTestSourceConnection({
          id: "src_conn_telegram_1",
          tenantId,
          displayName: "Telegram source",
          updatedAt: now
        })
      ]
    });
    const handler: DirectAccountSessionProbeHandler = {
      name: "telegram-test",
      channelTypes: ["telegram_qr_bridge"],
      async probe(input) {
        expect(input.session.id).toBe(session.id);

        return {
          status: "healthy",
          sessionEncrypted: "encrypted-session-next",
          externalAccountId: "tg:100",
          displayAddress: "@hulee_user",
          diagnostics: {
            providerProbe: "ok"
          }
        };
      }
    };

    await expect(
      runDirectAccountSessionMonitor({
        ...repositories,
        handlers: [handler],
        workerId: "worker-1",
        now
      })
    ).resolves.toMatchObject({
      scanned: 1,
      claimed: 1,
      checked: 1,
      healthy: 1
    });
    expect(
      repositories.sessionRepository.records.get(session.id)
    ).toMatchObject({
      status: "connected",
      sessionEncrypted: "encrypted-session-next",
      externalAccountId: "tg:100",
      displayAddress: "@hulee_user",
      lastHeartbeatAt: now,
      lastErrorAt: null,
      leaseOwner: null
    });
    expect(
      repositories.connectorRepository.records.get(connector.id)
    ).toMatchObject({
      status: "connected",
      healthStatus: "healthy",
      config: {
        channelExternalId: "tg:100"
      },
      diagnostics: {
        providerProbe: "ok",
        status: "connected",
        checkedAt: now.toISOString(),
        monitor: {
          status: "healthy",
          checkedAt: now.toISOString()
        }
      }
    });
    expect(repositories.sessionRepository.events).toHaveLength(1);
    expect(
      repositories.sourceRepository.connections.get("src_conn_telegram_1")
    ).toMatchObject({
      displayName: "Telegram account",
      status: "active",
      sourceName: "telegram_user_session"
    });
    expect([...repositories.sourceRepository.accounts.values()]).toEqual([
      expect.objectContaining({
        tenantId,
        sourceConnectionId: "src_conn_telegram_1",
        externalAccountId: "tg:100",
        externalAccountName: "@hulee_user",
        displayName: "@hulee_user",
        status: "active"
      })
    ]);
  });

  it("marks a revoked provider session as reauth required", async () => {
    const connector = createConnector();
    const session = createSession(connector, {
      externalAccountId: "tg:100",
      lastHeartbeatAt: new Date("2026-07-08T09:40:00.000Z")
    });
    const repositories = createRepositories({
      connectors: [connector],
      sessions: [session],
      sourceConnections: [
        createTestSourceConnection({
          id: "src_conn_telegram_1",
          tenantId,
          displayName: "Telegram source",
          updatedAt: now
        })
      ]
    });
    const handler: DirectAccountSessionProbeHandler = {
      name: "telegram-test",
      channelTypes: ["telegram_qr_bridge"],
      async probe() {
        return {
          status: "reauth_required",
          errorCode: "provider.permanent_failure",
          errorMessage: "AUTH_KEY_UNREGISTERED"
        };
      }
    };

    await expect(
      runDirectAccountSessionMonitor({
        ...repositories,
        handlers: [handler],
        workerId: "worker-1",
        now
      })
    ).resolves.toMatchObject({
      reauthRequired: 1
    });
    expect(
      repositories.sessionRepository.records.get(session.id)
    ).toMatchObject({
      status: "disconnected",
      lastDisconnectedAt: now,
      lastErrorCode: "provider.permanent_failure",
      lastErrorMessage: "AUTH_KEY_UNREGISTERED"
    });
    expect(
      repositories.connectorRepository.records.get(connector.id)
    ).toMatchObject({
      status: "reauth_required",
      healthStatus: "unhealthy"
    });
    expect(
      repositories.sourceRepository.connections.get("src_conn_telegram_1")
    ).toMatchObject({
      status: "error",
      diagnostics: expect.objectContaining({
        monitorStatus: "reauth_required",
        errorCode: "provider.permanent_failure",
        errorMessage: "AUTH_KEY_UNREGISTERED"
      })
    });
  });

  it("skips recently checked sessions until the monitor interval elapses", async () => {
    const connector = createConnector();
    const session = createSession(connector, {
      lastHeartbeatAt: new Date("2026-07-08T09:55:00.000Z")
    });
    const repositories = createRepositories({
      connectors: [connector],
      sessions: [session]
    });
    let probeCount = 0;
    const handler: DirectAccountSessionProbeHandler = {
      name: "telegram-test",
      channelTypes: ["telegram_qr_bridge"],
      async probe() {
        probeCount += 1;

        return {
          status: "healthy"
        };
      }
    };

    await expect(
      runDirectAccountSessionMonitor({
        ...repositories,
        handlers: [handler],
        workerId: "worker-1",
        now
      })
    ).resolves.toMatchObject({
      scanned: 0,
      checked: 0
    });
    expect(probeCount).toBe(0);
  });
});

function createRepositories(input: {
  connectors: readonly ChannelConnectorRecord[];
  sessions: readonly ChannelSessionRecord[];
  sourceConnections?: readonly SourceConnectionRecord[];
}): {
  connectorRepository: InMemoryChannelConnectorRepository;
  sessionRepository: InMemoryChannelSessionRepository;
  sourceRepository: InMemorySourceIntegrationRepository;
} {
  return {
    connectorRepository: new InMemoryChannelConnectorRepository(
      input.connectors
    ),
    sessionRepository: new InMemoryChannelSessionRepository(input.sessions),
    sourceRepository: new InMemorySourceIntegrationRepository({
      connections: input.sourceConnections
    })
  };
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
    const record = this.records.get(input.connectorId);

    return record && record.tenantId === input.tenantId ? record : null;
  }

  async findFirstConnectorByType(): Promise<ChannelConnectorRecord | null> {
    return null;
  }

  async listActiveConnectorsByType(): Promise<ChannelConnectorRecord[]> {
    return [];
  }

  async listTenantConnectors(): Promise<ChannelConnectorRecord[]> {
    return [];
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
      id: input.id as ChannelConnectorId,
      tenantId: input.tenantId,
      channelType: input.channelType,
      channelClass: input.channelClass,
      provider: input.provider,
      displayName: input.displayName,
      status: input.status,
      healthStatus: input.healthStatus,
      capabilities: input.capabilities ?? existing?.capabilities ?? {},
      onboardingState: input.onboardingState ?? existing?.onboardingState ?? {},
      config: input.config ?? existing?.config ?? {},
      diagnostics: input.diagnostics ?? existing?.diagnostics ?? {},
      sourceConnectionId:
        input.sourceConnectionId !== undefined
          ? (String(input.sourceConnectionId) as SourceConnectionId)
          : (existing?.sourceConnectionId ?? null),
      createdByEmployeeId:
        input.createdByEmployeeId ?? existing?.createdByEmployeeId ?? null,
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
      Array.from(this.records.values()).find(
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
    return Array.from(this.records.values())
      .filter((record) => record.status === input.status)
      .filter(
        (record) =>
          record.leaseExpiresAt === null || record.leaseExpiresAt <= now
      )
      .filter(
        (record) =>
          !input.heartbeatBefore ||
          record.lastHeartbeatAt === null ||
          record.lastHeartbeatAt <= input.heartbeatBefore
      )
      .slice(0, input.limit ?? 100);
  }

  async upsertSession(input: UpsertChannelSessionInput): Promise<void> {
    const existing = this.records.get(input.id);

    this.records.set(input.id, {
      id: input.id,
      tenantId: input.tenantId,
      connectorId: input.connectorId as ChannelConnectorId,
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
    const record = this.records.get(input.sessionId);

    if (!record || record.tenantId !== input.tenantId) {
      return null;
    }

    if (
      record.leaseOwner &&
      record.leaseOwner !== input.leaseOwner &&
      record.leaseExpiresAt &&
      record.leaseExpiresAt > input.now
    ) {
      return null;
    }

    const next = {
      ...record,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: input.leaseExpiresAt,
      lastHeartbeatAt: input.now,
      updatedAt: input.now
    };
    this.records.set(record.id, next);

    return next;
  }

  async releaseSessionLease(
    input: ReleaseChannelSessionLeaseInput
  ): Promise<void> {
    const record = this.records.get(input.sessionId);

    if (!record || record.leaseOwner !== input.leaseOwner) {
      return;
    }

    this.records.set(record.id, {
      ...record,
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
      connectorId: input.connectorId as ChannelConnectorId,
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
    _input: ListChannelSessionEventsInput
  ): Promise<ChannelSessionEventRecord[]> {
    return this.events;
  }
}

function createConnector(
  patch: Partial<ChannelConnectorRecord> = {}
): ChannelConnectorRecord {
  return {
    id: "telegram_qr_bridge:connector-1" as ChannelConnectorId,
    tenantId,
    channelType: "telegram_qr_bridge",
    channelClass: "user_bridge",
    provider: "telegram",
    displayName: "Telegram account",
    status: "connected",
    healthStatus: "healthy",
    capabilities: {},
    onboardingState: {},
    config: {},
    diagnostics: {},
    sourceConnectionId: "src_conn_telegram_1" as SourceConnectionId,
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

function createSession(
  connector: ChannelConnectorRecord,
  patch: Partial<ChannelSessionRecord> = {}
): ChannelSessionRecord {
  return {
    id: "channel_session:telegram-1",
    tenantId,
    connectorId: connector.id,
    sessionKey: "primary",
    status: "connected",
    sessionEncrypted: "encrypted-session",
    sessionFingerprint: null,
    externalAccountId: null,
    displayAddress: null,
    publicState: {},
    metadata: {},
    challengeType: null,
    challengeExpiresAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastConnectedAt: new Date("2026-07-08T09:00:00.000Z"),
    lastDisconnectedAt: null,
    lastHeartbeatAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}
