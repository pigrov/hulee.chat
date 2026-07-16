import {
  calculateInboxV2CanonicalSha256,
  canonicalizeInboxV2Json,
  inboxV2EntityRevisionSchema,
  inboxV2NormalizedInboundEventIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceExternalIdentitySchema,
  inboxV2SourceIdentityAssessmentSchema,
  inboxV2SourceIdentityMaterializationSnapshotSchema,
  inboxV2SourceIdentityObservationRecordSchema,
  inboxV2SourceIdentityResolutionCandidateSchema,
  inboxV2SourceIdentityResolutionEvidenceSchema,
  inboxV2SourceIdentityResolutionRecordSchema,
  inboxV2SourceIdentityClaimVersionSchema,
  inboxV2SourceNormalizedEventForIdentityResolutionSchema,
  inboxV2TenantIdSchema,
  type InboxV2EntityRevision,
  type InboxV2SourceExternalIdentity,
  type InboxV2SourceExternalIdentityId,
  type InboxV2SourceIdentityAssessment,
  type InboxV2SourceIdentityObservationRecord,
  type InboxV2SourceIdentityResolutionCandidate,
  type InboxV2SourceIdentityResolutionEvidence,
  type InboxV2SourceIdentityResolutionRecord,
  type InboxV2SourceIdentityClaimVersion,
  type InboxV2SourceNormalizedEventForIdentityResolution,
  type InboxV2SourceNormalizedIdentityObservation,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const TRANSACTION_CONFIG = { isolationLevel: "read committed" } as const;
const TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const ASSESSMENT_ID_PATTERN =
  /^source_identity_assessment:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^source:v2:identity-resolution:[0-9a-f]{64}$/u;
const ASSESSMENT_PROVENANCE_SCHEMA_ID =
  "core:inbox-v2.source-identity-assessment-provenance";
const SUBJECTLESS_IDENTITY_FACT_SCHEMA_ID =
  "core:inbox-v2.source-identity-materialization-subjectless-fact";

type JsonObject = Readonly<Record<string, unknown>>;
type PersistenceOutcome =
  | "unresolved"
  | "conflicted"
  | "claimed_employee"
  | "claimed_client_contact";
type Confidence = "none" | "weak" | "strong" | "verified";
type ClaimTarget =
  | Readonly<{
      kind: "employee";
      claimId: string;
      claimVersion: InboxV2SourceIdentityClaimVersion;
      employeeId: string;
    }>
  | Readonly<{
      kind: "client_contact";
      claimId: string;
      claimVersion: InboxV2SourceIdentityClaimVersion;
      clientContactId: string;
    }>;

export type PersistedInboxV2SourceIdentitySubjectlessFact = Readonly<{
  schemaId: typeof SUBJECTLESS_IDENTITY_FACT_SCHEMA_ID;
  schemaVersion: "v1";
  materializationDigestSha256: string;
  identityRevision: InboxV2EntityRevision;
  resolutionStatus: "unresolved" | "conflicted" | "claimed";
  latestClaimVersion: InboxV2SourceIdentityClaimVersion | null;
  materializedAt: string;
  identityUpdatedAt: string;
}>;

type AssessmentProvenance = Readonly<{
  schemaId: typeof ASSESSMENT_PROVENANCE_SCHEMA_ID;
  schemaVersion: "v2";
  sourceExternalIdentityFact: PersistedInboxV2SourceIdentitySubjectlessFact;
  assessment: InboxV2SourceIdentityAssessment;
}>;

export type ApplyInboxV2SourceIdentityAssessmentInput = Readonly<{
  tenantId: InboxV2TenantId;
  normalizedEventId: string;
  observationKey: string;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  assessmentId: string;
  idempotencyKey: string;
  expectedAssessmentVersion: InboxV2EntityRevision | null;
  evidence: readonly InboxV2SourceIdentityResolutionEvidence[];
  candidates: readonly InboxV2SourceIdentityResolutionCandidate[];
  assessment: InboxV2SourceIdentityAssessment;
}>;

export type PersistedInboxV2SourceIdentityAssessment = Readonly<{
  tenantId: InboxV2TenantId;
  assessmentId: string;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  normalizedEventId: string;
  observationKey: string;
  safeEnvelopeHmacSha256: string;
  previousAssessmentVersion: InboxV2EntityRevision | null;
  assessmentVersion: InboxV2EntityRevision;
  outcome: PersistenceOutcome;
  confidence: Confidence;
  evidence: readonly InboxV2SourceIdentityResolutionEvidence[];
  candidates: readonly InboxV2SourceIdentityResolutionCandidate[];
  sourceExternalIdentityFact: PersistedInboxV2SourceIdentitySubjectlessFact;
  assessment: InboxV2SourceIdentityAssessment;
  assessmentDigestSha256: string;
  idempotencyKey: string;
  claim: ClaimTarget | null;
  assessedAt: string;
}>;

export type FindInboxV2SourceIdentityAssessmentByOperationInput = Readonly<{
  tenantId: InboxV2TenantId;
  assessmentId: string;
  idempotencyKey: string;
}>;

export type ApplyInboxV2SourceIdentityAssessmentResult =
  | Readonly<{
      kind: "applied" | "already_applied";
      assessment: PersistedInboxV2SourceIdentityAssessment;
    }>
  | Readonly<{
      kind: "version_conflict";
      currentVersion: InboxV2EntityRevision | null;
      currentAssessmentId: string | null;
    }>
  | Readonly<{
      kind:
        | "normalized_event_not_found"
        | "observation_not_found"
        | "identity_not_found"
        | "observation_identity_mismatch"
        | "active_claim_required"
        | "claim_mismatch";
    }>
  | Readonly<{ kind: "observation_conflict"; identityId: string }>
  | Readonly<{
      kind: "assessment_id_conflict" | "idempotency_conflict";
      assessmentId: string;
    }>;

export type InboxV2SourceIdentityResolutionTransactionExecutor =
  RawSqlExecutor & {
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>,
      config: Readonly<{ isolationLevel: "read committed" }>
    ): Promise<TResult>;
  };

export type InboxV2SourceIdentityResolutionRepository = Readonly<{
  readNormalizedEventForResolution(input: {
    tenantId: InboxV2TenantId;
    normalizedEventId: string;
  }): Promise<InboxV2SourceNormalizedEventForIdentityResolution | null>;
  applyAssessment(
    input: ApplyInboxV2SourceIdentityAssessmentInput
  ): Promise<ApplyInboxV2SourceIdentityAssessmentResult>;
  findAssessmentByOperation(
    input: FindInboxV2SourceIdentityAssessmentByOperationInput
  ): Promise<PersistedInboxV2SourceIdentityAssessment | null>;
  findCurrentAssessment(input: {
    tenantId: InboxV2TenantId;
    sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  }): Promise<PersistedInboxV2SourceIdentityAssessment | null>;
}>;

type NormalizedInput = Readonly<{
  tenantId: InboxV2TenantId;
  normalizedEventId: string;
  observationKey: string;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  assessmentId: string;
  idempotencyKey: string;
  expectedAssessmentVersion: InboxV2EntityRevision | null;
  evidence: readonly InboxV2SourceIdentityResolutionEvidence[];
  candidates: readonly InboxV2SourceIdentityResolutionCandidate[];
  assessment: InboxV2SourceIdentityAssessment;
}>;

type PreparedAssessment = Readonly<{
  input: NormalizedInput;
  observation: InboxV2SourceNormalizedIdentityObservation;
  observationDigestSha256: string;
  safeEnvelopeHmacSha256: string;
  previousVersion: InboxV2EntityRevision | null;
  version: InboxV2EntityRevision;
  outcome: PersistenceOutcome;
  confidence: Confidence;
  evidence: readonly InboxV2SourceIdentityResolutionEvidence[];
  candidates: readonly InboxV2SourceIdentityResolutionCandidate[];
  sourceExternalIdentityFact: PersistedInboxV2SourceIdentitySubjectlessFact;
  assessment: InboxV2SourceIdentityAssessment;
  assessmentDigestSha256: string;
  claim: ClaimTarget | null;
}>;

