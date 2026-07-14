import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2DataGovernanceContextReferenceSchema,
  isInboxV2DataGovernanceContext,
  matchesInboxV2DataGovernanceContextReference,
  type InboxV2DataGovernanceContext
} from "./data-governance";
import {
  isInboxV2DataLifecycleRegistry,
  type InboxV2DataLifecycleRegistry
} from "./data-lifecycle-catalog";
import {
  inboxV2DataLifecyclePolicyReferenceSchema,
  inboxV2LifecycleControlSnapshotReferenceSchema,
  inboxV2ParentDeadlineSnapshotSchema,
  inboxV2PolicyActivationReferenceSchema,
  getInboxV2EffectiveTenantPolicyGovernanceContext,
  getInboxV2CurrentPolicyActivationReference,
  isInboxV2CurrentActivatedEffectiveTenantPolicy,
  isInboxV2LifecycleEvaluation,
  isInboxV2LifecycleEvaluationCurrent,
  type InboxV2EffectiveTenantPolicy,
  type InboxV2PolicyActivationLedger,
  type InboxV2LifecycleEvaluation
} from "./data-lifecycle-policy";
import {
  inboxV2ExternalRouteIdSchema,
  inboxV2LifecycleActionSchema,
  inboxV2LifecycleHandlerIdSchema,
  inboxV2ProcessingPurposeIdSchema,
  inboxV2RetentionRuleIdSchema,
  inboxV2StorageRootKindSchema,
  inboxV2VersionedProfileReferenceSchema,
  INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION
} from "./data-lifecycle-primitives";
import { inboxV2DataRootReferenceSchema } from "./data-subject-discovery";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  assertInboxV2PrivacyRequestCurrentAuthority,
  inboxV2PrivacyDecisionIdSchema,
  inboxV2PrivacyRequestReferenceSchema
} from "./privacy-request";
import type { InboxV2PrivacyRequest } from "./privacy-request";
import {
  inboxV2PrivacyHoldDecisionReferenceSchema,
  inboxV2ProcessingRestrictionReferenceSchema,
  inboxV2PrivacyScopeManifestSchema,
  isInboxV2PrivacyScopeManifest
} from "./privacy-hold-restriction";
import { createInboxV2SchemaEnvelopeSchema } from "./schema-version";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  assertInboxV2PrivacyTerminalExportCurrent,
  hasInboxV2DeletionPlanAuthenticity,
  hasInboxV2DeletionRunAuthenticity,
  hasInboxV2PrivacyRequestAuthenticity,
  getInboxV2PrivacyRequestAuthenticity,
  registerInboxV2DeletionPlanAuthenticity,
  registerInboxV2DeletionRunAuthenticity
} from "./privacy-authenticity";
import {
  compareAndSetInboxV2TenantTerminationDestructiveScope,
  isInboxV2TenantTerminationScopeManifest,
  type InboxV2TenantTerminationScopeManifest
} from "./tenant-termination-scope";
import {
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2EntityKeySchema,
  inboxV2PayloadReferenceSchema,
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";

export const INBOX_V2_DELETION_PLAN_SCHEMA_ID =
  "core:inbox-v2.deletion-plan" as const;
export const INBOX_V2_DELETION_RUN_SCHEMA_ID =
  "core:inbox-v2.deletion-run" as const;
export const INBOX_V2_DELETION_EXECUTION_PROOF_SCHEMA_ID =
  "core:inbox-v2.deletion-execution-proof" as const;

export type InboxV2DeletionPlanId = Brand<string, "InboxV2DeletionPlanId">;
export type InboxV2DeletionRunId = Brand<string, "InboxV2DeletionRunId">;
export type InboxV2DeletionCheckpointId = Brand<
  string,
  "InboxV2DeletionCheckpointId"
>;

const deletionOpaqueIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export const inboxV2DeletionPlanIdSchema = deletionOpaqueIdSchema.transform(
  (value) => value as InboxV2DeletionPlanId
);
export const inboxV2DeletionRunIdSchema = deletionOpaqueIdSchema.transform(
  (value) => value as InboxV2DeletionRunId
);
export const inboxV2DeletionCheckpointIdSchema =
  deletionOpaqueIdSchema.transform(
    (value) => value as InboxV2DeletionCheckpointId
  );

export const inboxV2DeletionPlanReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    planId: inboxV2DeletionPlanIdSchema,
    revision: inboxV2EntityRevisionSchema,
    planHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2DeletionRunReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    runId: inboxV2DeletionRunIdSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict();

/** These causes remain distinct in command, evidence and reporting semantics. */
export const inboxV2DeletionCauseSchema = z.enum([
  "provider_message_delete",
  "employee_ui_delete",
  "retention_expiry",
  "privacy_erasure",
  "tenant_offboarding",
  "administrative_policy_purge"
]);

export const inboxV2DeletionRevisionFenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("matched"),
      expectedRevision: inboxV2EntityRevisionSchema,
      observedRevision: inboxV2EntityRevisionSchema
    })
    .strict()
    .superRefine((fence, context) => {
      if (fence.expectedRevision !== fence.observedRevision) {
        addIssue(
          context,
          ["observedRevision"],
          "A matched revision fence requires equal revisions."
        );
      }
    }),
  z
    .object({
      kind: z.literal("stale"),
      expectedRevision: inboxV2EntityRevisionSchema,
      observedRevision: inboxV2EntityRevisionSchema
    })
    .strict()
    .superRefine((fence, context) => {
      if (fence.expectedRevision === fence.observedRevision) {
        addIssue(
          context,
          ["observedRevision"],
          "A stale revision fence requires different revisions."
        );
      }
    })
]);

export const inboxV2DeletionHoldFenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clear") }).strict(),
  inboxV2PrivacyHoldDecisionReferenceSchema
    .extend({ kind: z.literal("blocked_by_legal_hold") })
    .strict()
]);

export const inboxV2DeletionRestrictionFenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    restrictions: z.array(inboxV2ProcessingRestrictionReferenceSchema).max(256),
    evaluatedAt: inboxV2TimestampSchema,
    decisionHash: inboxV2Sha256DigestSchema,
    restrictionExtendedRetention: z.literal(false)
  })
  .strict()
  .superRefine((fence, context) => {
    addCanonicalUniqueIssue(
      context,
      fence.restrictions.map(
        ({ restrictionId, revision }) => `${restrictionId}\u0000${revision}`
      ),
      ["restrictions"],
      "Deletion processing restrictions"
    );
    if (
      fence.restrictions.some(({ tenantId }) => tenantId !== fence.tenantId)
    ) {
      addIssue(
        context,
        ["restrictions"],
        "Deletion restriction evaluation cannot cross tenants."
      );
    }
  });

export const inboxV2DeletionExecutionFenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    plan: inboxV2DeletionPlanReferenceSchema,
    governance: inboxV2DataGovernanceContextReferenceSchema,
    policy: inboxV2DataLifecyclePolicyReferenceSchema,
    executionAuthorization: inboxV2AuthorizationDecisionReferenceSchema,
    revision: inboxV2DeletionRevisionFenceSchema,
    lineage: inboxV2DeletionRevisionFenceSchema,
    hold: inboxV2DeletionHoldFenceSchema,
    restriction: inboxV2DeletionRestrictionFenceSchema,
    checkedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((fence, context) => {
    const tenantIds = [
      fence.plan.tenantId,
      fence.governance.tenantId,
      fence.policy.tenantId,
      fence.executionAuthorization.tenantId,
      fence.restriction.tenantId,
      ...(fence.hold.kind === "blocked_by_legal_hold"
        ? [fence.hold.hold.tenantId]
        : [])
    ];
    if (tenantIds.some((value) => value !== fence.tenantId)) {
      addIssue(
        context,
        [],
        "Every destructive fence must bind one tenant and current policy/hold revisions."
      );
    }
    if (
      !isDeletionAuthorizationValidAt({
        decision: fence.executionAuthorization,
        permissionId: "core:privacy.deletion.execute",
        planId: fence.plan.planId,
        planRevision: fence.plan.revision,
        tenantId: fence.tenantId,
        checkedAt: fence.checkedAt
      }) ||
      fence.restriction.evaluatedAt !== fence.checkedAt
    ) {
      addIssue(
        context,
        ["executionAuthorization"],
        "Each destructive handler requires current exact-plan execution authority and restriction reevaluation."
      );
    }
  });

export const inboxV2DeletionPlanTargetSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    root: inboxV2DataRootReferenceSchema,
    entity: inboxV2EntityKeySchema,
    expectedEntityRevision: inboxV2EntityRevisionSchema,
    expectedLineageRevision: inboxV2EntityRevisionSchema,
    rootKind: inboxV2StorageRootKindSchema,
    boundary: z.literal("operated_data_plane"),
    action: inboxV2LifecycleActionSchema,
    deleteHandlerId: inboxV2LifecycleHandlerIdSchema,
    verificationHandlerId: inboxV2LifecycleHandlerIdSchema,
    sharedParentProof: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("not_shared") }).strict(),
      z
        .object({
          kind: z.literal("all_live_parents_eligible"),
          snapshot: inboxV2ParentDeadlineSnapshotSchema
        })
        .strict()
    ])
  })
  .strict()
  .superRefine((target, context) => {
    if (
      target.root.tenantId !== target.tenantId ||
      target.entity.tenantId !== target.tenantId ||
      target.rootKind === "external_route"
    ) {
      addIssue(
        context,
        [],
        "A local deletion target must be tenant-safe and inside the operated data plane."
      );
    }
  });

export const inboxV2DeletionCheckpointRequirementSchema = z
  .object({
    checkpointId: inboxV2DeletionCheckpointIdSchema,
    target: inboxV2DeletionPlanTargetSchema
  })
  .strict();

export const inboxV2BackupDeletionCheckpointRequirementSchema = z
  .object({
    checkpointId: inboxV2DeletionCheckpointIdSchema,
    backupRoot: inboxV2DataRootReferenceSchema,
    entity: inboxV2EntityKeySchema,
    expectedRootRevision: inboxV2EntityRevisionSchema,
    expectedLineageRevision: inboxV2EntityRevisionSchema,
    purposeId: inboxV2ProcessingPurposeIdSchema,
    policyRuleId: inboxV2RetentionRuleIdSchema,
    policyRuleRevision: inboxV2EntityRevisionSchema,
    latestPermittedExpiryAt: inboxV2TimestampSchema,
    action: inboxV2LifecycleActionSchema,
    rootKind: z.literal("backup"),
    boundary: z.literal("operated_data_plane"),
    expiryLedgerHandlerId: inboxV2LifecycleHandlerIdSchema,
    verificationHandlerId: inboxV2LifecycleHandlerIdSchema
  })
  .strict();

export const inboxV2ExternalDeletionCheckpointRequirementSchema = z
  .object({
    checkpointId: inboxV2DeletionCheckpointIdSchema,
    routeId: inboxV2ExternalRouteIdSchema,
    root: inboxV2DataRootReferenceSchema,
    rootKind: z.literal("external_route"),
    boundary: z.literal("outside_operated_data_plane"),
    externalDeleteHandlerId: inboxV2LifecycleHandlerIdSchema,
    target: inboxV2EntityKeySchema,
    expectedEntityRevision: inboxV2EntityRevisionSchema,
    expectedLineageRevision: inboxV2EntityRevisionSchema,
    action: inboxV2LifecycleActionSchema
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if (checkpoint.root.tenantId !== checkpoint.target.tenantId) {
      addIssue(
        context,
        ["root"],
        "External deletion root and target must bind one tenant."
      );
    }
  });

export const inboxV2DeletionApprovalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("not_required"),
      reason: z.enum([
        "automatic_retention",
        "provider_lifecycle",
        "user_scoped_content_action"
      ])
    })
    .strict(),
  z
    .object({
      kind: z.literal("separated_approval"),
      authorization: inboxV2AuthorizationDecisionReferenceSchema,
      approvedAt: inboxV2TimestampSchema
    })
    .strict()
]);

export const inboxV2DeletionDecisionBasisSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("lifecycle_policy")
    })
    .strict(),
  z
    .object({
      kind: z.literal("privacy_request"),
      request: inboxV2PrivacyRequestReferenceSchema,
      decisionId: inboxV2PrivacyDecisionIdSchema,
      decisionRevision: inboxV2EntityRevisionSchema,
      decisionDigest: inboxV2Sha256DigestSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider_lifecycle_event"),
      event: inboxV2EntityKeySchema,
      eventRevision: inboxV2EntityRevisionSchema,
      eventHash: inboxV2Sha256DigestSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("employee_content_action"),
      command: inboxV2EntityKeySchema,
      commandRevision: inboxV2EntityRevisionSchema,
      commandHash: inboxV2Sha256DigestSchema
    })
    .strict()
]);

