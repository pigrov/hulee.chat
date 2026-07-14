import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2DataGovernanceContextReferenceSchema,
  inboxV2ResponsibilityRoleSchema,
  isInboxV2DataGovernanceContext,
  matchesInboxV2DataGovernanceContextReference,
  type InboxV2DataGovernanceContext
} from "./data-governance";
import {
  isInboxV2DataLifecycleRegistry,
  type InboxV2DataLifecycleRegistry
} from "./data-lifecycle-catalog";
import {
  inboxV2DataClassIdSchema,
  inboxV2ExternalRouteIdSchema,
  inboxV2LifecycleHandlerIdSchema,
  inboxV2ProcessingPurposeIdSchema,
  inboxV2RetentionRuleIdSchema,
  inboxV2VersionedProfileReferenceSchema,
  INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION
} from "./data-lifecycle-primitives";
import {
  inboxV2ClassifiedEvidenceReferenceSchema,
  inboxV2DataRootReferenceSchema,
  inboxV2DataSubjectReferenceSchema,
  inboxV2SubjectDiscoveryManifestReferenceSchema,
  dataRootReferenceKey,
  dataSubjectReferenceKey,
  getInboxV2SubjectDiscoveryCompletenessProof,
  isInboxV2SubjectDiscoveryManifest,
  matchesInboxV2SubjectDiscoveryManifestReference,
  type InboxV2SubjectDiscoveryManifest
} from "./data-subject-discovery";
import {
  inboxV2TenantTerminationExportRoots,
  inboxV2TenantTerminationScopeManifestReferenceSchema,
  isInboxV2TenantTerminationScopeManifest,
  matchesInboxV2TenantTerminationScopeReference,
  type InboxV2TenantTerminationScopeManifest
} from "./tenant-termination-scope";
import {
  getInboxV2CurrentPolicyActivationReference,
  inboxV2DataLifecyclePolicyReferenceSchema,
  inboxV2PolicyActivationReferenceSchema,
  isInboxV2CurrentActivatedEffectiveTenantPolicy,
  type InboxV2EffectiveTenantPolicy,
  type InboxV2PolicyActivationLedger
} from "./data-lifecycle-policy";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2EmployeeReferenceSchema, inboxV2TenantIdSchema } from "./ids";
import type {
  InboxV2DeletionPlan,
  InboxV2DeletionRun
} from "./privacy-deletion";
import {
  assertInboxV2PrivacyTerminalExportCurrent,
  getInboxV2PrivacyTerminalExportAuthenticity,
  hasInboxV2DeletionPlanAuthenticity,
  hasInboxV2DeletionRunAuthenticity,
  hasInboxV2PrivacyRequestAuthenticity,
  registerInboxV2PrivacyRequestAuthenticity,
  type InboxV2PrivacyTerminalExportAuthenticityDescriptor
} from "./privacy-authenticity";
import { inboxV2PrivacyHoldDecisionReferenceSchema } from "./privacy-hold-restriction";
import {
  createInboxV2SchemaEnvelopeSchema,
  type InboxV2SchemaEnvelope
} from "./schema-version";
import {
  inboxV2EntityKeySchema,
  inboxV2Sha256DigestSchema
} from "./sync-primitives";

export const INBOX_V2_PRIVACY_REQUEST_SCHEMA_ID =
  "core:inbox-v2.privacy-request" as const;

export type InboxV2PrivacyRequestId = Brand<string, "InboxV2PrivacyRequestId">;
export type InboxV2PrivacyVerificationId = Brand<
  string,
  "InboxV2PrivacyVerificationId"
>;
export type InboxV2PrivacyDecisionId = Brand<
  string,
  "InboxV2PrivacyDecisionId"
>;

const opaqueIdPartPattern = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/u;

function createPrefixedIdSchema<TBrand extends string>(prefix: string) {
  return z
    .string()
    .max(prefix.length + 201)
    .refine(
      (value) =>
        value.startsWith(`${prefix}:`) &&
        opaqueIdPartPattern.test(value.slice(prefix.length + 1)),
      { message: `Identifier must use the ${prefix}: prefix.` }
    )
    .transform((value) => value as Brand<string, TBrand>);
}

export const inboxV2PrivacyRequestIdSchema =
  createPrefixedIdSchema<"InboxV2PrivacyRequestId">("privacy_request");
export const inboxV2PrivacyVerificationIdSchema =
  createPrefixedIdSchema<"InboxV2PrivacyVerificationId">(
    "privacy_verification"
  );
export const inboxV2PrivacyDecisionIdSchema =
  createPrefixedIdSchema<"InboxV2PrivacyDecisionId">("privacy_decision");

export const inboxV2PrivacyRequestReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    requestId: inboxV2PrivacyRequestIdSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2PrivacyRequestIntentSchema = z.enum([
  "access",
  "portability",
  "correction",
  "erasure",
  "restriction",
  "objection",
  "tenant_termination_export_delete",
  "administrative_retention_purge"
]);

export const inboxV2PrivacyRequestStateSchema = z.enum([
  "received",
  "identity_verification",
  "scope_discovery",
  "policy_and_exception_review",
  "approved",
  "partially_approved",
  "rejected",
  "blocked_by_legal_hold",
  "executing",
  "verification_pending",
  "completed",
  "completed_with_external_residuals",
  "primary_purged_backup_expiry_pending",
  "verification_blocked_internal_residual",
  "failed_retryable"
]);

export const inboxV2PrivacyDecisionResultSchema = z.enum([
  "approved",
  "partially_approved",
  "rejected",
  "blocked_by_legal_hold"
]);

export const inboxV2PrivacyCompletionResultSchema = z.enum([
  "completed",
  "completed_with_external_residuals",
  "primary_purged_backup_expiry_pending",
  "verification_blocked_internal_residual",
  "failed_retryable"
]);

export const inboxV2PrivacyVerificationMethodSchema = z.enum([
  "authenticated_account",
  "organization_assertion",
  "provider_challenge",
  "manual_document_review",
  "approved_profile_method"
]);

const verificationBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  id: inboxV2PrivacyVerificationIdSchema,
  revision: inboxV2EntityRevisionSchema,
  methods: z
    .array(inboxV2PrivacyVerificationMethodSchema)
    .max(8)
    .superRefine((values, context) =>
      addCanonicalUniqueIssue(context, values, "Verification methods")
    ),
  evidence: z
    .array(inboxV2ClassifiedEvidenceReferenceSchema)
    .max(64)
    .superRefine((values, context) =>
      addCanonicalUniqueIssue(
        context,
        values.map(classifiedEvidenceKey),
        "Verification evidence"
      )
    ),
  verificationProfile: inboxV2VersionedProfileReferenceSchema,
  startedAt: inboxV2TimestampSchema
} as const;

const pendingPrivacyIdentityVerificationSchema = z
  .object({
    ...verificationBaseShape,
    status: z.literal("pending")
  })
  .strict();

const verifiedPrivacyIdentityVerificationSchema = z
  .object({
    ...verificationBaseShape,
    status: z.literal("verified"),
    methods: verificationBaseShape.methods.min(1),
    evidence: verificationBaseShape.evidence.min(1),
    verifiedSubjects: z
      .array(inboxV2DataSubjectReferenceSchema)
      .min(1)
      .max(256)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map(dataSubjectReferenceKey),
          "Verified subjects"
        )
      ),
    completedAt: inboxV2TimestampSchema
  })
  .strict();

const rejectedPrivacyIdentityVerificationSchema = z
  .object({
    ...verificationBaseShape,
    status: z.literal("rejected"),
    methods: verificationBaseShape.methods.min(1),
    evidence: verificationBaseShape.evidence.min(1),
    reasonCode: inboxV2CatalogIdSchema,
    completedAt: inboxV2TimestampSchema
  })
  .strict();

/**
 * Minimized verification checkpoint. Evidence is an authorized classified
 * reference; contact values, document images and provider payloads never enter
 * the request DTO.
 */
export const inboxV2PrivacyIdentityVerificationSchema = z
  .discriminatedUnion("status", [
    pendingPrivacyIdentityVerificationSchema,
    verifiedPrivacyIdentityVerificationSchema,
    rejectedPrivacyIdentityVerificationSchema
  ])
  .superRefine((verification, context) => {
    for (const [index, evidence] of verification.evidence.entries()) {
      addTenantIssue(context, verification.tenantId, evidence.tenantId, [
        "evidence",
        index,
        "tenantId"
      ]);
    }
    if (
      verification.status !== "pending" &&
      !isInboxV2TimestampOrderValid(
        verification.startedAt,
        verification.completedAt
      )
    ) {
      addIssue(
        context,
        ["completedAt"],
        "Verification completion cannot precede its start."
      );
    }
    if (verification.status === "verified") {
      for (const [index, subject] of verification.verifiedSubjects.entries()) {
        addTenantIssue(
          context,
          verification.tenantId,
          dataSubjectTenantId(subject),
          ["verifiedSubjects", index]
        );
      }
    }
  });

export const inboxV2PrivacyRootDispositionSchema = z.enum([
  "include_normalized",
  "include_portable",
  "correct",
  "erase",
  "restrict_processing",
  "stop_objected_processing",
  "retain_with_exception",
  "omit_with_reason",
  "external_action_required"
]);

/**
 * Dispositions executed against an Inbox-owned storage root. External actions
 * are proven separately by an exact root + route residual checkpoint.
 */
export const inboxV2PrivacyInternalExecutionDispositionSchema = z.enum([
  "include_normalized",
  "include_portable",
  "correct",
  "erase",
  "restrict_processing",
  "stop_objected_processing"
]);

export const inboxV2PrivacyThirdPartyHandlingSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("not_applicable") }).strict(),
    z
      .object({
        kind: z.literal("redacted"),
        policyProfile: inboxV2VersionedProfileReferenceSchema,
        reasonCode: inboxV2CatalogIdSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("omitted"),
        policyProfile: inboxV2VersionedProfileReferenceSchema,
        reasonCode: inboxV2CatalogIdSchema
      })
      .strict()
  ]
);

export const inboxV2PrivacyExceptionKindSchema = z.enum([
  "legal_obligation",
  "legal_claim_or_regulatory_duty",
  "third_party_rights",
  "confidentiality_or_security",
  "identity_not_verified",
  "scope_ambiguous",
  "external_surface_limitation",
  "approved_profile_exception"
]);

export const inboxV2PrivacyDecisionExceptionSchema = z
  .object({
    kind: inboxV2PrivacyExceptionKindSchema,
    reasonCode: inboxV2CatalogIdSchema,
    policyProfile: inboxV2VersionedProfileReferenceSchema,
    evidence: z
      .array(inboxV2ClassifiedEvidenceReferenceSchema)
      .max(32)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map(classifiedEvidenceKey),
          "Decision-exception evidence"
        )
      )
  })
  .strict();

