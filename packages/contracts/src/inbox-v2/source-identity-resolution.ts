import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2ExternalThreadKeySchema } from "./external-thread";
import {
  inboxV2ClientContactReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2RawInboundEventReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceExternalIdentityReferenceSchema,
  inboxV2SourceIdentityClaimReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  inboxV2IdentityClaimPolicyIdSchema,
  inboxV2OpaqueExternalIdentityValueSchema,
  inboxV2ParticipantMembershipRoleSchema,
  inboxV2ProviderRosterAuthoritySchema,
  inboxV2ProviderRosterCompletenessSchema,
  inboxV2ProviderRosterMemberStateSchema,
  inboxV2ProviderRosterOmissionPolicySchema,
  inboxV2ProviderRosterOrderingSchema,
  inboxV2SourceExternalIdentitySchema,
  inboxV2SourceIdentityClaimEvidenceReferenceSchema,
  inboxV2SourceIdentityClaimVersionSchema,
  inboxV2SourceIdentityMaterializationAuthoritySchema,
  inboxV2SourceIdentityObjectKindIdSchema,
  inboxV2SourceIdentityRealmIdSchema,
  inboxV2SourceIdentityScopeSchema,
  inboxV2SourceIdentityStabilitySchema
} from "./participant-identity";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_EVENT,
  INBOX_V2_NORMALIZED_EVENT_ENVELOPE_SCHEMA_ID,
  inboxV2SourceNormalizationHmacSha256Schema
} from "./source-normalized-ingress";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2AdapterIdentityDeclarationSchema,
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema
} from "./source-routing-primitives";

export const INBOX_V2_SOURCE_IDENTITY_OBSERVATION_RECORD_SCHEMA_ID =
  "core:inbox-v2.source-identity-observation-record" as const;
export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_RECORD_SCHEMA_ID =
  "core:inbox-v2.source-identity-resolution-record" as const;
export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_BATCH_SCHEMA_ID =
  "core:inbox-v2.source-identity-resolution-batch" as const;
export const INBOX_V2_DEFERRED_PARTICIPANT_INTENT_SCHEMA_ID =
  "core:inbox-v2.deferred-participant-intent" as const;
export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_OBSERVATIONS =
  INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_EVENT;
export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_EVIDENCE = 64;
export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_CANDIDATES = 50;

export const inboxV2SourceIdentityObservationPurposeSchema = z.enum([
  "message_author",
  "action_actor",
  "membership_subject",
  "roster_member"
]);

export const inboxV2SourceIdentityResolutionConfidenceSchema = z.enum([
  "none",
  "weak",
  "strong",
  "verified"
]);

export const inboxV2SourceIdentityObservationScopeSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("provider") }).strict(),
    z
      .object({
        kind: z.literal("source_connection"),
        owner: inboxV2SourceConnectionReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("source_account"),
        owner: inboxV2SourceAccountReferenceSchema
      })
      .strict()
  ]
);