type ResolutionProjectionRow = {
  resolution_event: unknown;
  safe_envelope_hmac_sha256: unknown;
};

type LockedIdentityRow = {
  tenant_id: unknown;
  id: unknown;
  realm_id: unknown;
  realm_version: unknown;
  canonicalization_version: unknown;
  object_kind_id: unknown;
  scope_kind: unknown;
  scope_source_connection_id: unknown;
  scope_source_account_id: unknown;
  identity_declaration: unknown;
  materialized_by_trusted_service_id: unknown;
  materialization_authorization_token: unknown;
  materialized_at: unknown;
  canonical_external_subject: unknown;
  stability_kind: unknown;
  ephemeral_raw_inbound_event_id: unknown;
  ephemeral_normalized_inbound_event_id: unknown;
  ephemeral_observation_key: unknown;
  identity_revision: unknown;
  identity_created_at: unknown;
  identity_updated_at: unknown;
  resolution_status: unknown;
  active_claim_id: unknown;
  latest_claim_version: unknown;
};

type AssessmentHeadRow = {
  latest_assessment_id: unknown;
  latest_assessment_version: unknown;
  updated_at: unknown;
};

type ObservationRow = {
  source_external_identity_id: unknown;
  safe_envelope_hmac_sha256: unknown;
  purpose: unknown;
  observation_digest_sha256: unknown;
  observed_at: unknown;
  created_at: unknown;
};

type AssessmentRow = {
  id: unknown;
  source_external_identity_id: unknown;
  normalized_event_id: unknown;
  observation_key: unknown;
  safe_envelope_hmac_sha256: unknown;
  previous_assessment_version: unknown;
  assessment_version: unknown;
  outcome: unknown;
  confidence: unknown;
  evidence: unknown;
  candidates: unknown;
  provenance: unknown;
  assessment_digest_sha256: unknown;
  idempotency_key: unknown;
  claim_id: unknown;
  claim_version: unknown;
  claim_target_kind: unknown;
  claim_target_employee_id: unknown;
  claim_target_client_contact_id: unknown;
  assessed_at: unknown;
};

type ActiveClaimRow = {
  id: unknown;
  claim_version: unknown;
  target_kind: unknown;
  target_employee_id: unknown;
  target_client_contact_id: unknown;
  status: unknown;
};

type IdRow = { id: unknown };

export function createSqlInboxV2SourceIdentityResolutionRepository(
  executor: InboxV2SourceIdentityResolutionTransactionExecutor | HuleeDatabase
): InboxV2SourceIdentityResolutionRepository {
  const transactionExecutor =
    executor as unknown as InboxV2SourceIdentityResolutionTransactionExecutor;

  return {
    async readNormalizedEventForResolution(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const normalizedEventId = inboxV2NormalizedInboundEventIdSchema.parse(
        input.normalizedEventId
      );
      return loadNormalizedEventForResolution(transactionExecutor, {
        tenantId,
        normalizedEventId
      }).then((loaded) => loaded?.event ?? null);
    },

    async applyAssessment(input) {
      const normalized = normalizeInput(input);
      return runResolutionTransaction(
        transactionExecutor,
        async (transaction) => {
          await transaction.execute(
            buildAcquireInboxV2SourceIdentityAssessmentLocksSql(normalized)
          );

          const loadedEvent = await loadNormalizedEventForResolution(
            transaction,
            {
              tenantId: normalized.tenantId,
              normalizedEventId: normalized.normalizedEventId
            }
          );
          if (loadedEvent === null) {
            return { kind: "normalized_event_not_found" } as const;
          }
          const observation = loadedEvent.event.identityObservations.find(
            (candidate) =>
              candidate.observationKey === normalized.observationKey
          );
          if (observation === undefined) {
            return { kind: "observation_not_found" } as const;
          }

          const lockedIdentity = await lockIdentity(transaction, normalized);
          if (lockedIdentity === null) {
            return { kind: "identity_not_found" } as const;
          }
          const identity = mapIdentity(lockedIdentity, normalized.tenantId);
          const observationRecord = buildObservationRecord({
            input: normalized,
            event: loadedEvent.event,
            observation,
            identity
          });
          if (observationRecord === null) {
            return { kind: "observation_identity_mismatch" } as const;
          }

          const currentHead = await lockAssessmentHead(transaction, normalized);
          const existing = await findExistingAssessment(
            transaction,
            normalized
          );
          if (existing.length > 0) {
            return classifyExistingAssessment({
              rows: existing,
              input: normalized,
              safeEnvelopeHmacSha256: loadedEvent.safeEnvelopeHmacSha256,
              observationDigestSha256: calculateObservationDigest({
                input: normalized,
                observation,
                safeEnvelopeHmacSha256: loadedEvent.safeEnvelopeHmacSha256
              })
            });
          }

          const currentVersion = currentHead?.version ?? null;
          if (currentVersion !== normalized.expectedAssessmentVersion) {
            return {
              kind: "version_conflict",
              currentVersion,
              currentAssessmentId: currentHead?.assessmentId ?? null
            } as const;
          }

          const nextVersion = incrementVersion(currentVersion);
          const recordResult = buildResolutionRecord({
            input: normalized,
            observationRecord,
            identity,
            previousVersion: currentVersion,
            version: nextVersion
          });
          const prepared = prepareAssessment({
            input: normalized,
            record: recordResult,
            observation,
            safeEnvelopeHmacSha256: loadedEvent.safeEnvelopeHmacSha256
          });

          const claimValidation = await validateActiveClaim(
            transaction,
            lockedIdentity,
            prepared.claim
          );
          if (claimValidation !== null) return claimValidation;

          const observationBinding = await persistObservation(
            transaction,
            prepared
          );
          if (observationBinding !== null) return observationBinding;

          await expectOneRow(
            transaction,
            buildInsertInboxV2SourceIdentityAssessmentSql(prepared),
            "SourceIdentityAssessment insert"
          );
          await expectOneRow(
            transaction,
            currentHead === null
              ? buildInsertInboxV2SourceIdentityAssessmentHeadSql(prepared)
              : buildAdvanceInboxV2SourceIdentityAssessmentHeadSql(prepared),
            "SourceIdentityAssessment head CAS"
          );

          return {
            kind: "applied",
            assessment: persistedFromPrepared(prepared)
          } as const;
        }
      );
    },

    async findAssessmentByOperation(input) {
      const normalized = normalizeOperationLookupInput(input);
      const result = await transactionExecutor.execute<AssessmentRow>(
        buildFindInboxV2SourceIdentityAssessmentByOperationSql(normalized)
      );
      if (result.rows.length > 1) {
        throw invariantError(
          "SourceIdentityAssessment operation lookup resolved to conflicting rows."
        );
      }
      if (result.rows.length === 0) return null;
      const persisted = mapAssessmentRow(result.rows[0]!, normalized.tenantId);
      if (
        persisted.assessmentId !== normalized.assessmentId ||
        persisted.idempotencyKey !== normalized.idempotencyKey
      ) {
        throw invariantError(
          "SourceIdentityAssessment operation ID and idempotency key resolve to different evidence."
        );
      }
      return persisted;
    },

    async findCurrentAssessment(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const sourceExternalIdentityId =
        inboxV2SourceExternalIdentityIdSchema.parse(
          input.sourceExternalIdentityId
        );
      const result = await transactionExecutor.execute<AssessmentRow>(
        buildFindCurrentInboxV2SourceIdentityAssessmentSql({
          tenantId,
          sourceExternalIdentityId
        })
      );
      if (result.rows.length > 1) {
        throw invariantError(
          "Current SourceIdentityAssessment lookup returned multiple rows."
        );
      }
      return result.rows[0] ? mapAssessmentRow(result.rows[0], tenantId) : null;
    }
  };
}