const inboxV2RetentionRuleReferenceSchema = z
  .object({
    id: inboxV2RetentionRuleIdSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2PrivacyRootDecisionSchema = z
  .object({
    root: inboxV2DataRootReferenceSchema,
    dataClassId: inboxV2DataClassIdSchema,
    purposeIds: z
      .array(inboxV2ProcessingPurposeIdSchema)
      .min(1)
      .max(64)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(context, values, "Decision purposes")
      ),
    policyRules: z
      .array(inboxV2RetentionRuleReferenceSchema)
      .min(1)
      .max(64)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map((value) => `${value.id}\u0000${value.revision}`),
          "Decision policy rules"
        )
      ),
    disposition: inboxV2PrivacyRootDispositionSchema,
    followUpDisposition:
      inboxV2PrivacyInternalExecutionDispositionSchema.nullable(),
    externalRouteIds: z
      .array(inboxV2ExternalRouteIdSchema)
      .max(64)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(context, values, "Decision external routes")
      ),
    thirdPartyHandling: inboxV2PrivacyThirdPartyHandlingSchema,
    exceptions: z
      .array(inboxV2PrivacyDecisionExceptionSchema)
      .max(32)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map(privacyExceptionKey),
          "Decision exceptions"
        )
      )
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.root.dataClassId !== decision.dataClassId) {
      addIssue(
        context,
        ["dataClassId"],
        "Root decision data class must match the classified root."
      );
    }
    const requiresException =
      decision.disposition === "retain_with_exception" ||
      decision.disposition === "omit_with_reason";
    if (requiresException !== decision.exceptions.length > 0) {
      addIssue(
        context,
        ["exceptions"],
        "Retained/omitted roots require exceptions and approved roots cannot carry them."
      );
    }
    if (
      (decision.disposition === "omit_with_reason") !==
      (decision.thirdPartyHandling.kind === "omitted")
    ) {
      addIssue(
        context,
        ["thirdPartyHandling"],
        "An omitted root must record third-party omission and omission is invalid for another disposition."
      );
    }
    if (
      (decision.disposition === "external_action_required") !==
      decision.externalRouteIds.length > 0
    ) {
      addIssue(
        context,
        ["externalRouteIds"],
        "External actions require one or more declared routes and other dispositions cannot declare them."
      );
    }
    if (
      decision.followUpDisposition !== null &&
      (decision.followUpDisposition !== "erase" ||
        decision.disposition === "external_action_required" ||
        decision.disposition === "retain_with_exception" ||
        decision.disposition === "omit_with_reason")
    ) {
      addIssue(
        context,
        ["followUpDisposition"],
        "Only an approved internal export may declare erase as its ordered follow-up."
      );
    }
    for (const [exceptionIndex, exception] of decision.exceptions.entries()) {
      for (const [evidenceIndex, evidence] of exception.evidence.entries()) {
        addTenantIssue(context, decision.root.tenantId, evidence.tenantId, [
          "exceptions",
          exceptionIndex,
          "evidence",
          evidenceIndex,
          "tenantId"
        ]);
      }
    }
  });

export const inboxV2PrivacyRequestDecisionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2PrivacyDecisionIdSchema,
    revision: inboxV2EntityRevisionSchema,
    result: inboxV2PrivacyDecisionResultSchema,
    policyProfile: inboxV2VersionedProfileReferenceSchema,
    reviewer: inboxV2EmployeeReferenceSchema,
    rootDecisions: z
      .array(inboxV2PrivacyRootDecisionSchema)
      .min(1)
      .max(100_000)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map((value) => dataRootReferenceKey(value.root)),
          "Root decisions"
        )
      ),
    holdReferences: z
      .array(inboxV2PrivacyHoldDecisionReferenceSchema)
      .max(1_000)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map(
            (value) =>
              `${value.hold.tenantId}\u0000${value.hold.holdId}\u0000${value.hold.revision}`
          ),
          "Decision hold references"
        )
      ),
    reasonCode: inboxV2CatalogIdSchema,
    decidedAt: inboxV2TimestampSchema,
    digest: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((decision, context) => {
    addTenantIssue(context, decision.tenantId, decision.reviewer.tenantId, [
      "reviewer",
      "tenantId"
    ]);
    for (const [index, rootDecision] of decision.rootDecisions.entries()) {
      addTenantIssue(context, decision.tenantId, rootDecision.root.tenantId, [
        "rootDecisions",
        index,
        "root",
        "tenantId"
      ]);
    }
    for (const [index, hold] of decision.holdReferences.entries()) {
      addTenantIssue(context, decision.tenantId, hold.hold.tenantId, [
        "holdReferences",
        index,
        "hold",
        "tenantId"
      ]);
    }
    validateDecisionResult(context, decision);
  });

export const inboxV2PrivacyExecutionReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    execution: inboxV2EntityKeySchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((reference, context) =>
    addTenantIssue(context, reference.tenantId, reference.execution.tenantId, [
      "execution",
      "tenantId"
    ])
  );

const privacyDeletionOpaqueReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export const inboxV2PrivacyTerminalExportReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    productKind: z.literal("tenant_deployment"),
    job: z
      .object({
        id: privacyDeletionOpaqueReferenceSchema,
        revision: inboxV2EntityRevisionSchema
      })
      .strict(),
    manifest: z
      .object({
        id: privacyDeletionOpaqueReferenceSchema,
        revision: inboxV2EntityRevisionSchema,
        manifestHash: inboxV2Sha256DigestSchema
      })
      .strict(),
    artifact: z
      .object({
        id: privacyDeletionOpaqueReferenceSchema,
        revision: inboxV2EntityRevisionSchema,
        checksum: inboxV2Sha256DigestSchema,
        readyAt: inboxV2TimestampSchema,
        expiresAt: inboxV2TimestampSchema
      })
      .strict(),
    governanceContext: inboxV2DataGovernanceContextReferenceSchema,
    policy: inboxV2DataLifecyclePolicyReferenceSchema,
    rootSetHash: inboxV2Sha256DigestSchema,
    tenantScopeProofHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((reference, context) => {
    for (const [field, referencedTenantId] of [
      ["governanceContext", reference.governanceContext.tenantId],
      ["policy", reference.policy.tenantId]
    ] as const) {
      addTenantIssue(context, reference.tenantId, referencedTenantId, [field]);
    }
    if (
      !isInboxV2TimestampOrderValid(
        reference.artifact.readyAt,
        reference.artifact.expiresAt
      )
    ) {
      addIssue(
        context,
        ["artifact", "expiresAt"],
        "Terminal export artifact expiry cannot precede readiness."
      );
    }
  });

export const inboxV2PrivacyDeletionProofReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    root: inboxV2DataRootReferenceSchema,
    cause: z.enum([
      "privacy_erasure",
      "tenant_offboarding",
      "administrative_policy_purge"
    ]),
    plan: z
      .object({
        tenantId: inboxV2TenantIdSchema,
        planId: privacyDeletionOpaqueReferenceSchema,
        revision: inboxV2EntityRevisionSchema,
        planHash: inboxV2Sha256DigestSchema
      })
      .strict(),
    run: z
      .object({
        tenantId: inboxV2TenantIdSchema,
        runId: privacyDeletionOpaqueReferenceSchema,
        revision: inboxV2EntityRevisionSchema
      })
      .strict()
  })
  .strict()
  .superRefine((proof, context) => {
    if (
      proof.root.tenantId !== proof.tenantId ||
      proof.plan.tenantId !== proof.tenantId ||
      proof.run.tenantId !== proof.tenantId
    ) {
      addIssue(
        context,
        [],
        "Deletion proof root, plan and run must bind one tenant."
      );
    }
  });

export const inboxV2PrivacyHandlerExecutionStatusSchema = z.enum([
  "pending",
  "succeeded_verified",
  "failed_retryable",
  "failed_terminal",
  "unverified"
]);

export const inboxV2PrivacyHandlerExecutionReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    root: inboxV2DataRootReferenceSchema,
    disposition: inboxV2PrivacyInternalExecutionDispositionSchema,
    handlerId: inboxV2LifecycleHandlerIdSchema,
    execution: inboxV2EntityKeySchema,
    status: inboxV2PrivacyHandlerExecutionStatusSchema,
    evidence: inboxV2ClassifiedEvidenceReferenceSchema.nullable(),
    deletionProof: inboxV2PrivacyDeletionProofReferenceSchema.nullable()
  })
  .strict()
  .superRefine((reference, context) => {
    addTenantIssue(context, reference.tenantId, reference.root.tenantId, [
      "root",
      "tenantId"
    ]);
    addTenantIssue(context, reference.tenantId, reference.execution.tenantId, [
      "execution",
      "tenantId"
    ]);
    if (reference.evidence !== null) {
      addTenantIssue(context, reference.tenantId, reference.evidence.tenantId, [
        "evidence",
        "tenantId"
      ]);
    }
    if (reference.deletionProof !== null) {
      addTenantIssue(
        context,
        reference.tenantId,
        reference.deletionProof.tenantId,
        ["deletionProof", "tenantId"]
      );
      if (
        dataRootReferenceKey(reference.deletionProof.root) !==
        dataRootReferenceKey(reference.root)
      ) {
        addIssue(
          context,
          ["deletionProof", "root"],
          "Deletion proof must bind the exact executed root."
        );
      }
    }
    if (
      (reference.disposition === "erase") !==
      (reference.deletionProof !== null)
    ) {
      addIssue(
        context,
        ["deletionProof"],
        "Erase execution requires an exact deletion-run proof and non-destructive execution forbids one."
      );
    }
    if (
      reference.status === "succeeded_verified" &&
      reference.evidence === null
    ) {
      addIssue(
        context,
        ["evidence"],
        "A verified handler execution requires classified evidence."
      );
    }
  });

export const inboxV2PrivacyExternalOutcomeSchema = z.enum([
  "requested",
  "confirmed",
  "unsupported",
  "unknown",
  "failed_retryable"
]);

export const inboxV2PrivacyExternalResidualReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    root: inboxV2DataRootReferenceSchema,
    disposition: z.literal("external_action_required"),
    routeId: inboxV2ExternalRouteIdSchema,
    residual: inboxV2EntityKeySchema,
    outcome: inboxV2PrivacyExternalOutcomeSchema,
    lastVerifiedAt: inboxV2TimestampSchema.nullable(),
    evidence: inboxV2ClassifiedEvidenceReferenceSchema.nullable(),
    deletionProof: inboxV2PrivacyDeletionProofReferenceSchema
  })
  .strict()
  .superRefine((reference, context) => {
    addTenantIssue(context, reference.tenantId, reference.root.tenantId, [
      "root",
      "tenantId"
    ]);
    addTenantIssue(context, reference.tenantId, reference.residual.tenantId, [
      "residual",
      "tenantId"
    ]);
    if (reference.evidence !== null) {
      addTenantIssue(context, reference.tenantId, reference.evidence.tenantId, [
        "evidence",
        "tenantId"
      ]);
    }
    addTenantIssue(
      context,
      reference.tenantId,
      reference.deletionProof.tenantId,
      ["deletionProof", "tenantId"]
    );
    if (
      dataRootReferenceKey(reference.deletionProof.root) !==
      dataRootReferenceKey(reference.root)
    ) {
      addIssue(
        context,
        ["deletionProof", "root"],
        "External deletion proof must bind the exact residual root."
      );
    }
    if (
      (reference.outcome === "confirmed" ||
        reference.outcome === "unsupported") &&
      reference.lastVerifiedAt === null
    ) {
      addIssue(
        context,
        ["lastVerifiedAt"],
        "Final external outcomes require a last verification time."
      );
    }
    if (
      (reference.outcome === "confirmed" ||
        reference.outcome === "unsupported") &&
      reference.evidence === null
    ) {
      addIssue(
        context,
        ["evidence"],
        "A terminal external outcome requires classified evidence."
      );
    }
  });

export const inboxV2PrivacyBackupExecutionReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    root: inboxV2DataRootReferenceSchema,
    disposition: z.literal("erase"),
    execution: inboxV2EntityKeySchema,
    outcome: z.enum([
      "finite_expiry_pending",
      "expiry_verified",
      "failed_retryable",
      "unverified"
    ]),
    checkedAt: inboxV2TimestampSchema,
    latestPossibleExpiryAt: inboxV2TimestampSchema.nullable(),
    evidence: inboxV2ClassifiedEvidenceReferenceSchema.nullable(),
    deletionProof: inboxV2PrivacyDeletionProofReferenceSchema
  })
  .strict()
  .superRefine((reference, context) => {
    addTenantIssue(context, reference.tenantId, reference.root.tenantId, [
      "root",
      "tenantId"
    ]);
    addTenantIssue(context, reference.tenantId, reference.execution.tenantId, [
      "execution",
      "tenantId"
    ]);
    addTenantIssue(
      context,
      reference.tenantId,
      reference.deletionProof.tenantId,
      ["deletionProof", "tenantId"]
    );
    if (reference.evidence !== null) {
      addTenantIssue(context, reference.tenantId, reference.evidence.tenantId, [
        "evidence",
        "tenantId"
      ]);
    }
    if (
      dataRootReferenceKey(reference.deletionProof.root) !==
      dataRootReferenceKey(reference.root)
    ) {
      addIssue(
        context,
        ["deletionProof", "root"],
        "Backup deletion proof must bind the exact residual root."
      );
    }
    const hasExpiry = reference.latestPossibleExpiryAt !== null;
    const requiresEvidence =
      reference.outcome === "finite_expiry_pending" ||
      reference.outcome === "expiry_verified";
    if (requiresEvidence && reference.evidence === null) {
      addIssue(
        context,
        ["evidence"],
        "Verified or finite-pending backup outcome requires classified evidence."
      );
    }
    if (
      (reference.outcome === "finite_expiry_pending" ||
        reference.outcome === "expiry_verified") !== hasExpiry
    ) {
      addIssue(
        context,
        ["latestPossibleExpiryAt"],
        "Backup expiry outcomes require their exact finite expiry boundary."
      );
    }
    if (
      reference.latestPossibleExpiryAt !== null &&
      ((reference.outcome === "finite_expiry_pending" &&
        Date.parse(reference.latestPossibleExpiryAt) <=
          Date.parse(reference.checkedAt)) ||
        (reference.outcome === "expiry_verified" &&
          Date.parse(reference.latestPossibleExpiryAt) >
            Date.parse(reference.checkedAt)))
    ) {
      addIssue(
        context,
        ["outcome"],
        "Backup pending versus verified outcome must match its finite expiry boundary."
      );
    }
  });

export const inboxV2PrivacyExecutionProgressSchema = z
  .object({
    reference: inboxV2PrivacyExecutionReferenceSchema,
    handlerExecutions: z
      .array(inboxV2PrivacyHandlerExecutionReferenceSchema)
      .max(10_000)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map(handlerExecutionKey),
          "Handler execution references"
        )
      ),
    backupExecutions: z
      .array(inboxV2PrivacyBackupExecutionReferenceSchema)
      .max(10_000)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map(backupExecutionKey),
          "Backup execution references"
        )
      ),
    externalResiduals: z
      .array(inboxV2PrivacyExternalResidualReferenceSchema)
      .max(10_000)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map(externalResidualKey),
          "External residual references"
        )
      ),
    terminalExport: inboxV2PrivacyTerminalExportReferenceSchema.nullable()
  })
  .strict()
  .superRefine((execution, context) => {
    for (const [index, handler] of execution.handlerExecutions.entries()) {
      addTenantIssue(context, execution.reference.tenantId, handler.tenantId, [
        "handlerExecutions",
        index,
        "tenantId"
      ]);
    }
    for (const [index, residual] of execution.externalResiduals.entries()) {
      addTenantIssue(context, execution.reference.tenantId, residual.tenantId, [
        "externalResiduals",
        index,
        "tenantId"
      ]);
    }
    for (const [index, backup] of execution.backupExecutions.entries()) {
      addTenantIssue(context, execution.reference.tenantId, backup.tenantId, [
        "backupExecutions",
        index,
        "tenantId"
      ]);
    }
    addUniqueIssue(
      context,
      execution.handlerExecutions.map((handler) =>
        entityKey(handler.execution)
      ),
      ["handlerExecutions"],
      "Handler execution identities cannot be reused across roots."
    );
    addUniqueIssue(
      context,
      execution.backupExecutions.map((backup) => entityKey(backup.execution)),
      ["backupExecutions"],
      "Backup execution identities cannot be reused across roots."
    );
    addUniqueIssue(
      context,
      execution.externalResiduals.map((residual) =>
        entityKey(residual.residual)
      ),
      ["externalResiduals"],
      "External residual identities cannot be reused across roots or routes."
    );
  });

const verifiedCheckpointShape = {
  verification: verifiedPrivacyIdentityVerificationSchema
} as const;
const discoveredCheckpointShape = {
  ...verifiedCheckpointShape,
  discovery: inboxV2SubjectDiscoveryManifestReferenceSchema
} as const;
const decidedCheckpointShape = {
  ...discoveredCheckpointShape,
  decision: inboxV2PrivacyRequestDecisionSchema
} as const;
const executingCheckpointShape = {
  ...decidedCheckpointShape,
  execution: inboxV2PrivacyExecutionProgressSchema
} as const;

const receivedPrivacyWorkflowSchema = z
  .object({ state: z.literal("received") })
  .strict();
const identityVerificationPrivacyWorkflowSchema = z
  .object({
    state: z.literal("identity_verification"),
    verification: inboxV2PrivacyIdentityVerificationSchema
  })
  .strict();
const scopeDiscoveryPrivacyWorkflowSchema = z
  .object({
    state: z.literal("scope_discovery"),
    ...verifiedCheckpointShape
  })
  .strict();
const policyReviewPrivacyWorkflowSchema = z
  .object({
    state: z.literal("policy_and_exception_review"),
    ...discoveredCheckpointShape
  })
  .strict();
const decidedPrivacyWorkflowSchema = z
  .object({
    state: inboxV2PrivacyDecisionResultSchema,
    ...decidedCheckpointShape
  })
  .strict();
const executingPrivacyWorkflowSchema = z
  .object({
    state: z.literal("executing"),
    ...decidedCheckpointShape,
    execution: inboxV2PrivacyExecutionProgressSchema
  })
  .strict();
const verificationPendingPrivacyWorkflowSchema = z
  .object({
    state: z.literal("verification_pending"),
    ...executingCheckpointShape
  })
  .strict();
const completedPrivacyWorkflowSchema = z
  .object({
    state: inboxV2PrivacyCompletionResultSchema,
    ...executingCheckpointShape,
    completedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2PrivacyRequestWorkflowSchema = z
  .discriminatedUnion("state", [
    receivedPrivacyWorkflowSchema,
    identityVerificationPrivacyWorkflowSchema,
    scopeDiscoveryPrivacyWorkflowSchema,
    policyReviewPrivacyWorkflowSchema,
    decidedPrivacyWorkflowSchema,
    executingPrivacyWorkflowSchema,
    verificationPendingPrivacyWorkflowSchema,
    completedPrivacyWorkflowSchema
  ])
  .superRefine((workflow, context) => {
    if (
      "decision" in workflow &&
      workflow.state !== "executing" &&
      workflow.state !== "verification_pending" &&
      !isCompletionState(workflow.state)
    ) {
      if (workflow.decision.result !== workflow.state) {
        addIssue(
          context,
          ["decision", "result"],
          "Decision workflow state must match the pinned decision result."
        );
      }
    }
    if (
      "execution" in workflow &&
      workflow.decision.result !== "approved" &&
      workflow.decision.result !== "partially_approved"
    ) {
      addIssue(
        context,
        ["decision", "result"],
        "Only approved or partially approved requests may execute."
      );
    }
    if ("execution" in workflow) {
      validateExecutionCoverage(
        context,
        workflow.decision,
        workflow.execution,
        workflow.state !== "executing"
      );
    }
    if ("completedAt" in workflow) {
      validateCompletionState(context, workflow);
    }
  });

export const inboxV2PrivacyRequestSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2PrivacyRequestIdSchema,
    revision: inboxV2EntityRevisionSchema,
    intent: inboxV2PrivacyRequestIntentSchema,
    tenantTerminationScope:
      inboxV2TenantTerminationScopeManifestReferenceSchema.nullable(),
    governanceContext: inboxV2DataGovernanceContextReferenceSchema,
    jurisdictionProfile: inboxV2VersionedProfileReferenceSchema,
    responsibilityRole: inboxV2ResponsibilityRoleSchema,
    requesterSubject: inboxV2DataSubjectReferenceSchema,
    claimedSubjectAliases: z
      .array(inboxV2DataSubjectReferenceSchema)
      .min(1)
      .max(256)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map(dataSubjectReferenceKey),
          "Claimed subject aliases"
        )
      ),
    requestEvidence: z
      .array(inboxV2ClassifiedEvidenceReferenceSchema)
      .max(64)
      .superRefine((values, context) =>
        addCanonicalUniqueIssue(
          context,
          values.map(classifiedEvidenceKey),
          "Request evidence"
        )
      ),
    receivedAt: inboxV2TimestampSchema,
    dueAt: inboxV2TimestampSchema,
    extendedDueAt: inboxV2TimestampSchema.nullable(),
    extensionReasonCode: inboxV2CatalogIdSchema.nullable(),
    workflow: inboxV2PrivacyRequestWorkflowSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((request, context) => {
    addTenantIssue(
      context,
      request.tenantId,
      request.governanceContext.tenantId,
      ["governanceContext", "tenantId"]
    );
    addTenantIssue(
      context,
      request.tenantId,
      dataSubjectTenantId(request.requesterSubject),
      ["requesterSubject"]
    );
    const requesterKey = dataSubjectReferenceKey(request.requesterSubject);
    const aliasKeys = request.claimedSubjectAliases.map(
      dataSubjectReferenceKey
    );
    if (!aliasKeys.includes(requesterKey)) {
      addIssue(
        context,
        ["claimedSubjectAliases"],
        "Claimed subject aliases must include the requester subject."
      );
    }
    const requiresTenantScope =
      request.intent === "tenant_termination_export_delete" &&
      "decision" in request.workflow;
    if (
      requiresTenantScope !== (request.tenantTerminationScope !== null) ||
      (request.tenantTerminationScope !== null &&
        request.tenantTerminationScope.tenantId !== request.tenantId)
    ) {
      addIssue(
        context,
        ["tenantTerminationScope"],
        "A decided tenant termination requires one exact tenant-wide scope reference; other workflows forbid it."
      );
    }
    for (const [index, subject] of request.claimedSubjectAliases.entries()) {
      addTenantIssue(context, request.tenantId, dataSubjectTenantId(subject), [
        "claimedSubjectAliases",
        index
      ]);
    }
    for (const [index, evidence] of request.requestEvidence.entries()) {
      addTenantIssue(context, request.tenantId, evidence.tenantId, [
        "requestEvidence",
        index,
        "tenantId"
      ]);
    }
    if (
      !isInboxV2TimestampOrderValid(request.receivedAt, request.dueAt) ||
      !isInboxV2TimestampOrderValid(request.receivedAt, request.updatedAt)
    ) {
      addIssue(
        context,
        ["dueAt"],
        "Request due/update timestamps cannot precede receipt."
      );
    }
    if (
      (request.extendedDueAt === null) !==
      (request.extensionReasonCode === null)
    ) {
      addIssue(
        context,
        ["extendedDueAt"],
        "Deadline extension and its reason must be recorded together."
      );
    } else if (
      request.extendedDueAt !== null &&
      (!isInboxV2TimestampOrderValid(request.dueAt, request.extendedDueAt) ||
        Date.parse(request.dueAt) === Date.parse(request.extendedDueAt))
    ) {
      addIssue(
        context,
        ["extendedDueAt"],
        "Extended deadline must be later than the original deadline."
      );
    }
    validateWorkflowTenantAndSubject(context, request);
    if ("decision" in request.workflow) {
      validateIntentDispositions(
        context,
        request.intent,
        request.workflow.decision
      );
    }
  });

