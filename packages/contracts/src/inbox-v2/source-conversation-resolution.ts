import { z } from "zod";

import { inboxV2ConversationPurposeIdSchema } from "./conversation";
import {
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ExternalThreadAliasSchema,
  inboxV2ExternalThreadMappingSchema,
  type InboxV2ExternalThreadKey
} from "./external-thread";
import {
  inboxV2ConversationIdSchema,
  inboxV2ExternalThreadIdSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2RawInboundEventReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2SourceThreadBindingRemoteAccessEpisodeIdSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import { inboxV2DeferredParticipantExternalThreadContextSchema } from "./source-identity-resolution";
import {
  INBOX_V2_NORMALIZED_EVENT_ENVELOPE_SCHEMA_ID,
  inboxV2SourceNormalizationHmacSha256Schema
} from "./source-normalized-ingress";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2OpaqueAdapterRouteDescriptorSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SafeSourceDiagnosticSchema,
  type InboxV2AdapterContractSnapshot,
  type InboxV2OpaqueAdapterRouteDescriptor
} from "./source-routing-primitives";
import {
  INBOX_V2_SOURCE_THREAD_BINDING_CAPABILITY_ENTRY_MAX,
  inboxV2SourceThreadBindingCapabilityEntrySchema,
  inboxV2SourceThreadBindingCurrentProjectionSchema
} from "./source-thread-binding";

export const INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SOURCE_PROJECTION_SCHEMA_ID =
  "core:inbox-v2.source-conversation-resolution-source-projection" as const;
export const INBOX_V2_SOURCE_CONVERSATION_MATERIALIZATION_PLAN_SCHEMA_ID =
  "core:inbox-v2.source-conversation-materialization-plan" as const;
export const INBOX_V2_SOURCE_CONVERSATION_ATOMIC_RESOLUTION_RESULT_SCHEMA_ID =
  "core:inbox-v2.source-conversation-atomic-resolution-result" as const;
export const INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_SOURCE_CONVERSATION_CAPABILITY_ENTRY_MAX = Math.min(
  64,
  INBOX_V2_SOURCE_THREAD_BINDING_CAPABILITY_ENTRY_MAX
);

/**
 * Minimal sender-free lookup proof available even when the persisted source
 * envelope or its SourceAccount projection cannot be loaded.
 */
export const inboxV2SourceConversationResolutionRequestSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rawInboundEvent: inboxV2RawInboundEventReferenceSchema,
    normalizedInboundEvent: inboxV2NormalizedInboundEventReferenceSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema.nullable()
  })
  .strict()
  .superRefine((request, context) => {
    for (const [field, reference] of [
      ["rawInboundEvent", request.rawInboundEvent],
      ["normalizedInboundEvent", request.normalizedInboundEvent],
      ["sourceConnection", request.sourceConnection]
    ] as const) {
      addTenantReferenceIssue(context, request.tenantId, reference, [field]);
    }
    if (request.sourceAccount !== null) {
      addTenantReferenceIssue(
        context,
        request.tenantId,
        request.sourceAccount,
        ["sourceAccount"]
      );
    }
  });

/**
 * Closed projection of the SRC-003 safe envelope used by canonical direct and
 * group resolution. Client, sender, title and caller-selected Conversation
 * fields are deliberately absent and rejected by strict parsing.
 */