export const inboxV2SourceNormalizedIdentityObservationSchema = z
  .object({
    observationKey: inboxV2RoutingTokenSchema,
    purpose: inboxV2SourceIdentityObservationPurposeSchema,
    identityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
    realm: z
      .object({
        realmId: inboxV2SourceIdentityRealmIdSchema,
        realmVersion: inboxV2SchemaVersionTokenSchema,
        canonicalizationVersion: inboxV2SchemaVersionTokenSchema
      })
      .strict(),
    scope: inboxV2SourceIdentityObservationScopeSchema,
    objectKindId: inboxV2SourceIdentityObjectKindIdSchema,
    observedExternalSubject: inboxV2OpaqueProviderSubjectSchema,
    canonicalExternalSubject: inboxV2OpaqueProviderSubjectSchema,
    stability: z.enum(["stable", "observation_ephemeral"]),
    observedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((observation, context) => {
    const declaration = observation.identityDeclaration;
    if (
      declaration.identityKind !== "source_external_identity" ||
      String(declaration.realmId) !== String(observation.realm.realmId) ||
      declaration.realmVersion !== observation.realm.realmVersion ||
      declaration.canonicalizationVersion !==
        observation.realm.canonicalizationVersion ||
      String(declaration.objectKindId) !== String(observation.objectKindId) ||
      declaration.scopeKind !== observation.scope.kind
    ) {
      addIssue(
        context,
        ["identityDeclaration"],
        "Source identity observation must match its exact adapter declaration."
      );
    }
    if (
      observation.observedExternalSubject !==
      observation.canonicalExternalSubject
    ) {
      addIssue(
        context,
        ["canonicalExternalSubject"],
        "Opaque identity subjects must remain byte-for-byte equal after adapter-owned canonicalization."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        declaration.adapterContract.loadedAt,
        observation.observedAt
      )
    ) {
      addIssue(
        context,
        ["observedAt"],
        "Identity observation cannot predate its pinned adapter contract."
      );
    }
  });

export const inboxV2SourceNormalizedRosterObservationSchema = z
  .object({
    completeness: inboxV2ProviderRosterCompletenessSchema,
    authority: inboxV2ProviderRosterAuthoritySchema,
    omissionPolicy: inboxV2ProviderRosterOmissionPolicySchema,
    ordering: inboxV2ProviderRosterOrderingSchema,
    members: z
      .array(
        z
          .object({
            identityObservationKey: inboxV2RoutingTokenSchema,
            state: inboxV2ProviderRosterMemberStateSchema,
            normalizedRole: inboxV2ParticipantMembershipRoleSchema
          })
          .strict()
      )
      .max(INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_OBSERVATIONS),
    observedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((roster, context) => {
    if (
      roster.omissionPolicy === "close_missing" &&
      (roster.completeness !== "complete" ||
        roster.authority !== "authoritative")
    ) {
      addIssue(
        context,
        ["omissionPolicy"],
        "Only complete authoritative roster evidence may close missing members."
      );
    }
    addContiguousUniqueStringIssues(
      context,
      roster.members.map((member) => member.identityObservationKey),
      ["members"],
      "Roster member observation keys must be unique."
    );
  });

/**
 * Exact external-thread descriptor retained before SRC-005 selects or creates
 * an ExternalThread, Conversation and SourceThreadBinding. It contains no
 * canonical Hulee Conversation or binding reference by design.
 */
export const inboxV2DeferredParticipantExternalThreadContextSchema = z
  .object({
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema.nullable(),
    identityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
    key: inboxV2ExternalThreadKeySchema,
    observedExternalSubject: inboxV2OpaqueProviderSubjectSchema
  })
  .strict()
  .superRefine((thread, context) => {
    const declaration = thread.identityDeclaration;
    if (
      declaration.identityKind !== "external_thread" ||
      String(declaration.realmId) !== String(thread.key.realm.realmId) ||
      declaration.realmVersion !== thread.key.realm.realmVersion ||
      declaration.canonicalizationVersion !==
        thread.key.realm.canonicalizationVersion ||
      String(declaration.objectKindId) !== String(thread.key.objectKindId) ||
      declaration.scopeKind !== thread.key.scope.kind
    ) {
      addIssue(
        context,
        ["identityDeclaration"],
        "Deferred participant thread context must match its exact adapter declaration."
      );
    }
    if (
      thread.observedExternalSubject !== thread.key.canonicalExternalSubject
    ) {
      addIssue(
        context,
        ["observedExternalSubject"],
        "Opaque external-thread subjects cannot be trimmed, folded or normalized by core."
      );
    }
    addThreadSourceScopeIssues(context, thread);
  });

/**
 * Closed, identity-only projection read from a persisted SRC-003 normalized
 * envelope. A DB adapter should explicitly project these fields and parse the
 * result instead of casting arbitrary JSONB.
 */
export const inboxV2SourceNormalizedEventForIdentityResolutionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rawInboundEvent: inboxV2RawInboundEventReferenceSchema,
    normalizedInboundEvent: inboxV2NormalizedInboundEventReferenceSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema.nullable(),
    domain: z.literal("core:inbox-v2.normalized-event-safe-envelope"),
    schemaId: z.literal(INBOX_V2_NORMALIZED_EVENT_ENVELOPE_SCHEMA_ID),
    schemaVersion: z.literal(INBOX_V2_INITIAL_SCHEMA_VERSION),
    safeEnvelopeHmacSha256: inboxV2SourceNormalizationHmacSha256Schema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    thread: inboxV2DeferredParticipantExternalThreadContextSchema,
    identityObservations: z
      .array(inboxV2SourceNormalizedIdentityObservationSchema)
      .max(INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_OBSERVATIONS),
    rosterObservation:
      inboxV2SourceNormalizedRosterObservationSchema.nullable(),
    recordedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((event, context) => {
    addTenantReferenceIssue(context, event.tenantId, event.rawInboundEvent, [
      "rawInboundEvent"
    ]);
    addTenantReferenceIssue(
      context,
      event.tenantId,
      event.normalizedInboundEvent,
      ["normalizedInboundEvent"]
    );
    addTenantReferenceIssue(context, event.tenantId, event.sourceConnection, [
      "sourceConnection"
    ]);
    if (event.sourceAccount !== null) {
      addTenantReferenceIssue(context, event.tenantId, event.sourceAccount, [
        "sourceAccount"
      ]);
    }
    if (
      event.thread.sourceConnection.tenantId !== event.tenantId ||
      String(event.thread.sourceConnection.id) !==
        String(event.sourceConnection.id) ||
      !sameNullableReference(event.thread.sourceAccount, event.sourceAccount)
    ) {
      addIssue(
        context,
        ["thread"],
        "Normalized event thread context must use the exact source connection/account row projection."
      );
    }
    if (
      !sameValue(
        event.thread.identityDeclaration.adapterContract,
        event.adapterContract
      )
    ) {
      addIssue(
        context,
        ["thread", "identityDeclaration", "adapterContract"],
        "Thread declaration must use the normalized event adapter contract."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        event.adapterContract.loadedAt,
        event.recordedAt
      )
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "Normalized event cannot predate its pinned adapter contract."
      );
    }

    const observationsByKey = new Map<
      string,
      z.infer<typeof inboxV2SourceNormalizedIdentityObservationSchema>
    >();
    for (const [index, observation] of event.identityObservations.entries()) {
      const key = String(observation.observationKey);
      if (observationsByKey.has(key)) {
        addIssue(
          context,
          ["identityObservations", index, "observationKey"],
          "Normalized identity observation keys must be unique in one event."
        );
      }
      observationsByKey.set(key, observation);
      if (
        !sameValue(
          observation.identityDeclaration.adapterContract,
          event.adapterContract
        )
      ) {
        addIssue(
          context,
          [
            "identityObservations",
            index,
            "identityDeclaration",
            "adapterContract"
          ],
          "Identity observation must use the normalized event adapter contract."
        );
      }
      addObservationSourceScopeIssues(
        context,
        observation,
        event.sourceConnection,
        event.sourceAccount,
        ["identityObservations", index, "scope"]
      );
      if (
        !isInboxV2TimestampOrderValid(observation.observedAt, event.recordedAt)
      ) {
        addIssue(
          context,
          ["identityObservations", index, "observedAt"],
          "Identity observation cannot be recorded before it was observed."
        );
      }
    }

    if (event.rosterObservation !== null) {
      if (
        !isInboxV2TimestampOrderValid(
          event.rosterObservation.observedAt,
          event.recordedAt
        )
      ) {
        addIssue(
          context,
          ["rosterObservation", "observedAt"],
          "Roster observation cannot be recorded before it was observed."
        );
      }
      for (const [index, member] of event.rosterObservation.members.entries()) {
        const observation = observationsByKey.get(
          String(member.identityObservationKey)
        );
        if (observation === undefined) {
          addIssue(
            context,
            ["rosterObservation", "members", index, "identityObservationKey"],
            "Roster member must reference an identity observation from the exact normalized event."
          );
        } else if (
          observation.purpose !== "roster_member" ||
          observation.observedAt !== event.rosterObservation.observedAt
        ) {
          addIssue(
            context,
            ["rosterObservation", "members", index],
            "Roster member identity must be a same-time roster_member observation."
          );
        }
      }
    }
  });

/**
 * Immutable SourceExternalIdentity fields fixed at materialization. Claim and
 * resolution heads are deliberately excluded because they change over time.
 */
export const inboxV2SourceIdentityMaterializationSnapshotSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2SourceExternalIdentityIdSchema,
    realm: z
      .object({
        realmId: inboxV2SourceIdentityRealmIdSchema,
        version: inboxV2SchemaVersionTokenSchema,
        canonicalizationVersion: inboxV2SchemaVersionTokenSchema
      })
      .strict(),
    objectKindId: inboxV2SourceIdentityObjectKindIdSchema,
    scope: inboxV2SourceIdentityScopeSchema,
    identityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
    materializationAuthority:
      inboxV2SourceIdentityMaterializationAuthoritySchema,
    materializedAt: inboxV2TimestampSchema,
    canonicalExternalSubject: inboxV2OpaqueExternalIdentityValueSchema,
    stability: inboxV2SourceIdentityStabilitySchema,
    createdAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((identity, context) => {
    const declaration = identity.identityDeclaration;
    if (
      declaration.identityKind !== "source_external_identity" ||
      String(declaration.realmId) !== String(identity.realm.realmId) ||
      declaration.realmVersion !== identity.realm.version ||
      declaration.canonicalizationVersion !==
        identity.realm.canonicalizationVersion ||
      String(declaration.objectKindId) !== String(identity.objectKindId) ||
      declaration.scopeKind !== identity.scope.kind
    ) {
      addIssue(
        context,
        ["identityDeclaration"],
        "Materialized source identity must match its exact adapter declaration."
      );
    }
    if (
      identity.materializationAuthority.tenantId !== identity.tenantId ||
      identity.materializationAuthority.trustedServiceId !==
        declaration.adapterContract.loadedByTrustedServiceId
    ) {
      addIssue(
        context,
        ["materializationAuthority"],
        "Source identity materialization requires the tenant and trusted service pinned by its adapter declaration."
      );
    }
    if (
      identity.materializationAuthority.authorizedAt !==
        identity.materializedAt ||
      identity.materializedAt !== identity.createdAt
    ) {
      addIssue(
        context,
        ["materializedAt"],
        "Source identity authorization, materialization and creation must share one commit boundary."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        declaration.adapterContract.loadedAt,
        identity.materializedAt
      )
    ) {
      addIssue(
        context,
        ["materializedAt"],
        "Source identity cannot predate its pinned adapter declaration."
      );
    }
    if ("owner" in identity.scope) {
      addTenantReferenceIssue(
        context,
        identity.tenantId,
        identity.scope.owner,
        ["scope", "owner"]
      );
    }
    if (identity.stability.kind === "observation_ephemeral") {
      addTenantReferenceIssue(
        context,
        identity.tenantId,
        identity.stability.observation,
        ["stability", "observation"]
      );
    }
  });

/** Immutable, replay-idempotent observation of one source actor. */
export const inboxV2SourceIdentityObservationRecordSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    normalizedInboundEvent: inboxV2NormalizedInboundEventReferenceSchema,
    observationKey: inboxV2RoutingTokenSchema,
    purpose: inboxV2SourceIdentityObservationPurposeSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema.nullable(),
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    safeEnvelopeHmacSha256: inboxV2SourceNormalizationHmacSha256Schema,
    observedExternalSubject: inboxV2OpaqueProviderSubjectSchema,
    sourceExternalIdentityMaterialization:
      inboxV2SourceIdentityMaterializationSnapshotSchema,
    observedAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    revision: z.literal("1")
  })
  .strict()
  .superRefine((observation, context) => {
    addTenantReferenceIssue(
      context,
      observation.tenantId,
      observation.normalizedInboundEvent,
      ["normalizedInboundEvent"]
    );
    addTenantReferenceIssue(
      context,
      observation.tenantId,
      observation.sourceConnection,
      ["sourceConnection"]
    );
    if (observation.sourceAccount !== null) {
      addTenantReferenceIssue(
        context,
        observation.tenantId,
        observation.sourceAccount,
        ["sourceAccount"]
      );
    }

    const identity = observation.sourceExternalIdentityMaterialization;
    if (identity.tenantId !== observation.tenantId) {
      addIssue(
        context,
        ["sourceExternalIdentityMaterialization", "tenantId"],
        "Source identity observation and materialized identity must share one tenant."
      );
    }
    if (
      !sameValue(
        identity.identityDeclaration.adapterContract,
        observation.adapterContract
      )
    ) {
      addIssue(
        context,
        [
          "sourceExternalIdentityMaterialization",
          "identityDeclaration",
          "adapterContract"
        ],
        "Observation and source identity must pin the exact same adapter contract."
      );
    }
    if (
      identity.canonicalExternalSubject !== observation.observedExternalSubject
    ) {
      addIssue(
        context,
        ["observedExternalSubject"],
        "Observed and canonical source identity subjects must remain byte-for-byte equal."
      );
    }
    addIdentitySourceScopeIssues(
      context,
      identity,
      observation.sourceConnection,
      observation.sourceAccount,
      ["sourceExternalIdentityMaterialization", "scope"]
    );
    if (identity.stability.kind === "observation_ephemeral") {
      if (
        identity.stability.observation.kind !== "normalized_inbound_event" ||
        identity.stability.observation.tenantId !== observation.tenantId ||
        String(identity.stability.observation.id) !==
          String(observation.normalizedInboundEvent.id) ||
        identity.stability.observationKey !== observation.observationKey
      ) {
        addIssue(
          context,
          ["sourceExternalIdentityMaterialization", "stability"],
          "Ephemeral source identity must be induced by this exact normalized observation."
        );
      }
    }
    if (
      !isInboxV2TimestampOrderValid(
        observation.adapterContract.loadedAt,
        observation.observedAt
      ) ||
      !isInboxV2TimestampOrderValid(
        observation.observedAt,
        observation.recordedAt
      ) ||
      !isInboxV2TimestampOrderValid(identity.createdAt, observation.recordedAt)
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "Observation persistence cannot predate provider evidence or identity materialization."
      );
    }
  });