export const inboxV2DeletionPlanSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2DeletionPlanIdSchema,
    revision: inboxV2EntityRevisionSchema,
    planHash: inboxV2Sha256DigestSchema,
    cause: inboxV2DeletionCauseSchema,
    decisionBasis: inboxV2DeletionDecisionBasisSchema,
    lifecycleEvaluationHashes: z.array(inboxV2Sha256DigestSchema).max(100_000),
    scopeKind: z.enum(["exact", "tenant_wide"]),
    scopeManifest: inboxV2PrivacyScopeManifestSchema,
    governance: inboxV2DataGovernanceContextReferenceSchema,
    policy: inboxV2DataLifecyclePolicyReferenceSchema,
    previewAuthorization: inboxV2AuthorizationDecisionReferenceSchema,
    approval: inboxV2DeletionApprovalSchema,
    executeAuthorization: inboxV2AuthorizationDecisionReferenceSchema,
    requestedAt: inboxV2TimestampSchema,
    executeNotBefore: inboxV2TimestampSchema,
    operatedCheckpoints: z
      .array(inboxV2DeletionCheckpointRequirementSchema)
      .min(1)
      .max(100_000),
    backupCheckpoints: z
      .array(inboxV2BackupDeletionCheckpointRequirementSchema)
      .max(10_000),
    externalCheckpoints: z
      .array(inboxV2ExternalDeletionCheckpointRequirementSchema)
      .max(10_000)
  })
  .strict()
  .superRefine((plan, context) => {
    const authorizationDecisions = [
      plan.previewAuthorization,
      plan.executeAuthorization,
      ...(plan.approval.kind === "separated_approval"
        ? [plan.approval.authorization]
        : [])
    ];
    const nestedTenantIds = [
      plan.governance.tenantId,
      plan.policy.tenantId,
      plan.scopeManifest.tenantId,
      ...authorizationDecisions.map(({ tenantId }) => tenantId),
      ...plan.operatedCheckpoints.flatMap(({ target }) => [
        target.tenantId,
        target.root.tenantId,
        target.entity.tenantId
      ]),
      ...plan.backupCheckpoints.map(({ backupRoot }) => backupRoot.tenantId),
      ...plan.externalCheckpoints.flatMap(({ root, target }) => [
        root.tenantId,
        target.tenantId
      ])
    ];
    if (
      nestedTenantIds.some((value) => value !== plan.tenantId) ||
      authorizationDecisions.some(({ outcome }) => outcome !== "allowed")
    ) {
      addIssue(
        context,
        [],
        "A deletion plan requires same-tenant allowed authorization and policy fences."
      );
    }
    const expectedBasisKind =
      plan.cause === "retention_expiry" ||
      plan.cause === "administrative_policy_purge"
        ? "lifecycle_policy"
        : plan.cause === "privacy_erasure" ||
            plan.cause === "tenant_offboarding"
          ? "privacy_request"
          : plan.cause === "provider_message_delete"
            ? "provider_lifecycle_event"
            : "employee_content_action";
    if (
      plan.decisionBasis.kind !== expectedBasisKind ||
      (plan.decisionBasis.kind === "privacy_request" &&
        plan.decisionBasis.request.tenantId !== plan.tenantId) ||
      (plan.decisionBasis.kind === "provider_lifecycle_event" &&
        plan.decisionBasis.event.tenantId !== plan.tenantId) ||
      (plan.decisionBasis.kind === "employee_content_action" &&
        plan.decisionBasis.command.tenantId !== plan.tenantId)
    ) {
      addIssue(
        context,
        ["decisionBasis"],
        "Deletion cause requires its exact same-tenant lifecycle, privacy, provider or employee decision basis."
      );
    }
    addCanonicalUniqueIssue(
      context,
      plan.lifecycleEvaluationHashes,
      ["lifecycleEvaluationHashes"],
      "Deletion lifecycle-evaluation hashes"
    );
    if (
      (plan.decisionBasis.kind === "lifecycle_policy" ||
        plan.backupCheckpoints.length > 0) &&
      plan.lifecycleEvaluationHashes.length === 0
    ) {
      addIssue(
        context,
        ["lifecycleEvaluationHashes"],
        "Lifecycle-driven and backup-bearing deletion plans require pinned policy-evaluation evidence."
      );
    }
    const authorizationChecks: readonly Readonly<{
      decision: z.infer<typeof inboxV2AuthorizationDecisionReferenceSchema>;
      permissionId:
        | "core:privacy.deletion.preview"
        | "core:privacy.deletion.approve"
        | "core:privacy.deletion.execute";
      checkedAt: string;
    }>[] = [
      {
        decision: plan.previewAuthorization,
        permissionId: "core:privacy.deletion.preview",
        checkedAt: plan.requestedAt
      },
      {
        decision: plan.executeAuthorization,
        permissionId: "core:privacy.deletion.execute",
        checkedAt: plan.executeNotBefore
      },
      ...(plan.approval.kind === "separated_approval"
        ? [
            {
              decision: plan.approval.authorization,
              permissionId: "core:privacy.deletion.approve" as const,
              checkedAt: plan.approval.approvedAt
            }
          ]
        : [])
    ];
    if (
      authorizationChecks.some(
        ({ decision, permissionId, checkedAt }) =>
          !isDeletionAuthorizationValidAt({
            decision,
            permissionId,
            planId: plan.id,
            planRevision: plan.revision,
            tenantId: plan.tenantId,
            checkedAt
          })
      )
    ) {
      addIssue(
        context,
        ["previewAuthorization"],
        "Deletion preview, approval and execution require exact-plan permissions valid at their decision fences."
      );
    }
    const highRiskCause = [
      "privacy_erasure",
      "tenant_offboarding",
      "administrative_policy_purge"
    ].includes(plan.cause);
    if (
      (highRiskCause || plan.scopeKind === "tenant_wide") &&
      plan.approval.kind !== "separated_approval"
    ) {
      addIssue(
        context,
        ["approval"],
        "Privacy and tenant-wide deletion require separated approval."
      );
    }
    if (plan.approval.kind === "not_required") {
      const expectedReason =
        plan.cause === "retention_expiry"
          ? "automatic_retention"
          : plan.cause === "provider_message_delete"
            ? "provider_lifecycle"
            : plan.cause === "employee_ui_delete"
              ? "user_scoped_content_action"
              : null;
      if (plan.approval.reason !== expectedReason) {
        addIssue(
          context,
          ["approval", "reason"],
          "Approval exemption must match its exact non-privacy deletion cause."
        );
      }
    }
    if (
      plan.approval.kind === "separated_approval" &&
      new Set([
        authorizationPrincipalKey(plan.previewAuthorization),
        authorizationPrincipalKey(plan.approval.authorization),
        authorizationPrincipalKey(plan.executeAuthorization)
      ]).size !== 3
    ) {
      addIssue(
        context,
        ["approval"],
        "Preview, approval and destructive execution require separate principals."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(plan.requestedAt, plan.executeNotBefore) ||
      ((highRiskCause || plan.scopeKind === "tenant_wide") &&
        plan.requestedAt === plan.executeNotBefore)
    ) {
      addIssue(
        context,
        ["executeNotBefore"],
        "High-risk destructive plans require an ordered non-zero cooling period."
      );
    }
    if (
      plan.approval.kind === "separated_approval" &&
      (!isInboxV2TimestampOrderValid(
        plan.requestedAt,
        plan.approval.approvedAt
      ) ||
        !isInboxV2TimestampOrderValid(
          plan.approval.approvedAt,
          plan.executeNotBefore
        ))
    ) {
      addIssue(
        context,
        ["approval", "approvedAt"],
        "Approval must occur after request and before destructive execution."
      );
    }
    if (
      plan.backupCheckpoints.some(
        ({ latestPermittedExpiryAt }) =>
          Date.parse(latestPermittedExpiryAt) <= Date.parse(plan.requestedAt)
      )
    ) {
      addIssue(
        context,
        ["backupCheckpoints"],
        "Backup checkpoints require a finite policy-bound expiry after plan creation."
      );
    }
    addCanonicalUniqueIssue(
      context,
      plan.operatedCheckpoints.map(({ checkpointId }) => checkpointId),
      ["operatedCheckpoints"],
      "Operated deletion checkpoints"
    );
    addCanonicalUniqueIssue(
      context,
      plan.backupCheckpoints.map(({ checkpointId }) => checkpointId),
      ["backupCheckpoints"],
      "Backup deletion checkpoints"
    );
    addCanonicalUniqueIssue(
      context,
      plan.externalCheckpoints.map(({ checkpointId }) => checkpointId),
      ["externalCheckpoints"],
      "External deletion checkpoints"
    );
    const allCheckpointIds = [
      ...plan.operatedCheckpoints,
      ...plan.backupCheckpoints,
      ...plan.externalCheckpoints
    ].map(({ checkpointId }) => checkpointId);
    if (new Set(allCheckpointIds).size !== allCheckpointIds.length) {
      addIssue(
        context,
        [],
        "Checkpoint IDs must be unique across all deletion surfaces."
      );
    }
  });

export const inboxV2DeletionStageOneSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }).strict(),
  z
    .object({
      state: z.literal("content_unavailable"),
      targets: z
        .array(
          z
            .object({
              checkpointId: inboxV2DeletionCheckpointIdSchema,
              root: inboxV2DataRootReferenceSchema,
              entity: inboxV2EntityKeySchema,
              expectedRevision: inboxV2EntityRevisionSchema,
              resultingRevision: inboxV2EntityRevisionSchema,
              tombstoneManifest: inboxV2PayloadReferenceSchema,
              invalidationDigest: inboxV2Sha256DigestSchema,
              committedAt: inboxV2TimestampSchema
            })
            .strict()
            .superRefine((entry, context) => {
              if (
                entry.root.tenantId !== entry.entity.tenantId ||
                entry.tombstoneManifest.tenantId !== entry.entity.tenantId ||
                BigInt(entry.resultingRevision) <=
                  BigInt(entry.expectedRevision)
              ) {
                addIssue(
                  context,
                  [],
                  "Stage-one target must be tenant-safe and advance its exact entity revision."
                );
              }
            })
        )
        .min(1)
        .max(100_000)
    })
    .strict()
    .superRefine((stage, context) =>
      addCanonicalUniqueIssue(
        context,
        stage.targets.map(({ checkpointId }) => checkpointId),
        ["targets"],
        "Stage-one target checkpoints"
      )
    )
]);

const operatedOutcomeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("verified_absent"),
      evidence: inboxV2PayloadReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("failed_retryable"),
      errorCode: inboxV2CatalogIdSchema,
      nextRetryAt: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("unverified_terminal"),
      errorCode: inboxV2CatalogIdSchema
    })
    .strict(),
  z.object({ kind: z.literal("blocked_by_legal_hold") }).strict(),
  z.object({ kind: z.literal("stale_revision") }).strict()
]);

export const inboxV2OperatedDeletionHandlerOutcomeSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    checkpointId: inboxV2DeletionCheckpointIdSchema,
    target: inboxV2DataRootReferenceSchema,
    deleteHandlerId: inboxV2LifecycleHandlerIdSchema,
    verificationHandlerId: inboxV2LifecycleHandlerIdSchema,
    attempt: inboxV2EntityRevisionSchema,
    fence: inboxV2DeletionExecutionFenceSchema,
    outcome: operatedOutcomeSchema,
    checkedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((entry, context) => {
    const evidenceTenantId =
      entry.outcome.kind === "verified_absent"
        ? entry.outcome.evidence.tenantId
        : entry.tenantId;
    if (
      entry.target.tenantId !== entry.tenantId ||
      entry.fence.tenantId !== entry.tenantId ||
      evidenceTenantId !== entry.tenantId
    ) {
      addIssue(
        context,
        [],
        "An operated deletion result cannot cross tenants."
      );
    }
    const requiresClearMatchedFence = [
      "verified_absent",
      "failed_retryable",
      "unverified_terminal"
    ].includes(entry.outcome.kind);
    if (
      (requiresClearMatchedFence &&
        (entry.fence.revision.kind !== "matched" ||
          entry.fence.lineage.kind !== "matched" ||
          entry.fence.hold.kind !== "clear")) ||
      (entry.outcome.kind === "blocked_by_legal_hold" &&
        (entry.fence.revision.kind !== "matched" ||
          entry.fence.lineage.kind !== "matched" ||
          entry.fence.hold.kind !== "blocked_by_legal_hold")) ||
      (entry.outcome.kind === "stale_revision" &&
        entry.fence.revision.kind !== "stale" &&
        entry.fence.lineage.kind !== "stale")
    ) {
      addIssue(
        context,
        ["outcome"],
        "Handler outcome must agree with its immediately checked revision and hold fences."
      );
    }
    if (
      entry.outcome.kind === "failed_retryable" &&
      (!isInboxV2TimestampOrderValid(
        entry.checkedAt,
        entry.outcome.nextRetryAt
      ) ||
        entry.checkedAt === entry.outcome.nextRetryAt)
    ) {
      addIssue(
        context,
        ["outcome", "nextRetryAt"],
        "A retryable handler failure requires a future retry boundary."
      );
    }
  });

const backupDeletionOutcomeBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  checkpointId: inboxV2DeletionCheckpointIdSchema,
  backupRoot: inboxV2DataRootReferenceSchema,
  rootKind: z.literal("backup"),
  boundary: z.literal("operated_data_plane"),
  expiryLedgerHandlerId: inboxV2LifecycleHandlerIdSchema,
  verificationHandlerId: inboxV2LifecycleHandlerIdSchema,
  attempt: inboxV2EntityRevisionSchema,
  fence: inboxV2DeletionExecutionFenceSchema,
  checkedAt: inboxV2TimestampSchema
} as const;

const successfulBackupDeletionOutcomeShape = {
  ...backupDeletionOutcomeBaseShape,
  primaryAbsenceEvidence: inboxV2PayloadReferenceSchema,
  expiryLedgerEvidence: inboxV2PayloadReferenceSchema,
  latestPossibleExpiryAt: inboxV2TimestampSchema
} as const;