export function buildReadInboxV2NormalizedEventForIdentityResolutionSql(input: {
  tenantId: InboxV2TenantId;
  normalizedEventId: string;
}): SQL {
  return sql`
    select jsonb_build_object(
             'tenantId', envelope.tenant_id,
             'rawInboundEvent', jsonb_build_object(
               'tenantId', envelope.tenant_id,
               'kind', 'raw_inbound_event',
               'id', envelope.raw_event_id
             ),
             'normalizedInboundEvent', jsonb_build_object(
               'tenantId', envelope.tenant_id,
               'kind', 'normalized_inbound_event',
               'id', envelope.normalized_event_id
             ),
             'sourceConnection', jsonb_build_object(
               'tenantId', envelope.tenant_id,
               'kind', 'source_connection',
               'id', envelope.source_connection_id
             ),
             'sourceAccount', case
               when envelope.source_account_id is null then null
               else jsonb_build_object(
                 'tenantId', envelope.tenant_id,
                 'kind', 'source_account',
                 'id', envelope.source_account_id
               )
             end,
             'domain', envelope.safe_envelope -> 'domain',
             'schemaId', to_jsonb(envelope.safe_envelope_schema_id),
             'schemaVersion', to_jsonb(envelope.safe_envelope_schema_version),
             'safeEnvelopeHmacSha256', to_jsonb(envelope.safe_envelope_hmac_sha256),
             'adapterContract', envelope.safe_envelope -> 'adapterContract',
             'thread', jsonb_build_object(
               'sourceConnection', jsonb_build_object(
                 'tenantId', envelope.tenant_id,
                 'kind', 'source_connection',
                 'id', envelope.source_connection_id
               ),
               'sourceAccount', case
                 when envelope.source_account_id is null then null
                 else jsonb_build_object(
                   'tenantId', envelope.tenant_id,
                   'kind', 'source_account',
                   'id', envelope.source_account_id
                 )
               end,
               'identityDeclaration', envelope.safe_envelope #> '{thread,identityDeclaration}',
               'key', envelope.safe_envelope #> '{thread,key}',
               'observedExternalSubject', envelope.safe_envelope #> '{thread,observedExternalSubject}'
             ),
             'identityObservations', envelope.safe_envelope -> 'identityObservations',
             'rosterObservation', envelope.safe_envelope -> 'rosterObservation',
             'recordedAt', to_jsonb(
               to_char(
                 envelope.normalized_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               )
             )
           ) as resolution_event,
           envelope.safe_envelope_hmac_sha256
    from public.inbox_v2_source_normalized_envelopes envelope
    where envelope.tenant_id = ${input.tenantId}
      and envelope.normalized_event_id = ${input.normalizedEventId}
  `;
}

export function buildAcquireInboxV2SourceIdentityAssessmentLocksSql(
  input: Pick<NormalizedInput, "tenantId" | "assessmentId" | "idempotencyKey">
): SQL {
  return sql`
    select pg_advisory_xact_lock(
      hashtextextended(lock_key, 883517342945::bigint)
    )
    from (
      values
        (${`${input.tenantId}|assessment|${input.assessmentId}`}),
        (${`${input.tenantId}|idempotency|${input.idempotencyKey}`})
    ) as lock_keys(lock_key)
    order by lock_key
  `;
}

export function buildLockInboxV2SourceIdentityForAssessmentSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
}): SQL {
  return sql`
    select identity_row.tenant_id,
           identity_row.id,
           identity_row.realm_id,
           identity_row.realm_version,
           identity_row.canonicalization_version,
           identity_row.object_kind_id,
           identity_row.scope_kind::text as scope_kind,
           identity_row.scope_source_connection_id,
           identity_row.scope_source_account_id,
           identity_row.identity_declaration,
           identity_row.materialized_by_trusted_service_id,
           identity_row.materialization_authorization_token,
           identity_row.materialized_at,
           identity_row.canonical_external_subject,
           identity_row.stability_kind::text as stability_kind,
           identity_row.ephemeral_raw_inbound_event_id,
           identity_row.ephemeral_normalized_inbound_event_id,
           identity_row.ephemeral_observation_key,
           identity_row.revision::text as identity_revision,
           identity_row.created_at as identity_created_at,
           identity_row.updated_at as identity_updated_at,
           claim_head.resolution_status::text as resolution_status,
           claim_head.active_claim_id,
           claim_head.latest_claim_version::text as latest_claim_version
    from public.inbox_v2_source_external_identities identity_row
    join public.inbox_v2_source_identity_claim_heads claim_head
      on claim_head.tenant_id = identity_row.tenant_id
     and claim_head.source_external_identity_id = identity_row.id
    where identity_row.tenant_id = ${input.tenantId}
      and identity_row.id = ${input.sourceExternalIdentityId}
    for update of identity_row, claim_head
  `;
}

export function buildLockInboxV2SourceIdentityAssessmentHeadSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
}): SQL {
  return sql`
    select latest_assessment_id,
           latest_assessment_version::text as latest_assessment_version,
           updated_at
    from public.inbox_v2_source_identity_assessment_heads
    where tenant_id = ${input.tenantId}
      and source_external_identity_id = ${input.sourceExternalIdentityId}
    for update
  `;
}

export function buildFindExistingInboxV2SourceIdentityAssessmentSql(
  input: Pick<NormalizedInput, "tenantId" | "assessmentId" | "idempotencyKey">
): SQL {
  return sql`
    select id, source_external_identity_id, normalized_event_id,
           observation_key, safe_envelope_hmac_sha256,
           previous_assessment_version::text as previous_assessment_version,
           assessment_version::text as assessment_version,
           outcome::text as outcome, confidence::text as confidence,
           evidence, candidates, provenance, assessment_digest_sha256,
           idempotency_key, claim_id, claim_version::text as claim_version,
           claim_target_kind::text as claim_target_kind,
           claim_target_employee_id, claim_target_client_contact_id,
           assessed_at
    from public.inbox_v2_source_identity_assessments
    where tenant_id = ${input.tenantId}
      and (id = ${input.assessmentId}
        or idempotency_key = ${input.idempotencyKey})
    order by id
  `;
}

export function buildFindInboxV2SourceIdentityAssessmentByOperationSql(
  input: FindInboxV2SourceIdentityAssessmentByOperationInput
): SQL {
  return buildFindExistingInboxV2SourceIdentityAssessmentSql(input);
}

export function buildInsertInboxV2SourceIdentityObservationSql(
  input: PreparedAssessment
): SQL {
  return sql`
    insert into public.inbox_v2_source_identity_observations (
      tenant_id, normalized_event_id, observation_key,
      source_external_identity_id, safe_envelope_hmac_sha256, purpose,
      observation_digest_sha256, observed_at, created_at
    ) values (
      ${input.input.tenantId}, ${input.input.normalizedEventId},
      ${input.input.observationKey}, ${input.input.sourceExternalIdentityId},
      ${input.safeEnvelopeHmacSha256}, ${input.observation.purpose},
      ${input.observationDigestSha256}, ${input.observation.observedAt}::timestamptz,
      ${input.assessment.assessedAt}::timestamptz
    )
    on conflict (tenant_id, normalized_event_id, observation_key) do nothing
    returning observation_key as id
  `;
}

export function buildFindInboxV2SourceIdentityObservationSql(input: {
  tenantId: InboxV2TenantId;
  normalizedEventId: string;
  observationKey: string;
}): SQL {
  return sql`
    select source_external_identity_id, safe_envelope_hmac_sha256, purpose,
           observation_digest_sha256, observed_at, created_at
    from public.inbox_v2_source_identity_observations
    where tenant_id = ${input.tenantId}
      and normalized_event_id = ${input.normalizedEventId}
      and observation_key = ${input.observationKey}
  `;
}

