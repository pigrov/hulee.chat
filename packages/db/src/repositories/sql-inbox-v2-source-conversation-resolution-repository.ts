import {
  inboxV2BigintCounterSchema,
  inboxV2ExternalThreadMappingSchema,
  inboxV2SourceAccountIdentitySchema,
  inboxV2SourceConversationAtomicResolutionResultSchema,
  inboxV2SourceConversationMaterializationPlanSchema,
  inboxV2SourceConversationResolutionRequestSchema,
  inboxV2SourceConversationResolutionSourceProjectionSchema,
  inboxV2SourceThreadBindingCreationCommitSchema,
  inboxV2TimestampSchema,
  isSameInboxV2SourceConversationStableRouteDescriptor,
  type InboxV2AdapterContractSnapshot,
  type InboxV2BigintCounter,
  type InboxV2ExternalThreadMapping,
  type InboxV2SourceAccountIdentity,
  type InboxV2SourceConversationAtomicResolutionResult,
  type InboxV2SourceConversationMaterializationPlan,
  type InboxV2SourceConversationResolutionConflictCode,
  type InboxV2SourceConversationResolutionRequest,
  type InboxV2SourceConversationResolutionSourceProjection,
  type InboxV2SourceNormalizedEventForIdentityResolution,
  type InboxV2SourceThreadBindingCreationCommit,
  type InboxV2SourceThreadBindingCurrentProjection
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import {
  findInboxV2ExternalThreadByExactKeyInTransaction,
  reserveInboxV2ExternalThreadExactKeyInTransaction,
  resolveOrCreateInboxV2ExternalThreadExactMappingInTransaction,
  type FindInboxV2ExternalThreadByExactKeyResult,
  type ReserveInboxV2ExternalThreadExactKeyResult,
  type ResolveOrCreateInboxV2ExternalThreadResult
} from "./sql-inbox-v2-external-thread-repository";
import { readInboxV2NormalizedEventForResolutionInTransaction } from "./sql-inbox-v2-source-identity-resolution-repository";
import {
  acquireInboxV2SourceThreadBindingTargetLockInTransaction,
  computeInboxV2SourceThreadBindingRouteDescriptorDigest,
  findCurrentInboxV2SourceThreadBindingByTargetInTransaction,
  resolveOrCreateInboxV2SourceThreadBindingInTransaction,
  type ResolveOrCreateInboxV2SourceThreadBindingResult
} from "./sql-inbox-v2-source-thread-binding-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const RESOLUTION_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const RESOLUTION_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const RESOLVE_INPUT_KEYS = new Set(["plan", "streamPosition"]);

export type ResolveInboxV2SourceConversationInput = Readonly<{
  /** Sender-free, adapter-owned candidate plan. */
  plan: InboxV2SourceConversationMaterializationPlan;
  /**
   * Position allocated by the caller's canonical tenant-stream commit. This
   * repository never invents a position; SRC-007 will own that integration.
   */
  streamPosition: InboxV2BigintCounter;
}>;

export type InboxV2SourceConversationResolutionTransactionExecutor =
  RawSqlExecutor & {
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>,
      config: Readonly<{ isolationLevel: "read committed" }>
    ): Promise<TResult>;
  };

export type InboxV2SourceConversationResolutionRepository = Readonly<{
  resolve(
    input: ResolveInboxV2SourceConversationInput
  ): Promise<InboxV2SourceConversationAtomicResolutionResult>;
}>;

export type InboxV2SourceConversationMaterializationPlanAuthorizationVerifier =
  Readonly<{
    verify(plan: InboxV2SourceConversationMaterializationPlan): boolean;
  }>;

type ResolutionDependencies = Readonly<{
  readNormalizedEvent(
    transaction: RawSqlExecutor,
    input: { tenantId: string; normalizedEventId: string }
  ): Promise<InboxV2SourceNormalizedEventForIdentityResolution | null>;
  reserveExternalThreadKey(
    transaction: RawSqlExecutor,
    input: {
      tenantId: string;
      key: InboxV2SourceConversationMaterializationPlan["source"]["thread"]["key"];
    }
  ): Promise<ReserveInboxV2ExternalThreadExactKeyResult>;
  findExternalThread(
    transaction: RawSqlExecutor,
    input: {
      tenantId: string;
      key: InboxV2SourceConversationMaterializationPlan["source"]["thread"]["key"];
    }
  ): Promise<FindInboxV2ExternalThreadByExactKeyResult>;
  resolveExternalThread(
    transaction: RawSqlExecutor,
    input: {
      mapping: InboxV2ExternalThreadMapping;
      streamPosition: InboxV2BigintCounter;
    }
  ): Promise<ResolveOrCreateInboxV2ExternalThreadResult>;
  acquireBindingTarget(
    transaction: RawSqlExecutor,
    input: {
      tenantId: string;
      externalThreadId: string;
      sourceAccountId: string;
    }
  ): Promise<void>;
  findBinding(
    transaction: RawSqlExecutor,
    input: {
      tenantId: string;
      externalThreadId: string;
      sourceAccountId: string;
    },
    options: Readonly<{ lock: boolean }>
  ): Promise<InboxV2SourceThreadBindingCurrentProjection | null>;
  resolveBinding(
    transaction: RawSqlExecutor,
    commit: InboxV2SourceThreadBindingCreationCommit
  ): Promise<ResolveOrCreateInboxV2SourceThreadBindingResult>;
}>;

