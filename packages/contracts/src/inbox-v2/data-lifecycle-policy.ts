import { z } from "zod";

import type { Brand } from "../brand";
import {
  defineInboxV2DataLifecycleRegistry,
  inboxV2DataClassDefinitionSchema,
  isInboxV2DataLifecycleRegistry,
  INBOX_V2_CORE_DATA_CLASS_CATALOG,
  type InboxV2DataLifecycleRegistry
} from "./data-lifecycle-catalog";
import {
  inboxV2DataGovernanceContextReferenceSchema,
  inboxV2DataGovernanceContextSchema,
  isInboxV2DataGovernanceContext,
  matchesInboxV2DataGovernanceContextReference,
  type InboxV2DataGovernanceContext
} from "./data-governance";
import {
  inboxV2DataClassIdSchema,
  inboxV2DeploymentProfileSchema,
  inboxV2LifecycleActionSchema,
  inboxV2LifecycleHandlerIdSchema,
  inboxV2ProcessingPurposeIdSchema,
  inboxV2RetentionAnchorIdSchema,
  inboxV2RetentionPeriodSchema,
  inboxV2RetentionRuleIdSchema,
  inboxV2RetentionWindowSchema,
  inboxV2VersionedProfileReferenceSchema,
  INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
  type InboxV2RetentionPeriod,
  type InboxV2RetentionWindow,
  type InboxV2VersionedProfileReference
} from "./data-lifecycle-primitives";
import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  defineInboxV2LegalHold,
  defineInboxV2ProcessingRestriction,
  isInboxV2LegalHold,
  isInboxV2ProcessingRestriction,
  matchInboxV2LegalHold,
  matchInboxV2ProcessingRestriction,
  inboxV2LegalHoldSchema,
  inboxV2PrivacyControlTargetSchema,
  inboxV2PrivacyHoldReferenceSchema,
  inboxV2ProcessingRestrictionReferenceSchema,
  inboxV2ProcessingRestrictionSchema,
  inboxV2RestrictedProcessingUseSchema,
  type InboxV2ProspectivePrivacyScopeMatcher
} from "./privacy-hold-restriction";
import {
  createInboxV2SchemaEnvelopeSchema,
  type InboxV2SchemaEnvelope
} from "./schema-version";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2EntityKeySchema,
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";

export const INBOX_V2_DATA_LIFECYCLE_POLICY_SCHEMA_ID =
  "core:inbox-v2.data-lifecycle-policy" as const;
export const INBOX_V2_DATA_LIFECYCLE_POLICY_ACTIVATION_SCHEMA_ID =
  "core:inbox-v2.data-lifecycle-policy-activation" as const;

export type InboxV2DataLifecyclePolicyId = Brand<
  string,
  "InboxV2DataLifecyclePolicyId"
>;

export const inboxV2DataLifecyclePolicyIdSchema =
  inboxV2NamespacedIdSchema.transform(
    (value) => value as unknown as InboxV2DataLifecyclePolicyId
  );

export const inboxV2DataLifecyclePolicyReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2DataLifecyclePolicyIdSchema,
    version: inboxV2EntityRevisionSchema,
    policyHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2PolicyTemplateReferenceSchema = z
  .object({
    id: inboxV2DataLifecyclePolicyIdSchema,
    version: inboxV2EntityRevisionSchema,
    templateHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2DataLifecycleRuleSchema = z
  .object({
    id: inboxV2RetentionRuleIdSchema,
    revision: inboxV2EntityRevisionSchema,
    dataClassId: inboxV2DataClassIdSchema,
    purposeId: inboxV2ProcessingPurposeIdSchema,
    retentionAnchorId: inboxV2RetentionAnchorIdSchema,
    baselineWindow: inboxV2RetentionWindowSchema,
    actionAtExpiry: inboxV2LifecycleActionSchema,
    backupMaximum: inboxV2RetentionPeriodSchema,
    legalMinimum: inboxV2RetentionPeriodSchema.nullable(),
    legalMaximum: inboxV2RetentionPeriodSchema.nullable(),
    allowTenantShorter: z.boolean(),
    allowTenantLonger: z.boolean(),
    holdEligible: z.boolean()
  })
  .strict();

export const inboxV2PolicyTemplateSchema = z
  .object({
    kind: z.literal("template"),
    id: inboxV2DataLifecyclePolicyIdSchema,
    version: inboxV2EntityRevisionSchema,
    templateHash: inboxV2Sha256DigestSchema,
    deploymentProfile: inboxV2DeploymentProfileSchema,
    jurisdictionProfiles: z
      .array(inboxV2VersionedProfileReferenceSchema)
      .min(1)
      .max(64)
      .superRefine((references, context) =>
        addCanonicalUniqueIssue(
          context,
          references.map(versionedReferenceKey),
          "Policy-template jurisdiction profiles"
        )
      ),
    effectiveAt: inboxV2TimestampSchema,
    reviewAt: inboxV2TimestampSchema,
    rules: z
      .array(inboxV2DataLifecycleRuleSchema)
      .min(1)
      .max(2_048)
      .superRefine(addCanonicalRuleIssues)
  })
  .strict()
  .superRefine((template, context) => {
    if (Date.parse(template.reviewAt) <= Date.parse(template.effectiveAt)) {
      addIssue(
        context,
        ["reviewAt"],
        "Policy template requires a future review time."
      );
    }
    if (
      template.templateHash !== calculateInboxV2PolicyTemplateHash(template)
    ) {
      addIssue(
        context,
        ["templateHash"],
        "Policy template hash must match its canonical reviewed content."
      );
    }
  });

export const inboxV2TenantRetentionSelectionSchema = z
  .object({
    ruleId: inboxV2RetentionRuleIdSchema,
    ruleRevision: inboxV2EntityRevisionSchema,
    selectedPeriod: inboxV2RetentionPeriodSchema,
    decisionRef: inboxV2VersionedProfileReferenceSchema
  })
  .strict();

export const inboxV2EntitlementRetentionAllowanceSchema = z
  .object({
    ruleId: inboxV2RetentionRuleIdSchema,
    ruleRevision: inboxV2EntityRevisionSchema,
    optionalLongerMaximum: inboxV2RetentionPeriodSchema,
    decisionRef: inboxV2VersionedProfileReferenceSchema
  })
  .strict();

export const inboxV2EffectiveTenantLifecycleRuleSchema =
  inboxV2DataLifecycleRuleSchema
    .extend({
      tenantSelectedPeriod: inboxV2RetentionPeriodSchema.nullable(),
      tenantDecisionRef: inboxV2VersionedProfileReferenceSchema.nullable(),
      entitlementLongerMaximum: inboxV2RetentionPeriodSchema.nullable(),
      entitlementDecisionRef: inboxV2VersionedProfileReferenceSchema.nullable()
    })
    .strict()
    .superRefine((rule, context) => {
      if (
        (rule.tenantSelectedPeriod === null) !==
        (rule.tenantDecisionRef === null)
      ) {
        addIssue(
          context,
          ["tenantDecisionRef"],
          "Tenant retention period and decision reference must appear together."
        );
      }
      if (
        (rule.entitlementLongerMaximum === null) !==
        (rule.entitlementDecisionRef === null)
      ) {
        addIssue(
          context,
          ["entitlementDecisionRef"],
          "Entitlement maximum and decision reference must appear together."
        );
      }
      if (
        rule.baselineWindow.kind === "inherits_all_live_parents" &&
        rule.tenantSelectedPeriod !== null
      ) {
        addIssue(
          context,
          ["tenantSelectedPeriod"],
          "Parent-inherited rules cannot be replaced by a tenant duration."
        );
      }
    });

export const inboxV2EffectiveTenantPolicySchema = z
  .object({
    kind: z.literal("effective_tenant"),
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2DataLifecyclePolicyIdSchema,
    version: inboxV2EntityRevisionSchema,
    policyHash: inboxV2Sha256DigestSchema,
    dataLifecycleCatalogVersion: z.literal(
      INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION
    ),
    registryCompositionHash: inboxV2Sha256DigestSchema,
    templateRefs: z
      .array(inboxV2PolicyTemplateReferenceSchema)
      .min(1)
      .max(64)
      .superRefine((references, context) =>
        addCanonicalUniqueIssue(
          context,
          references.map(policyTemplateReferenceKey),
          "Effective-policy template references"
        )
      ),
    governanceContextRef: inboxV2DataGovernanceContextReferenceSchema,
    deploymentProfile: inboxV2DeploymentProfileSchema,
    effectiveAt: inboxV2TimestampSchema,
    rules: z
      .array(inboxV2EffectiveTenantLifecycleRuleSchema)
      .min(1)
      .max(2_048)
      .superRefine(addCanonicalRuleIssues)
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.governanceContextRef.tenantId !== policy.tenantId) {
      addIssue(
        context,
        ["governanceContextRef"],
        "Executable lifecycle policy and governance context must share a tenant."
      );
    }
    if (
      policy.policyHash !== calculateInboxV2EffectiveTenantPolicyHash(policy)
    ) {
      addIssue(
        context,
        ["policyHash"],
        "Effective policy hash must match its canonical executable content."
      );
    }
  });

export const inboxV2DataLifecyclePolicySchema = z.discriminatedUnion("kind", [
  inboxV2PolicyTemplateSchema,
  inboxV2EffectiveTenantPolicySchema
]);

export const inboxV2DataLifecyclePolicyEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_DATA_LIFECYCLE_POLICY_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2DataLifecyclePolicySchema
  );

const definedInboxV2PolicyTemplates = new WeakSet<object>();
const definedInboxV2EffectiveTenantPolicies = new WeakSet<object>();
const inboxV2GovernanceContextByEffectivePolicy = new WeakMap<
  object,
  InboxV2DataGovernanceContext
>();
const definedInboxV2PolicyImpactPreviews = new WeakSet<object>();
const definedInboxV2PolicyActivations = new WeakSet<object>();
const activatedInboxV2EffectiveTenantPolicies = new WeakSet<object>();
const inboxV2PolicyActivationByPolicy = new WeakMap<
  object,
  z.infer<typeof inboxV2PolicyActivationSchema>
>();

export type InboxV2PolicyActivationLedger = Readonly<{
  kind: "inbox_v2_policy_activation_ledger";
  id: string;
}>;

type InboxV2PolicyActivationLedgerState = {
  currentByPolicyKey: Map<string, InboxV2EffectiveTenantPolicy>;
  seenActivationKeys: Set<string>;
  knownPolicyReferences: Set<string>;
};

const definedInboxV2PolicyActivationLedgers = new WeakSet<object>();
const inboxV2PolicyActivationLedgerStates = new WeakMap<
  object,
  InboxV2PolicyActivationLedgerState
>();

/**
 * Stateful data-plane CAS boundary. A composition root must keep one ledger
 * instance for each authoritative policy store/transaction scope.
 */
export function defineInboxV2PolicyActivationLedger(input: {
  id: string;
}): InboxV2PolicyActivationLedger {
  const ledger = Object.freeze({
    kind: "inbox_v2_policy_activation_ledger" as const,
    id: inboxV2NamespacedIdSchema.parse(input.id)
  });
  definedInboxV2PolicyActivationLedgers.add(ledger);
  inboxV2PolicyActivationLedgerStates.set(ledger, {
    currentByPolicyKey: new Map(),
    seenActivationKeys: new Set(),
    knownPolicyReferences: new Set()
  });
  return ledger;
}

export function isInboxV2PolicyTemplate(
  value: unknown
): value is z.infer<typeof inboxV2PolicyTemplateSchema> {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2PolicyTemplates.has(value)
  );
}

/** True only for a frozen policy produced by the effective-policy resolver. */
export function isInboxV2EffectiveTenantPolicy(
  value: unknown
): value is z.infer<typeof inboxV2EffectiveTenantPolicySchema> {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2EffectiveTenantPolicies.has(value)
  );
}

export function isInboxV2ActivatedEffectiveTenantPolicy(
  value: unknown
): value is z.infer<typeof inboxV2EffectiveTenantPolicySchema> {
  return (
    isInboxV2EffectiveTenantPolicy(value) &&
    activatedInboxV2EffectiveTenantPolicies.has(value)
  );
}

export function getInboxV2EffectiveTenantPolicyGovernanceContext(
  policy: InboxV2EffectiveTenantPolicy
): InboxV2DataGovernanceContext | null {
  return inboxV2GovernanceContextByEffectivePolicy.get(policy) ?? null;
}

export function isInboxV2CurrentActivatedEffectiveTenantPolicy(input: {
  ledger: InboxV2PolicyActivationLedger;
  policy: unknown;
}): input is {
  ledger: InboxV2PolicyActivationLedger;
  policy: InboxV2EffectiveTenantPolicy;
} {
  if (
    !definedInboxV2PolicyActivationLedgers.has(input.ledger) ||
    !isInboxV2ActivatedEffectiveTenantPolicy(input.policy)
  ) {
    return false;
  }
  const state = inboxV2PolicyActivationLedgerStates.get(input.ledger);
  const key = `${input.policy.tenantId}\u0000${input.policy.id}`;
  return state?.currentByPolicyKey.get(key) === input.policy;
}

/**
 * Resolves the activation fence only while the exact policy object is still
 * current in the authoritative ledger. A retained reference to a superseded
 * policy therefore cannot be reused as destructive authority.
 */
export function getInboxV2CurrentPolicyActivationReference(input: {
  ledger: InboxV2PolicyActivationLedger;
  policy: InboxV2EffectiveTenantPolicy;
}): z.infer<typeof inboxV2PolicyActivationReferenceSchema> | null {
  if (!isInboxV2CurrentActivatedEffectiveTenantPolicy(input)) return null;
  const activation = inboxV2PolicyActivationByPolicy.get(input.policy);
  return activation === undefined ? null : activationReference(activation);
}

export function calculateInboxV2PolicyTemplateHash(input: {
  templateHash?: unknown;
  [key: string]: unknown;
}) {
  const { templateHash: _ignored, ...template } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.policy-template",
    hashVersion: "v1",
    template
  });
}

export function defineInboxV2PolicyTemplate(
  input: Omit<z.input<typeof inboxV2PolicyTemplateSchema>, "templateHash"> & {
    templateHash?: unknown;
  }
): z.infer<typeof inboxV2PolicyTemplateSchema> {
  const { templateHash: _ignored, ...template } = input;
  const defined = deepFreezePolicyValue(
    inboxV2PolicyTemplateSchema.parse({
      ...template,
      templateHash: calculateInboxV2PolicyTemplateHash(template)
    })
  );
  definedInboxV2PolicyTemplates.add(defined);
  return defined;
}

export function calculateInboxV2EffectiveTenantPolicyHash(input: {
  policyHash?: unknown;
  [key: string]: unknown;
}) {
  const { policyHash: _ignored, ...policy } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.effective-tenant-policy",
    hashVersion: "v1",
    policy
  });
}

export const inboxV2EffectiveTenantPolicyResolutionInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2DataLifecyclePolicyIdSchema,
    version: inboxV2EntityRevisionSchema,
    policyHash: inboxV2Sha256DigestSchema,
    effectiveAt: inboxV2TimestampSchema,
    templates: z.array(inboxV2PolicyTemplateSchema).min(1).max(64),
    governanceContext: inboxV2DataGovernanceContextSchema,
    tenantSelections: z.array(inboxV2TenantRetentionSelectionSchema).max(2_048),
    entitlementAllowances: z
      .array(inboxV2EntitlementRetentionAllowanceSchema)
      .max(2_048)
  })
  .strict();

export const inboxV2EffectiveTenantPolicyResolutionErrorCodeSchema = z.enum([
  "privacy.policy_invalid",
  "privacy.policy_tenant_mismatch",
  "privacy.governance_context_mismatch",
  "privacy.deployment_profile_mismatch",
  "privacy.jurisdiction_profile_missing",
  "privacy.policy_rule_conflict",
  "privacy.policy_rule_reference_invalid"
]);

export const inboxV2EffectiveTenantPolicyResolutionResultSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("resolved"),
        policy: inboxV2EffectiveTenantPolicySchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("rejected"),
        errorCode: inboxV2EffectiveTenantPolicyResolutionErrorCodeSchema
      })
      .strict()
  ]);

export const inboxV2PolicyRuleImpactDiffSchema = z
  .object({
    dataClassId: inboxV2DataClassIdSchema,
    purposeId: inboxV2ProcessingPurposeIdSchema,
    changeKind: z.enum(["added", "removed", "changed"]),
    retentionImpact: z.enum([
      "initial_bootstrap",
      "no_shortening",
      "potentially_shorter"
    ]),
    priorRuleHash: inboxV2Sha256DigestSchema.nullable(),
    candidateRuleHash: inboxV2Sha256DigestSchema.nullable()
  })
  .strict();

const inboxV2PolicyImpactSourceResultSchema = z
  .object({
    sourceSnapshot: z
      .object({
        streamEpoch: inboxV2StreamEpochSchema,
        syncGeneration: inboxV2SyncGenerationSchema,
        completeThroughPosition: inboxV2TenantStreamPositionSchema,
        snapshotHash: inboxV2Sha256DigestSchema
      })
      .strict(),
    affectedRootCount: inboxV2BigintCounterSchema,
    affectedByteCount: inboxV2BigintCounterSchema,
    heldRootCount: inboxV2BigintCounterSchema,
    backupCopyCount: inboxV2BigintCounterSchema,
    earliestDestructiveAt: inboxV2TimestampSchema.nullable(),
    resolvedAt: inboxV2TimestampSchema
  })
  .strict();

const inboxV2PolicyImpactActivationFenceResultSchema = z
  .object({
    outcome: z.enum(["matched", "changed"]),
    currentImpact: inboxV2PolicyImpactSourceResultSchema
  })
  .strict();

export const inboxV2PolicyImpactSourceProofSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    source: inboxV2VersionedProfileReferenceSchema,
    priorPolicy: inboxV2DataLifecyclePolicyReferenceSchema.nullable(),
    candidatePolicy: inboxV2DataLifecyclePolicyReferenceSchema,
    ruleDiffs: z.array(inboxV2PolicyRuleImpactDiffSchema).max(4_096),
    sourceSnapshot: inboxV2PolicyImpactSourceResultSchema.shape.sourceSnapshot,
    affectedRootCount: inboxV2BigintCounterSchema,
    affectedByteCount: inboxV2BigintCounterSchema,
    heldRootCount: inboxV2BigintCounterSchema,
    backupCopyCount: inboxV2BigintCounterSchema,
    earliestDestructiveAt: inboxV2TimestampSchema.nullable(),
    resolvedAt: inboxV2TimestampSchema,
    proofHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((proof, context) => {
    if (
      proof.candidatePolicy.tenantId !== proof.tenantId ||
      (proof.priorPolicy !== null &&
        proof.priorPolicy.tenantId !== proof.tenantId)
    ) {
      addIssue(context, [], "Policy impact source proof cannot cross tenants.");
    }
    if (
      proof.proofHash !== calculateInboxV2PolicyImpactSourceProofHash(proof)
    ) {
      addIssue(
        context,
        ["proofHash"],
        "Policy impact source proof hash must match its complete source result."
      );
    }
  });

export const inboxV2PolicyImpactPreviewSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2NamespacedIdSchema,
    revision: inboxV2EntityRevisionSchema,
    priorPolicy: inboxV2DataLifecyclePolicyReferenceSchema.nullable(),
    candidatePolicy: inboxV2DataLifecyclePolicyReferenceSchema,
    ruleDiffs: z
      .array(inboxV2PolicyRuleImpactDiffSchema)
      .max(4_096)
      .superRefine((diffs, context) =>
        addCanonicalUniqueIssue(
          context,
          diffs.map(policyRuleImpactKey),
          "Policy impact rule diffs"
        )
      ),
    hasPotentialShortening: z.boolean(),
    sourceSnapshot: z
      .object({
        streamEpoch: inboxV2StreamEpochSchema,
        syncGeneration: inboxV2SyncGenerationSchema,
        completeThroughPosition: inboxV2TenantStreamPositionSchema,
        snapshotHash: inboxV2Sha256DigestSchema
      })
      .strict(),
    affectedRootCount: inboxV2BigintCounterSchema,
    affectedByteCount: inboxV2BigintCounterSchema,
    heldRootCount: inboxV2BigintCounterSchema,
    backupCopyCount: inboxV2BigintCounterSchema,
    earliestDestructiveAt: inboxV2TimestampSchema.nullable(),
    previewedAt: inboxV2TimestampSchema,
    previewHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((preview, context) => {
    const hasPotentialShortening = preview.ruleDiffs.some(
      ({ retentionImpact }) => retentionImpact === "potentially_shorter"
    );
    if (
      preview.candidatePolicy.tenantId !== preview.tenantId ||
      (preview.priorPolicy !== null &&
        preview.priorPolicy.tenantId !== preview.tenantId)
    ) {
      addIssue(
        context,
        [],
        "Policy impact preview and both policy fences must share one tenant."
      );
    }
    if (
      preview.hasPotentialShortening !== hasPotentialShortening ||
      (hasPotentialShortening && preview.earliestDestructiveAt === null)
    ) {
      addIssue(
        context,
        ["hasPotentialShortening"],
        "Potential shortening requires an exact destructive impact time."
      );
    }
    if (
      preview.previewHash !== calculateInboxV2PolicyImpactPreviewHash(preview)
    ) {
      addIssue(
        context,
        ["previewHash"],
        "Policy impact preview hash must match its canonical diff and metrics."
      );
    }
  });

export const inboxV2PolicyActivationReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2NamespacedIdSchema,
    revision: inboxV2EntityRevisionSchema,
    activationHash: inboxV2Sha256DigestSchema
  })
  .strict();

const inboxV2PolicyActivationTransitionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("initial_reviewed_bootstrap"),
      expectedNoCurrentPolicy: z.literal(true),
      reviewedBootstrapProfile: inboxV2VersionedProfileReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("supersede_current"),
      priorPolicy: inboxV2DataLifecyclePolicyReferenceSchema,
      priorActivation: inboxV2PolicyActivationReferenceSchema,
      rollbackOfPolicy: inboxV2DataLifecyclePolicyReferenceSchema.nullable()
    })
    .strict()
]);

export const inboxV2PolicyActivationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2NamespacedIdSchema,
    revision: inboxV2EntityRevisionSchema,
    candidatePolicy: inboxV2DataLifecyclePolicyReferenceSchema,
    transition: inboxV2PolicyActivationTransitionSchema,
    impactPreview: inboxV2PolicyImpactPreviewSchema,
    requesterAuthorization: inboxV2AuthorizationDecisionReferenceSchema,
    approverAuthorization: inboxV2AuthorizationDecisionReferenceSchema,
    requestedAt: inboxV2TimestampSchema,
    approvedAt: inboxV2TimestampSchema,
    notBefore: inboxV2TimestampSchema,
    activatedAt: inboxV2TimestampSchema,
    reasonCode: inboxV2NamespacedIdSchema,
    activationHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((activation, context) => {
    if (
      activation.candidatePolicy.tenantId !== activation.tenantId ||
      activation.impactPreview.tenantId !== activation.tenantId ||
      activation.requesterAuthorization.tenantId !== activation.tenantId ||
      activation.approverAuthorization.tenantId !== activation.tenantId ||
      !isInboxV2TimestampOrderValidStrict(
        activation.requestedAt,
        activation.approvedAt
      ) ||
      !isInboxV2TimestampOrderValidStrict(
        activation.approvedAt,
        activation.notBefore
      ) ||
      Date.parse(activation.activatedAt) < Date.parse(activation.notBefore)
    ) {
      addIssue(
        context,
        [],
        "Policy activation requires one tenant and a non-zero approval/cooling fence."
      );
    }
    if (
      authorizationPrincipalKey(activation.requesterAuthorization) ===
      authorizationPrincipalKey(activation.approverAuthorization)
    ) {
      addIssue(
        context,
        ["approverAuthorization"],
        "Policy activation requester and approver must be different principals."
      );
    }
    if (
      activation.activationHash !==
      calculateInboxV2PolicyActivationHash(activation)
    ) {
      addIssue(
        context,
        ["activationHash"],
        "Policy activation hash must match its canonical fences."
      );
    }
  });

export const inboxV2PolicyActivationEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_DATA_LIFECYCLE_POLICY_ACTIVATION_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2PolicyActivationSchema
  );

export function calculateInboxV2PolicyImpactPreviewHash(input: {
  previewHash?: unknown;
  [key: string]: unknown;
}) {
  const { previewHash: _ignored, ...preview } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.policy-impact-preview",
    hashVersion: "v1",
    preview
  });
}

export function calculateInboxV2PolicyImpactSourceProofHash(input: {
  proofHash?: unknown;
  [key: string]: unknown;
}) {
  const { proofHash: _ignored, ...proof } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.policy-impact-source-proof",
    hashVersion: "v1",
    proof
  });
}

export function calculateInboxV2PolicyActivationHash(input: {
  activationHash?: unknown;
  [key: string]: unknown;
}) {
  const { activationHash: _ignored, ...activation } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.policy-activation",
    hashVersion: "v1",
    activation
  });
}

export type InboxV2PolicyImpactSource = Readonly<{
  id: string;
  version: string;
  loadCompleteImpact: (
    input: Readonly<{
      currentPolicy: InboxV2EffectiveTenantPolicy | null;
      candidatePolicy: InboxV2EffectiveTenantPolicy;
      ruleDiffs: readonly z.infer<typeof inboxV2PolicyRuleImpactDiffSchema>[];
    }>
  ) => z.input<typeof inboxV2PolicyImpactSourceResultSchema>;
  compareAndSetActivationImpact: (
    input: Readonly<{
      currentPolicy: InboxV2EffectiveTenantPolicy | null;
      candidatePolicy: InboxV2EffectiveTenantPolicy;
      ruleDiffs: readonly z.infer<typeof inboxV2PolicyRuleImpactDiffSchema>[];
      expectedProofHash: string;
      expectedSourceSnapshot: z.infer<
        typeof inboxV2PolicyImpactSourceResultSchema
      >["sourceSnapshot"];
      activatedAt: string;
    }>
  ) => z.input<typeof inboxV2PolicyImpactActivationFenceResultSchema>;
}>;

const definedInboxV2PolicyImpactSources = new WeakSet<object>();
const definedInboxV2PolicyImpactSourceProofs = new WeakSet<object>();
const inboxV2PolicyImpactSourceByProof = new WeakMap<
  object,
  InboxV2PolicyImpactSource
>();
const inboxV2PolicyImpactProofByPreview = new WeakMap<
  object,
  z.infer<typeof inboxV2PolicyImpactSourceProofSchema>
>();

/** Registers the server-owned complete impact loader used by activation. */
export function defineInboxV2PolicyImpactSource(input: {
  id: string;
  version: string;
  loadCompleteImpact: InboxV2PolicyImpactSource["loadCompleteImpact"];
  compareAndSetActivationImpact: InboxV2PolicyImpactSource["compareAndSetActivationImpact"];
}): InboxV2PolicyImpactSource {
  const reference = inboxV2VersionedProfileReferenceSchema.parse({
    id: input.id,
    version: input.version
  });
  const source = Object.freeze({
    ...reference,
    loadCompleteImpact: input.loadCompleteImpact,
    compareAndSetActivationImpact: input.compareAndSetActivationImpact
  });
  definedInboxV2PolicyImpactSources.add(source);
  return source;
}

export function resolveInboxV2PolicyImpactSourceProof(input: {
  source: InboxV2PolicyImpactSource;
  currentPolicy: InboxV2EffectiveTenantPolicy | null;
  candidatePolicy: InboxV2EffectiveTenantPolicy;
}): z.infer<typeof inboxV2PolicyImpactSourceProofSchema> {
  if (
    !definedInboxV2PolicyImpactSources.has(input.source) ||
    !isInboxV2EffectiveTenantPolicy(input.candidatePolicy) ||
    (input.currentPolicy !== null &&
      !isInboxV2ActivatedEffectiveTenantPolicy(input.currentPolicy))
  ) {
    throw new Error(
      "Policy impact proof requires a trusted source and authentic policies."
    );
  }
  const ruleDiffs = deriveInboxV2PolicyRuleImpactDiffs(
    input.currentPolicy,
    input.candidatePolicy
  );
  const result = inboxV2PolicyImpactSourceResultSchema.parse(
    input.source.loadCompleteImpact({
      currentPolicy: input.currentPolicy,
      candidatePolicy: input.candidatePolicy,
      ruleDiffs
    })
  );
  if (
    ruleDiffs.some(
      ({ retentionImpact }) => retentionImpact === "potentially_shorter"
    ) &&
    result.earliestDestructiveAt === null
  ) {
    throw new Error(
      "A complete shortening impact proof requires earliest destructive time."
    );
  }
  const body = {
    tenantId: input.candidatePolicy.tenantId,
    source: { id: input.source.id, version: input.source.version },
    priorPolicy:
      input.currentPolicy === null
        ? null
        : policyReference(input.currentPolicy),
    candidatePolicy: policyReference(input.candidatePolicy),
    ruleDiffs,
    ...result
  } as const;
  const proof = deepFreezePolicyValue(
    inboxV2PolicyImpactSourceProofSchema.parse({
      ...body,
      proofHash: calculateInboxV2PolicyImpactSourceProofHash(body)
    })
  );
  definedInboxV2PolicyImpactSourceProofs.add(proof);
  inboxV2PolicyImpactSourceByProof.set(proof, input.source);
  return proof;
}

