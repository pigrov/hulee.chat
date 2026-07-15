import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  inboxV2DatabaseResetReceiptInvariantSql,
  inboxV2DatabaseResetReceipts
} from "./inbox-v2/database-reset-receipt";

describe("Inbox V2 database reset completion receipt schema", () => {
  it("uses a database-wide generation identity and tenant index", () => {
    const config = getTableConfig(inboxV2DatabaseResetReceipts);
    expect(config.name).toBe("inbox_v2_database_reset_receipts");
    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(
      ["reset_generation"]
    );
    expect(
      config.uniqueConstraints
        .find(
          ({ name }) =>
            name === "inbox_v2_database_reset_receipts_manifest_unique"
        )
        ?.columns.map((column) => column.name)
    ).toEqual(["manifest_sha256"]);
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "inbox_v2_database_reset_receipts_tenant_idx"
    );
    expect(config.foreignKeys).toHaveLength(0);
  });

  it("stores every authority and post-state digest needed for idempotency", () => {
    const config = getTableConfig(inboxV2DatabaseResetReceipts);
    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "manifest_sha256",
        "migration_contract_sha256",
        "bootstrap_sha256",
        "mig_001_evidence_sha256",
        "object_receipt_sha256",
        "target_fingerprint_sha256",
        "migration_journal_sha256",
        "database_inventory_sha256",
        "stream_epoch"
      ])
    );
  });

  it("makes a completed receipt immutable", () => {
    const sql = new PgDialect()
      .sqlToQuery(inboxV2DatabaseResetReceiptInvariantSql)
      .sql.toLowerCase();
    expect(sql).toContain(
      "before update or delete on public.inbox_v2_database_reset_receipts"
    );
    expect(sql).toContain(
      "before truncate on public.inbox_v2_database_reset_receipts"
    );
    expect(sql).toContain("for each statement execute function");
    expect(sql).toContain("inbox_v2.database_reset_receipt_immutable");
  });
});