export const inboxV2BackupDeletionOutcomeSchema = z
  .discriminatedUnion("state", [
    z
      .object({
        ...successfulBackupDeletionOutcomeShape,
        state: z.enum(["finite_expiry_pending", "expiry_verified"])
      })
      .strict(),
    z
      .object({
        ...backupDeletionOutcomeBaseShape,
        state: z.literal("failed_retryable"),
        errorCode: inboxV2CatalogIdSchema,
        nextRetryAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        ...backupDeletionOutcomeBaseShape,
        state: z.literal("unverified_terminal"),
        errorCode: inboxV2CatalogIdSchema
      })
      .strict(),
    z
      .object({
        ...backupDeletionOutcomeBaseShape,
        state: z.literal("blocked_by_legal_hold")
      })
      .strict(),
    z
      .object({
        ...backupDeletionOutcomeBaseShape,
        state: z.literal("stale_revision")
      })
      .strict()
  ])
  .superRefine((entry, context) => {
    const evidenceTenantIds =
      entry.state === "finite_expiry_pending" ||
      entry.state === "expiry_verified"
        ? [
            entry.primaryAbsenceEvidence.tenantId,
            entry.expiryLedgerEvidence.tenantId
          ]
        : [];
    if (
      [
        entry.backupRoot.tenantId,
        entry.fence.tenantId,
        ...evidenceTenantIds
      ].some((value) => value !== entry.tenantId)
    ) {
      addIssue(context, [], "Backup deletion evidence cannot cross tenants.");
    }
    if (entry.fence.checkedAt !== entry.checkedAt) {
      addIssue(
        context,
        ["fence", "checkedAt"],
        "Backup deletion evidence must use the immediately checked destructive fence."
      );
    }
    const requiresClearMatchedFence = [
      "finite_expiry_pending",
      "expiry_verified",
      "failed_retryable",
      "unverified_terminal"
    ].includes(entry.state);
    if (
      (requiresClearMatchedFence &&
        (entry.fence.revision.kind !== "matched" ||
          entry.fence.lineage.kind !== "matched" ||
          entry.fence.hold.kind !== "clear")) ||
      (entry.state === "blocked_by_legal_hold" &&
        (entry.fence.revision.kind !== "matched" ||
          entry.fence.lineage.kind !== "matched" ||
          entry.fence.hold.kind !== "blocked_by_legal_hold")) ||
      (entry.state === "stale_revision" &&
        entry.fence.revision.kind !== "stale" &&
        entry.fence.lineage.kind !== "stale")
    ) {
      addIssue(
        context,
        ["state"],
        "Backup outcome must agree with its immediately checked revision and hold fences."
      );
    }
    if (
      entry.state === "finite_expiry_pending" ||
      entry.state === "expiry_verified"
    ) {
      const expiryIsAfterCheck =
        Date.parse(entry.latestPossibleExpiryAt) > Date.parse(entry.checkedAt);
      if ((entry.state === "finite_expiry_pending") !== expiryIsAfterCheck) {
        addIssue(
          context,
          ["state"],
          "Backup pending versus verified state must match its finite expiry ledger."
        );
      }
    }
    if (
      entry.state === "failed_retryable" &&
      Date.parse(entry.nextRetryAt) <= Date.parse(entry.checkedAt)
    ) {
      addIssue(
        context,
        ["nextRetryAt"],
        "Retryable backup deletion requires a future retry boundary."
      );
    }
  });

export const inboxV2ExternalDeletionResidualSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    checkpointId: inboxV2DeletionCheckpointIdSchema,
    routeId: inboxV2ExternalRouteIdSchema,
    root: inboxV2DataRootReferenceSchema,
    boundary: z.literal("outside_operated_data_plane"),
    externalDeleteHandlerId: inboxV2LifecycleHandlerIdSchema,
    target: inboxV2EntityKeySchema,
    attempt: inboxV2EntityRevisionSchema,
    fence: inboxV2DeletionExecutionFenceSchema,
    outcome: z.enum([
      "requested",
      "confirmed",
      "unsupported",
      "unknown",
      "failed_retryable",
      "blocked_by_legal_hold",
      "stale_revision"
    ]),
    evidence: inboxV2PayloadReferenceSchema.nullable(),
    nextRetryAt: inboxV2TimestampSchema.nullable(),
    checkedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.root.tenantId !== entry.tenantId ||
      entry.target.tenantId !== entry.tenantId ||
      entry.fence.tenantId !== entry.tenantId ||
      (entry.evidence !== null && entry.evidence.tenantId !== entry.tenantId)
    ) {
      addIssue(context, [], "External deletion evidence cannot cross tenants.");
    }
    if (entry.fence.checkedAt !== entry.checkedAt) {
      addIssue(
        context,
        ["fence", "checkedAt"],
        "External deletion evidence must use the immediately checked destructive fence."
      );
    }
    const requiresClearMatchedFence = [
      "requested",
      "confirmed",
      "unsupported",
      "unknown",
      "failed_retryable"
    ].includes(entry.outcome);
    if (
      (requiresClearMatchedFence &&
        (entry.fence.revision.kind !== "matched" ||
          entry.fence.lineage.kind !== "matched" ||
          entry.fence.hold.kind !== "clear")) ||
      (entry.outcome === "blocked_by_legal_hold" &&
        (entry.fence.revision.kind !== "matched" ||
          entry.fence.lineage.kind !== "matched" ||
          entry.fence.hold.kind !== "blocked_by_legal_hold")) ||
      (entry.outcome === "stale_revision" &&
        entry.fence.revision.kind !== "stale" &&
        entry.fence.lineage.kind !== "stale")
    ) {
      addIssue(
        context,
        ["outcome"],
        "External deletion outcome must agree with its immediately checked revision and hold fences."
      );
    }
    if (
      (entry.outcome === "confirmed" && entry.evidence === null) ||
      (entry.outcome === "failed_retryable") !== (entry.nextRetryAt !== null) ||
      (entry.nextRetryAt !== null &&
        Date.parse(entry.nextRetryAt) <= Date.parse(entry.checkedAt))
    ) {
      addIssue(
        context,
        ["evidence"],
        "Confirmed and retryable external outcomes require exact evidence/retry timing."
      );
    }
  });

export const inboxV2DeletionCompletionResultSchema = z.enum([
  "completed",
  "completed_with_external_residuals",
  "primary_purged_backup_expiry_pending",
  "verification_blocked_internal_residual",
  "failed_retryable"
]);

const deletionRunBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  id: inboxV2DeletionRunIdSchema,
  revision: inboxV2EntityRevisionSchema,
  plan: inboxV2DeletionPlanReferenceSchema,
  stageOne: inboxV2DeletionStageOneSchema,
  requiredOperatedCheckpointIds: z
    .array(inboxV2DeletionCheckpointIdSchema)
    .min(1)
    .max(100_000),
  requiredBackupCheckpointIds: z
    .array(inboxV2DeletionCheckpointIdSchema)
    .max(10_000),
  requiredExternalCheckpointIds: z
    .array(inboxV2DeletionCheckpointIdSchema)
    .max(10_000),
  operatedOutcomes: z
    .array(inboxV2OperatedDeletionHandlerOutcomeSchema)
    .max(100_000),
  backupOutcomes: z.array(inboxV2BackupDeletionOutcomeSchema).max(10_000),
  externalResiduals: z.array(inboxV2ExternalDeletionResidualSchema).max(10_000),
  startedAt: inboxV2TimestampSchema,
  evaluatedAt: inboxV2TimestampSchema
} as const;

export const inboxV2DeletionRunSchema = z
  .discriminatedUnion("state", [
    z
      .object({
        ...deletionRunBaseShape,
        state: z.enum(["executing", "verification_pending"]),
        result: z.null()
      })
      .strict(),
    z
      .object({
        ...deletionRunBaseShape,
        state: z.literal("terminal"),
        result: inboxV2DeletionCompletionResultSchema
      })
      .strict()
  ])
  .superRefine((run, context) => {
    const allTenantIds = [
      run.plan.tenantId,
      ...(run.stageOne.state === "content_unavailable"
        ? run.stageOne.targets.flatMap((target) => [
            target.root.tenantId,
            target.entity.tenantId,
            target.tombstoneManifest.tenantId
          ])
        : []),
      ...run.operatedOutcomes.map(({ tenantId }) => tenantId),
      ...run.backupOutcomes.map(({ tenantId }) => tenantId),
      ...run.externalResiduals.map(({ tenantId }) => tenantId)
    ];
    if (allTenantIds.some((value) => value !== run.tenantId)) {
      addIssue(context, [], "A deletion run cannot cross tenants.");
    }
    for (const [path, required, actual] of [
      [
        "operatedOutcomes",
        run.requiredOperatedCheckpointIds,
        run.operatedOutcomes.map(({ checkpointId }) => checkpointId)
      ],
      [
        "backupOutcomes",
        run.requiredBackupCheckpointIds,
        run.backupOutcomes.map(({ checkpointId }) => checkpointId)
      ],
      [
        "externalResiduals",
        run.requiredExternalCheckpointIds,
        run.externalResiduals.map(({ checkpointId }) => checkpointId)
      ]
    ] as const) {
      addCanonicalUniqueIssue(
        context,
        required,
        [`required${path[0]!.toUpperCase()}${path.slice(1, -1)}Ids`],
        `Required ${path}`
      );
      addCanonicalUniqueIssue(context, actual, [path], `Recorded ${path}`);
      if (
        run.state === "terminal" &&
        (required.length !== actual.length ||
          required.some((value, index) => value !== actual[index]))
      ) {
        addIssue(
          context,
          [path],
          `Terminal deletion requires exact outcomes for every required ${path}.`
        );
      }
    }
    if (
      run.state === "terminal" &&
      run.stageOne.state !== "content_unavailable"
    ) {
      addIssue(
        context,
        ["stageOne"],
        "Deletion cannot terminate before transactional content unavailability."
      );
    }
    if (run.stageOne.state === "content_unavailable") {
      const stageCheckpointIds = run.stageOne.targets.map(
        ({ checkpointId }) => checkpointId
      );
      if (
        stageCheckpointIds.length !==
          run.requiredOperatedCheckpointIds.length ||
        stageCheckpointIds.some(
          (value, index) => value !== run.requiredOperatedCheckpointIds[index]
        )
      ) {
        addIssue(
          context,
          ["stageOne", "targets"],
          "Stage one requires exact per-operated-checkpoint unavailability proof."
        );
      }
    }
    for (const [path, checkedAt] of [
      ...run.operatedOutcomes.map(
        ({ checkedAt }) => ["operatedOutcomes", checkedAt] as const
      ),
      ...run.backupOutcomes.map(
        ({ checkedAt }) => ["backupOutcomes", checkedAt] as const
      ),
      ...run.externalResiduals.map(
        ({ checkedAt }) => ["externalResiduals", checkedAt] as const
      )
    ]) {
      if (
        run.stageOne.state === "content_unavailable" &&
        (run.stageOne.targets.some(
          ({ committedAt }) =>
            !isInboxV2TimestampOrderValid(committedAt, checkedAt)
        ) ||
          !isInboxV2TimestampOrderValid(checkedAt, run.evaluatedAt))
      ) {
        addIssue(
          context,
          [path],
          "Deletion checkpoint evidence must follow stage one and precede run evaluation."
        );
      }
    }
    if (
      !isInboxV2TimestampOrderValid(run.startedAt, run.evaluatedAt) ||
      (run.stageOne.state === "content_unavailable" &&
        run.stageOne.targets.some(
          ({ committedAt }) =>
            !isInboxV2TimestampOrderValid(run.startedAt, committedAt) ||
            !isInboxV2TimestampOrderValid(committedAt, run.evaluatedAt)
        ))
    ) {
      addIssue(
        context,
        ["evaluatedAt"],
        "Deletion run timestamps must follow start, stage-one commit and evaluation order."
      );
    }
    if (
      run.stageOne.state === "pending" &&
      (run.operatedOutcomes.length > 0 ||
        run.backupOutcomes.length > 0 ||
        run.externalResiduals.length > 0)
    ) {
      addIssue(
        context,
        ["stageOne"],
        "Physical deletion cannot start before stage-one unavailability commits."
      );
    }
    const derived = deriveInboxV2DeletionCompletionResult({
      operatedOutcomes: run.operatedOutcomes,
      backupOutcomes: run.backupOutcomes,
      externalResiduals: run.externalResiduals
    });
    if (run.state === "terminal" && run.result !== derived) {
      addIssue(
        context,
        ["result"],
        "Deletion result is derived from handler proof and cannot be caller-selected."
      );
    }
    if (
      (run.state === "terminal" &&
        run.operatedOutcomes.some(
          ({ outcome }) => outcome.kind === "blocked_by_legal_hold"
        )) ||
      run.backupOutcomes.some(
        ({ state }) => state === "blocked_by_legal_hold"
      ) ||
      run.externalResiduals.some(
        ({ outcome }) => outcome === "blocked_by_legal_hold"
      )
    ) {
      addIssue(
        context,
        ["state"],
        "A legal-hold block keeps deletion non-terminal for reevaluation."
      );
    }
  });

export const inboxV2DeletionExecutionControlHighWaterSchema = z
  .object({
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    completeThroughPosition: inboxV2TenantStreamPositionSchema,
    legalHoldSetRevision: inboxV2EntityRevisionSchema,
    restrictionSetRevision: inboxV2EntityRevisionSchema,
    sourceStateHash: inboxV2Sha256DigestSchema,
    capturedAt: inboxV2TimestampSchema
  })
  .strict();

const inboxV2DeletionExecutionSourceResultSchema = z
  .object({
    executionControlHighWater: inboxV2DeletionExecutionControlHighWaterSchema,
    stageOne: inboxV2DeletionStageOneSchema,
    operatedOutcomes: z
      .array(inboxV2OperatedDeletionHandlerOutcomeSchema)
      .max(100_000),
    backupOutcomes: z.array(inboxV2BackupDeletionOutcomeSchema).max(10_000),
    externalResiduals: z
      .array(inboxV2ExternalDeletionResidualSchema)
      .max(10_000),
    resolvedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.executionControlHighWater.capturedAt !== result.resolvedAt ||
      [
        ...result.operatedOutcomes,
        ...result.backupOutcomes,
        ...result.externalResiduals
      ].some(
        ({ checkedAt }) => Date.parse(checkedAt) > Date.parse(result.resolvedAt)
      )
    ) {
      addIssue(
        context,
        ["executionControlHighWater"],
        "Deletion execution results require a complete control high-water at their exact resolution time."
      );
    }
  });

