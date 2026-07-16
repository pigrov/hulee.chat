import { describe, expect, it, vi } from "vitest";

import {
  INBOX_V2_MIGRATION_DDL_BUDGET_DEFAULTS,
  InboxV2DatabaseLifecycleError,
  assertNoOtherDatabaseSessions,
  resolveInboxV2MigrationDdlBudget,
  withInboxV2MigrationDdlBudget
} from "./inbox-v2-database-lifecycle.mjs";

describe("Inbox V2 lifecycle fail-closed evidence", () => {
  it("exposes the PII-safe DDL risk report and its digest", () => {
    const evidence = Object.freeze({
      schemaId: "core:inbox-v2.expand-ddl-risk-evidence@v2",
      databaseRef: `sha256:${"a".repeat(64)}`,
      reportSha256: `sha256:${"b".repeat(64)}`
    });
    const error = new InboxV2DatabaseLifecycleError(
      "inbox_v2.expand_online_bridge_required",
      "An online bridge is required.",
      { evidence }
    );

    expect(error).toMatchObject({
      name: "InboxV2DatabaseLifecycleError",
      code: "inbox_v2.expand_online_bridge_required",
      reportSha256: evidence.reportSha256
    });
    expect(error.evidence).toBe(evidence);
  });
});

describe("Inbox V2 reset connection fence", () => {
  it("excludes only autovacuum and keeps every other backend fail-closed", async () => {
    const client = {
      query: vi.fn(async (statement, parameters) => ({
        rows: [{ connection_count: 0, prepared_transaction_count: 0 }],
        statement,
        parameters
      }))
    };

    await expect(
      assertNoOtherDatabaseSessions(client, "hulee_db008_reset_test")
    ).resolves.toBeUndefined();

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "backend_type is distinct from 'autovacuum worker'"
      ),
      ["hulee_db008_reset_test"]
    );
  });

  it.each([
    [1, 0, "inbox_v2.reset_active_connections"],
    [0, 1, "inbox_v2.reset_prepared_transactions"]
  ])(
    "refuses blocking client/prepared state %#",
    async (connectionCount, preparedTransactionCount, code) => {
      const client = {
        query: vi.fn(async () => ({
          rows: [
            {
              connection_count: connectionCount,
              prepared_transaction_count: preparedTransactionCount
            }
          ]
        }))
      };

      await expect(
        assertNoOtherDatabaseSessions(client, "hulee_db008_reset_test")
      ).rejects.toMatchObject({ code });
    }
  );
});

