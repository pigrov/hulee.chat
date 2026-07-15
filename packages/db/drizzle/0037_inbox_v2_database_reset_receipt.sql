CREATE TABLE "inbox_v2_database_reset_receipts" (
	"tenant_id" text NOT NULL,
	"reset_generation" text NOT NULL,
	"manifest_id" text NOT NULL,
	"manifest_sha256" text NOT NULL,
	"migration_contract_sha256" text NOT NULL,
	"bootstrap_sha256" text NOT NULL,
	"mig_001_evidence_sha256" text NOT NULL,
	"object_receipt_sha256" text NOT NULL,
	"target_fingerprint_sha256" text NOT NULL,
	"previous_stream_epoch" text,
	"stream_epoch" text NOT NULL,
	"migration_journal_sha256" text NOT NULL,
	"database_inventory_sha256" text NOT NULL,
	"completed_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_database_reset_receipts_pk" PRIMARY KEY("reset_generation"),
	CONSTRAINT "inbox_v2_database_reset_receipts_manifest_unique" UNIQUE("manifest_sha256"),
	CONSTRAINT "inbox_v2_database_reset_receipts_values_check" CHECK (char_length("inbox_v2_database_reset_receipts"."reset_generation") between 8 and 256
        and char_length("inbox_v2_database_reset_receipts"."manifest_id") between 3 and 256
        and "inbox_v2_database_reset_receipts"."manifest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_database_reset_receipts"."migration_contract_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_database_reset_receipts"."bootstrap_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_database_reset_receipts"."mig_001_evidence_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_database_reset_receipts"."object_receipt_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_database_reset_receipts"."target_fingerprint_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_database_reset_receipts"."migration_journal_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_database_reset_receipts"."database_inventory_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_database_reset_receipts"."stream_epoch") between 8 and 256
        and ("inbox_v2_database_reset_receipts"."previous_stream_epoch" is null
          or char_length("inbox_v2_database_reset_receipts"."previous_stream_epoch") between 8 and 256)
        and isfinite("inbox_v2_database_reset_receipts"."completed_at"))
);
--> statement-breakpoint
CREATE INDEX "inbox_v2_database_reset_receipts_tenant_idx" ON "inbox_v2_database_reset_receipts" USING btree ("tenant_id");
--> statement-breakpoint
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