/** Test seam only; production callers rely on the transaction-local helpers. */
export type CreateSqlInboxV2SourceConversationResolutionRepositoryOptions =
  Readonly<{
    /** Synchronous trusted-boundary verification; no permissive default. */
    planAuthorizationVerifier: InboxV2SourceConversationMaterializationPlanAuthorizationVerifier;
    dependencies?: Partial<ResolutionDependencies>;
  }>;

type SourceAccountIdentityRow = {
  tenant_id: unknown;
  source_account_id: unknown;
  source_connection_id: unknown;
  state: unknown;
  identity_declaration: unknown;
  canonical_realm_id: unknown;
  canonical_realm_version: unknown;
  canonicalization_version: unknown;
  canonical_object_kind_id: unknown;
  canonical_scope_kind: unknown;
  canonical_scope_source_connection_id: unknown;
  canonical_external_subject: unknown;
  verified_decision_actor_trusted_service_id: unknown;
  verified_decision_policy_id: unknown;
  verified_decision_policy_version: unknown;
  verified_decision_reason_code_id: unknown;
  verified_decision_verification_evidence_token: unknown;
  verified_decision_decided_at: unknown;
  account_generation: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type LoadedAccountIdentity =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "provisional" }>
  | Readonly<{ state: "conflicted" }>
  | Readonly<{
      state: "verified";
      identity: Extract<InboxV2SourceAccountIdentity, { state: "verified" }>;
    }>;

type MappingResolution = Readonly<{
  threadResolution: "created" | "matched_canonical" | "matched_alias";
  mapping: InboxV2ExternalThreadMapping;
  matchedAlias: Extract<
    FindInboxV2ExternalThreadByExactKeyResult,
    { kind: "found" }
  >["matchedAlias"];
  wroteMapping: boolean;
}>;

const defaultDependencies: ResolutionDependencies = {
  readNormalizedEvent: readInboxV2NormalizedEventForResolutionInTransaction,
  reserveExternalThreadKey: reserveInboxV2ExternalThreadExactKeyInTransaction,
  findExternalThread: findInboxV2ExternalThreadByExactKeyInTransaction,
  resolveExternalThread:
    resolveOrCreateInboxV2ExternalThreadExactMappingInTransaction,
  acquireBindingTarget:
    acquireInboxV2SourceThreadBindingTargetLockInTransaction,
  findBinding: findCurrentInboxV2SourceThreadBindingByTargetInTransaction,
  resolveBinding: resolveOrCreateInboxV2SourceThreadBindingInTransaction
};

/**
 * Materializes the exact ExternalThread + external Conversation +
 * account-local SourceThreadBinding in one READ COMMITTED transaction.
 */
export function createSqlInboxV2SourceConversationResolutionRepository(
  executor:
    | InboxV2SourceConversationResolutionTransactionExecutor
    | HuleeDatabase,
  options: CreateSqlInboxV2SourceConversationResolutionRepositoryOptions
): InboxV2SourceConversationResolutionRepository {
  const transactionExecutor =
    executor as unknown as InboxV2SourceConversationResolutionTransactionExecutor;
  const dependencies: ResolutionDependencies = {
    ...defaultDependencies,
    ...options.dependencies
  };

  return {
    async resolve(input) {
      const normalized = normalizeResolveInput(input);
      if (
        !isPlanAuthorized(options.planAuthorizationVerifier, normalized.plan)
      ) {
        throw new CoreError(
          "permission.denied",
          "Inbox V2 source conversation plan authorization failed."
        );
      }
      return runResolutionTransaction(
        transactionExecutor,
        async (transaction) =>
          resolveInTransaction(transaction, normalized, dependencies)
      );
    }
  };
}

function isPlanAuthorized(
  verifier: CreateSqlInboxV2SourceConversationResolutionRepositoryOptions["planAuthorizationVerifier"],
  plan: InboxV2SourceConversationMaterializationPlan
): boolean {
  try {
    return verifier.verify(plan) === true;
  } catch {
    return false;
  }
}

