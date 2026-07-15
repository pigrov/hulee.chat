import { inboxV2TenantIdSchema } from "@hulee/contracts";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildListInboxV2SecurityDenialRetentionTenantsSql,
  buildPruneInboxV2SecurityDenialsSql,
  createSqlInboxV2SecurityDenialRetentionRepository
} from "./sql-inbox-v2-security-denial-retention-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantA = inboxV2TenantIdSchema.parse("tenant:security-retention-a");
const tenantB = inboxV2TenantIdSchema.parse("tenant:security-retention-b");
const tenantUpper = inboxV2TenantIdSchema.parse("tenant:security-retention-A");
const deploymentBucket = inboxV2TenantIdSchema.parse(
  "tenant:system.security-denial.production"
);
describe("SQL Inbox V2 security-denial retention repository", () => {
  it("lists a strict bounded tenant keyset including reserved deployment buckets", async () => {
    const executor = new CapturingExecutor([
      { tenant_id: tenantB },
      { tenant_id: deploymentBucket }
    ]);
    const repository =
      createSqlInboxV2SecurityDenialRetentionRepository(executor);

    await expect(
      repository.listRetentionTenants({
        afterTenantId: tenantA,
        limit: 16
      })
    ).resolves.toEqual([tenantB, deploymentBucket]);
    const query = executor.queries[0]!;
    expect(normalizeSql(query.sql)).toContain(
      "select tenant.id as tenant_id from public.tenants tenant"
    );
    expect(normalizeSql(query.sql)).toContain(
      "where tenant.id > $1::text order by tenant.id asc limit $2"
    );
    expect(query.params).toEqual([tenantA, 16]);
  });

  it("treats the database collation as authoritative for mixed-case IDs", async () => {
    const repository = createSqlInboxV2SecurityDenialRetentionRepository(
      new CapturingExecutor([
        { tenant_id: tenantB },
        { tenant_id: tenantUpper }
      ])
    );

    await expect(
      repository.listRetentionTenants({ afterTenantId: null, limit: 16 })
    ).resolves.toEqual([tenantB, tenantUpper]);
  });

  it("rejects oversized and malformed keyset pages", async () => {
    const oversized = new CapturingExecutor([]);
    await expect(
      createSqlInboxV2SecurityDenialRetentionRepository(
        oversized
      ).listRetentionTenants({ afterTenantId: null, limit: 65 })
    ).rejects.toThrow(/between 1 and 64/u);
    expect(oversized.queries).toHaveLength(0);

    const malformed = new CapturingExecutor([
      { tenant_id: tenantB },
      { tenant_id: tenantB }
    ]);
    await expect(
      createSqlInboxV2SecurityDenialRetentionRepository(
        malformed
      ).listRetentionTenants({ afterTenantId: null, limit: 2 })
    ).rejects.toThrow(/repeated a keyset identity/u);
  });

  it("owns the bounded canonical prune call and maps its exact count", async () => {
    const executor = new CapturingExecutor([{ deleted_window_count: "17" }]);
    const repository =
      createSqlInboxV2SecurityDenialRetentionRepository(executor);

    await expect(
      repository.prune({ tenantId: tenantA, batchSize: 64 })
    ).resolves.toEqual({ deletedWindowCount: "17" });
    expect(executor.queries).toHaveLength(1);
    expect(normalizeSql(executor.queries[0]!.sql)).toContain(
      "from public.inbox_v2_security_denial_prune("
    );
    expect(executor.queries[0]!.params).toEqual([tenantA, 64]);

    const invalidExecutor = new CapturingExecutor([]);
    await expect(
      createSqlInboxV2SecurityDenialRetentionRepository(invalidExecutor).prune({
        tenantId: tenantA,
        batchSize: 1_001
      })
    ).rejects.toThrow(/between 1 and 1000/u);
    expect(invalidExecutor.queries).toHaveLength(0);
  });

  it("builds only a read-only denial-store maintenance query", () => {
    const query = renderQuery(
      buildListInboxV2SecurityDenialRetentionTenantsSql({
        afterTenantId: null,
        limit: 8
      })
    );
    expect(normalizeSql(query.sql)).not.toMatch(
      /\b(?:insert|update|delete|outbox|event_store|domain_events)\b/u
    );
    expect(normalizeSql(query.sql)).toContain(
      "from public.tenants tenant where true order by tenant.id asc limit $1"
    );
    expect(query.params).toEqual([8]);

    const pruneQuery = renderQuery(
      buildPruneInboxV2SecurityDenialsSql({
        tenantId: tenantA,
        batchSize: 32
      })
    );
    expect(normalizeSql(pruneQuery.sql)).not.toMatch(
      /\b(?:insert|update|delete|outbox|event_store|domain_events)\b/u
    );
    expect(normalizeSql(pruneQuery.sql)).toContain(
      "from public.inbox_v2_security_denial_prune("
    );
    expect(pruneQuery.params).toEqual([tenantA, 32]);
  });
});

class CapturingExecutor implements RawSqlExecutor {
  readonly queries: ReturnType<typeof renderQuery>[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(renderQuery(query));
    return { rows: this.rows as readonly Row[] };
  }
}

function renderQuery(query: SQL) {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
