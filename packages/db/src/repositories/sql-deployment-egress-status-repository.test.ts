import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  buildListDeploymentEgressStatusSnapshotsSql,
  createSqlDeploymentEgressStatusRepository
} from "./sql-deployment-egress-status-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

describe("SQL deployment egress status repository", () => {
  it("maps runtime probe snapshots without tenant scope", async () => {
    const executor = new RecordingSqlExecutor([
      {
        profile_id: "hulee_chat_vpn_gateway",
        profile_kind: "vpn_namespace",
        status: "degraded",
        checked_at: new Date("2026-06-29T10:00:00.000Z"),
        last_ready_at: new Date("2026-06-29T09:59:00.000Z"),
        last_failure_at: new Date("2026-06-29T10:00:00.000Z"),
        consecutive_failures: 2,
        alert_severity: "warning",
        last_error_code: "provider.temporary_failure",
        operator_hint: "One or more provider egress probes failed.",
        public_ip: "178.212.32.166",
        details: {
          workerId: "worker-1",
          probes: [
            {
              name: "https.connectivity",
              target: "https://www.gstatic.com/generate_204",
              status: "success",
              checkedAt: "2026-06-29T10:00:00.000Z",
              latencyMs: 80,
              httpStatus: 204
            }
          ],
          alerts: [
            {
              severity: "warning",
              code: "egress.probe_failed",
              message: "One or more provider egress probes failed."
            }
          ]
        }
      }
    ]);
    const repository = createSqlDeploymentEgressStatusRepository(executor);

    await expect(repository.listLatestSnapshots()).resolves.toEqual([
      {
        profileId: "hulee_chat_vpn_gateway",
        profileKind: "vpn_namespace",
        status: "degraded",
        checkedAt: new Date("2026-06-29T10:00:00.000Z"),
        lastReadyAt: new Date("2026-06-29T09:59:00.000Z"),
        lastFailureAt: new Date("2026-06-29T10:00:00.000Z"),
        consecutiveFailures: 2,
        alertSeverity: "warning",
        lastErrorCode: "provider.temporary_failure",
        operatorHint: "One or more provider egress probes failed.",
        publicIp: "178.212.32.166",
        workerId: "worker-1",
        probes: [
          {
            name: "https.connectivity",
            target: "https://www.gstatic.com/generate_204",
            status: "success",
            checkedAt: "2026-06-29T10:00:00.000Z",
            latencyMs: 80,
            httpStatus: 204
          }
        ],
        alerts: [
          {
            severity: "warning",
            code: "egress.probe_failed",
            message: "One or more provider egress probes failed."
          }
        ]
      }
    ]);
  });

  it("builds filtered snapshot queries by profile id", () => {
    const query = sqlQuery(
      buildListDeploymentEgressStatusSnapshotsSql({
        profileIds: ["hulee_chat_vpn_gateway"],
        limit: 5
      })
    );

    expect(query.sql).toContain("deployment_egress_status_snapshots");
    expect(query.sql).toContain("jsonb_array_elements_text");
    expect(query.sql).toContain("limit $2");
    expect(query.params).toEqual([
      JSON.stringify(["hulee_chat_vpn_gateway"]),
      5
    ]);
  });

  it("upserts safe snapshot details", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlDeploymentEgressStatusRepository(executor);

    await repository.upsertSnapshot({
      profileId: "hulee_chat_vpn_gateway",
      profileKind: "vpn_namespace",
      status: "ready",
      checkedAt: new Date("2026-06-29T10:00:00.000Z"),
      lastReadyAt: new Date("2026-06-29T10:00:00.000Z"),
      consecutiveFailures: 0,
      alertSeverity: "none",
      publicIp: "178.212.32.166",
      probes: [],
      alerts: [],
      workerId: "worker-1"
    });

    expect(executor.queries).toHaveLength(1);
    expect(String(executor.queries[0])).not.toContain("OPENVPN_PASSWORD");
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

function sqlQuery(query: SQL): { sql: string; params: unknown[] } {
  const dialectQuery = new PgDialect().sqlToQuery(query);

  return {
    sql: dialectQuery.sql,
    params: dialectQuery.params
  };
}