export const inboxV2DeletionExecutionProofSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    source: inboxV2VersionedProfileReferenceSchema,
    registryCompositionHash: inboxV2Sha256DigestSchema,
    plan: inboxV2DeletionPlanReferenceSchema,
    policy: inboxV2DataLifecyclePolicyReferenceSchema,
    policyActivation: inboxV2PolicyActivationReferenceSchema,
    lifecycleControlSnapshots: z
      .array(inboxV2LifecycleControlSnapshotReferenceSchema)
      .max(100_000),
    handlerIds: z.array(inboxV2LifecycleHandlerIdSchema).min(2).max(100_000),
    executionControlHighWater: inboxV2DeletionExecutionControlHighWaterSchema,
    stageOne: inboxV2DeletionStageOneSchema,
    stageOneHash: inboxV2Sha256DigestSchema,
    operatedOutcomes: z
      .array(inboxV2OperatedDeletionHandlerOutcomeSchema)
      .max(100_000),
    backupOutcomes: z.array(inboxV2BackupDeletionOutcomeSchema).max(10_000),
    externalResiduals: z
      .array(inboxV2ExternalDeletionResidualSchema)
      .max(10_000),
    outcomesHash: inboxV2Sha256DigestSchema,
    startedAt: inboxV2TimestampSchema,
    resolvedAt: inboxV2TimestampSchema,
    proofHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((proof, context) => {
    if (
      proof.plan.tenantId !== proof.tenantId ||
      proof.policy.tenantId !== proof.tenantId ||
      proof.policyActivation.tenantId !== proof.tenantId ||
      proof.lifecycleControlSnapshots.some(
        ({ tenantId: snapshotTenantId }) => snapshotTenantId !== proof.tenantId
      )
    ) {
      addIssue(
        context,
        [],
        "Deletion execution proof cannot cross tenant boundaries."
      );
    }
    addCanonicalUniqueIssue(
      context,
      proof.handlerIds,
      ["handlerIds"],
      "Deletion execution handlers"
    );
    addCanonicalUniqueIssue(
      context,
      proof.lifecycleControlSnapshots.map(
        ({ id, revision, snapshotHash }) =>
          `${id}\u0000${revision}\u0000${snapshotHash}`
      ),
      ["lifecycleControlSnapshots"],
      "Deletion lifecycle control snapshots"
    );
    if (
      proof.stageOneHash !==
      calculateInboxV2DeletionStageOneProofHash(proof.stageOne)
    ) {
      addIssue(
        context,
        ["stageOneHash"],
        "Stage-one hash must bind the authentic transactional commit result."
      );
    }
    if (
      proof.outcomesHash !==
      calculateInboxV2DeletionOutcomesProofHash({
        operatedOutcomes: proof.operatedOutcomes,
        backupOutcomes: proof.backupOutcomes,
        externalResiduals: proof.externalResiduals
      })
    ) {
      addIssue(
        context,
        ["outcomesHash"],
        "Outcome hash must bind every trusted handler result."
      );
    }
    if (
      proof.executionControlHighWater.capturedAt !== proof.resolvedAt ||
      proof.proofHash !== calculateInboxV2DeletionExecutionProofHash(proof)
    ) {
      addIssue(
        context,
        ["proofHash"],
        "Execution proof hash must bind current policy, controls and all handler evidence."
      );
    }
  });

export type InboxV2DeletionExecutionSource = Readonly<{
  id: string;
  version: string;
  handlerIds: readonly string[];
  loadCompleteExecution: (
    input: Readonly<{
      plan: InboxV2DeletionPlan;
      policy: InboxV2EffectiveTenantPolicy;
      startedAt: string;
    }>
  ) => z.input<typeof inboxV2DeletionExecutionSourceResultSchema>;
}>;

export type InboxV2DeletionExecutionProof = z.infer<
  typeof inboxV2DeletionExecutionProofSchema
>;

const definedInboxV2DeletionExecutionSources = new WeakSet<object>();
const definedInboxV2DeletionExecutionProofs = new WeakSet<object>();

export function isInboxV2DeletionExecutionProof(
  value: unknown
): value is InboxV2DeletionExecutionProof {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2DeletionExecutionProofs.has(value)
  );
}

/** Registers the server-owned deletion orchestrator and its catalog handlers. */
export function defineInboxV2DeletionExecutionSource(input: {
  id: string;
  version: string;
  handlerIds: readonly string[];
  loadCompleteExecution: InboxV2DeletionExecutionSource["loadCompleteExecution"];
}): InboxV2DeletionExecutionSource {
  const reference = inboxV2VersionedProfileReferenceSchema.parse({
    id: input.id,
    version: input.version
  });
  const handlerIds = z
    .array(inboxV2LifecycleHandlerIdSchema)
    .min(2)
    .max(100_000)
    .parse([...input.handlerIds].sort());
  if (new Set(handlerIds).size !== handlerIds.length) {
    throw new Error("Deletion execution source handler IDs must be unique.");
  }
  const source = Object.freeze({
    ...reference,
    handlerIds: Object.freeze(handlerIds),
    loadCompleteExecution: input.loadCompleteExecution
  });
  definedInboxV2DeletionExecutionSources.add(source);
  return source;
}

export function calculateInboxV2DeletionStageOneProofHash(stageOne: unknown) {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.deletion-stage-one-proof",
    hashVersion: "v1",
    stageOne
  });
}

export function calculateInboxV2DeletionOutcomesProofHash(input: {
  operatedOutcomes: unknown;
  backupOutcomes: unknown;
  externalResiduals: unknown;
}) {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.deletion-outcomes-proof",
    hashVersion: "v1",
    outcomes: input
  });
}

export function calculateInboxV2DeletionExecutionProofHash(input: {
  proofHash?: unknown;
  [key: string]: unknown;
}) {
  const { proofHash: _ignored, ...proof } = input;
  return calculateInboxV2CanonicalSha256({
    domain: INBOX_V2_DELETION_EXECUTION_PROOF_SCHEMA_ID,
    hashVersion: "v1",
    proof
  });
}

/**
 * Loads execution evidence through one registered server-owned source and
 * seals it together with the current policy/control high-water. Plain outcome
 * objects never become execution authority by satisfying a public schema.
 */
export function resolveInboxV2DeletionExecutionProof(input: {
  source: InboxV2DeletionExecutionSource;
  registry: InboxV2DataLifecycleRegistry;
  plan: InboxV2DeletionPlan;
  governanceContext?: InboxV2DataGovernanceContext;
  policy: InboxV2EffectiveTenantPolicy;
  activationLedger: InboxV2PolicyActivationLedger;
  lifecycleEvaluations?: readonly InboxV2LifecycleEvaluation[];
  privacyRequest?: InboxV2PrivacyRequest;
  tenantTerminationScope?: InboxV2TenantTerminationScopeManifest;
  startedAt: string;
}): InboxV2DeletionExecutionProof {
  const governanceContext =
    input.governanceContext ??
    getInboxV2EffectiveTenantPolicyGovernanceContext(input.policy);
  if (
    !definedInboxV2DeletionExecutionSources.has(input.source) ||
    !isInboxV2DataLifecycleRegistry(input.registry) ||
    !isInboxV2DeletionPlan(input.plan)
  ) {
    throw new Error(
      "Deletion execution proof requires an authentic plan, registry and registered execution source."
    );
  }
  if (input.policy.registryCompositionHash !== input.registry.compositionHash) {
    throw new Error(
      "Deletion execution proof registry must match the current policy composition."
    );
  }
  const lifecycleEvaluations = input.lifecycleEvaluations ?? [];
  requireCurrentDeletionAuthority({
    plan: input.plan,
    policy: input.policy,
    activationLedger: input.activationLedger,
    lifecycleEvaluations,
    evaluatedAt: input.plan.requestedAt
  });
  requireExactLifecycleEvaluationHashes(input.plan, lifecycleEvaluations);
  const activation = getInboxV2CurrentPolicyActivationReference({
    ledger: input.activationLedger,
    policy: input.policy
  });
  if (activation === null) {
    throw new Error(
      "Deletion execution proof requires a current policy activation fence."
    );
  }
  const requiredHandlerIds = requiredDeletionHandlerIds(input.plan);
  if (
    input.source.handlerIds.length !== requiredHandlerIds.length ||
    input.source.handlerIds.some(
      (handlerId, index) => handlerId !== requiredHandlerIds[index]
    ) ||
    requiredHandlerIds.some(
      (handlerId) => !input.registry.handlers.some(({ id }) => id === handlerId)
    )
  ) {
    throw new Error(
      "Deletion execution source must bind the exact registered plan handlers."
    );
  }
  const startedAt = inboxV2TimestampSchema.parse(input.startedAt);
  if (
    !isInboxV2TimestampOrderValid(input.plan.executeNotBefore, startedAt) ||
    Date.parse(startedAt) >=
      Date.parse(input.plan.executeAuthorization.notAfter)
  ) {
    throw new Error(
      "Deletion execution proof must start inside the current plan authorization window."
    );
  }
  if (
    governanceContext === null ||
    !isInboxV2DataGovernanceContext(governanceContext) ||
    !matchesInboxV2DataGovernanceContextReference({
      context: governanceContext,
      reference: input.plan.governance
    }) ||
    !matchesInboxV2DataGovernanceContextReference({
      context: governanceContext,
      reference: input.policy.governanceContextRef
    }) ||
    Date.parse(startedAt) < Date.parse(governanceContext.effectiveAt) ||
    Date.parse(startedAt) >= Date.parse(governanceContext.reviewAt)
  ) {
    throw new Error(
      "Deletion execution requires current governance before destructive I/O."
    );
  }
  requireDeletionPrivacyDecisionCoverage({
    plan: input.plan,
    privacyRequest: input.privacyRequest
  });
  if (input.privacyRequest !== undefined) {
    assertInboxV2PrivacyRequestCurrentAuthority({
      request: input.privacyRequest,
      governanceContext,
      policy: input.policy,
      policyActivationLedger: input.activationLedger,
      checkedAt: startedAt
    });
  }
  requireTenantTerminationExecutionAuthority({
    plan: input.plan,
    privacyRequest: input.privacyRequest,
    tenantTerminationScope: input.tenantTerminationScope,
    checkedAt: startedAt
  });
  const result = inboxV2DeletionExecutionSourceResultSchema.parse(
    input.source.loadCompleteExecution({
      plan: input.plan,
      policy: input.policy,
      startedAt
    })
  );
  if (
    !isInboxV2TimestampOrderValid(startedAt, result.resolvedAt) ||
    Date.parse(result.resolvedAt) >= Date.parse(governanceContext.reviewAt)
  ) {
    throw new Error(
      "Deletion execution source resolved before its exact run start."
    );
  }
  requireDeletionExecutionEvidenceMatchesPlan({
    plan: input.plan,
    stageOne: result.stageOne,
    operatedOutcomes: result.operatedOutcomes,
    backupOutcomes: result.backupOutcomes,
    externalResiduals: result.externalResiduals
  });
  type AuthenticEvaluation = Exclude<
    InboxV2LifecycleEvaluation,
    { outcome: "rejected" }
  >;
  const controlSnapshots = (
    lifecycleEvaluations as readonly AuthenticEvaluation[]
  )
    .map(({ controlSnapshot }) => controlSnapshot)
    .sort((left, right) =>
      `${left.id}\u0000${left.revision}\u0000${left.snapshotHash}`.localeCompare(
        `${right.id}\u0000${right.revision}\u0000${right.snapshotHash}`
      )
    );
  const proofBody = {
    tenantId: input.plan.tenantId,
    source: { id: input.source.id, version: input.source.version },
    registryCompositionHash: input.registry.compositionHash,
    plan: deletionPlanReference(input.plan),
    policy: input.plan.policy,
    policyActivation: activation,
    lifecycleControlSnapshots: controlSnapshots,
    handlerIds: requiredHandlerIds,
    executionControlHighWater: result.executionControlHighWater,
    stageOne: result.stageOne,
    stageOneHash: calculateInboxV2DeletionStageOneProofHash(result.stageOne),
    operatedOutcomes: result.operatedOutcomes,
    backupOutcomes: result.backupOutcomes,
    externalResiduals: result.externalResiduals,
    outcomesHash: calculateInboxV2DeletionOutcomesProofHash({
      operatedOutcomes: result.operatedOutcomes,
      backupOutcomes: result.backupOutcomes,
      externalResiduals: result.externalResiduals
    }),
    startedAt,
    resolvedAt: result.resolvedAt
  };
  const proof = cloneAndFreeze(
    inboxV2DeletionExecutionProofSchema.parse({
      ...proofBody,
      proofHash: calculateInboxV2DeletionExecutionProofHash(proofBody)
    })
  );
  definedInboxV2DeletionExecutionProofs.add(proof);
  return proof;
}