describe("Inbox V2 migration DDL budget", () => {
  it("uses bounded non-zero defaults", () => {
    const budget = resolveInboxV2MigrationDdlBudget();

    expect(budget).toEqual({
      lockTimeoutMs: 5_000,
      statementTimeoutMs: 900_000
    });
    expect(budget).toEqual(INBOX_V2_MIGRATION_DDL_BUDGET_DEFAULTS);
    expect(Object.isFrozen(budget)).toBe(true);
  });

  it("accepts a custom bounded budget", () => {
    expect(
      resolveInboxV2MigrationDdlBudget({
        lockTimeoutMs: 2_500,
        statementTimeoutMs: 300_000
      })
    ).toEqual({
      lockTimeoutMs: 2_500,
      statementTimeoutMs: 300_000
    });
  });

  it.each([
    [{ lockTimeoutMs: 0 }, "lockTimeoutMs"],
    [{ lockTimeoutMs: -1 }, "lockTimeoutMs"],
    [{ lockTimeoutMs: 1.5 }, "lockTimeoutMs"],
    [{ lockTimeoutMs: 60_001 }, "lockTimeoutMs"],
    [{ lockTimeoutMs: "5000" }, "lockTimeoutMs"],
    [{ statementTimeoutMs: 0 }, "statementTimeoutMs"],
    [{ statementTimeoutMs: Number.POSITIVE_INFINITY }, "statementTimeoutMs"],
    [{ statementTimeoutMs: 3_600_001 }, "statementTimeoutMs"]
  ])("rejects an unsafe timeout %#", (input, field) => {
    expect(() => resolveInboxV2MigrationDdlBudget(input)).toThrowError(
      new RegExp(`migration_ddl_budget_invalid.*${field}`, "u")
    );
  });

  it("requires the statement budget to cover the lock budget", () => {
    expect(() =>
      resolveInboxV2MigrationDdlBudget({
        lockTimeoutMs: 5_000,
        statementTimeoutMs: 4_999
      })
    ).toThrowError(
      /migration_ddl_budget_invalid.*greater than or equal to lockTimeoutMs/u
    );
  });

  it("applies the budget and work on one session, resets it, and returns evidence", async () => {
    const client = budgetClient();
    const work = vi.fn(async (migrationClient) => {
      expect(migrationClient).toBe(client);
      return "migration-result";
    });

    const result = await withInboxV2MigrationDdlBudget(
      client,
      { lockTimeoutMs: 2_500, statementTimeoutMs: 300_000 },
      work
    );

    expect(work).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("pg_catalog.set_config('lock_timeout'"),
      ["2500ms", "300000ms"]
    );
    expect(client.query).toHaveBeenNthCalledWith(2, "reset lock_timeout");
    expect(client.query).toHaveBeenNthCalledWith(3, "reset statement_timeout");
    expect(result).toEqual({
      result: "migration-result",
      evidence: {
        schemaId: "core:inbox-v2.migration-ddl-budget-evidence@v1",
        sessionScope: "lifecycle_advisory_lock_connection",
        sessionBackendPid: 4242,
        lockTimeoutMs: 2_500,
        statementTimeoutMs: 300_000,
        appliedLockTimeout: "2500ms",
        appliedStatementTimeout: "300000ms",
        sessionSettingsReset: true
      }
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
  });

  it("resets both settings and preserves the migration error", async () => {
    const client = budgetClient();
    const failure = new Error("migration failed");

    await expect(
      withInboxV2MigrationDdlBudget(client, {}, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);

    expect(client.query).toHaveBeenNthCalledWith(2, "reset lock_timeout");
    expect(client.query).toHaveBeenNthCalledWith(3, "reset statement_timeout");
  });

  it("resets both settings when applying the session budget fails", async () => {
    const client = budgetClient({ failApply: true });

    await expect(
      withInboxV2MigrationDdlBudget(client, {}, async () => undefined)
    ).rejects.toThrowError(/cannot apply migration budget/u);

    expect(client.query).toHaveBeenCalledWith("reset lock_timeout");
    expect(client.query).toHaveBeenCalledWith("reset statement_timeout");
  });

  it("attempts every reset and fails closed when cleanup is incomplete", async () => {
    const client = budgetClient({ failReset: "lock_timeout" });

    await expect(
      withInboxV2MigrationDdlBudget(client, {}, async () => undefined)
    ).rejects.toMatchObject({
      code: "inbox_v2.migration_ddl_budget_reset_failed"
    });

    expect(client.query).toHaveBeenCalledWith("reset lock_timeout");
    expect(client.query).toHaveBeenCalledWith("reset statement_timeout");
  });
});

function budgetClient(options = {}) {
  return {
    query: vi.fn(async (statement, parameters) => {
      if (statement.includes("pg_catalog.set_config('lock_timeout'")) {
        if (options.failApply === true) {
          throw new Error("cannot apply migration budget");
        }
        return {
          rows: [
            {
              session_backend_pid: 4242,
              applied_lock_timeout: parameters[0],
              applied_statement_timeout: parameters[1]
            }
          ]
        };
      }
      if (statement === `reset ${options.failReset}`) {
        throw new Error(`cannot reset ${options.failReset}`);
      }
      return { rows: [] };
    })
  };
}