async function resolveInTransaction(
  transaction: RawSqlExecutor,
  input: ResolveInboxV2SourceConversationInput,
  dependencies: ResolutionDependencies
): Promise<InboxV2SourceConversationAtomicResolutionResult> {
  const plan = input.plan;
  const persisted = await dependencies.readNormalizedEvent(transaction, {
    tenantId: plan.source.tenantId,
    normalizedEventId: plan.source.normalizedInboundEvent.id
  });
  if (persisted === null) {
    return conflictResult(plan, {
      code: "source.conversation_resolution.source_event_missing",
      plan: null,
      request: requestFromSource(plan.source)
    });
  }

  const persistedRequest = requestFromPersistedEvent(persisted, plan);
  if (persisted.sourceAccount === null) {
    return conflictResult(plan, {
      code: "source.conversation_resolution.source_account_missing",
      plan: null,
      request: persistedRequest
    });
  }

  const persistedProjection = projectPersistedSource(persisted);
  if (
    persistedProjection === null ||
    !sameValue(persistedProjection, plan.source)
  ) {
    return conflictResult(plan, {
      code: "source.conversation_resolution.source_projection_conflict",
      plan,
      request: requestFromSource(plan.source)
    });
  }

  if (
    computeInboxV2SourceThreadBindingRouteDescriptorDigest(
      plan.routeDescriptor
    ) !== String(plan.routeDescriptor.descriptorDigestSha256)
  ) {
    return conflictResult(plan, {
      code: "source.conversation_resolution.route_descriptor_digest_conflict",
      plan,
      request: requestFromSource(plan.source)
    });
  }

  // Cheap fail-closed preflight keeps missing/provisional/conflicted accounts
  // from serializing a hot exact group key. The authoritative row is locked
  // and compared again after BindingHead below.
  const preflightIdentity = await loadSourceAccountIdentity(transaction, plan);
  const preflightIdentityConflict = classifyAccountIdentity(
    preflightIdentity,
    plan
  );
  if (preflightIdentityConflict !== null) {
    return conflictResult(plan, {
      code: preflightIdentityConflict,
      plan,
      request: requestFromSource(plan.source)
    });
  }
  if (preflightIdentity.state !== "verified") {
    throw new InboxV2PersistenceInvariantError(
      "Verified account preflight classification lost its identity."
    );
  }

  const keyReservation = await dependencies.reserveExternalThreadKey(
    transaction,
    {
      tenantId: plan.source.tenantId,
      key: plan.source.thread.key
    }
  );
  if (keyReservation.kind === "digest_collision") {
    return conflictResult(plan, {
      code: "source.conversation_resolution.exact_thread_key_conflict",
      plan,
      request: requestFromSource(plan.source)
    });
  }
  const targetExternalThreadId =
    keyReservation.kind === "reserved"
      ? keyReservation.reservation.canonicalThreadId
      : plan.candidateExternalThreadId;
  const bindingTarget = {
    tenantId: plan.source.tenantId,
    externalThreadId: targetExternalThreadId,
    sourceAccountId: plan.source.sourceAccount.id
  };

  // Global source lock order: exact-key advisory -> binding target/head ->
  // current account identity -> ExternalThread/Conversation. The target
  // advisory makes the absent-binding case serializable without taking the
  // ExternalThread first and inverting transition/occurrence lock order.
  await dependencies.acquireBindingTarget(transaction, bindingTarget);
  const existingBinding = await dependencies.findBinding(
    transaction,
    bindingTarget,
    { lock: true }
  );

  const loadedIdentity = await loadSourceAccountIdentity(transaction, plan, {
    lock: true
  });
  const identityConflict = classifyAccountIdentity(loadedIdentity, plan);
  if (identityConflict !== null) {
    return conflictResult(plan, {
      code: identityConflict,
      plan,
      request: requestFromSource(plan.source)
    });
  }
  if (loadedIdentity.state !== "verified") {
    throw new InboxV2PersistenceInvariantError(
      "Verified account classification lost its verified identity."
    );
  }
  if (!sameValue(loadedIdentity.identity, preflightIdentity.identity)) {
    return conflictResult(plan, {
      code: "source.conversation_resolution.account_identity_conflict",
      plan,
      request: requestFromSource(plan.source)
    });
  }
  const identity = loadedIdentity.identity;

  const mapping = await resolveMapping(transaction, input, dependencies);
  if ("conflictCode" in mapping) {
    return conflictResult(plan, {
      code: mapping.conflictCode,
      plan,
      request: requestFromSource(plan.source)
    });
  }

  if (String(mapping.mapping.thread.id) !== String(targetExternalThreadId)) {
    return conflictOrRollback(
      mapping.wroteMapping,
      conflictResult(plan, {
        code: "source.conversation_resolution.external_thread_conflict",
        plan,
        request: requestFromSource(plan.source)
      })
    );
  }

  const mappingConflict = classifyMappingConflict(mapping, plan);
  if (mappingConflict !== null) {
    return conflictOrRollback(
      mapping.wroteMapping,
      conflictResult(plan, {
        code: mappingConflict,
        plan,
        request: requestFromSource(plan.source)
      })
    );
  }

  if (existingBinding !== null) {
    const bindingConflict = classifyBindingConflict(
      existingBinding,
      mapping.mapping,
      plan
    );
    if (mapping.wroteMapping || bindingConflict !== null) {
      return conflictOrRollback(
        mapping.wroteMapping,
        conflictResult(plan, {
          code:
            bindingConflict ??
            "source.conversation_resolution.binding_conflict",
          plan,
          request: requestFromSource(plan.source)
        })
      );
    }
    return resolvedResult(plan, mapping, "already_exists", existingBinding);
  }

  const commit = buildBindingCreationCommit(plan, mapping.mapping, identity);
  const bindingResult = await dependencies.resolveBinding(transaction, commit);
  if (isResolvedBindingResult(bindingResult)) {
    if (mapping.wroteMapping && bindingResult.kind === "already_exists") {
      return conflictOrRollback(
        true,
        conflictResult(plan, {
          code: "source.conversation_resolution.binding_conflict",
          plan,
          request: requestFromSource(plan.source)
        })
      );
    }
    const bindingConflict = classifyBindingConflict(
      bindingResult.projection,
      mapping.mapping,
      plan
    );
    if (bindingConflict !== null) {
      return conflictOrRollback(
        mapping.wroteMapping || bindingResult.kind === "created",
        conflictResult(plan, {
          code: bindingConflict,
          plan,
          request: requestFromSource(plan.source)
        })
      );
    }
    return resolvedResult(
      plan,
      mapping,
      bindingResult.kind,
      bindingResult.projection
    );
  }

  if (bindingResult.kind === "binding_target_conflict") {
    const bindingConflict = classifyBindingConflict(
      bindingResult.existingProjection,
      mapping.mapping,
      plan
    );
    if (!mapping.wroteMapping && bindingConflict === null) {
      return resolvedResult(
        plan,
        mapping,
        "already_exists",
        bindingResult.existingProjection
      );
    }
    return conflictOrRollback(
      mapping.wroteMapping,
      conflictResult(plan, {
        code:
          bindingConflict ?? "source.conversation_resolution.binding_conflict",
        plan,
        request: requestFromSource(plan.source)
      })
    );
  }

  const conflictCode = bindingFailureCode(bindingResult);
  return conflictOrRollback(
    mapping.wroteMapping,
    conflictResult(plan, {
      code: conflictCode,
      plan,
      request: requestFromSource(plan.source)
    })
  );
}