export const inboxV2SourceConversationResolutionSourceProjectionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rawInboundEvent: inboxV2RawInboundEventReferenceSchema,
    normalizedInboundEvent: inboxV2NormalizedInboundEventReferenceSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    domain: z.literal("core:inbox-v2.normalized-event-safe-envelope"),
    schemaId: z.literal(INBOX_V2_NORMALIZED_EVENT_ENVELOPE_SCHEMA_ID),
    schemaVersion: z.literal(INBOX_V2_INITIAL_SCHEMA_VERSION),
    safeEnvelopeHmacSha256: inboxV2SourceNormalizationHmacSha256Schema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    thread: inboxV2DeferredParticipantExternalThreadContextSchema,
    recordedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((source, context) => {
    const request = {
      tenantId: source.tenantId,
      rawInboundEvent: source.rawInboundEvent,
      normalizedInboundEvent: source.normalizedInboundEvent,
      sourceConnection: source.sourceConnection,
      sourceAccount: source.sourceAccount
    };
    const requestResult =
      inboxV2SourceConversationResolutionRequestSchema.safeParse(request);
    if (!requestResult.success) {
      addIssue(
        context,
        [],
        "Source projection references must share one exact tenant."
      );
    }

    if (
      !sameReference(source.thread.sourceConnection, source.sourceConnection) ||
      source.thread.sourceAccount === null ||
      !sameReference(source.thread.sourceAccount, source.sourceAccount)
    ) {
      addIssue(
        context,
        ["thread"],
        "Conversation resolution thread context must retain the exact non-null SourceConnection and SourceAccount projection."
      );
    }
    if (
      !sameValue(
        source.thread.identityDeclaration.adapterContract,
        source.adapterContract
      )
    ) {
      addIssue(
        context,
        ["thread", "identityDeclaration", "adapterContract"],
        "Thread declaration must retain the exact normalized-event adapter contract."
      );
    }
    addThreadScopeIssues(
      context,
      source.thread.key,
      source.sourceConnection,
      source.sourceAccount,
      ["thread", "key", "scope"]
    );
    if (
      !isInboxV2TimestampOrderValid(
        source.adapterContract.loadedAt,
        source.recordedAt
      )
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "Conversation resolution source cannot predate its pinned adapter contract."
      );
    }
  });

export const inboxV2SourceConversationTopologySchema = z.enum([
  "direct",
  "group"
]);

export const inboxV2SourceConversationInitialHistorySyncStateSchema = z.enum([
  "unsupported",
  "not_started"
]);

/**
 * Provider-neutral, trusted candidate plan. Provider details are confined to
 * the pinned identity declaration, opaque route descriptor and capability
 * entries; core never reconstructs a destination from sender identity.
 */
