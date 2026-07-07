import type { ChannelConnectorId, TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import { createSqlChannelAuthChallengeRepository } from "./sql-channel-auth-challenge-repository";

const tenantId = "tenant_channel_auth" as TenantId;
const connectorId =
  "telegram_qr_bridge:tenant_channel_auth" as ChannelConnectorId;

describe("SQL channel auth challenge repository", () => {
  it("maps tenant-scoped auth challenge records", async () => {
    const executor = new RecordingSqlExecutor([createChallengeRow()]);
    const repository = createSqlChannelAuthChallengeRepository(executor);

    await expect(
      repository.findChallenge({
        tenantId,
        challengeId: "challenge-1"
      })
    ).resolves.toEqual({
      id: "challenge-1",
      tenantId,
      connectorId,
      challengeType: "qr",
      status: "waiting",
      publicPayload: {
        qrPayloadRef: "qr-ref-1"
      },
      secretPayloadEncrypted: "encrypted-secret",
      errorCode: null,
      errorMessage: null,
      expiresAt: new Date("2026-06-29T10:00:00.000Z"),
      completedAt: null,
      createdByEmployeeId: null,
      createdAt: new Date("2026-06-29T09:55:00.000Z"),
      updatedAt: new Date("2026-06-29T09:55:00.000Z")
    });
    expect(executor.queries).toHaveLength(1);
  });

  it("finds the latest active connector challenge", async () => {
    const executor = new RecordingSqlExecutor([createChallengeRow()]);
    const repository = createSqlChannelAuthChallengeRepository(executor);

    await expect(
      repository.findLatestActiveChallenge({
        tenantId,
        connectorId,
        challengeType: "qr"
      })
    ).resolves.toMatchObject({
      id: "challenge-1",
      tenantId,
      connectorId,
      status: "waiting"
    });
  });

  it("lists runnable active challenges for worker processing", async () => {
    const executor = new RecordingSqlExecutor([createChallengeRow()]);
    const repository = createSqlChannelAuthChallengeRepository(executor);

    await expect(
      repository.listActiveChallenges({
        now: new Date("2026-06-29T09:56:00.000Z"),
        limit: 10
      })
    ).resolves.toHaveLength(1);
    expect(executor.queries).toHaveLength(1);
  });

  it("upserts challenge state and stores only encrypted secret payloads", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlChannelAuthChallengeRepository(executor);

    await repository.upsertChallenge({
      id: "challenge-1",
      tenantId,
      connectorId,
      challengeType: "qr",
      status: "waiting",
      publicPayload: {
        qrPayloadRef: "qr-ref-1"
      },
      secretPayloadEncrypted: "encrypted-secret",
      expiresAt: new Date("2026-06-29T10:00:00.000Z"),
      updatedAt: new Date("2026-06-29T09:55:00.000Z")
    });

    expect(executor.queries).toHaveLength(1);
    expect(String(executor.queries[0])).not.toContain("raw-session");
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

function createChallengeRow(): Record<string, unknown> {
  return {
    id: "challenge-1",
    tenant_id: tenantId,
    connector_id: connectorId,
    challenge_type: "qr",
    status: "waiting",
    public_payload: {
      qrPayloadRef: "qr-ref-1"
    },
    secret_payload_encrypted: "encrypted-secret",
    error_code: null,
    error_message: null,
    expires_at: new Date("2026-06-29T10:00:00.000Z"),
    completed_at: null,
    created_by_employee_id: null,
    created_at: new Date("2026-06-29T09:55:00.000Z"),
    updated_at: new Date("2026-06-29T09:55:00.000Z")
  };
}