export const inboxV2SourceIdentityResolutionEvidenceProvenanceSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("adapter_observation"),
        adapterContract: inboxV2AdapterContractSnapshotSchema,
        observationKey: inboxV2RoutingTokenSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("tenant_policy"),
        policyId: inboxV2IdentityClaimPolicyIdSchema,
        policyVersion: inboxV2SchemaVersionTokenSchema,
        ruleId: inboxV2CatalogIdSchema,
        ruleVersion: inboxV2SchemaVersionTokenSchema,
        evaluatedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("manual_review"),
        reviewerEmployee: inboxV2EmployeeReferenceSchema,
        reviewToken: inboxV2RoutingTokenSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("signed_import"),
        importPolicyId: inboxV2CatalogIdSchema,
        importPolicyVersion: inboxV2SchemaVersionTokenSchema,
        verifiedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
        signatureDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u)
      })
      .strict()
  ]);

/** Ordered, immutable evidence item used by one assessment revision. */
export const inboxV2SourceIdentityResolutionEvidenceSchema = z
  .object({
    ordinal: z.number().int().min(0).max(63),
    reference: inboxV2SourceIdentityClaimEvidenceReferenceSchema,
    confidence: z.enum(["weak", "strong", "verified"]),
    provenance: inboxV2SourceIdentityResolutionEvidenceProvenanceSchema,
    observedAt: inboxV2TimestampSchema
  })
  .strict();

/** One target considered by a deterministic resolver; never an authority grant. */
export const inboxV2SourceIdentityResolutionCandidateSchema = z
  .object({
    ordinal: z.number().int().min(0).max(49),
    target: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("employee"),
          employee: inboxV2EmployeeReferenceSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("client_contact"),
          clientContact: inboxV2ClientContactReferenceSchema
        })
        .strict()
    ]),
    confidence: z.enum(["weak", "strong", "verified"]),
    evidenceOrdinals: z.array(z.number().int().min(0).max(63)).min(1).max(64)
  })
  .strict()
  .superRefine((candidate, context) => {
    addCanonicalIntegerArrayIssues(
      context,
      candidate.evidenceOrdinals,
      ["evidenceOrdinals"],
      "Candidate evidence ordinals must be unique and ascending."
    );
  });

const assessmentEvidenceOrdinalsSchema = z
  .array(z.number().int().min(0).max(63))
  .max(64);
const assessmentCandidateOrdinalsSchema = z
  .array(z.number().int().min(0).max(49))
  .max(50);

export const inboxV2SourceIdentityAssessmentSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("unresolved"),
        confidence: z.enum(["none", "weak", "strong", "verified"]),
        reason: z.enum([
          "no_candidate",
          "insufficient_confidence",
          "policy_not_approved"
        ]),
        evidenceOrdinals: assessmentEvidenceOrdinalsSchema,
        candidateOrdinals: assessmentCandidateOrdinalsSchema,
        assessedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("conflicted"),
        confidence: z.enum(["weak", "strong", "verified"]),
        reason: z.enum(["multiple_candidates", "contradictory_evidence"]),
        evidenceOrdinals: assessmentEvidenceOrdinalsSchema.min(1),
        candidateOrdinals: assessmentCandidateOrdinalsSchema.min(2),
        assessedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("resolved_employee"),
        confidence: z.enum(["weak", "strong", "verified"]),
        evidenceOrdinals: assessmentEvidenceOrdinalsSchema.min(1),
        candidateOrdinal: z.number().int().min(0).max(49),
        employee: inboxV2EmployeeReferenceSchema,
        claim: inboxV2SourceIdentityClaimReferenceSchema,
        claimVersion: inboxV2SourceIdentityClaimVersionSchema,
        assessedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("resolved_client_contact"),
        confidence: z.enum(["weak", "strong", "verified"]),
        evidenceOrdinals: assessmentEvidenceOrdinalsSchema.min(1),
        candidateOrdinal: z.number().int().min(0).max(49),
        clientContact: inboxV2ClientContactReferenceSchema,
        claim: inboxV2SourceIdentityClaimReferenceSchema,
        claimVersion: inboxV2SourceIdentityClaimVersionSchema,
        assessedAt: inboxV2TimestampSchema
      })
      .strict()
  ]
);

/**
 * Append-only assessment of one exact durable observation. Candidate ordering
 * is canonical, and a resolved outcome cannot silently select the first of
 * several targets.
 */
export const inboxV2SourceIdentityResolutionRecordSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    observation: inboxV2SourceIdentityObservationRecordSchema,
    sourceExternalIdentitySnapshot: inboxV2SourceExternalIdentitySchema,
    previousAssessmentRevision: inboxV2EntityRevisionSchema.nullable(),
    assessmentRevision: inboxV2EntityRevisionSchema,
    evidence: z
      .array(inboxV2SourceIdentityResolutionEvidenceSchema)
      .max(INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_EVIDENCE),
    candidates: z
      .array(inboxV2SourceIdentityResolutionCandidateSchema)
      .max(INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_CANDIDATES),
    assessment: inboxV2SourceIdentityAssessmentSchema
  })
  .strict()
  .superRefine((record, context) => {
    if (record.observation.tenantId !== record.tenantId) {
      addIssue(
        context,
        ["observation", "tenantId"],
        "Resolution record and observation must share one tenant."
      );
    }
    if (
      !sameValue(
        sourceIdentityMaterializationProjection(
          record.sourceExternalIdentitySnapshot
        ),
        record.observation.sourceExternalIdentityMaterialization
      )
    ) {
      addIssue(
        context,
        ["sourceExternalIdentitySnapshot"],
        "Assessment identity head must retain the observation's immutable materialization fields."
      );
    }
    if (!isNextAssessmentRevision(record)) {
      addIssue(
        context,
        ["assessmentRevision"],
        "Assessment revisions must start at 1 and advance contiguously."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        record.sourceExternalIdentitySnapshot.updatedAt,
        record.assessment.assessedAt
      )
    ) {
      addIssue(
        context,
        ["sourceExternalIdentitySnapshot", "updatedAt"],
        "Assessment cannot predate the exact source identity head it evaluated."
      );
    }
    addContiguousOrdinalIssues(
      context,
      record.evidence.map((item) => item.ordinal),
      ["evidence"],
      "Resolution evidence ordinals must be contiguous from zero."
    );
    addContiguousOrdinalIssues(
      context,
      record.candidates.map((item) => item.ordinal),
      ["candidates"],
      "Resolution candidate ordinals must be contiguous from zero."
    );

    const evidenceByOrdinal = new Map(
      record.evidence.map((item) => [item.ordinal, item] as const)
    );
    const candidatesByOrdinal = new Map(
      record.candidates.map((item) => [item.ordinal, item] as const)
    );
    const targetKeys = new Set<string>();
    for (const [index, candidate] of record.candidates.entries()) {
      const target = candidateTargetReference(candidate);
      addTenantReferenceIssue(context, record.tenantId, target, [
        "candidates",
        index,
        "target"
      ]);
      const key = candidateTargetKey(candidate);
      if (targetKeys.has(key)) {
        addIssue(
          context,
          ["candidates", index, "target"],
          "One assessment must aggregate evidence into one candidate per exact target."
        );
      }
      targetKeys.add(key);
      for (const ordinal of candidate.evidenceOrdinals) {
        if (!evidenceByOrdinal.has(ordinal)) {
          addIssue(
            context,
            ["candidates", index, "evidenceOrdinals"],
            "Candidate references missing resolution evidence."
          );
        }
      }
      const candidateEvidence = candidate.evidenceOrdinals.flatMap(
        (ordinal) => {
          const evidence = evidenceByOrdinal.get(ordinal);
          return evidence === undefined ? [] : [evidence];
        }
      );
      if (
        candidateEvidence.length === candidate.evidenceOrdinals.length &&
        candidate.confidence !== maximumEvidenceConfidence(candidateEvidence)
      ) {
        addIssue(
          context,
          ["candidates", index, "confidence"],
          "Candidate confidence must equal the strongest exact evidence it references."
        );
      }
    }
    const evidenceFingerprints = new Set<string>();
    for (const [index, evidence] of record.evidence.entries()) {
      const evidenceFingerprint = sameValueFingerprint({
        reference: evidence.reference,
        provenance: evidence.provenance
      });
      if (evidenceFingerprints.has(evidenceFingerprint)) {
        addIssue(
          context,
          ["evidence", index],
          "Resolution evidence cannot contain an exact duplicate."
        );
      }
      evidenceFingerprints.add(evidenceFingerprint);
      addTenantReferenceIssue(
        context,
        record.tenantId,
        evidence.reference.reference,
        ["evidence", index, "reference", "reference"]
      );
      if (
        evidence.provenance.kind === "manual_review" &&
        evidence.provenance.reviewerEmployee.tenantId !== record.tenantId
      ) {
        addIssue(
          context,
          ["evidence", index, "provenance", "reviewerEmployee"],
          "Manual reviewer must belong to the assessment tenant."
        );
      }
      if (
        evidence.provenance.kind === "adapter_observation" &&
        (evidence.reference.kind !== "normalized_inbound_event" ||
          !sameValue(
            evidence.reference.reference,
            record.observation.normalizedInboundEvent
          ) ||
          !sameValue(
            evidence.provenance.adapterContract,
            record.observation.adapterContract
          ) ||
          evidence.provenance.observationKey !==
            record.observation.observationKey ||
          evidence.observedAt !== record.observation.observedAt)
      ) {
        addIssue(
          context,
          ["evidence", index, "provenance"],
          "Adapter evidence must identify the exact normalized event, observation time/key and adapter contract."
        );
      }
      if (
        !isInboxV2TimestampOrderValid(
          evidence.observedAt,
          record.assessment.assessedAt
        )
      ) {
        addIssue(
          context,
          ["evidence", index, "observedAt"],
          "Resolution assessment cannot predate its evidence."
        );
      }
    }
    if (
      !isInboxV2TimestampOrderValid(
        record.observation.recordedAt,
        record.assessment.assessedAt
      )
    ) {
      addIssue(
        context,
        ["assessment", "assessedAt"],
        "Resolution assessment cannot predate its durable observation."
      );
    }
    addAssessmentGraphIssues(
      context,
      record,
      evidenceByOrdinal,
      candidatesByOrdinal
    );
  });

export const inboxV2DeferredParticipantIntentKeySchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    externalThreadKey: inboxV2ExternalThreadKeySchema,
    sourceExternalIdentity: inboxV2SourceExternalIdentityReferenceSchema
  })
  .strict()
  .superRefine((key, context) => {
    addTenantReferenceIssue(context, key.tenantId, key.sourceExternalIdentity, [
      "sourceExternalIdentity"
    ]);
    if ("owner" in key.externalThreadKey.scope) {
      addTenantReferenceIssue(
        context,
        key.tenantId,
        key.externalThreadKey.scope.owner,
        ["externalThreadKey", "scope", "owner"]
      );
    }
  });

export const inboxV2DeferredParticipantInducingObservationSchema = z
  .object({
    normalizedInboundEvent: inboxV2NormalizedInboundEventReferenceSchema,
    safeEnvelopeHmacSha256: inboxV2SourceNormalizationHmacSha256Schema,
    observationKey: inboxV2RoutingTokenSchema,
    purpose: inboxV2SourceIdentityObservationPurposeSchema
  })
  .strict();

/**
 * Request to create/find a source-identity participant only after SRC-005 has
 * resolved this exact thread context. It carries no Conversation, binding,
 * membership, authorization, CRM, read-state or WorkItem mutation.
 */
export const inboxV2DeferredParticipantIntentSchema = z
  .object({
    key: inboxV2DeferredParticipantIntentKeySchema,
    externalThreadContext:
      inboxV2DeferredParticipantExternalThreadContextSchema,
    inducingObservations: z
      .array(inboxV2DeferredParticipantInducingObservationSchema)
      .min(1)
      .max(INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_OBSERVATIONS),
    membershipAuthority: z.enum(["none", "provider_evidence_required"]),
    recordedAt: inboxV2TimestampSchema,
    revision: z.literal("1")
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      !sameValue(intent.key.externalThreadKey, intent.externalThreadContext.key)
    ) {
      addIssue(
        context,
        ["externalThreadContext", "key"],
        "Deferred participant provenance must match its stable exact external-thread key."
      );
    }
    if (
      intent.externalThreadContext.sourceConnection.tenantId !==
        intent.key.tenantId ||
      (intent.externalThreadContext.sourceAccount !== null &&
        intent.externalThreadContext.sourceAccount.tenantId !==
          intent.key.tenantId)
    ) {
      addIssue(
        context,
        ["externalThreadContext"],
        "Deferred participant thread provenance must remain inside one tenant."
      );
    }
    const observationKeys = new Set<string>();
    for (const [index, observation] of intent.inducingObservations.entries()) {
      addTenantReferenceIssue(
        context,
        intent.key.tenantId,
        observation.normalizedInboundEvent,
        ["inducingObservations", index, "normalizedInboundEvent"]
      );
      const observationKey = String(observation.observationKey);
      if (observationKeys.has(observationKey)) {
        addIssue(
          context,
          ["inducingObservations", index, "observationKey"],
          "Deferred participant intent cannot repeat an inducing observation."
        );
      }
      observationKeys.add(observationKey);
    }
    const expectsProviderEvidence = intent.inducingObservations.some(
      (observation) =>
        observation.purpose === "membership_subject" ||
        observation.purpose === "roster_member"
    );
    if (
      expectsProviderEvidence !==
      (intent.membershipAuthority === "provider_evidence_required")
    ) {
      addIssue(
        context,
        ["membershipAuthority"],
        "Author-only intents cannot create membership, while membership observations require later binding-specific provider evidence."
      );
    }
  });