export const inboxV2SourceConversationMaterializationPlanSchema = z
  .object({
    source: inboxV2SourceConversationResolutionSourceProjectionSchema,
    topology: inboxV2SourceConversationTopologySchema,
    purposeId: inboxV2ConversationPurposeIdSchema,
    routeDescriptor: inboxV2OpaqueAdapterRouteDescriptorSchema,
    candidateConversationId: inboxV2ConversationIdSchema,
    candidateExternalThreadId: inboxV2ExternalThreadIdSchema,
    candidateSourceThreadBindingId: inboxV2SourceThreadBindingIdSchema,
    candidateRemoteAccessEpisodeId:
      inboxV2SourceThreadBindingRemoteAccessEpisodeIdSchema,
    capabilityEntries: z
      .array(inboxV2SourceThreadBindingCapabilityEntrySchema)
      .max(INBOX_V2_SOURCE_CONVERSATION_CAPABILITY_ENTRY_MAX),
    historySyncState: inboxV2SourceConversationInitialHistorySyncStateSchema,
    namespaceGeneration: inboxV2RoutingTokenSchema,
    materializedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    materializationToken: inboxV2RoutingTokenSchema,
    materializedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((plan, context) => {
    const source = plan.source;
    if (
      !sameValue(plan.routeDescriptor.adapterContract, source.adapterContract)
    ) {
      addIssue(
        context,
        ["routeDescriptor", "adapterContract"],
        "A candidate route descriptor must retain the exact normalized-source adapter snapshot."
      );
    }
    if (String(plan.routeDescriptor.descriptorRevision) !== "1") {
      addIssue(
        context,
        ["routeDescriptor", "descriptorRevision"],
        "A materialization candidate may carry only route descriptor revision 1."
      );
    }
    if (
      String(plan.materializedByTrustedServiceId) !==
      String(source.adapterContract.loadedByTrustedServiceId)
    ) {
      addIssue(
        context,
        ["materializedByTrustedServiceId"],
        "Conversation materialization must use the trusted service pinned by the source adapter contract."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(source.recordedAt, plan.materializedAt) ||
      !isInboxV2TimestampOrderValid(
        plan.routeDescriptor.adapterContract.loadedAt,
        plan.materializedAt
      )
    ) {
      addIssue(
        context,
        ["materializedAt"],
        "Materialization cannot predate its normalized source or pinned route contract."
      );
    }

    const capabilityKeys = new Set<string>();
    for (const [index, entry] of plan.capabilityEntries.entries()) {
      const key = [
        String(entry.capabilityId),
        String(entry.operationId),
        entry.contentKindId === null ? "" : String(entry.contentKindId)
      ].join("\u0000");
      if (capabilityKeys.has(key)) {
        addIssue(
          context,
          ["capabilityEntries", index],
          "Initial capability entries must be unique per capability, operation and content kind."
        );
      }
      capabilityKeys.add(key);

      for (const [evidenceIndex, evidence] of entry.evidence.entries()) {
        addTenantReferenceIssue(context, source.tenantId, evidence, [
          "capabilityEntries",
          index,
          "evidence",
          evidenceIndex
        ]);
      }
      if (
        entry.state === "expired" &&
        entry.validUntil !== null &&
        !isInboxV2TimestampOrderValid(entry.validUntil, plan.materializedAt)
      ) {
        addIssue(
          context,
          ["capabilityEntries", index, "validUntil"],
          "Expired capability boundary cannot follow materialization time."
        );
      }
      if (
        entry.state === "supported" &&
        entry.validUntil !== null &&
        isInboxV2TimestampOrderValid(entry.validUntil, plan.materializedAt)
      ) {
        addIssue(
          context,
          ["capabilityEntries", index, "validUntil"],
          "Supported capability cannot already be expired at materialization time."
        );
      }
    }
  });

export const inboxV2SourceConversationThreadResolutionSchema = z.enum([
  "created",
  "matched_canonical",
  "matched_alias"
]);

export const inboxV2SourceConversationBindingResolutionSchema = z.enum([
  "created",
  "already_exists"
]);

export const inboxV2SourceConversationResolutionConflictCodeSchema = z.enum([
  "source.conversation_resolution.source_event_missing",
  "source.conversation_resolution.source_account_missing",
  "source.conversation_resolution.source_projection_conflict",
  "source.conversation_resolution.account_identity_not_verified",
  "source.conversation_resolution.account_identity_conflict",
  "source.conversation_resolution.exact_thread_key_conflict",
  "source.conversation_resolution.route_descriptor_digest_conflict",
  "source.conversation_resolution.external_thread_conflict",
  "source.conversation_resolution.conversation_conflict",
  "source.conversation_resolution.topology_conflict",
  "source.conversation_resolution.adapter_surface_conflict",
  "source.conversation_resolution.binding_conflict"
]);

const resolvedSourceConversationSchema = z
  .object({
    outcome: z.literal("resolved"),
    plan: inboxV2SourceConversationMaterializationPlanSchema,
    threadResolution: inboxV2SourceConversationThreadResolutionSchema,
    bindingResolution: inboxV2SourceConversationBindingResolutionSchema,
    matchedAlias: inboxV2ExternalThreadAliasSchema.nullable(),
    externalThreadMapping: inboxV2ExternalThreadMappingSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingCurrentProjectionSchema,
    resolvedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((result, context) => {
    addResolvedSourceConversationIssues(context, result);
  });

const conflictedSourceConversationSchema = z
  .object({
    outcome: z.literal("conflict"),
    request: inboxV2SourceConversationResolutionRequestSchema,
    plan: inboxV2SourceConversationMaterializationPlanSchema.nullable(),
    conflictCode: inboxV2SourceConversationResolutionConflictCodeSchema,
    retryable: z.boolean(),
    diagnostic: inboxV2SafeSourceDiagnosticSchema.nullable(),
    conflictedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    conflictToken: inboxV2RoutingTokenSchema,
    conflictedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((result, context) => {
    const isPrePlanConflict =
      result.conflictCode ===
        "source.conversation_resolution.source_event_missing" ||
      result.conflictCode ===
        "source.conversation_resolution.source_account_missing";

    if (isPrePlanConflict !== (result.plan === null)) {
      addIssue(
        context,
        ["plan"],
        "Only missing source-event/account conflicts may occur before a materialization plan exists."
      );
    }
    if (
      result.conflictCode ===
        "source.conversation_resolution.source_account_missing" &&
      result.request.sourceAccount !== null
    ) {
      addIssue(
        context,
        ["request", "sourceAccount"],
        "A source-account-missing conflict requires a null SourceAccount lookup result."
      );
    }
    if (result.plan !== null) {
      if (!requestMatchesSource(result.request, result.plan.source)) {
        addIssue(
          context,
          ["request"],
          "Conflict request must identify the exact normalized source retained by its plan."
        );
      }
      if (
        String(result.conflictedByTrustedServiceId) !==
        String(result.plan.materializedByTrustedServiceId)
      ) {
        addIssue(
          context,
          ["conflictedByTrustedServiceId"],
          "Post-plan conflict must be reported by the plan's trusted materialization service."
        );
      }
      if (
        !isInboxV2TimestampOrderValid(
          result.plan.materializedAt,
          result.conflictedAt
        )
      ) {
        addIssue(
          context,
          ["conflictedAt"],
          "Post-plan conflict cannot predate materialization."
        );
      }
    }
  });

/**
 * Closed result of the single transaction that resolves or creates the exact
 * ExternalThread, external Conversation and account-local binding.
 */
export const inboxV2SourceConversationAtomicResolutionResultSchema =
  z.discriminatedUnion("outcome", [
    resolvedSourceConversationSchema,
    conflictedSourceConversationSchema
  ]);

export const inboxV2SourceConversationResolutionSourceProjectionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SOURCE_PROJECTION_SCHEMA_ID,
    INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SCHEMA_VERSION,
    inboxV2SourceConversationResolutionSourceProjectionSchema
  );

export const inboxV2SourceConversationMaterializationPlanEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_CONVERSATION_MATERIALIZATION_PLAN_SCHEMA_ID,
    INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SCHEMA_VERSION,
    inboxV2SourceConversationMaterializationPlanSchema
  );

export const inboxV2SourceConversationAtomicResolutionResultEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_CONVERSATION_ATOMIC_RESOLUTION_RESULT_SCHEMA_ID,
    INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SCHEMA_VERSION,
    inboxV2SourceConversationAtomicResolutionResultSchema
  );

export type InboxV2SourceConversationResolutionRequest = z.infer<
  typeof inboxV2SourceConversationResolutionRequestSchema
>;
export type InboxV2SourceConversationResolutionSourceProjection = z.infer<
  typeof inboxV2SourceConversationResolutionSourceProjectionSchema
>;
export type InboxV2SourceConversationTopology = z.infer<
  typeof inboxV2SourceConversationTopologySchema
>;
export type InboxV2SourceConversationInitialHistorySyncState = z.infer<
  typeof inboxV2SourceConversationInitialHistorySyncStateSchema
>;
export type InboxV2SourceConversationMaterializationPlan = z.infer<
  typeof inboxV2SourceConversationMaterializationPlanSchema
>;
export type InboxV2SourceConversationThreadResolution = z.infer<
  typeof inboxV2SourceConversationThreadResolutionSchema
>;
export type InboxV2SourceConversationBindingResolution = z.infer<
  typeof inboxV2SourceConversationBindingResolutionSchema
>;
export type InboxV2SourceConversationResolutionConflictCode = z.infer<
  typeof inboxV2SourceConversationResolutionConflictCodeSchema
>;
export type InboxV2SourceConversationAtomicResolutionResult = z.infer<
  typeof inboxV2SourceConversationAtomicResolutionResultSchema
>;

type ResolvedSourceConversation = z.infer<
  typeof resolvedSourceConversationSchema
>;

function addResolvedSourceConversationIssues(
  context: z.RefinementCtx,
  result: ResolvedSourceConversation
): void {
  const { plan, externalThreadMapping: mapping } = result;
  const projection = result.sourceThreadBinding;
  const binding = projection.binding;
  const episode = projection.currentRemoteAccessEpisode;
  const source = plan.source;

  if (
    result.threadResolution === "created" &&
    result.bindingResolution === "already_exists"
  ) {
    addIssue(
      context,
      ["bindingResolution"],
      "A newly created ExternalThread cannot already have an account-local binding."
    );
  }

  if (
    mapping.tenantId !== source.tenantId ||
    binding.tenantId !== source.tenantId
  ) {
    addIssue(
      context,
      ["externalThreadMapping", "tenantId"],
      "Atomic thread, Conversation and binding result must share the source tenant."
    );
  }
  if (
    mapping.conversation.topology !== plan.topology ||
    mapping.thread.conversationTopology !== plan.topology
  ) {
    addIssue(
      context,
      ["externalThreadMapping", "conversation", "topology"],
      "Canonical Conversation topology must match the trusted materialization plan."
    );
  }
  if (String(mapping.conversation.purposeId) !== String(plan.purposeId)) {
    addIssue(
      context,
      ["externalThreadMapping", "conversation", "purposeId"],
      "Canonical Conversation purpose must match the trusted materialization plan."
    );
  }
  if (
    !sameAdapterSurface(
      mapping.thread.identityDeclaration.adapterContract,
      source.adapterContract
    )
  ) {
    addIssue(
      context,
      ["externalThreadMapping", "thread", "identityDeclaration"],
      "Canonical ExternalThread must remain on the exact source adapter surface."
    );
  }

  if (result.threadResolution === "matched_alias") {
    const alias = result.matchedAlias;
    if (
      alias === null ||
      !sameExternalThreadKey(alias.aliasKey, source.thread.key) ||
      alias.tenantId !== source.tenantId ||
      String(alias.canonicalThread.id) !== String(mapping.thread.id) ||
      String(alias.canonicalConversation.id) !==
        String(mapping.conversation.id) ||
      !sameExternalThreadKey(alias.canonicalKeySnapshot, mapping.thread.key)
    ) {
      addIssue(
        context,
        ["matchedAlias"],
        "Alias resolution must directly map the exact requested key to the canonical thread and Conversation."
      );
    }
  } else {
    if (result.matchedAlias !== null) {
      addIssue(
        context,
        ["matchedAlias"],
        "Created and canonical matches cannot carry alias evidence."
      );
    }
    if (!sameExternalThreadKey(mapping.thread.key, source.thread.key)) {
      addIssue(
        context,
        ["externalThreadMapping", "thread", "key"],
        "Created/canonical match must retain the exact case-preserving source thread key."
      );
    }
  }

  if (result.threadResolution === "created") {
    if (
      String(mapping.thread.id) !== String(plan.candidateExternalThreadId) ||
      String(mapping.conversation.id) !==
        String(plan.candidateConversationId) ||
      !sameValue(
        mapping.thread.identityDeclaration,
        source.thread.identityDeclaration
      ) ||
      mapping.thread.createdAt !== plan.materializedAt ||
      mapping.thread.updatedAt !== plan.materializedAt ||
      mapping.conversation.createdAt !== plan.materializedAt ||
      mapping.conversation.updatedAt !== plan.materializedAt
    ) {
      addIssue(
        context,
        ["externalThreadMapping"],
        "Created mapping must use the exact candidate IDs, declaration and materialization boundary."
      );
    }
  }

  if (
    !sameReference(binding.externalThread, {
      tenantId: mapping.thread.tenantId,
      kind: "external_thread",
      id: mapping.thread.id
    }) ||
    !sameReference(binding.sourceConnection, source.sourceConnection) ||
    !sameReference(binding.sourceAccount, source.sourceAccount)
  ) {
    addIssue(
      context,
      ["sourceThreadBinding", "binding"],
      "Resolved binding must anchor the exact canonical thread, SourceConnection and SourceAccount."
    );
  }
  for (const [path, contract] of [
    [
      ["sourceThreadBinding", "binding", "routeDescriptor"],
      binding.routeDescriptor.adapterContract
    ],
    [
      ["sourceThreadBinding", "binding", "capabilities"],
      binding.capabilities.adapterContract
    ],
    [
      ["sourceThreadBinding", "binding", "accountIdentitySnapshot"],
      binding.accountIdentitySnapshot.declaration.adapterContract
    ]
  ] as const) {
    if (!sameAdapterSurface(contract, source.adapterContract)) {
      addIssue(
        context,
        [...path],
        "Resolved binding components must remain on the exact source adapter surface."
      );
    }
  }

  if (result.bindingResolution === "created") {
    const initialRevisions = [
      binding.bindingGeneration,
      binding.remoteAccess.revision,
      binding.administrative.revision,
      binding.runtimeHealth.revision,
      binding.historySync.revision,
      binding.providerAccess.revision,
      binding.capabilities.revision,
      binding.routeDescriptor.descriptorRevision,
      binding.revision,
      episode.revision
    ];
    const initialTimes = [
      binding.createdAt,
      binding.updatedAt,
      binding.remoteAccess.since,
      binding.administrative.changedAt,
      binding.runtimeHealth.checkedAt,
      binding.historySync.updatedAt,
      binding.providerAccess.observedAt,
      binding.capabilities.capturedAt,
      episode.startedAt,
      episode.createdAt,
      episode.updatedAt
    ];
    const hasUnsafeInitialRouteState =
      binding.remoteAccess.state !== "observed" ||
      binding.remoteAccess.evidenceAuthority !== "direct_observation" ||
      binding.administrative.state !== "disabled" ||
      binding.runtimeHealth.state !== "unknown" ||
      binding.runtimeHealth.diagnostic !== null ||
      binding.providerAccess.roleIds.length !== 0 ||
      episode.state !== "observed" ||
      episode.endedAt !== null ||
      episode.endEvidence.length !== 0;
    const inducingEvidence = [source.normalizedInboundEvent];
    const hasUnrelatedInitialEvidence =
      !sameValue(binding.remoteAccess.evidence, inducingEvidence) ||
      !sameValue(binding.providerAccess.evidence, inducingEvidence) ||
      !sameValue(episode.startEvidence, inducingEvidence);
    if (
      String(binding.id) !== String(plan.candidateSourceThreadBindingId) ||
      String(episode.id) !== String(plan.candidateRemoteAccessEpisodeId) ||
      !sameValue(binding.routeDescriptor, plan.routeDescriptor) ||
      !sameValue(
        binding.capabilities.adapterContract,
        source.adapterContract
      ) ||
      !sameValue(binding.capabilities.entries, plan.capabilityEntries) ||
      binding.historySync.state !== plan.historySyncState ||
      binding.historySync.receiveCursor !== null ||
      binding.historySync.historyCursor !== null ||
      binding.historySync.providerWatermark !== null ||
      binding.historySync.lastDurableRawEvent !== null ||
      binding.historySync.diagnostic !== null ||
      hasUnsafeInitialRouteState ||
      hasUnrelatedInitialEvidence ||
      initialRevisions.some((revision) => String(revision) !== "1") ||
      initialTimes.some((timestamp) => timestamp !== plan.materializedAt)
    ) {
      addIssue(
        context,
        ["sourceThreadBinding"],
        "Created binding must exactly materialize candidate IDs, route, capabilities, initial history state and revision-1 boundary."
      );
    }
  } else if (
    String(binding.routeDescriptor.descriptorRevision) === "1" &&
    !isSameInboxV2SourceConversationStableRouteDescriptor(
      binding.routeDescriptor,
      plan.routeDescriptor
    )
  ) {
    addIssue(
      context,
      ["sourceThreadBinding", "binding", "routeDescriptor"],
      "An unchanged revision-1 route must retain the exact destination selected by the trusted materialization plan."
    );
  }

  if (
    !isInboxV2TimestampOrderValid(plan.materializedAt, result.resolvedAt) ||
    !isInboxV2TimestampOrderValid(
      mapping.thread.createdAt,
      result.resolvedAt
    ) ||
    !isInboxV2TimestampOrderValid(binding.updatedAt, result.resolvedAt)
  ) {
    addIssue(
      context,
      ["resolvedAt"],
      "Atomic resolution cannot predate its plan or returned canonical projections."
    );
  }
}

/**
 * Stable routing identity used when replay returns an immutable existing
 * revision-1 binding. Adapter load metadata and the digest derived from that
 * snapshot may change across a compatible deployment; the actual destination,
 * descriptor contract and canonical attribute set may not.
 */
export function isSameInboxV2SourceConversationStableRouteDescriptor(
  left: InboxV2OpaqueAdapterRouteDescriptor,
  right: InboxV2OpaqueAdapterRouteDescriptor
): boolean {
  if (
    !sameAdapterSurface(left.adapterContract, right.adapterContract) ||
    String(left.descriptorSchemaId) !== String(right.descriptorSchemaId) ||
    left.descriptorVersion !== right.descriptorVersion ||
    String(left.descriptorRevision) !== String(right.descriptorRevision) ||
    String(left.destinationKindId) !== String(right.destinationKindId) ||
    left.destinationSubject !== right.destinationSubject ||
    left.attributes.length !== right.attributes.length
  ) {
    return false;
  }

  const rightAttributes = new Map(
    right.attributes.map((attribute) => [
      String(attribute.attributeId),
      attribute.value
    ])
  );
  return left.attributes.every(
    (attribute) =>
      rightAttributes.get(String(attribute.attributeId)) === attribute.value
  );
}

function addThreadScopeIssues(
  context: z.RefinementCtx,
  key: InboxV2ExternalThreadKey,
  sourceConnection: z.infer<typeof inboxV2SourceConnectionReferenceSchema>,
  sourceAccount: z.infer<typeof inboxV2SourceAccountReferenceSchema>,
  path: (string | number)[]
): void {
  if (
    key.scope.kind === "source_connection" &&
    !sameReference(key.scope.owner, sourceConnection)
  ) {
    addIssue(
      context,
      path,
      "Connection-scoped thread key must use the exact inducing SourceConnection."
    );
  }
  if (
    key.scope.kind === "source_account" &&
    !sameReference(key.scope.owner, sourceAccount)
  ) {
    addIssue(
      context,
      path,
      "Account-scoped thread key must use the exact inducing SourceAccount."
    );
  }
}

function requestMatchesSource(
  request: z.infer<typeof inboxV2SourceConversationResolutionRequestSchema>,
  source: z.infer<
    typeof inboxV2SourceConversationResolutionSourceProjectionSchema
  >
): boolean {
  return (
    request.tenantId === source.tenantId &&
    sameReference(request.rawInboundEvent, source.rawInboundEvent) &&
    sameReference(
      request.normalizedInboundEvent,
      source.normalizedInboundEvent
    ) &&
    sameReference(request.sourceConnection, source.sourceConnection) &&
    request.sourceAccount !== null &&
    sameReference(request.sourceAccount, source.sourceAccount)
  );
}

function sameExternalThreadKey(
  left: InboxV2ExternalThreadKey,
  right: InboxV2ExternalThreadKey
): boolean {
  return (
    JSON.stringify([
      left.realm.realmId,
      left.realm.realmVersion,
      left.realm.canonicalizationVersion,
      left.scope.kind,
      left.scope.kind === "provider" ? null : left.scope.owner.tenantId,
      left.scope.kind === "provider" ? null : left.scope.owner.id,
      left.objectKindId,
      left.canonicalExternalSubject
    ]) ===
    JSON.stringify([
      right.realm.realmId,
      right.realm.realmVersion,
      right.realm.canonicalizationVersion,
      right.scope.kind,
      right.scope.kind === "provider" ? null : right.scope.owner.tenantId,
      right.scope.kind === "provider" ? null : right.scope.owner.id,
      right.objectKindId,
      right.canonicalExternalSubject
    ])
  );
}

function sameAdapterSurface(
  left: InboxV2AdapterContractSnapshot,
  right: InboxV2AdapterContractSnapshot
): boolean {
  return (
    String(left.contractId) === String(right.contractId) &&
    left.contractVersion === right.contractVersion &&
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

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: Readonly<{ tenantId: string }>,
  path: (string | number)[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(
      context,
      path,
      "Referenced entity must belong to the same tenant."
    );
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
