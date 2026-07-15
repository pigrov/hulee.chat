import { z } from "zod";

import { inboxV2DataGovernanceContextReferenceSchema } from "./data-governance";
import {
  inboxV2DataLifecyclePolicyIdSchema,
  inboxV2DataLifecyclePolicyReferenceSchema,
  inboxV2PolicyActivationReferenceSchema
} from "./data-lifecycle-policy";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  inboxV2DeletionCheckpointIdSchema,
  inboxV2DeletionCompletionResultSchema,
  inboxV2DeletionPlanReferenceSchema,
  inboxV2DeletionRunIdSchema
} from "./privacy-deletion";
import { inboxV2PrivacyTerminalExportReferenceSchema } from "./privacy-request";
import { inboxV2DataRootReferenceSchema } from "./data-subject-discovery";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  inboxV2EntityKeySchema,
  inboxV2PayloadReferenceSchema,
  inboxV2Sha256DigestSchema
} from "./sync-primitives";

/** Durable, restart-safe authority stored in the current policy activation head. */
export const inboxV2PolicyActivationAuthoritySchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    registryCompositionHash: inboxV2Sha256DigestSchema,
    governance: inboxV2DataGovernanceContextReferenceSchema,
    effectivePolicy: inboxV2DataLifecyclePolicyReferenceSchema,
    activation: inboxV2PolicyActivationReferenceSchema
  })
  .strict()
  .superRefine((authority, context) => {
    if (
      authority.governance.tenantId !== authority.tenantId ||
      authority.effectivePolicy.tenantId !== authority.tenantId ||
      authority.activation.tenantId !== authority.tenantId
    ) {
      addIssue(
        context,
        [],
        "Policy activation authority and all lineage references must belong to one tenant."
      );
    }
  });

export const inboxV2PolicyActivationRepositoryKeySchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    policyId: inboxV2DataLifecyclePolicyIdSchema
  })
  .strict();

export const inboxV2PolicyActivationCompareAndSetInputSchema = z
  .object({
    key: inboxV2PolicyActivationRepositoryKeySchema,
    expectedCurrent: inboxV2PolicyActivationAuthoritySchema.nullable(),
    candidate: inboxV2PolicyActivationAuthoritySchema
  })
  .strict()
  .superRefine((input, context) => {
    const authorities = [input.candidate, input.expectedCurrent].filter(
      (authority) => authority !== null
    );
    if (
      authorities.some(
        (authority) =>
          authority.tenantId !== input.key.tenantId ||
          authority.effectivePolicy.id !== input.key.policyId
      )
    ) {
      addIssue(
        context,
        [],
        "Policy activation CAS key must match the tenant and policy lineage of expected and candidate authority."
      );
    }
  });

export const inboxV2PolicyActivationRepositoryLoadResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("found"),
        current: inboxV2PolicyActivationAuthoritySchema
      })
      .strict(),
    z.object({ outcome: z.literal("not_found") }).strict()
  ]);

const appliedPolicyActivationResultSchema = z
  .object({
    outcome: z.literal("applied"),
    current: inboxV2PolicyActivationAuthoritySchema
  })
  .strict();

const alreadyAppliedPolicyActivationResultSchema = z
  .object({
    outcome: z.literal("already_applied"),
    current: inboxV2PolicyActivationAuthoritySchema
  })
  .strict();

const currentConflictPolicyActivationResultSchema = z
  .object({
    outcome: z.literal("current_conflict"),
    current: inboxV2PolicyActivationAuthoritySchema
  })
  .strict();

const lineageConflictPolicyActivationResultSchema = z
  .object({
    outcome: z.literal("lineage_conflict"),
    current: inboxV2PolicyActivationAuthoritySchema.nullable()
  })
  .strict();

const missingPolicyActivationAuthoritySchema = z.enum([
  "registry_composition",
  "governance_context",
  "effective_policy",
  "activation"
]);

const missingPolicyActivationResultSchema = z
  .object({
    outcome: z.literal("not_found"),
    missingAuthority: missingPolicyActivationAuthoritySchema
  })
  .strict();

export const inboxV2PolicyActivationCompareAndSetResultSchema =
  z.discriminatedUnion("outcome", [
    appliedPolicyActivationResultSchema,
    alreadyAppliedPolicyActivationResultSchema,
    currentConflictPolicyActivationResultSchema,
    lineageConflictPolicyActivationResultSchema,
    missingPolicyActivationResultSchema
  ]);

export type InboxV2PolicyActivationAuthority = z.infer<
  typeof inboxV2PolicyActivationAuthoritySchema