/** One bounded normalized-event mapping with no canonical Conversation lookup. */
export const inboxV2SourceIdentityResolutionBatchSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    sourceEvent: inboxV2SourceNormalizedEventForIdentityResolutionSchema,
    observations: z
      .array(inboxV2SourceIdentityObservationRecordSchema)
      .max(INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_OBSERVATIONS),
    resolutions: z
      .array(inboxV2SourceIdentityResolutionRecordSchema)
      .max(INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_OBSERVATIONS),
    deferredParticipantIntents: z
      .array(inboxV2DeferredParticipantIntentSchema)
      .max(INBOX_V2_SOURCE_IDENTITY_RESOLUTION_MAX_OBSERVATIONS),
    completedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((batch, context) => {
    if (batch.sourceEvent.tenantId !== batch.tenantId) {
      addIssue(
        context,
        ["sourceEvent", "tenantId"],
        "Identity resolution batch and normalized event must share one tenant."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        batch.sourceEvent.recordedAt,
        batch.completedAt
      )
    ) {
      addIssue(
        context,
        ["completedAt"],
        "Identity resolution cannot complete before normalized-event persistence."
      );
    }

    const normalizedObservations = new Map(
      batch.sourceEvent.identityObservations.map(
        (observation) =>
          [String(observation.observationKey), observation] as const
      )
    );
    const observations = new Map<string, (typeof batch.observations)[number]>();
    const firstObservationByIdentity = new Map<
      string,
      (typeof batch.observations)[number]
    >();
    const materializationByIdentity = new Map<string, string>();
    const identityByStableKey = new Map<string, string>();
    for (const [index, observation] of batch.observations.entries()) {
      const observationKey = String(observation.observationKey);
      if (observations.has(observationKey)) {
        addIssue(
          context,
          ["observations", index, "observationKey"],
          "Resolution batch contains a duplicate durable observation mapping."
        );
      }
      observations.set(observationKey, observation);
      const source = normalizedObservations.get(observationKey);
      if (
        source === undefined ||
        observation.tenantId !== batch.tenantId ||
        !sameValue(
          observation.normalizedInboundEvent,
          batch.sourceEvent.normalizedInboundEvent
        ) ||
        observation.safeEnvelopeHmacSha256 !==
          batch.sourceEvent.safeEnvelopeHmacSha256 ||
        !sameValue(
          observation.sourceConnection,
          batch.sourceEvent.sourceConnection
        ) ||
        !sameNullableReference(
          observation.sourceAccount,
          batch.sourceEvent.sourceAccount
        ) ||
        !observationMatchesNormalizedSource(observation, source) ||
        !isInboxV2TimestampOrderValid(
          batch.sourceEvent.recordedAt,
          observation.recordedAt
        )
      ) {
        addIssue(
          context,
          ["observations", index],
          "Durable observation must map the exact normalized event identity and persistence boundary."
        );
      }
      const identity = observation.sourceExternalIdentityMaterialization;
      const identityId = String(identity.id);
      const materializationFingerprint = sameValueFingerprint(identity);
      const existingMaterialization = materializationByIdentity.get(identityId);
      if (
        existingMaterialization !== undefined &&
        existingMaterialization !== materializationFingerprint
      ) {
        addIssue(
          context,
          ["observations", index, "sourceExternalIdentityMaterialization"],
          "One source identity cannot have conflicting immutable materialization snapshots."
        );
      }
      materializationByIdentity.set(identityId, materializationFingerprint);
      const stableKey = sourceIdentityStableKeyFingerprint(identity);
      const existingIdentityId = identityByStableKey.get(stableKey);
      if (
        existingIdentityId !== undefined &&
        existingIdentityId !== identityId
      ) {
        addIssue(
          context,
          [
            "observations",
            index,
            "sourceExternalIdentityMaterialization",
            "id"
          ],
          "One exact source identity key cannot materialize as several identities."
        );
      }
      identityByStableKey.set(stableKey, identityId);
      if (!firstObservationByIdentity.has(identityId)) {
        firstObservationByIdentity.set(identityId, observation);
      }
    }
    if (
      observations.size !== normalizedObservations.size ||
      [...normalizedObservations.keys()].some(
        (key) => !observations.has(key)
      ) ||
      !sameValue(
        batch.observations.map((observation) =>
          String(observation.observationKey)
        ),
        batch.sourceEvent.identityObservations.map((observation) =>
          String(observation.observationKey)
        )
      )
    ) {
      addIssue(
        context,
        ["observations"],
        "Resolution batch must map every normalized identity observation exactly once and in authenticated event order."
      );
    }

    const resolutionsByIdentity = new Map<
      string,
      (typeof batch.resolutions)[number]
    >();
    for (const [index, resolution] of batch.resolutions.entries()) {
      const identityId = String(resolution.sourceExternalIdentitySnapshot.id);
      if (resolutionsByIdentity.has(identityId)) {
        addIssue(
          context,
          ["resolutions", index, "sourceExternalIdentitySnapshot", "id"],
          "Resolution batch contains more than one assessment for one source identity."
        );
      }
      resolutionsByIdentity.set(identityId, resolution);
      const firstObservation = firstObservationByIdentity.get(identityId);
      if (
        resolution.tenantId !== batch.tenantId ||
        firstObservation === undefined ||
        !sameValue(resolution.observation, firstObservation) ||
        !isInboxV2TimestampOrderValid(
          resolution.assessment.assessedAt,
          batch.completedAt
        )
      ) {
        addIssue(
          context,
          ["resolutions", index],
          "One assessment must use the first authenticated observation for its exact source identity and finish inside the batch boundary."
        );
      }
    }
    if (
      resolutionsByIdentity.size !== firstObservationByIdentity.size ||
      [...firstObservationByIdentity.keys()].some(
        (identityId) => !resolutionsByIdentity.has(identityId)
      )
    ) {
      addIssue(
        context,
        ["resolutions"],
        "Resolution batch requires exactly one assessment per distinct source identity."
      );
    }

    const intentObservationKeys = new Set<string>();
    const intentKeys = new Set<string>();
    for (const [index, intent] of batch.deferredParticipantIntents.entries()) {
      const intentKey = deferredParticipantIntentKeyFingerprint(intent.key);
      if (intentKeys.has(intentKey)) {
        addIssue(
          context,
          ["deferredParticipantIntents", index, "key"],
          "Resolution batch must aggregate all observations for one exact thread/identity into one intent."
        );
      }
      intentKeys.add(intentKey);
      if (
        intent.key.tenantId !== batch.tenantId ||
        !sameValue(
          intent.key.externalThreadKey,
          batch.sourceEvent.thread.key
        ) ||
        !sameValue(intent.externalThreadContext, batch.sourceEvent.thread) ||
        !isInboxV2TimestampOrderValid(
          batch.sourceEvent.recordedAt,
          intent.recordedAt
        ) ||
        !isInboxV2TimestampOrderValid(intent.recordedAt, batch.completedAt)
      ) {
        addIssue(
          context,
          ["deferredParticipantIntents", index],
          "Deferred participant intent must retain the exact stable thread key and normalized-event provenance inside the batch boundary."
        );
      }
      for (const [
        observationIndex,
        inducing
      ] of intent.inducingObservations.entries()) {
        const observationKey = String(inducing.observationKey);
        const observation = observations.get(observationKey);
        const source = normalizedObservations.get(observationKey);
        const resolution =
          observation === undefined
            ? undefined
            : resolutionsByIdentity.get(
                String(observation.sourceExternalIdentityMaterialization.id)
              );
        if (intentObservationKeys.has(observationKey)) {
          addIssue(
            context,
            [
              "deferredParticipantIntents",
              index,
              "inducingObservations",
              observationIndex
            ],
            "Resolution batch cannot map one observation to several deferred intents."
          );
        }
        intentObservationKeys.add(observationKey);
        if (
          observation === undefined ||
          resolution === undefined ||
          source === undefined ||
          !sameValue(
            inducing.normalizedInboundEvent,
            batch.sourceEvent.normalizedInboundEvent
          ) ||
          inducing.safeEnvelopeHmacSha256 !==
            batch.sourceEvent.safeEnvelopeHmacSha256 ||
          inducing.purpose !== source.purpose ||
          String(intent.key.sourceExternalIdentity.id) !==
            String(observation.sourceExternalIdentityMaterialization.id) ||
          !isInboxV2TimestampOrderValid(
            resolution.assessment.assessedAt,
            intent.recordedAt
          )
        ) {
          addIssue(
            context,
            [
              "deferredParticipantIntents",
              index,
              "inducingObservations",
              observationIndex
            ],
            "Deferred participant intent must map the exact resolved identity and inducing observation."
          );
        }
      }
    }
    if (
      intentObservationKeys.size !== normalizedObservations.size ||
      [...normalizedObservations.keys()].some(
        (key) => !intentObservationKeys.has(key)
      )
    ) {
      addIssue(
        context,
        ["deferredParticipantIntents"],
        "Every normalized identity observation requires one deferred participant intent."
      );
    }
  });

export const inboxV2SourceIdentityObservationRecordEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_IDENTITY_OBSERVATION_RECORD_SCHEMA_ID,
    INBOX_V2_SOURCE_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    inboxV2SourceIdentityObservationRecordSchema
  );
export const inboxV2SourceIdentityResolutionRecordEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_IDENTITY_RESOLUTION_RECORD_SCHEMA_ID,
    INBOX_V2_SOURCE_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    inboxV2SourceIdentityResolutionRecordSchema
  );
export const inboxV2SourceIdentityResolutionBatchEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_IDENTITY_RESOLUTION_BATCH_SCHEMA_ID,
    INBOX_V2_SOURCE_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    inboxV2SourceIdentityResolutionBatchSchema
  );
export const inboxV2DeferredParticipantIntentEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_DEFERRED_PARTICIPANT_INTENT_SCHEMA_ID,
    INBOX_V2_SOURCE_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    inboxV2DeferredParticipantIntentSchema
  );

export type InboxV2SourceIdentityObservationPurpose = z.infer<
  typeof inboxV2SourceIdentityObservationPurposeSchema
>;
export type InboxV2SourceIdentityResolutionConfidence = z.infer<
  typeof inboxV2SourceIdentityResolutionConfidenceSchema
>;
export type InboxV2SourceNormalizedIdentityObservation = z.infer<
  typeof inboxV2SourceNormalizedIdentityObservationSchema
