import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL } from "./inbox-v2/source-message-reconciliation";

const migrationPath = new URL(
  "../../drizzle/0045_inbox_v2_source_message_reconciliation.sql",
  import.meta.url
);
const migration = readFileSync(migrationPath, "utf8").replaceAll("\r\n", "\n");

describe("Inbox V2 source message reconciliation migration", () => {
  it("is an additive migration over the six reconciliation tables", () => {
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/iu);
    expect(migration).not.toMatch(
      /ALTER TABLE "(?!inbox_v2_(?:deferred_|source_message_(?:correlation_evidence|key_registry)))/u
    );
    for (const tableName of [
      "inbox_v2_source_message_key_registry",
      "inbox_v2_deferred_message_source_actions",
      "inbox_v2_deferred_message_source_action_transitions",
      "inbox_v2_deferred_source_action_conflict_candidates",
      "inbox_v2_deferred_source_action_ordering_heads",
      "inbox_v2_source_message_correlation_evidence"
    ]) {
      expect(migration).toContain(`CREATE TABLE "${tableName}"`);
    }
  });

  it("generates exact-key digests only where all full key columns exist", () => {
    expect(
      migration.match(/"message_key_digest_sha256" text GENERATED ALWAYS AS/gu)
    ).toHaveLength(3);
    const candidateTable = migration.slice(
      migration.indexOf(
        'CREATE TABLE "inbox_v2_deferred_source_action_conflict_candidates"'
      ),
      migration.indexOf(
        'CREATE TABLE "inbox_v2_deferred_source_action_ordering_heads"'
      )
    );
    expect(candidateTable).toContain(
      '"message_key_digest_sha256" text NOT NULL'
    );
    expect(candidateTable).not.toContain("GENERATED ALWAYS AS");
  });

  it("persists the reviewed weak-evidence identity and finite governance policy", () => {
    expect(migration).toContain(
      'CONSTRAINT "inbox_v2_source_message_correlation_evidence_identity_unique" UNIQUE("tenant_id","source_occurrence_id","code_id","evidence_hmac_sha256")'
    );
    expect(migration).toContain("core:operational_log_trace_diagnostic");
    expect(migration).toContain("security_evidence");
    expect(migration).toContain("core:source_replay_and_diagnostics");
    expect(migration).toContain("core:creation");
    expect(migration).toContain("interval '30 days'");
    expect(migration).toContain("source_correlation_evidence_expired");
  });

  it("allows target provenance without an applied effect for stale or duplicate actions", () => {
    expect(migration).toContain(
      "\"inbox_v2_deferred_message_source_action_transitions\".\"after_state\" in ('stale', 'duplicate')"
    );
    expect(migration).toContain(
      '"inbox_v2_deferred_message_source_action_transitions"."applied_message_revision" is null'
    );
    expect(migration).toContain(
      "inbox_v2.deferred_source_action_occurrence_resolution_mismatch"
    );
    expect(migration).toContain(
      "inbox_v2.deferred_source_action_historical_head_mismatch"
    );
    expect(migration).toContain(
      '"inbox_v2_deferred_message_source_action_transitions"."expected_ordering_head_revision" is not null'
    );
  });

  it("bounds provider ordering positions before numeric comparison", () => {
    expect(
      migration.match(
        /char_length\("[^"]+"\."(?:ordering|latest)_position"\) between 1 and 128/gu
      )
    ).toHaveLength(2);
  });

  it("indexes pending exact-key drains in stable action-id order", () => {
    expect(migration).toContain(
      'CREATE INDEX "inbox_v2_deferred_actions_pending_key_idx" ON "inbox_v2_deferred_message_source_actions" USING btree ("tenant_id","message_key_digest_sha256","id") WHERE "inbox_v2_deferred_message_source_actions"."state" = \'pending\''
    );
  });

  it("installs the reviewed immutable/CAS invariant tail verbatim", () => {
    expect(migration).toContain(
      "-- INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_FINALIZED_V1"
    );
    expect(migration).toContain(
      "--> statement-breakpoint\n-- INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_FINALIZED_V1"
    );
    expect(
      migration.endsWith(
        `${INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL.trim()}\n`
      )
    ).toBe(true);
    expect(migration).toContain(
      "create constraint trigger inbox_v2_deferred_source_action_constraint_trigger"
    );
    expect(migration).toContain(
      "create constraint trigger inbox_v2_deferred_source_action_constraint_trigger\nafter update"
    );
    expect(migration).not.toContain(
      "create constraint trigger inbox_v2_deferred_source_action_constraint_trigger\nafter insert or update"
    );
    expect(migration).toContain(
      "create trigger inbox_v2_source_correlation_evidence_guard_trigger"
    );
    expect(migration).toContain(
      "create trigger inbox_v2_deferred_source_action_key_registry_trigger\nafter insert"
    );
    expect(migration).toContain(
      "create trigger inbox_v2_deferred_source_head_key_registry_trigger\nafter insert or update"
    );
  });
});