async function resolveMapping(
  transaction: RawSqlExecutor,
  input: ResolveInboxV2SourceConversationInput,
  dependencies: ResolutionDependencies
): Promise<
  | MappingResolution
  | Readonly<{
      conflictCode: InboxV2SourceConversationResolutionConflictCode;
    }>
> {
  const plan = input.plan;
  const found = await dependencies.findExternalThread(transaction, {
    tenantId: plan.source.tenantId,
    key: plan.source.thread.key
  });
  if (found.kind === "digest_collision") {
    return {
      conflictCode: "source.conversation_resolution.exact_thread_key_conflict"
    };
  }
  if (found.kind === "found") {
    return {
      threadResolution:
        found.reservationKind === "alias"
          ? "matched_alias"
          : "matched_canonical",
      mapping: found.mapping,
      matchedAlias: found.matchedAlias,
      wroteMapping: false
    };
  }

  const created = await dependencies.resolveExternalThread(transaction, {
    mapping: buildCandidateMapping(plan),
    streamPosition: input.streamPosition
  });
  if (isResolvedExternalThreadResult(created)) {
    return {
      threadResolution:
        created.kind === "created" ? "created" : "matched_canonical",
      mapping: created.mapping,
      matchedAlias: null,
      wroteMapping: created.kind === "created"
    };
  }
  return { conflictCode: externalThreadFailureCode(created) };
}

function buildCandidateMapping(
  plan: InboxV2SourceConversationMaterializationPlan
): InboxV2ExternalThreadMapping {
  const tenantId = plan.source.tenantId;
  const createdAt = plan.materializedAt;
  return inboxV2ExternalThreadMappingSchema.parse({
    tenantId,
    thread: {
      tenantId,
      id: plan.candidateExternalThreadId,
      key: plan.source.thread.key,
      identityDeclaration: plan.source.thread.identityDeclaration,
      conversation: {
        tenantId,
        kind: "conversation",
        id: plan.candidateConversationId
      },
      conversationTopology: plan.topology,
      revision: "1",
      createdAt,
      updatedAt: createdAt
    },
    conversation: {
      tenantId,
      id: plan.candidateConversationId,
      topology: plan.topology,
      transport: "external",
      purposeId: plan.purposeId,
      lifecycle: "active",
      head: {
        latestTimelineSequence: "0",
        latestActivityItemId: null,
        latestActivityTimelineSequence: null,
        latestActivityAt: null,
        revision: "1",
        createdAt,
        updatedAt: createdAt
      },
      revision: "1",
      createdAt,
      updatedAt: createdAt
    }
  });
}