export function buildInsertInboxV2SourceIdentityAssessmentSql(
  input: PreparedAssessment
): SQL {
  const claim = claimColumns(input.claim);
  return sql`
    insert into public.inbox_v2_source_identity_assessments (
      tenant_id, id, source_external_identity_id, normalized_event_id,
      observation_key, safe_envelope_hmac_sha256,
      previous_assessment_version, assessment_version, outcome, confidence,
      evidence, evidence_count, candidates, candidate_count, provenance,
      assessment_digest_sha256, idempotency_key, claim_id, claim_version,
      claim_target_kind, claim_target_employee_id,
      claim_target_client_contact_id, assessed_at, created_at
    ) values (
      ${input.input.tenantId}, ${input.input.assessmentId},
      ${input.input.sourceExternalIdentityId}, ${input.input.normalizedEventId},
      ${input.input.observationKey}, ${input.safeEnvelopeHmacSha256},
      ${input.previousVersion}::bigint, ${input.version}::bigint,
      ${input.outcome}, ${input.confidence},
      ${JSON.stringify(input.evidence)}::jsonb, ${input.evidence.length},
      ${JSON.stringify(input.candidates)}::jsonb, ${input.candidates.length},
      ${JSON.stringify(assessmentProvenance(input))}::jsonb,
      ${input.assessmentDigestSha256}, ${input.input.idempotencyKey},
      ${claim.claimId}, ${claim.claimVersion}::bigint, ${claim.targetKind},
      ${claim.employeeId}, ${claim.clientContactId},
      ${input.assessment.assessedAt}::timestamptz,
      ${input.assessment.assessedAt}::timestamptz
    )
    returning id
  `;
}

export function buildInsertInboxV2SourceIdentityAssessmentHeadSql(
  input: PreparedAssessment
): SQL {
  return sql`
    insert into public.inbox_v2_source_identity_assessment_heads (
      tenant_id, source_external_identity_id, latest_assessment_id,
      latest_assessment_version, normalized_event_id, observation_key,
      safe_envelope_hmac_sha256, outcome, confidence,
      assessment_digest_sha256, idempotency_key, updated_at
    ) values (
      ${input.input.tenantId}, ${input.input.sourceExternalIdentityId},
      ${input.input.assessmentId}, ${input.version}::bigint,
      ${input.input.normalizedEventId}, ${input.input.observationKey},
      ${input.safeEnvelopeHmacSha256}, ${input.outcome}, ${input.confidence},
      ${input.assessmentDigestSha256}, ${input.input.idempotencyKey},
      ${input.assessment.assessedAt}::timestamptz
    )
    returning latest_assessment_id as id
  `;
}

export function buildAdvanceInboxV2SourceIdentityAssessmentHeadSql(
  input: PreparedAssessment
): SQL {
  return sql`
    update public.inbox_v2_source_identity_assessment_heads
    set latest_assessment_id = ${input.input.assessmentId},
        latest_assessment_version = ${input.version}::bigint,
        normalized_event_id = ${input.input.normalizedEventId},
        observation_key = ${input.input.observationKey},
        safe_envelope_hmac_sha256 = ${input.safeEnvelopeHmacSha256},
        outcome = ${input.outcome},
        confidence = ${input.confidence},
        assessment_digest_sha256 = ${input.assessmentDigestSha256},
        idempotency_key = ${input.input.idempotencyKey},
        updated_at = ${input.assessment.assessedAt}::timestamptz
    where tenant_id = ${input.input.tenantId}
      and source_external_identity_id = ${input.input.sourceExternalIdentityId}
      and latest_assessment_version = ${input.previousVersion}::bigint
    returning latest_assessment_id as id
  `;
}

export function buildFindCurrentInboxV2SourceIdentityAssessmentSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
}): SQL {
  return sql`
    select assessment.id, assessment.source_external_identity_id,
           assessment.normalized_event_id, assessment.observation_key,
           assessment.safe_envelope_hmac_sha256,
           assessment.previous_assessment_version::text as previous_assessment_version,
           assessment.assessment_version::text as assessment_version,
           assessment.outcome::text as outcome,
           assessment.confidence::text as confidence,
           assessment.evidence, assessment.candidates, assessment.provenance,
           assessment.assessment_digest_sha256, assessment.idempotency_key,
           assessment.claim_id, assessment.claim_version::text as claim_version,
           assessment.claim_target_kind::text as claim_target_kind,
           assessment.claim_target_employee_id,
           assessment.claim_target_client_contact_id,
           assessment.assessed_at
    from public.inbox_v2_source_identity_assessment_heads head
    join public.inbox_v2_source_identity_assessments assessment
      on assessment.tenant_id = head.tenant_id
     and assessment.id = head.latest_assessment_id
     and assessment.source_external_identity_id = head.source_external_identity_id
     and assessment.assessment_version = head.latest_assessment_version
    where head.tenant_id = ${input.tenantId}
      and head.source_external_identity_id = ${input.sourceExternalIdentityId}
  `;
}

function normalizeInput(
  input: ApplyInboxV2SourceIdentityAssessmentInput
): NormalizedInput {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const normalizedEventId = inboxV2NormalizedInboundEventIdSchema.parse(
    input.normalizedEventId
  );
  const sourceExternalIdentityId = inboxV2SourceExternalIdentityIdSchema.parse(
    input.sourceExternalIdentityId
  );
  if (!ASSESSMENT_ID_PATTERN.test(input.assessmentId)) {
    throw new TypeError("Invalid SourceIdentityAssessment ID.");
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new TypeError("Invalid SourceIdentityAssessment idempotency key.");
  }
  if (
    typeof input.observationKey !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._~:-]{0,255}$/u.test(input.observationKey)
  ) {
    throw new TypeError("Invalid source identity observation key.");
  }
  const expectedAssessmentVersion =
    input.expectedAssessmentVersion === null
      ? null
      : inboxV2EntityRevisionSchema.parse(input.expectedAssessmentVersion);
  const evidence = input.evidence.map((item) =>
    inboxV2SourceIdentityResolutionEvidenceSchema.parse(item)
  );
  const candidates = input.candidates.map((item) =>
    inboxV2SourceIdentityResolutionCandidateSchema.parse(item)
  );
  const assessment = inboxV2SourceIdentityAssessmentSchema.parse(
    input.assessment
  );
  return Object.freeze({
    tenantId,
    normalizedEventId,
    observationKey: input.observationKey,
    sourceExternalIdentityId,
    assessmentId: input.assessmentId,
    idempotencyKey: input.idempotencyKey,
    expectedAssessmentVersion,
    evidence: Object.freeze(evidence),
    candidates: Object.freeze(candidates),
    assessment
  });
}

function normalizeOperationLookupInput(
  input: FindInboxV2SourceIdentityAssessmentByOperationInput
): FindInboxV2SourceIdentityAssessmentByOperationInput {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  if (!ASSESSMENT_ID_PATTERN.test(input.assessmentId)) {
    throw new TypeError("Invalid SourceIdentityAssessment ID.");
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new TypeError("Invalid SourceIdentityAssessment idempotency key.");
  }
  return Object.freeze({
    tenantId,
    assessmentId: input.assessmentId,
    idempotencyKey: input.idempotencyKey
  });
}

async function loadNormalizedEventForResolution(
  executor: RawSqlExecutor,
  input: { tenantId: InboxV2TenantId; normalizedEventId: string }
): Promise<Readonly<{
  event: InboxV2SourceNormalizedEventForIdentityResolution;
  safeEnvelopeHmacSha256: string;
}> | null> {
  const result = await executor.execute<ResolutionProjectionRow>(
    buildReadInboxV2NormalizedEventForIdentityResolutionSql(input)
  );
  if (result.rows.length > 1) {
    throw invariantError(
      "Normalized event resolution projection returned multiple rows."
    );
  }
  const row = result.rows[0];
  if (row === undefined) return null;
  try {
    return Object.freeze({
      event: inboxV2SourceNormalizedEventForIdentityResolutionSchema.parse(
        row.resolution_event
      ),
      safeEnvelopeHmacSha256: hmacDigest(
        row.safe_envelope_hmac_sha256,
        "normalized envelope HMAC"
      )
    });
  } catch (error) {
    throw invariantError(
      "Persisted normalized event is invalid for identity resolution.",
      error
    );
  }
}

