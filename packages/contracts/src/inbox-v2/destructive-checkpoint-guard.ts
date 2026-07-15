import { z } from "zod";

import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  inboxV2LifecycleHandlerIdSchema,
  inboxV2StorageRootKindSchema
} from "./data-lifecycle-primitives";
import {
  inboxV2PolicyActivationAuthoritySchema,
  type InboxV2PolicyActivationAuthority
} from "./data-lifecycle-persistence";
import { inboxV2DataRootReferenceSchema } from "./data-subject-discovery";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  inboxV2DeletionCheckpointIdSchema,
  inboxV2DeletionExecutionFenceSchema,
  inboxV2DeletionPlanReferenceSchema,
  inboxV2DeletionRunReferenceSchema
} from "./privacy-deletion";
import { inboxV2PrivacyHoldReferenceSchema } from "./privacy-hold-restriction";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2EntityKeySchema,
  inboxV2Sha256DigestSchema
} from "./sync-primitives";

const inboxV2DestructiveCheckpointLeaseTokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export const inboxV2DestructiveCheckpointRegistryReferenceSchema = z
  .object({
    id: inboxV2NamespacedIdSchema,
    revision: inboxV2EntityRevisionSchema,
    compositionHash: inboxV2Sha256DigestSchema
  })
  .strict();

const destructiveCheckpointTargetShape = {
  checkpointId: inboxV2DeletionCheckpointIdSchema,
  requirementHash: inboxV2Sha256DigestSchema,
  registry: inboxV2DestructiveCheckpointRegistryReferenceSchema,
  root: inboxV2DataRootReferenceSchema,
  entity: inboxV2EntityKeySchema,
  observedEntityRevision: inboxV2EntityRevisionSchema,
  observedLineageRevision: inboxV2EntityRevisionSchema
};

const operatedRootKindSchema = inboxV2StorageRootKindSchema.refine(
  (value) => value !== "backup" && value !== "external_route",
  "An operated checkpoint cannot target a backup or external route."
);

export const inboxV2ObservedOperatedDestructiveCheckpointSchema = z
  .object({
    ...destructiveCheckpointTargetShape,
    surface: z.literal("operated"),
    rootKind: operatedRootKindSchema,
    boundary: z.literal("operated_data_plane"),
    copyRole: z.enum(["primary", "derived"]),
    handlers: z
      .object({
        deleteHandlerId: inboxV2LifecycleHandlerIdSchema,
        verificationHandlerId: inboxV2LifecycleHandlerIdSchema
      })
      .strict()
  })
  .strict();

export const inboxV2ObservedBackupDestructiveCheckpointSchema = z
  .object({
    ...destructiveCheckpointTargetShape,
    surface: z.literal("backup"),
    rootKind: z.literal("backup"),
    boundary: z.literal("operated_data_plane"),
    copyRole: z.literal("backup"),
    handlers: z
      .object({
        expiryLedgerHandlerId: inboxV2LifecycleHandlerIdSchema,
        verificationHandlerId: inboxV2LifecycleHandlerIdSchema
      })
      .strict()
  })
  .strict();

export const inboxV2ObservedExternalDestructiveCheckpointSchema = z
  .object({
    ...destructiveCheckpointTargetShape,
    surface: z.literal("external"),
    rootKind: z.literal("external_route"),
    boundary: z.literal("outside_operated_data_plane"),
    copyRole: z.literal("external"),
    handlers: z
      .object({
        externalDeleteHandlerId: inboxV2LifecycleHandlerIdSchema
      })
      .strict()
  })
  .strict();

export const inboxV2ObservedDestructiveCheckpointSchema = z
  .discriminatedUnion("surface", [
    inboxV2ObservedOperatedDestructiveCheckpointSchema,
    inboxV2ObservedBackupDestructiveCheckpointSchema,
    inboxV2ObservedExternalDestructiveCheckpointSchema
  ])
  .superRefine((checkpoint, context) => {
    if (checkpoint.root.tenantId !== checkpoint.entity.tenantId) {
      addIssue(
        context,
        [],
        "A destructive checkpoint root and entity must belong to one tenant."
      );
    }
  });

export const inboxV2DestructiveCheckpointControlSetSchema = z
  .object({
    legalHoldSetRevision: inboxV2BigintCounterSchema,
    restrictionSetRevision: inboxV2BigintCounterSchema
  })
  .strict();

export const inboxV2ClaimDestructiveCheckpointInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    plan: inboxV2DeletionPlanReferenceSchema,
    run: inboxV2DeletionRunReferenceSchema,
    checkpoint: inboxV2ObservedDestructiveCheckpointSchema,
    expectedAuthority: inboxV2PolicyActivationAuthoritySchema,
    expectedControlSet: inboxV2DestructiveCheckpointControlSetSchema,
    executionAuthorization: inboxV2AuthorizationDecisionReferenceSchema,
    leaseToken: inboxV2DestructiveCheckpointLeaseTokenSchema,
    leaseDurationSeconds: z.number().int().min(1).max(300)
  })
  .strict()
  .superRefine((input, context) => {
    const tenantIds = [
      input.plan.tenantId,
      input.run.tenantId,
      input.checkpoint.root.tenantId,
      input.checkpoint.entity.tenantId,
      input.expectedAuthority.tenantId,
      input.executionAuthorization.tenantId
    ];
    if (tenantIds.some((tenantId) => tenantId !== input.tenantId)) {
      addIssue(
        context,
        [],
        "A destructive checkpoint claim cannot cross tenant boundaries."
      );
    }
    const decision = input.executionAuthorization;
    if (
      decision.outcome !== "allowed" ||
      decision.permissionId !== "core:privacy.deletion.execute" ||
      decision.resourceScopeId !== "core:privacy-deletion-plan" ||
      decision.resource.entityTypeId !== "core:privacy-deletion-plan" ||
      String(decision.resource.entityId) !== String(input.plan.planId) ||
      String(decision.resourceAccessRevision) !== String(input.plan.revision)
    ) {
      addIssue(
        context,
        ["executionAuthorization"],
        "The claim requires allowed execution authority for the exact deletion plan revision."
      );
    }
  });

export const inboxV2DestructiveCheckpointLeaseSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    plan: inboxV2DeletionPlanReferenceSchema,
    run: inboxV2DeletionRunReferenceSchema,
    checkpoint: inboxV2ObservedDestructiveCheckpointSchema,
    authority: inboxV2PolicyActivationAuthoritySchema,
    controlSet: inboxV2DestructiveCheckpointControlSetSchema,
    claimRevision: inboxV2EntityRevisionSchema,
    state: z.literal("claimed"),
    leaseToken: inboxV2DestructiveCheckpointLeaseTokenSchema,
    executionFenceHash: inboxV2Sha256DigestSchema,
    executionHandlerId: inboxV2LifecycleHandlerIdSchema,
    fence: inboxV2DeletionExecutionFenceSchema,
    claimedAt: inboxV2TimestampSchema,
    leaseExpiresAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((lease, context) => {
    const expectedHandler = executionHandlerId(lease.checkpoint);
    if (
      lease.plan.tenantId !== lease.tenantId ||
      lease.run.tenantId !== lease.tenantId ||
      lease.checkpoint.root.tenantId !== lease.tenantId ||
      lease.authority.tenantId !== lease.tenantId ||
      lease.fence.tenantId !== lease.tenantId ||
      lease.executionHandlerId !== expectedHandler ||
      lease.executionFenceHash !==
        calculateInboxV2DestructiveCheckpointExecutionFenceHash(
          lease.leaseToken
        )
    ) {
      addIssue(
        context,
        [],
        "A destructive lease must bind one tenant and the frozen surface handler."
      );
    }
    if (
      lease.fence.plan.planId !== lease.plan.planId ||
      lease.fence.plan.revision !== lease.plan.revision ||
      lease.fence.plan.planHash !== lease.plan.planHash ||
      lease.fence.governance.id !== lease.authority.governance.id ||
      lease.fence.governance.version !== lease.authority.governance.version ||
      lease.fence.governance.contextHash !==
        lease.authority.governance.contextHash ||
      lease.fence.policy.id !== lease.authority.effectivePolicy.id ||
      lease.fence.policy.version !== lease.authority.effectivePolicy.version ||
      lease.fence.policy.policyHash !==
        lease.authority.effectivePolicy.policyHash
    ) {
      addIssue(
        context,
        ["fence"],
        "The destructive fence must bind the exact plan and current policy authority."
      );
    }
    if (
      lease.fence.revision.kind !== "matched" ||
      lease.fence.revision.expectedRevision !==
        lease.checkpoint.observedEntityRevision ||
      lease.fence.lineage.kind !== "matched" ||
      lease.fence.lineage.expectedRevision !==
        lease.checkpoint.observedLineageRevision ||
      lease.fence.hold.kind !== "clear"
    ) {
      addIssue(
        context,
        ["fence"],
        "A granted destructive fence requires matched entity/lineage revisions and a clear hold decision."
      );
    }
    if (
      Date.parse(lease.claimedAt) > Date.parse(lease.fence.checkedAt) ||
      Date.parse(lease.fence.checkedAt) >= Date.parse(lease.leaseExpiresAt) ||
      Date.parse(lease.claimedAt) <
        Date.parse(lease.fence.executionAuthorization.decidedAt) ||
      Date.parse(lease.leaseExpiresAt) >
        Date.parse(lease.fence.executionAuthorization.notAfter)
    ) {
      addIssue(
        context,
        ["leaseExpiresAt"],
        "A destructive fence must stay inside its active lease and authorization intervals."
      );
    }
  });

const grantedDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("granted"),
    lease: inboxV2DestructiveCheckpointLeaseSchema
  })
  .strict();

const alreadyGrantedDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("already_granted"),
    lease: inboxV2DestructiveCheckpointLeaseSchema
  })
  .strict();

const notFoundDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("not_found"),
    subject: z.enum(["plan", "run", "checkpoint"])
  })
  .strict();

const checkpointConflictDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("checkpoint_conflict"),
    facet: z.enum([
      "plan_hash",
      "requirement_hash",
      "surface",
      "registry",
      "root",
      "entity",
      "entity_revision",
      "lineage_revision",
      "handler_set"
    ])
  })
  .strict();

const policyConflictDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("policy_conflict"),
    current: inboxV2PolicyActivationAuthoritySchema.nullable()
  })
  .strict();

const controlSetConflictDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("control_set_conflict"),
    current: inboxV2DestructiveCheckpointControlSetSchema.nullable()
  })
  .strict();

const runNotExecutableDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("run_not_executable"),
    reason: z.enum([
      "terminal",
      "stage_one_pending",
      "not_before",
      "terminal_export_not_current"
    ])
  })
  .strict();

const authorizationConflictDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("authorization_conflict"),
    reason: z.enum(["not_yet_valid", "expired"])
  })
  .strict();

const blockedDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("blocked_by_legal_hold"),
    hold: inboxV2PrivacyHoldReferenceSchema,
    reviewAt: inboxV2TimestampSchema
  })
  .strict();

const ambiguousDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("scope_ambiguous"),
    controlKind: z.enum(["legal_hold", "processing_restriction"])
  })
  .strict();

const leaseConflictDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("lease_conflict"),
    state: z.enum(["claimed", "released", "expired"]),
    claimRevision: inboxV2EntityRevisionSchema,
    leaseExpiresAt: inboxV2TimestampSchema
  })
  .strict();

const completedDestructiveCheckpointResultSchema = z
  .object({
    outcome: z.literal("checkpoint_completed"),
    claimRevision: inboxV2EntityRevisionSchema
  })
  .strict();

const tokenConflictDestructiveCheckpointResultSchema = z
  .object({ outcome: z.literal("lease_token_conflict") })
  .strict();

export const inboxV2ClaimDestructiveCheckpointResultSchema =
  z.discriminatedUnion("outcome", [
    grantedDestructiveCheckpointResultSchema,
    alreadyGrantedDestructiveCheckpointResultSchema,
    notFoundDestructiveCheckpointResultSchema,
    checkpointConflictDestructiveCheckpointResultSchema,
    policyConflictDestructiveCheckpointResultSchema,
    controlSetConflictDestructiveCheckpointResultSchema,
    runNotExecutableDestructiveCheckpointResultSchema,
    authorizationConflictDestructiveCheckpointResultSchema,
    blockedDestructiveCheckpointResultSchema,
    ambiguousDestructiveCheckpointResultSchema,
    leaseConflictDestructiveCheckpointResultSchema,
    completedDestructiveCheckpointResultSchema,
    tokenConflictDestructiveCheckpointResultSchema
  ]);

export type InboxV2ObservedDestructiveCheckpoint = z.infer<
  typeof inboxV2ObservedDestructiveCheckpointSchema
>;
export type InboxV2DestructiveCheckpointControlSet = z.infer<
  typeof inboxV2DestructiveCheckpointControlSetSchema
>;
export type InboxV2ClaimDestructiveCheckpointInput = z.infer<
  typeof inboxV2ClaimDestructiveCheckpointInputSchema
>;
export type InboxV2DestructiveCheckpointLease = z.infer<
  typeof inboxV2DestructiveCheckpointLeaseSchema
>;
export type InboxV2ClaimDestructiveCheckpointResult = z.infer<
  typeof inboxV2ClaimDestructiveCheckpointResultSchema
>;

export interface InboxV2DestructiveCheckpointGuardRepository {
  claim(
    input: Readonly<InboxV2ClaimDestructiveCheckpointInput>
  ): Promise<InboxV2ClaimDestructiveCheckpointResult>;
}

const authenticDestructiveCheckpointGuardRepositories = new WeakSet<object>();

