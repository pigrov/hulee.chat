import type { TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createSqlPublicApiAuditSink,
  createSqlTenantApiKeyRepository,
  hashTenantApiKey
} from "./sql-public-api-access";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = "tenant_public_api" as TenantId;

describe("SQL public API access repository", () => {
  it("hashes API keys without returning the raw secret", () => {
    const rawKey = "hulee-local-dev-key";
    const hash = hashTenantApiKey(rawKey);

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hash).not.toContain(rawKey);
  });

  it("authenticates non-revoked tenant API keys by hash", async () => {
    const executor = new RecordingSqlExecutor([
      {
        id: "api-key-1",
        tenant_id: tenantId,
        name: "Local dev"
      }
    ]);
    const repository = createSqlTenantApiKeyRepository(executor);

    await expect(repository.authenticate("raw-key")).resolves.toEqual({
      tenantId,
      apiKeyId: "api-key-1",
      name: "Local dev"
    });
    expect(executor.queries).toHaveLength(1);
  });

  it("returns null for unknown API keys", async () => {
    const repository = createSqlTenantApiKeyRepository(
      new RecordingSqlExecutor([])
    );

    await expect(repository.authenticate("unknown-key")).resolves.toBeNull();
  });

  it("creates API keys as tenant-scoped hashed rows", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlTenantApiKeyRepository(executor);

    await repository.createApiKey({
      id: "api-key-1",
      tenantId,
      name: "Local dev",
      rawKey: "raw-key",
      createdAt: new Date("2026-06-22T07:00:00.000Z")
    });

    expect(executor.queries).toHaveLength(1);
  });

  it("writes public API audit records as tenant-scoped audit log rows", async () => {
    const executor = new RecordingSqlExecutor([]);
    const auditSink = createSqlPublicApiAuditSink(
      executor,
      () => new Date("2026-06-22T07:00:00.000Z")
    );

    await auditSink.record({
      requestId: "request-1",
      tenantId,
      apiKeyId: "api-key-1",
      action: "public_api.client.register",
      entityType: "client",
      entityId: "client-1",
      outcome: "success",
      status: 201
    });

    expect(executor.queries).toHaveLength(1);
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