>;
export type InboxV2SourceNormalizedEventForIdentityResolution = z.infer<
  typeof inboxV2SourceNormalizedEventForIdentityResolutionSchema
>;
export type InboxV2SourceIdentityObservationRecord = z.infer<
  typeof inboxV2SourceIdentityObservationRecordSchema
>;
export type InboxV2SourceIdentityMaterializationSnapshot = z.infer<
  typeof inboxV2SourceIdentityMaterializationSnapshotSchema
>;
export type InboxV2SourceIdentityResolutionEvidence = z.infer<
  typeof inboxV2SourceIdentityResolutionEvidenceSchema
>;
export type InboxV2SourceIdentityResolutionCandidate = z.infer<
  typeof inboxV2SourceIdentityResolutionCandidateSchema
>;
export type InboxV2SourceIdentityAssessment = z.infer<
  typeof inboxV2SourceIdentityAssessmentSchema
>;
export type InboxV2SourceIdentityResolutionRecord = z.infer<
  typeof inboxV2SourceIdentityResolutionRecordSchema
>;
export type InboxV2DeferredParticipantIntentKey = z.infer<
  typeof inboxV2DeferredParticipantIntentKeySchema
>;
export type InboxV2DeferredParticipantIntent = z.infer<
  typeof inboxV2DeferredParticipantIntentSchema
>;
export type InboxV2SourceIdentityResolutionBatch = z.infer<
  typeof inboxV2SourceIdentityResolutionBatchSchema
>;

type TenantReference = Readonly<{ tenantId: string }>;
type ResolutionRecord = z.infer<
  typeof inboxV2SourceIdentityResolutionRecordSchema
>;
type EvidenceByOrdinal = ReadonlyMap<
  number,
  z.infer<typeof inboxV2SourceIdentityResolutionEvidenceSchema>
>;
type CandidateByOrdinal = ReadonlyMap<
  number,
  z.infer<typeof inboxV2SourceIdentityResolutionCandidateSchema>
>;

function addAssessmentGraphIssues(
  context: z.RefinementCtx,
  record: ResolutionRecord,
  evidenceByOrdinal: EvidenceByOrdinal,
  candidatesByOrdinal: CandidateByOrdinal
): void {
  const assessment = record.assessment;
  addCanonicalIntegerArrayIssues(
    context,
    assessment.evidenceOrdinals,
    ["assessment", "evidenceOrdinals"],
    "Assessment evidence ordinals must be unique and ascending."
  );
  for (const ordinal of assessment.evidenceOrdinals) {
    if (!evidenceByOrdinal.has(ordinal)) {
      addIssue(
        context,
        ["assessment", "evidenceOrdinals"],
        "Assessment references missing evidence."
      );
    }
  }
  if (
    !sameNumberArray(
      assessment.evidenceOrdinals,
      record.evidence.map((evidence) => evidence.ordinal)
    )
  ) {
    addIssue(
      context,
      ["assessment", "evidenceOrdinals"],
      "Assessment must account for the complete ordered evidence set."
    );
  }

  const identity = record.sourceExternalIdentitySnapshot;
  const maximumCandidateConfidence = maximumConfidence(record.candidates);
  if (assessment.outcome === "unresolved") {
    addCanonicalIntegerArrayIssues(
      context,
      assessment.candidateOrdinals,
      ["assessment", "candidateOrdinals"],
      "Unresolved candidate ordinals must be unique and ascending."
    );
    if (
      record.candidates.length > 1 ||
      !sameNumberArray(
        assessment.candidateOrdinals,
        record.candidates.map((candidate) => candidate.ordinal)
      ) ||
      assessment.confidence !== maximumCandidateConfidence ||
      (record.candidates.length === 0) !==
        (assessment.reason === "no_candidate")
    ) {
      addIssue(
        context,
        ["assessment"],
        "Unresolved assessment must retain zero or one complete candidate set and derived confidence without mutating the independent claim head."
      );
    }
    return;
  }

  if (assessment.outcome === "conflicted") {
    addCanonicalIntegerArrayIssues(
      context,
      assessment.candidateOrdinals,
      ["assessment", "candidateOrdinals"],
      "Conflicted candidate ordinals must be unique and ascending."
    );
    if (
      record.candidates.length < 2 ||
      !sameNumberArray(
        assessment.candidateOrdinals,
        record.candidates.map((candidate) => candidate.ordinal)
      ) ||
      assessment.confidence !== maximumCandidateConfidence
    ) {
      addIssue(
        context,
        ["assessment"],
        "Conflicted assessment must retain all distinct candidates and derived confidence without implicitly changing the independent claim head."
      );
    }
    return;
  }

  const selected = candidatesByOrdinal.get(assessment.candidateOrdinal);
  const selectedTarget = selected && candidateTargetReference(selected);
  const expectedTarget =
    assessment.outcome === "resolved_employee"
      ? assessment.employee
      : assessment.clientContact;
  const expectedKind =
    assessment.outcome === "resolved_employee" ? "employee" : "client_contact";
  if (
    record.candidates.length !== 1 ||
    selected === undefined ||
    selected.target.kind !== expectedKind ||
    selectedTarget === undefined ||
    !sameValue(selectedTarget, expectedTarget) ||
    selected.confidence !== assessment.confidence ||
    !sameNumberArray(selected.evidenceOrdinals, assessment.evidenceOrdinals) ||
    identity.resolution.status !== "claimed" ||
    String(identity.resolution.activeClaim.id) !==
      String(assessment.claim.id) ||
    identity.resolution.activeClaim.tenantId !== assessment.claim.tenantId ||
    String(identity.latestClaimVersion) !== String(assessment.claimVersion)
  ) {
    addIssue(
      context,
      ["assessment"],
      "Resolved assessment requires one exact candidate and the matching active claim snapshot; first-match selection is forbidden."
    );
  }
  addTenantReferenceIssue(context, record.tenantId, expectedTarget, [
    "assessment",
    assessment.outcome === "resolved_employee" ? "employee" : "clientContact"
  ]);
  addTenantReferenceIssue(context, record.tenantId, assessment.claim, [
    "assessment",
    "claim"
  ]);
}

function observationMatchesNormalizedSource(
  observation: z.infer<typeof inboxV2SourceIdentityObservationRecordSchema>,
  source: z.infer<typeof inboxV2SourceNormalizedIdentityObservationSchema>
): boolean {
  const identity = observation.sourceExternalIdentityMaterialization;
  return (
    observation.purpose === source.purpose &&
    observation.observedExternalSubject === source.observedExternalSubject &&
    observation.observedAt === source.observedAt &&
    sameValue(
      observation.adapterContract,
      source.identityDeclaration.adapterContract
    ) &&
    sameValue(identity.identityDeclaration, source.identityDeclaration) &&
    String(identity.realm.realmId) === String(source.realm.realmId) &&
    identity.realm.version === source.realm.realmVersion &&
    identity.realm.canonicalizationVersion ===
      source.realm.canonicalizationVersion &&
    String(identity.objectKindId) === String(source.objectKindId) &&
    sameValue(identity.scope, source.scope) &&
    identity.canonicalExternalSubject === source.canonicalExternalSubject &&
    identity.stability.kind === source.stability
  );
}