async function lockIdentity(
  executor: RawSqlExecutor,
  input: NormalizedInput
): Promise<LockedIdentityRow | null> {
  const result = await executor.execute<LockedIdentityRow>(
    buildLockInboxV2SourceIdentityForAssessmentSql(input)
  );
  if (result.rows.length > 1) {
    throw invariantError("Source identity lock returned multiple rows.");
  }
  return result.rows[0] ?? null;
}

async function lockAssessmentHead(
  executor: RawSqlExecutor,
  input: NormalizedInput
): Promise<Readonly<{
  assessmentId: string;
  version: InboxV2EntityRevision;
  updatedAt: string;
}> | null> {
  const result = await executor.execute<AssessmentHeadRow>(
    buildLockInboxV2SourceIdentityAssessmentHeadSql(input)
  );
  if (result.rows.length > 1) {
    throw invariantError(
      "Source identity assessment head lock returned duplicates."
    );
  }
  const row = result.rows[0];
  if (row === undefined) return null;
  return Object.freeze({
    assessmentId: stringValue(row.latest_assessment_id, "latest assessment ID"),
    version: revisionValue(
      row.latest_assessment_version,
      "latest assessment version"
    ),
    updatedAt: timestampValue(row.updated_at, "assessment head updatedAt")
  });
}

async function findExistingAssessment(
  executor: RawSqlExecutor,
  input: NormalizedInput
): Promise<readonly AssessmentRow[]> {
  const result = await executor.execute<AssessmentRow>(
    buildFindExistingInboxV2SourceIdentityAssessmentSql(input)
  );
  if (result.rows.length > 2) {
    throw invariantError(
      "Assessment identity/idempotency lookup returned too many rows."
    );
  }
  return result.rows;
}

function classifyExistingAssessment(input: {
  rows: readonly AssessmentRow[];
  input: NormalizedInput;
  safeEnvelopeHmacSha256: string;
  observationDigestSha256: string;
}): ApplyInboxV2SourceIdentityAssessmentResult {
  const sameId = input.rows.find((row) => row.id === input.input.assessmentId);
  const sameKey = input.rows.find(
    (row) => row.idempotency_key === input.input.idempotencyKey
  );
  if (sameId === undefined) {
    return {
      kind: "idempotency_conflict",
      assessmentId: stringValue(sameKey?.id, "conflicting assessment ID")
    };
  }
  if (sameKey === undefined || sameKey.id !== sameId.id) {
    return {
      kind: "assessment_id_conflict",
      assessmentId: input.input.assessmentId
    };
  }
  const persisted = mapAssessmentRow(sameId, input.input.tenantId);
  const outcome = persistenceOutcome(input.input.assessment);
  const claim = claimFromAssessment(input.input.assessment);
  const digest = calculateAssessmentDigest({
    input: input.input,
    observationDigestSha256: input.observationDigestSha256,
    previousVersion: persisted.previousAssessmentVersion,
    version: persisted.assessmentVersion,
    outcome,
    confidence: input.input.assessment.confidence,
    evidence: input.input.evidence,
    candidates: input.input.candidates,
    sourceExternalIdentityFact: persisted.sourceExternalIdentityFact,
    assessment: input.input.assessment,
    claim
  });
  if (
    persisted.sourceExternalIdentityId !==
      input.input.sourceExternalIdentityId ||
    persisted.normalizedEventId !== input.input.normalizedEventId ||
    persisted.observationKey !== input.input.observationKey ||
    persisted.safeEnvelopeHmacSha256 !== input.safeEnvelopeHmacSha256 ||
    persisted.outcome !== outcome ||
    persisted.confidence !== input.input.assessment.confidence ||
    persisted.assessmentDigestSha256 !== digest ||
    canonicalizeInboxV2Json(persisted.evidence) !==
      canonicalizeInboxV2Json(input.input.evidence) ||
    canonicalizeInboxV2Json(persisted.candidates) !==
      canonicalizeInboxV2Json(input.input.candidates) ||
    canonicalizeInboxV2Json(persisted.assessment) !==
      canonicalizeInboxV2Json(input.input.assessment) ||
    canonicalizeInboxV2Json(persisted.claim) !== canonicalizeInboxV2Json(claim)
  ) {
    return {
      kind: "idempotency_conflict",
      assessmentId: persisted.assessmentId
    };
  }
  return { kind: "already_applied", assessment: persisted };
}

function buildObservationRecord(input: {
  input: NormalizedInput;
  event: InboxV2SourceNormalizedEventForIdentityResolution;
  observation: InboxV2SourceNormalizedIdentityObservation;
  identity: InboxV2SourceExternalIdentity;
}): InboxV2SourceIdentityObservationRecord | null {
  try {
    const materialization =
      inboxV2SourceIdentityMaterializationSnapshotSchema.parse({
        tenantId: input.identity.tenantId,
        id: input.identity.id,
        realm: input.identity.realm,
        objectKindId: input.identity.objectKindId,
        scope: input.identity.scope,
        identityDeclaration: input.identity.identityDeclaration,
        materializationAuthority: input.identity.materializationAuthority,
        materializedAt: input.identity.materializedAt,
        canonicalExternalSubject: input.identity.canonicalExternalSubject,
        stability: input.identity.stability,
        createdAt: input.identity.createdAt
      });
    const candidate = {
      tenantId: input.input.tenantId,
      normalizedInboundEvent: input.event.normalizedInboundEvent,
      observationKey: input.observation.observationKey,
      purpose: input.observation.purpose,
      sourceConnection: input.event.sourceConnection,
      sourceAccount: input.event.sourceAccount,
      adapterContract: input.event.adapterContract,
      safeEnvelopeHmacSha256: input.event.safeEnvelopeHmacSha256,
      observedExternalSubject: input.observation.observedExternalSubject,
      sourceExternalIdentityMaterialization: materialization,
      observedAt: input.observation.observedAt,
      recordedAt: input.event.recordedAt,
      revision: "1"
    } as const;
    return inboxV2SourceIdentityObservationRecordSchema.parse(candidate);
  } catch {
    return null;
  }
}

function buildResolutionRecord(input: {
  input: NormalizedInput;
  observationRecord: InboxV2SourceIdentityObservationRecord;
  identity: InboxV2SourceExternalIdentity;
  previousVersion: InboxV2EntityRevision | null;
  version: InboxV2EntityRevision;
}): InboxV2SourceIdentityResolutionRecord {
  return inboxV2SourceIdentityResolutionRecordSchema.parse({
    tenantId: input.input.tenantId,
    observation: input.observationRecord,
    sourceExternalIdentitySnapshot: input.identity,
    previousAssessmentRevision: input.previousVersion,
    assessmentRevision: input.version,
    evidence: input.input.evidence,
    candidates: input.input.candidates,
    assessment: input.input.assessment
  });
}

function prepareAssessment(input: {
  input: NormalizedInput;
  record: InboxV2SourceIdentityResolutionRecord;
  observation: InboxV2SourceNormalizedIdentityObservation;
  safeEnvelopeHmacSha256: string;
}): PreparedAssessment {
  const outcome = persistenceOutcome(input.record.assessment);
  const claim = claimFromAssessment(input.record.assessment);
  const sourceExternalIdentityFact =
    calculateInboxV2SourceIdentitySubjectlessFact(
      input.record.sourceExternalIdentitySnapshot
    );
  const observationDigestSha256 = calculateObservationDigest({
    input: input.input,
    observation: input.observation,
    safeEnvelopeHmacSha256: input.safeEnvelopeHmacSha256
  });
  return Object.freeze({
    input: input.input,
    observation: input.observation,
    observationDigestSha256,
    safeEnvelopeHmacSha256: input.safeEnvelopeHmacSha256,
    previousVersion: input.record.previousAssessmentRevision,
    version: input.record.assessmentRevision,
    outcome,
    confidence: input.record.assessment.confidence,
    evidence: Object.freeze([...input.record.evidence]),
    candidates: Object.freeze([...input.record.candidates]),
    sourceExternalIdentityFact,
    assessment: input.record.assessment,
    assessmentDigestSha256: calculateAssessmentDigest({
      input: input.input,
      observationDigestSha256,
      previousVersion: input.record.previousAssessmentRevision,
      version: input.record.assessmentRevision,
      outcome,
      confidence: input.record.assessment.confidence,
      evidence: input.record.evidence,
      candidates: input.record.candidates,
      sourceExternalIdentityFact,
      assessment: input.record.assessment,
      claim
    }),
    claim
  });
}