export function deriveInboxV2DeletionCompletionResult(input: {
  operatedOutcomes: readonly z.input<
    typeof inboxV2OperatedDeletionHandlerOutcomeSchema
  >[];
  backupOutcomes: readonly z.input<typeof inboxV2BackupDeletionOutcomeSchema>[];
  externalResiduals: readonly z.input<
    typeof inboxV2ExternalDeletionResidualSchema
  >[];
}): z.infer<typeof inboxV2DeletionCompletionResultSchema> | null {
  const operated = z
    .array(inboxV2OperatedDeletionHandlerOutcomeSchema)
    .safeParse(input.operatedOutcomes);
  const backups = z
    .array(inboxV2BackupDeletionOutcomeSchema)
    .safeParse(input.backupOutcomes);
  const external = z
    .array(inboxV2ExternalDeletionResidualSchema)
    .safeParse(input.externalResiduals);
  if (!operated.success || !backups.success || !external.success) {
    return "verification_blocked_internal_residual";
  }
  if (
    operated.data.some(
      ({ outcome }) => outcome.kind === "blocked_by_legal_hold"
    ) ||
    backups.data.some(({ state }) => state === "blocked_by_legal_hold") ||
    external.data.some(({ outcome }) => outcome === "blocked_by_legal_hold")
  ) {
    return null;
  }
  if (
    operated.data.some(({ outcome }) =>
      ["unverified_terminal", "stale_revision"].includes(outcome.kind)
    ) ||
    backups.data.some(({ state }) =>
      ["unverified_terminal", "stale_revision"].includes(state)
    ) ||
    external.data.some(({ outcome }) => outcome === "stale_revision")
  ) {
    return "verification_blocked_internal_residual";
  }
  if (
    operated.data.some(({ outcome }) => outcome.kind === "failed_retryable") ||
    backups.data.some(({ state }) => state === "failed_retryable")
  ) {
    return "failed_retryable";
  }
  if (external.data.some(({ outcome }) => outcome === "failed_retryable")) {
    return "failed_retryable";
  }
  if (backups.data.some(({ state }) => state === "finite_expiry_pending")) {
    return "primary_purged_backup_expiry_pending";
  }
  if (external.data.some(({ outcome }) => !["confirmed"].includes(outcome))) {
    return "completed_with_external_residuals";
  }
  return "completed";
}

export const inboxV2DeletionPlanEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_DELETION_PLAN_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2DeletionPlanSchema
  );
export const inboxV2DeletionRunEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_DELETION_RUN_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2DeletionRunSchema
  );

export type InboxV2DeletionCause = z.infer<typeof inboxV2DeletionCauseSchema>;
export type InboxV2DeletionPlan = z.infer<typeof inboxV2DeletionPlanSchema>;
export type InboxV2OperatedDeletionHandlerOutcome = z.infer<
  typeof inboxV2OperatedDeletionHandlerOutcomeSchema
>;
export type InboxV2BackupDeletionOutcome = z.infer<
  typeof inboxV2BackupDeletionOutcomeSchema
>;
export type InboxV2ExternalDeletionResidual = z.infer<
  typeof inboxV2ExternalDeletionResidualSchema
>;
export type InboxV2DeletionRun = z.infer<typeof inboxV2DeletionRunSchema>;

/** Only registry- and decision-bound constructors may create executable plans. */
export function isInboxV2DeletionPlan(
  value: unknown
): value is InboxV2DeletionPlan {
  return (
    typeof value === "object" &&
    value !== null &&
    hasInboxV2DeletionPlanAuthenticity(value)
  );
}

/** Runtime guard used by composite privacy-request execution proofs. */
export function isInboxV2DeletionRun(
  value: unknown
): value is InboxV2DeletionRun {
  return (
    typeof value === "object" &&
    value !== null &&
    hasInboxV2DeletionRunAuthenticity(value)
  );
}

/**
 * Registry-bound constructor for an executable destructive plan. Every root,
 * class and handler is resolved from the composed immutable registry; a plain
 * namespaced string is never sufficient deletion authority.
 */
export function defineInboxV2DeletionPlan(input: {
  plan: z.input<typeof inboxV2DeletionPlanSchema>;
  registry: InboxV2DataLifecycleRegistry;
  governanceContext?: InboxV2DataGovernanceContext;
  policy: InboxV2EffectiveTenantPolicy;
  activationLedger: InboxV2PolicyActivationLedger;
  lifecycleEvaluations?: readonly InboxV2LifecycleEvaluation[];
  privacyRequest?: InboxV2PrivacyRequest;
  tenantTerminationScope?: InboxV2TenantTerminationScopeManifest;
}): InboxV2DeletionPlan {
  const governanceContext =
    input.governanceContext ??
    getInboxV2EffectiveTenantPolicyGovernanceContext(input.policy);
  if (!isInboxV2DataLifecycleRegistry(input.registry)) {
    throw new Error("Deletion plan requires an authentic composed registry.");
  }
  if (input.policy.registryCompositionHash !== input.registry.compositionHash) {
    throw new Error(
      "Deletion plan registry must match the exact activated-policy composition."
    );
  }
  if (
    governanceContext === null ||
    !isInboxV2DataGovernanceContext(governanceContext) ||
    !matchesInboxV2DataGovernanceContextReference({
      context: governanceContext,
      reference: input.plan.governance
    }) ||
    !matchesInboxV2DataGovernanceContextReference({
      context: governanceContext,
      reference: input.policy.governanceContextRef
    }) ||
    Date.parse(input.plan.requestedAt) <
      Date.parse(governanceContext.effectiveAt) ||
    Date.parse(input.plan.executeNotBefore) >=
      Date.parse(governanceContext.reviewAt)
  ) {
    throw new Error(
      "Deletion plan requires the exact current governance context through its execution fence."
    );
  }
  if (!isInboxV2PrivacyScopeManifest(input.plan.scopeManifest)) {
    throw new Error(
      "Deletion plan requires an authentic frozen privacy scope manifest."
    );
  }
  const plan = inboxV2DeletionPlanSchema.parse(input.plan);
  const lifecycleEvaluations = input.lifecycleEvaluations ?? [];
  requireCurrentDeletionAuthority({
    plan,
    policy: input.policy,
    activationLedger: input.activationLedger,
    lifecycleEvaluations,
    evaluatedAt: plan.requestedAt
  });
  if (plan.planHash !== calculateInboxV2DeletionPlanHash(plan)) {
    throw new Error(
      "Deletion plan hash does not match its canonical destructive scope and fences."
    );
  }
  requireDeletionScopeCoverage(plan);
  if (
    lifecycleEvaluations.some(
      (evaluation) => !isInboxV2LifecycleEvaluation(evaluation)
    )
  ) {
    throw new Error(
      "Deletion plan requires authentic immutable lifecycle evaluations."
    );
  }
  const evaluationHashes = lifecycleEvaluations
    .map(calculateInboxV2DeletionLifecycleEvaluationHash)
    .sort();
  if (
    evaluationHashes.length !== plan.lifecycleEvaluationHashes.length ||
    evaluationHashes.some(
      (value, index) => value !== plan.lifecycleEvaluationHashes[index]
    )
  ) {
    throw new Error(
      "Deletion plan lifecycle-evaluation hashes do not match loaded decisions."
    );
  }
  requireDeletionLifecycleEvaluationCoverage({
    plan,
    evaluations: lifecycleEvaluations
  });
  requireDeletionPrivacyDecisionCoverage({
    plan,
    privacyRequest: input.privacyRequest
  });
  if (input.privacyRequest !== undefined) {
    assertInboxV2PrivacyRequestCurrentAuthority({
      request: input.privacyRequest,
      governanceContext,
      policy: input.policy,
      policyActivationLedger: input.activationLedger,
      checkedAt: plan.requestedAt
    });
  }
  const classById = new Map(
    input.registry.dataClasses.map((entry) => [String(entry.id), entry])
  );
  const rootById = new Map(
    input.registry.storageRoots.map((entry) => [String(entry.id), entry])
  );
  const handlerById = new Map(
    input.registry.handlers.map((entry) => [String(entry.id), entry])
  );

  for (const { target } of plan.operatedCheckpoints) {
    const dataClass = classById.get(String(target.root.dataClassId));
    const root = rootById.get(String(target.root.storageRootId));
    if (dataClass === undefined) {
      throw new Error(
        `Unknown deletion data class ${target.root.dataClassId}.`
      );
    }
    if (root === undefined) {
      throw new Error(
        `Unknown deletion storage root ${target.root.storageRootId}.`
      );
    }
    if (
      root.definition.kind !== target.rootKind ||
      root.definition.boundary !== target.boundary ||
      !dataClass.definition.allowedExpiryActions.includes(target.action)
    ) {
      throw new Error(
        `Deletion target ${target.root.recordId} does not match its registered class/root policy.`
      );
    }
    if (dataClass.definition.parentBehavior === "inherits_all_live_parents") {
      const proof = target.sharedParentProof;
      if (
        proof.kind !== "all_live_parents_eligible" ||
        !isExactEntityKey(proof.snapshot.child, target.entity) ||
        proof.snapshot.childRevision !== target.expectedEntityRevision ||
        proof.snapshot.lineageRevision !== target.expectedLineageRevision ||
        proof.snapshot.resolvedAt !== plan.requestedAt ||
        (proof.snapshot.parentSet.kind === "live_parents" &&
          proof.snapshot.parentSet.parents.some(
            ({ eligibleAt }) =>
              Date.parse(eligibleAt) > Date.parse(plan.executeNotBefore)
          ))
      ) {
        throw new Error(
          `Shared deletion target ${target.root.recordId} lacks current all-live-parent eligibility proof.`
        );
      }
    } else if (target.sharedParentProof.kind !== "not_shared") {
      throw new Error(
        `Independent deletion target ${target.root.recordId} cannot claim shared-parent proof.`
      );
    }
    requireDeletionHandler(
      handlerById,
      target.deleteHandlerId,
      "delete_execution",
      target.rootKind,
      "delete",
      false
    );
    requireDeletionHandler(
      handlerById,
      target.verificationHandlerId,
      "verification",
      target.rootKind,
      "verify_absence",
      true
    );
    const use = input.registry.dataUses.find(
      (candidate) =>
        candidate.dataClassId === target.root.dataClassId &&
        candidate.storageRootId === target.root.storageRootId
    );
    if (
      use === undefined ||
      !use.operations.includes("delete") ||
      use.deleteHandlerId !== target.deleteHandlerId ||
      use.verificationHandlerId !== target.verificationHandlerId
    ) {
      throw new Error(
        `Deletion data use ${target.root.dataClassId}/${target.root.storageRootId} has no registered compatible handlers.`
      );
    }
  }

  for (const backup of plan.backupCheckpoints) {
    const dataClass = classById.get(String(backup.backupRoot.dataClassId));
    const root = rootById.get(String(backup.backupRoot.storageRootId));
    if (dataClass === undefined || root?.definition.kind !== "backup") {
      throw new Error(
        `Unknown or non-backup deletion root ${backup.backupRoot.storageRootId}.`
      );
    }
    requireDeletionHandler(
      handlerById,
      backup.expiryLedgerHandlerId,
      "delete_execution",
      "backup",
      "delete",
      false
    );
    requireDeletionHandler(
      handlerById,
      backup.verificationHandlerId,
      "verification",
      "backup",
      "verify_absence",
      true
    );
    const use = input.registry.dataUses.find(
      (candidate) =>
        candidate.dataClassId === backup.backupRoot.dataClassId &&
        candidate.storageRootId === backup.backupRoot.storageRootId
    );
    if (
      use === undefined ||
      !use.operations.includes("delete") ||
      use.deleteHandlerId !== backup.expiryLedgerHandlerId ||
      use.verificationHandlerId !== backup.verificationHandlerId
    ) {
      throw new Error(
        `Backup deletion data use ${backup.backupRoot.dataClassId}/${backup.backupRoot.storageRootId} has no registered compatible handlers.`
      );
    }
  }

  const externalRoutes = input.registry.moduleContributions.flatMap(
    ({ payload }) => payload.externalRoutes
  );
  for (const external of plan.externalCheckpoints) {
    const route = externalRoutes.find(
      (candidate) => candidate.id === external.routeId
    );
    if (
      route === undefined ||
      route.deleteCapabilityHandlerId !== external.externalDeleteHandlerId ||
      route.storageRootId !== external.root.storageRootId ||
      !route.dataClassIds.includes(external.root.dataClassId)
    ) {
      throw new Error(`Unknown external deletion route ${external.routeId}.`);
    }
    const root = rootById.get(String(route.storageRootId));
    if (root?.definition.kind !== "external_route") {
      throw new Error(
        `External route ${external.routeId} has no registered external root.`
      );
    }
    requireDeletionHandler(
      handlerById,
      external.externalDeleteHandlerId,
      "external_deletion",
      "external_route",
      "transmit_external",
      false
    );
    const use = input.registry.dataUses.find(
      (candidate) =>
        candidate.dataClassId === external.root.dataClassId &&
        candidate.storageRootId === external.root.storageRootId
    );
    if (use === undefined || !use.operations.includes("transmit_external")) {
      throw new Error(
        `External deletion data use ${external.root.dataClassId}/${external.root.storageRootId} has no registered route lineage.`
      );
    }
  }

  requireTenantTerminationDeletionScope({
    plan,
    privacyRequest: input.privacyRequest,
    tenantTerminationScope: input.tenantTerminationScope
  });

  const executablePlan = cloneAndFreeze({
    ...plan,
    scopeManifest: input.plan.scopeManifest
  });
  registerInboxV2DeletionPlanAuthenticity(executablePlan);
  return executablePlan;
}

function requireCurrentDeletionAuthority(input: {
  plan: InboxV2DeletionPlan;
  policy: InboxV2EffectiveTenantPolicy;
  activationLedger: InboxV2PolicyActivationLedger;
  lifecycleEvaluations: readonly InboxV2LifecycleEvaluation[];
  evaluatedAt: string;
}): void {
  if (
    !isInboxV2CurrentActivatedEffectiveTenantPolicy({
      ledger: input.activationLedger,
      policy: input.policy
    }) ||
    !isExactPolicyReference(input.plan.policy, {
      tenantId: input.policy.tenantId,
      id: input.policy.id,
      version: input.policy.version,
      policyHash: input.policy.policyHash
    })
  ) {
    throw new Error(
      "Deletion authority requires the exact currently activated lifecycle policy."
    );
  }
  if (
    input.lifecycleEvaluations.some(
      (evaluation) =>
        !isInboxV2LifecycleEvaluationCurrent({
          ledger: input.activationLedger,
          policy: input.policy,
          evaluation
        }) ||
        !("evaluatedAt" in evaluation) ||
        evaluation.evaluatedAt !== input.evaluatedAt
    )
  ) {
    throw new Error(
      "Deletion authority requires current lifecycle evaluations at the exact decision time."
    );
  }
}