function buildBindingCreationCommit(
  plan: InboxV2SourceConversationMaterializationPlan,
  mapping: InboxV2ExternalThreadMapping,
  identity: Extract<InboxV2SourceAccountIdentity, { state: "verified" }>
): InboxV2SourceThreadBindingCreationCommit {
  const tenantId = plan.source.tenantId;
  const createdAt = plan.materializedAt;
  const evidence = [plan.source.normalizedInboundEvent];
  const bindingReference = {
    tenantId,
    kind: "source_thread_binding" as const,
    id: plan.candidateSourceThreadBindingId
  };
  const binding = {
    tenantId,
    id: plan.candidateSourceThreadBindingId,
    externalThread: {
      tenantId,
      kind: "external_thread" as const,
      id: mapping.thread.id
    },
    sourceConnection: plan.source.sourceConnection,
    sourceAccount: plan.source.sourceAccount,
    accountIdentitySnapshot: {
      status: "verified" as const,
      sourceConnection: identity.sourceConnection,
      sourceAccount: identity.sourceAccount,
      declaration: identity.identityDeclaration,
      realmId: identity.canonicalIdentity.realm.realmId,
      canonicalExternalSubject:
        identity.canonicalIdentity.canonicalExternalSubject,
      accountGeneration: identity.accountGeneration,
      verificationEvidence: evidence,
      verifiedAt: identity.updatedAt
    },
    bindingGeneration: "1",
    remoteAccess: {
      state: "observed" as const,
      evidenceAuthority: "direct_observation" as const,
      revision: "1",
      since: createdAt,
      evidence
    },
    administrative: {
      state: "disabled" as const,
      revision: "1",
      changedAt: createdAt
    },
    runtimeHealth: {
      state: "unknown" as const,
      revision: "1",
      checkedAt: createdAt,
      diagnostic: null
    },
    historySync: {
      state: plan.historySyncState,
      revision: "1",
      receiveCursor: null,
      historyCursor: null,
      providerWatermark: null,
      lastDurableRawEvent: null,
      updatedAt: createdAt,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: [],
      evidence,
      observedAt: createdAt
    },
    capabilities: {
      adapterContract: plan.source.adapterContract,
      revision: "1",
      capturedAt: createdAt,
      entries: plan.capabilityEntries
    },
    routeDescriptor: plan.routeDescriptor,
    revision: "1",
    createdAt,
    updatedAt: createdAt
  };

  return inboxV2SourceThreadBindingCreationCommitSchema.parse({
    tenantId,
    externalThreadMapping: mapping,
    sourceAccountIdentity: identity,
    initialProjection: {
      binding,
      currentRemoteAccessEpisode: {
        tenantId,
        id: plan.candidateRemoteAccessEpisodeId,
        binding: bindingReference,
        state: "observed",
        startedAt: createdAt,
        endedAt: null,
        startEvidence: evidence,
        endEvidence: [],
        revision: "1",
        createdAt,
        updatedAt: createdAt
      }
    }
  });
}

function classifyMappingConflict(
  resolution: MappingResolution,
  plan: InboxV2SourceConversationMaterializationPlan
): InboxV2SourceConversationResolutionConflictCode | null {
  const mapping = resolution.mapping;
  if (
    mapping.conversation.topology !== plan.topology ||
    mapping.thread.conversationTopology !== plan.topology
  ) {
    return "source.conversation_resolution.topology_conflict";
  }
  if (String(mapping.conversation.purposeId) !== String(plan.purposeId)) {
    return "source.conversation_resolution.conversation_conflict";
  }
  if (
    !sameAdapterSurface(
      mapping.thread.identityDeclaration.adapterContract,
      plan.source.adapterContract
    ) ||
    (resolution.matchedAlias !== null &&
      !sameAdapterSurface(
        resolution.matchedAlias.aliasIdentityDeclaration.adapterContract,
        plan.source.adapterContract
      ))
  ) {
    return "source.conversation_resolution.adapter_surface_conflict";
  }
  if (
    resolution.threadResolution !== "matched_alias" &&
    !sameValue(mapping.thread.key, plan.source.thread.key)
  ) {
    return "source.conversation_resolution.exact_thread_key_conflict";
  }
  return null;
}

function classifyBindingConflict(
  projection: InboxV2SourceThreadBindingCurrentProjection,
  mapping: InboxV2ExternalThreadMapping,
  plan: InboxV2SourceConversationMaterializationPlan
): InboxV2SourceConversationResolutionConflictCode | null {
  const binding = projection.binding;
  if (
    !sameReference(binding.externalThread, {
      tenantId: mapping.tenantId,
      kind: "external_thread",
      id: mapping.thread.id
    }) ||
    !sameReference(binding.sourceConnection, plan.source.sourceConnection) ||
    !sameReference(binding.sourceAccount, plan.source.sourceAccount)
  ) {
    return "source.conversation_resolution.binding_conflict";
  }
  for (const contract of [
    binding.accountIdentitySnapshot.declaration.adapterContract,
    binding.capabilities.adapterContract,
    binding.routeDescriptor.adapterContract
  ]) {
    if (!sameAdapterSurface(contract, plan.source.adapterContract)) {
      return "source.conversation_resolution.adapter_surface_conflict";
    }
  }
  if (String(binding.routeDescriptor.descriptorRevision) === "1") {
    if (
      !isSameInboxV2SourceConversationStableRouteDescriptor(
        binding.routeDescriptor,
        plan.routeDescriptor
      )
    ) {
      return "source.conversation_resolution.binding_conflict";
    }
  }
  return null;
}