function calculateObservationDigest(input: {
  input: NormalizedInput;
  observation: InboxV2SourceNormalizedIdentityObservation;
  safeEnvelopeHmacSha256: string;
}): string {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.source-identity-observation-binding",
    version: "v2",
    tenantId: input.input.tenantId,
    normalizedEventId: input.input.normalizedEventId,
    observationKey: input.input.observationKey,
    sourceExternalIdentityId: input.input.sourceExternalIdentityId,
    safeEnvelopeHmacSha256: input.safeEnvelopeHmacSha256,
    observation: {
      observationKey: input.observation.observationKey,
      purpose: input.observation.purpose,
      identityDeclaration: input.observation.identityDeclaration,
      realm: input.observation.realm,
      scope: input.observation.scope,
      objectKindId: input.observation.objectKindId,
      stability: input.observation.stability,
      observedAt: input.observation.observedAt
    }
  });
}

function calculateAssessmentDigest(input: {
  input: NormalizedInput;
  observationDigestSha256: string;
  previousVersion: InboxV2EntityRevision | null;
  version: InboxV2EntityRevision;
  outcome: PersistenceOutcome;
  confidence: Confidence;
  evidence: readonly InboxV2SourceIdentityResolutionEvidence[];
  candidates: readonly InboxV2SourceIdentityResolutionCandidate[];
  sourceExternalIdentityFact: PersistedInboxV2SourceIdentitySubjectlessFact;
  assessment: InboxV2SourceIdentityAssessment;
  claim: ClaimTarget | null;
}): string {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.source-identity-assessment",
    version: "v2",
    tenantId: input.input.tenantId,
    sourceExternalIdentityId: input.input.sourceExternalIdentityId,
    observationDigestSha256: input.observationDigestSha256,
    previousAssessmentVersion: input.previousVersion,
    assessmentVersion: input.version,
    outcome: input.outcome,
    confidence: input.confidence,
    evidence: input.evidence,
    candidates: input.candidates,
    sourceExternalIdentityFact: input.sourceExternalIdentityFact,
    assessment: input.assessment,
    claim: input.claim
  });
}

export function calculateInboxV2SourceIdentitySubjectlessFact(
  identity: InboxV2SourceExternalIdentity
): PersistedInboxV2SourceIdentitySubjectlessFact {
  const materializationDigestSha256 = calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.source-identity-materialization-subjectless-fact",
    version: "v1",
    tenantId: identity.tenantId,
    sourceExternalIdentityId: identity.id,
    realm: identity.realm,
    objectKindId: identity.objectKindId,
    scope: identity.scope,
    identityDeclaration: identity.identityDeclaration,
    materializationAuthority: {
      kind: identity.materializationAuthority.kind,
      tenantId: identity.materializationAuthority.tenantId,
      trustedServiceId: identity.materializationAuthority.trustedServiceId,
      authorizedAt: identity.materializationAuthority.authorizedAt
    },
    materializedAt: identity.materializedAt,
    stability: identity.stability,
    createdAt: identity.createdAt
  });
  return Object.freeze({
    schemaId: SUBJECTLESS_IDENTITY_FACT_SCHEMA_ID,
    schemaVersion: "v1",
    materializationDigestSha256,
    identityRevision: identity.revision,
    resolutionStatus: identity.resolution.status,
    latestClaimVersion: identity.latestClaimVersion,
    materializedAt: identity.materializedAt,
    identityUpdatedAt: identity.updatedAt
  });
}

function parseSubjectlessIdentityFact(
  value: unknown
): PersistedInboxV2SourceIdentitySubjectlessFact {
  const fact = objectValue(value, "subjectless source identity fact");
  const keys = Object.keys(fact).sort();
  const expectedKeys = [
    "identityRevision",
    "identityUpdatedAt",
    "latestClaimVersion",
    "materializationDigestSha256",
    "materializedAt",
    "resolutionStatus",
    "schemaId",
    "schemaVersion"
  ];
  if (
    canonicalizeInboxV2Json(keys) !== canonicalizeInboxV2Json(expectedKeys) ||
    fact.schemaId !== SUBJECTLESS_IDENTITY_FACT_SCHEMA_ID ||
    fact.schemaVersion !== "v1" ||
    (fact.resolutionStatus !== "unresolved" &&
      fact.resolutionStatus !== "conflicted" &&
      fact.resolutionStatus !== "claimed")
  ) {
    throw invariantError(
      "Assessment provenance has an invalid subjectless identity fact."
    );
  }
  const materializedAt = timestampValue(
    fact.materializedAt,
    "subjectless identity materializedAt"
  );
  const identityUpdatedAt = timestampValue(
    fact.identityUpdatedAt,
    "subjectless identity updatedAt"
  );
  if (Date.parse(identityUpdatedAt) < Date.parse(materializedAt)) {
    throw invariantError(
      "Assessment provenance subjectless identity fact has invalid timestamps."
    );
  }
  const latestClaimVersion = nullableClaimVersion(fact.latestClaimVersion);
  if (fact.resolutionStatus === "claimed" && latestClaimVersion === null) {
    throw invariantError(
      "Claimed subjectless identity fact requires a claim version."
    );
  }
  return Object.freeze({
    schemaId: SUBJECTLESS_IDENTITY_FACT_SCHEMA_ID,
    schemaVersion: "v1",
    materializationDigestSha256: shaDigest(
      fact.materializationDigestSha256,
      "subjectless identity materialization digest"
    ),
    identityRevision: revisionValue(
      fact.identityRevision,
      "subjectless identity revision"
    ),
    resolutionStatus: fact.resolutionStatus,
    latestClaimVersion,
    materializedAt,
    identityUpdatedAt
  });
}

async function validateActiveClaim(
  executor: RawSqlExecutor,
  identity: LockedIdentityRow,
  claim: ClaimTarget | null
): Promise<ApplyInboxV2SourceIdentityAssessmentResult | null> {
  const activeClaimId = nullableString(identity.active_claim_id);
  if (claim === null) return null;
  if (activeClaimId === null || identity.resolution_status !== "claimed") {
    return { kind: "active_claim_required" };
  }
  if (
    activeClaimId !== claim.claimId ||
    nullableClaimVersion(identity.latest_claim_version) !== claim.claimVersion
  ) {
    return { kind: "claim_mismatch" };
  }
  const tenantId = stringValue(identity.tenant_id, "identity tenant");
  const sourceExternalIdentityId = stringValue(identity.id, "identity ID");
  const result = await executor.execute<ActiveClaimRow>(sql`
    select id, claim_version::text as claim_version,
           target_kind::text as target_kind, target_employee_id,
           target_client_contact_id, status::text as status
    from public.inbox_v2_source_identity_claims
    where tenant_id = ${tenantId}
      and source_external_identity_id = ${sourceExternalIdentityId}
      and id = ${claim.claimId}
    for update
  `);
  if (result.rows.length !== 1) return { kind: "claim_mismatch" };
  const row = result.rows[0]!;
  const matches =
    row.status === "active" &&
    row.id === claim.claimId &&
    claimVersionValue(row.claim_version, "active claim version") ===
      claim.claimVersion &&
    row.target_kind === claim.kind &&
    (claim.kind === "employee"
      ? row.target_employee_id === claim.employeeId &&
        row.target_client_contact_id === null
      : row.target_client_contact_id === claim.clientContactId &&
        row.target_employee_id === null);
  return matches ? null : { kind: "claim_mismatch" };
}