export function defineInboxV2PolicyImpactPreview(input: {
  currentPolicy: InboxV2EffectiveTenantPolicy | null;
  candidatePolicy: InboxV2EffectiveTenantPolicy;
  sourceProof: z.infer<typeof inboxV2PolicyImpactSourceProofSchema>;
  preview: Omit<
    z.input<typeof inboxV2PolicyImpactPreviewSchema>,
    | "priorPolicy"
    | "candidatePolicy"
    | "ruleDiffs"
    | "hasPotentialShortening"
    | "sourceSnapshot"
    | "affectedRootCount"
    | "affectedByteCount"
    | "heldRootCount"
    | "backupCopyCount"
    | "earliestDestructiveAt"
    | "previewHash"
  >;
}): z.infer<typeof inboxV2PolicyImpactPreviewSchema> {
  if (
    !isInboxV2EffectiveTenantPolicy(input.candidatePolicy) ||
    (input.currentPolicy !== null &&
      !isInboxV2ActivatedEffectiveTenantPolicy(input.currentPolicy))
  ) {
    throw new Error(
      "Policy impact preview requires an authentic candidate and current activated policy."
    );
  }
  if (!definedInboxV2PolicyImpactSourceProofs.has(input.sourceProof)) {
    throw new Error(
      "Policy impact preview requires an authentic complete source proof."
    );
  }
  const ruleDiffs = deriveInboxV2PolicyRuleImpactDiffs(
    input.currentPolicy,
    input.candidatePolicy
  );
  const previewBody = {
    ...input.preview,
    priorPolicy:
      input.currentPolicy === null
        ? null
        : policyReference(input.currentPolicy),
    candidatePolicy: policyReference(input.candidatePolicy),
    ruleDiffs,
    sourceSnapshot: input.sourceProof.sourceSnapshot,
    affectedRootCount: input.sourceProof.affectedRootCount,
    affectedByteCount: input.sourceProof.affectedByteCount,
    heldRootCount: input.sourceProof.heldRootCount,
    backupCopyCount: input.sourceProof.backupCopyCount,
    earliestDestructiveAt: input.sourceProof.earliestDestructiveAt,
    hasPotentialShortening: ruleDiffs.some(
      ({ retentionImpact }) => retentionImpact === "potentially_shorter"
    )
  } as const;
  if (
    !samePolicyReference(
      input.sourceProof.candidatePolicy,
      previewBody.candidatePolicy
    ) ||
    canonicalJson(input.sourceProof.priorPolicy) !==
      canonicalJson(previewBody.priorPolicy) ||
    canonicalJson(input.sourceProof.ruleDiffs) !== canonicalJson(ruleDiffs) ||
    Date.parse(input.sourceProof.resolvedAt) >
      Date.parse(input.preview.previewedAt)
  ) {
    throw new Error(
      "Policy impact preview does not match its complete source proof."
    );
  }
  const preview = deepFreezePolicyValue(
    inboxV2PolicyImpactPreviewSchema.parse({
      ...previewBody,
      previewHash: calculateInboxV2PolicyImpactPreviewHash(previewBody)
    })
  );
  definedInboxV2PolicyImpactPreviews.add(preview);
  inboxV2PolicyImpactProofByPreview.set(preview, input.sourceProof);
  return preview;
}

type InboxV2PolicyActivationTransitionInput =
  | {
      kind: "initial_reviewed_bootstrap";
      reviewedBootstrapProfile: z.input<
        typeof inboxV2VersionedProfileReferenceSchema
      >;
    }
  | {
      kind: "supersede_current";
      rollbackOfPolicy: z.input<
        typeof inboxV2DataLifecyclePolicyReferenceSchema
      > | null;
    };

export function activateInboxV2EffectiveTenantPolicy(input: {
  ledger: InboxV2PolicyActivationLedger;
  currentPolicy: InboxV2EffectiveTenantPolicy | null;
  candidatePolicy: InboxV2EffectiveTenantPolicy;
  impactPreview: z.infer<typeof inboxV2PolicyImpactPreviewSchema>;
  transition: InboxV2PolicyActivationTransitionInput;
  activation: Omit<
    z.input<typeof inboxV2PolicyActivationSchema>,
    "candidatePolicy" | "transition" | "impactPreview" | "activationHash"
  >;
}): Readonly<{
  policy: InboxV2EffectiveTenantPolicy;
  activation: z.infer<typeof inboxV2PolicyActivationSchema>;
}> {
  const { currentPolicy, candidatePolicy, impactPreview } = input;
  if (!definedInboxV2PolicyActivationLedgers.has(input.ledger)) {
    throw new Error("Policy activation requires an authentic stateful ledger.");
  }
  const ledgerState = inboxV2PolicyActivationLedgerStates.get(input.ledger)!;
  const policyKey = `${candidatePolicy.tenantId}\u0000${candidatePolicy.id}`;
  const authoritativeCurrent =
    ledgerState.currentByPolicyKey.get(policyKey) ?? null;
  if (
    !isInboxV2EffectiveTenantPolicy(candidatePolicy) ||
    activatedInboxV2EffectiveTenantPolicies.has(candidatePolicy) ||
    !definedInboxV2PolicyImpactPreviews.has(impactPreview)
  ) {
    throw new Error(
      "Policy activation requires a fresh resolved candidate and authentic preview."
    );
  }
  const candidateRef = policyReference(candidatePolicy);
  if (
    !samePolicyReference(impactPreview.candidatePolicy, candidateRef) ||
    input.activation.tenantId !== candidatePolicy.tenantId
  ) {
    throw new Error(
      "Policy activation candidate and preview fence do not match."
    );
  }

  let transition: z.infer<typeof inboxV2PolicyActivationTransitionSchema>;
  if (input.transition.kind === "initial_reviewed_bootstrap") {
    if (
      authoritativeCurrent !== null ||
      currentPolicy !== null ||
      impactPreview.priorPolicy !== null
    ) {
      throw new Error(
        "Reviewed bootstrap requires an explicit empty current-policy fence."
      );
    }
    transition = {
      kind: "initial_reviewed_bootstrap",
      expectedNoCurrentPolicy: true,
      reviewedBootstrapProfile: inboxV2VersionedProfileReferenceSchema.parse(
        input.transition.reviewedBootstrapProfile
      )
    };
  } else {
    if (
      currentPolicy === null ||
      authoritativeCurrent !== currentPolicy ||
      !isInboxV2ActivatedEffectiveTenantPolicy(currentPolicy) ||
      currentPolicy.tenantId !== candidatePolicy.tenantId ||
      currentPolicy.id !== candidatePolicy.id ||
      BigInt(candidatePolicy.version) <= BigInt(currentPolicy.version) ||
      impactPreview.priorPolicy === null ||
      !samePolicyReference(
        impactPreview.priorPolicy,
        policyReference(currentPolicy)
      )
    ) {
      throw new Error(
        "Policy supersession requires the exact current activated revision."
      );
    }
    const priorActivation = inboxV2PolicyActivationByPolicy.get(currentPolicy);
    if (priorActivation === undefined) {
      throw new Error("Current policy activation fence is unavailable.");
    }
    if (
      input.transition.rollbackOfPolicy !== null &&
      (input.transition.rollbackOfPolicy.tenantId !==
        candidatePolicy.tenantId ||
        input.transition.rollbackOfPolicy.id !== candidatePolicy.id ||
        !ledgerState.knownPolicyReferences.has(
          policyReferenceKey(input.transition.rollbackOfPolicy)
        ))
    ) {
      throw new Error(
        "Rollback fence must reference the same tenant policy lineage."
      );
    }
    transition = {
      kind: "supersede_current",
      priorPolicy: policyReference(currentPolicy),
      priorActivation: activationReference(priorActivation),
      rollbackOfPolicy:
        input.transition.rollbackOfPolicy === null
          ? null
          : inboxV2DataLifecyclePolicyReferenceSchema.parse(
              input.transition.rollbackOfPolicy
            )
    };
  }

  const activationBody = {
    ...input.activation,
    candidatePolicy: candidateRef,
    transition,
    impactPreview
  } as const;
  if (
    Date.parse(impactPreview.previewedAt) >
    Date.parse(input.activation.requestedAt)
  ) {
    throw new Error(
      "Policy impact preview must be complete before activation is requested."
    );
  }
  const activation = deepFreezePolicyValue(
    inboxV2PolicyActivationSchema.parse({
      ...activationBody,
      activationHash: calculateInboxV2PolicyActivationHash(activationBody)
    })
  );
  const activationKey = `${activation.tenantId}\u0000${activation.id}\u0000${activation.revision}`;
  if (ledgerState.seenActivationKeys.has(activationKey)) {
    throw new Error("Policy activation ID/revision has already been consumed.");
  }
  for (const [authorization, checkedAt] of [
    [activation.requesterAuthorization, activation.requestedAt],
    [activation.approverAuthorization, activation.approvedAt],
    [activation.requesterAuthorization, activation.activatedAt],
    [activation.approverAuthorization, activation.activatedAt]
  ] as const) {
    if (
      !isPolicyActivationAuthorizationValid({
        decision: authorization,
        policy: candidatePolicy,
        checkedAt
      })
    ) {
      throw new Error(
        "Policy activation authorization is stale or outside the exact policy scope."
      );
    }
  }

  const impactProof = inboxV2PolicyImpactProofByPreview.get(impactPreview);
  const impactSource =
    impactProof === undefined
      ? undefined
      : inboxV2PolicyImpactSourceByProof.get(impactProof);
  if (impactProof === undefined || impactSource === undefined) {
    throw new Error(
      "Policy activation requires the authentic preview impact-source lineage."
    );
  }
  const activationImpactFence =
    inboxV2PolicyImpactActivationFenceResultSchema.parse(
      impactSource.compareAndSetActivationImpact({
        currentPolicy,
        candidatePolicy,
        ruleDiffs: impactPreview.ruleDiffs,
        expectedProofHash: impactProof.proofHash,
        expectedSourceSnapshot: impactProof.sourceSnapshot,
        activatedAt: activation.activatedAt
      })
    );
  const currentImpact = activationImpactFence.currentImpact;
  if (
    activationImpactFence.outcome !== "matched" ||
    currentImpact.resolvedAt !== activation.activatedAt ||
    canonicalJson(currentImpact.sourceSnapshot) !==
      canonicalJson(impactProof.sourceSnapshot) ||
    currentImpact.affectedRootCount !== impactProof.affectedRootCount ||
    currentImpact.affectedByteCount !== impactProof.affectedByteCount ||
    currentImpact.heldRootCount !== impactProof.heldRootCount ||
    currentImpact.backupCopyCount !== impactProof.backupCopyCount ||
    currentImpact.earliestDestructiveAt !== impactProof.earliestDestructiveAt
  ) {
    throw new Error(
      "Policy activation impact changed after review; a fresh complete preview and cooling cycle are required."
    );
  }

  if (currentPolicy !== null) {
    activatedInboxV2EffectiveTenantPolicies.delete(currentPolicy);
  }
  definedInboxV2PolicyActivations.add(activation);
  activatedInboxV2EffectiveTenantPolicies.add(candidatePolicy);
  inboxV2PolicyActivationByPolicy.set(candidatePolicy, activation);
  ledgerState.seenActivationKeys.add(activationKey);
  ledgerState.knownPolicyReferences.add(policyReferenceKey(candidateRef));
  ledgerState.currentByPolicyKey.set(policyKey, candidatePolicy);
  return deepFreezePolicyValue({ policy: candidatePolicy, activation });
}

/**
 * Deterministically composes reviewed templates into a tenant-scoped policy.
 * Templates remain non-executable and no mutable registry/global state is read.
 */
export function resolveInboxV2EffectiveTenantPolicy(
  input: unknown
): InboxV2EffectiveTenantPolicyResolutionResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return rejectedResolution("privacy.policy_invalid");
  }
  const { registry, ...serializableInput } = input as Record<string, unknown>;
  const rawTemplates = serializableInput.templates;
  const authenticGovernanceContext = serializableInput.governanceContext;
  if (
    !isInboxV2DataGovernanceContext(authenticGovernanceContext) ||
    !Array.isArray(rawTemplates) ||
    !rawTemplates.every(isInboxV2PolicyTemplate)
  ) {
    return rejectedResolution("privacy.policy_invalid");
  }
  const parsed =
    inboxV2EffectiveTenantPolicyResolutionInputSchema.safeParse(
      serializableInput
    );
  if (!parsed.success || !isInboxV2DataLifecycleRegistry(registry)) {
    return rejectedResolution("privacy.policy_invalid");
  }
  const request = parsed.data;
  const lifecycleRegistry = registry;
  const governance = request.governanceContext;
  if (request.tenantId !== governance.tenantId) {
    return rejectedResolution("privacy.policy_tenant_mismatch");
  }
  if (Date.parse(request.effectiveAt) < Date.parse(governance.effectiveAt)) {
    return rejectedResolution("privacy.governance_context_mismatch");
  }
  if (Date.parse(request.effectiveAt) >= Date.parse(governance.reviewAt)) {
    return rejectedResolution("privacy.governance_context_mismatch");
  }

  const governanceJurisdictions = new Set(
    governance.jurisdictionProfiles.map(versionedReferenceKey)
  );
  const governedPurposes = new Set(
    governance.rolesByPurpose.map(({ purposeId }) => String(purposeId))
  );
  const templateByReference = new Map<string, InboxV2PolicyTemplate>();
  const rules = new Map<string, InboxV2DataLifecycleRule>();
  const coveredJurisdictions = new Set<string>();

  for (const template of request.templates) {
    if (template.deploymentProfile !== governance.deploymentProfile) {
      return rejectedResolution("privacy.deployment_profile_mismatch");
    }
    if (
      template.jurisdictionProfiles.some(
        (reference) =>
          !governanceJurisdictions.has(versionedReferenceKey(reference))
      )
    ) {
      return rejectedResolution("privacy.jurisdiction_profile_missing");
    }
    for (const reference of template.jurisdictionProfiles) {
      coveredJurisdictions.add(versionedReferenceKey(reference));
    }
    if (Date.parse(template.effectiveAt) > Date.parse(request.effectiveAt)) {
      return rejectedResolution("privacy.policy_invalid");
    }
    if (Date.parse(request.effectiveAt) >= Date.parse(template.reviewAt)) {
      return rejectedResolution("privacy.policy_invalid");
    }
    const templateReferenceKey = policyTemplateReferenceKey(template);
    if (templateByReference.has(templateReferenceKey)) {
      return rejectedResolution("privacy.policy_rule_conflict");
    }
    templateByReference.set(templateReferenceKey, template);

    for (const rule of template.rules) {
      if (!governedPurposes.has(String(rule.purposeId))) {
        return rejectedResolution("privacy.governance_context_mismatch");
      }
      const definition = resolveRegistryDataClassDefinition(
        lifecycleRegistry,
        rule.dataClassId
      );
      if (
        definition === null ||
        !definition.allowedPurposeIds.includes(rule.purposeId) ||
        definition.canonicalAnchorId !== rule.retentionAnchorId ||
        !definition.allowedExpiryActions.includes(rule.actionAtExpiry) ||
        definition.holdEligible !== rule.holdEligible ||
        !registryRuleMatchesSafetyEnvelope(lifecycleRegistry, rule) ||
        (definition.parentBehavior === "inherits_all_live_parents") !==
          (rule.baselineWindow.kind === "inherits_all_live_parents") ||
        (rule.baselineWindow.kind === "until_condition_then_period" &&
          !registryHasLifecycleHandler(
            lifecycleRegistry,
            rule.baselineWindow.condition.resolverHandlerId,
            "condition_resolution"
          ))
      ) {
        return rejectedResolution("privacy.policy_rule_reference_invalid");
      }
      const key = lifecycleRuleKey(rule);
      if (rules.has(key)) {
        return rejectedResolution("privacy.policy_rule_conflict");
      }
      rules.set(key, rule);
    }
  }

  if (
    coveredJurisdictions.size !== governanceJurisdictions.size ||
    [...governanceJurisdictions].some(
      (reference) => !coveredJurisdictions.has(reference)
    )
  ) {
    return rejectedResolution("privacy.jurisdiction_profile_missing");
  }
  if (!registryDataUsesHaveRuleCoverage(lifecycleRegistry, rules)) {
    return rejectedResolution("privacy.policy_rule_reference_invalid");
  }

  const rulesByIdentity = new Map(
    [...rules.values()].map((rule) => [retentionRuleReferenceKey(rule), rule])
  );
  if (rulesByIdentity.size !== rules.size) {
    return rejectedResolution("privacy.policy_rule_conflict");
  }
  const selections = mapRuleOverrides(
    request.tenantSelections,
    rulesByIdentity
  );
  const allowances = mapRuleOverrides(
    request.entitlementAllowances,
    rulesByIdentity
  );
  if (selections === null || allowances === null) {
    return rejectedResolution("privacy.policy_rule_reference_invalid");
  }

  const effectiveRules = [...rules.values()]
    .sort((left, right) =>
      lifecycleRuleKey(left).localeCompare(lifecycleRuleKey(right))
    )
    .map((rule) => {
      const key = retentionRuleReferenceKey(rule);
      const selection = selections.get(key) ?? null;
      const allowance = allowances.get(key) ?? null;
      return {
        ...rule,
        tenantSelectedPeriod: selection?.selectedPeriod ?? null,
        tenantDecisionRef: selection?.decisionRef ?? null,
        entitlementLongerMaximum: allowance?.optionalLongerMaximum ?? null,
        entitlementDecisionRef: allowance?.decisionRef ?? null
      };
    });

  const policyBody = {
    kind: "effective_tenant",
    tenantId: request.tenantId,
    id: request.id,
    version: request.version,
    dataLifecycleCatalogVersion: INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    registryCompositionHash: lifecycleRegistry.compositionHash,
    templateRefs: [...templateByReference.values()]
      .map((template) => ({
        id: template.id,
        version: template.version,
        templateHash: template.templateHash
      }))
      .sort((left, right) =>
        policyTemplateReferenceKey(left).localeCompare(
          policyTemplateReferenceKey(right)
        )
      ),
    governanceContextRef: governanceReference(governance),
    deploymentProfile: governance.deploymentProfile,
    effectiveAt: request.effectiveAt,
    rules: effectiveRules
  } as const;
  const policy = inboxV2EffectiveTenantPolicySchema.safeParse({
    ...policyBody,
    policyHash: calculateInboxV2EffectiveTenantPolicyHash(policyBody)
  });

  if (!policy.success) {
    return rejectedResolution("privacy.policy_invalid");
  }
  const authenticPolicy = deepFreezePolicyValue(policy.data);
  definedInboxV2EffectiveTenantPolicies.add(authenticPolicy);
  inboxV2GovernanceContextByEffectivePolicy.set(
    authenticPolicy,
    authenticGovernanceContext
  );
  return { kind: "resolved", policy: authenticPolicy };
}