export const inboxV2PrivacyRequestEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PRIVACY_REQUEST_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2PrivacyRequestSchema
  );

export type InboxV2PrivacyRequestReference = z.infer<
  typeof inboxV2PrivacyRequestReferenceSchema
>;
export type InboxV2PrivacyRequestIntent = z.infer<
  typeof inboxV2PrivacyRequestIntentSchema
>;
export type InboxV2PrivacyRequestState = z.infer<
  typeof inboxV2PrivacyRequestStateSchema
>;
export type InboxV2PrivacyIdentityVerification = z.infer<
  typeof inboxV2PrivacyIdentityVerificationSchema
>;
export type InboxV2PrivacyRootDecision = z.infer<
  typeof inboxV2PrivacyRootDecisionSchema
>;
export type InboxV2PrivacyRequestDecision = z.infer<
  typeof inboxV2PrivacyRequestDecisionSchema
>;
export type InboxV2PrivacyDeletionProofReference = z.infer<
  typeof inboxV2PrivacyDeletionProofReferenceSchema
>;
export type InboxV2PrivacyBackupExecutionReference = z.infer<
  typeof inboxV2PrivacyBackupExecutionReferenceSchema
>;
export type InboxV2PrivacyTerminalExportReference = z.infer<
  typeof inboxV2PrivacyTerminalExportReferenceSchema
>;
export type InboxV2PrivacyExecutionProgress = z.infer<
  typeof inboxV2PrivacyExecutionProgressSchema
>;
export type InboxV2PrivacyRequestWorkflow = z.infer<
  typeof inboxV2PrivacyRequestWorkflowSchema
>;
export type InboxV2PrivacyRequest = z.infer<typeof inboxV2PrivacyRequestSchema>;
export type InboxV2PrivacyRequestEnvelope = InboxV2SchemaEnvelope<
  typeof INBOX_V2_PRIVACY_REQUEST_SCHEMA_ID,
  typeof INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
  InboxV2PrivacyRequest
>;

export const inboxV2PrivacyRequestAuthorityResultSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    reviewer: inboxV2EmployeeReferenceSchema,
    verifiedSubjects: z
      .array(inboxV2DataSubjectReferenceSchema)
      .min(1)
      .max(256),
    authorizedAliases: z
      .array(inboxV2DataSubjectReferenceSchema)
      .min(1)
      .max(256),
    checkedAt: inboxV2TimestampSchema
  })
  .strict();

export type InboxV2PrivacyRequestAuthoritySource = Readonly<{
  id: string;
  version: string;
  loadCurrentAuthority: (
    input: Readonly<{
      tenantId: string;
      request: InboxV2PrivacyRequestReference;
      verification: Readonly<{ id: string; revision: string }>;
      decision: Readonly<{ id: string; revision: string; digest: string }>;
      discovery: z.infer<typeof inboxV2SubjectDiscoveryManifestReferenceSchema>;
      discoveryProofHash: string;
      governanceContext: z.infer<
        typeof inboxV2DataGovernanceContextReferenceSchema
      >;
      policy: z.infer<typeof inboxV2DataLifecyclePolicyReferenceSchema>;
      policyActivation: z.infer<typeof inboxV2PolicyActivationReferenceSchema>;
      registryCompositionHash: string;
      checkedAt: string;
    }>
  ) => z.input<typeof inboxV2PrivacyRequestAuthorityResultSchema>;
}>;

const definedInboxV2PrivacyRequestAuthoritySources = new WeakSet<object>();
const inboxV2PrivacyRequestAuthorityBindings = new WeakMap<
  object,
  Readonly<{
    source: InboxV2PrivacyRequestAuthoritySource;
    discoveryProofHash: string;
    registryCompositionHash: string;
  }>
>();

/** Registers the server-owned current identity/RBAC authority boundary. */
export function defineInboxV2PrivacyRequestAuthoritySource(input: {
  id: string;
  version: string;
  loadCurrentAuthority: InboxV2PrivacyRequestAuthoritySource["loadCurrentAuthority"];
}): InboxV2PrivacyRequestAuthoritySource {
  const reference = inboxV2VersionedProfileReferenceSchema.parse({
    id: input.id,
    version: input.version
  });
  const source = Object.freeze({
    ...reference,
    loadCurrentAuthority: input.loadCurrentAuthority
  });
  definedInboxV2PrivacyRequestAuthoritySources.add(source);
  return source;
}

/**
 * Registry- and discovery-bound constructor for a request that may advance past
 * scope discovery. The standalone wire schema remains useful at API boundaries,
 * but it is not sufficient authority to execute caller-selected roots or
 * handlers.
 */