function requireDeletionScopeCoverage(plan: InboxV2DeletionPlan): void {
  const manifestByRoot = new Map(
    plan.scopeManifest.roots.map((entry) => [
      exactDataRootKey(entry.root),
      entry
    ])
  );
  const requiredRootCount =
    plan.operatedCheckpoints.length +
    plan.backupCheckpoints.length +
    plan.externalCheckpoints.length;
  if (manifestByRoot.size !== requiredRootCount) {
    throw new Error(
      "Deletion plan checkpoints do not exactly cover its frozen scope manifest."
    );
  }
  for (const { target } of plan.operatedCheckpoints) {
    const entry = manifestByRoot.get(exactDataRootKey(target.root));
    if (
      entry === undefined ||
      !["primary", "derived"].includes(entry.copyRole) ||
      entry.rootKind !== target.rootKind ||
      entry.boundary !== target.boundary ||
      entry.expectedEntityRevision !== target.expectedEntityRevision ||
      entry.expectedLineageRevision !== target.expectedLineageRevision ||
      !isExactEntityKey(entry.entity, target.entity)
    ) {
      throw new Error(
        `Operated checkpoint ${target.root.recordId} does not match its frozen scope root.`
      );
    }
  }
  for (const checkpoint of plan.backupCheckpoints) {
    const entry = manifestByRoot.get(exactDataRootKey(checkpoint.backupRoot));
    if (
      entry === undefined ||
      entry.copyRole !== "backup" ||
      entry.rootKind !== "backup" ||
      entry.expectedEntityRevision !== checkpoint.expectedRootRevision ||
      entry.expectedLineageRevision !== checkpoint.expectedLineageRevision ||
      !isExactEntityKey(entry.entity, checkpoint.entity)
    ) {
      throw new Error(
        `Backup checkpoint ${checkpoint.backupRoot.recordId} does not match its frozen scope root.`
      );
    }
  }
  for (const checkpoint of plan.externalCheckpoints) {
    const entry = manifestByRoot.get(exactDataRootKey(checkpoint.root));
    if (
      entry === undefined ||
      entry.copyRole !== "external" ||
      entry.rootKind !== "external_route" ||
      entry.expectedEntityRevision !== checkpoint.expectedEntityRevision ||
      entry.expectedLineageRevision !== checkpoint.expectedLineageRevision ||
      !isExactEntityKey(entry.entity, checkpoint.target)
    ) {
      throw new Error(
        `External checkpoint ${checkpoint.root.recordId} does not match its frozen scope root.`
      );
    }
  }
}

/**
 * Builds a run only against the exact registry-validated plan it claims to
 * execute. Caller-provided checkpoint lists are never accepted as proof of
 * plan coverage.
 */
export function defineInboxV2DeletionRun(input: {
  run: z.input<typeof inboxV2DeletionRunSchema>;
  plan: InboxV2DeletionPlan;
  registry: InboxV2DataLifecycleRegistry;
  governanceContext?: InboxV2DataGovernanceContext;
  policy: InboxV2EffectiveTenantPolicy;
  activationLedger: InboxV2PolicyActivationLedger;
  executionProof: unknown;
  lifecycleEvaluations?: readonly InboxV2LifecycleEvaluation[];
  privacyRequest?: InboxV2PrivacyRequest;
  tenantTerminationScope?: InboxV2TenantTerminationScopeManifest;
}): InboxV2DeletionRun {
  const governanceContext =
    input.governanceContext ??
    getInboxV2EffectiveTenantPolicyGovernanceContext(input.policy);
  if (
    !isInboxV2DeletionPlan(input.plan) ||
    !isInboxV2DataLifecycleRegistry(input.registry) ||
    input.policy.registryCompositionHash !== input.registry.compositionHash
  ) {
    throw new Error(
      "Deletion run requires an authentic registry-validated deletion plan."
    );
  }
  const plan = input.plan;
  if (!isInboxV2DeletionExecutionProof(input.executionProof)) {
    throw new Error(
      "Deletion run must exactly match authentic current execution-source proof."
    );
  }
  const executionProof = input.executionProof;
  const lifecycleEvaluations = input.lifecycleEvaluations ?? [];
  requireCurrentDeletionAuthority({
    plan,
    policy: input.policy,
    activationLedger: input.activationLedger,
    lifecycleEvaluations,
    evaluatedAt: plan.requestedAt
  });
  requireExactLifecycleEvaluationHashes(plan, lifecycleEvaluations);
  const run = inboxV2DeletionRunSchema.parse(input.run);
  if (
    governanceContext === null ||
    !isInboxV2DataGovernanceContext(governanceContext) ||
    !matchesInboxV2DataGovernanceContextReference({
      context: governanceContext,
      reference: plan.governance
    }) ||
    !matchesInboxV2DataGovernanceContextReference({
      context: governanceContext,
      reference: input.policy.governanceContextRef
    }) ||
    Date.parse(run.startedAt) < Date.parse(governanceContext.effectiveAt) ||
    Date.parse(run.evaluatedAt) >= Date.parse(governanceContext.reviewAt)
  ) {
    throw new Error(
      "Deletion run requires the exact current governance context through evaluation."
    );
  }
  requireDeletionPrivacyDecisionCoverage({
    plan,
    privacyRequest: input.privacyRequest
  });
  if (input.privacyRequest !== undefined) {
    assertInboxV2PrivacyRequestCurrentAuthority({
      request: input.privacyRequest,
      governanceContext,
      policy: input.policy,
      policyActivationLedger: input.activationLedger,
      checkedAt: run.startedAt
    });
  }
  requireTenantTerminationRunAuthority({
    run,
    plan,
    privacyRequest: input.privacyRequest,
    tenantTerminationScope: input.tenantTerminationScope
  });
  const planReference = deletionPlanReference(plan);
  const activation = getInboxV2CurrentPolicyActivationReference({
    ledger: input.activationLedger,
    policy: input.policy
  });

  if (!isExactDeletionPlanReference(run.plan, planReference)) {
    throw new Error(
      "Deletion run does not reference the exact validated plan."
    );
  }
  if (
    !isInboxV2TimestampOrderValid(plan.executeNotBefore, run.startedAt) ||
    Date.parse(run.startedAt) >= Date.parse(plan.executeAuthorization.notAfter)
  ) {
    throw new Error(
      "Deletion run must start inside the validated plan execution window."
    );
  }
  if (
    activation === null ||
    executionProof.registryCompositionHash !== input.registry.compositionHash ||
    !isExactDeletionPlanReference(executionProof.plan, planReference) ||
    !isExactPolicyReference(executionProof.policy, plan.policy) ||
    !isExactPolicyActivationReference(
      executionProof.policyActivation,
      activation
    ) ||
    executionProof.startedAt !== run.startedAt ||
    executionProof.resolvedAt !== run.evaluatedAt ||
    !sameDeletionExecutionValue(
      {
        stageOne: executionProof.stageOne,
        operatedOutcomes: executionProof.operatedOutcomes,
        backupOutcomes: executionProof.backupOutcomes,
        externalResiduals: executionProof.externalResiduals
      },
      {
        stageOne: run.stageOne,
        operatedOutcomes: run.operatedOutcomes,
        backupOutcomes: run.backupOutcomes,
        externalResiduals: run.externalResiduals
      }
    ) ||
    !sameDeletionExecutionValue(
      executionProof.lifecycleControlSnapshots,
      lifecycleControlSnapshotReferences(lifecycleEvaluations)
    )
  ) {
    throw new Error(
      "Deletion run must exactly match authentic current execution-source proof."
    );
  }

  requireExactCheckpointCoverage(
    run.requiredOperatedCheckpointIds,
    plan.operatedCheckpoints.map(({ checkpointId }) => checkpointId),
    "operated"
  );
  requireExactCheckpointCoverage(
    run.requiredBackupCheckpointIds,
    plan.backupCheckpoints.map(({ checkpointId }) => checkpointId),
    "backup"
  );
  requireExactCheckpointCoverage(
    run.requiredExternalCheckpointIds,
    plan.externalCheckpoints.map(({ checkpointId }) => checkpointId),
    "external"
  );

  const operatedById = new Map(
    plan.operatedCheckpoints.map((checkpoint) => [
      String(checkpoint.checkpointId),
      checkpoint
    ])
  );
  if (run.stageOne.state === "content_unavailable") {
    for (const stageTarget of run.stageOne.targets) {
      const checkpoint = operatedById.get(String(stageTarget.checkpointId));
      if (
        checkpoint === undefined ||
        !isExactDataRoot(stageTarget.root, checkpoint.target.root) ||
        !isExactEntityKey(stageTarget.entity, checkpoint.target.entity) ||
        stageTarget.expectedRevision !==
          checkpoint.target.expectedEntityRevision
      ) {
        throw new Error(
          `Stage-one target ${stageTarget.checkpointId} does not match its operated plan checkpoint.`
        );
      }
    }
  }
  for (const outcome of run.operatedOutcomes) {
    const checkpoint = operatedById.get(String(outcome.checkpointId));
    if (
      checkpoint === undefined ||
      !isExactDataRoot(outcome.target, checkpoint.target.root) ||
      outcome.deleteHandlerId !== checkpoint.target.deleteHandlerId ||
      outcome.verificationHandlerId !==
        checkpoint.target.verificationHandlerId ||
      outcome.fence.checkedAt !== outcome.checkedAt ||
      outcome.fence.revision.expectedRevision !==
        checkpoint.target.expectedEntityRevision ||
      outcome.fence.lineage.expectedRevision !==
        checkpoint.target.expectedLineageRevision ||
      !isExactGovernanceReference(outcome.fence.governance, plan.governance) ||
      !isExactPolicyReference(outcome.fence.policy, plan.policy) ||
      !isExactDeletionPlanReference(outcome.fence.plan, planReference)
    ) {
      throw new Error(
        `Operated deletion outcome ${outcome.checkpointId} does not match its plan checkpoint.`
      );
    }
  }

  const backupById = new Map(
    plan.backupCheckpoints.map((checkpoint) => [
      String(checkpoint.checkpointId),
      checkpoint
    ])
  );
  for (const outcome of run.backupOutcomes) {
    const checkpoint = backupById.get(String(outcome.checkpointId));
    if (
      checkpoint === undefined ||
      !isExactDataRoot(outcome.backupRoot, checkpoint.backupRoot) ||
      outcome.expiryLedgerHandlerId !== checkpoint.expiryLedgerHandlerId ||
      outcome.verificationHandlerId !== checkpoint.verificationHandlerId ||
      outcome.fence.checkedAt !== outcome.checkedAt ||
      outcome.fence.revision.expectedRevision !==
        checkpoint.expectedRootRevision ||
      outcome.fence.lineage.expectedRevision !==
        checkpoint.expectedLineageRevision ||
      ((outcome.state === "finite_expiry_pending" ||
        outcome.state === "expiry_verified") &&
        Date.parse(outcome.latestPossibleExpiryAt) >
          Date.parse(checkpoint.latestPermittedExpiryAt)) ||
      !isExactGovernanceReference(outcome.fence.governance, plan.governance) ||
      !isExactPolicyReference(outcome.fence.policy, plan.policy) ||
      !isExactDeletionPlanReference(outcome.fence.plan, planReference)
    ) {
      throw new Error(
        `Backup deletion outcome ${outcome.checkpointId} does not match its plan checkpoint.`
      );
    }
  }

  const externalById = new Map(
    plan.externalCheckpoints.map((checkpoint) => [
      String(checkpoint.checkpointId),
      checkpoint
    ])
  );
  for (const outcome of run.externalResiduals) {
    const checkpoint = externalById.get(String(outcome.checkpointId));
    if (
      checkpoint === undefined ||
      outcome.routeId !== checkpoint.routeId ||
      !isExactDataRoot(outcome.root, checkpoint.root) ||
      outcome.externalDeleteHandlerId !== checkpoint.externalDeleteHandlerId ||
      !isExactEntityKey(outcome.target, checkpoint.target) ||
      outcome.fence.revision.expectedRevision !==
        checkpoint.expectedEntityRevision ||
      outcome.fence.lineage.expectedRevision !==
        checkpoint.expectedLineageRevision ||
      !isExactGovernanceReference(outcome.fence.governance, plan.governance) ||
      !isExactPolicyReference(outcome.fence.policy, plan.policy) ||
      !isExactDeletionPlanReference(outcome.fence.plan, planReference)
    ) {
      throw new Error(
        `External deletion outcome ${outcome.checkpointId} does not match its plan checkpoint.`
      );
    }
  }

  const executableRun = cloneAndFreeze(run);
  registerInboxV2DeletionRunAuthenticity(executableRun);
  return executableRun;
}

