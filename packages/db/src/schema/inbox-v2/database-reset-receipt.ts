import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

/**
 * Durable completion receipt for an explicitly authorized disposable reset.
 *
 * The lifecycle command owns writes to this table. Application roles receive no
 * direct write grant, and the migration adds an immutable-row trigger. The
 * reset_generation is database-wide so a reviewed generation can never be
 * replayed with a different bootstrap tenant. tenant_id is intentionally not a
 * foreign key: lifecycle code snapshots and restores the complete ledger while
 * public is replaced, including history for a bootstrap tenant that may differ
 * from the next generation.
 */
export const inboxV2DatabaseResetReceipts = pgTable(
  "inbox_v2_database_reset_receipts",
  {
    tenantId: text("tenant_id").notNull(),
    resetGeneration: text("reset_generation").notNull(),
    manifestId: text("manifest_id").notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    migrationContractSha256: text("migration_contract_sha256").notNull(),
    bootstrapSha256: text("bootstrap_sha256").notNull(),
    mig001EvidenceSha256: text("mig_001_evidence_sha256").notNull(),
    objectReceiptSha256: text("object_receipt_sha256").notNull(),
    targetFingerprintSha256: text("target_fingerprint_sha256").notNull(),
    previousStreamEpoch: text("previous_stream_epoch"),
    streamEpoch: text("stream_epoch").notNull(),
    migrationJournalSha256: text("migration_journal_sha256").notNull(),
    databaseInventorySha256: text("database_inventory_sha256").notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_database_reset_receipts_pk",
      columns: [table.resetGeneration]
    }),
    unique("inbox_v2_database_reset_receipts_manifest_unique").on(
      table.manifestSha256
    ),
    index("inbox_v2_database_reset_receipts_tenant_idx").on(table.tenantId),
    check(
      "inbox_v2_database_reset_receipts_values_check",
      sql`char_length(${table.resetGeneration}) between 8 and 256
        and char_length(${table.manifestId}) between 3 and 256
        and ${table.manifestSha256} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.migrationContractSha256} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.bootstrapSha256} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.mig001EvidenceSha256} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.objectReceiptSha256} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.targetFingerprintSha256} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.migrationJournalSha256} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.databaseInventorySha256} ~ '^sha256:[0-9a-f]{64}$'
        and char_length(${table.streamEpoch}) between 8 and 256
        and (${table.previousStreamEpoch} is null
          or char_length(${table.previousStreamEpoch}) between 8 and 256)
        and isfinite(${table.completedAt})`
    )
  ]
);

export const INBOX_V2_DATABASE_RESET_RECEIPT_INVARIANT_SQL = `
create or replace function public.inbox_v2_database_reset_receipt_immutable_guard()
returns trigger
language plpgsql
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'inbox_v2.database_reset_receipt_immutable';
end;
$$;
--> statement-breakpoint
create trigger inbox_v2_database_reset_receipt_immutable_trigger
before update or delete on public.inbox_v2_database_reset_receipts
for each row execute function public.inbox_v2_database_reset_receipt_immutable_guard();
--> statement-breakpoint
create trigger inbox_v2_database_reset_receipt_truncate_guard_trigger
before truncate on public.inbox_v2_database_reset_receipts
for each statement execute function public.inbox_v2_database_reset_receipt_immutable_guard();
`.trim();

export const inboxV2DatabaseResetReceiptInvariantSql = sql.raw(
  INBOX_V2_DATABASE_RESET_RECEIPT_INVARIANT_SQL
);