export function defineInboxV2PrivacyRequest(input: {
  request: z.input<typeof inboxV2PrivacyRequestSchema>;
  discoveryManifest: InboxV2SubjectDiscoveryManifest;
  registry: InboxV2DataLifecycleRegistry;
  governanceContext: InboxV2DataGovernanceContext;
  policy: InboxV2EffectiveTenantPolicy;
  policyActivationLedger: InboxV2PolicyActivationLedger;
  authoritySource: InboxV2PrivacyRequestAuthoritySource;
  tenantTerminationScope?: InboxV2TenantTerminationScopeManifest;
  deletionExecutions?: readonly Readonly<{
    plan: InboxV2DeletionPlan;
    run: InboxV2DeletionRun;
  }>[];
  terminalExportProofs?: readonly object[];
}): InboxV2PrivacyRequest {
  if (!isInboxV2DataLifecycleRegistry(input.registry)) {
    throw new Error(
      "Privacy request requires an authentic composed lifecycle registry."
    );
  }
  if (!isInboxV2SubjectDiscoveryManifest(input.discoveryManifest)) {
    throw new Error(
      "Privacy request requires an authentic immutable discovery manifest."
    );
  }
  if (
    !isInboxV2DataGovernanceContext(input.governanceContext) ||
    !isInboxV2CurrentActivatedEffectiveTenantPolicy({
      ledger: input.policyActivationLedger,
      policy: input.policy
    }) ||
    !definedInboxV2PrivacyRequestAuthoritySources.has(input.authoritySource)
  ) {
    throw new Error(
      "Privacy request requires authentic current governance, policy activation and server authority."
    );
  }
  const request = inboxV2PrivacyRequestSchema.parse(input.request);
  const discovery = input.discoveryManifest;
  const tenantTerminationScope = input.tenantTerminationScope;
  const requiresTenantTerminationScope =
    request.intent === "tenant_termination_export_delete";
  if (
    requiresTenantTerminationScope !== (tenantTerminationScope !== undefined) ||
    (tenantTerminationScope !== undefined &&
      (!isInboxV2TenantTerminationScopeManifest(tenantTerminationScope) ||
        tenantTerminationScope.tenantId !== request.tenantId ||
        tenantTerminationScope.registryCompositionHash !==
          input.registry.compositionHash ||
        request.tenantTerminationScope === null ||
        !matchesInboxV2TenantTerminationScopeReference({
          manifest: tenantTerminationScope,
          reference: request.tenantTerminationScope
        })))
  ) {
    throw new Error(
      "Tenant termination requires the exact authentic tenant-wide scope manifest."
    );
  }
  if (!("discovery" in request.workflow) || !("decision" in request.workflow)) {
    throw new Error(
      "Executable privacy request requires pinned discovery and decision checkpoints."
    );
  }
  const discoveryProof = getInboxV2SubjectDiscoveryCompletenessProof(discovery);
  const policyActivation = getInboxV2CurrentPolicyActivationReference({
    ledger: input.policyActivationLedger,
    policy: input.policy
  });
  if (
    discoveryProof === null ||
    discoveryProof.registryCompositionHash !== input.registry.compositionHash ||
    policyActivation === null ||
    input.policy.tenantId !== request.tenantId ||
    input.policy.registryCompositionHash !== input.registry.compositionHash ||
    !matchesInboxV2DataGovernanceContextReference({
      context: input.governanceContext,
      reference: request.governanceContext
    }) ||
    !matchesInboxV2DataGovernanceContextReference({
      context: input.governanceContext,
      reference: input.policy.governanceContextRef
    })
  ) {
    throw new Error(
      "Privacy request is not bound to the exact current governance, registry, policy and discovery proof."
    );
  }
  if (
    !matchesInboxV2SubjectDiscoveryManifestReference({
      manifest: discovery,
      reference: request.workflow.discovery
    })
  ) {
    throw new Error(
      "Privacy request does not reference the exact loaded discovery manifest."
    );
  }
  if (
    dataSubjectReferenceKey(discovery.requesterSubject) !==
    dataSubjectReferenceKey(request.requesterSubject)
  ) {
    throw new Error(
      "Privacy request requester does not match its discovery manifest."
    );
  }

  const policyReference = {
    tenantId: input.policy.tenantId,
    id: input.policy.id,
    version: input.policy.version,
    policyHash: input.policy.policyHash
  };
  const decision = request.workflow.decision;
  const verification = request.workflow.verification;
  const authority = inboxV2PrivacyRequestAuthorityResultSchema.parse(
    input.authoritySource.loadCurrentAuthority({
      tenantId: request.tenantId,
      request: {
        tenantId: request.tenantId,
        requestId: request.id,
        revision: request.revision
      },
      verification: {
        id: verification.id,
        revision: verification.revision
      },
      decision: {
        id: decision.id,
        revision: decision.revision,
        digest: decision.digest
      },
      discovery: request.workflow.discovery,
      discoveryProofHash: discoveryProof.proofHash,
      governanceContext: request.governanceContext,
      policy: policyReference,
      policyActivation,
      registryCompositionHash: String(input.registry.compositionHash),
      checkedAt: request.updatedAt
    })
  );
  const discoveredSubjectKeys = new Set(
    discovery.discoveredSubjects.map(dataSubjectReferenceKey)
  );
  const verifiedSubjectKeys = verification.verifiedSubjects.map(
    dataSubjectReferenceKey
  );
  const aliasKeys = request.claimedSubjectAliases.map(dataSubjectReferenceKey);
  if (
    authority.tenantId !== request.tenantId ||
    authority.reviewer.tenantId !== decision.reviewer.tenantId ||
    authority.reviewer.id !== decision.reviewer.id ||
    !sameCanonicalStrings(
      authority.verifiedSubjects.map(dataSubjectReferenceKey),
      verifiedSubjectKeys
    ) ||
    !sameCanonicalStrings(
      authority.authorizedAliases.map(dataSubjectReferenceKey),
      aliasKeys
    ) ||
    !sameCanonicalStrings(aliasKeys, verifiedSubjectKeys) ||
    aliasKeys.some((key) => !discoveredSubjectKeys.has(key))
  ) {
    throw new Error(
      "Privacy request aliases, verified subjects and reviewer require exact current server authority."
    );
  }
  const authorityTime = Date.parse(authority.checkedAt);
  if (
    authorityTime < Date.parse(decision.decidedAt) ||
    authorityTime < Date.parse(input.governanceContext.effectiveAt) ||
    authorityTime >= Date.parse(input.governanceContext.reviewAt) ||
    authorityTime < Date.parse(input.policy.effectiveAt) ||
    authority.checkedAt !== request.updatedAt
  ) {
    throw new Error(
      "Privacy request authority is stale relative to governance, policy or decision."
    );
  }
  if (
    String(decision.policyProfile.id) !== String(input.policy.id) ||
    decision.policyProfile.version !== input.policy.version ||
    !input.governanceContext.jurisdictionProfiles.some(
      (profile) =>
        profile.id === request.jurisdictionProfile.id &&
        profile.version === request.jurisdictionProfile.version
    )
  ) {
    throw new Error(
      "Privacy request decision is not pinned to the current policy and jurisdiction."
    );
  }

  for (const rootDecision of decision.rootDecisions) {
    const exactRules = rootDecision.purposeIds.map((purposeId) => {
      const matches = input.policy.rules.filter(
        (rule) =>
          rule.dataClassId === rootDecision.dataClassId &&
          rule.purposeId === purposeId
      );
      if (matches.length !== 1) {
        throw new Error(
          `Current policy must contain one exact rule for ${rootDecision.dataClassId}/${purposeId}.`
        );
      }
      const governanceAssignment = input.governanceContext.rolesByPurpose.find(
        (assignment) => assignment.purposeId === purposeId
      );
      if (
        governanceAssignment === undefined ||
        !governanceAssignment.roles.some(
          (role) =>
            responsibilityRoleKey(role) ===
            responsibilityRoleKey(request.responsibilityRole)
        )
      ) {
        throw new Error(
          `Privacy responsibility role is not current for purpose ${purposeId}.`
        );
      }
      return `${matches[0]!.id}\u0000${matches[0]!.revision}`;
    });
    const declaredRules = rootDecision.policyRules.map(
      (rule) => `${rule.id}\u0000${rule.revision}`
    );
    if (!sameCanonicalStrings(declaredRules, exactRules.sort())) {
      throw new Error(
        `Privacy decision policy rules are stale or incomplete for ${rootDecision.root.recordId}.`
      );
    }
  }

  const discoveredRootKeys = new Set(
    (tenantTerminationScope?.roots ?? discovery.roots).map((entry) =>
      dataRootReferenceKey(entry.root)
    )
  );
  const decisionRootKeys = new Set(
    request.workflow.decision.rootDecisions.map(({ root }) =>
      dataRootReferenceKey(root)
    )
  );
  if (!setsAreEqual(discoveredRootKeys, decisionRootKeys)) {
    throw new Error(
      "Privacy decision must cover every root in the exact discovery manifest."
    );
  }
  if (tenantTerminationScope === undefined) {
    validateThirdPartyDecisionBindings(discovery, decision);
  }

  const classById = new Map(
    input.registry.dataClasses.map((entry) => [String(entry.id), entry])
  );
  const rootById = new Map(
    input.registry.storageRoots.map((entry) => [String(entry.id), entry])
  );
  const externalRoutes = input.registry.moduleContributions.flatMap(
    ({ payload }) => payload.externalRoutes
  );
  const useByRoot = new Map(
    input.registry.dataUses.map((use) => [
      `${use.dataClassId}\u0000${use.storageRootId}`,
      use
    ])
  );

  for (const rootDecision of request.workflow.decision.rootDecisions) {
    const dataClass = classById.get(String(rootDecision.dataClassId));
    const storageRoot = rootById.get(String(rootDecision.root.storageRootId));
    const use = useByRoot.get(
      `${rootDecision.dataClassId}\u0000${rootDecision.root.storageRootId}`
    );
    if (
      dataClass === undefined ||
      storageRoot === undefined ||
      use === undefined
    ) {
      throw new Error(
        `Privacy decision references unknown lifecycle lineage ${rootDecision.dataClassId}/${rootDecision.root.storageRootId}.`
      );
    }
    if (
      rootDecision.purposeIds.some(
        (purposeId) =>
          !use.purposeIds.includes(purposeId) ||
          !dataClass.definition.allowedPurposeIds.includes(purposeId)
      )
    ) {
      throw new Error(
        `Privacy decision purpose is not registered for ${rootDecision.dataClassId}/${rootDecision.root.storageRootId}.`
      );
    }

    const rootKind = storageRoot.definition.kind;
    const isExternalRoot = rootKind === "external_route";
    const isBackupRoot = rootKind === "backup";
    if (
      isExternalRoot !==
        (rootDecision.disposition === "external_action_required") ||
      (isBackupRoot &&
        isApprovedDisposition(rootDecision.disposition) &&
        rootDecision.disposition !== "erase")
    ) {
      throw new Error(
        `Privacy root ${rootDecision.root.recordId} is misclassified as local, backup or external.`
      );
    }
    if (tenantTerminationScope !== undefined) {
      const scopeRoot = tenantTerminationScope.roots.find(
        ({ root }) =>
          dataRootReferenceKey(root) === dataRootReferenceKey(rootDecision.root)
      );
      const validTenantDisposition =
        scopeRoot?.handling === "export_then_erase"
          ? rootDecision.disposition === "include_normalized" &&
            rootDecision.followUpDisposition === "erase"
          : scopeRoot?.handling === "erase_without_export"
            ? rootDecision.disposition === "erase" &&
              rootDecision.followUpDisposition === null
            : scopeRoot?.handling === "external_delete_and_track"
              ? rootDecision.disposition === "external_action_required" &&
                rootDecision.followUpDisposition === null &&
                sameCanonicalStrings(
                  rootDecision.externalRouteIds.map(String),
                  scopeRoot.externalRouteIds.map(String)
                )
              : false;
      if (!validTenantDisposition) {
        throw new Error(
          `Tenant termination decision does not match complete-scope handling for ${rootDecision.root.recordId}.`
        );
      }
    }
    for (const routeId of rootDecision.externalRouteIds) {
      const route = externalRoutes.find(
        (candidate) => candidate.id === routeId
      );
      if (
        route === undefined ||
        route.storageRootId !== rootDecision.root.storageRootId ||
        !route.dataClassIds.includes(rootDecision.dataClassId) ||
        !rootDecision.purposeIds.some(
          (purposeId) => String(purposeId) === String(route.purposeId)
        )
      ) {
        throw new Error(
          `Privacy external route ${routeId} is not registered for the exact root lineage.`
        );
      }
    }
  }

  if ("execution" in request.workflow) {
    const requiredDeletionCause = privacyDeletionCauseForIntent(request.intent);
    for (const execution of request.workflow.execution.handlerExecutions) {
      const use = useByRoot.get(
        `${execution.root.dataClassId}\u0000${execution.root.storageRootId}`
      );
      const storageRoot = rootById.get(String(execution.root.storageRootId));
      if (
        storageRoot === undefined ||
        storageRoot.definition.kind === "backup" ||
        storageRoot.definition.kind === "external_route"
      ) {
        throw new Error(
          `Privacy local execution root ${execution.root.recordId} is not a local operated root.`
        );
      }
      const expectedHandlerId =
        execution.disposition === "include_normalized" ||
        execution.disposition === "include_portable"
          ? use?.exportHandlerId
          : execution.disposition === "erase"
            ? use?.verificationHandlerId
            : use?.lifecycleHandlerId;
      if (expectedHandlerId === null || expectedHandlerId === undefined) {
        throw new Error(
          `Privacy execution has no registered handler for ${execution.disposition}.`
        );
      }
      if (execution.handlerId !== expectedHandlerId) {
        throw new Error(
          `Privacy execution handler ${execution.handlerId} does not match registered lineage ${expectedHandlerId}.`
        );
      }
      if (
        execution.deletionProof !== null &&
        execution.deletionProof.cause !== requiredDeletionCause
      ) {
        throw new Error(
          `Privacy deletion proof cause ${execution.deletionProof.cause} does not match request intent ${request.intent}.`
        );
      }
    }
    for (const backup of request.workflow.execution.backupExecutions) {
      const use = useByRoot.get(
        `${backup.root.dataClassId}\u0000${backup.root.storageRootId}`
      );
      const storageRoot = rootById.get(String(backup.root.storageRootId));
      if (
        use === undefined ||
        storageRoot?.definition.kind !== "backup" ||
        backup.deletionProof.cause !== requiredDeletionCause
      ) {
        throw new Error(
          `Privacy backup execution ${backup.root.recordId} has no exact registered backup/deletion lineage.`
        );
      }
    }
    for (const residual of request.workflow.execution.externalResiduals) {
      const route = externalRoutes.find(
        (candidate) => candidate.id === residual.routeId
      );
      const storageRoot = rootById.get(String(residual.root.storageRootId));
      if (
        route === undefined ||
        storageRoot?.definition.kind !== "external_route" ||
        route.storageRootId !== residual.root.storageRootId ||
        !route.dataClassIds.includes(residual.root.dataClassId) ||
        residual.deletionProof.cause !== requiredDeletionCause
      ) {
        throw new Error(
          `Privacy residual route ${residual.routeId} is not registered for its exact external root.`
        );
      }
    }
  }

  requireAuthenticTenantTerminationExport({
    request,
    governanceContext: input.governanceContext,
    policy: input.policy,
    tenantTerminationScope,
    proofs: input.terminalExportProofs ?? []
  });
  requireAuthenticPrivacyDeletionExecutions({
    request,
    executions: input.deletionExecutions ?? []
  });

  const immutableRequest = deepFreezePrivacyRequestValue(request);
  const terminalExportDescriptor =
    input.terminalExportProofs?.length === 1
      ? getInboxV2PrivacyTerminalExportAuthenticity(
          input.terminalExportProofs[0]
        )
      : null;
  registerInboxV2PrivacyRequestAuthenticity(immutableRequest, {
    tenantId: request.tenantId,
    requestId: request.id,
    revision: request.revision,
    intent: request.intent,
    governanceContextId: input.governanceContext.id,
    governanceContextVersion: input.governanceContext.version,
    governanceContextHash: input.governanceContext.contextHash,
    authorityCheckedAt: authority.checkedAt,
    tenantScopeProofHash: tenantTerminationScope?.proofHash ?? null,
    tenantRootKeys:
      tenantTerminationScope?.roots.map(({ root }) =>
        dataRootReferenceKey(root)
      ) ?? [],
    tenantExportRootKeys:
      tenantTerminationScope === undefined
        ? []
        : inboxV2TenantTerminationExportRoots(tenantTerminationScope).map(
            ({ root }) => dataRootReferenceKey(root)
          ),
    terminalExport: terminalExportDescriptor,
    terminalExportProof:
      input.terminalExportProofs?.length === 1
        ? (input.terminalExportProofs[0] ?? null)
        : null
  });
  inboxV2PrivacyRequestAuthorityBindings.set(immutableRequest, {
    source: input.authoritySource,
    discoveryProofHash: discoveryProof.proofHash,
    registryCompositionHash: String(input.registry.compositionHash)
  });
  return immutableRequest;
}