function requireDeletionExecutionEvidenceMatchesPlan(input: {
  plan: InboxV2DeletionPlan;
  stageOne: z.infer<typeof inboxV2DeletionStageOneSchema>;
  operatedOutcomes: readonly InboxV2OperatedDeletionHandlerOutcome[];
  backupOutcomes: readonly InboxV2BackupDeletionOutcome[];
  externalResiduals: readonly InboxV2ExternalDeletionResidual[];
}): void {
  const planReference = deletionPlanReference(input.plan);
  const operatedById = new Map(
    input.plan.operatedCheckpoints.map((checkpoint) => [
      String(checkpoint.checkpointId),
      checkpoint
    ])
  );
  if (input.stageOne.state === "pending") {
    if (
      input.operatedOutcomes.length > 0 ||
      input.backupOutcomes.length > 0 ||
      input.externalResiduals.length > 0
    ) {
      throw new Error(
        "Deletion execution source cannot report handler outcomes before stage one."
      );
    }
  } else {
    requireExactCheckpointCoverage(
      input.stageOne.targets.map(({ checkpointId }) => checkpointId),
      input.plan.operatedCheckpoints.map(({ checkpointId }) => checkpointId),
      "stage-one"
    );
    for (const target of input.stageOne.targets) {
      const checkpoint = operatedById.get(String(target.checkpointId));
      if (
        checkpoint === undefined ||
        !isExactDataRoot(target.root, checkpoint.target.root) ||
        !isExactEntityKey(target.entity, checkpoint.target.entity) ||
        target.expectedRevision !== checkpoint.target.expectedEntityRevision
      ) {
        throw new Error(
          `Trusted stage-one result ${target.checkpointId} does not match its exact plan checkpoint/revision.`
        );
      }
    }
  }

  requireCanonicalOutcomeSubset(
    input.operatedOutcomes.map(({ checkpointId }) => String(checkpointId)),
    input.plan.operatedCheckpoints.map(({ checkpointId }) =>
      String(checkpointId)
    ),
    "operated"
  );
  for (const outcome of input.operatedOutcomes) {
    const checkpoint = operatedById.get(String(outcome.checkpointId));
    if (
      checkpoint === undefined ||
      !isExactDataRoot(outcome.target, checkpoint.target.root) ||
      outcome.deleteHandlerId !== checkpoint.target.deleteHandlerId ||
      outcome.verificationHandlerId !==
        checkpoint.target.verificationHandlerId ||
      outcome.fence.revision.expectedRevision !==
        checkpoint.target.expectedEntityRevision ||
      outcome.fence.lineage.expectedRevision !==
        checkpoint.target.expectedLineageRevision ||
      !isExactGovernanceReference(
        outcome.fence.governance,
        input.plan.governance
      ) ||
      !isExactPolicyReference(outcome.fence.policy, input.plan.policy) ||
      !isExactDeletionPlanReference(outcome.fence.plan, planReference)
    ) {
      throw new Error(
        `Trusted operated result ${outcome.checkpointId} does not match its exact plan checkpoint/revision/lineage.`
      );
    }
  }

  const backupById = new Map(
    input.plan.backupCheckpoints.map((checkpoint) => [
      String(checkpoint.checkpointId),
      checkpoint
    ])
  );
  requireCanonicalOutcomeSubset(
    input.backupOutcomes.map(({ checkpointId }) => String(checkpointId)),
    input.plan.backupCheckpoints.map(({ checkpointId }) =>
      String(checkpointId)
    ),
    "backup"
  );
  for (const outcome of input.backupOutcomes) {
    const checkpoint = backupById.get(String(outcome.checkpointId));
    if (
      checkpoint === undefined ||
      !isExactDataRoot(outcome.backupRoot, checkpoint.backupRoot) ||
      outcome.expiryLedgerHandlerId !== checkpoint.expiryLedgerHandlerId ||
      outcome.verificationHandlerId !== checkpoint.verificationHandlerId ||
      outcome.fence.revision.expectedRevision !==
        checkpoint.expectedRootRevision ||
      outcome.fence.lineage.expectedRevision !==
        checkpoint.expectedLineageRevision ||
      !isExactGovernanceReference(
        outcome.fence.governance,
        input.plan.governance
      ) ||
      !isExactPolicyReference(outcome.fence.policy, input.plan.policy) ||
      !isExactDeletionPlanReference(outcome.fence.plan, planReference)
    ) {
      throw new Error(
        `Trusted backup result ${outcome.checkpointId} does not match its exact plan checkpoint/revision/lineage.`
      );
    }
  }

  const externalById = new Map(
    input.plan.externalCheckpoints.map((checkpoint) => [
      String(checkpoint.checkpointId),
      checkpoint
    ])
  );
  requireCanonicalOutcomeSubset(
    input.externalResiduals.map(({ checkpointId }) => String(checkpointId)),
    input.plan.externalCheckpoints.map(({ checkpointId }) =>
      String(checkpointId)
    ),
    "external"
  );
  for (const outcome of input.externalResiduals) {
    const checkpoint = externalById.get(String(outcome.checkpointId));
    if (
      checkpoint === undefined ||
      outcome.routeId !== checkpoint.routeId ||
      !isExactDataRoot(outcome.root, checkpoint.root) ||
      outcome.externalDeleteHandlerId !== checkpoint.externalDeleteHandlerId ||
      !isExactEntityKey(outcome.target, checkpoint.target) ||
      outcome.fence.revision.expectedRevision !==
        checkpoint.expectedEntityRevision ||
      outcome.fence.lineage.expectedRevision !==
        checkpoint.expectedLineageRevision ||
      !isExactGovernanceReference(
        outcome.fence.governance,
        input.plan.governance
      ) ||
      !isExactPolicyReference(outcome.fence.policy, input.plan.policy) ||
      !isExactDeletionPlanReference(outcome.fence.plan, planReference)
    ) {
      throw new Error(
        `Trusted external result ${outcome.checkpointId} does not match its exact plan checkpoint/revision/lineage.`
      );
    }
  }
}

function requireCanonicalOutcomeSubset(
  actual: readonly string[],
  planOrder: readonly string[],
  kind: string
): void {
  const indexes = actual.map((value) => planOrder.indexOf(value));
  if (
    indexes.some((index) => index < 0) ||
    indexes.some((index, position) =>
      position === 0 ? false : index <= indexes[position - 1]!
    )
  ) {
    throw new Error(
      `Deletion execution source ${kind} outcomes must be a unique canonical subset of plan checkpoints.`
    );
  }
}

function requireExactCheckpointCoverage(
  actual: readonly string[],
  expected: readonly string[],
  kind: string
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `Deletion run ${kind} checkpoint coverage does not match its validated plan.`
    );
  }
}

export function calculateInboxV2DeletionLifecycleEvaluationHash(
  evaluation: InboxV2LifecycleEvaluation
) {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.deletion-lifecycle-evaluation",
    hashVersion: "v1",
    evaluation
  });
}

export function calculateInboxV2DeletionPlanHash(input: {
  planHash?: unknown;
  [key: string]: unknown;
}) {
  const { planHash: _ignored, ...plan } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.deletion-plan",
    hashVersion: "v1",
    plan
  });
}

function requireDeletionPrivacyDecisionCoverage(input: {
  plan: InboxV2DeletionPlan;
  privacyRequest: InboxV2PrivacyRequest | undefined;
}): void {
  if (input.plan.decisionBasis.kind !== "privacy_request") {
    if (input.privacyRequest !== undefined) {
      throw new Error(
        "A non-privacy deletion plan cannot carry privacy-request authority."
      );
    }
    return;
  }
  const request = input.privacyRequest;
  if (
    request === undefined ||
    !hasInboxV2PrivacyRequestAuthenticity(request) ||
    !("decision" in request.workflow)
  ) {
    throw new Error(
      "Privacy deletion plan requires an authentic immutable privacy request."
    );
  }
  const expectedIntent =
    input.plan.cause === "tenant_offboarding"
      ? "tenant_termination_export_delete"
      : "erasure";
  const basis = input.plan.decisionBasis;
  if (
    request.intent !== expectedIntent ||
    request.tenantId !== input.plan.tenantId ||
    basis.request.tenantId !== request.tenantId ||
    String(basis.request.requestId) !== String(request.id) ||
    String(basis.request.revision) !== String(request.revision) ||
    String(basis.decisionId) !== String(request.workflow.decision.id) ||
    String(basis.decisionRevision) !==
      String(request.workflow.decision.revision) ||
    basis.decisionDigest !== request.workflow.decision.digest ||
    (request.workflow.decision.result !== "approved" &&
      request.workflow.decision.result !== "partially_approved")
  ) {
    throw new Error(
      "Deletion plan privacy basis does not match the exact approved request decision."
    );
  }

  const approvedDestructiveRoots = new Set(
    request.workflow.decision.rootDecisions
      .filter(
        (decision) =>
          decision.disposition === "erase" ||
          decision.disposition === "external_action_required" ||
          decision.followUpDisposition === "erase"
      )
      .map(({ root }) => exactDataRootKey(root))
  );
  const planRoots = new Set(
    input.plan.scopeManifest.roots.map(({ root }) => exactDataRootKey(root))
  );
  if (!setsAreEqual(approvedDestructiveRoots, planRoots)) {
    throw new Error(
      "Privacy deletion plan must exactly cover every destructive root approved by the request decision."
    );
  }
}

function requireTenantTerminationDeletionScope(input: {
  plan: InboxV2DeletionPlan;
  privacyRequest: InboxV2PrivacyRequest | undefined;
  tenantTerminationScope: InboxV2TenantTerminationScopeManifest | undefined;
}): void {
  if (input.plan.cause !== "tenant_offboarding") {
    if (input.tenantTerminationScope !== undefined) {
      throw new Error(
        "Only tenant offboarding may carry tenant termination scope authority."
      );
    }
    if (input.plan.scopeKind === "tenant_wide") {
      throw new Error(
        "A tenant-wide destructive plan requires the complete tenant termination workflow."
      );
    }
    return;
  }
  const requestDescriptor = getInboxV2PrivacyRequestAuthenticity(
    input.privacyRequest
  );
  const manifest = input.tenantTerminationScope;
  if (
    input.plan.scopeKind !== "tenant_wide" ||
    manifest === undefined ||
    !isInboxV2TenantTerminationScopeManifest(manifest) ||
    requestDescriptor === null ||
    requestDescriptor.intent !== "tenant_termination_export_delete" ||
    requestDescriptor.tenantScopeProofHash !== manifest.proofHash ||
    requestDescriptor.terminalExport === null ||
    requestDescriptor.terminalExport.tenantScopeProofHash !==
      manifest.proofHash ||
    requestDescriptor.terminalExport.policyId !== input.plan.policy.id ||
    requestDescriptor.terminalExport.policyVersion !==
      input.plan.policy.version ||
    requestDescriptor.terminalExport.policyHash !==
      input.plan.policy.policyHash ||
    requestDescriptor.terminalExport.governanceContextId !==
      input.plan.governance.id ||
    requestDescriptor.terminalExport.governanceContextVersion !==
      input.plan.governance.version ||
    requestDescriptor.terminalExport.governanceContextHash !==
      input.plan.governance.contextHash ||
    Date.parse(requestDescriptor.terminalExport.artifactReadyAt) >
      Date.parse(input.plan.requestedAt) ||
    Date.parse(requestDescriptor.terminalExport.artifactExpiresAt) <=
      Date.parse(input.plan.requestedAt)
  ) {
    throw new Error(
      "Tenant offboarding deletion requires an unexpired authentic tenant-wide export and exact scope proof."
    );
  }
  if (requestDescriptor.terminalExportProof === null) {
    throw new Error(
      "Tenant offboarding deletion lost its authentic current export proof."
    );
  }
  assertInboxV2PrivacyTerminalExportCurrent(
    requestDescriptor.terminalExportProof,
    input.plan.requestedAt
  );
  const tenantRoots = new Map(
    manifest.roots.map((entry) => [exactDataRootKey(entry.root), entry])
  );
  const planRoots = new Map(
    input.plan.scopeManifest.roots.map((entry) => [
      exactDataRootKey(entry.root),
      entry
    ])
  );
  if (
    tenantRoots.size !== planRoots.size ||
    requestDescriptor.tenantRootKeys.length !== tenantRoots.size ||
    requestDescriptor.tenantRootKeys.some((key) => !tenantRoots.has(key)) ||
    [...tenantRoots].some(([key, tenantRoot]) => {
      const planRoot = planRoots.get(key);
      return (
        planRoot === undefined ||
        planRoot.expectedEntityRevision !== tenantRoot.expectedEntityRevision ||
        planRoot.expectedLineageRevision !== tenantRoot.expectedLineageRevision
      );
    })
  ) {
    throw new Error(
      "Tenant offboarding deletion plan must exactly cover every tenant-wide root revision."
    );
  }
  compareAndSetInboxV2TenantTerminationDestructiveScope({
    manifest,
    checkedAt: input.plan.requestedAt
  });
}

function requireTenantTerminationRunAuthority(input: {
  run: InboxV2DeletionRun;
  plan: InboxV2DeletionPlan;
  privacyRequest: InboxV2PrivacyRequest | undefined;
  tenantTerminationScope: InboxV2TenantTerminationScopeManifest | undefined;
}): void {
  requireTenantTerminationExecutionAuthority({
    plan: input.plan,
    privacyRequest: input.privacyRequest,
    tenantTerminationScope: input.tenantTerminationScope,
    checkedAt: input.run.startedAt
  });
}

function requireTenantTerminationExecutionAuthority(input: {
  plan: InboxV2DeletionPlan;
  privacyRequest: InboxV2PrivacyRequest | undefined;
  tenantTerminationScope: InboxV2TenantTerminationScopeManifest | undefined;
  checkedAt: string;
}): void {
  if (input.plan.cause !== "tenant_offboarding") {
    if (input.tenantTerminationScope !== undefined) {
      throw new Error(
        "Only tenant offboarding run may carry tenant termination scope authority."
      );
    }
    return;
  }
  const descriptor = getInboxV2PrivacyRequestAuthenticity(input.privacyRequest);
  const scope = input.tenantTerminationScope;
  if (
    descriptor === null ||
    descriptor.terminalExport === null ||
    scope === undefined ||
    !isInboxV2TenantTerminationScopeManifest(scope) ||
    descriptor.tenantScopeProofHash !== scope.proofHash ||
    descriptor.terminalExport.tenantScopeProofHash !== scope.proofHash ||
    descriptor.terminalExport.policyId !== input.plan.policy.id ||
    descriptor.terminalExport.policyVersion !== input.plan.policy.version ||
    descriptor.terminalExport.policyHash !== input.plan.policy.policyHash ||
    descriptor.terminalExport.governanceContextId !==
      input.plan.governance.id ||
    descriptor.terminalExport.governanceContextVersion !==
      input.plan.governance.version ||
    descriptor.terminalExport.governanceContextHash !==
      input.plan.governance.contextHash ||
    Date.parse(descriptor.terminalExport.artifactReadyAt) >
      Date.parse(input.checkedAt) ||
    Date.parse(descriptor.terminalExport.artifactExpiresAt) <=
      Date.parse(input.checkedAt)
  ) {
    throw new Error(
      "Tenant offboarding run requires its still-downloadable complete tenant export and exact sealed scope."
    );
  }
  if (descriptor.terminalExportProof === null) {
    throw new Error(
      "Tenant offboarding execution lost its authentic current export proof."
    );
  }
  assertInboxV2PrivacyTerminalExportCurrent(
    descriptor.terminalExportProof,
    input.checkedAt
  );
  compareAndSetInboxV2TenantTerminationDestructiveScope({
    manifest: scope,
    checkedAt: input.checkedAt
  });
}