function resolvedResult(
  plan: InboxV2SourceConversationMaterializationPlan,
  mapping: MappingResolution,
  bindingResolution: "created" | "already_exists",
  sourceThreadBinding: InboxV2SourceThreadBindingCurrentProjection
): InboxV2SourceConversationAtomicResolutionResult {
  return inboxV2SourceConversationAtomicResolutionResultSchema.parse({
    outcome: "resolved",
    plan,
    threadResolution: mapping.threadResolution,
    bindingResolution,
    matchedAlias: mapping.matchedAlias,
    externalThreadMapping: mapping.mapping,
    sourceThreadBinding,
    resolvedAt: latestTimestamp([
      plan.materializedAt,
      mapping.mapping.thread.createdAt,
      mapping.mapping.conversation.updatedAt,
      sourceThreadBinding.binding.updatedAt
    ])
  });
}

function conflictResult(
  authorityPlan: InboxV2SourceConversationMaterializationPlan,
  input: Readonly<{
    code: InboxV2SourceConversationResolutionConflictCode;
    plan: InboxV2SourceConversationMaterializationPlan | null;
    request: InboxV2SourceConversationResolutionRequest;
  }>
): InboxV2SourceConversationAtomicResolutionResult {
  return inboxV2SourceConversationAtomicResolutionResultSchema.parse({
    outcome: "conflict",
    request: input.request,
    plan: input.plan,
    conflictCode: input.code,
    retryable: false,
    diagnostic: null,
    conflictedByTrustedServiceId: authorityPlan.materializedByTrustedServiceId,
    conflictToken: authorityPlan.materializationToken,
    conflictedAt: authorityPlan.materializedAt
  });
}

function conflictOrRollback(
  wroteMapping: boolean,
  result: InboxV2SourceConversationAtomicResolutionResult
): InboxV2SourceConversationAtomicResolutionResult {
  if (wroteMapping) throw new ResolutionConflictRollback(result);
  return result;
}

function externalThreadFailureCode(
  result: ResolveOrCreateInboxV2ExternalThreadResult
): InboxV2SourceConversationResolutionConflictCode {
  switch (result.kind) {
    case "digest_collision":
    case "exact_key_conflict":
    case "key_reserved_as_alias":
      return "source.conversation_resolution.exact_thread_key_conflict";
    case "thread_id_conflict":
      return "source.conversation_resolution.external_thread_conflict";
    case "conversation_conflict":
    case "conversation_identity_conflict":
      return "source.conversation_resolution.conversation_conflict";
    case "created":
    case "already_exists":
      throw new InboxV2PersistenceInvariantError(
        "Resolved ExternalThread result reached failure classification."
      );
  }
}

function bindingFailureCode(
  result: ResolveOrCreateInboxV2SourceThreadBindingResult
): InboxV2SourceConversationResolutionConflictCode {
  switch (result.kind) {
    case "source_account_identity_not_found":
      return "source.conversation_resolution.account_identity_not_verified";
    case "source_account_identity_conflict":
      return "source.conversation_resolution.account_identity_conflict";
    case "external_thread_not_found":
    case "external_thread_mapping_conflict":
      return "source.conversation_resolution.external_thread_conflict";
    case "binding_id_conflict":
      return "source.conversation_resolution.binding_conflict";
    case "binding_target_conflict":
    case "created":
    case "already_exists":
      throw new InboxV2PersistenceInvariantError(
        "Resolved/target binding result reached failure classification."
      );
  }
}

export function buildFindInboxV2SourceConversationAccountIdentitySql(input: {
  tenantId: string;
  sourceAccountId: string;
  lock?: boolean;
}): SQL {
  const lockClause = input.lock ? sql`for share` : sql``;
  return sql`
    select
      tenant_id,
      source_account_id,
      source_connection_id,
      state,
      identity_declaration,
      canonical_realm_id,
      canonical_realm_version,
      canonicalization_version,
      canonical_object_kind_id,
      canonical_scope_kind,
      canonical_scope_source_connection_id,
      canonical_external_subject,
      verified_decision_actor_trusted_service_id,
      verified_decision_policy_id,
      verified_decision_policy_version,
      verified_decision_reason_code_id,
      verified_decision_verification_evidence_token,
      verified_decision_decided_at,
      account_generation,
      revision,
      created_at,
      updated_at
    from public.inbox_v2_source_account_identities
    where tenant_id = ${input.tenantId}
      and source_account_id = ${input.sourceAccountId}
    ${lockClause}
  `;
}

