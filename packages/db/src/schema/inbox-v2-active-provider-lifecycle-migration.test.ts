import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../../drizzle/0056_inbox_v2_active_provider_lifecycle_operation.sql",
  import.meta.url
);
const migration = readFileSync(migrationPath, "utf8").replaceAll("\r\n", "\n");

describe("Inbox V2 active provider lifecycle operation migration", () => {
  it("adds one reviewed partial unique Message fence without data mutation", () => {
    expect(migration).toContain(
      "-- INBOX_V2_ACTIVE_PROVIDER_LIFECYCLE_MIGRATION_FINALIZED_V1"
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "inbox_v2_provider_lifecycle_active_message_unique"'
    );
    expect(migration).toContain(
      'ON "inbox_v2_message_provider_lifecycle_operations" USING btree ("tenant_id","message_id")'
    );
    expect(migration).toContain("\"origin\" = 'hulee_requested'");
    for (const activeOutcome of ["pending", "accepted", "outcome_unknown"]) {
      expect(migration).toContain(`'${activeOutcome}'`);
    }
    expect(migration.match(/\bCREATE\s+UNIQUE\s+INDEX\b/giu)).toHaveLength(1);
    expect(migration).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/imu
    );
  });
});
