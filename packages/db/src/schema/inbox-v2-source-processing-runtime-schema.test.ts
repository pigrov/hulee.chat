import { readFileSync } from "node:fs";

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL,
  inboxV2SourceAccountPressureHeads,
  inboxV2SourceDeliveryDedupeSkeletons,
  inboxV2SourceDeliveryOutcome,
  inboxV2SourceIngressCursorCheckpoints,
  inboxV2SourceProcessingAttempts,
  inboxV2SourceProcessingDeadLetters,
  inboxV2SourceProcessingKeyGenerations,
  inboxV2SourceProcessingStage,
  inboxV2SourceProcessingWorkHeads,
  inboxV2SourceReplayRequests
} from "./inbox-v2/source-processing-runtime";
import { INBOX_V2_SOURCE_RAW_ADMISSION_INTEGRITY_SQL } from "./inbox-v2/source-raw-ingress";
import { initialTables } from "./metadata";

const runtimeTables = [
  inboxV2SourceProcessingKeyGenerations,
  inboxV2SourceDeliveryDedupeSkeletons,
  inboxV2SourceProcessingWorkHeads,
  inboxV2SourceProcessingAttempts,
  inboxV2SourceProcessingDeadLetters,
  inboxV2SourceReplayRequests,
  inboxV2SourceAccountPressureHeads,
  inboxV2SourceIngressCursorCheckpoints
] as const;

const migration = readFileSync(
  new URL(
    "../../drizzle/0048_inbox_v2_source_processing_runtime.sql",
    import.meta.url
  ),
  "utf8"
).replaceAll("\r\n", "\n");

