import type { ChannelConnectorId, TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import { createSqlChannelSessionRepository } from "./sql-channel-session-repository";

const tenantId = "tenant_channel_session" as TenantId;
const connectorId =
  "telegram_qr_bridge:tenant_channel_session" as ChannelConnectorId;

describe("SQL channel session repository", () => {
  it("maps tenant-scoped channel session records", async () => {
    const executor = new RecordingSqlExecutor([createSessionRow()]);
    const repository = createSqlChannelSessionRepository(executor);

    await expect(
      repository.findConnectorSession({
        tenantId,
        connectorId,
        sessionKey: "primary"
      })
    ).resolves.toEqual({
      id: "session-1",
      tenantId,
      connectorId,
      sessionKey: "primary",
      status: "connected",
      sessionEncrypted: "encrypted-session",
      sessionFingerprint: "fingerprint-1",
      externalAccountId: "tg:100",
      displayAddress: "@hulee_user",
      publicState: {
        stage: "connected"
      },
      metadata: {
        runtime: "telegram"
      },
      challengeType: null,
      challengeExpiresAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastConnectedAt: new Date("2026-07-06T08:00:00.000Z"),
      lastDisconnectedAt: null,
      lastHeartbeatAt: new Date("2026-07-06T08:01:00.000Z"),
      lastInboundAt: null,
      lastOutboundAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: new Date("2026-07-06T07:59:00.000Z"),
      updatedAt: new Date("2026-07-06T08:01:00.000Z")
    });
  });

  it("upserts encrypted user-bridge session state", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlChannelSessionRepository(executor);

    await repository.upsertSession({
      id: "session-1",
      tenantId,
      connectorId,
      sessionKey: "primary",
      status: "pending_auth",
      sessionEncrypted: "encrypted-session",
      publicState: {
        stage: "qr_waiting"
      },
      metadata: {
        provider: "telegram"
      },
      updatedAt: new Date("2026-07-06T08:00:00.000Z")
    });

    expect(executor.queries).toHaveLength(1);
    expect(String(executor.queries[0])).not.toContain("raw-string-session");
  });

  it("claims and releases a runtime lease", async () => {
    const executor = new RecordingSqlExecutor([createSessionRow()]);
    const repository = createSqlChannelSessionRepository(executor);

    await expect(
      repository.claimSessionLease({
        tenantId,
        sessionId: "session-1",
        leaseOwner: "worker-1",
        leaseExpiresAt: new Date("2026-07-06T08:05:00.000Z"),
        now: new Date("2026-07-06T08:00:00.000Z")
      })
    ).resolves.toMatchObject({
      id: "session-1",
      tenantId,
      connectorId
    });

    await repository.releaseSessionLease({
      tenantId,
      sessionId: "session-1",
      leaseOwner: "worker-1",
      updatedAt: new Date("2026-07-06T08:01:00.000Z")
    });

    expect(executor.queries).toHaveLength(2);
  });

  it("appends and lists safe session events", async () => {
    const eventRow = createSessionEventRow();
    const executor = new RecordingSqlExecutor([eventRow]);
    const repository = createSqlChannelSessionRepository(executor);

    await repository.appendSessionEvent({
      id: "event-1",
      tenantId,
      connectorId,
      sessionId: "session-1",
      eventType: "auth.challenge_created",
      metadata: {
        challengeType: "qr"
      },
      occurredAt: new Date("2026-07-06T08:00:00.000Z"),
      updatedAt: new Date("2026-07-06T08:00:00.000Z")
    });

    await expect(
      repository.listSessionEvents({
        tenantId,
        sessionId: "session-1"
      })
    ).resolves.toEqual([
      {
        id: "event-1",
        tenantId,
        connectorId,
        sessionId: "session-1",
        eventType: "auth.challenge_created",
        severity: "info",
        code: null,
        message: null,
        metadata: {
          challengeType: "qr"
        },
        occurredAt: new Date("2026-07-06T08:00:00.000Z"),
        createdAt: new Date("2026-07-06T08:00:00.000Z"),
        updatedAt: new Date("2026-07-06T08:00:00.000Z")
      }
    ]);
  });
});

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);

    return {
      rows: this.rows as readonly Row[]
    };
  }
}

function createSessionRow(): Record<string, unknown> {
  return {
    id: "session-1",
    tenant_id: tenantId,
    connector_id: connectorId,
    session_key: "primary",
    status: "connected",
    session_encrypted: "encrypted-session",
    session_fingerprint: "fingerprint-1",
    external_account_id: "tg:100",
    display_address: "@hulee_user",
    public_state: {
      stage: "connected"
    },
    metadata: {
      runtime: "telegram"
    },
    challenge_type: null,
    challenge_expires_at: null,
    lease_owner: null,
    lease_expires_at: null,
    last_connected_at: "2026-07-06T08:00:00.000Z",
    last_disconnected_at: null,
    last_heartbeat_at: "2026-07-06T08:01:00.000Z",
    last_inbound_at: null,
    last_outbound_at: null,
    last_error_at: null,
    last_error_code: null,
    last_error_message: null,
    created_at: "2026-07-06T07:59:00.000Z",
    updated_at: "2026-07-06T08:01:00.000Z"
  };
}

function createSessionEventRow(): Record<string, unknown> {
  return {
    id: "event-1",
    tenant_id: tenantId,
    connector_id: connectorId,
    session_id: "session-1",
    event_type: "auth.challenge_created",
    severity: "info",
    code: null,
    message: null,
    metadata: {
      challengeType: "qr"
    },
    occurred_at: "2026-07-06T08:00:00.000Z",
    created_at: "2026-07-06T08:00:00.000Z",
    updated_at: "2026-07-06T08:00:00.000Z"
  };
}
