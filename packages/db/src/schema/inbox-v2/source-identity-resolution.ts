import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

import { tenants } from "../tables";
import {
  inboxV2SourceExternalIdentities,
  inboxV2SourceIdentityClaims,
  inboxV2SourceIdentityClaimTargetKind
} from "./identity-foundation";
import { inboxV2SourceNormalizedEnvelopes } from "./source-normalization";

export const inboxV2SourceIdentityAssessmentOutcome = pgEnum(
  "inbox_v2_source_identity_assessment_outcome",
  ["unresolved", "conflicted", "claimed_employee", "claimed_client_contact"]
);

export const inboxV2SourceIdentityAssessmentConfidence = pgEnum(
  "inbox_v2_source_identity_assessment_confidence",
  ["none", "weak", "strong", "verified"]
);

type CanonicalEvidence = readonly Readonly<Record<string, unknown>>[];
type CanonicalCandidates = readonly Readonly<Record<string, unknown>>[];
type CanonicalProvenance = Readonly<Record<string, unknown>>;

/**
 * Immutable proof that one exact SRC-003 identity observation was materialized
 * as one SourceExternalIdentity. The normalized envelope remains the authentic
 * source; this row is a compact, queryable binding and never stores raw content.
 */
export const inboxV2SourceIdentityObservations = pgTable(
  "inbox_v2_source_identity_observations",
  {
    tenantId: text("tenant_id").notNull(),
    normalizedEventId: text("normalized_event_id").notNull(),
    observationKey: text("observation_key").notNull(),
    sourceExternalIdentityId: text("source_external_identity_id").notNull(),
    safeEnvelopeHmacSha256: text("safe_envelope_hmac_sha256").notNull(),
    purpose: text("purpose").notNull(),
    observationDigestSha256: text("observation_digest_sha256").notNull(),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_identity_observations_pk",
      columns: [table.tenantId, table.normalizedEventId, table.observationKey]
    }),
    unique("inbox_v2_identity_observations_exact_unique").on(
      table.tenantId,
      table.normalizedEventId,
      table.observationKey,
      table.sourceExternalIdentityId,
      table.safeEnvelopeHmacSha256
    ),
    foreignKey({
      name: "inbox_v2_identity_observations_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_identity_observations_envelope_fk",
      columns: [
        table.tenantId,
        table.normalizedEventId,
        table.safeEnvelopeHmacSha256
      ],
      foreignColumns: [
        inboxV2SourceNormalizedEnvelopes.tenantId,
        inboxV2SourceNormalizedEnvelopes.normalizedEventId,
        inboxV2SourceNormalizedEnvelopes.safeEnvelopeHmacSha256
      ]
    }),
    foreignKey({
      name: "inbox_v2_identity_observations_identity_fk",
      columns: [table.tenantId, table.sourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    check(
      "inbox_v2_identity_observations_key_check",
      sql`${routingTokenSql(table.observationKey)}
        and ${table.purpose} in (
          'message_author', 'action_actor', 'membership_subject', 'roster_member'
        )`
    ),
    check(
      "inbox_v2_identity_observations_digest_check",
      sql`${hmacSha256Sql(table.safeEnvelopeHmacSha256)}
        and ${sha256Sql(table.observationDigestSha256)}`
    ),
    check(
      "inbox_v2_identity_observations_time_check",
      sql`isfinite(${table.observedAt})
        and isfinite(${table.createdAt})
        and ${table.createdAt} >= ${table.observedAt}`
    ),
    index("inbox_v2_identity_observations_identity_idx").on(
      table.tenantId,
      table.sourceExternalIdentityId,
      table.observedAt,
      table.normalizedEventId,
      table.observationKey
    )
  ]
);

/**
 * One immutable resolver assessment. Evidence, candidates and provenance are
 * strict contract values in the repository and are retained with one canonical
 * digest so retries cannot silently change a decision under the same key.
 */
export const inboxV2SourceIdentityAssessments = pgTable(
  "inbox_v2_source_identity_assessments",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    sourceExternalIdentityId: text("source_external_identity_id").notNull(),
    normalizedEventId: text("normalized_event_id").notNull(),
    observationKey: text("observation_key").notNull(),
    safeEnvelopeHmacSha256: text("safe_envelope_hmac_sha256").notNull(),
    previousAssessmentVersion: bigint("previous_assessment_version", {
      mode: "bigint"
    }),
    assessmentVersion: bigint("assessment_version", {
      mode: "bigint"
    }).notNull(),
    outcome: inboxV2SourceIdentityAssessmentOutcome("outcome").notNull(),
    confidence:
      inboxV2SourceIdentityAssessmentConfidence("confidence").notNull(),
    evidence: jsonb("evidence").$type<CanonicalEvidence>().notNull(),
    evidenceCount: integer("evidence_count").notNull(),
    candidates: jsonb("candidates").$type<CanonicalCandidates>().notNull(),
    candidateCount: integer("candidate_count").notNull(),
    provenance: jsonb("provenance").$type<CanonicalProvenance>().notNull(),
    assessmentDigestSha256: text("assessment_digest_sha256").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    claimId: text("claim_id"),
    claimVersion: bigint("claim_version", { mode: "bigint" }),
    claimTargetKind: inboxV2SourceIdentityClaimTargetKind("claim_target_kind"),
    claimTargetEmployeeId: text("claim_target_employee_id"),
    claimTargetClientContactId: text("claim_target_client_contact_id"),
    claimTargetKey: text("claim_target_key").generatedAlwaysAs(
      sql`case ${sql.identifier("claim_target_kind")}
        when 'employee' then
          'employee|' || octet_length(${sql.identifier("claim_target_employee_id")})::text || ':' || ${sql.identifier("claim_target_employee_id")}
        when 'client_contact' then
          'client_contact|' || octet_length(${sql.identifier("claim_target_client_contact_id")})::text || ':' || ${sql.identifier("claim_target_client_contact_id")}
        else null
      end`
    ),
    assessedAt: timestamp("assessed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_identity_assessments_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_identity_assessments_version_unique").on(
      table.tenantId,
      table.sourceExternalIdentityId,
      table.assessmentVersion
    ),
    unique("inbox_v2_identity_assessments_idempotency_unique").on(
      table.tenantId,
      table.idempotencyKey
    ),
    unique("inbox_v2_identity_assessments_exact_head_unique").on(
      table.tenantId,
      table.id,
      table.sourceExternalIdentityId,
      table.assessmentVersion,
      table.normalizedEventId,
      table.observationKey,
      table.safeEnvelopeHmacSha256,
      table.outcome,
      table.confidence,
      table.assessmentDigestSha256,
      table.idempotencyKey
    ),
    foreignKey({
      name: "inbox_v2_identity_assessments_observation_fk",
      columns: [
        table.tenantId,
        table.normalizedEventId,
        table.observationKey,
        table.sourceExternalIdentityId,
        table.safeEnvelopeHmacSha256
      ],
      foreignColumns: [
        inboxV2SourceIdentityObservations.tenantId,
        inboxV2SourceIdentityObservations.normalizedEventId,
        inboxV2SourceIdentityObservations.observationKey,
        inboxV2SourceIdentityObservations.sourceExternalIdentityId,
        inboxV2SourceIdentityObservations.safeEnvelopeHmacSha256
      ]
    }),
    foreignKey({
      name: "inbox_v2_identity_assessments_claim_fk",
      columns: [
        table.tenantId,
        table.claimId,
        table.sourceExternalIdentityId,
        table.claimVersion,
        table.claimTargetKind,
        table.claimTargetKey
      ],
      foreignColumns: [
        inboxV2SourceIdentityClaims.tenantId,
        inboxV2SourceIdentityClaims.id,
        inboxV2SourceIdentityClaims.sourceExternalIdentityId,
        inboxV2SourceIdentityClaims.claimVersion,
        inboxV2SourceIdentityClaims.targetKind,
        inboxV2SourceIdentityClaims.targetKey
      ]
    }),
    check(
      "inbox_v2_identity_assessments_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_identity_assessment:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'
        and ${table.idempotencyKey} ~ '^source:v2:identity-resolution:[0-9a-f]{64}$'`
    ),
    check(
      "inbox_v2_identity_assessments_version_check",
      sql`${table.assessmentVersion} >= 1
        and (
          (${table.assessmentVersion} = 1
            and ${table.previousAssessmentVersion} is null)
          or (${table.assessmentVersion} > 1
            and ${table.previousAssessmentVersion} = ${table.assessmentVersion} - 1)
        )`
    ),
    check(
      "inbox_v2_identity_assessments_json_check",
      sql`jsonb_typeof(${table.evidence}) = 'array'
        and ${table.evidenceCount} = jsonb_array_length(${table.evidence})
        and ${table.evidenceCount} between 0 and 64
        and jsonb_typeof(${table.candidates}) = 'array'
        and ${table.candidateCount} = jsonb_array_length(${table.candidates})
        and ${table.candidateCount} between 0 and 50
        and jsonb_typeof(${table.provenance}) = 'object'
        and ${sha256Sql(table.assessmentDigestSha256)}`
    ),
    check(
      "inbox_v2_identity_assessments_outcome_check",
      sql`(
          ${table.outcome} = 'unresolved'
          and num_nonnulls(
            ${table.claimId}, ${table.claimVersion}, ${table.claimTargetKind},
            ${table.claimTargetEmployeeId},
            ${table.claimTargetClientContactId}, ${table.claimTargetKey}
          ) = 0
        ) or (
          ${table.outcome} = 'conflicted'
          and ${table.evidenceCount} >= 1
          and ${table.candidateCount} >= 2
          and num_nonnulls(
            ${table.claimId}, ${table.claimVersion}, ${table.claimTargetKind},
            ${table.claimTargetEmployeeId},
            ${table.claimTargetClientContactId}, ${table.claimTargetKey}
          ) = 0
        ) or (
          ${table.outcome} = 'claimed_employee'
          and ${table.confidence} <> 'none'
          and ${table.evidenceCount} >= 1
          and ${table.candidateCount} = 1
          and ${table.claimId} is not null
          and ${table.claimVersion} is not null
          and ${table.claimTargetKind} = 'employee'
          and ${table.claimTargetEmployeeId} is not null
          and ${table.claimTargetClientContactId} is null
          and ${table.claimTargetKey} is not null
        ) or (
          ${table.outcome} = 'claimed_client_contact'
          and ${table.confidence} <> 'none'
          and ${table.evidenceCount} >= 1
          and ${table.candidateCount} = 1
          and ${table.claimId} is not null
          and ${table.claimVersion} is not null
          and ${table.claimTargetKind} = 'client_contact'
          and ${table.claimTargetEmployeeId} is null
          and ${table.claimTargetClientContactId} is not null
          and ${table.claimTargetKey} is not null
        )`
    ),
    check(
      "inbox_v2_identity_assessments_time_check",
      sql`isfinite(${table.assessedAt})
        and isfinite(${table.createdAt})
        and ${table.createdAt} = ${table.assessedAt}`
    ),
    index("inbox_v2_identity_assessments_observation_idx").on(
      table.tenantId,
      table.normalizedEventId,
      table.observationKey,
      table.assessmentVersion
    )
  ]
);

/** One CAS-protected current assessment pointer per SourceExternalIdentity. */
export const inboxV2SourceIdentityAssessmentHeads = pgTable(
  "inbox_v2_source_identity_assessment_heads",
  {
    tenantId: text("tenant_id").notNull(),
    sourceExternalIdentityId: text("source_external_identity_id").notNull(),
    latestAssessmentId: text("latest_assessment_id").notNull(),
    latestAssessmentVersion: bigint("latest_assessment_version", {
      mode: "bigint"
    }).notNull(),
    normalizedEventId: text("normalized_event_id").notNull(),
    observationKey: text("observation_key").notNull(),
    safeEnvelopeHmacSha256: text("safe_envelope_hmac_sha256").notNull(),
    outcome: inboxV2SourceIdentityAssessmentOutcome("outcome").notNull(),
    confidence:
      inboxV2SourceIdentityAssessmentConfidence("confidence").notNull(),
    assessmentDigestSha256: text("assessment_digest_sha256").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_identity_assessment_heads_pk",
      columns: [table.tenantId, table.sourceExternalIdentityId]
    }),
    foreignKey({
      name: "inbox_v2_identity_assessment_heads_identity_fk",
      columns: [table.tenantId, table.sourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_identity_assessment_heads_latest_fk",
      columns: [
        table.tenantId,
        table.latestAssessmentId,
        table.sourceExternalIdentityId,
        table.latestAssessmentVersion,
        table.normalizedEventId,
        table.observationKey,
        table.safeEnvelopeHmacSha256,
        table.outcome,
        table.confidence,
        table.assessmentDigestSha256,
        table.idempotencyKey
      ],
      foreignColumns: [
        inboxV2SourceIdentityAssessments.tenantId,
        inboxV2SourceIdentityAssessments.id,
        inboxV2SourceIdentityAssessments.sourceExternalIdentityId,
        inboxV2SourceIdentityAssessments.assessmentVersion,
        inboxV2SourceIdentityAssessments.normalizedEventId,
        inboxV2SourceIdentityAssessments.observationKey,
        inboxV2SourceIdentityAssessments.safeEnvelopeHmacSha256,
        inboxV2SourceIdentityAssessments.outcome,
        inboxV2SourceIdentityAssessments.confidence,
        inboxV2SourceIdentityAssessments.assessmentDigestSha256,
        inboxV2SourceIdentityAssessments.idempotencyKey
      ]
    }),
    check(
      "inbox_v2_identity_assessment_heads_values_check",
      sql`${table.latestAssessmentVersion} >= 1
        and ${routingTokenSql(table.observationKey)}
        and ${hmacSha256Sql(table.safeEnvelopeHmacSha256)}
        and ${sha256Sql(table.assessmentDigestSha256)}
        and ${table.idempotencyKey} ~ '^source:v2:identity-resolution:[0-9a-f]{64}$'
        and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_identity_assessment_heads_event_idx").on(
      table.tenantId,
      table.normalizedEventId,
      table.observationKey,
      table.sourceExternalIdentityId
    )
  ]
);

/**
 * Database backstops for append-only decisions and a gap-free current head.
 * The repository still performs CAS and returns typed conflicts; these guards
 * protect direct SQL and future repair tooling from creating split authority.
 */
export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_INTEGRITY_SQL = String.raw`
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
`;

function routingTokenSql(value: SQLWrapper): SQL {
  return sql`char_length(${value}) between 1 and 256
    and ${value} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'`;
}

function hmacSha256Sql(value: SQLWrapper): SQL {
  return sql`${value} ~ '^hmac-sha256:[0-9a-f]{64}$'`;
}

function sha256Sql(value: SQLWrapper): SQL {
  return sql`${value} ~ '^sha256:[0-9a-f]{64}$'`;
}
