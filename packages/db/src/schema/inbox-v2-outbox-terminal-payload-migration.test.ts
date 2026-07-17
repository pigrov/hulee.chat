import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { INBOX_V2_OUTBOX_TERMINAL_PAYLOAD_REF_INTEGRITY_SQL } from "./inbox-v2/outbox-terminal-payload";

const migration = readFileSync(
  "packages/db/drizzle/0047_inbox_v2_outbox_terminal_payload_boundary.sql",
  "utf8"
);

describe("Inbox V2 terminal payload boundary migration", () => {
  it("backfills the canonical child and clears the immutable outcome reference", () => {
    const positions = [
      migration.indexOf('ADD COLUMN "payload_reference_recorded"'),
      migration.indexOf("$outbox_terminal_payload_legacy_coherence$"),
      migration.indexOf(
        "insert into public.inbox_v2_outbox_terminal_payload_refs"
      ),
      migration.indexOf("update public.inbox_v2_outbox_outcomes"),
      migration.lastIndexOf(
        'ADD CONSTRAINT "inbox_v2_outbox_outcomes_values_check"'
      )
    ];
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(
      positions.every(
        (position, index) => index === 0 || position > positions[index - 1]!
      )
    ).toBe(true);
    expect(migration).toContain(
      "disable trigger inbox_v2_outbox_outcome_immutable_trigger"
    );
    expect(migration).toContain(
      "enable trigger inbox_v2_outbox_outcome_immutable_trigger"
    );
    expect(migration).not.toMatch(
      /drop\s+column\s+(?:"?result_reference"?|"?terminal_result_reference"?)/iu
    );
  });

  it("keeps the N-1 finalize bridge and purge boundary under reviewed guards", () => {
    const normalizedMigration = migration
      .replace(/--> statement-breakpoint/gu, " ")
      .replace(/\s+/gu, " ");
    const normalizedInvariant =
      INBOX_V2_OUTBOX_TERMINAL_PAYLOAD_REF_INTEGRITY_SQL.replace(/\s+/gu, " ");
    expect(normalizedMigration).toContain(normalizedInvariant);
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain(
      "inbox_v2_outbox_legacy_outcome_payload_bridge_trigger"
    );
    expect(migration).toContain(
      "inbox_v2_outbox_legacy_work_payload_bridge_trigger"
    );
    expect(migration).toContain(
      "inbox_v2_outbox_terminal_payload_refs_coherence"
    );
    expect(migration).toContain(
      "inbox_v2_outbox_terminal_payload_refs_insert_guard"
    );
    expect(migration).toContain(
      "before delete on public.inbox_v2_outbox_terminal_payload_refs"
    );
    expect(migration).toContain(
      "current_user = 'hulee_inbox_v2_retention_owner'"
    );
    expect(migration).toContain("grant select, insert on table");
    expect(migration).toContain(
      "grant update (terminal_result_reference) on table"
    );
    expect(migration).toContain(
      "inbox_v2.outbox_terminal_payload_retention_boundary_invalid"
    );
    expect(migration).not.toContain("grant select, insert, delete on table");
  });
});