async function loadSourceAccountIdentity(
  executor: RawSqlExecutor,
  plan: InboxV2SourceConversationMaterializationPlan,
  options: Readonly<{ lock?: boolean }> = {}
): Promise<LoadedAccountIdentity> {
  const result = await executor.execute<SourceAccountIdentityRow>(
    buildFindInboxV2SourceConversationAccountIdentitySql({
      tenantId: plan.source.tenantId,
      sourceAccountId: plan.source.sourceAccount.id,
      lock: options.lock ?? false
    })
  );
  if (result.rows.length > 1) {
    throw new InboxV2PersistenceInvariantError(
      "SourceAccountIdentity lookup returned multiple tenant-scoped rows."
    );
  }
  const row = result.rows[0];
  if (row === undefined) return { state: "missing" };
  if (row.state === "provisional") return { state: "provisional" };
  if (row.state === "conflicted") return { state: "conflicted" };
  if (row.state !== "verified") {
    throw new InboxV2PersistenceInvariantError(
      "SourceAccountIdentity row has an unsupported state."
    );
  }

  const sourceConnection = {
    tenantId: String(row.tenant_id),
    kind: "source_connection" as const,
    id: String(row.source_connection_id)
  };
  const scope =
    row.canonical_scope_kind === "provider"
      ? ({ kind: "provider" } as const)
      : row.canonical_scope_kind === "source_connection"
        ? ({
            kind: "source_connection" as const,
            owner: {
              tenantId: String(row.tenant_id),
              kind: "source_connection" as const,
              id: String(row.canonical_scope_source_connection_id)
            }
          } as const)
        : null;
  if (scope === null) {
    throw new InboxV2PersistenceInvariantError(
      "Verified SourceAccountIdentity row has no canonical scope."
    );
  }

  const identity = inboxV2SourceAccountIdentitySchema.parse({
    tenantId: String(row.tenant_id),
    sourceAccount: {
      tenantId: String(row.tenant_id),
      kind: "source_account",
      id: String(row.source_account_id)
    },
    sourceConnection,
    identityDeclaration: row.identity_declaration,
    accountGeneration: databaseBigint(
      row.account_generation,
      "SourceAccountIdentity.accountGeneration"
    ),
    revision: databaseBigint(row.revision, "SourceAccountIdentity.revision"),
    createdAt: databaseTimestamp(
      row.created_at,
      "SourceAccountIdentity.createdAt"
    ),
    updatedAt: databaseTimestamp(
      row.updated_at,
      "SourceAccountIdentity.updatedAt"
    ),
    state: "verified",
    expectedCanonicalScope: null,
    provisionalIdentity: null,
    canonicalIdentity: {
      realm: {
        realmId: String(row.canonical_realm_id),
        realmVersion: String(row.canonical_realm_version),
        canonicalizationVersion: String(row.canonicalization_version),
        objectKindId: String(row.canonical_object_kind_id)
      },
      scope,
      canonicalExternalSubject: String(row.canonical_external_subject)
    },
    verifiedBy: {
      actor: {
        kind: "trusted_service",
        trustedServiceId: String(row.verified_decision_actor_trusted_service_id)
      },
      policyId: String(row.verified_decision_policy_id),
      policyVersion: String(row.verified_decision_policy_version),
      reasonCodeId: String(row.verified_decision_reason_code_id),
      verificationEvidenceToken: String(
        row.verified_decision_verification_evidence_token
      ),
      decidedAt: databaseTimestamp(
        row.verified_decision_decided_at,
        "SourceAccountIdentity.verifiedBy.decidedAt"
      )
    },
    conflict: null
  });
  if (identity.state !== "verified") {
    throw new InboxV2PersistenceInvariantError(
      "Verified SourceAccountIdentity row parsed to a non-verified state."
    );
  }
  return { state: "verified", identity };
}

function classifyAccountIdentity(
  loaded: LoadedAccountIdentity,
  plan: InboxV2SourceConversationMaterializationPlan
): InboxV2SourceConversationResolutionConflictCode | null {
  if (loaded.state === "missing" || loaded.state === "provisional") {
    return "source.conversation_resolution.account_identity_not_verified";
  }
  if (loaded.state === "conflicted") {
    return "source.conversation_resolution.account_identity_conflict";
  }
  const identity = loaded.identity;
  return !sameReference(
    identity.sourceConnection,
    plan.source.sourceConnection
  ) ||
    !sameReference(identity.sourceAccount, plan.source.sourceAccount) ||
    !sameAdapterSurface(
      identity.identityDeclaration.adapterContract,
      plan.source.adapterContract
    ) ||
    Date.parse(identity.updatedAt) > Date.parse(plan.materializedAt)
    ? "source.conversation_resolution.account_identity_conflict"
    : null;
}

function projectPersistedSource(
  event: InboxV2SourceNormalizedEventForIdentityResolution
): InboxV2SourceConversationResolutionSourceProjection | null {
  const parsed =
    inboxV2SourceConversationResolutionSourceProjectionSchema.safeParse({
      tenantId: event.tenantId,
      rawInboundEvent: event.rawInboundEvent,
      normalizedInboundEvent: event.normalizedInboundEvent,
      sourceConnection: event.sourceConnection,
      sourceAccount: event.sourceAccount,
      domain: event.domain,
      schemaId: event.schemaId,
      schemaVersion: event.schemaVersion,
      safeEnvelopeHmacSha256: event.safeEnvelopeHmacSha256,
      adapterContract: event.adapterContract,
      thread: event.thread,
      recordedAt: event.recordedAt
    });
  return parsed.success ? parsed.data : null;
}