>;
export type InboxV2PolicyActivationRepositoryKey = z.infer<
  typeof inboxV2PolicyActivationRepositoryKeySchema
>;
export type InboxV2PolicyActivationCompareAndSetInput = z.infer<
  typeof inboxV2PolicyActivationCompareAndSetInputSchema
>;
export type InboxV2PolicyActivationRepositoryLoadResult = z.infer<
  typeof inboxV2PolicyActivationRepositoryLoadResultSchema
>;
export type InboxV2PolicyActivationCompareAndSetResult = z.infer<
  typeof inboxV2PolicyActivationCompareAndSetResultSchema
>;

/**
 * Production implementations must persist the head and perform CAS in one
 * database transaction. Process-local maps are valid only as test adapters.
 */
export interface InboxV2PolicyActivationRepository {
  loadCurrent(
    key: Readonly<InboxV2PolicyActivationRepositoryKey>
  ): Promise<InboxV2PolicyActivationRepositoryLoadResult>;
  compareAndSetActivation(
    input: Readonly<InboxV2PolicyActivationCompareAndSetInput>
  ): Promise<InboxV2PolicyActivationCompareAndSetResult>;
}

const authenticPolicyActivationRepositories = new WeakSet<object>();

/** Trusted composition-root registration for a durable policy authority adapter. */
export function defineInboxV2PolicyActivationRepository(
  repository: InboxV2PolicyActivationRepository
): InboxV2PolicyActivationRepository {
  if (
    typeof repository.loadCurrent !== "function" ||
    typeof repository.compareAndSetActivation !== "function"
  ) {
    throw new Error("Policy activation repository is invalid.");
  }
  const result = Object.freeze({
    loadCurrent: repository.loadCurrent,
    compareAndSetActivation: repository.compareAndSetActivation
  });
  authenticPolicyActivationRepositories.add(result);
  return result;
}

export function isInboxV2PolicyActivationRepository(
  value: unknown
): value is InboxV2PolicyActivationRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticPolicyActivationRepositories.has(value)
  );
}

export async function loadInboxV2CurrentPolicyActivation(input: {
  repository: InboxV2PolicyActivationRepository;
  key: z.input<typeof inboxV2PolicyActivationRepositoryKeySchema>;
}): Promise<InboxV2PolicyActivationRepositoryLoadResult> {
  requireAuthenticRepository(input.repository);
  const key = inboxV2PolicyActivationRepositoryKeySchema.parse(input.key);
  const result = inboxV2PolicyActivationRepositoryLoadResultSchema.parse(
    await input.repository.loadCurrent(key)
  );
  if (result.outcome === "found" && !authorityMatchesKey(result.current, key)) {
    throw new Error(
      "Policy activation repository returned current authority for a different tenant or policy."
    );
  }
  return deepFreeze(result);
}

export async function compareAndSetInboxV2PolicyActivation(input: {
  repository: InboxV2PolicyActivationRepository;
  mutation: z.input<typeof inboxV2PolicyActivationCompareAndSetInputSchema>;
}): Promise<InboxV2PolicyActivationCompareAndSetResult> {
  requireAuthenticRepository(input.repository);
  const mutation = inboxV2PolicyActivationCompareAndSetInputSchema.parse(
    input.mutation
  );
  const result = inboxV2PolicyActivationCompareAndSetResultSchema.parse(
    await input.repository.compareAndSetActivation(mutation)
  );
  if ("current" in result && result.current !== null) {
    if (!authorityMatchesKey(result.current, mutation.key)) {
      throw new Error(
        "Policy activation repository returned CAS authority for a different tenant or policy."
      );
    }
    if (
      (result.outcome === "applied" || result.outcome === "already_applied") &&
      !sameAuthority(result.current, mutation.candidate)
    ) {
      throw new Error(
        "Applied policy activation CAS must return the exact candidate authority."
      );
    }
  }
  return deepFreeze(result);
}

