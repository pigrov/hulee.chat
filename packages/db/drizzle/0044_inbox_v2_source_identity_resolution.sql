CREATE TYPE "public"."inbox_v2_source_identity_assessment_confidence" AS ENUM('none', 'weak', 'strong', 'verified');--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_identity_assessment_outcome" AS ENUM('unresolved', 'conflicted', 'claimed_employee', 'claimed_client_contact');--> statement-breakpoint
CREATE TABLE "inbox_v2_source_identity_assessment_heads" (
	"tenant_id" text NOT NULL,
	"source_external_identity_id" text NOT NULL,
	"latest_assessment_id" text NOT NULL,
	"latest_assessment_version" bigint NOT NULL,
	"normalized_event_id" text NOT NULL,
	"observation_key" text NOT NULL,
	"safe_envelope_hmac_sha256" text NOT NULL,
	"outcome" "inbox_v2_source_identity_assessment_outcome" NOT NULL,
	"confidence" "inbox_v2_source_identity_assessment_confidence" NOT NULL,
	"assessment_digest_sha256" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_identity_assessment_heads_pk" PRIMARY KEY("tenant_id","source_external_identity_id"),
	CONSTRAINT "inbox_v2_identity_assessment_heads_values_check" CHECK ("inbox_v2_source_identity_assessment_heads"."latest_assessment_version" >= 1
        and char_length("inbox_v2_source_identity_assessment_heads"."observation_key") between 1 and 256
    and "inbox_v2_source_identity_assessment_heads"."observation_key" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and "inbox_v2_source_identity_assessment_heads"."safe_envelope_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_identity_assessment_heads"."assessment_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_identity_assessment_heads"."idempotency_key" ~ '^source:v2:identity-resolution:[0-9a-f]{64}$'
        and isfinite("inbox_v2_source_identity_assessment_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_identity_assessments" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"source_external_identity_id" text NOT NULL,
	"normalized_event_id" text NOT NULL,
	"observation_key" text NOT NULL,
	"safe_envelope_hmac_sha256" text NOT NULL,
	"previous_assessment_version" bigint,
	"assessment_version" bigint NOT NULL,
	"outcome" "inbox_v2_source_identity_assessment_outcome" NOT NULL,
	"confidence" "inbox_v2_source_identity_assessment_confidence" NOT NULL,
	"evidence" jsonb NOT NULL,
	"evidence_count" integer NOT NULL,
	"candidates" jsonb NOT NULL,
	"candidate_count" integer NOT NULL,
	"provenance" jsonb NOT NULL,
	"assessment_digest_sha256" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"claim_id" text,
	"claim_version" bigint,
	"claim_target_kind" "inbox_v2_source_identity_claim_target_kind",
	"claim_target_employee_id" text,
	"claim_target_client_contact_id" text,
	"claim_target_key" text GENERATED ALWAYS AS (case "claim_target_kind"
        when 'employee' then
          'employee|' || octet_length("claim_target_employee_id")::text || ':' || "claim_target_employee_id"
        when 'client_contact' then
          'client_contact|' || octet_length("claim_target_client_contact_id")::text || ':' || "claim_target_client_contact_id"
        else null
      end) STORED,
	"assessed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_identity_assessments_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_identity_assessments_version_unique" UNIQUE("tenant_id","source_external_identity_id","assessment_version"),
	CONSTRAINT "inbox_v2_identity_assessments_idempotency_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "inbox_v2_identity_assessments_exact_head_unique" UNIQUE("tenant_id","id","source_external_identity_id","assessment_version","normalized_event_id","observation_key","safe_envelope_hmac_sha256","outcome","confidence","assessment_digest_sha256","idempotency_key"),
	CONSTRAINT "inbox_v2_identity_assessments_id_check" CHECK (char_length("inbox_v2_source_identity_assessments"."id") <= 256
        and "inbox_v2_source_identity_assessments"."id" ~ '^source_identity_assessment:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'
        and "inbox_v2_source_identity_assessments"."idempotency_key" ~ '^source:v2:identity-resolution:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_identity_assessments_version_check" CHECK ("inbox_v2_source_identity_assessments"."assessment_version" >= 1
        and (
          ("inbox_v2_source_identity_assessments"."assessment_version" = 1
            and "inbox_v2_source_identity_assessments"."previous_assessment_version" is null)
          or ("inbox_v2_source_identity_assessments"."assessment_version" > 1
            and "inbox_v2_source_identity_assessments"."previous_assessment_version" = "inbox_v2_source_identity_assessments"."assessment_version" - 1)
        )),
	CONSTRAINT "inbox_v2_identity_assessments_json_check" CHECK (jsonb_typeof("inbox_v2_source_identity_assessments"."evidence") = 'array'
        and "inbox_v2_source_identity_assessments"."evidence_count" = jsonb_array_length("inbox_v2_source_identity_assessments"."evidence")
        and "inbox_v2_source_identity_assessments"."evidence_count" between 0 and 64
        and jsonb_typeof("inbox_v2_source_identity_assessments"."candidates") = 'array'
        and "inbox_v2_source_identity_assessments"."candidate_count" = jsonb_array_length("inbox_v2_source_identity_assessments"."candidates")
        and "inbox_v2_source_identity_assessments"."candidate_count" between 0 and 50
        and jsonb_typeof("inbox_v2_source_identity_assessments"."provenance") = 'object'
        and "inbox_v2_source_identity_assessments"."assessment_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_identity_assessments_outcome_check" CHECK ((
          "inbox_v2_source_identity_assessments"."outcome" = 'unresolved'
          and num_nonnulls(
            "inbox_v2_source_identity_assessments"."claim_id", "inbox_v2_source_identity_assessments"."claim_version", "inbox_v2_source_identity_assessments"."claim_target_kind",
            "inbox_v2_source_identity_assessments"."claim_target_employee_id",
            "inbox_v2_source_identity_assessments"."claim_target_client_contact_id", "inbox_v2_source_identity_assessments"."claim_target_key"
          ) = 0
        ) or (
          "inbox_v2_source_identity_assessments"."outcome" = 'conflicted'
          and "inbox_v2_source_identity_assessments"."evidence_count" >= 1
          and "inbox_v2_source_identity_assessments"."candidate_count" >= 2
          and num_nonnulls(
            "inbox_v2_source_identity_assessments"."claim_id", "inbox_v2_source_identity_assessments"."claim_version", "inbox_v2_source_identity_assessments"."claim_target_kind",
            "inbox_v2_source_identity_assessments"."claim_target_employee_id",
            "inbox_v2_source_identity_assessments"."claim_target_client_contact_id", "inbox_v2_source_identity_assessments"."claim_target_key"
          ) = 0
        ) or (
          "inbox_v2_source_identity_assessments"."outcome" = 'claimed_employee'
          and "inbox_v2_source_identity_assessments"."confidence" <> 'none'
          and "inbox_v2_source_identity_assessments"."evidence_count" >= 1
          and "inbox_v2_source_identity_assessments"."candidate_count" = 1
          and "inbox_v2_source_identity_assessments"."claim_id" is not null
          and "inbox_v2_source_identity_assessments"."claim_version" is not null
          and "inbox_v2_source_identity_assessments"."claim_target_kind" = 'employee'
          and "inbox_v2_source_identity_assessments"."claim_target_employee_id" is not null
          and "inbox_v2_source_identity_assessments"."claim_target_client_contact_id" is null
          and "inbox_v2_source_identity_assessments"."claim_target_key" is not null
        ) or (
          "inbox_v2_source_identity_assessments"."outcome" = 'claimed_client_contact'
          and "inbox_v2_source_identity_assessments"."confidence" <> 'none'
          and "inbox_v2_source_identity_assessments"."evidence_count" >= 1
          and "inbox_v2_source_identity_assessments"."candidate_count" = 1
          and "inbox_v2_source_identity_assessments"."claim_id" is not null
          and "inbox_v2_source_identity_assessments"."claim_version" is not null
          and "inbox_v2_source_identity_assessments"."claim_target_kind" = 'client_contact'
          and "inbox_v2_source_identity_assessments"."claim_target_employee_id" is null
          and "inbox_v2_source_identity_assessments"."claim_target_client_contact_id" is not null
          and "inbox_v2_source_identity_assessments"."claim_target_key" is not null
        )),
	CONSTRAINT "inbox_v2_identity_assessments_time_check" CHECK (isfinite("inbox_v2_source_identity_assessments"."assessed_at")
        and isfinite("inbox_v2_source_identity_assessments"."created_at")
        and "inbox_v2_source_identity_assessments"."created_at" = "inbox_v2_source_identity_assessments"."assessed_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_identity_observations" (
	"tenant_id" text NOT NULL,
	"normalized_event_id" text NOT NULL,
	"observation_key" text NOT NULL,
	"source_external_identity_id" text NOT NULL,
	"safe_envelope_hmac_sha256" text NOT NULL,
	"purpose" text NOT NULL,
	"observation_digest_sha256" text NOT NULL,
	"observed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_identity_observations_pk" PRIMARY KEY("tenant_id","normalized_event_id","observation_key"),
	CONSTRAINT "inbox_v2_identity_observations_exact_unique" UNIQUE("tenant_id","normalized_event_id","observation_key","source_external_identity_id","safe_envelope_hmac_sha256"),
	CONSTRAINT "inbox_v2_identity_observations_key_check" CHECK (char_length("inbox_v2_source_identity_observations"."observation_key") between 1 and 256
    and "inbox_v2_source_identity_observations"."observation_key" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and "inbox_v2_source_identity_observations"."purpose" in (
          'message_author', 'action_actor', 'membership_subject', 'roster_member'
        )),
	CONSTRAINT "inbox_v2_identity_observations_digest_check" CHECK ("inbox_v2_source_identity_observations"."safe_envelope_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_identity_observations"."observation_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_identity_observations_time_check" CHECK (isfinite("inbox_v2_source_identity_observations"."observed_at")
        and isfinite("inbox_v2_source_identity_observations"."created_at")
        and "inbox_v2_source_identity_observations"."created_at" >= "inbox_v2_source_identity_observations"."observed_at")
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_identity_assessment_heads" ADD CONSTRAINT "inbox_v2_identity_assessment_heads_identity_fk" FOREIGN KEY ("tenant_id","source_external_identity_id") REFERENCES "public"."inbox_v2_source_external_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_identity_assessment_heads" ADD CONSTRAINT "inbox_v2_identity_assessment_heads_latest_fk" FOREIGN KEY ("tenant_id","latest_assessment_id","source_external_identity_id","latest_assessment_version","normalized_event_id","observation_key","safe_envelope_hmac_sha256","outcome","confidence","assessment_digest_sha256","idempotency_key") REFERENCES "public"."inbox_v2_source_identity_assessments"("tenant_id","id","source_external_identity_id","assessment_version","normalized_event_id","observation_key","safe_envelope_hmac_sha256","outcome","confidence","assessment_digest_sha256","idempotency_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_identity_assessments" ADD CONSTRAINT "inbox_v2_identity_assessments_observation_fk" FOREIGN KEY ("tenant_id","normalized_event_id","observation_key","source_external_identity_id","safe_envelope_hmac_sha256") REFERENCES "public"."inbox_v2_source_identity_observations"("tenant_id","normalized_event_id","observation_key","source_external_identity_id","safe_envelope_hmac_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_identity_assessments" ADD CONSTRAINT "inbox_v2_identity_assessments_claim_fk" FOREIGN KEY ("tenant_id","claim_id","source_external_identity_id","claim_version","claim_target_kind","claim_target_key") REFERENCES "public"."inbox_v2_source_identity_claims"("tenant_id","id","source_external_identity_id","claim_version","target_kind","target_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_identity_observations" ADD CONSTRAINT "inbox_v2_identity_observations_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_identity_observations" ADD CONSTRAINT "inbox_v2_identity_observations_envelope_fk" FOREIGN KEY ("tenant_id","normalized_event_id","safe_envelope_hmac_sha256") REFERENCES "public"."inbox_v2_source_normalized_envelopes"("tenant_id","normalized_event_id","safe_envelope_hmac_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_identity_observations" ADD CONSTRAINT "inbox_v2_identity_observations_identity_fk" FOREIGN KEY ("tenant_id","source_external_identity_id") REFERENCES "public"."inbox_v2_source_external_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_v2_identity_assessment_heads_event_idx" ON "inbox_v2_source_identity_assessment_heads" USING btree ("tenant_id","normalized_event_id","observation_key","source_external_identity_id");--> statement-breakpoint
CREATE INDEX "inbox_v2_identity_assessments_observation_idx" ON "inbox_v2_source_identity_assessments" USING btree ("tenant_id","normalized_event_id","observation_key","assessment_version");--> statement-breakpoint
CREATE INDEX "inbox_v2_identity_observations_identity_idx" ON "inbox_v2_source_identity_observations" USING btree ("tenant_id","source_external_identity_id","observed_at","normalized_event_id","observation_key");
--> statement-breakpoint
-- INBOX_V2_SOURCE_IDENTITY_RESOLUTION_FINALIZED_V1
create or replace function public.inbox_v2_source_identity_resolution_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception using
    errcode = '23514',
    message = format('inbox_v2.source_identity_resolution_immutable:%s:%s', tg_table_name, tg_op);
end
$function$;

create or replace function public.inbox_v2_source_identity_assessment_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.latest_assessment_version <> 1 then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_assessment_head_initial_version';
    end if;
    return new;
  end if;

  if new.tenant_id <> old.tenant_id
     or new.source_external_identity_id <> old.source_external_identity_id
     or new.latest_assessment_version <> old.latest_assessment_version + 1
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_assessment_head_cas';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_source_identity_assessment_assert_local(
  p_tenant_id text,
  p_assessment_id text,
  p_source_external_identity_id text,
  p_assessment_version bigint
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_head public.inbox_v2_source_identity_assessment_heads%rowtype;
begin
  select * into v_head
  from public.inbox_v2_source_identity_assessment_heads h
  where h.tenant_id = p_tenant_id
    and h.source_external_identity_id = p_source_external_identity_id;

  if v_head.latest_assessment_version is null
     or v_head.latest_assessment_version < p_assessment_version then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_assessment_head_missing_or_behind';
  end if;

  if p_assessment_version > 1
     and not exists (
       select 1
       from public.inbox_v2_source_identity_assessments predecessor
       where predecessor.tenant_id = p_tenant_id
         and predecessor.source_external_identity_id = p_source_external_identity_id
         and predecessor.assessment_version = p_assessment_version - 1
         and predecessor.previous_assessment_version is not distinct from
           case when p_assessment_version = 2 then null else p_assessment_version - 2 end
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_assessment_predecessor_missing';
  end if;

  if v_head.latest_assessment_version = p_assessment_version then
    if v_head.latest_assessment_id <> p_assessment_id then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_assessment_head_pointer_mismatch';
    end if;
  elsif not exists (
    select 1
    from public.inbox_v2_source_identity_assessments successor
    where successor.tenant_id = p_tenant_id
      and successor.source_external_identity_id = p_source_external_identity_id
      and successor.assessment_version = p_assessment_version + 1
      and successor.previous_assessment_version = p_assessment_version
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_assessment_successor_missing';
  end if;
end
$function$;

create or replace function public.inbox_v2_source_identity_assessment_assert_head_local(
  p_tenant_id text,
  p_assessment_id text,
  p_source_external_identity_id text,
  p_assessment_version bigint
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_head public.inbox_v2_source_identity_assessment_heads%rowtype;
begin
  select * into v_head
  from public.inbox_v2_source_identity_assessment_heads h
  where h.tenant_id = p_tenant_id
    and h.source_external_identity_id = p_source_external_identity_id;

  if v_head.latest_assessment_version is null
     or v_head.latest_assessment_version < p_assessment_version then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_assessment_head_missing_or_behind';
  end if;

  if not exists (
       select 1
       from public.inbox_v2_source_identity_assessments current_assessment
       where current_assessment.tenant_id = p_tenant_id
         and current_assessment.id = p_assessment_id
         and current_assessment.source_external_identity_id = p_source_external_identity_id
         and current_assessment.assessment_version = p_assessment_version
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_assessment_head_pointer_missing';
  end if;

  if v_head.latest_assessment_version = p_assessment_version then
    if v_head.latest_assessment_id <> p_assessment_id
       or exists (
         select 1
         from public.inbox_v2_source_identity_assessments successor
         where successor.tenant_id = p_tenant_id
           and successor.source_external_identity_id = p_source_external_identity_id
           and successor.assessment_version = p_assessment_version + 1
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_assessment_head_not_latest';
    end if;
  elsif not exists (
    select 1
    from public.inbox_v2_source_identity_assessments successor
    where successor.tenant_id = p_tenant_id
      and successor.source_external_identity_id = p_source_external_identity_id
      and successor.assessment_version = p_assessment_version + 1
      and successor.previous_assessment_version = p_assessment_version
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_assessment_successor_missing';
  end if;
end
$function$;

create or replace function public.inbox_v2_source_identity_assessment_constraint()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_source_identity_assessment_assert_local(
    new.tenant_id,
    new.id,
    new.source_external_identity_id,
    new.assessment_version
  );
  return null;
end
$function$;

create or replace function public.inbox_v2_source_identity_assessment_head_constraint()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_source_identity_assessment_assert_head_local(
      new.tenant_id,
      new.latest_assessment_id,
      new.source_external_identity_id,
      new.latest_assessment_version
  );
  return null;
end
$function$;

drop trigger if exists inbox_v2_identity_observations_immutable_trigger
on public.inbox_v2_source_identity_observations;
create trigger inbox_v2_identity_observations_immutable_trigger
before update or delete on public.inbox_v2_source_identity_observations
for each row execute function public.inbox_v2_source_identity_resolution_reject_immutable();

drop trigger if exists inbox_v2_identity_assessments_immutable_trigger
on public.inbox_v2_source_identity_assessments;
create trigger inbox_v2_identity_assessments_immutable_trigger
before update or delete on public.inbox_v2_source_identity_assessments
for each row execute function public.inbox_v2_source_identity_resolution_reject_immutable();

drop trigger if exists inbox_v2_identity_assessment_heads_guard_trigger
on public.inbox_v2_source_identity_assessment_heads;
create trigger inbox_v2_identity_assessment_heads_guard_trigger
before insert or update on public.inbox_v2_source_identity_assessment_heads
for each row execute function public.inbox_v2_source_identity_assessment_head_guard();

drop trigger if exists inbox_v2_identity_assessment_heads_delete_trigger
on public.inbox_v2_source_identity_assessment_heads;
create trigger inbox_v2_identity_assessment_heads_delete_trigger
before delete on public.inbox_v2_source_identity_assessment_heads
for each row execute function public.inbox_v2_source_identity_resolution_reject_immutable();

drop trigger if exists inbox_v2_identity_assessments_constraint_trigger
on public.inbox_v2_source_identity_assessments;
create constraint trigger inbox_v2_identity_assessments_constraint_trigger
after insert on public.inbox_v2_source_identity_assessments
deferrable initially deferred
for each row execute function public.inbox_v2_source_identity_assessment_constraint();

drop trigger if exists inbox_v2_identity_assessment_heads_constraint_trigger
on public.inbox_v2_source_identity_assessment_heads;
create constraint trigger inbox_v2_identity_assessment_heads_constraint_trigger
after insert or update on public.inbox_v2_source_identity_assessment_heads
deferrable initially deferred
for each row execute function public.inbox_v2_source_identity_assessment_head_constraint();