function requestFromPersistedEvent(
  event: InboxV2SourceNormalizedEventForIdentityResolution,
  fallbackPlan: InboxV2SourceConversationMaterializationPlan
): InboxV2SourceConversationResolutionRequest {
  const parsed = inboxV2SourceConversationResolutionRequestSchema.safeParse({
    tenantId: event.tenantId,
    rawInboundEvent: event.rawInboundEvent,
    normalizedInboundEvent: event.normalizedInboundEvent,
    sourceConnection: event.sourceConnection,
    sourceAccount: event.sourceAccount
  });
  return parsed.success ? parsed.data : requestFromSource(fallbackPlan.source);
}

function requestFromSource(
  source: InboxV2SourceConversationResolutionSourceProjection
): InboxV2SourceConversationResolutionRequest {
  return inboxV2SourceConversationResolutionRequestSchema.parse({
    tenantId: source.tenantId,
    rawInboundEvent: source.rawInboundEvent,
    normalizedInboundEvent: source.normalizedInboundEvent,
    sourceConnection: source.sourceConnection,
    sourceAccount: source.sourceAccount
  });
}

function normalizeResolveInput(
  input: ResolveInboxV2SourceConversationInput
): ResolveInboxV2SourceConversationInput {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.keys(input).some((key) => !RESOLVE_INPUT_KEYS.has(key)) ||
    Object.keys(input).length !== RESOLVE_INPUT_KEYS.size
  ) {
    throw new CoreError(
      "validation.failed",
      "Source conversation resolution accepts only plan and streamPosition."
    );
  }
  const plan = inboxV2SourceConversationMaterializationPlanSchema.parse(
    input.plan
  );
  const streamPosition = inboxV2BigintCounterSchema.parse(input.streamPosition);
  if (streamPosition === "0") {
    throw new CoreError(
      "validation.failed",
      "Source conversation creation requires a positive tenant-stream position."
    );
  }
  return { plan, streamPosition };
}

async function runResolutionTransaction<TResult>(
  executor: InboxV2SourceConversationResolutionTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= RESOLUTION_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await executor.transaction(work, RESOLUTION_TRANSACTION_CONFIG);
    } catch (error) {
      if (error instanceof ResolutionConflictRollback) {
        return error.result as TResult;
      }
      lastError = error;
      if (
        attempt === RESOLUTION_TRANSACTION_ATTEMPTS ||
        !RETRYABLE_SQLSTATES.has(databaseErrorCode(error) ?? "")
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

class ResolutionConflictRollback extends Error {
  constructor(
    readonly result: InboxV2SourceConversationAtomicResolutionResult
  ) {
    super("Inbox V2 source conversation resolution rolled back a conflict.");
    this.name = "ResolutionConflictRollback";
  }
}

function databaseErrorCode(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      typeof (current as { code?: unknown }).code === "string"
    ) {
      return (current as { code: string }).code;
    }
    if (typeof current !== "object" || !("cause" in current)) break;
    const cause = (current as { cause?: unknown }).cause;
    if (!cause || cause === current) break;
    current = cause;
  }
  return null;
}

function databaseBigint(value: unknown, field: string): string {
  const candidate =
    typeof value === "bigint"
      ? value.toString()
      : typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : String(value);
  try {
    return inboxV2BigintCounterSchema.parse(candidate);
  } catch (error) {
    throw new InboxV2PersistenceInvariantError(
      `${field} is not a canonical PostgreSQL bigint: ${error instanceof Error ? error.message : "invalid value"}.`
    );
  }
}

function databaseTimestamp(value: unknown, field: string): string {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (parsed === null || Number.isNaN(parsed.getTime())) {
    throw new InboxV2PersistenceInvariantError(
      `${field} is not a PostgreSQL timestamp.`
    );
  }
  return inboxV2TimestampSchema.parse(parsed.toISOString());
}

function isResolvedExternalThreadResult(
  result: ResolveOrCreateInboxV2ExternalThreadResult
): result is Extract<
  ResolveOrCreateInboxV2ExternalThreadResult,
  { mapping: InboxV2ExternalThreadMapping }
> {
  return result.kind === "created" || result.kind === "already_exists";
}

function isResolvedBindingResult(
  result: ResolveOrCreateInboxV2SourceThreadBindingResult
): result is Extract<
  ResolveOrCreateInboxV2SourceThreadBindingResult,
  { projection: InboxV2SourceThreadBindingCurrentProjection }
> {
  return result.kind === "created" || result.kind === "already_exists";
}

function latestTimestamp(values: readonly string[]): string {
  return values.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest
  );
}

function sameAdapterSurface(
  left: InboxV2AdapterContractSnapshot,
  right: InboxV2AdapterContractSnapshot
): boolean {
  return (
    String(left.contractId) === String(right.contractId) &&
    String(left.contractVersion) === String(right.contractVersion) &&
    String(left.surfaceId) === String(right.surfaceId)
  );
}

function sameReference(
  left: Readonly<{ tenantId: string; kind: string; id: unknown }>,
  right: Readonly<{ tenantId: string; kind: string; id: unknown }>
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.kind === right.kind &&
    String(left.id) === String(right.id)
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