async function persistObservation(
  executor: RawSqlExecutor,
  input: PreparedAssessment
): Promise<ApplyInboxV2SourceIdentityAssessmentResult | null> {
  await executor.execute(buildInsertInboxV2SourceIdentityObservationSql(input));
  const result = await executor.execute<ObservationRow>(
    buildFindInboxV2SourceIdentityObservationSql({
      tenantId: input.input.tenantId,
      normalizedEventId: input.input.normalizedEventId,
      observationKey: input.input.observationKey
    })
  );
  if (result.rows.length !== 1) {
    throw invariantError("Source identity observation binding is missing.");
  }
  const row = result.rows[0]!;
  if (
    row.source_external_identity_id !== input.input.sourceExternalIdentityId ||
    row.safe_envelope_hmac_sha256 !== input.safeEnvelopeHmacSha256 ||
    row.purpose !== input.observation.purpose ||
    row.observation_digest_sha256 !== input.observationDigestSha256 ||
    timestampValue(row.observed_at, "observation observedAt") !==
      input.observation.observedAt
  ) {
    return {
      kind: "observation_conflict",
      identityId: stringValue(
        row.source_external_identity_id,
        "conflicting observation identity"
      )
    };
  }
  return null;
}

function mapIdentity(
  row: LockedIdentityRow,
  tenantId: InboxV2TenantId
): InboxV2SourceExternalIdentity {
  const activeClaimId = nullableString(row.active_claim_id);
  const latestClaimVersion = nullableClaimVersion(row.latest_claim_version);
  const scope =
    row.scope_kind === "provider"
      ? { kind: "provider" as const }
      : row.scope_kind === "source_connection"
        ? {
            kind: "source_connection" as const,
            owner: {
              tenantId,
              kind: "source_connection" as const,
              id: stringValue(
                row.scope_source_connection_id,
                "identity connection"
              )
            }
          }
        : {
            kind: "source_account" as const,
            owner: {
              tenantId,
              kind: "source_account" as const,
              id: stringValue(row.scope_source_account_id, "identity account")
            }
          };
  const stability =
    row.stability_kind === "stable"
      ? { kind: "stable" as const }
      : {
          kind: "observation_ephemeral" as const,
          observation:
            row.ephemeral_normalized_inbound_event_id !== null
              ? {
                  tenantId,
                  kind: "normalized_inbound_event" as const,
                  id: stringValue(
                    row.ephemeral_normalized_inbound_event_id,
                    "identity normalized observation"
                  )
                }
              : {
                  tenantId,
                  kind: "raw_inbound_event" as const,
                  id: stringValue(
                    row.ephemeral_raw_inbound_event_id,
                    "identity raw observation"
                  )
                },
          observationKey: stringValue(
            row.ephemeral_observation_key,
            "identity observation key"
          )
        };
  const resolution =
    row.resolution_status === "claimed"
      ? {
          status: "claimed" as const,
          activeClaim: {
            tenantId,
            kind: "source_identity_claim" as const,
            id: stringValue(activeClaimId, "active claim ID")
          }
        }
      : row.resolution_status === "conflicted"
        ? { status: "conflicted" as const }
        : { status: "unresolved" as const };
  return inboxV2SourceExternalIdentitySchema.parse({
    tenantId,
    id: row.id,
    realm: {
      realmId: row.realm_id,
      version: row.realm_version,
      canonicalizationVersion: row.canonicalization_version
    },
    objectKindId: row.object_kind_id,
    scope,
    identityDeclaration: row.identity_declaration,
    materializationAuthority: {
      kind: "trusted_service",
      tenantId,
      trustedServiceId: row.materialized_by_trusted_service_id,
      authorizationToken: row.materialization_authorization_token,
      authorizedAt: timestampValue(
        row.materialized_at,
        "identity materialization authorization"
      )
    },
    materializedAt: timestampValue(
      row.materialized_at,
      "identity materializedAt"
    ),
    canonicalExternalSubject: row.canonical_external_subject,
    stability,
    resolution,
    latestClaimVersion,
    revision: row.identity_revision,
    createdAt: timestampValue(row.identity_created_at, "identity createdAt"),
    updatedAt: timestampValue(row.identity_updated_at, "identity updatedAt")
  });
}

function mapAssessmentRow(
  row: AssessmentRow,
  tenantId: InboxV2TenantId
): PersistedInboxV2SourceIdentityAssessment {
  const outcome = persistenceOutcomeValue(row.outcome);
  const confidence = confidenceValue(row.confidence);
  const evidence = arrayValue(row.evidence, "assessment evidence").map((item) =>
    inboxV2SourceIdentityResolutionEvidenceSchema.parse(item)
  );
  const candidates = arrayValue(row.candidates, "assessment candidates").map(
    (item) => inboxV2SourceIdentityResolutionCandidateSchema.parse(item)
  );
  const provenance = parseAssessmentProvenance(row.provenance);
  const assessment = provenance.assessment;
  const claim = claimFromRow(row);
  return Object.freeze({
    tenantId,
    assessmentId: stringValue(row.id, "assessment ID"),
    sourceExternalIdentityId: inboxV2SourceExternalIdentityIdSchema.parse(
      row.source_external_identity_id
    ),
    normalizedEventId: stringValue(
      row.normalized_event_id,
      "assessment normalized event"
    ),
    observationKey: stringValue(
      row.observation_key,
      "assessment observation key"
    ),
    safeEnvelopeHmacSha256: hmacDigest(
      row.safe_envelope_hmac_sha256,
      "assessment envelope HMAC"
    ),
    previousAssessmentVersion: nullableRevision(
      row.previous_assessment_version
    ),
    assessmentVersion: revisionValue(
      row.assessment_version,
      "assessment version"
    ),
    outcome,
    confidence,
    evidence: Object.freeze(evidence),
    candidates: Object.freeze(candidates),
    sourceExternalIdentityFact: provenance.sourceExternalIdentityFact,
    assessment,
    assessmentDigestSha256: shaDigest(
      row.assessment_digest_sha256,
      "assessment digest"
    ),
    idempotencyKey: stringValue(
      row.idempotency_key,
      "assessment idempotency key"
    ),
    claim,
    assessedAt: timestampValue(row.assessed_at, "assessment assessedAt")
  });
}

function assessmentProvenance(
  input: Pick<PreparedAssessment, "sourceExternalIdentityFact" | "assessment">
): AssessmentProvenance {
  return Object.freeze({
    schemaId: ASSESSMENT_PROVENANCE_SCHEMA_ID,
    schemaVersion: "v2",
    sourceExternalIdentityFact: input.sourceExternalIdentityFact,
    assessment: input.assessment
  });
}

function parseAssessmentProvenance(value: unknown): AssessmentProvenance {
  const provenance = objectValue(value, "assessment provenance");
  const keys = Object.keys(provenance).sort();
  const expectedKeys = [
    "assessment",
    "schemaId",
    "schemaVersion",
    "sourceExternalIdentityFact"
  ];
  if (
    canonicalizeInboxV2Json(keys) !== canonicalizeInboxV2Json(expectedKeys) ||
    provenance.schemaId !== ASSESSMENT_PROVENANCE_SCHEMA_ID ||
    provenance.schemaVersion !== "v2"
  ) {
    throw invariantError("Assessment provenance has an invalid envelope.");
  }
  return Object.freeze({
    schemaId: ASSESSMENT_PROVENANCE_SCHEMA_ID,
    schemaVersion: "v2",
    sourceExternalIdentityFact: parseSubjectlessIdentityFact(
      provenance.sourceExternalIdentityFact
    ),
    assessment: inboxV2SourceIdentityAssessmentSchema.parse(
      provenance.assessment
    )
  });
}