function requireDeletionLifecycleEvaluationCoverage(input: {
  plan: InboxV2DeletionPlan;
  evaluations: readonly InboxV2LifecycleEvaluation[];
}): void {
  type AuthenticEvaluation = Exclude<
    InboxV2LifecycleEvaluation,
    { outcome: "rejected" }
  >;
  const evaluations = input.evaluations as readonly AuthenticEvaluation[];
  const requiredTargets: Array<{
    kind: "operated" | "backup" | "external";
    entity: z.infer<typeof inboxV2EntityKeySchema>;
    entityRevision: string;
    lineageRevision: string;
    dataClassId: string;
    action: z.infer<typeof inboxV2LifecycleActionSchema>;
    purposeId?: string;
    policyRuleId?: string;
    policyRuleRevision?: string;
    latestPermittedExpiryAt?: string;
  }> = [];

  if (input.plan.decisionBasis.kind === "lifecycle_policy") {
    for (const { target } of input.plan.operatedCheckpoints) {
      requiredTargets.push({
        kind: "operated",
        entity: target.entity,
        entityRevision: target.expectedEntityRevision,
        lineageRevision: target.expectedLineageRevision,
        dataClassId: target.root.dataClassId,
        action: target.action
      });
    }
    for (const checkpoint of input.plan.externalCheckpoints) {
      requiredTargets.push({
        kind: "external",
        entity: checkpoint.target,
        entityRevision: checkpoint.expectedEntityRevision,
        lineageRevision: checkpoint.expectedLineageRevision,
        dataClassId: checkpoint.root.dataClassId,
        action: checkpoint.action
      });
    }
  }
  for (const checkpoint of input.plan.backupCheckpoints) {
    requiredTargets.push({
      kind: "backup",
      entity: checkpoint.entity,
      entityRevision: checkpoint.expectedRootRevision,
      lineageRevision: checkpoint.expectedLineageRevision,
      dataClassId: checkpoint.backupRoot.dataClassId,
      action: checkpoint.action,
      purposeId: checkpoint.purposeId,
      policyRuleId: checkpoint.policyRuleId,
      policyRuleRevision: checkpoint.policyRuleRevision,
      latestPermittedExpiryAt: checkpoint.latestPermittedExpiryAt
    });
  }

  const requiredKeys = new Set(
    requiredTargets.map(deletionEvaluationTargetKey)
  );
  const evaluationKeys = new Set(
    evaluations.map((evaluation) =>
      deletionEvaluationTargetKey({
        entity: evaluation.target.entity,
        entityRevision: evaluation.target.entityRevision,
        lineageRevision: evaluation.target.lineageRevision,
        dataClassId: evaluation.target.dataClassId
      })
    )
  );
  if (!setsAreEqual(requiredKeys, evaluationKeys)) {
    throw new Error(
      "Deletion plan lifecycle evaluations do not exactly cover required destructive targets."
    );
  }

  for (const target of requiredTargets) {
    const targetKey = deletionEvaluationTargetKey(target);
    const evaluation = evaluations.find(
      (candidate) =>
        deletionEvaluationTargetKey({
          entity: candidate.target.entity,
          entityRevision: candidate.target.entityRevision,
          lineageRevision: candidate.target.lineageRevision,
          dataClassId: candidate.target.dataClassId
        }) === targetKey
    );
    if (
      evaluation === undefined ||
      !isExactPolicyReference(evaluation.policyRef, input.plan.policy) ||
      !isExactGovernanceReference(
        evaluation.governanceContextRef,
        input.plan.governance
      ) ||
      (target.kind !== "backup" &&
        (evaluation.outcome !== "eligible_for_action" ||
          evaluation.action !== target.action ||
          Date.parse(evaluation.eligibleAt) >
            Date.parse(input.plan.executeNotBefore))) ||
      (target.kind === "backup" &&
        evaluation.outcome !== "eligible_for_action" &&
        evaluation.outcome !== "retained_until")
    ) {
      throw new Error(
        `Deletion target ${targetKey} lacks a current policy/governance eligibility decision.`
      );
    }
    if (target.kind === "backup") {
      if (
        evaluation.outcome !== "eligible_for_action" &&
        evaluation.outcome !== "retained_until"
      ) {
        throw new Error(
          `Backup deletion target ${targetKey} lacks a bounded lifecycle outcome.`
        );
      }
      const deadline = evaluation.purposeDeadlines.find(
        (candidate) =>
          String(candidate.purposeId) === target.purposeId &&
          String(candidate.ruleId) === target.policyRuleId &&
          String(candidate.ruleRevision) === target.policyRuleRevision
      );
      if (
        evaluation.action !== target.action ||
        deadline === undefined ||
        deadline.backupMaximumAt !== target.latestPermittedExpiryAt
      ) {
        throw new Error(
          `Backup deletion target ${targetKey} is not bounded by its authentic policy backup maximum.`
        );
      }
    }
  }
}

function deletionEvaluationTargetKey(input: {
  entity: z.infer<typeof inboxV2EntityKeySchema>;
  entityRevision: string;
  lineageRevision: string;
  dataClassId: string;
}): string {
  return `${input.entity.tenantId}\u0000${input.entity.entityTypeId}\u0000${input.entity.entityId}\u0000${input.entityRevision}\u0000${input.lineageRevision}\u0000${input.dataClassId}`;
}

function requireExactLifecycleEvaluationHashes(
  plan: InboxV2DeletionPlan,
  lifecycleEvaluations: readonly InboxV2LifecycleEvaluation[]
): void {
  const evaluationHashes = lifecycleEvaluations
    .map(calculateInboxV2DeletionLifecycleEvaluationHash)
    .sort();
  if (
    evaluationHashes.length !== plan.lifecycleEvaluationHashes.length ||
    evaluationHashes.some(
      (value, index) => value !== plan.lifecycleEvaluationHashes[index]
    )
  ) {
    throw new Error(
      "Deletion lifecycle-evaluation hashes do not match the exact loaded decisions."
    );
  }
}

function deletionPlanReference(
  plan: InboxV2DeletionPlan
): z.infer<typeof inboxV2DeletionPlanReferenceSchema> {
  return {
    tenantId: plan.tenantId,
    planId: plan.id,
    revision: plan.revision,
    planHash: plan.planHash
  };
}

function requiredDeletionHandlerIds(plan: InboxV2DeletionPlan): string[] {
  return [
    ...plan.operatedCheckpoints.flatMap(({ target }) => [
      String(target.deleteHandlerId),
      String(target.verificationHandlerId)
    ]),
    ...plan.backupCheckpoints.flatMap((checkpoint) => [
      String(checkpoint.expiryLedgerHandlerId),
      String(checkpoint.verificationHandlerId)
    ]),
    ...plan.externalCheckpoints.map((checkpoint) =>
      String(checkpoint.externalDeleteHandlerId)
    )
  ]
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
}

function lifecycleControlSnapshotReferences(
  evaluations: readonly InboxV2LifecycleEvaluation[]
) {
  type AuthenticEvaluation = Exclude<
    InboxV2LifecycleEvaluation,
    { outcome: "rejected" }
  >;
  return (evaluations as readonly AuthenticEvaluation[])
    .map(({ controlSnapshot }) => controlSnapshot)
    .sort((left, right) =>
      `${left.id}\u0000${left.revision}\u0000${left.snapshotHash}`.localeCompare(
        `${right.id}\u0000${right.revision}\u0000${right.snapshotHash}`
      )
    );
}

function isExactPolicyActivationReference(
  actual: z.infer<typeof inboxV2PolicyActivationReferenceSchema>,
  expected: z.infer<typeof inboxV2PolicyActivationReferenceSchema>
): boolean {
  return (
    actual.tenantId === expected.tenantId &&
    actual.id === expected.id &&
    actual.revision === expected.revision &&
    actual.activationHash === expected.activationHash
  );
}

function sameDeletionExecutionValue(left: unknown, right: unknown): boolean {
  const hash = (value: unknown) =>
    calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.deletion-execution-exact-value",
      hashVersion: "v1",
      value
    });
  return hash(left) === hash(right);
}

function isExactDeletionPlanReference(
  actual: z.infer<typeof inboxV2DeletionPlanReferenceSchema>,
  expected: z.infer<typeof inboxV2DeletionPlanReferenceSchema>
): boolean {
  return (
    actual.tenantId === expected.tenantId &&
    actual.planId === expected.planId &&
    actual.revision === expected.revision &&
    actual.planHash === expected.planHash
  );
}

function isExactGovernanceReference(
  actual: z.infer<typeof inboxV2DataGovernanceContextReferenceSchema>,
  expected: z.infer<typeof inboxV2DataGovernanceContextReferenceSchema>
): boolean {
  return (
    actual.tenantId === expected.tenantId &&
    actual.id === expected.id &&
    actual.version === expected.version &&
    actual.contextHash === expected.contextHash
  );
}

function isExactPolicyReference(
  actual: z.infer<typeof inboxV2DataLifecyclePolicyReferenceSchema>,
  expected: z.infer<typeof inboxV2DataLifecyclePolicyReferenceSchema>
): boolean {
  return (
    actual.tenantId === expected.tenantId &&
    actual.id === expected.id &&
    actual.version === expected.version &&
    actual.policyHash === expected.policyHash
  );
}

function isExactDataRoot(
  actual: z.infer<typeof inboxV2DataRootReferenceSchema>,
  expected: z.infer<typeof inboxV2DataRootReferenceSchema>
): boolean {
  return (
    actual.tenantId === expected.tenantId &&
    actual.dataClassId === expected.dataClassId &&
    actual.storageRootId === expected.storageRootId &&
    actual.recordId === expected.recordId
  );
}

function exactDataRootKey(
  root: z.infer<typeof inboxV2DataRootReferenceSchema>
): string {
  return `${root.tenantId}\u0000${root.dataClassId}\u0000${root.storageRootId}\u0000${root.recordId}`;
}

function isExactEntityKey(
  actual: z.infer<typeof inboxV2EntityKeySchema>,
  expected: z.infer<typeof inboxV2EntityKeySchema>
): boolean {
  return (
    actual.tenantId === expected.tenantId &&
    actual.entityTypeId === expected.entityTypeId &&
    actual.entityId === expected.entityId
  );
}

function requireDeletionHandler(
  handlerById: Map<string, InboxV2DataLifecycleRegistry["handlers"][number]>,
  handlerId: string,
  kind: InboxV2DataLifecycleRegistry["handlers"][number]["definition"]["kind"],
  rootKind: z.infer<typeof inboxV2StorageRootKindSchema>,
  operation: "delete" | "verify_absence" | "transmit_external",
  verifiesAbsence: boolean
): void {
  const handler = handlerById.get(String(handlerId));
  if (
    handler === undefined ||
    handler.definition.kind !== kind ||
    !handler.definition.supportedRootKinds.includes(rootKind) ||
    !handler.definition.supportedOperations.includes(operation) ||
    !handler.definition.checksTenantFence ||
    !handler.definition.checksRevisionFence ||
    !handler.definition.checksHoldFence ||
    (verifiesAbsence && !handler.definition.verifiesAbsence)
  ) {
    throw new Error(
      `Lifecycle handler ${handlerId} is missing or incompatible with ${rootKind}/${operation}.`
    );
  }
}

function authorizationPrincipalKey(
  decision: z.infer<typeof inboxV2AuthorizationDecisionReferenceSchema>
): string {
  return decision.principal.kind === "employee"
    ? `employee:${decision.principal.employee.id}`
    : `trusted_service:${decision.principal.trustedServiceId}`;
}

function isDeletionAuthorizationValidAt(input: {
  decision: z.infer<typeof inboxV2AuthorizationDecisionReferenceSchema>;
  permissionId:
    | "core:privacy.deletion.preview"
    | "core:privacy.deletion.approve"
    | "core:privacy.deletion.execute";
  planId: string;
  planRevision: string;
  tenantId: string;
  checkedAt: string;
}): boolean {
  const { decision } = input;
  return (
    decision.tenantId === input.tenantId &&
    decision.outcome === "allowed" &&
    decision.permissionId === input.permissionId &&
    decision.resourceScopeId === "core:privacy-deletion-plan" &&
    decision.resource.tenantId === input.tenantId &&
    decision.resource.entityTypeId === "core:privacy-deletion-plan" &&
    decision.resource.entityId === input.planId &&
    decision.resourceAccessRevision === input.planRevision &&
    Date.parse(input.checkedAt) >= Date.parse(decision.decidedAt) &&
    Date.parse(input.checkedAt) < Date.parse(decision.notAfter)
  );
}

function addCanonicalUniqueIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[],
  label: string
): void {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => index > 0 && value <= values[index - 1]!)
  ) {
    addIssue(context, path, `${label} must be unique and canonically sorted.`);
  }
}

function setsAreEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function cloneAndFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as TValue;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = cloneAndFreeze(item);
  }
  return Object.freeze(clone) as TValue;
}