const resolvedConditionSchema = z
  .object({
    state: z.literal("resolved"),
    conditionId: inboxV2NamespacedIdSchema,
    conditionVersion: inboxV2EntityRevisionSchema,
    resolverHandlerId: inboxV2LifecycleHandlerIdSchema,
    resolutionRevision: inboxV2EntityRevisionSchema,
    evidenceHash: inboxV2Sha256DigestSchema,
    resolvedAt: inboxV2TimestampSchema
  })
  .strict();

const unresolvedConditionSchema = z
  .object({
    state: z.literal("unresolved"),
    conditionId: inboxV2NamespacedIdSchema,
    conditionVersion: inboxV2EntityRevisionSchema,
    resolverHandlerId: inboxV2LifecycleHandlerIdSchema,
    resolutionRevision: inboxV2EntityRevisionSchema,
    evidenceHash: inboxV2Sha256DigestSchema,
    reviewedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2ParentLifecycleDeadlineSchema = z
  .object({
    parent: inboxV2EntityKeySchema,
    parentRevision: inboxV2EntityRevisionSchema,
    eligibleAt: inboxV2TimestampSchema,
    policyRef: inboxV2DataLifecyclePolicyReferenceSchema,
    decisionHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2ParentDeadlineSnapshotSchema = z
  .object({
    child: inboxV2EntityKeySchema,
    childRevision: inboxV2EntityRevisionSchema,
    lineageRevision: inboxV2EntityRevisionSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    completeThroughPosition: inboxV2TenantStreamPositionSchema,
    completeness: z.literal("all_live_parents"),
    resolverHandlerId: inboxV2LifecycleHandlerIdSchema,
    resolverVersion: inboxV2EntityRevisionSchema,
    resolvedAt: inboxV2TimestampSchema,
    snapshotHash: inboxV2Sha256DigestSchema,
    parentSet: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("live_parents"),
          parents: z
            .array(inboxV2ParentLifecycleDeadlineSchema)
            .min(1)
            .max(4_096)
            .superRefine((parents, context) =>
              addCanonicalUniqueIssue(
                context,
                parents.map(({ parent }) => entityKey(parent)),
                "Live parent deadlines"
              )
            )
        })
        .strict(),
      z
        .object({
          kind: z.literal("no_live_parents"),
          detachedAt: inboxV2TimestampSchema,
          lastParentSetRevision: inboxV2EntityRevisionSchema
        })
        .strict()
    ])
  })
  .strict();

export const inboxV2LifecyclePurposeInstanceSchema = z
  .object({
    purposeId: inboxV2ProcessingPurposeIdSchema,
    ruleId: inboxV2RetentionRuleIdSchema,
    ruleRevision: inboxV2EntityRevisionSchema,
    anchorAt: inboxV2TimestampSchema,
    condition: z
      .discriminatedUnion("state", [
        resolvedConditionSchema,
        unresolvedConditionSchema
      ])
      .nullable(),
    parentDeadlineSnapshot: inboxV2ParentDeadlineSnapshotSchema.nullable()
  })
  .strict();

const inboxV2LifecycleControlSourceResultSchema = z
  .object({
    sourceState: z
      .object({
        streamEpoch: inboxV2StreamEpochSchema,
        syncGeneration: inboxV2SyncGenerationSchema,
        completeThroughPosition: inboxV2TenantStreamPositionSchema,
        purposeSetRevision: inboxV2EntityRevisionSchema,
        legalHoldSetRevision: inboxV2EntityRevisionSchema,
        restrictionSetRevision: inboxV2EntityRevisionSchema,
        sourceStateHash: inboxV2Sha256DigestSchema
      })
      .strict(),
    purposes: z.array(inboxV2LifecyclePurposeInstanceSchema).min(1).max(256),
    holds: z.array(inboxV2LegalHoldSchema).max(256),
    restrictions: z.array(inboxV2ProcessingRestrictionSchema).max(256),
    resolvedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2LifecycleControlSourceProofSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    source: inboxV2VersionedProfileReferenceSchema,
    registryCompositionHash: inboxV2Sha256DigestSchema,
    policy: inboxV2DataLifecyclePolicyReferenceSchema,
    target: inboxV2PrivacyControlTargetSchema,
    sourceState: inboxV2LifecycleControlSourceResultSchema.shape.sourceState,
    purposes: z.array(inboxV2LifecyclePurposeInstanceSchema).min(1).max(256),
    holds: z.array(inboxV2LegalHoldSchema).max(256),
    restrictions: z.array(inboxV2ProcessingRestrictionSchema).max(256),
    resolvedAt: inboxV2TimestampSchema,
    proofHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((proof, context) => {
    if (
      proof.policy.tenantId !== proof.tenantId ||
      proof.target.tenantId !== proof.tenantId ||
      proof.holds.some(({ tenantId }) => tenantId !== proof.tenantId) ||
      proof.restrictions.some(({ tenantId }) => tenantId !== proof.tenantId)
    ) {
      addIssue(
        context,
        [],
        "Lifecycle control source proof cannot cross tenants."
      );
    }
    if (
      proof.proofHash !== calculateInboxV2LifecycleControlSourceProofHash(proof)
    ) {
      addIssue(
        context,
        ["proofHash"],
        "Lifecycle control source proof hash must match its complete loaded sets."
      );
    }
  });

export const inboxV2LifecycleControlSnapshotSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2NamespacedIdSchema,
    revision: inboxV2EntityRevisionSchema,
    policy: inboxV2DataLifecyclePolicyReferenceSchema,
    target: inboxV2PrivacyControlTargetSchema,
    sourceState: z
      .object({
        streamEpoch: inboxV2StreamEpochSchema,
        syncGeneration: inboxV2SyncGenerationSchema,
        completeThroughPosition: inboxV2TenantStreamPositionSchema,
        purposeSetRevision: inboxV2EntityRevisionSchema,
        legalHoldSetRevision: inboxV2EntityRevisionSchema,
        restrictionSetRevision: inboxV2EntityRevisionSchema,
        sourceStateHash: inboxV2Sha256DigestSchema
      })
      .strict(),
    purposeCompleteness: z.literal("all_active_purposes_for_target"),
    controlCompleteness: z.literal("all_relevant_controls_at_high_water"),
    purposes: z
      .array(inboxV2LifecyclePurposeInstanceSchema)
      .min(1)
      .max(256)
      .superRefine((purposes, context) =>
        addCanonicalUniqueIssue(
          context,
          purposes.map(purposeInstanceKey),
          "Lifecycle snapshot purpose instances"
        )
      ),
    holds: z
      .array(inboxV2LegalHoldSchema)
      .max(256)
      .superRefine((holds, context) =>
        addUniqueControlRevisionIssues(
          context,
          holds.map(({ id }) => String(id)),
          "Lifecycle snapshot legal holds"
        )
      ),
    restrictions: z
      .array(inboxV2ProcessingRestrictionSchema)
      .max(256)
      .superRefine((restrictions, context) =>
        addUniqueControlRevisionIssues(
          context,
          restrictions.map(({ id }) => String(id)),
          "Lifecycle snapshot processing restrictions"
        )
      ),
    capturedAt: inboxV2TimestampSchema,
    snapshotHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      snapshot.policy.tenantId !== snapshot.tenantId ||
      snapshot.target.tenantId !== snapshot.tenantId ||
      snapshot.holds.some(({ tenantId }) => tenantId !== snapshot.tenantId) ||
      snapshot.restrictions.some(
        ({ tenantId }) => tenantId !== snapshot.tenantId
      )
    ) {
      addIssue(
        context,
        [],
        "Lifecycle control snapshot cannot cross tenant boundaries."
      );
    }
    if (
      snapshot.snapshotHash !==
      calculateInboxV2LifecycleControlSnapshotHash(snapshot)
    ) {
      addIssue(
        context,
        ["snapshotHash"],
        "Lifecycle control snapshot hash must match every purpose/control high-water."
      );
    }
  });

export const inboxV2LifecycleControlSnapshotReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2NamespacedIdSchema,
    revision: inboxV2EntityRevisionSchema,
    snapshotHash: inboxV2Sha256DigestSchema,
    capturedAt: inboxV2TimestampSchema,
    sourceState: inboxV2LifecycleControlSnapshotSchema.shape.sourceState
  })
  .strict();

export type InboxV2LifecycleControlSource = Readonly<{
  id: string;
  version: string;
  loadCompleteControlState: (
    input: Readonly<{
      policy: InboxV2EffectiveTenantPolicy;
      target: z.infer<typeof inboxV2PrivacyControlTargetSchema>;
      capturedAt: string;
    }>
  ) => z.input<typeof inboxV2LifecycleControlSourceResultSchema>;
}>;

const definedInboxV2LifecycleControlSources = new WeakSet<object>();
const definedInboxV2LifecycleControlSourceProofs = new WeakSet<object>();
const definedInboxV2LifecycleControlSnapshots = new WeakSet<object>();

/** Registers the server-owned loader for complete active purpose/control sets. */
export function defineInboxV2LifecycleControlSource(input: {
  id: string;
  version: string;
  loadCompleteControlState: InboxV2LifecycleControlSource["loadCompleteControlState"];
}): InboxV2LifecycleControlSource {
  const reference = inboxV2VersionedProfileReferenceSchema.parse({
    id: input.id,
    version: input.version
  });
  const source = Object.freeze({
    ...reference,
    loadCompleteControlState: input.loadCompleteControlState
  });
  definedInboxV2LifecycleControlSources.add(source);
  return source;
}

export function calculateInboxV2LifecycleControlSourceProofHash(input: {
  proofHash?: unknown;
  [key: string]: unknown;
}) {
  const { proofHash: _ignored, ...proof } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.lifecycle-control-source-proof",
    hashVersion: "v1",
    proof
  });
}

export function resolveInboxV2LifecycleControlSourceProof(input: {
  source: InboxV2LifecycleControlSource;
  registry: InboxV2DataLifecycleRegistry;
  policy: InboxV2EffectiveTenantPolicy;
  target: z.input<typeof inboxV2PrivacyControlTargetSchema>;
  capturedAt: string;
}): z.infer<typeof inboxV2LifecycleControlSourceProofSchema> {
  if (
    !definedInboxV2LifecycleControlSources.has(input.source) ||
    !isInboxV2DataLifecycleRegistry(input.registry) ||
    !isInboxV2ActivatedEffectiveTenantPolicy(input.policy)
  ) {
    throw new Error(
      "Lifecycle controls require a trusted complete-state source."
    );
  }
  const target = inboxV2PrivacyControlTargetSchema.parse(input.target);
  const capturedAt = inboxV2TimestampSchema.parse(input.capturedAt);
  if (target.tenantId !== input.policy.tenantId) {
    throw new Error(
      "Lifecycle control source target crosses the policy tenant."
    );
  }
  const loaded = input.source.loadCompleteControlState({
    policy: input.policy,
    target,
    capturedAt
  });
  const result = inboxV2LifecycleControlSourceResultSchema.parse(loaded);
  if (result.resolvedAt !== capturedAt) {
    throw new Error(
      "Lifecycle control source proof must be current at evaluation time."
    );
  }
  const rules = new Map(
    input.policy.rules
      .filter((rule) => rule.dataClassId === target.dataClassId)
      .map((rule) => [retentionRuleReferenceKey(rule), rule])
  );
  const purposes = result.purposes.map((purpose) => {
    const rule = rules.get(retentionRuleReferenceKey(purpose));
    if (rule === undefined || rule.purposeId !== purpose.purposeId) {
      throw new Error("Lifecycle source returned an unpinned active purpose.");
    }
    return purpose;
  });
  const holds = loaded.holds.map((hold) =>
    defineInboxV2LegalHold({ hold, registry: input.registry })
  );
  const restrictions = loaded.restrictions.map((restriction) =>
    defineInboxV2ProcessingRestriction({
      restriction,
      registry: input.registry
    })
  );
  const body = {
    tenantId: input.policy.tenantId,
    source: { id: input.source.id, version: input.source.version },
    registryCompositionHash: input.registry.compositionHash,
    policy: policyReference(input.policy),
    target,
    sourceState: result.sourceState,
    purposes,
    holds,
    restrictions,
    resolvedAt: result.resolvedAt
  } as const;
  const parsedProof = inboxV2LifecycleControlSourceProofSchema.parse({
    ...body,
    proofHash: calculateInboxV2LifecycleControlSourceProofHash(body)
  });
  const proof = deepFreezePolicyValue({
    ...parsedProof,
    holds,
    restrictions
  });
  definedInboxV2LifecycleControlSourceProofs.add(proof);
  return proof;
}