function persistenceOutcome(
  assessment: InboxV2SourceIdentityAssessment
): PersistenceOutcome {
  switch (assessment.outcome) {
    case "unresolved":
    case "conflicted":
      return assessment.outcome;
    case "resolved_employee":
      return "claimed_employee";
    case "resolved_client_contact":
      return "claimed_client_contact";
  }
}

function claimFromAssessment(
  assessment: InboxV2SourceIdentityAssessment
): ClaimTarget | null {
  if (assessment.outcome === "resolved_employee") {
    return Object.freeze({
      kind: "employee",
      claimId: assessment.claim.id,
      claimVersion: assessment.claimVersion,
      employeeId: assessment.employee.id
    });
  }
  if (assessment.outcome === "resolved_client_contact") {
    return Object.freeze({
      kind: "client_contact",
      claimId: assessment.claim.id,
      claimVersion: assessment.claimVersion,
      clientContactId: assessment.clientContact.id
    });
  }
  return null;
}

function claimFromRow(row: AssessmentRow): ClaimTarget | null {
  if (row.claim_target_kind === null) return null;
  const claimId = stringValue(row.claim_id, "assessment claim ID");
  const claimVersion = claimVersionValue(
    row.claim_version,
    "assessment claim version"
  );
  if (row.claim_target_kind === "employee") {
    return Object.freeze({
      kind: "employee",
      claimId,
      claimVersion,
      employeeId: stringValue(
        row.claim_target_employee_id,
        "assessment employee target"
      )
    });
  }
  if (row.claim_target_kind === "client_contact") {
    return Object.freeze({
      kind: "client_contact",
      claimId,
      claimVersion,
      clientContactId: stringValue(
        row.claim_target_client_contact_id,
        "assessment client-contact target"
      )
    });
  }
  throw invariantError("Assessment row has an invalid claim target kind.");
}

function claimColumns(claim: ClaimTarget | null): {
  claimId: string | null;
  claimVersion: string | null;
  targetKind: "employee" | "client_contact" | null;
  employeeId: string | null;
  clientContactId: string | null;
} {
  if (claim === null) {
    return {
      claimId: null,
      claimVersion: null,
      targetKind: null,
      employeeId: null,
      clientContactId: null
    };
  }
  return claim.kind === "employee"
    ? {
        claimId: claim.claimId,
        claimVersion: claim.claimVersion,
        targetKind: "employee",
        employeeId: claim.employeeId,
        clientContactId: null
      }
    : {
        claimId: claim.claimId,
        claimVersion: claim.claimVersion,
        targetKind: "client_contact",
        employeeId: null,
        clientContactId: claim.clientContactId
      };
}

function persistedFromPrepared(
  input: PreparedAssessment
): PersistedInboxV2SourceIdentityAssessment {
  return Object.freeze({
    tenantId: input.input.tenantId,
    assessmentId: input.input.assessmentId,
    sourceExternalIdentityId: input.input.sourceExternalIdentityId,
    normalizedEventId: input.input.normalizedEventId,
    observationKey: input.input.observationKey,
    safeEnvelopeHmacSha256: input.safeEnvelopeHmacSha256,
    previousAssessmentVersion: input.previousVersion,
    assessmentVersion: input.version,
    outcome: input.outcome,
    confidence: input.confidence,
    evidence: input.evidence,
    candidates: input.candidates,
    sourceExternalIdentityFact: input.sourceExternalIdentityFact,
    assessment: input.assessment,
    assessmentDigestSha256: input.assessmentDigestSha256,
    idempotencyKey: input.input.idempotencyKey,
    claim: input.claim,
    assessedAt: input.assessment.assessedAt
  });
}

function persistenceOutcomeValue(value: unknown): PersistenceOutcome {
  if (
    value === "unresolved" ||
    value === "conflicted" ||
    value === "claimed_employee" ||
    value === "claimed_client_contact"
  ) {
    return value;
  }
  throw invariantError("Assessment row has an invalid outcome.");
}

function confidenceValue(value: unknown): Confidence {
  if (
    value === "none" ||
    value === "weak" ||
    value === "strong" ||
    value === "verified"
  ) {
    return value;
  }
  throw invariantError("Assessment row has invalid confidence.");
}

function incrementVersion(
  current: InboxV2EntityRevision | null
): InboxV2EntityRevision {
  const next = current === null ? 1n : BigInt(current) + 1n;
  if (next > 9_223_372_036_854_775_807n) {
    throw invariantError("Source identity assessment version overflow.");
  }
  return inboxV2EntityRevisionSchema.parse(next.toString());
}

async function runResolutionTransaction<TResult>(
  executor: InboxV2SourceIdentityResolutionTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  for (let attempt = 1; attempt <= TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await executor.transaction(work, TRANSACTION_CONFIG);
    } catch (error) {
      if (attempt === TRANSACTION_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }
    }
  }
  throw invariantError(
    "Source identity assessment transaction retry exhausted."
  );
}

function isRetryableError(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      (typeof current !== "object" || current === null) &&
      typeof current !== "function"
    ) {
      return false;
    }
    if (seen.has(current)) return false;
    seen.add(current);
    const code = Reflect.get(current, "code");
    if (typeof code === "string" && RETRYABLE_SQLSTATES.has(code)) return true;
    current = Reflect.get(current, "cause");
  }
  return false;
}

async function expectOneRow(
  executor: RawSqlExecutor,
  query: SQL,
  operation: string
): Promise<void> {
  const result = await executor.execute<IdRow>(query);
  if (result.rows.length !== 1) {
    throw invariantError(`${operation} did not affect exactly one row.`);
  }
}

function revisionValue(value: unknown, label: string): InboxV2EntityRevision {
  try {
    return inboxV2EntityRevisionSchema.parse(
      typeof value === "bigint" ? value.toString() : value
    );
  } catch (error) {
    throw invariantError(`Invalid ${label}.`, error);
  }
}

function nullableRevision(value: unknown): InboxV2EntityRevision | null {
  return value === null || value === undefined
    ? null
    : revisionValue(value, "nullable revision");
}

function claimVersionValue(
  value: unknown,
  label: string
): InboxV2SourceIdentityClaimVersion {
  try {
    return inboxV2SourceIdentityClaimVersionSchema.parse(
      typeof value === "bigint" ? value.toString() : value
    );
  } catch (error) {
    throw invariantError(`Invalid ${label}.`, error);
  }
}

function nullableClaimVersion(
  value: unknown
): InboxV2SourceIdentityClaimVersion | null {
  return value === null || value === undefined
    ? null
    : claimVersionValue(value, "nullable claim version");
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invariantError(`Invalid ${label}.`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value, "nullable string");
}

function timestampValue(value: unknown, label: string): string {
  const candidate = value instanceof Date ? value.toISOString() : value;
  if (
    typeof candidate !== "string" ||
    !Number.isFinite(Date.parse(candidate))
  ) {
    throw invariantError(`Invalid ${label}.`);
  }
  return new Date(candidate).toISOString();
}

function hmacDigest(value: unknown, label: string): string {
  const candidate = stringValue(value, label);
  if (!/^hmac-sha256:[0-9a-f]{64}$/u.test(candidate)) {
    throw invariantError(`Invalid ${label}.`);
  }
  return candidate;
}

function shaDigest(value: unknown, label: string): string {
  const candidate = stringValue(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) {
    throw invariantError(`Invalid ${label}.`);
  }
  return candidate;
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw invariantError(`Invalid ${label}.`);
  return value;
}

function objectValue(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invariantError(`Invalid ${label}.`);
  }
  return value as JsonObject;
}

function invariantError(
  message: string,
  cause?: unknown
): InboxV2PersistenceInvariantError {
  const error = new InboxV2PersistenceInvariantError(message);
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
}

export type { RawSqlExecutor, RawSqlQueryResult };