describe("Inbox V2 source processing runtime schema", () => {
  it("adds eight tenant-scoped runtime tables and preserves the N-1 stage enum", () => {
    expect(runtimeTables.map((table) => getTableConfig(table).name)).toEqual([
      "inbox_v2_source_processing_key_generations",
      "inbox_v2_source_delivery_dedupe_skeletons",
      "inbox_v2_source_processing_work_heads",
      "inbox_v2_source_processing_attempts",
      "inbox_v2_source_processing_dead_letters",
      "inbox_v2_source_replay_requests",
      "inbox_v2_source_account_pressure_heads",
      "inbox_v2_source_ingress_cursor_checkpoints"
    ]);
    for (const table of runtimeTables) {
      expect(columnNames(table)[0]).toBe("tenant_id");
      expect(
        initialTables.find((entry) => entry.name === getTableConfig(table).name)
      ).toMatchObject({ scope: "tenant", requiresTenantId: true });
    }
    expect(inboxV2SourceProcessingStage.enumValues).toEqual([
      "raw_ingest",
      "normalization",
      "identity_resolution",
      "conversation_resolution",
      "routing",
      "message_reconciliation",
      "materialization"
    ]);
  });

  it("keeps dedupe evidence generation-pinned, finite and HMAC-only", () => {
    expect(inboxV2SourceDeliveryOutcome.enumValues).toEqual([
      "processed",
      "ignored",
      "duplicate",
      "dead_lettered"
    ]);
    expect(columnNames(inboxV2SourceDeliveryDedupeSkeletons)).toEqual(
      expect.arrayContaining([
        "key_generation",
        "key_verify_until",
        "identity_hmac_sha256",
        "outcome_hmac_sha256",
        "evidence_captured_at",
        "raw_payload_expires_at",
        "allowed_raw_headers_expires_at",
        "normalized_payload_expires_at",
        "guarantee_until",
        "replay_until",
        "skeleton_expires_at",
        "revision",
        "updated_at"
      ])
    );
    expect(columnNames(inboxV2SourceDeliveryDedupeSkeletons)).not.toEqual(
      expect.arrayContaining([
        "external_event_id",
        "external_message_id",
        "payload",
        "identity_digest_sha256",
        "outcome_digest_sha256"
      ])
    );
    const identity = checkSql(
      inboxV2SourceDeliveryDedupeSkeletons,
      "inbox_v2_src_dedupe_identity_check"
    );
    expect(identity).toContain("core:source_replay_and_diagnostics");
    expect(identity).toContain("^hmac-sha256:[0-9a-f]{64}$");
    expect(identity).not.toContain('identity_hmac_sha256" <> ');
    const window = checkSql(
      inboxV2SourceDeliveryDedupeSkeletons,
      "inbox_v2_src_dedupe_window_check"
    );
    expect(window).toContain("key_verify_until");
    expect(window).toContain("normalized_payload_expires_at");
    const ddl = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL;
    expect(ddl).toContain("old.replayability_state = 'replayable'");
    expect(ddl).toContain("new.replayability_state = 'expired'");
    expect(ddl).toContain("new.revision <> old.revision + 1");
    expect(ddl).toContain("v_replay_deadline := case");
    expect(ddl).toContain("new.updated_at < v_replay_deadline");
    expect(ddl).not.toContain("or new.updated_at >= new.skeleton_expires_at");
    expect(ddl).toContain("or new.updated_at < old.updated_at");
    expect(ddl).toContain("old.replayability_state = 'replayable'");
    expect(ddl).toContain(
      "Invalid dedupe skeleton lifecycle expiry transition"
    );
  });

  it("makes raw-admission handoff and skeleton retention mutually coherent", () => {
    expect(
      getTableConfig(
        inboxV2SourceProcessingKeyGenerations
      ).uniqueConstraints.map((constraint) => constraint.name)
    ).toContain("inbox_v2_src_proc_key_exact_unique");
    const ddl = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL;
    for (const fragment of [
      "inbox_v2_source_raw_admissions_processing_key_fk",
      "tenant_id, purpose_id, key_generation, hmac_key_secret_ref",
      "inbox_v2_src_runtime_raw_admission_terminal_skeleton_coherence",
      "inbox_v2_src_runtime_terminal_skeleton_admission_coherence",
      "Raw admission handoff requires its exact terminal skeleton",
      "Terminal skeleton remains referenced by a raw admission",
      "admission_row.hmac_key_secret_ref = old.secret_ref",
      "quarantine_row.event_identity_hmac_key_secret_ref =",
      "admission_row.terminal_skeleton_id = old.id"
    ]) {
      expect(ddl).toContain(fragment);
    }
    expect(ddl).toContain("deferrable initially deferred");
  });

  it("stops HMAC issuance on early rotation without shortening verification", () => {
    const ddl = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL;
    const keyGuard = ddl.slice(
      ddl.indexOf(
        "create or replace function public.inbox_v2_src_proc_key_guard()"
      ),
      ddl.indexOf(
        "create or replace function public.inbox_v2_src_dedupe_guard()"
      )
    );
    expect(keyGuard).toContain("old.state = 'active'");
    expect(keyGuard).toContain("new.state = 'verify_only'");
    expect(keyGuard).toContain("new.updated_at >= old.activated_at");
    expect(keyGuard).toContain("or new.updated_at < old.updated_at");
    expect(keyGuard).not.toContain("or new.updated_at <= old.updated_at");
    expect(keyGuard).not.toContain("new.updated_at >= old.use_until");
    expect(keyGuard).toContain("new.updated_at >= old.verify_until");
    expect(keyGuard).toContain("old.state = 'verify_only'");
    expect(keyGuard).toContain("new.state = 'retired'");
    expect(keyGuard).not.toContain(
      "old.state = 'active'\n         and new.state = 'retired'"
    );

    const dedupeGuard = ddl.slice(
      ddl.indexOf(
        "create or replace function public.inbox_v2_src_dedupe_guard()"
      ),
      ddl.indexOf("create or replace function public.inbox_v2_src_work_guard()")
    );
    expect(dedupeGuard).toContain(
      "v_key.state not in ('active', 'verify_only')"
    );
    expect(dedupeGuard).toContain("or new.updated_at < old.updated_at");
    expect(dedupeGuard).not.toContain("or new.updated_at <= old.updated_at");
    expect(dedupeGuard).toContain("clock_timestamp() >= v_key.verify_until");
    expect(dedupeGuard).toContain("old.replayability_state = 'replayable'");
    expect(dedupeGuard).toContain(
      "new.replayability_state <> old.replayability_state"
    );
  });

  it("stores opaque work identity, lossless safe attempts and exact replay hashes", () => {
    expect(primaryKeyColumns(inboxV2SourceProcessingWorkHeads)).toEqual([
      ["tenant_id", "work_id"]
    ]);
    expect(columnNames(inboxV2SourceProcessingAttempts)).toEqual(
      expect.arrayContaining([
        "attempt_id",
        "work_id",
        "origin",
        "diagnostic_code_id",
        "retryability",
        "diagnostic_correlation_token",
        "diagnostic_safe_operator_hint_id"
      ])
    );
    expect(columnNames(inboxV2SourceReplayRequests)).toEqual(
      expect.arrayContaining([
        "request_hash",
        "reason_id",
        "target_work_id",
        "normalized_event_scope_key",
        "source_connection_id",
        "source_account_id",
        "source_account_scope_key",
        "dead_letter_id",
        "expires_at",
        "stage",
        "expected_target_revision",
        "rejection_reason",
        "diagnostic_code_id",
        "diagnostic_retryability",
        "diagnostic_correlation_token",
        "diagnostic_safe_operator_hint_id"
      ])
    );
    expect(columnNames(inboxV2SourceReplayRequests)).not.toEqual(
      expect.arrayContaining(["request_hmac_sha256", "key_generation"])
    );
    expect(
      checkSql(
        inboxV2SourceReplayRequests,
        "inbox_v2_src_replay_identity_check"
      )
    ).toContain("^sha256:[0-9a-f]{64}$");

    const workGuard = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL.slice(
      INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL.indexOf(
        "create or replace function public.inbox_v2_src_work_guard()"
      ),
      INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL.indexOf(
        "create or replace function public.inbox_v2_src_attempt_guard()"
      )
    );
    expect(workGuard).toContain("or new.work_id <> v_expected_work_id");
    expect(workGuard).not.toContain(
      "new.stage in ('raw_ingest', 'normalization')\n         and new.work_id <> v_expected_work_id"
    );
  });

  it("rejects cross-target replay and proves the exact dead-letter generation", () => {
    const deadLetterColumn = getTableConfig(
      inboxV2SourceReplayRequests
    ).columns.find((column) => column.name === "dead_letter_id");
    expect(deadLetterColumn?.notNull).toBe(false);
    const state = checkSql(
      inboxV2SourceReplayRequests,
      "inbox_v2_src_replay_state_check"
    );
    expect(state).toContain('dead_letter_id" is not null');
    const ddl = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL;
    for (const fragment of [
      "work_row.work_id = new.target_work_id",
      "v_target_work.state <> 'dead_lettered'",
      "v_dlq.processing_generation <>",
      "v_target_work.processing_generation",
      "v_dlq.work_revision <> v_target_work.revision",
      "request_row.target_work_id = old.work_id",
      "request_row.source_account_id is not distinct from",
      "new.result_work_id <> new.target_work_id",
      "new.result_work_revision <> new.expected_target_revision + 1",
      "v_dlq.processing_generation + 1",
      "inbox_v2_source_raw_evidence evidence_row",
      "inbox_v2_source_normalized_evidence_payloads payload_row"
    ]) {
      expect(ddl).toContain(fragment);
    }
    expect(ddl).toContain("new.state in ('denied', 'expired')");
    expect(ddl).toContain("new.dead_letter_id is not null");
    expect(ddl).toContain("Terminal replay DLQ snapshot is incoherent");
    expect(ddl).not.toContain(
      "old.state in ('processed', 'ignored', 'duplicate', 'dead_lettered')"
    );
  });

  it("enforces the four-step replay transaction and exact active DLQ closure", () => {
    const ddl = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL;

    expect(ddl).toContain("if new.state = 'pending' and (");
    expect(ddl).toContain("new.dead_letter_id is null");
    expect(ddl).toContain(
      "if old.state = 'pending' and new.state = 'leased' then"
    );
    expect(ddl).toContain(
      "if old.state = 'dead_lettered' and new.state = 'pending' then"
    );
    expect(ddl).toContain(
      "if old.state = 'leased' and new.state = 'applied' then"
    );
    expect(ddl).toContain(
      "new.result_work_revision <> new.expected_target_revision + 1"
    );
  });

  it("persists denied and expired replay decisions with DB-time boundaries", () => {
    const state = checkSql(
      inboxV2SourceReplayRequests,
      "inbox_v2_src_replay_state_check"
    );
    const times = checkSql(
      inboxV2SourceReplayRequests,
      "inbox_v2_src_replay_times_check"
    );
    expect(state).toContain("rejection_reason\" <> 'replay_expired'");
    expect(state).toContain("rejection_reason\" = 'replay_expired'");
    expect(times).toContain("state\" = 'denied'");
    expect(times).toContain('updated_at" >=');
    expect(times).toContain(
      'isfinite("inbox_v2_source_replay_requests"."expires_at")'
    );
    expect(times).toContain('dead_letter_id" is null');
    expect(times).toContain('dead_letter_id" is not null');
    expect(times).toContain('replay_not_after" <=');
    const ddl = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL;
    expect(ddl).toContain("new.state not in ('pending', 'denied', 'expired')");
    expect(ddl).toContain("new.updated_at > clock_timestamp()");
    expect(ddl).toContain("clock_timestamp() < new.replay_not_after");
    expect(ddl).toContain(
      "old.state in ('pending', 'leased') and new.state = 'denied'"
    );
    expect(ddl).toContain(
      "Replay request cannot expire before its DB deadline"
    );
  });

  it("retains replay snapshots without hard ephemeral FKs and deletes bounded history in dependency order", () => {
    const replayConfig = getTableConfig(inboxV2SourceReplayRequests);
    const forbiddenReplayForeignKeys = new Set([
      "inbox_v2_src_replay_target_work_fk",
      "inbox_v2_src_replay_raw_fk",
      "inbox_v2_src_replay_normalized_fk",
      "inbox_v2_src_replay_connection_fk",
      "inbox_v2_src_replay_account_fk",
      "inbox_v2_src_replay_dlq_fk",
      "inbox_v2_src_replay_employee_fk",
      "inbox_v2_src_replay_result_work_fk"
    ]);
    expect(
      replayConfig.foreignKeys
        .map((foreignKey) => foreignKey.getName())
        .filter((name) => forbiddenReplayForeignKeys.has(name))
    ).toEqual([]);

    const ddl = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL;
    for (const fragment of [
      "old.state not in ('applied', 'denied', 'expired')",
      "clock_timestamp() < old.expires_at",
      "work_row.processing_generation =",
      "old.result_processing_generation",
      "Source replay request is not retention eligible",
      "replay_row.dead_letter_id = old.id",
      "old.state not in (\n         'processed', 'ignored', 'duplicate', 'dead_lettered'",
      "replay_row.target_work_id = old.work_id",
      "cursor_row.durable_work_id = old.work_id",
      "Source processing work head still has runtime dependents",
      "public.inbox_v2_source_processing_work_heads,",
      "public.inbox_v2_source_replay_requests\nto hulee_inbox_v2_retention_owner"
    ]) {
      expect(ddl).toContain(fragment);
    }
    expect(ddl).toContain("new.expires_at > v_dlq.expires_at");
  });

  it("binds cursor acknowledgements to exact raw-work or quarantine targets", () => {
    expect(columnNames(inboxV2SourceIngressCursorCheckpoints)).toEqual(
      expect.arrayContaining([
        "cursor_owner",
        "cursor_kind",
        "source_thread_binding_id",
        "cursor_value_secret_ref",
        "durable_target_kind",
        "last_durable_raw_event_id",
        "durable_work_id",
        "durable_work_revision",
        "durable_work_state",
        "quarantine_id",
        "quarantine_fingerprint_sha256",
        "persisted_at",
        "acknowledged_at"
      ])
    );
    expect(INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL).toContain(
      "new.durable_target_kind = 'raw_work'"
    );
    expect(INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL).toContain(
      "new.durable_target_kind = 'quarantine'"
    );
    expect(INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL).toContain(
      "v_quarantine.quarantine_fingerprint_sha256"
    );
    expect(columnNames(inboxV2SourceIngressCursorCheckpoints)).not.toContain(
      "cursor_secret_ref"
    );
    const ddl = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL;
    expect(ddl).toContain("inbox_v2.source_processing_hmac");
    expect(ddl).toContain("inbox_v2.source_cursor_value");
    expect(ddl).toContain("v_key.secret_ref = new.cursor_value_secret_ref");
    expect(ddl).toContain(
      "cursor_row.cursor_value_secret_ref = old.secret_ref"
    );
    const cursorGuard = ddl.slice(
      ddl.indexOf(
        "create or replace function public.inbox_v2_src_cursor_guard()"
      ),
      ddl.indexOf(
        "create or replace function public.inbox_v2_src_raw_runtime_bridge()"
      )
    );
    expect(cursorGuard).toContain("if new.revision <> 1 then");
    expect(cursorGuard).not.toContain("new.created_at <> new.updated_at");
  });

  it("reclaims an infrastructure-expired lease at the same attempt fence only", () => {
    const ddl = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL;
    expect(ddl).toContain("Invalid same-attempt expired lease reclaim");
    expect(ddl).toContain("new.attempt_count <> old.attempt_count");
    expect(ddl).toContain("new.lease_token_hash = old.lease_token_hash");
    expect(ddl).toContain(
      "attempt_row.processing_generation =\n                old.processing_generation"
    );
    expect(ddl).toContain("attempt_row.attempt_number = old.attempt_count");
    expect(ddl).not.toContain(
      "new.state in ('pending', 'retry_scheduled')\n     and clock_timestamp() >= old.lease_expires_at"
    );
  });

  it("installs strict transitions, immutable history, pressure closure and raw bridge", () => {
    const ddl = INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL;
    for (const fragment of [
      "create or replace function public.inbox_v2_src_proc_key_guard()",
      "create or replace function public.inbox_v2_src_work_guard()",
      "create or replace function public.inbox_v2_src_assert_work_closure()",
      "create or replace function public.inbox_v2_src_assert_pressure()",
      "create trigger inbox_v2_src_raw_runtime_bridge_trigger",
      "after insert on public.inbox_v2_source_raw_work_items",
      "'raw_ingest'",
      "'normalization'",
      "from public",
      "to hulee_inbox_v2_runtime",
      "to hulee_inbox_v2_retention_owner"
    ]) {
      expect(ddl).toContain(fragment);
    }
    expect(ddl).toContain("Source processing attempts are immutable");
    expect(ddl).toContain("Source processing dead-letter facts are immutable");
    expect(ddl).toContain("deferrable initially deferred");
    expect(ddl).toContain(
      "if v_route_generation is null then\n    return new;"
    );
    expect(ddl).not.toContain(
      "Raw runtime bridge requires current source route authority"
    );
    const rawBridge = ddl.slice(
      ddl.indexOf(
        "create or replace function public.inbox_v2_src_raw_runtime_bridge()"
      ),
      ddl.indexOf("create trigger inbox_v2_src_proc_key_guard_trigger")
    );
    expect(rawBridge).toContain("'raw_ingest'");
    expect(rawBridge).not.toContain("'normalization'");
    expect(rawBridge).not.toContain("10000000");
    expect(rawBridge).not.toContain(
      "insert into public.inbox_v2_source_account_pressure_heads"
    );
    expect(ddl).toContain("and work_row.stage <> 'raw_ingest'");
    expect(ddl).toContain("Runtime work requires a pressure head");
  });

  it("ships additive migration 0048 with the reviewed integrity tail", () => {
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/iu);
    for (const table of runtimeTables) {
      expect(migration).toContain(
        `CREATE TABLE "${getTableConfig(table).name}"`
      );
    }
    expect(migration).toContain(
      "--> statement-breakpoint\n-- INBOX_V2_SOURCE_PROCESSING_RUNTIME_FINALIZED_V1"
    );
    expect(migration).toContain(
      "--> statement-breakpoint\n-- INBOX_V2_SOURCE_RAW_ADMISSION_FINALIZED_V1"
    );
    expect(
      migration.indexOf("INBOX_V2_SOURCE_RAW_ADMISSION_FINALIZED_V1")
    ).toBeLessThan(
      migration.indexOf("INBOX_V2_SOURCE_PROCESSING_RUNTIME_FINALIZED_V1")
    );
    expect(migration.replace(/\s+/gu, " ")).toContain(
      INBOX_V2_SOURCE_RAW_ADMISSION_INTEGRITY_SQL.replace(/\s+/gu, " ").trim()
    );
    expect(migration.replace(/\s+/gu, " ")).toContain(
      INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL.replace(
        /\s+/gu,
        " "
      ).trim()
    );
  });
});

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function primaryKeyColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  return getTableConfig(table).primaryKeys.map((primaryKey) =>
    primaryKey.columns.map((column) => column.name)
  );
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing check constraint: ${name}`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
}