/** Re-loads exact current request/RBAC authority at a destructive boundary. */
export function assertInboxV2PrivacyRequestCurrentAuthority(input: {
  request: InboxV2PrivacyRequest;
  governanceContext: InboxV2DataGovernanceContext;
  policy: InboxV2EffectiveTenantPolicy;
  policyActivationLedger: InboxV2PolicyActivationLedger;
  checkedAt: string;
}): void {
  const binding = inboxV2PrivacyRequestAuthorityBindings.get(input.request);
  const workflow = input.request.workflow;
  const checkedAt = inboxV2TimestampSchema.parse(input.checkedAt);
  const policyActivation = getInboxV2CurrentPolicyActivationReference({
    ledger: input.policyActivationLedger,
    policy: input.policy
  });
  if (
    binding === undefined ||
    !("verification" in workflow) ||
    !("discovery" in workflow) ||
    !("decision" in workflow) ||
    policyActivation === null ||
    !isInboxV2DataGovernanceContext(input.governanceContext) ||
    input.governanceContext.tenantId !== input.request.tenantId ||
    input.policy.tenantId !== input.request.tenantId ||
    input.policy.registryCompositionHash !== binding.registryCompositionHash ||
    String(workflow.decision.policyProfile.id) !== String(input.policy.id) ||
    workflow.decision.policyProfile.version !== input.policy.version ||
    !matchesInboxV2DataGovernanceContextReference({
      context: input.governanceContext,
      reference: input.request.governanceContext
    }) ||
    !matchesInboxV2DataGovernanceContextReference({
      context: input.governanceContext,
      reference: input.policy.governanceContextRef
    }) ||
    Date.parse(checkedAt) < Date.parse(input.governanceContext.effectiveAt) ||
    Date.parse(checkedAt) >= Date.parse(input.governanceContext.reviewAt) ||
    Date.parse(checkedAt) < Date.parse(input.policy.effectiveAt)
  ) {
    throw new Error(
      "Privacy request destructive authority requires current governance, policy activation and request lineage."
    );
  }
  const authority = inboxV2PrivacyRequestAuthorityResultSchema.parse(
    binding.source.loadCurrentAuthority({
      tenantId: input.request.tenantId,
      request: {
        tenantId: input.request.tenantId,
        requestId: input.request.id,
        revision: input.request.revision
      },
      verification: {
        id: workflow.verification.id,
        revision: workflow.verification.revision
      },
      decision: {
        id: workflow.decision.id,
        revision: workflow.decision.revision,
        digest: workflow.decision.digest
      },
      discovery: workflow.discovery,
      discoveryProofHash: binding.discoveryProofHash,
      governanceContext: input.request.governanceContext,
      policy: {
        tenantId: input.policy.tenantId,
        id: input.policy.id,
        version: input.policy.version,
        policyHash: input.policy.policyHash
      },
      policyActivation,
      registryCompositionHash: binding.registryCompositionHash,
      checkedAt
    })
  );
  if (
    authority.checkedAt !== checkedAt ||
    authority.tenantId !== input.request.tenantId ||
    authority.reviewer.tenantId !== workflow.decision.reviewer.tenantId ||
    authority.reviewer.id !== workflow.decision.reviewer.id ||
    !sameCanonicalStrings(
      authority.verifiedSubjects.map(dataSubjectReferenceKey),
      workflow.verification.verifiedSubjects.map(dataSubjectReferenceKey)
    ) ||
    !sameCanonicalStrings(
      authority.authorizedAliases.map(dataSubjectReferenceKey),
      input.request.claimedSubjectAliases.map(dataSubjectReferenceKey)
    )
  ) {
    throw new Error(
      "Privacy request authority changed before destructive execution."
    );
  }
}

/** Raw schema-parsed lookalikes are not destructive-workflow authority. */
export function isInboxV2PrivacyRequest(
  value: unknown
): value is InboxV2PrivacyRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    hasInboxV2PrivacyRequestAuthenticity(value)
  );
}

function validateThirdPartyDecisionBindings(
  discovery: InboxV2SubjectDiscoveryManifest,
  decision: InboxV2PrivacyRequestDecision
): void {
  const assessmentByRoot = new Map(
    discovery.roots.map((assessment) => [
      dataRootReferenceKey(assessment.root),
      assessment
    ])
  );
  for (const rootDecision of decision.rootDecisions) {
    const assessment = assessmentByRoot.get(
      dataRootReferenceKey(rootDecision.root)
    );
    if (assessment === undefined) {
      throw new Error("Privacy decision has no exact discovery assessment.");
    }
    if (assessment.relationshipToRequester === "requester_only") {
      if (rootDecision.thirdPartyHandling.kind !== "not_applicable") {
        throw new Error(
          "Requester-only roots cannot invent third-party redaction or omission."
        );
      }
      continue;
    }
    if (assessment.relationshipToRequester === "unresolved") {
      if (
        rootDecision.disposition !== "retain_with_exception" ||
        rootDecision.thirdPartyHandling.kind !== "not_applicable" ||
        !rootDecision.exceptions.some(
          (exception) => exception.kind === "scope_ambiguous"
        )
      ) {
        throw new Error(
          "Unresolved discovery scope must fail closed with a scope-ambiguity exception."
        );
      }
      continue;
    }
    const protection = assessment.thirdPartyProtection;
    if (protection === null) {
      throw new Error(
        "Third-party discovery scope lacks protection authority."
      );
    }
    const handlingMatches =
      protection.status !== "review_required" &&
      rootDecision.thirdPartyHandling.kind === protection.status &&
      "policyProfile" in rootDecision.thirdPartyHandling &&
      rootDecision.thirdPartyHandling.policyProfile.id ===
        protection.policyProfile.id &&
      rootDecision.thirdPartyHandling.policyProfile.version ===
        protection.policyProfile.version &&
      rootDecision.thirdPartyHandling.reasonCode === protection.reasonCode;

    if (
      assessment.relationshipToRequester === "mixed" &&
      protection.status === "redacted"
    ) {
      if (
        !isApprovedDisposition(rootDecision.disposition) ||
        !handlingMatches
      ) {
        throw new Error(
          "Mixed roots may be approved only with the exact discovered redaction."
        );
      }
      continue;
    }
    if (protection.status === "omitted") {
      if (rootDecision.disposition !== "omit_with_reason" || !handlingMatches) {
        throw new Error(
          "Third-party omission must match the exact discovered protection decision."
        );
      }
      continue;
    }
    const exactException = rootDecision.exceptions.some(
      (exception) =>
        exception.kind === "third_party_rights" &&
        exception.policyProfile.id === protection.policyProfile.id &&
        exception.policyProfile.version === protection.policyProfile.version &&
        exception.reasonCode === protection.reasonCode
    );
    if (
      rootDecision.disposition !== "retain_with_exception" ||
      rootDecision.thirdPartyHandling.kind !== "not_applicable" ||
      !exactException
    ) {
      throw new Error(
        "Unresolved or third-party-only protection must fail closed with the exact policy exception."
      );
    }
  }
}

function requireAuthenticTenantTerminationExport(input: {
  request: InboxV2PrivacyRequest;
  governanceContext: InboxV2DataGovernanceContext;
  policy: InboxV2EffectiveTenantPolicy;
  tenantTerminationScope: InboxV2TenantTerminationScopeManifest | undefined;
  proofs: readonly object[];
}): void {
  const workflow = input.request.workflow;
  const terminalReference =
    "execution" in workflow ? workflow.execution.terminalExport : null;
  const requiresTerminalTenantExport =
    input.request.intent === "tenant_termination_export_delete" &&
    "execution" in workflow;
  if (!requiresTerminalTenantExport) {
    if (
      input.request.intent !== "tenant_termination_export_delete" &&
      terminalReference !== null
    ) {
      throw new Error(
        "Only tenant termination may bind a terminal deployment export."
      );
    }
    if (input.proofs.length > 0) {
      throw new Error(
        "Terminal export proof objects are accepted only at tenant-termination completion."
      );
    }
    return;
  }
  if (
    terminalReference === null ||
    input.proofs.length !== 1 ||
    input.tenantTerminationScope === undefined
  ) {
    throw new Error(
      "Executing tenant termination requires exactly one authentic ready export bundle and tenant-wide scope."
    );
  }
  if (!("decision" in workflow)) {
    throw new Error("Tenant termination execution lacks terminal checkpoints.");
  }
  const descriptor = getInboxV2PrivacyTerminalExportAuthenticity(
    input.proofs[0]
  );
  const expectedRootKeys = inboxV2TenantTerminationExportRoots(
    input.tenantTerminationScope
  )
    .map(({ root }) => dataRootReferenceKey(root))
    .sort();
  const checkedAt =
    "completedAt" in workflow ? workflow.completedAt : input.request.updatedAt;
  if (
    descriptor === null ||
    !matchesTerminalExportReference(terminalReference, descriptor) ||
    descriptor.tenantId !== input.request.tenantId ||
    descriptor.productKind !== "tenant_deployment" ||
    descriptor.governanceContextId !== input.governanceContext.id ||
    descriptor.governanceContextVersion !== input.governanceContext.version ||
    descriptor.governanceContextHash !== input.governanceContext.contextHash ||
    descriptor.policyId !== input.policy.id ||
    descriptor.policyVersion !== input.policy.version ||
    descriptor.policyHash !== input.policy.policyHash ||
    descriptor.tenantScopeProofHash !==
      input.tenantTerminationScope.proofHash ||
    !sameCanonicalStrings(descriptor.rootKeys, expectedRootKeys) ||
    Date.parse(descriptor.artifactReadyAt) > Date.parse(checkedAt) ||
    Date.parse(descriptor.artifactExpiresAt) <= Date.parse(checkedAt)
  ) {
    throw new Error(
      "Tenant termination export is stale, incomplete or not bound to the exact ready artifact."
    );
  }
  assertInboxV2PrivacyTerminalExportCurrent(input.proofs[0], checkedAt);
}

function matchesTerminalExportReference(
  reference: InboxV2PrivacyTerminalExportReference,
  descriptor: InboxV2PrivacyTerminalExportAuthenticityDescriptor
): boolean {
  return (
    reference.tenantId === descriptor.tenantId &&
    reference.productKind === descriptor.productKind &&
    reference.job.id === descriptor.jobId &&
    reference.job.revision === descriptor.jobRevision &&
    reference.manifest.id === descriptor.manifestId &&
    reference.manifest.revision === descriptor.manifestRevision &&
    reference.manifest.manifestHash === descriptor.manifestHash &&
    reference.artifact.id === descriptor.artifactId &&
    reference.artifact.revision === descriptor.artifactRevision &&
    reference.artifact.checksum === descriptor.artifactChecksum &&
    reference.artifact.readyAt === descriptor.artifactReadyAt &&
    reference.artifact.expiresAt === descriptor.artifactExpiresAt &&
    reference.governanceContext.id === descriptor.governanceContextId &&
    reference.governanceContext.version ===
      descriptor.governanceContextVersion &&
    reference.governanceContext.contextHash ===
      descriptor.governanceContextHash &&
    reference.policy.id === descriptor.policyId &&
    reference.policy.version === descriptor.policyVersion &&
    reference.policy.policyHash === descriptor.policyHash &&
    reference.rootSetHash === descriptor.rootSetHash &&
    reference.tenantScopeProofHash === descriptor.tenantScopeProofHash
  );
}