export const inboxV2DeletionRunMutableStateSchema = z
  .object({
    state: z.enum(["executing", "verification_pending", "terminal"]),
    result: inboxV2DeletionCompletionResultSchema.nullable(),
    stageOneState: z.enum(["pending", "content_unavailable"]),
    stageOneCommittedAt: inboxV2TimestampSchema.nullable(),
    primaryAbsenceVerified: z.boolean(),
    hasInternalResidual: z.boolean(),
    hasExternalResidual: z.boolean(),
    hasBackupExpiryPending: z.boolean(),
    backupLatestPossibleExpiryAt: inboxV2TimestampSchema.nullable(),
    completedCheckpointCount: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
    completedAt: inboxV2TimestampSchema.nullable(),
    stateHash: inboxV2Sha256DigestSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((state, context) => {
    if (
      (state.state === "terminal") !==
      (state.result !== null && state.completedAt !== null)
    ) {
      addIssue(
        context,
        ["result"],
        "Only a terminal deletion run has a result and completion timestamp."
      );
    }
    if (
      (state.stageOneState === "pending") !==
      (state.stageOneCommittedAt === null)
    ) {
      addIssue(
        context,
        ["stageOneCommittedAt"],
        "Deletion stage-one state and commit timestamp must agree."
      );
    }
    if (
      state.hasBackupExpiryPending !==
      (state.backupLatestPossibleExpiryAt !== null)
    ) {
      addIssue(
        context,
        ["backupLatestPossibleExpiryAt"],
        "Backup-pending state and latest expiry timestamp must agree."
      );
    }
    if (
      state.stageOneState === "pending" &&
      (state.state !== "executing" ||
        state.completedCheckpointCount !== "0" ||
        state.primaryAbsenceVerified ||
        state.hasInternalResidual ||
        state.hasExternalResidual ||
        state.hasBackupExpiryPending ||
        state.backupLatestPossibleExpiryAt !== null)
    ) {
      addIssue(
        context,
        ["stageOneState"],
        "Pending stage one cannot report destructive checkpoint aggregates."
      );
    }
    if (
      state.stateHash !== calculateInboxV2DeletionRunMutableStateHash(state)
    ) {
      addIssue(
        context,
        ["stateHash"],
        "Deletion-run state hash must match the exact typed mutable aggregate."
      );
    }
  });

export function calculateInboxV2DeletionRunMutableStateHash(input: {
  stateHash?: unknown;
  [key: string]: unknown;
}): string {
  const { stateHash: _ignored, ...state } = input;
  const canonicalState = { ...state };
  for (const field of [
    "stageOneCommittedAt",
    "backupLatestPossibleExpiryAt",
    "completedAt",
    "updatedAt"
  ] as const) {
    if (field in canonicalState) {
      canonicalState[field] = canonicalTimestampForHash(canonicalState[field]);
    }
  }
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.deletion-run-mutable-state",
    hashVersion: "v1",
    state: canonicalState
  });
}

function canonicalTimestampForHash(value: unknown): unknown {
  if (value === null || typeof value !== "string") return value;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
}

export const inboxV2CreateDeletionRunInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    runId: inboxV2DeletionRunIdSchema,
    revision: inboxV2EntityRevisionSchema,
    plan: inboxV2DeletionPlanReferenceSchema,
    terminalExport: inboxV2PrivacyTerminalExportReferenceSchema.nullable(),
    startedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (input.plan.tenantId !== input.tenantId) {
      addIssue(
        context,
        ["plan", "tenantId"],
        "Deletion run and its frozen plan must belong to one tenant."
      );
    }
    if (
      input.terminalExport !== null &&
      input.terminalExport.tenantId !== input.tenantId
    ) {
      addIssue(
        context,
        ["terminalExport", "tenantId"],
        "Deletion run and terminal export must belong to one tenant."
      );
    }
  });

export function initialInboxV2DeletionRunMutableState(
  input: Pick<z.infer<typeof inboxV2CreateDeletionRunInputSchema>, "startedAt">
): InboxV2DeletionRunMutableState {
  const state = {
    state: "executing" as const,
    result: null,
    stageOneState: "pending" as const,
    stageOneCommittedAt: null,
    primaryAbsenceVerified: false,
    hasInternalResidual: false,
    hasExternalResidual: false,
    hasBackupExpiryPending: false,
    backupLatestPossibleExpiryAt: null,
    completedCheckpointCount: "0",
    completedAt: null,
    updatedAt: input.startedAt
  };
  return inboxV2DeletionRunMutableStateSchema.parse({
    ...state,
    stateHash: calculateInboxV2DeletionRunMutableStateHash(state)
  });
}

export const inboxV2DeletionRunStateTransitionInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    runId: inboxV2DeletionRunIdSchema,
    revision: inboxV2EntityRevisionSchema,
    expectedState: z.enum(["executing", "verification_pending"]),
    expectedStageOneState: z.enum(["pending", "content_unavailable"]),
    expectedStateRevision: inboxV2EntityRevisionSchema,
    next: inboxV2DeletionRunMutableStateSchema
  })
  .strict();