export function defineInboxV2DestructiveCheckpointGuardRepository(
  repository: InboxV2DestructiveCheckpointGuardRepository
): InboxV2DestructiveCheckpointGuardRepository {
  if (typeof repository.claim !== "function") {
    throw new Error("Destructive checkpoint guard repository is invalid.");
  }
  const result = Object.freeze({ claim: repository.claim });
  authenticDestructiveCheckpointGuardRepositories.add(result);
  return result;
}

export function isInboxV2DestructiveCheckpointGuardRepository(
  value: unknown
): value is InboxV2DestructiveCheckpointGuardRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticDestructiveCheckpointGuardRepositories.has(value)
  );
}

export async function claimInboxV2DestructiveCheckpoint(input: {
  repository: InboxV2DestructiveCheckpointGuardRepository;
  claim: z.input<typeof inboxV2ClaimDestructiveCheckpointInputSchema>;
}): Promise<InboxV2ClaimDestructiveCheckpointResult> {
  if (!authenticDestructiveCheckpointGuardRepositories.has(input.repository)) {
    throw new Error(
      "Destructive checkpoint claim requires the registered durable guard repository."
    );
  }
  const claim = inboxV2ClaimDestructiveCheckpointInputSchema.parse(input.claim);
  const result = inboxV2ClaimDestructiveCheckpointResultSchema.parse(
    await input.repository.claim(claim)
  );
  if (
    (result.outcome === "granted" || result.outcome === "already_granted") &&
    !leaseMatchesClaim(result.lease, claim)
  ) {
    throw new Error(
      "Destructive checkpoint repository returned a lease for different frozen authority."
    );
  }
  return deepFreeze(result);
}

export function calculateInboxV2DestructiveCheckpointExecutionFenceHash(
  leaseToken: string
): z.infer<typeof inboxV2Sha256DigestSchema> {
  const token = inboxV2DestructiveCheckpointLeaseTokenSchema.parse(leaseToken);
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.destructive-checkpoint-lease-token",
    hashVersion: "v1",
    token
  });
}

export function inboxV2DestructiveCheckpointExecutionHandlerId(
  checkpoint: InboxV2ObservedDestructiveCheckpoint
): z.infer<typeof inboxV2LifecycleHandlerIdSchema> {
  return executionHandlerId(checkpoint);
}

function executionHandlerId(
  checkpoint: InboxV2ObservedDestructiveCheckpoint
): z.infer<typeof inboxV2LifecycleHandlerIdSchema> {
  if (checkpoint.surface === "operated") {
    return checkpoint.handlers.deleteHandlerId;
  }
  if (checkpoint.surface === "backup") {
    return checkpoint.handlers.expiryLedgerHandlerId;
  }
  return checkpoint.handlers.externalDeleteHandlerId;
}

function leaseMatchesClaim(
  lease: InboxV2DestructiveCheckpointLease,
  claim: InboxV2ClaimDestructiveCheckpointInput
): boolean {
  return (
    lease.tenantId === claim.tenantId &&
    lease.plan.planId === claim.plan.planId &&
    lease.plan.revision === claim.plan.revision &&
    lease.plan.planHash === claim.plan.planHash &&
    lease.run.runId === claim.run.runId &&
    lease.run.revision === claim.run.revision &&
    lease.checkpoint.checkpointId === claim.checkpoint.checkpointId &&
    lease.checkpoint.requirementHash === claim.checkpoint.requirementHash &&
    calculateInboxV2CanonicalSha256(lease.checkpoint) ===
      calculateInboxV2CanonicalSha256(claim.checkpoint) &&
    sameAuthority(lease.authority, claim.expectedAuthority) &&
    lease.controlSet.legalHoldSetRevision ===
      claim.expectedControlSet.legalHoldSetRevision &&
    lease.controlSet.restrictionSetRevision ===
      claim.expectedControlSet.restrictionSetRevision &&
    lease.leaseToken === claim.leaseToken &&
    calculateInboxV2CanonicalSha256(lease.fence.executionAuthorization) ===
      calculateInboxV2CanonicalSha256(claim.executionAuthorization)
  );
}

function sameAuthority(
  left: InboxV2PolicyActivationAuthority,
  right: InboxV2PolicyActivationAuthority
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.registryCompositionHash === right.registryCompositionHash &&
    left.governance.id === right.governance.id &&
    left.governance.version === right.governance.version &&
    left.governance.contextHash === right.governance.contextHash &&
    left.effectivePolicy.id === right.effectivePolicy.id &&
    left.effectivePolicy.version === right.effectivePolicy.version &&
    left.effectivePolicy.policyHash === right.effectivePolicy.policyHash &&
    left.activation.id === right.activation.id &&
    left.activation.revision === right.activation.revision &&
    left.activation.activationHash === right.activation.activationHash
  );
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}