function requireAuthenticPrivacyDeletionExecutions(input: {
  request: InboxV2PrivacyRequest;
  executions: readonly Readonly<{
    plan: InboxV2DeletionPlan;
    run: InboxV2DeletionRun;
  }>[];
}): void {
  if (!("execution" in input.request.workflow)) {
    if (input.executions.length > 0) {
      throw new Error(
        "A pre-execution privacy request cannot carry deletion-run authority."
      );
    }
    return;
  }
  const workflow = input.request.workflow;
  const proofSurfaces = [
    ...workflow.execution.handlerExecutions.flatMap((execution) =>
      execution.deletionProof === null
        ? []
        : [
            {
              kind: "operated" as const,
              proof: execution.deletionProof,
              status: execution.status
            }
          ]
    ),
    ...workflow.execution.backupExecutions.map((execution) => ({
      kind: "backup" as const,
      proof: execution.deletionProof,
      status: execution.outcome,
      latestPossibleExpiryAt: execution.latestPossibleExpiryAt
    })),
    ...workflow.execution.externalResiduals.map((execution) => ({
      kind: "external" as const,
      proof: execution.deletionProof,
      status: execution.outcome,
      routeId: execution.routeId
    }))
  ];
  const requiredPairs = new Set(
    proofSurfaces.map(({ proof }) => deletionProofPairKey(proof))
  );
  const actualPairs = new Set(
    input.executions.map(({ plan, run }) =>
      deletionPlanRunPairKey(plan.id, run.id)
    )
  );
  if (!setsAreEqual(requiredPairs, actualPairs)) {
    throw new Error(
      "Privacy execution requires exact authentic deletion plan/run coverage."
    );
  }

  for (const execution of input.executions) {
    if (
      !hasInboxV2DeletionPlanAuthenticity(execution.plan) ||
      !hasInboxV2DeletionRunAuthenticity(execution.run) ||
      execution.plan.tenantId !== input.request.tenantId ||
      execution.run.tenantId !== input.request.tenantId ||
      execution.run.plan.planId !== execution.plan.id ||
      execution.run.plan.revision !== execution.plan.revision ||
      execution.run.plan.planHash !== execution.plan.planHash
    ) {
      throw new Error(
        "Privacy deletion proof requires authentic exact plan and run objects."
      );
    }
    if (
      execution.plan.decisionBasis.kind !== "privacy_request" ||
      execution.plan.decisionBasis.request.requestId !== input.request.id ||
      BigInt(execution.plan.decisionBasis.request.revision) >
        BigInt(input.request.revision) ||
      !("decision" in input.request.workflow) ||
      execution.plan.decisionBasis.decisionId !==
        input.request.workflow.decision.id ||
      execution.plan.decisionBasis.decisionRevision !==
        input.request.workflow.decision.revision ||
      execution.plan.decisionBasis.decisionDigest !==
        input.request.workflow.decision.digest
    ) {
      throw new Error(
        "Privacy deletion plan is not bound to this exact request decision."
      );
    }
    if (
      isCompletionState(workflow.state) &&
      execution.run.state !== "terminal"
    ) {
      throw new Error(
        "Completed privacy request requires terminal deletion-run evidence."
      );
    }
  }

  for (const surface of proofSurfaces) {
    const execution = input.executions.find(
      ({ plan, run }) =>
        deletionPlanRunPairKey(plan.id, run.id) ===
        deletionProofPairKey(surface.proof)
    );
    if (
      execution === undefined ||
      surface.proof.plan.tenantId !== execution.plan.tenantId ||
      surface.proof.plan.planId !== execution.plan.id ||
      surface.proof.plan.revision !== execution.plan.revision ||
      surface.proof.plan.planHash !== execution.plan.planHash ||
      surface.proof.run.tenantId !== execution.run.tenantId ||
      surface.proof.run.runId !== execution.run.id ||
      surface.proof.run.revision !== execution.run.revision ||
      surface.proof.cause !== execution.plan.cause
    ) {
      throw new Error(
        "Privacy deletion proof reference does not match its authentic plan/run."
      );
    }
    const rootKey = dataRootReferenceKey(surface.proof.root);
    if (surface.kind === "operated") {
      const checkpoint = execution.plan.operatedCheckpoints.find(
        ({ target }) => dataRootReferenceKey(target.root) === rootKey
      );
      const outcome = execution.run.operatedOutcomes.find(
        (candidate) => candidate.checkpointId === checkpoint?.checkpointId
      );
      if (
        checkpoint === undefined ||
        outcome === undefined ||
        (surface.status === "succeeded_verified" &&
          outcome.outcome.kind !== "verified_absent")
      ) {
        throw new Error(
          "Privacy erase proof lacks exact operated absence verification."
        );
      }
    } else if (surface.kind === "backup") {
      const checkpoint = execution.plan.backupCheckpoints.find(
        ({ backupRoot }) => dataRootReferenceKey(backupRoot) === rootKey
      );
      const outcome = execution.run.backupOutcomes.find(
        (candidate) => candidate.checkpointId === checkpoint?.checkpointId
      );
      if (
        checkpoint === undefined ||
        outcome === undefined ||
        outcome.state !== surface.status ||
        ((outcome.state === "finite_expiry_pending" ||
          outcome.state === "expiry_verified") &&
          outcome.latestPossibleExpiryAt !== surface.latestPossibleExpiryAt)
      ) {
        throw new Error(
          "Privacy backup proof lacks exact bounded deletion-run evidence."
        );
      }
    } else {
      const checkpoint = execution.plan.externalCheckpoints.find(
        ({ root, routeId }) =>
          dataRootReferenceKey(root) === rootKey && routeId === surface.routeId
      );
      const outcome = execution.run.externalResiduals.find(
        (candidate) => candidate.checkpointId === checkpoint?.checkpointId
      );
      if (
        checkpoint === undefined ||
        outcome === undefined ||
        outcome.outcome !== surface.status
      ) {
        throw new Error(
          "Privacy external proof lacks exact route deletion-run evidence."
        );
      }
    }
  }
}

function deletionProofPairKey(
  proof: InboxV2PrivacyDeletionProofReference
): string {
  return deletionPlanRunPairKey(proof.plan.planId, proof.run.runId);
}

function deletionPlanRunPairKey(planId: string, runId: string): string {
  return `${planId}\u0000${runId}`;
}

function validateDecisionResult(
  context: z.RefinementCtx,
  decision: z.infer<typeof inboxV2PrivacyRequestDecisionSchema>
): void {
  const allowed = decision.rootDecisions.filter((root) =>
    isApprovedDisposition(root.disposition)
  ).length;
  const denied = decision.rootDecisions.length - allowed;
  const valid =
    (decision.result === "approved" && allowed > 0 && denied === 0) ||
    (decision.result === "partially_approved" && allowed > 0 && denied > 0) ||
    (decision.result === "rejected" && allowed === 0) ||
    (decision.result === "blocked_by_legal_hold" &&
      allowed === 0 &&
      decision.holdReferences.length > 0 &&
      decision.rootDecisions.every(
        (root) => root.disposition === "retain_with_exception"
      ));
  if (!valid) {
    addIssue(
      context,
      ["result"],
      "Decision result must match approved/denied root dispositions and legal-hold evidence."
    );
  }
}

function validateIntentDispositions(
  context: z.RefinementCtx,
  intent: z.infer<typeof inboxV2PrivacyRequestIntentSchema>,
  decision: z.infer<typeof inboxV2PrivacyRequestDecisionSchema>
): void {
  const allowedByIntent: Record<
    z.infer<typeof inboxV2PrivacyRequestIntentSchema>,
    ReadonlySet<z.infer<typeof inboxV2PrivacyRootDispositionSchema>>
  > = {
    access: new Set(["include_normalized"]),
    portability: new Set(["include_portable"]),
    correction: new Set(["correct"]),
    erasure: new Set(["erase", "external_action_required"]),
    restriction: new Set(["restrict_processing"]),
    objection: new Set(["stop_objected_processing"]),
    tenant_termination_export_delete: new Set([
      "include_normalized",
      "erase",
      "external_action_required"
    ]),
    administrative_retention_purge: new Set([
      "erase",
      "external_action_required"
    ])
  };
  for (const [index, root] of decision.rootDecisions.entries()) {
    if (
      isApprovedDisposition(root.disposition) &&
      !allowedByIntent[intent].has(root.disposition)
    ) {
      addIssue(
        context,
        ["workflow", "decision", "rootDecisions", index, "disposition"],
        "Root disposition is incompatible with the request intent."
      );
    }
    const requiresExportThenErase =
      intent === "tenant_termination_export_delete" &&
      root.disposition === "include_normalized";
    if (
      requiresExportThenErase !== (root.followUpDisposition === "erase") ||
      (intent !== "tenant_termination_export_delete" &&
        root.followUpDisposition !== null)
    ) {
      addIssue(
        context,
        ["workflow", "decision", "rootDecisions", index, "followUpDisposition"],
        "Tenant termination requires export followed by erase for every approved internal root; other intents cannot declare a follow-up."
      );
    }
  }
}

function validateWorkflowTenantAndSubject(
  context: z.RefinementCtx,
  request: z.infer<typeof inboxV2PrivacyRequestSchema>
): void {
  const workflow = request.workflow;
  if ("verification" in workflow) {
    addTenantIssue(context, request.tenantId, workflow.verification.tenantId, [
      "workflow",
      "verification",
      "tenantId"
    ]);
    if (workflow.verification.status === "verified") {
      const verifiedKeys = workflow.verification.verifiedSubjects.map(
        dataSubjectReferenceKey
      );
      if (
        !verifiedKeys.includes(
          dataSubjectReferenceKey(request.requesterSubject)
        )
      ) {
        addIssue(
          context,
          ["workflow", "verification", "verifiedSubjects"],
          "Verified subjects must include the requester's canonical subject."
        );
      }
    }
    if (
      !isInboxV2TimestampOrderValid(
        request.receivedAt,
        workflow.verification.startedAt
      ) ||
      (workflow.verification.status !== "pending" &&
        !isInboxV2TimestampOrderValid(
          workflow.verification.completedAt,
          request.updatedAt
        ))
    ) {
      addIssue(
        context,
        ["workflow", "verification"],
        "Verification timestamps must stay inside the request lifecycle."
      );
    }
  }
  if ("discovery" in workflow) {
    addTenantIssue(context, request.tenantId, workflow.discovery.tenantId, [
      "workflow",
      "discovery",
      "tenantId"
    ]);
  }
  if ("decision" in workflow) {
    addTenantIssue(context, request.tenantId, workflow.decision.tenantId, [
      "workflow",
      "decision",
      "tenantId"
    ]);
    if (
      !isInboxV2TimestampOrderValid(
        request.receivedAt,
        workflow.decision.decidedAt
      ) ||
      !isInboxV2TimestampOrderValid(
        workflow.decision.decidedAt,
        request.updatedAt
      )
    ) {
      addIssue(
        context,
        ["workflow", "decision", "decidedAt"],
        "Decision time must stay inside the request lifecycle."
      );
    }
  }
  if ("execution" in workflow) {
    addTenantIssue(
      context,
      request.tenantId,
      workflow.execution.reference.tenantId,
      ["workflow", "execution", "reference", "tenantId"]
    );
  }
  if (
    "completedAt" in workflow &&
    (!isInboxV2TimestampOrderValid(request.receivedAt, workflow.completedAt) ||
      !isInboxV2TimestampOrderValid(
        workflow.decision.decidedAt,
        workflow.completedAt
      ) ||
      !isInboxV2TimestampOrderValid(workflow.completedAt, request.updatedAt))
  ) {
    addIssue(
      context,
      ["workflow", "completedAt"],
      "Completion cannot precede request receipt."
    );
  }
}