export const inboxV2DeletionStageOneTargetProofSchema = z
  .object({
    checkpointId: inboxV2DeletionCheckpointIdSchema,
    requirementHash: inboxV2Sha256DigestSchema,
    root: inboxV2DataRootReferenceSchema,
    entity: inboxV2EntityKeySchema,
    expectedRevision: inboxV2EntityRevisionSchema,
    resultingRevision: inboxV2EntityRevisionSchema,
    tombstoneManifest: inboxV2PayloadReferenceSchema,
    invalidationDigest: inboxV2Sha256DigestSchema,
    committedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((proof, context) => {
    if (
      proof.root.tenantId !== proof.entity.tenantId ||
      proof.tombstoneManifest.tenantId !== proof.entity.tenantId ||
      BigInt(proof.resultingRevision) <= BigInt(proof.expectedRevision)
    ) {
      addIssue(
        context,
        [],
        "Stage-one proof must be tenant-safe and advance the exact entity revision."
      );
    }
  });

export const inboxV2CommitDeletionStageOneInputSchema =
  inboxV2DeletionRunStateTransitionInputSchema
    .safeExtend({
      targets: z
        .array(inboxV2DeletionStageOneTargetProofSchema)
        .min(1)
        .max(100_000)
    })
    .strict()
    .superRefine((input, context) => {
      if (
        input.expectedState !== "executing" ||
        input.expectedStageOneState !== "pending" ||
        input.next.state !== "executing" ||
        input.next.stageOneState !== "content_unavailable"
      ) {
        addIssue(
          context,
          [],
          "Stage-one commit must atomically move an executing run from pending to content_unavailable."
        );
      }
      if (
        input.next.completedCheckpointCount !== "0" ||
        input.next.primaryAbsenceVerified ||
        input.next.hasInternalResidual ||
        input.next.hasExternalResidual ||
        input.next.hasBackupExpiryPending ||
        input.next.backupLatestPossibleExpiryAt !== null ||
        input.next.result !== null ||
        input.next.completedAt !== null
      ) {
        addIssue(
          context,
          ["next"],
          "Stage-one commit cannot claim destructive checkpoint outcomes before any lease is issued."
        );
      }
      const checkpointIds = input.targets.map((target) => target.checkpointId);
      if (
        new Set(checkpointIds).size !== checkpointIds.length ||
        checkpointIds.some(
          (value, index) =>
            value !==
            [...checkpointIds].sort((left, right) => left.localeCompare(right))[
              index
            ]
        )
      ) {
        addIssue(
          context,
          ["targets"],
          "Stage-one target proofs must be unique and canonically sorted."
        );
      }
      if (
        input.targets.some(
          (target) =>
            target.root.tenantId !== input.tenantId ||
            target.entity.tenantId !== input.tenantId ||
            target.tombstoneManifest.tenantId !== input.tenantId
        )
      ) {
        addIssue(
          context,
          ["targets"],
          "Stage-one target proofs cannot cross the run tenant boundary."
        );
      }
      const latestCommittedAt = Math.max(
        ...input.targets.map((target) => Date.parse(target.committedAt))
      );
      const aggregateCommittedAt = Date.parse(input.next.stageOneCommittedAt!);
      if (aggregateCommittedAt !== latestCommittedAt) {
        addIssue(
          context,
          ["next", "stageOneCommittedAt"],
          "Stage-one aggregate commit time must equal the latest target proof commit."
        );
      }
      if (aggregateCommittedAt > Date.parse(input.next.updatedAt)) {
        addIssue(
          context,
          ["next", "updatedAt"],
          "Stage-one state cannot become visible before its latest target proof commit."
        );
      }
    });

export const inboxV2DeletionRunStateTransitionResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("applied"),
        stateRevision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_applied"),
        stateRevision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z.object({ outcome: z.literal("not_found") }).strict(),
    z
      .object({
        outcome: z.literal("conflict"),
        currentState: z.enum(["executing", "verification_pending", "terminal"]),
        currentStateRevision: inboxV2EntityRevisionSchema
      })
      .strict()
  ]);

export type InboxV2DeletionRunMutableState = z.infer<
  typeof inboxV2DeletionRunMutableStateSchema
>;
export type InboxV2CreateDeletionRunInput = z.infer<
  typeof inboxV2CreateDeletionRunInputSchema
>;
export type InboxV2DeletionRunStateTransitionInput = z.infer<
  typeof inboxV2DeletionRunStateTransitionInputSchema
>;
export type InboxV2DeletionStageOneTargetProof = z.infer<
  typeof inboxV2DeletionStageOneTargetProofSchema
>;
export type InboxV2CommitDeletionStageOneInput = z.infer<
  typeof inboxV2CommitDeletionStageOneInputSchema
>;
export type InboxV2DeletionRunStateTransitionResult = z.infer<
  typeof inboxV2DeletionRunStateTransitionResultSchema
>;