export function calculateInboxV2LifecycleControlSnapshotHash(input: {
  snapshotHash?: unknown;
  [key: string]: unknown;
}) {
  const { snapshotHash: _ignored, ...snapshot } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.lifecycle-control-snapshot",
    hashVersion: "v1",
    snapshot
  });
}

export function defineInboxV2LifecycleControlSnapshot(input: {
  registry: InboxV2DataLifecycleRegistry;
  policy: InboxV2EffectiveTenantPolicy;
  target: z.input<typeof inboxV2PrivacyControlTargetSchema>;
  sourceProof: z.infer<typeof inboxV2LifecycleControlSourceProofSchema>;
  snapshot: Pick<
    z.input<typeof inboxV2LifecycleControlSnapshotSchema>,
    "tenantId" | "id" | "revision"
  >;
}): z.infer<typeof inboxV2LifecycleControlSnapshotSchema> {
  if (
    !isInboxV2DataLifecycleRegistry(input.registry) ||
    !isInboxV2ActivatedEffectiveTenantPolicy(input.policy)
  ) {
    throw new Error(
      "Lifecycle control snapshot requires authentic registry and activated policy."
    );
  }
  if (!definedInboxV2LifecycleControlSourceProofs.has(input.sourceProof)) {
    throw new Error(
      "Lifecycle control snapshot requires an authentic complete source proof."
    );
  }
  const target = inboxV2PrivacyControlTargetSchema.parse(input.target);
  if (
    target.tenantId !== input.policy.tenantId ||
    input.sourceProof.registryCompositionHash !==
      input.registry.compositionHash ||
    !samePolicyReference(
      input.sourceProof.policy,
      policyReference(input.policy)
    ) ||
    canonicalJson(input.sourceProof.target) !== canonicalJson(target)
  ) {
    throw new Error(
      "Lifecycle control snapshot does not match its registry/policy/target proof."
    );
  }
  const body = {
    ...input.snapshot,
    policy: policyReference(input.policy),
    target,
    sourceState: input.sourceProof.sourceState,
    purposeCompleteness: "all_active_purposes_for_target" as const,
    controlCompleteness: "all_relevant_controls_at_high_water" as const,
    purposes: input.sourceProof.purposes,
    holds: input.sourceProof.holds,
    restrictions: input.sourceProof.restrictions,
    capturedAt: input.sourceProof.resolvedAt
  } as const;
  const parsedSnapshot = inboxV2LifecycleControlSnapshotSchema.parse({
    ...body,
    snapshotHash: calculateInboxV2LifecycleControlSnapshotHash(body)
  });
  const snapshot = deepFreezePolicyValue({
    ...parsedSnapshot,
    holds: input.sourceProof.holds,
    restrictions: input.sourceProof.restrictions
  });
  definedInboxV2LifecycleControlSnapshots.add(snapshot);
  return snapshot;
}

export const inboxV2LifecycleEvaluationRequestSchema = z
  .object({
    policy: inboxV2EffectiveTenantPolicySchema,
    collectionPolicyRef: inboxV2DataLifecyclePolicyReferenceSchema,
    governanceContext: inboxV2DataGovernanceContextSchema,
    target: inboxV2PrivacyControlTargetSchema,
    controlSnapshot: inboxV2LifecycleControlSnapshotSchema,
    purposes: z
      .array(inboxV2LifecyclePurposeInstanceSchema)
      .min(1)
      .max(256)
      .superRefine((purposes, context) =>
        addCanonicalUniqueIssue(
          context,
          purposes.map(purposeInstanceKey),
          "Lifecycle purpose instances"
        )
      ),
    holds: z
      .array(inboxV2LegalHoldSchema)
      .max(256)
      .superRefine((holds, context) =>
        addUniqueControlRevisionIssues(
          context,
          holds.map(({ id }) => String(id)),
          "Legal holds"
        )
      ),
    restrictions: z
      .array(inboxV2ProcessingRestrictionSchema)
      .max(256)
      .superRefine((restrictions, context) =>
        addUniqueControlRevisionIssues(
          context,
          restrictions.map(({ id }) => String(id)),
          "Processing restrictions"
        )
      ),
    requestedUse: inboxV2RestrictedProcessingUseSchema.nullable(),
    now: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((request, context) => {
    if (
      !samePolicyReference(
        request.controlSnapshot.policy,
        policyReference(request.policy)
      ) ||
      canonicalJson(request.controlSnapshot.target) !==
        canonicalJson(request.target) ||
      canonicalJson(request.controlSnapshot.purposes) !==
        canonicalJson(request.purposes) ||
      canonicalJson(request.controlSnapshot.holds) !==
        canonicalJson(request.holds) ||
      canonicalJson(request.controlSnapshot.restrictions) !==
        canonicalJson(request.restrictions) ||
      request.controlSnapshot.capturedAt !== request.now
    ) {
      addIssue(
        context,
        ["controlSnapshot"],
        "Lifecycle evaluation requires the exact current purpose/control snapshot."
      );
    }
  });

export const inboxV2TrustedPeriodResolutionEvidenceSchema = z
  .object({
    resolverId: inboxV2NamespacedIdSchema,
    resolverVersion: inboxV2EntityRevisionSchema,
    governanceContextRef: inboxV2DataGovernanceContextReferenceSchema,
    period: inboxV2RetentionPeriodSchema,
    anchorAt: inboxV2TimestampSchema,
    eligibleAt: inboxV2TimestampSchema.refine((value) => value.endsWith("Z"), {
      message: "Resolved calendar deadline must be normalized to UTC."
    }),
    calendar: inboxV2VersionedProfileReferenceSchema.nullable()
  })
  .strict();

export const inboxV2PeriodResolutionRoleSchema = z.enum([
  "product_baseline",
  "backup_maximum",
  "tenant_selection",
  "entitlement_maximum",
  "legal_minimum",
  "legal_maximum",
  "parent_maximum"
]);

export const inboxV2LabeledPeriodResolutionEvidenceSchema = z
  .object({
    role: inboxV2PeriodResolutionRoleSchema,
    evidence: inboxV2TrustedPeriodResolutionEvidenceSchema
  })
  .strict();

export type InboxV2TrustedCalendarPeriodResolver = (input: {
  period: Extract<
    InboxV2RetentionPeriod,
    { kind: "calendar" | "business_days" }
  >;
  anchorAt: string;
  governanceContext: InboxV2DataGovernanceContext;
}) => z.input<typeof inboxV2TrustedPeriodResolutionEvidenceSchema>;

export const inboxV2LifecyclePurposeDeadlineSchema = z
  .object({
    purposeId: inboxV2ProcessingPurposeIdSchema,
    ruleId: inboxV2RetentionRuleIdSchema,
    ruleRevision: inboxV2EntityRevisionSchema,
    eligibleAt: inboxV2TimestampSchema,
    baselineAt: inboxV2TimestampSchema,
    legalMinimumAt: inboxV2TimestampSchema.nullable(),
    legalMaximumAt: inboxV2TimestampSchema.nullable(),
    backupMaximumAt: inboxV2TimestampSchema,
    parentDeadlineSnapshot: inboxV2ParentDeadlineSnapshotSchema.nullable(),
    calendarResolutionEvidence: z.array(
      inboxV2LabeledPeriodResolutionEvidenceSchema
    ),
    selectedSource: z.enum([
      "product_baseline",
      "tenant_shorter",
      "tenant_longer",
      "tenant_longer_entitlement_capped",
      "legal_minimum",
      "legal_maximum",
      "parent_deadline"
    ])
  })
  .strict();

const evaluatedProcessingRestrictionDecisionSchema = z
  .object({
    state: z.literal("evaluated"),
    references: z.array(inboxV2ProcessingRestrictionReferenceSchema),
    allowedUses: z.array(inboxV2RestrictedProcessingUseSchema),
    requestedUseAllowed: z.boolean().nullable()
  })
  .strict();

const notEvaluatedProcessingRestrictionDecisionSchema = z
  .object({ state: z.literal("not_evaluated_due_to_hold") })
  .strict();

const lifecycleDecisionCommonShape = {
  tenantId: inboxV2TenantIdSchema,
  target: inboxV2PrivacyControlTargetSchema,
  policyRef: inboxV2DataLifecyclePolicyReferenceSchema,
  policyActivation: inboxV2PolicyActivationReferenceSchema,
  collectionPolicyRef: inboxV2DataLifecyclePolicyReferenceSchema,
  governanceContextRef: inboxV2DataGovernanceContextReferenceSchema,
  controlSnapshot: inboxV2LifecycleControlSnapshotReferenceSchema,
  evaluatedAt: inboxV2TimestampSchema,
  purposeDeadlines: z.array(inboxV2LifecyclePurposeDeadlineSchema)
} as const;

export const inboxV2LifecycleEvaluationErrorCodeSchema = z.enum([
  "privacy.policy_invalid",
  "privacy.policy_missing",
  "privacy.policy_tenant_mismatch",
  "privacy.governance_context_mismatch",
  "privacy.policy_rule_reference_invalid",
  "privacy.policy_rule_conflict",
  "privacy.calendar_resolver_required",
  "privacy.calendar_resolution_invalid",
  "privacy.condition_resolution_required",
  "privacy.parent_deadline_required",
  "privacy.tenant_selection_not_allowed",
  "privacy.entitlement_required",
  "privacy.scope_ambiguous",
  "privacy.data_class_not_hold_eligible"
]);

export const inboxV2LifecycleEvaluationSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        ...lifecycleDecisionCommonShape,
        outcome: z.literal("eligible_for_action"),
        restriction: evaluatedProcessingRestrictionDecisionSchema,
        action: inboxV2LifecycleActionSchema,
        eligibleAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        ...lifecycleDecisionCommonShape,
        outcome: z.literal("retained_until"),
        restriction: evaluatedProcessingRestrictionDecisionSchema,
        action: inboxV2LifecycleActionSchema,
        eligibleAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        ...lifecycleDecisionCommonShape,
        outcome: z.literal("review_required"),
        restriction: evaluatedProcessingRestrictionDecisionSchema,
        nextReviewAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        ...lifecycleDecisionCommonShape,
        outcome: z.literal("blocked_by_legal_hold"),
        restriction: notEvaluatedProcessingRestrictionDecisionSchema,
        hold: inboxV2PrivacyHoldReferenceSchema,
        reviewAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("rejected"),
        errorCode: inboxV2LifecycleEvaluationErrorCodeSchema
      })
      .strict()
  ]
);

const definedInboxV2LifecycleEvaluations = new WeakSet<object>();

/** Runtime guard for a decision actually produced by the policy evaluator. */
export function isInboxV2LifecycleEvaluation(
  value: unknown
): value is Exclude<
  z.infer<typeof inboxV2LifecycleEvaluationSchema>,
  { outcome: "rejected" }
> {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2LifecycleEvaluations.has(value)
  );
}

export function isInboxV2LifecycleEvaluationCurrent(input: {
  ledger: InboxV2PolicyActivationLedger;
  policy: InboxV2EffectiveTenantPolicy;
  evaluation: unknown;
}): input is {
  ledger: InboxV2PolicyActivationLedger;
  policy: InboxV2EffectiveTenantPolicy;
  evaluation: Exclude<InboxV2LifecycleEvaluation, { outcome: "rejected" }>;
} {
  if (
    !isInboxV2LifecycleEvaluation(input.evaluation) ||
    !isInboxV2CurrentActivatedEffectiveTenantPolicy({
      ledger: input.ledger,
      policy: input.policy
    })
  ) {
    return false;
  }
  const activation = inboxV2PolicyActivationByPolicy.get(input.policy);
  return (
    activation !== undefined &&
    samePolicyReference(
      input.evaluation.policyRef,
      policyReference(input.policy)
    ) &&
    samePolicyActivationReference(
      input.evaluation.policyActivation,
      activationReference(activation)
    ) &&
    input.evaluation.evaluatedAt === input.evaluation.controlSnapshot.capturedAt
  );
}

export type InboxV2LifecycleEvaluationInput = z.input<
  typeof inboxV2LifecycleEvaluationRequestSchema
> & {
  registry: InboxV2DataLifecycleRegistry;
  resolveCalendarPeriod?: InboxV2TrustedCalendarPeriodResolver;
  prospectiveMatcher?: InboxV2ProspectivePrivacyScopeMatcher;
};