function validateExecutionCoverage(
  context: z.RefinementCtx,
  decision: z.infer<typeof inboxV2PrivacyRequestDecisionSchema>,
  execution: z.infer<typeof inboxV2PrivacyExecutionProgressSchema>,
  requireCompleteCoverage: boolean
): void {
  const expectedInternalSlots = new Set<string>();
  const expectedExternalSlots = new Set<string>();

  for (const rootDecision of decision.rootDecisions) {
    if (!isApprovedDisposition(rootDecision.disposition)) {
      continue;
    }
    if (rootDecision.disposition === "external_action_required") {
      for (const routeId of rootDecision.externalRouteIds) {
        expectedExternalSlots.add(
          externalCoverageKey(rootDecision.root, routeId)
        );
      }
      continue;
    }
    expectedInternalSlots.add(
      handlerCoverageKey(rootDecision.root, rootDecision.disposition)
    );
    if (rootDecision.followUpDisposition !== null) {
      expectedInternalSlots.add(
        handlerCoverageKey(rootDecision.root, rootDecision.followUpDisposition)
      );
    }
  }

  const actualInternalSlots = new Set<string>();
  for (const [index, handler] of execution.handlerExecutions.entries()) {
    const slot = handlerCoverageKey(handler.root, handler.disposition);
    actualInternalSlots.add(slot);
    if (!expectedInternalSlots.has(slot)) {
      addIssue(
        context,
        ["execution", "handlerExecutions", index],
        "Handler execution must match an approved root and its exact internal disposition."
      );
    }
  }
  for (const [index, backup] of execution.backupExecutions.entries()) {
    const slot = handlerCoverageKey(backup.root, backup.disposition);
    if (actualInternalSlots.has(slot)) {
      addIssue(
        context,
        ["execution", "backupExecutions", index],
        "One root/disposition cannot be reported as both local and backup execution."
      );
    }
    actualInternalSlots.add(slot);
    if (!expectedInternalSlots.has(slot)) {
      addIssue(
        context,
        ["execution", "backupExecutions", index],
        "Backup execution must match an approved erase root."
      );
    }
  }

  const actualExternalSlots = new Set<string>();
  for (const [index, residual] of execution.externalResiduals.entries()) {
    const slot = externalCoverageKey(residual.root, residual.routeId);
    actualExternalSlots.add(slot);
    if (!expectedExternalSlots.has(slot)) {
      addIssue(
        context,
        ["execution", "externalResiduals", index],
        "External residual must match an approved external-action root and one of its exact declared routes."
      );
    }
  }

  if (
    requireCompleteCoverage &&
    !setsAreEqual(expectedInternalSlots, actualInternalSlots)
  ) {
    addIssue(
      context,
      ["execution"],
      "Verification and completion require exactly one local or backup outcome for every approved internal root."
    );
  }
  if (
    requireCompleteCoverage &&
    !setsAreEqual(expectedExternalSlots, actualExternalSlots)
  ) {
    addIssue(
      context,
      ["execution", "externalResiduals"],
      "Verification and completion require exact per-root, per-route external residual coverage."
    );
  }

  for (const rootDecision of decision.rootDecisions) {
    if (rootDecision.followUpDisposition === null) continue;
    const primarySlot = handlerCoverageKey(
      rootDecision.root,
      rootDecision.disposition
    );
    const followUpSlot = handlerCoverageKey(
      rootDecision.root,
      rootDecision.followUpDisposition
    );
    const primaryIndex = execution.handlerExecutions.findIndex(
      (handler) =>
        handlerCoverageKey(handler.root, handler.disposition) === primarySlot
    );
    const followUpIndex = execution.handlerExecutions.findIndex(
      (handler) =>
        handlerCoverageKey(handler.root, handler.disposition) === followUpSlot
    );
    if (
      followUpIndex >= 0 &&
      (primaryIndex < 0 || primaryIndex >= followUpIndex)
    ) {
      addIssue(
        context,
        ["execution", "handlerExecutions"],
        "Tenant termination must execute export before erase for the same root."
      );
    }
  }
}

function validateCompletionState(
  context: z.RefinementCtx,
  workflow: z.infer<typeof completedPrivacyWorkflowSchema>
): void {
  const handlers = workflow.execution.handlerExecutions;
  const backups = workflow.execution.backupExecutions;
  const residuals = workflow.execution.externalResiduals;
  const internalUnverified =
    handlers.some(
      (handler) =>
        handler.status === "failed_terminal" || handler.status === "unverified"
    ) || backups.some((backup) => backup.outcome === "unverified");
  const retryable =
    handlers.some((handler) => handler.status === "failed_retryable") ||
    backups.some((backup) => backup.outcome === "failed_retryable") ||
    residuals.some((residual) => residual.outcome === "failed_retryable");
  const unresolvedExternal = residuals.some(
    (residual) =>
      residual.outcome === "requested" ||
      residual.outcome === "unsupported" ||
      residual.outcome === "unknown" ||
      residual.outcome === "failed_retryable"
  );
  const handlersVerified = handlers.every(
    (handler) => handler.status === "succeeded_verified"
  );
  const backupsVerified = backups.every(
    (backup) => backup.outcome === "expiry_verified"
  );
  const backupPending = backups.some(
    (backup) => backup.outcome === "finite_expiry_pending"
  );
  const hasExecutionEvidence =
    handlers.length + backups.length + residuals.length > 0;
  const valid =
    (workflow.state === "completed" &&
      hasExecutionEvidence &&
      handlersVerified &&
      backupsVerified &&
      !unresolvedExternal &&
      !backupPending) ||
    (workflow.state === "completed_with_external_residuals" &&
      hasExecutionEvidence &&
      handlersVerified &&
      backupsVerified &&
      unresolvedExternal &&
      !retryable &&
      !backupPending) ||
    (workflow.state === "primary_purged_backup_expiry_pending" &&
      hasExecutionEvidence &&
      handlersVerified &&
      !internalUnverified &&
      !unresolvedExternal &&
      backupPending) ||
    (workflow.state === "verification_blocked_internal_residual" &&
      internalUnverified &&
      !retryable &&
      !unresolvedExternal &&
      !backupPending) ||
    (workflow.state === "failed_retryable" && retryable && !backupPending);
  if (!valid) {
    addIssue(
      context,
      ["state"],
      "Completion result must be derived from handler, backup and external residual evidence."
    );
  }
}

function isApprovedDisposition(
  disposition: z.infer<typeof inboxV2PrivacyRootDispositionSchema>
): boolean {
  return (
    disposition !== "retain_with_exception" &&
    disposition !== "omit_with_reason"
  );
}

function privacyDeletionCauseForIntent(
  intent: z.infer<typeof inboxV2PrivacyRequestIntentSchema>
): z.infer<typeof inboxV2PrivacyDeletionProofReferenceSchema>["cause"] | null {
  switch (intent) {
    case "erasure":
      return "privacy_erasure";
    case "tenant_termination_export_delete":
      return "tenant_offboarding";
    case "administrative_retention_purge":
      return "administrative_policy_purge";
    default:
      return null;
  }
}

function isCompletionState(
  state: z.infer<typeof inboxV2PrivacyRequestStateSchema>
): state is z.infer<typeof inboxV2PrivacyCompletionResultSchema> {
  return inboxV2PrivacyCompletionResultSchema.safeParse(state).success;
}

function dataSubjectTenantId(
  subject: z.infer<typeof inboxV2DataSubjectReferenceSchema>
): string {
  switch (subject.kind) {
    case "employee":
      return subject.employee.tenantId;
    case "client_contact":
      return subject.clientContact.tenantId;
    case "source_external_identity":
      return subject.sourceExternalIdentity.tenantId;
    case "account":
      return subject.account.tenantId;
    case "unresolved_provider_subject":
      return subject.tenantId;
  }
}

function classifiedEvidenceKey(
  evidence: z.infer<typeof inboxV2ClassifiedEvidenceReferenceSchema>
): string {
  return `${evidence.tenantId}\u0000${evidence.storageRootId}\u0000${evidence.payload.recordId}`;
}

function privacyExceptionKey(
  exception: z.infer<typeof inboxV2PrivacyDecisionExceptionSchema>
): string {
  return `${exception.kind}\u0000${exception.reasonCode}\u0000${exception.policyProfile.id}\u0000${exception.policyProfile.version}`;
}

function responsibilityRoleKey(
  role: z.infer<typeof inboxV2ResponsibilityRoleSchema>
): string {
  return role.regime === "approved_extension"
    ? `${role.regime}\u0000${role.regimeId}\u0000${role.roleId}\u0000${role.approvedProfile.id}\u0000${role.approvedProfile.version}`
    : `${role.regime}\u0000${role.role}`;
}

function sameCanonicalStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function handlerExecutionKey(
  execution: z.infer<typeof inboxV2PrivacyHandlerExecutionReferenceSchema>
): string {
  const phase = execution.disposition === "erase" ? "2" : "1";
  return `${privacyExecutionRootKey(execution.root)}\u0000${phase}\u0000${execution.disposition}`;
}

function backupExecutionKey(
  execution: z.infer<typeof inboxV2PrivacyBackupExecutionReferenceSchema>
): string {
  return privacyExecutionRootKey(execution.root);
}

function externalResidualKey(
  residual: z.infer<typeof inboxV2PrivacyExternalResidualReferenceSchema>
): string {
  return externalCoverageKey(residual.root, residual.routeId);
}

function handlerCoverageKey(
  root: z.infer<typeof inboxV2DataRootReferenceSchema>,
  disposition: string
): string {
  return `${privacyExecutionRootKey(root)}\u0000${disposition}`;
}

function externalCoverageKey(
  root: z.infer<typeof inboxV2DataRootReferenceSchema>,
  routeId: string
): string {
  return `${privacyExecutionRootKey(root)}\u0000${routeId}`;
}

function privacyExecutionRootKey(
  root: z.infer<typeof inboxV2DataRootReferenceSchema>
): string {
  return dataRootReferenceKey(root);
}

function entityKey(entity: z.infer<typeof inboxV2EntityKeySchema>): string {
  return `${entity.tenantId}\u0000${entity.entityTypeId}\u0000${entity.entityId}`;
}

function deepFreezePrivacyRequestValue<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreezePrivacyRequestValue(child);
  }
  return Object.freeze(value);
}

function addCanonicalUniqueIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  label: string
): void {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => index > 0 && value <= values[index - 1]!)
  ) {
    addIssue(context, [], `${label} must be unique and canonically sorted.`);
  }
}

function addUniqueIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[],
  message: string
): void {
  if (new Set(values).size !== values.length) {
    addIssue(context, path, message);
  }
}

function setsAreEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function addTenantIssue(
  context: z.RefinementCtx,
  tenantId: string,
  referencedTenantId: string,
  path: PropertyKey[]
): void {
  if (tenantId !== referencedTenantId) {
    addIssue(
      context,
      path,
      "Referenced privacy-request data must belong to the same tenant."
    );
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