function maximumConfidence(
  candidates: readonly z.infer<
    typeof inboxV2SourceIdentityResolutionCandidateSchema
  >[]
): z.infer<typeof inboxV2SourceIdentityResolutionConfidenceSchema> {
  const rank = { none: 0, weak: 1, strong: 2, verified: 3 } as const;
  let result: keyof typeof rank = "none";
  for (const candidate of candidates) {
    if (rank[candidate.confidence] > rank[result])
      result = candidate.confidence;
  }
  return result;
}

function maximumEvidenceConfidence(
  evidence: readonly z.infer<
    typeof inboxV2SourceIdentityResolutionEvidenceSchema
  >[]
): Exclude<
  z.infer<typeof inboxV2SourceIdentityResolutionConfidenceSchema>,
  "none"
> {
  const rank = { weak: 1, strong: 2, verified: 3 } as const;
  let result: keyof typeof rank = "weak";
  for (const item of evidence) {
    if (rank[item.confidence] > rank[result]) result = item.confidence;
  }
  return result;
}

function candidateTargetReference(
  candidate: z.infer<typeof inboxV2SourceIdentityResolutionCandidateSchema>
) {
  return candidate.target.kind === "employee"
    ? candidate.target.employee
    : candidate.target.clientContact;
}

function sourceIdentityMaterializationProjection(
  identity: z.infer<typeof inboxV2SourceExternalIdentitySchema>
) {
  return {
    tenantId: identity.tenantId,
    id: identity.id,
    realm: identity.realm,
    objectKindId: identity.objectKindId,
    scope: identity.scope,
    identityDeclaration: identity.identityDeclaration,
    materializationAuthority: identity.materializationAuthority,
    materializedAt: identity.materializedAt,
    canonicalExternalSubject: identity.canonicalExternalSubject,
    stability: identity.stability,
    createdAt: identity.createdAt
  };
}

function sourceIdentityStableKeyFingerprint(
  identity: z.infer<typeof inboxV2SourceIdentityMaterializationSnapshotSchema>
): string {
  return sameValueFingerprint({
    tenantId: identity.tenantId,
    realm: identity.realm,
    objectKindId: identity.objectKindId,
    scope: identity.scope,
    canonicalExternalSubject: identity.canonicalExternalSubject,
    stability: identity.stability
  });
}

function candidateTargetKey(
  candidate: z.infer<typeof inboxV2SourceIdentityResolutionCandidateSchema>
): string {
  const target = candidateTargetReference(candidate);
  return `${candidate.target.kind}\u0000${target.tenantId}\u0000${String(target.id)}`;
}

function deferredParticipantIntentKeyFingerprint(
  key: z.infer<typeof inboxV2DeferredParticipantIntentKeySchema>
): string {
  return sameValueFingerprint(key);
}

function isNextAssessmentRevision(record: {
  previousAssessmentRevision: string | null;
  assessmentRevision: string;
}): boolean {
  const current = BigInt(record.assessmentRevision);
  if (record.previousAssessmentRevision === null) return current === 1n;
  return current === BigInt(record.previousAssessmentRevision) + 1n;
}

function addObservationSourceScopeIssues(
  context: z.RefinementCtx,
  observation: z.infer<typeof inboxV2SourceNormalizedIdentityObservationSchema>,
  sourceConnection: z.infer<typeof inboxV2SourceConnectionReferenceSchema>,
  sourceAccount: z.infer<typeof inboxV2SourceAccountReferenceSchema> | null,
  path: readonly PropertyKey[]
): void {
  if (
    observation.scope.kind === "source_connection" &&
    !sameValue(observation.scope.owner, sourceConnection)
  ) {
    addIssue(
      context,
      path,
      "Connection-scoped identity observation must use the inducing connection."
    );
  }
  if (
    observation.scope.kind === "source_account" &&
    (sourceAccount === null ||
      !sameValue(observation.scope.owner, sourceAccount))
  ) {
    addIssue(
      context,
      path,
      "Account-scoped identity observation requires the exact inducing account."
    );
  }
}

function addIdentitySourceScopeIssues(
  context: z.RefinementCtx,
  identity: Pick<z.infer<typeof inboxV2SourceExternalIdentitySchema>, "scope">,
  sourceConnection: z.infer<typeof inboxV2SourceConnectionReferenceSchema>,
  sourceAccount: z.infer<typeof inboxV2SourceAccountReferenceSchema> | null,
  path: readonly PropertyKey[]
): void {
  if (
    identity.scope.kind === "source_connection" &&
    !sameValue(identity.scope.owner, sourceConnection)
  ) {
    addIssue(
      context,
      path,
      "Connection-scoped source identity must use the observation connection."
    );
  }
  if (
    identity.scope.kind === "source_account" &&
    (sourceAccount === null || !sameValue(identity.scope.owner, sourceAccount))
  ) {
    addIssue(
      context,
      path,
      "Account-scoped source identity requires the exact observation account."
    );
  }
}

function addThreadSourceScopeIssues(
  context: z.RefinementCtx,
  thread: z.infer<typeof inboxV2DeferredParticipantExternalThreadContextSchema>
): void {
  if (
    thread.key.scope.kind === "source_connection" &&
    !sameValue(thread.key.scope.owner, thread.sourceConnection)
  ) {
    addIssue(
      context,
      ["key", "scope", "owner"],
      "Connection-scoped external thread must use the exact inducing connection."
    );
  }
  if (
    thread.key.scope.kind === "source_account" &&
    (thread.sourceAccount === null ||
      !sameValue(thread.key.scope.owner, thread.sourceAccount))
  ) {
    addIssue(
      context,
      ["key", "scope", "owner"],
      "Account-scoped external thread requires the exact inducing account."
    );
  }
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: TenantReference,
  path: readonly PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(context, path, "Reference tenant must match the owning tenant.");
  }
}

function addCanonicalIntegerArrayIssues(
  context: z.RefinementCtx,
  values: readonly number[],
  path: readonly PropertyKey[],
  message: string
): void {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => index > 0 && values[index - 1]! >= value)
  ) {
    addIssue(context, path, message);
  }
}

function addContiguousOrdinalIssues(
  context: z.RefinementCtx,
  values: readonly number[],
  path: readonly PropertyKey[],
  message: string
): void {
  if (values.some((value, index) => value !== index)) {
    addIssue(context, path, message);
  }
}

function addContiguousUniqueStringIssues(
  context: z.RefinementCtx,
  values: readonly string[],
  path: readonly PropertyKey[],
  message: string
): void {
  if (new Set(values).size !== values.length) addIssue(context, path, message);
}

function sameNullableReference(
  left: TenantReference | null,
  right: TenantReference | null
): boolean {
  return (left === null) === (right === null) && sameValue(left, right);
}

function sameNumberArray(left: readonly number[], right: readonly number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameValueFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function addIssue(
  context: z.RefinementCtx,
  path: readonly PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path: [...path], message });
}