/** Pure, fail-closed lifecycle evaluation at one explicit decision time. */
export function evaluateInboxV2Lifecycle(
  input: InboxV2LifecycleEvaluationInput
): InboxV2LifecycleEvaluation {
  if (
    !isInboxV2ActivatedEffectiveTenantPolicy(input.policy) ||
    !isInboxV2DataGovernanceContext(input.governanceContext) ||
    !definedInboxV2LifecycleControlSnapshots.has(input.controlSnapshot) ||
    input.holds.some((hold) => !isInboxV2LegalHold(hold)) ||
    input.restrictions.some(
      (restriction) => !isInboxV2ProcessingRestriction(restriction)
    )
  ) {
    return rejectedEvaluation("privacy.policy_invalid");
  }
  const currentPolicyActivation = inboxV2PolicyActivationByPolicy.get(
    input.policy
  );
  if (
    currentPolicyActivation === undefined ||
    !definedInboxV2PolicyActivations.has(currentPolicyActivation)
  ) {
    return rejectedEvaluation("privacy.policy_invalid");
  }
  const parsed = inboxV2LifecycleEvaluationRequestSchema.safeParse({
    policy: input.policy,
    collectionPolicyRef: input.collectionPolicyRef,
    governanceContext: input.governanceContext,
    target: input.target,
    controlSnapshot: input.controlSnapshot,
    purposes: input.purposes,
    holds: input.holds,
    restrictions: input.restrictions,
    requestedUse: input.requestedUse,
    now: input.now
  });
  if (!parsed.success) {
    return rejectedEvaluation("privacy.policy_invalid");
  }
  const request = {
    ...parsed.data,
    holds: input.holds,
    restrictions: input.restrictions
  } as z.infer<typeof inboxV2LifecycleEvaluationRequestSchema>;
  const { policy, governanceContext: governance, target } = request;
  if (
    !isInboxV2DataLifecycleRegistry(input.registry) ||
    policy.registryCompositionHash !== input.registry.compositionHash
  ) {
    return rejectedEvaluation("privacy.policy_rule_reference_invalid");
  }
  if (policy.tenantId !== target.tenantId) {
    return rejectedEvaluation("privacy.policy_tenant_mismatch");
  }
  if (request.collectionPolicyRef.tenantId !== target.tenantId) {
    return rejectedEvaluation("privacy.policy_tenant_mismatch");
  }
  const dataClassDefinition = resolveRegistryDataClassDefinition(
    input.registry,
    target.dataClassId
  );
  if (
    dataClassDefinition === null ||
    dataClassDefinition.sensitivity !== target.sensitivity ||
    dataClassDefinition.holdEligible !== target.holdEligible
  ) {
    return rejectedEvaluation("privacy.policy_rule_reference_invalid");
  }
  if (
    request.holds.some(({ tenantId }) => tenantId !== target.tenantId) ||
    request.restrictions.some(({ tenantId }) => tenantId !== target.tenantId)
  ) {
    return rejectedEvaluation("privacy.policy_tenant_mismatch");
  }
  if (
    [...request.holds, ...request.restrictions].some(
      ({ endCondition }) =>
        !registryHasLifecycleHandler(
          input.registry,
          endCondition.resolverHandlerId,
          "condition_resolution"
        )
    )
  ) {
    return rejectedEvaluation("privacy.condition_resolution_required");
  }
  if (
    [...request.holds, ...request.restrictions].some(
      ({ scope }) =>
        scope.kind === "prospective" &&
        !registryHasLifecycleHandler(
          input.registry,
          scope.matcherHandlerId,
          "scope_matcher"
        )
    )
  ) {
    return rejectedEvaluation("privacy.scope_ambiguous");
  }
  if (
    !matchesInboxV2DataGovernanceContextReference({
      context: governance,
      reference: policy.governanceContextRef
    }) ||
    policy.deploymentProfile !== governance.deploymentProfile
  ) {
    return rejectedEvaluation("privacy.governance_context_mismatch");
  }
  if (
    Date.parse(request.now) < Date.parse(policy.effectiveAt) ||
    Date.parse(request.now) >= Date.parse(governance.reviewAt)
  ) {
    return rejectedEvaluation("privacy.policy_invalid");
  }

  const rules = new Map(
    policy.rules
      .filter((rule) => rule.dataClassId === target.dataClassId)
      .map((rule) => [retentionRuleReferenceKey(rule), rule])
  );
  const selectedRules: InboxV2EffectiveTenantLifecycleRule[] = [];
  for (const purpose of request.purposes) {
    if (compareTimestamp(purpose.anchorAt, target.anchorAt) !== 0) {
      return rejectedEvaluation("privacy.policy_rule_reference_invalid");
    }
    const rule = rules.get(retentionRuleReferenceKey(purpose));
    if (!rule || rule.purposeId !== purpose.purposeId) {
      return rejectedEvaluation("privacy.policy_rule_reference_invalid");
    }
    if (
      !dataClassDefinition.allowedPurposeIds.includes(purpose.purposeId) ||
      dataClassDefinition.canonicalAnchorId !== rule.retentionAnchorId ||
      !dataClassDefinition.allowedExpiryActions.includes(rule.actionAtExpiry) ||
      dataClassDefinition.holdEligible !== rule.holdEligible ||
      !registryRuleMatchesSafetyEnvelope(input.registry, rule) ||
      (dataClassDefinition.parentBehavior === "inherits_all_live_parents") !==
        (rule.baselineWindow.kind === "inherits_all_live_parents") ||
      (rule.baselineWindow.kind === "until_condition_then_period" &&
        !registryHasLifecycleHandler(
          input.registry,
          rule.baselineWindow.condition.resolverHandlerId,
          "condition_resolution"
        ))
    ) {
      return rejectedEvaluation("privacy.policy_rule_reference_invalid");
    }
    if (
      !governance.rolesByPurpose.some(
        ({ purposeId }) => purposeId === purpose.purposeId
      )
    ) {
      return rejectedEvaluation("privacy.governance_context_mismatch");
    }
    selectedRules.push(rule);
    const parentSnapshot = purpose.parentDeadlineSnapshot;
    if (parentSnapshot !== null) {
      if (
        parentSnapshot.parentSet.kind === "live_parents" &&
        parentSnapshot.parentSet.parents.some(
          (deadline) =>
            deadline.parent.tenantId !== target.tenantId ||
            deadline.policyRef.tenantId !== target.tenantId
        )
      ) {
        return rejectedEvaluation("privacy.policy_tenant_mismatch");
      }
      if (
        entityKey(parentSnapshot.child) !== entityKey(target.entity) ||
        parentSnapshot.childRevision !== target.entityRevision ||
        parentSnapshot.lineageRevision !== target.lineageRevision ||
        compareTimestamp(parentSnapshot.resolvedAt, request.now) !== 0
      ) {
        return rejectedEvaluation("privacy.parent_deadline_required");
      }
      if (
        !registryHasLifecycleHandler(
          input.registry,
          parentSnapshot.resolverHandlerId,
          "lifecycle"
        )
      ) {
        return rejectedEvaluation("privacy.parent_deadline_required");
      }
    }
  }
  const holdEligibility = new Set(
    selectedRules.map((rule) => rule.holdEligible)
  );
  if (holdEligibility.size !== 1) {
    return rejectedEvaluation("privacy.policy_rule_conflict");
  }
  if (target.sensitivity === "secret" && selectedRules[0]!.holdEligible) {
    return rejectedEvaluation("privacy.data_class_not_hold_eligible");
  }

  const commonIdentity = {
    tenantId: policy.tenantId,
    target,
    policyRef: policyReference(policy),
    policyActivation: activationReference(currentPolicyActivation),
    collectionPolicyRef: request.collectionPolicyRef,
    governanceContextRef: governanceReference(governance),
    controlSnapshot: lifecycleControlSnapshotReference(request.controlSnapshot),
    evaluatedAt: request.now,
    purposeDeadlines: [] as InboxV2LifecyclePurposeDeadline[]
  };

  if (selectedRules[0]!.holdEligible) {
    const blockingHold = findBlockingHold(request, input.prospectiveMatcher);
    if (blockingHold.kind === "rejected") {
      return rejectedEvaluation(blockingHold.errorCode);
    }
    if (blockingHold.kind === "blocked") {
      return authenticEvaluation({
        ...commonIdentity,
        restriction: { state: "not_evaluated_due_to_hold" },
        outcome: "blocked_by_legal_hold",
        hold: blockingHold.hold,
        reviewAt: blockingHold.reviewAt
      });
    }
  }

  const restriction = evaluateRestrictions(request, input.prospectiveMatcher);
  if (restriction.kind === "rejected") {
    return rejectedEvaluation(restriction.errorCode);
  }
  const common = {
    ...commonIdentity,
    restriction: restriction.decision
  };

  const deadlines: Array<{
    deadline: InboxV2LifecyclePurposeDeadline;
    action: InboxV2EffectiveTenantLifecycleRule["actionAtExpiry"];
  }> = [];
  const unresolvedReviews: string[] = [];
  for (let index = 0; index < request.purposes.length; index += 1) {
    const purpose = request.purposes[index]!;
    const rule = selectedRules[index]!;
    const result = evaluatePurposeDeadline({
      purpose,
      rule,
      governance,
      now: request.now,
      resolveCalendarPeriod: input.resolveCalendarPeriod
    });
    if (result.kind === "rejected") {
      return rejectedEvaluation(result.errorCode);
    }
    if (result.kind === "review_required") {
      unresolvedReviews.push(result.nextReviewAt);
    } else {
      deadlines.push({
        deadline: result.deadline,
        action: rule.actionAtExpiry
      });
    }
  }

  const purposeDeadlines = deadlines
    .map(({ deadline }) => deadline)
    .sort((left, right) =>
      purposeDeadlineKey(left).localeCompare(purposeDeadlineKey(right))
    );
  if (unresolvedReviews.length > 0) {
    return authenticEvaluation({
      ...common,
      purposeDeadlines,
      outcome: "review_required",
      nextReviewAt: earliestTimestamp(unresolvedReviews)
    });
  }

  const latest = deadlines.reduce((selected, candidate) => {
    const comparison = compareTimestamp(
      candidate.deadline.eligibleAt,
      selected.deadline.eligibleAt
    );
    if (comparison > 0) return candidate;
    if (comparison < 0) return selected;
    return candidate.action.localeCompare(selected.action) < 0
      ? candidate
      : selected;
  });
  const tiedActions = new Set(
    deadlines
      .filter(
        ({ deadline }) =>
          compareTimestamp(deadline.eligibleAt, latest.deadline.eligibleAt) ===
          0
      )
      .map(({ action }) => action)
  );
  if (tiedActions.size > 1) {
    return rejectedEvaluation("privacy.policy_rule_conflict");
  }

  return authenticEvaluation({
    ...common,
    purposeDeadlines,
    outcome:
      Date.parse(request.now) >= Date.parse(latest.deadline.eligibleAt)
        ? "eligible_for_action"
        : "retained_until",
    action: latest.action,
    eligibleAt: latest.deadline.eligibleAt
  });
}

export type InboxV2DataLifecycleRule = z.infer<
  typeof inboxV2DataLifecycleRuleSchema
>;
export type InboxV2PolicyTemplate = z.infer<typeof inboxV2PolicyTemplateSchema>;
export type InboxV2EffectiveTenantLifecycleRule = z.infer<
  typeof inboxV2EffectiveTenantLifecycleRuleSchema
>;
export type InboxV2EffectiveTenantPolicy = z.infer<
  typeof inboxV2EffectiveTenantPolicySchema
>;
export type InboxV2DataLifecyclePolicy = z.infer<
  typeof inboxV2DataLifecyclePolicySchema
>;
export type InboxV2DataLifecyclePolicyReference = z.infer<
  typeof inboxV2DataLifecyclePolicyReferenceSchema
>;
export type InboxV2EffectiveTenantPolicyResolutionResult = z.infer<
  typeof inboxV2EffectiveTenantPolicyResolutionResultSchema
>;
export type InboxV2LifecyclePurposeDeadline = z.infer<
  typeof inboxV2LifecyclePurposeDeadlineSchema
>;
export type InboxV2LifecycleEvaluation = z.infer<
  typeof inboxV2LifecycleEvaluationSchema
>;
export type InboxV2DataLifecyclePolicyEnvelope = InboxV2SchemaEnvelope<
  typeof INBOX_V2_DATA_LIFECYCLE_POLICY_SCHEMA_ID,
  typeof INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
  InboxV2DataLifecyclePolicy
>;

type DeadlineErrorCode = z.infer<
  typeof inboxV2LifecycleEvaluationErrorCodeSchema
>;
type DeadlineResult =
  | { kind: "resolved"; deadline: InboxV2LifecyclePurposeDeadline }
  | { kind: "review_required"; nextReviewAt: string }
  | { kind: "rejected"; errorCode: DeadlineErrorCode };