export interface InboxV2DeletionRunStateRepository {
  createRun(
    input: Readonly<InboxV2CreateDeletionRunInput>
  ): Promise<InboxV2DeletionRunStateTransitionResult>;
  transition(
    input: Readonly<InboxV2DeletionRunStateTransitionInput>
  ): Promise<InboxV2DeletionRunStateTransitionResult>;
  commitStageOne(
    input: Readonly<InboxV2CommitDeletionStageOneInput>
  ): Promise<InboxV2DeletionRunStateTransitionResult>;
}

const authenticDeletionRunStateRepositories = new WeakSet<object>();

export function defineInboxV2DeletionRunStateRepository(
  repository: InboxV2DeletionRunStateRepository
): InboxV2DeletionRunStateRepository {
  if (
    typeof repository.createRun !== "function" ||
    typeof repository.transition !== "function" ||
    typeof repository.commitStageOne !== "function"
  ) {
    throw new Error("Deletion-run state repository is invalid.");
  }
  const registered = Object.freeze({
    createRun: repository.createRun,
    transition: repository.transition,
    commitStageOne: repository.commitStageOne
  });
  authenticDeletionRunStateRepositories.add(registered);
  return registered;
}

export function isInboxV2DeletionRunStateRepository(
  value: unknown
): value is InboxV2DeletionRunStateRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticDeletionRunStateRepositories.has(value)
  );
}

export async function transitionInboxV2DeletionRunState(input: {
  repository: InboxV2DeletionRunStateRepository;
  mutation: z.input<typeof inboxV2DeletionRunStateTransitionInputSchema>;
}): Promise<InboxV2DeletionRunStateTransitionResult> {
  requireAuthenticDeletionRunRepository(input.repository);
  const mutation = inboxV2DeletionRunStateTransitionInputSchema.parse(
    input.mutation
  );
  return validateDeletionRunTransitionResult(
    mutation,
    await input.repository.transition(mutation)
  );
}

export async function createInboxV2DeletionRun(input: {
  repository: InboxV2DeletionRunStateRepository;
  mutation: z.input<typeof inboxV2CreateDeletionRunInputSchema>;
}): Promise<InboxV2DeletionRunStateTransitionResult> {
  requireAuthenticDeletionRunRepository(input.repository);
  const mutation = inboxV2CreateDeletionRunInputSchema.parse(input.mutation);
  const result = inboxV2DeletionRunStateTransitionResultSchema.parse(
    await input.repository.createRun(mutation)
  );
  if (
    (result.outcome === "applied" || result.outcome === "already_applied") &&
    result.stateRevision !== "1"
  ) {
    throw new Error(
      "Created deletion run returned a wrong initial state revision."
    );
  }
  return deepFreeze(result);
}

export async function commitInboxV2DeletionStageOne(input: {
  repository: InboxV2DeletionRunStateRepository;
  mutation: z.input<typeof inboxV2CommitDeletionStageOneInputSchema>;
}): Promise<InboxV2DeletionRunStateTransitionResult> {
  requireAuthenticDeletionRunRepository(input.repository);
  const mutation = inboxV2CommitDeletionStageOneInputSchema.parse(
    input.mutation
  );
  return validateDeletionRunTransitionResult(
    mutation,
    await input.repository.commitStageOne(mutation)
  );
}

function requireAuthenticDeletionRunRepository(
  repository: InboxV2DeletionRunStateRepository
): void {
  if (!authenticDeletionRunStateRepositories.has(repository)) {
    throw new Error(
      "Deletion-run transition requires the registered durable repository."
    );
  }
}

function validateDeletionRunTransitionResult(
  mutation: InboxV2DeletionRunStateTransitionInput,
  rawResult: unknown
): InboxV2DeletionRunStateTransitionResult {
  const result = inboxV2DeletionRunStateTransitionResultSchema.parse(rawResult);
  if (
    (result.outcome === "applied" || result.outcome === "already_applied") &&
    BigInt(result.stateRevision) !== BigInt(mutation.expectedStateRevision) + 1n
  ) {
    throw new Error(
      "Applied deletion-run transition returned a wrong state revision."
    );
  }
  return deepFreeze(result);
}

function requireAuthenticRepository(
  repository: InboxV2PolicyActivationRepository
): void {
  if (!authenticPolicyActivationRepositories.has(repository)) {
    throw new Error(
      "Policy activation requires the registered durable repository."
    );
  }
}

function authorityMatchesKey(
  authority: InboxV2PolicyActivationAuthority,
  key: InboxV2PolicyActivationRepositoryKey
): boolean {
  return (
    authority.tenantId === key.tenantId &&
    authority.effectivePolicy.id === key.policyId
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
