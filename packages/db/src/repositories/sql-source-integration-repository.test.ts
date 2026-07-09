import {
  createNormalizedSourceIdempotencyKey,
  createRawSourceIdempotencyKey,
  type NormalizedInboundEventId,
  type RawInboundEventId,
  type SourceAccountId,
  type SourceConnectionId,
  type TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

import {
  buildListTenantSourceConnectionsSql,
  buildRecordNormalizedInboundEventSql,
  buildRecordRawInboundEventSql,
  buildUpsertSourceConnectionSql,
  createSqlSourceIntegrationRepository
} from "./sql-source-integration-repository";

const tenantId = "tenant_source" as TenantId;
const sourceConnectionId = "src_conn_market_1" as SourceConnectionId;
const sourceAccountId = "src_acc_shop_1" as SourceAccountId;
const rawEventId = "raw_evt_1" as RawInboundEventId;
const normalizedEventId = "norm_evt_1" as NormalizedInboundEventId;
const now = new Date("2026-07-08T10:00:00.000Z");

describe("SQL source integration repository", () => {
  it("maps source connection records with tenant metadata", async () => {
    const executor = new RecordingSqlExecutor([createSourceConnectionRow()]);
    const repository = createSqlSourceIntegrationRepository(executor);

    await expect(
      repository.findSourceConnection({
        tenantId,
        sourceConnectionId
      })
    ).resolves.toEqual({
      id: sourceConnectionId,
      tenantId,
      sourceType: "marketplace",
      sourceName: "ozon",
      displayName: "Ozon",
      status: "active",
      authType: "oauth2",
      capabilities: {
        canReceive: true
      },
      config: {
        region: "ru"
      },
      diagnostics: {
        status: "ok"
      },
      metadata: {
        owner: "platform"
      },
      createdByEmployeeId: null,
      createdAt: now,
      updatedAt: now
    });
    expect(executor.queries).toHaveLength(1);
  });

  it("builds source connection queries with tenant boundary and deleted filtering", () => {
    const listQuery = sqlText(
      buildListTenantSourceConnectionsSql({
        tenantId,
        limit: 20
      })
    );
    const upsertQuery = sqlText(
      buildUpsertSourceConnectionSql({
        id: sourceConnectionId,
        tenantId,
        sourceType: "marketplace",
        sourceName: "ozon",
        displayName: "Ozon",
        status: "active",
        authType: "oauth2",
        updatedAt: now
      })
    );

    expect(listQuery).toContain("where tenant_id = $1");
    expect(listQuery).toContain("and status <> 'deleted'");
    expect(upsertQuery).toContain(
      "where source_connections.tenant_id = excluded.tenant_id"
    );
    expect(upsertQuery).toContain("returning");
  });

  it("upserts source accounts within the same tenant and connection", async () => {
    const executor = new RecordingSqlExecutor([createSourceAccountRow()]);
    const repository = createSqlSourceIntegrationRepository(executor);

    await expect(
      repository.upsertSourceAccount({
        id: sourceAccountId,
        tenantId,
        sourceConnectionId,
        externalAccountId: "shop-1",
        externalAccountName: "Shop 1",
        accountType: "shop",
        displayName: "Ozon Shop",
        status: "active",
        updatedAt: now
      })
    ).resolves.toMatchObject({
      id: sourceAccountId,
      tenantId,
      sourceConnectionId,
      externalAccountId: "shop-1"
    });

    const query = sqlText(lastQuery(executor));
    expect(query).toContain(
      "where source_accounts.tenant_id = excluded.tenant_id"
    );
    expect(query).toContain(
      "source_accounts.source_connection_id = excluded.source_connection_id"
    );
  });

  it("records raw and normalized inbound events with idempotency conflict handling", async () => {
    const rawIdempotencyKey = createRawSourceIdempotencyKey({
      transport: "webhook",
      sourceConnectionId,
      sourceAccountId,
      externalEventId: "ozon-message-1"
    });
    const normalizedIdempotencyKey = createNormalizedSourceIdempotencyKey({
      transport: "webhook",
      sourceConnectionId,
      sourceAccountId,
      sourceEventType: "message",
      externalEventId: "ozon-message-1"
    });
    const rawQuery = sqlText(
      buildRecordRawInboundEventSql({
        id: rawEventId,
        tenantId,
        sourceConnectionId,
        sourceAccountId,
        idempotencyKey: rawIdempotencyKey,
        receivedAt: now,
        payload: {
          text: "hello"
        },
        updatedAt: now
      })
    );
    const normalizedQuery = sqlText(
      buildRecordNormalizedInboundEventSql({
        id: normalizedEventId,
        tenantId,
        rawEventId,
        sourceConnectionId,
        sourceAccountId,
        sourceType: "marketplace",
        sourceName: "ozon",
        eventType: "message",
        direction: "inbound",
        visibility: "private",
        normalizedPayload: {
          text: "hello"
        },
        idempotencyKey: normalizedIdempotencyKey,
        updatedAt: now
      })
    );

    expect(rawIdempotencyKey).toContain("source:v1:raw:webhook");
    expect(normalizedIdempotencyKey).toContain("source:v1:normalized:webhook");
    expect(rawQuery).toContain("on conflict (tenant_id, idempotency_key)");
    expect(rawQuery).toContain("returning");
    expect(normalizedQuery).toContain(
      "on conflict (tenant_id, idempotency_key)"
    );
    expect(normalizedQuery).toContain("returning");
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

function sqlText(query: SQL): string {
  return new PgDialect().sqlToQuery(query).sql;
}

function lastQuery(executor: RecordingSqlExecutor): SQL {
  const query = executor.queries.at(-1);

  if (!query) {
    throw new Error("Expected at least one recorded SQL query.");
  }

  return query;
}

function createSourceConnectionRow(): Record<string, unknown> {
  return {
    id: sourceConnectionId,
    tenant_id: tenantId,
    source_type: "marketplace",
    source_name: "ozon",
    display_name: "Ozon",
    status: "active",
    auth_type: "oauth2",
    capabilities: {
      canReceive: true
    },
    config: {
      region: "ru"
    },
    diagnostics: {
      status: "ok"
    },
    metadata: {
      owner: "platform"
    },
    created_by_employee_id: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
}

function createSourceAccountRow(): Record<string, unknown> {
  return {
    id: sourceAccountId,
    tenant_id: tenantId,
    source_connection_id: sourceConnectionId,
    external_account_id: "shop-1",
    external_account_name: "Shop 1",
    account_type: "shop",
    display_name: "Ozon Shop",
    status: "active",
    metadata: {},
    created_at: now,
    updated_at: now
  };
}