function evaluatePurposeDeadline(input: {
  purpose: z.infer<typeof inboxV2LifecyclePurposeInstanceSchema>;
  rule: InboxV2EffectiveTenantLifecycleRule;
  governance: InboxV2DataGovernanceContext;
  now: string;
  resolveCalendarPeriod?: InboxV2TrustedCalendarPeriodResolver;
}): DeadlineResult {
  const { purpose, rule, governance, now, resolveCalendarPeriod } = input;
  const anchorResult = resolveRuleAnchor(purpose, rule.baselineWindow, now);
  if (anchorResult.kind === "rejected") return anchorResult;
  if (anchorResult.kind === "condition_unresolved") {
    if (rule.baselineWindow.kind !== "until_condition_then_period") {
      return {
        kind: "rejected",
        errorCode: "privacy.condition_resolution_required"
      };
    }
    const nextReview = resolvePeriod({
      period: rule.baselineWindow.reviewPeriod,
      anchorAt: anchorResult.reviewedAt,
      governance,
      resolveCalendarPeriod
    });
    return nextReview.kind === "rejected"
      ? nextReview
      : { kind: "review_required", nextReviewAt: nextReview.eligibleAt };
  }

  const baseline = resolveRetentionWindow({
    window: rule.baselineWindow,
    anchorAt: anchorResult.anchorAt,
    parentDeadlineSnapshot: purpose.parentDeadlineSnapshot,
    governance,
    resolveCalendarPeriod
  });
  if (baseline.kind === "rejected") return baseline;

  const calendarResolutionEvidence: Array<
    z.infer<typeof inboxV2LabeledPeriodResolutionEvidenceSchema>
  > = baseline.calendarResolutionEvidence.map((evidence) => ({
    role:
      baseline.source === "parent_deadline"
        ? "parent_maximum"
        : "product_baseline",
    evidence
  }));
  const legalMinimum =
    rule.legalMinimum === null
      ? null
      : resolvePeriod({
          period: rule.legalMinimum,
          anchorAt: anchorResult.anchorAt,
          governance,
          resolveCalendarPeriod
        });
  if (legalMinimum?.kind === "rejected") return legalMinimum;
  if (legalMinimum?.evidence) {
    calendarResolutionEvidence.push({
      role: "legal_minimum",
      evidence: legalMinimum.evidence
    });
  }
  const legalMaximum =
    rule.legalMaximum === null
      ? null
      : resolvePeriod({
          period: rule.legalMaximum,
          anchorAt: anchorResult.anchorAt,
          governance,
          resolveCalendarPeriod
        });
  if (legalMaximum?.kind === "rejected") return legalMaximum;
  if (legalMaximum?.evidence) {
    calendarResolutionEvidence.push({
      role: "legal_maximum",
      evidence: legalMaximum.evidence
    });
  }
  const backupMaximum = resolvePeriod({
    period: rule.backupMaximum,
    anchorAt: anchorResult.anchorAt,
    governance,
    resolveCalendarPeriod
  });
  if (backupMaximum.kind === "rejected") return backupMaximum;
  if (backupMaximum.evidence !== null) {
    calendarResolutionEvidence.push({
      role: "backup_maximum",
      evidence: backupMaximum.evidence
    });
  }
  if (
    legalMinimum !== null &&
    legalMaximum !== null &&
    compareTimestamp(legalMinimum.eligibleAt, legalMaximum.eligibleAt) > 0
  ) {
    return { kind: "rejected", errorCode: "privacy.policy_rule_conflict" };
  }

  let eligibleAt = baseline.eligibleAt;
  let selectedSource: InboxV2LifecyclePurposeDeadline["selectedSource"] =
    baseline.source;
  if (
    legalMinimum !== null &&
    compareTimestamp(eligibleAt, legalMinimum.eligibleAt) < 0
  ) {
    eligibleAt = legalMinimum.eligibleAt;
    selectedSource = "legal_minimum";
  }
  if (
    legalMaximum !== null &&
    compareTimestamp(eligibleAt, legalMaximum.eligibleAt) > 0
  ) {
    eligibleAt = legalMaximum.eligibleAt;
    selectedSource = "legal_maximum";
  }

  if (rule.tenantSelectedPeriod !== null) {
    const selected = resolvePeriod({
      period: rule.tenantSelectedPeriod,
      anchorAt: anchorResult.anchorAt,
      governance,
      resolveCalendarPeriod
    });
    if (selected.kind === "rejected") return selected;
    if (selected.evidence !== null) {
      calendarResolutionEvidence.push({
        role: "tenant_selection",
        evidence: selected.evidence
      });
    }
    const selectionVsBaseline = compareTimestamp(
      selected.eligibleAt,
      baseline.eligibleAt
    );
    if (selectionVsBaseline < 0 && !rule.allowTenantShorter) {
      return {
        kind: "rejected",
        errorCode: "privacy.tenant_selection_not_allowed"
      };
    }
    if (selectionVsBaseline > 0 && !rule.allowTenantLonger) {
      return {
        kind: "rejected",
        errorCode: "privacy.tenant_selection_not_allowed"
      };
    }

    let selectedWithinLegalEnvelope = selected.eligibleAt;
    if (
      legalMinimum !== null &&
      compareTimestamp(selectedWithinLegalEnvelope, legalMinimum.eligibleAt) < 0
    ) {
      selectedWithinLegalEnvelope = legalMinimum.eligibleAt;
    }
    if (
      legalMaximum !== null &&
      compareTimestamp(selectedWithinLegalEnvelope, legalMaximum.eligibleAt) > 0
    ) {
      selectedWithinLegalEnvelope = legalMaximum.eligibleAt;
    }

    const selectionVsMandatory = compareTimestamp(
      selectedWithinLegalEnvelope,
      eligibleAt
    );
    if (selectionVsMandatory < 0) {
      eligibleAt = selectedWithinLegalEnvelope;
      selectedSource = "tenant_shorter";
    } else if (selectionVsMandatory > 0) {
      if (rule.entitlementLongerMaximum === null) {
        return { kind: "rejected", errorCode: "privacy.entitlement_required" };
      }
      const allowance = resolvePeriod({
        period: rule.entitlementLongerMaximum,
        anchorAt: anchorResult.anchorAt,
        governance,
        resolveCalendarPeriod
      });
      if (allowance.kind === "rejected") return allowance;
      if (allowance.evidence !== null) {
        calendarResolutionEvidence.push({
          role: "entitlement_maximum",
          evidence: allowance.evidence
        });
      }
      let allowanceWithinLegalEnvelope = allowance.eligibleAt;
      if (
        legalMinimum !== null &&
        compareTimestamp(
          allowanceWithinLegalEnvelope,
          legalMinimum.eligibleAt
        ) < 0
      ) {
        allowanceWithinLegalEnvelope = legalMinimum.eligibleAt;
      }
      if (
        legalMaximum !== null &&
        compareTimestamp(
          allowanceWithinLegalEnvelope,
          legalMaximum.eligibleAt
        ) > 0
      ) {
        allowanceWithinLegalEnvelope = legalMaximum.eligibleAt;
      }
      const optionalDeadline = earliestTimestamp([
        selectedWithinLegalEnvelope,
        allowanceWithinLegalEnvelope
      ]);
      if (compareTimestamp(optionalDeadline, eligibleAt) > 0) {
        eligibleAt = optionalDeadline;
        selectedSource =
          compareTimestamp(
            selectedWithinLegalEnvelope,
            allowanceWithinLegalEnvelope
          ) > 0
            ? "tenant_longer_entitlement_capped"
            : "tenant_longer";
      }
    }
  }

  return {
    kind: "resolved",
    deadline: inboxV2LifecyclePurposeDeadlineSchema.parse({
      purposeId: purpose.purposeId,
      ruleId: purpose.ruleId,
      ruleRevision: purpose.ruleRevision,
      eligibleAt,
      baselineAt: baseline.eligibleAt,
      legalMinimumAt: legalMinimum?.eligibleAt ?? null,
      legalMaximumAt: legalMaximum?.eligibleAt ?? null,
      backupMaximumAt: backupMaximum.eligibleAt,
      parentDeadlineSnapshot: purpose.parentDeadlineSnapshot,
      calendarResolutionEvidence,
      selectedSource
    })
  };
}

function resolveRuleAnchor(
  purpose: z.infer<typeof inboxV2LifecyclePurposeInstanceSchema>,
  window: InboxV2RetentionWindow,
  now: string
):
  | { kind: "resolved"; anchorAt: string }
  | { kind: "condition_unresolved"; reviewedAt: string }
  | { kind: "rejected"; errorCode: DeadlineErrorCode } {
  if (window.kind !== "until_condition_then_period") {
    return purpose.condition === null
      ? { kind: "resolved", anchorAt: purpose.anchorAt }
      : {
          kind: "rejected",
          errorCode: "privacy.policy_rule_reference_invalid"
        };
  }
  const condition = purpose.condition;
  if (
    condition === null ||
    String(condition.conditionId) !== String(window.condition.id) ||
    condition.conditionVersion !== window.condition.version ||
    condition.resolverHandlerId !== window.condition.resolverHandlerId
  ) {
    return {
      kind: "rejected",
      errorCode: "privacy.condition_resolution_required"
    };
  }
  const evidenceAt =
    condition.state === "resolved"
      ? condition.resolvedAt
      : condition.reviewedAt;
  if (
    compareTimestamp(evidenceAt, purpose.anchorAt) < 0 ||
    compareTimestamp(evidenceAt, now) > 0
  ) {
    return {
      kind: "rejected",
      errorCode: "privacy.condition_resolution_required"
    };
  }
  return condition.state === "unresolved"
    ? { kind: "condition_unresolved", reviewedAt: condition.reviewedAt }
    : { kind: "resolved", anchorAt: condition.resolvedAt };
}

function resolveRetentionWindow(input: {
  window: InboxV2RetentionWindow;
  anchorAt: string;
  parentDeadlineSnapshot: z.infer<
    typeof inboxV2ParentDeadlineSnapshotSchema
  > | null;
  governance: InboxV2DataGovernanceContext;
  resolveCalendarPeriod?: InboxV2TrustedCalendarPeriodResolver;
}):
  | {
      kind: "resolved";
      eligibleAt: string;
      source: "product_baseline" | "parent_deadline";
      calendarResolutionEvidence: Array<
        z.infer<typeof inboxV2TrustedPeriodResolutionEvidenceSchema>
      >;
    }
  | { kind: "rejected"; errorCode: DeadlineErrorCode } {
  if (input.window.kind === "inherits_all_live_parents") {
    if (input.parentDeadlineSnapshot === null) {
      return {
        kind: "rejected",
        errorCode: "privacy.parent_deadline_required"
      };
    }
    let eligibleAt =
      input.parentDeadlineSnapshot.parentSet.kind === "no_live_parents"
        ? input.parentDeadlineSnapshot.parentSet.detachedAt
        : latestTimestamp(
            input.parentDeadlineSnapshot.parentSet.parents.map(
              ({ eligibleAt: deadline }) => deadline
            )
          );
    let capEvidence: z.infer<
      typeof inboxV2TrustedPeriodResolutionEvidenceSchema
    > | null = null;
    if (input.window.maximumAdditionalPeriod !== null) {
      const cap = resolvePeriod({
        period: input.window.maximumAdditionalPeriod,
        anchorAt: input.anchorAt,
        governance: input.governance,
        resolveCalendarPeriod: input.resolveCalendarPeriod
      });
      if (cap.kind === "rejected") return cap;
      eligibleAt = earliestTimestamp([eligibleAt, cap.eligibleAt]);
      capEvidence = cap.evidence;
    }
    return {
      kind: "resolved",
      eligibleAt,
      source: "parent_deadline",
      calendarResolutionEvidence:
        input.window.maximumAdditionalPeriod !== null && capEvidence !== null
          ? [capEvidence]
          : []
    };
  }
  if (input.parentDeadlineSnapshot !== null) {
    return {
      kind: "rejected",
      errorCode: "privacy.policy_rule_reference_invalid"
    };
  }
  const resolved = resolvePeriod({
    period: input.window.period,
    anchorAt: input.anchorAt,
    governance: input.governance,
    resolveCalendarPeriod: input.resolveCalendarPeriod
  });
  return resolved.kind === "rejected"
    ? resolved
    : {
        kind: "resolved",
        eligibleAt: resolved.eligibleAt,
        source: "product_baseline",
        calendarResolutionEvidence:
          resolved.evidence === null ? [] : [resolved.evidence]
      };
}

function resolvePeriod(input: {
  period: InboxV2RetentionPeriod;
  anchorAt: string;
  governance: InboxV2DataGovernanceContext;
  resolveCalendarPeriod?: InboxV2TrustedCalendarPeriodResolver;
}):
  | {
      kind: "resolved";
      eligibleAt: string;
      evidence: z.infer<
        typeof inboxV2TrustedPeriodResolutionEvidenceSchema
      > | null;
    }
  | { kind: "rejected"; errorCode: DeadlineErrorCode } {
  if (input.period.kind === "elapsed") {
    const eligible = new Date(
      Date.parse(input.anchorAt) + input.period.seconds * 1_000
    ).toISOString();
    const parsed = inboxV2TimestampSchema.safeParse(eligible);
    return parsed.success
      ? { kind: "resolved", eligibleAt: parsed.data, evidence: null }
      : { kind: "rejected", errorCode: "privacy.policy_invalid" };
  }
  if (!input.resolveCalendarPeriod) {
    return {
      kind: "rejected",
      errorCode: "privacy.calendar_resolver_required"
    };
  }
  const period = input.period;
  if (
    period.kind === "business_days" &&
    !input.governance.businessCalendars.some(
      (calendar) =>
        versionedReferenceKey(calendar) ===
        versionedReferenceKey(period.calendar)
    )
  ) {
    return {
      kind: "rejected",
      errorCode: "privacy.calendar_resolution_invalid"
    };
  }
  try {
    const evidence = inboxV2TrustedPeriodResolutionEvidenceSchema.safeParse(
      input.resolveCalendarPeriod({
        period,
        anchorAt: input.anchorAt,
        governanceContext: input.governance
      })
    );
    const expectedCalendar =
      period.kind === "business_days" ? period.calendar : null;
    if (
      !evidence.success ||
      !matchesInboxV2DataGovernanceContextReference({
        context: input.governance,
        reference: evidence.data.governanceContextRef
      }) ||
      String(evidence.data.resolverId) !==
        String(input.governance.calendarPeriodResolver.id) ||
      evidence.data.resolverVersion !==
        input.governance.calendarPeriodResolver.version ||
      evidence.data.anchorAt !== input.anchorAt ||
      canonicalJson(evidence.data.period) !== canonicalJson(period) ||
      versionedReferenceKeyNullable(evidence.data.calendar) !==
        versionedReferenceKeyNullable(expectedCalendar) ||
      Date.parse(evidence.data.eligibleAt) <= Date.parse(input.anchorAt)
    ) {
      return {
        kind: "rejected",
        errorCode: "privacy.calendar_resolution_invalid"
      };
    }
    return {
      kind: "resolved",
      eligibleAt: evidence.data.eligibleAt,
      evidence: evidence.data
    };
  } catch {
    return {
      kind: "rejected",
      errorCode: "privacy.calendar_resolution_invalid"
    };
  }
}

function evaluateRestrictions(
  request: z.infer<typeof inboxV2LifecycleEvaluationRequestSchema>,
  prospectiveMatcher: InboxV2ProspectivePrivacyScopeMatcher | undefined
):
  | {
      kind: "resolved";
      decision: z.infer<typeof evaluatedProcessingRestrictionDecisionSchema>;
    }
  | { kind: "rejected"; errorCode: DeadlineErrorCode } {
  const matching = request.restrictions
    .map((restriction) => ({
      restriction,
      match: matchInboxV2ProcessingRestriction({
        restriction,
        target: request.target,
        now: request.now,
        prospectiveMatcher
      })
    }))
    .filter(({ match }) => match.kind !== "does_not_match");
  if (matching.some(({ match }) => match.kind === "rejected")) {
    return { kind: "rejected", errorCode: "privacy.scope_ambiguous" };
  }
  const active = matching
    .filter(
      (entry): entry is typeof entry & { match: { kind: "matches" } } =>
        entry.match.kind === "matches"
    )
    .sort((left, right) =>
      restrictionKey(left.restriction).localeCompare(
        restrictionKey(right.restriction)
      )
    );
  const activePurposeIds = new Set(
    request.purposes.map(({ purposeId }) => String(purposeId))
  );
  if (
    active.some(({ restriction }) =>
      restriction.continuingPurposeIds.some(
        (purposeId) => !activePurposeIds.has(String(purposeId))
      )
    )
  ) {
    return {
      kind: "rejected",
      errorCode: "privacy.policy_rule_reference_invalid"
    };
  }
  const allowed =
    active.length === 0
      ? [...inboxV2RestrictedProcessingUseSchema.options]
      : inboxV2RestrictedProcessingUseSchema.options.filter((use) =>
          active.every(({ restriction }) =>
            restriction.allowedUses.includes(use)
          )
        );
  return {
    kind: "resolved",
    decision: {
      state: "evaluated",
      references: active.map(({ restriction }) => ({
        tenantId: restriction.tenantId,
        restrictionId: restriction.id,
        revision: restriction.revision
      })),
      allowedUses: allowed,
      requestedUseAllowed:
        request.requestedUse === null
          ? null
          : allowed.includes(request.requestedUse)
    }
  };
}

function findBlockingHold(
  request: z.infer<typeof inboxV2LifecycleEvaluationRequestSchema>,
  prospectiveMatcher: InboxV2ProspectivePrivacyScopeMatcher | undefined
):
  | { kind: "none" }
  | {
      kind: "blocked";
      hold: z.infer<typeof inboxV2PrivacyHoldReferenceSchema>;
      reviewAt: string;
    }
  | { kind: "rejected"; errorCode: DeadlineErrorCode } {
  const matching = request.holds
    .map((hold) => ({
      hold,
      match: matchInboxV2LegalHold({
        hold,
        target: request.target,
        now: request.now,
        prospectiveMatcher
      })
    }))
    .filter(({ match }) => match.kind !== "does_not_match");
  if (
    matching.some(
      ({ match }) =>
        match.kind === "rejected" &&
        match.errorCode === "privacy.data_class_not_hold_eligible"
    )
  ) {
    return {
      kind: "rejected",
      errorCode: "privacy.data_class_not_hold_eligible"
    };
  }
  if (matching.some(({ match }) => match.kind === "rejected")) {
    return { kind: "rejected", errorCode: "privacy.scope_ambiguous" };
  }
  const first = matching
    .filter(({ match }) => match.kind === "matches")
    .sort((left, right) =>
      holdKey(left.hold).localeCompare(holdKey(right.hold))
    )[0];
  return first
    ? {
        kind: "blocked",
        hold: {
          tenantId: first.hold.tenantId,
          holdId: first.hold.id,
          revision: first.hold.revision
        },
        reviewAt: first.hold.reviewAt
      }
    : { kind: "none" };
}

function governanceReference(
  governance: InboxV2DataGovernanceContext
): z.infer<typeof inboxV2DataGovernanceContextReferenceSchema> {
  return {
    tenantId: governance.tenantId,
    id: governance.id,
    version: governance.version,
    contextHash: governance.contextHash
  };
}

function policyReference(
  policy: InboxV2EffectiveTenantPolicy
): z.infer<typeof inboxV2DataLifecyclePolicyReferenceSchema> {
  return {
    tenantId: policy.tenantId,
    id: policy.id,
    version: policy.version,
    policyHash: policy.policyHash
  };
}

function mapRuleOverrides<T extends { ruleId: string; ruleRevision: string }>(
  overrides: readonly T[],
  rules: ReadonlyMap<string, InboxV2DataLifecycleRule>
): Map<string, T> | null {
  const result = new Map<string, T>();
  for (const override of overrides) {
    const key = retentionRuleReferenceKey(override);
    if (!rules.has(key) || result.has(key)) return null;
    result.set(key, override);
  }
  return result;
}

function resolveRegistryDataClassDefinition(
  registryInput: unknown,
  dataClassId: string
): z.infer<typeof inboxV2DataClassDefinitionSchema> | null {
  if (!isInboxV2DataLifecycleRegistry(registryInput)) return null;
  const registry = registryInput;
  if (
    registry.schemaVersion !== INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION ||
    !Array.isArray(registry.dataClasses) ||
    !Array.isArray(registry.moduleContributions)
  ) {
    return null;
  }
  const matches = registry.dataClasses.filter(
    (entry) => String(entry.id) === dataClassId
  );
  if (matches.length !== 1) return null;
  const entry = matches[0]!;
  const definition = inboxV2DataClassDefinitionSchema.safeParse(
    entry.definition
  );
  if (!definition.success) return null;

  if (dataClassId.startsWith("core:")) {
    const canonical = INBOX_V2_CORE_DATA_CLASS_CATALOG.payload.entries.find(
      (candidate) => String(candidate.id) === dataClassId
    );
    if (
      entry.owner !== "core" ||
      canonical === undefined ||
      canonicalJson(definition.data) !== canonicalJson(canonical.definition)
    ) {
      return null;
    }
  } else {
    if (!dataClassId.startsWith("module:") || entry.owner === "core") {
      return null;
    }
    try {
      const recomposed = defineInboxV2DataLifecycleRegistry({
        moduleContributions: registry.moduleContributions
      });
      const canonical = recomposed.dataClasses.find(
        (candidate) => String(candidate.id) === dataClassId
      );
      if (
        canonical === undefined ||
        canonical.owner !== entry.owner ||
        canonicalJson(canonical.definition) !== canonicalJson(definition.data)
      ) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return definition.data;
}

function registryHasLifecycleHandler(
  registryInput: unknown,
  handlerId: string,
  kind: "condition_resolution" | "scope_matcher" | "lifecycle"
): boolean {
  if (!isInboxV2DataLifecycleRegistry(registryInput)) return false;
  const registry = registryInput;
  if (
    registry.schemaVersion !== INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION ||
    !Array.isArray(registry.handlers)
  ) {
    return false;
  }
  const handlers = registry.handlers.filter(
    (entry) => String(entry.id) === handlerId && entry.definition.kind === kind
  );
  return handlers.length === 1;
}

function registryDataUsesHaveRuleCoverage(
  registryInput: unknown,
  rules: ReadonlyMap<string, InboxV2DataLifecycleRule>
): boolean {
  if (!isInboxV2DataLifecycleRegistry(registryInput)) return false;
  if (!Array.isArray(registryInput.dataUses)) return false;
  return registryInput.dataUses.every((use) =>
    use.purposeIds.every((purposeId: string) =>
      rules.has(
        lifecycleRuleKey({
          dataClassId: String(use.dataClassId),
          purposeId: String(purposeId)
        })
      )
    )
  );
}

function registryRuleMatchesSafetyEnvelope(
  registryInput: unknown,
  rule: InboxV2DataLifecycleRule
): boolean {
  if (!isInboxV2DataLifecycleRegistry(registryInput)) return false;
  const dataClass = registryInput.dataClasses.find(
    (entry) => String(entry.id) === String(rule.dataClassId)
  );
  if (dataClass === undefined) return false;
  if (dataClass.owner === "core") return true;
  const envelopes = registryInput.retentionRules.filter(
    (entry) =>
      String(entry.definition.dataClassId) === String(rule.dataClassId) &&
      String(entry.definition.purposeId) === String(rule.purposeId)
  );
  if (envelopes.length !== 1) return false;
  const envelope = envelopes[0]!;
  return (
    envelope.owner === dataClass.owner &&
    String(envelope.id) === String(rule.id) &&
    String(envelope.definition.revision) === String(rule.revision) &&
    String(envelope.definition.retentionAnchorId) ===
      String(rule.retentionAnchorId) &&
    envelope.definition.actionAtExpiry === rule.actionAtExpiry &&
    envelope.definition.holdEligible === rule.holdEligible &&
    canonicalJson(envelope.definition.baselineWindow) ===
      canonicalJson(rule.baselineWindow) &&
    canonicalJson(envelope.definition.backupMaximum) ===
      canonicalJson(rule.backupMaximum)
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function addCanonicalRuleIssues(
  rules: readonly {
    id: string;
    revision: string;
    dataClassId: string;
    purposeId: string;
    holdEligible: boolean;
    actionAtExpiry: string;
  }[],
  context: z.RefinementCtx
): void {
  addCanonicalUniqueIssue(
    context,
    rules.map(lifecycleRuleKey),
    "Lifecycle rules"
  );
  if (new Set(rules.map(retentionRuleReferenceKey)).size !== rules.length) {
    addIssue(context, [], "Lifecycle rule identity must be unique.");
  }
  const holdEligibility = new Map<string, boolean>();
  const expiryActions = new Map<string, string>();
  for (const rule of rules) {
    const previous = holdEligibility.get(rule.dataClassId);
    if (previous !== undefined && previous !== rule.holdEligible) {
      addIssue(
        context,
        [],
        "Hold eligibility must be consistent for one data class."
      );
    }
    holdEligibility.set(rule.dataClassId, rule.holdEligible);
    const previousAction = expiryActions.get(rule.dataClassId);
    if (
      previousAction !== undefined &&
      previousAction !== rule.actionAtExpiry
    ) {
      addIssue(
        context,
        [],
        "Expiry action must be consistent for one data class across purposes."
      );
    }
    expiryActions.set(rule.dataClassId, rule.actionAtExpiry);
  }
}

function lifecycleRuleKey(rule: {
  dataClassId: string;
  purposeId: string;
}): string {
  return `${rule.dataClassId}\u0000${rule.purposeId}`;
}

function retentionRuleReferenceKey(rule: {
  id?: string;
  revision?: string;
  ruleId?: string;
  ruleRevision?: string;
}): string {
  return `${rule.id ?? rule.ruleId}\u0000${rule.revision ?? rule.ruleRevision}`;
}

function purposeInstanceKey(purpose: {
  purposeId: string;
  ruleId: string;
  ruleRevision: string;
}): string {
  return `${purpose.purposeId}\u0000${purpose.ruleId}\u0000${purpose.ruleRevision}`;
}

function purposeDeadlineKey(deadline: {
  purposeId: string;
  ruleId: string;
}): string {
  return `${deadline.purposeId}\u0000${deadline.ruleId}`;
}

function policyRuleImpactKey(diff: {
  dataClassId: string;
  purposeId: string;
}): string {
  return `${diff.dataClassId}\u0000${diff.purposeId}`;
}

function deriveInboxV2PolicyRuleImpactDiffs(
  currentPolicy: InboxV2EffectiveTenantPolicy | null,
  candidatePolicy: InboxV2EffectiveTenantPolicy
): Array<z.infer<typeof inboxV2PolicyRuleImpactDiffSchema>> {
  const priorRules = new Map(
    (currentPolicy?.rules ?? []).map((rule) => [lifecycleRuleKey(rule), rule])
  );
  const candidateRules = new Map(
    candidatePolicy.rules.map((rule) => [lifecycleRuleKey(rule), rule])
  );
  const keys = [
    ...new Set([...priorRules.keys(), ...candidateRules.keys()])
  ].sort();
  const diffs: Array<z.infer<typeof inboxV2PolicyRuleImpactDiffSchema>> = [];
  for (const key of keys) {
    const prior = priorRules.get(key) ?? null;
    const candidate = candidateRules.get(key) ?? null;
    const priorRuleHash =
      prior === null ? null : calculateInboxV2PolicyRuleHash(prior);
    const candidateRuleHash =
      candidate === null ? null : calculateInboxV2PolicyRuleHash(candidate);
    if (priorRuleHash === candidateRuleHash) continue;
    const identity = candidate ?? prior!;
    diffs.push({
      dataClassId: identity.dataClassId,
      purposeId: identity.purposeId,
      changeKind:
        prior === null ? "added" : candidate === null ? "removed" : "changed",
      retentionImpact:
        currentPolicy === null
          ? "initial_bootstrap"
          : prior === null
            ? "no_shortening"
            : "potentially_shorter",
      priorRuleHash,
      candidateRuleHash
    });
  }
  return diffs;
}

function calculateInboxV2PolicyRuleHash(rule: unknown) {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.effective-policy-rule",
    hashVersion: "v1",
    rule
  });
}

function versionedReferenceKey(
  reference: Pick<InboxV2VersionedProfileReference, "id" | "version">
): string {
  return `${reference.id}\u0000${reference.version}`;
}

function versionedReferenceKeyNullable(
  reference: Pick<InboxV2VersionedProfileReference, "id" | "version"> | null
): string | null {
  return reference === null ? null : versionedReferenceKey(reference);
}

function policyTemplateReferenceKey(reference: {
  id: string;
  version: string;
}): string {
  return `${reference.id}\u0000${reference.version}`;
}

function samePolicyReference(
  left: z.infer<typeof inboxV2DataLifecyclePolicyReferenceSchema>,
  right: z.infer<typeof inboxV2DataLifecyclePolicyReferenceSchema>
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.id === right.id &&
    left.version === right.version &&
    left.policyHash === right.policyHash
  );
}

function policyReferenceKey(reference: {
  tenantId: string;
  id: string;
  version: string;
  policyHash: string;
}): string {
  return `${reference.tenantId}\u0000${reference.id}\u0000${reference.version}\u0000${reference.policyHash}`;
}

function samePolicyActivationReference(
  left: z.infer<typeof inboxV2PolicyActivationReferenceSchema>,
  right: z.infer<typeof inboxV2PolicyActivationReferenceSchema>
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.id === right.id &&
    left.revision === right.revision &&
    left.activationHash === right.activationHash
  );
}

function activationReference(
  activation: z.infer<typeof inboxV2PolicyActivationSchema>
): z.infer<typeof inboxV2PolicyActivationReferenceSchema> {
  return {
    tenantId: activation.tenantId,
    id: activation.id,
    revision: activation.revision,
    activationHash: activation.activationHash
  };
}

function lifecycleControlSnapshotReference(
  snapshot: z.infer<typeof inboxV2LifecycleControlSnapshotSchema>
): z.infer<typeof inboxV2LifecycleControlSnapshotReferenceSchema> {
  return {
    tenantId: snapshot.tenantId,
    id: snapshot.id,
    revision: snapshot.revision,
    snapshotHash: snapshot.snapshotHash,
    capturedAt: snapshot.capturedAt,
    sourceState: snapshot.sourceState
  };
}

function authorizationPrincipalKey(
  decision: z.infer<typeof inboxV2AuthorizationDecisionReferenceSchema>
): string {
  return decision.principal.kind === "employee"
    ? `employee:${decision.principal.employee.id}`
    : `trusted_service:${decision.principal.trustedServiceId}`;
}

function isPolicyActivationAuthorizationValid(input: {
  decision: z.infer<typeof inboxV2AuthorizationDecisionReferenceSchema>;
  policy: InboxV2EffectiveTenantPolicy;
  checkedAt: string;
}): boolean {
  const { decision, policy } = input;
  return (
    decision.tenantId === policy.tenantId &&
    decision.outcome === "allowed" &&
    decision.permissionId === "core:privacy.policy.manage" &&
    decision.resourceScopeId === "core:data-lifecycle-policy" &&
    decision.resource.tenantId === policy.tenantId &&
    decision.resource.entityTypeId === "core:data-lifecycle-policy" &&
    String(decision.resource.entityId) === String(policy.id) &&
    String(decision.resourceAccessRevision) === String(policy.version) &&
    Date.parse(input.checkedAt) >= Date.parse(decision.decidedAt) &&
    Date.parse(input.checkedAt) < Date.parse(decision.notAfter)
  );
}

function isInboxV2TimestampOrderValidStrict(left: string, right: string) {
  return Date.parse(left) < Date.parse(right);
}

function restrictionKey(restriction: { id: string; revision: string }): string {
  return `${restriction.id}\u0000${restriction.revision}`;
}

function entityKey(entity: z.infer<typeof inboxV2EntityKeySchema>): string {
  return `${entity.tenantId}\u0000${entity.entityTypeId}\u0000${entity.entityId}`;
}

function holdKey(hold: { id: string; revision: string }): string {
  return `${hold.id}\u0000${hold.revision}`;
}

function compareTimestamp(left: string, right: string): -1 | 0 | 1 {
  const leftValue = Date.parse(left);
  const rightValue = Date.parse(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function earliestTimestamp(values: readonly string[]): string {
  return values.reduce((left, right) =>
    compareTimestamp(left, right) <= 0 ? left : right
  );
}

function latestTimestamp(values: readonly string[]): string {
  return values.reduce((left, right) =>
    compareTimestamp(left, right) >= 0 ? left : right
  );
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

function addUniqueControlRevisionIssues(
  context: z.RefinementCtx,
  ids: readonly string[],
  label: string
): void {
  if (new Set(ids).size !== ids.length) {
    addIssue(
      context,
      [],
      `${label} must contain exactly one current revision per ID.`
    );
  }
}

function rejectedResolution(
  errorCode: z.infer<
    typeof inboxV2EffectiveTenantPolicyResolutionErrorCodeSchema
  >
): InboxV2EffectiveTenantPolicyResolutionResult {
  return { kind: "rejected", errorCode };
}

function rejectedEvaluation(
  errorCode: DeadlineErrorCode
): InboxV2LifecycleEvaluation {
  return { outcome: "rejected", errorCode };
}

function authenticEvaluation<
  T extends Exclude<InboxV2LifecycleEvaluation, { outcome: "rejected" }>
>(evaluation: T): T {
  const frozen = deepFreezeLifecycleEvaluation(evaluation);
  definedInboxV2LifecycleEvaluations.add(frozen);
  return frozen;
}

function deepFreezeLifecycleEvaluation<T>(
  value: T,
  seen = new WeakSet<object>()
): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeLifecycleEvaluation(child, seen);
  }
  return Object.freeze(value);
}

function deepFreezePolicyValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezePolicyValue(child, seen);
  }
  return Object.freeze(value);
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
