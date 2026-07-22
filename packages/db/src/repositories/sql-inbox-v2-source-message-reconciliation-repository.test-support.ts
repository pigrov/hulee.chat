import {
  inboxV2DeferredMessageSourceActionCommitSchema,
  inboxV2DeferredMessageSourceActionSchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2MessageReactionCommitSchema,
  inboxV2MessageTransportFactCommitSchema,
  inboxV2ReactionSemanticSlotKeyFor,
  inboxV2SourceOccurrenceSchema,
  type InboxV2DeferredMessageSourceAction,
  type InboxV2DeferredMessageSourceActionEffectProof,
  type InboxV2DeferredSourceActionOrderingHead,
  type InboxV2ExternalMessageReference,
  type InboxV2SourceOccurrence
} from "@hulee/contracts";

import {
  fixtureAdapterContract,
  fixtureBindingReference,
  fixtureExternalMessageReference,
  fixtureExternalThreadMapping,
  fixtureMessage,
  fixtureMessageReference,
  fixtureOccurrence,
  fixtureParticipant,
  fixtureReference,
  fixtureSourceAccountReference,
  fixtureT1,
  fixtureT2,
  fixtureT3,
  fixtureTenantId,
  fixtureTimelineItem
} from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";

type InboxV2DeferredMessageSourceActionCommit = ReturnType<
  typeof inboxV2DeferredMessageSourceActionCommitSchema.parse
>;

export type DeferredTestPayload =
  | Readonly<{
      kind: "edit";
      normalizedEvent: ReturnType<typeof fixtureReference>;
      normalizedContentDigestSha256: string;
    }>
  | Readonly<{
      kind: "delete";
      normalizedEvent: ReturnType<typeof fixtureReference>;
      reasonId: string;
    }>
  | Readonly<{
      kind: "reaction";
      operation: "set" | "replace" | "clear";
      value: Readonly<{ kind: "unicode"; value: string }> | null;
      normalizedEvent: ReturnType<typeof fixtureReference>;
    }>
  | Readonly<{
      kind: "delivery";
      fact: "accepted" | "sent" | "delivered" | "failed";
      normalizedEvent: ReturnType<typeof fixtureReference>;
    }>
  | Readonly<{
      kind: "receipt";
      fact: "read";
      scope: "exact_message";
      normalizedEvent: ReturnType<typeof fixtureReference>;
    }>;

export function deferredNormalizedEvent(id: string) {
  return fixtureReference(
    "normalized_inbound_event",
    `normalized_inbound_event:${id}`
  );
}

export function makePendingDeferredAction(
  payload: DeferredTestPayload,
  input: Readonly<{
    id?: string;
    occurrenceId?: string;
    occurrenceOrigin?: "webhook" | "history" | "provider_echo";
    occurrenceDirection?: "inbound" | "outbound";
    position?: string;
    fingerprint?: string;
    subject?: string;
  }> = {}
): InboxV2DeferredMessageSourceAction {
  const occurrenceId =
    input.occurrenceId ?? "source_occurrence:deferred-source-action-1";
  const occurrence = fixtureOccurrence({
    occurrenceId,
    origin: input.occurrenceOrigin,
    direction: input.occurrenceDirection,
    externalSubject: input.subject
  });
  if (occurrence.origin.kind === "provider_response") {
    throw new Error("Deferred action fixture requires an inbound event.");
  }
  const sourceOccurrence = {
    ...occurrence,
    origin: {
      ...occurrence.origin,
      normalizedInboundEvent: payload.normalizedEvent
    },
    resolution: {
      state: "pending" as const,
      diagnostic: {
        codeId: "core:source-reference-pending",
        retryable: true,
        correlationToken: "correlation:deferred-source-action",
        safeOperatorHintId: null
      }
    },
    revision: "1"
  };
  const semanticId = semanticIdFor(payload);
  const proof = {
    tenantId: fixtureTenantId,
    normalizedInboundEvent: payload.normalizedEvent,
    externalMessageReference: null,
    sourceOccurrence: null,
    sourceAccount: fixtureSourceAccountReference,
    sourceThreadBinding: fixtureBindingReference,
    bindingGeneration: "1",
    adapterContract: fixtureAdapterContract,
    capabilityId: `module:synthetic:${payload.kind}`,
    capabilityRevision: "1",
    semanticId,
    semanticRevision: "1",
    actor:
      sourceOccurrence.providerActor?.kind === "source_external_identity"
        ? sourceOccurrence.providerActor.sourceExternalIdentity
        : null,
    ordering: {
      kind: "monotonic_exact" as const,
      scopeToken: `scope:${payload.kind}:provider-message-42`,
      comparatorId: "module:synthetic:provider-sequence",
      comparatorRevision: "1",
      position: input.position ?? "10"
    },
    declaredByTrustedServiceId: "core:source-runtime",
    proofToken: `proof:${payload.kind}:provider-message-42`,
    occurredAt: fixtureT1,
    recordedAt: fixtureT2,
    revision: "1" as const
  };
  return inboxV2DeferredMessageSourceActionSchema.parse({
    tenantId: fixtureTenantId,
    id: input.id ?? "deferred_message_source_action:before-create-1",
    externalMessageKey: sourceOccurrence.messageKey,
    sourceOccurrence,
    action: payload,
    semanticProof: proof,
    idempotencyKey: {
      normalizedInboundEvent: payload.normalizedEvent,
      sourceOccurrence: fixtureReference("source_occurrence", occurrenceId),
      semanticId,
      eventFingerprintSha256: input.fingerprint ?? "a".repeat(64)
    },
    state: { state: "pending" },
    revision: "1",
    observedAt: fixtureT1,
    recordedAt: fixtureT2,
    createdAt: fixtureT2,
    updatedAt: fixtureT2
  });
}

export function makeDeferredOrderingHead(
  action: InboxV2DeferredMessageSourceAction,
  input: Readonly<{
    actionId?: string;
    position?: string;
    revision?: string;
    createdAt?: string;
    updatedAt?: string;
  }> = {}
): InboxV2DeferredSourceActionOrderingHead {
  if (action.semanticProof.ordering.kind !== "monotonic_exact") {
    throw new Error("Ordering head fixture requires monotonic exact proof.");
  }
  const ordering = action.semanticProof.ordering;
  return {
    tenantId: action.tenantId,
    externalMessageKey: action.externalMessageKey,
    lane: laneFor(action.action.kind),
    scopeToken: ordering.scopeToken,
    comparatorId: ordering.comparatorId,
    comparatorRevision: ordering.comparatorRevision,
    latest: {
      action: {
        tenantId: action.tenantId,
        kind: "deferred_message_source_action",
        id: input.actionId ?? action.id
      },
      idempotencyKey: action.idempotencyKey,
      position: input.position ?? ordering.position
    },
    revision: input.revision ?? "1",
    createdAt: input.createdAt ?? fixtureT2,
    updatedAt: input.updatedAt ?? fixtureT2
  } as InboxV2DeferredSourceActionOrderingHead;
}

export function makeTerminalDeferredCommit(
  before: InboxV2DeferredMessageSourceAction,
  state: Exclude<
    InboxV2DeferredMessageSourceAction["state"],
    { state: "pending" }
  >,
  input: Readonly<{
    outcome?: "stale" | "duplicate" | "conflict" | "not_evaluated";
    beforeHead?: InboxV2DeferredSourceActionOrderingHead | null;
    afterHead?: InboxV2DeferredSourceActionOrderingHead | null;
  }> = {}
): InboxV2DeferredMessageSourceActionCommit {
  const beforeHead = input.beforeHead ?? null;
  const afterHead = input.afterHead ?? beforeHead;
  return inboxV2DeferredMessageSourceActionCommitSchema.parse({
    tenantId: before.tenantId,
    before,
    transition: {
      action: {
        tenantId: before.tenantId,
        kind: "deferred_message_source_action",
        id: before.id
      },
      expectedRevision: "1",
      resultingRevision: "2",
      afterState: state,
      orderingOutcome: input.outcome ?? "not_evaluated",
      expectedOrderingHeadRevision: beforeHead?.revision ?? null,
      resultingOrderingHeadRevision: afterHead?.revision ?? null,
      recordedAt: fixtureT3
    },
    targetExternalMessageReference: null,
    sourceOccurrenceResolution: null,
    effectProof: null,
    beforeOrderingHead: beforeHead,
    afterOrderingHead: afterHead,
    after: {
      ...before,
      state,
      revision: "2",
      updatedAt: fixtureT3
    }
  });
}

export function makeAppliedReceiptCommit(
  before: InboxV2DeferredMessageSourceAction,
  beforeHead: InboxV2DeferredSourceActionOrderingHead | null = null
): InboxV2DeferredMessageSourceActionCommit {
  if (before.action.kind !== "receipt") {
    throw new Error("Applied receipt fixture requires a receipt action.");
  }
  const preliminaryTarget = externalReferenceFor(before.sourceOccurrence);
  const resolution = occurrenceResolution(before, preliminaryTarget);
  const target = externalReferenceFor(resolution.after);
  const exactResolution = { ...resolution, resolvedReference: target };
  const appliedState = {
    state: "applied" as const,
    externalMessageReference: targetReference(
      before.tenantId,
      "external_message_reference",
      target.id
    ),
    message: targetReference(before.tenantId, "message", target.message.id),
    appliedMessageRevision: "1",
    effectKind: "message_transport_fact" as const,
    appliedAt: fixtureT3
  };
  const afterHead = makeDeferredOrderingHead(before, {
    actionId: before.id,
    revision: beforeHead === null ? "1" : "2",
    createdAt: beforeHead?.createdAt ?? fixtureT3,
    updatedAt: fixtureT3
  });
  return inboxV2DeferredMessageSourceActionCommitSchema.parse({
    tenantId: before.tenantId,
    before,
    transition: {
      action: targetReference(
        before.tenantId,
        "deferred_message_source_action",
        before.id
      ),
      expectedRevision: "1",
      resultingRevision: "2",
      afterState: appliedState,
      orderingOutcome: "advance",
      expectedOrderingHeadRevision: beforeHead?.revision ?? null,
      resultingOrderingHeadRevision: afterHead.revision,
      recordedAt: fixtureT3
    },
    targetExternalMessageReference: target,
    sourceOccurrenceResolution: exactResolution,
    effectProof: receiptEffect(before, target, resolution.after),
    beforeOrderingHead: beforeHead,
    afterOrderingHead: afterHead,
    after: {
      ...before,
      state: appliedState,
      revision: "2",
      updatedAt: fixtureT3
    }
  });
}

export function scopeDeferredFixture<T>(value: T, suffix: string): T {
  const idPrefixes = [
    "conversation:",
    "deferred_message_source_action:",
    "event:",
    "external_message_reference:",
    "external_thread:",
    "message:",
    "normalized_inbound_event:",
    "outbound_route:",
    "provider_receipt_observation:",
    "raw_inbound_event:",
    "source_account:",
    "source_connection:",
    "source_external_identity:",
    "source_occurrence:",
    "source_thread_binding:",
    "timeline_item:"
  ];
  const visit = (candidate: unknown): unknown => {
    if (typeof candidate === "string") {
      if (candidate === fixtureTenantId) return `tenant:src006-${suffix}`;
      return idPrefixes.some((prefix) => candidate.startsWith(prefix))
        ? `${candidate}-${suffix}`
        : candidate;
    }
    if (Array.isArray(candidate)) return candidate.map(visit);
    if (candidate !== null && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate).map(([key, child]) => [key, visit(child)])
      );
    }
    return candidate;
  };
  return visit(value) as T;
}

function semanticIdFor(payload: DeferredTestPayload): string {
  switch (payload.kind) {
    case "edit":
      return "core:message.lifecycle.edit.observed";
    case "delete":
      return "core:message.lifecycle.delete.observed";
    case "reaction":
      return `core:message.reaction.${payload.operation}`;
    case "delivery":
      return `core:message.delivery.${payload.fact}`;
    case "receipt":
      return "core:message.receipt.read";
  }
}

function laneFor(kind: InboxV2DeferredMessageSourceAction["action"]["kind"]) {
  return kind === "edit" || kind === "delete" ? "message_lifecycle" : kind;
}

function occurrenceResolution(
  action: InboxV2DeferredMessageSourceAction,
  target: ReturnType<typeof externalReferenceFor>
) {
  const after = inboxV2SourceOccurrenceSchema.parse({
    ...action.sourceOccurrence,
    resolution: {
      state: "resolved" as const,
      externalMessageReference: targetReference(
        action.tenantId,
        "external_message_reference",
        target.id
      )
    },
    revision: "2"
  });
  return {
    tenantId: action.tenantId,
    expectedRevision: "1",
    resultingRevision: "2",
    changedAt: fixtureT2,
    resolver: {
      kind: "trusted_service" as const,
      trustedServiceId: "core:source-runtime",
      resolutionToken: `resolution:deferred-source-action:${action.id}`
    },
    before: action.sourceOccurrence,
    after,
    resolvedReference: target
  };
}

function receiptEffect(
  action: InboxV2DeferredMessageSourceAction,
  target: ReturnType<typeof externalReferenceFor>,
  resolvedOccurrence: InboxV2DeferredMessageSourceAction["sourceOccurrence"]
) {
  if (action.action.kind !== "receipt") {
    throw new Error("Receipt effect requires a receipt action.");
  }
  const semanticProof = {
    ...action.semanticProof,
    externalMessageReference: targetReference(
      action.tenantId,
      "external_message_reference",
      target.id
    ),
    sourceOccurrence: targetReference(
      action.tenantId,
      "source_occurrence",
      resolvedOccurrence.id
    ),
    occurredAt: fixtureT1,
    recordedAt: fixtureT3
  };
  const observation = {
    tenantId: action.tenantId,
    id: "provider_receipt_observation:deferred-read-1",
    fact: "read" as const,
    target: {
      kind: "exact_message" as const,
      message: target.message,
      externalMessageReference: targetReference(
        action.tenantId,
        "external_message_reference",
        target.id
      ),
      sourceOccurrence: targetReference(
        action.tenantId,
        "source_occurrence",
        resolvedOccurrence.id
      )
    },
    reader:
      resolvedOccurrence.providerActor?.kind === "source_external_identity"
        ? {
            kind: "source_external_identity" as const,
            sourceExternalIdentity:
              resolvedOccurrence.providerActor.sourceExternalIdentity
          }
        : {
            kind: "aggregate_only" as const,
            aggregateKey: "provider-read-aggregate"
          },
    sourceAccount: action.semanticProof.sourceAccount,
    sourceThreadBinding: action.semanticProof.sourceThreadBinding,
    bindingGeneration: action.semanticProof.bindingGeneration,
    adapterContract: action.semanticProof.adapterContract,
    capabilityId: "module:synthetic:receipt",
    capabilityRevision: "1",
    evidenceEvent: action.action.normalizedEvent,
    semanticProof,
    evidenceKindId: "module:synthetic:provider-event",
    evidenceDigestSha256: "e".repeat(64),
    observedAt: fixtureT1,
    recordedAt: fixtureT3,
    revision: "1" as const
  };
  return {
    kind: "message_transport_fact" as const,
    commit: {
      tenantId: action.tenantId,
      beforeMessage: fixtureMessage("hulee"),
      beforeTimelineItem: fixtureTimelineItem("external"),
      fact: { kind: "receipt" as const, observation },
      transportEvidence: {
        kind: "external_reference" as const,
        externalMessageReference: target,
        sourceOccurrence: resolvedOccurrence,
        externalThreadMapping: fixtureExternalThreadMapping()
      },
      commitToken: "transport:deferred-read-1",
      committedAt: fixtureT3
    }
  };
}

function externalReferenceFor(
  occurrence: InboxV2DeferredMessageSourceAction["sourceOccurrence"]
) {
  return inboxV2ExternalMessageReferenceSchema.parse({
    tenantId: occurrence.tenantId,
    id: fixtureExternalMessageReference.id,
    key: occurrence.messageKey,
    identityDeclaration: occurrence.messageIdentityDeclaration,
    externalThread: occurrence.messageKey.externalThread,
    timelineItem: targetReference(
      occurrence.tenantId,
      "timeline_item",
      fixtureTimelineItem("external").id
    ),
    message: fixtureMessageReference,
    revision: "1",
    createdAt: occurrence.recordedAt
  });
}

function targetReference<const TKind extends string>(
  tenantId: string,
  kind: TKind,
  id: string
) {
  return { tenantId, kind, id };
}

export function makeDeferredMessageEffectTarget(
  action: InboxV2DeferredMessageSourceAction
): InboxV2ExternalMessageReference {
  return externalReferenceFor(action.sourceOccurrence);
}

export function makeProviderObservedMessageEffectProof(
  action: InboxV2DeferredMessageSourceAction,
  target: InboxV2ExternalMessageReference,
  resolvedOccurrence: InboxV2SourceOccurrence,
  input: Readonly<{
    recordedAt?: string;
    previousReaction?: Extract<
      InboxV2DeferredMessageSourceActionEffectProof,
      { kind: "message_reaction" }
    > | null;
  }> = {}
): InboxV2DeferredMessageSourceActionEffectProof {
  const recordedAt = input.recordedAt ?? fixtureT3;
  if (action.action.kind === "reaction") {
    return providerObservedReactionEffect(
      action as InboxV2DeferredMessageSourceAction & {
        action: Extract<
          InboxV2DeferredMessageSourceAction["action"],
          { kind: "reaction" }
        >;
      },
      target,
      resolvedOccurrence,
      input.previousReaction ?? null,
      recordedAt
    );
  }
  if (action.action.kind === "delivery") {
    return providerObservedDeliveryEffect(
      action as InboxV2DeferredMessageSourceAction & {
        action: Extract<
          InboxV2DeferredMessageSourceAction["action"],
          { kind: "delivery" }
        >;
      },
      target,
      resolvedOccurrence,
      recordedAt
    );
  }
  if (action.action.kind === "receipt") {
    return providerObservedReceiptEffect(
      action as InboxV2DeferredMessageSourceAction & {
        action: Extract<
          InboxV2DeferredMessageSourceAction["action"],
          { kind: "receipt" }
        >;
      },
      target,
      resolvedOccurrence,
      recordedAt
    );
  }
  throw new Error(
    "Message-effect proof fixture requires reaction/delivery/receipt."
  );
}

function providerObservedReactionEffect(
  action: InboxV2DeferredMessageSourceAction & {
    action: Extract<
      InboxV2DeferredMessageSourceAction["action"],
      { kind: "reaction" }
    >;
  },
  target: InboxV2ExternalMessageReference,
  resolvedOccurrence: InboxV2SourceOccurrence,
  previousEffect: Extract<
    InboxV2DeferredMessageSourceActionEffectProof,
    { kind: "message_reaction" }
  > | null,
  recordedAt: string
): Extract<
  InboxV2DeferredMessageSourceActionEffectProof,
  { kind: "message_reaction" }
> {
  const providerActor = resolvedOccurrence.providerActor;
  if (providerActor?.kind !== "source_external_identity") {
    throw new Error(
      "Provider reaction fixture requires an exact external actor."
    );
  }
  const previous = previousEffect?.commit ?? null;
  if (
    (action.action.operation === "set") !== (previous === null) ||
    (previous !== null && previous.afterReaction.state.kind !== "active")
  ) {
    throw new Error(
      "Provider reaction fixture requires set then active replace/clear."
    );
  }
  const suffix = fixtureIdSuffix(action.id);
  const participant = fixtureParticipant("source");
  const participantReference = targetReference(
    action.tenantId,
    "conversation_participant",
    participant.id
  );
  const occurrenceReference = targetReference(
    action.tenantId,
    "source_occurrence",
    resolvedOccurrence.id
  );
  const externalReference = targetReference(
    action.tenantId,
    "external_message_reference",
    target.id
  );
  const capability = {
    kind: "external" as const,
    capabilityId: action.semanticProof.capabilityId,
    capabilityRevision: action.semanticProof.capabilityRevision,
    cardinality: "single_value" as const,
    adapterContract: resolvedOccurrence.descriptor.adapterContract
  };
  const beforeReaction = previous?.afterReaction ?? null;
  const state =
    action.action.operation === "clear"
      ? {
          kind: "cleared" as const,
          lastValue:
            beforeReaction?.state.kind === "active"
              ? beforeReaction.state.value
              : { kind: "unicode" as const, value: "?" },
          clearedAt: recordedAt
        }
      : {
          kind: "active" as const,
          value: action.action.value as NonNullable<typeof action.action.value>
        };
  const semanticSlotKey =
    beforeReaction?.semanticSlotKey ??
    inboxV2ReactionSemanticSlotKeyFor({
      message: target.message,
      actor: { kind: "participant", participant: participantReference },
      capability,
      state
    });
  const reactionId =
    beforeReaction?.id ?? `message_reaction:source-effect-${suffix}`;
  const resultingRevision =
    beforeReaction === null
      ? "1"
      : (BigInt(beforeReaction.revision) + 1n).toString();
  const afterReaction = {
    tenantId: action.tenantId,
    id: reactionId,
    message: target.message,
    actor: { kind: "participant" as const, participant: participantReference },
    capability,
    semanticSlotKey,
    state,
    revision: resultingRevision,
    createdAt: beforeReaction?.createdAt ?? recordedAt,
    updatedAt: recordedAt
  };
  const authority = {
    externalMessageReference: externalReference,
    sourceOccurrence: occurrenceReference,
    sourceAccount: resolvedOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: resolvedOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: resolvedOccurrence.bindingContext.bindingGeneration,
    outboundRoute: null,
    adapterContract: resolvedOccurrence.descriptor.adapterContract,
    capabilityFence: {
      capabilityId: capability.capabilityId,
      capabilityRevision: capability.capabilityRevision,
      adapterContract: capability.adapterContract,
      decision: "supported" as const,
      evaluatedAt: resolvedOccurrence.observedAt,
      notAfter: recordedAt
    }
  };
  const semanticProof = {
    ...action.semanticProof,
    externalMessageReference: externalReference,
    sourceOccurrence: occurrenceReference,
    sourceAccount: resolvedOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: resolvedOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: resolvedOccurrence.bindingContext.bindingGeneration,
    adapterContract: resolvedOccurrence.descriptor.adapterContract,
    actor: providerActor.sourceExternalIdentity,
    proofToken: `proof:source-effect-${suffix}`,
    occurredAt: action.observedAt,
    recordedAt
  };
  if (semanticProof.ordering.kind !== "monotonic_exact") {
    throw new Error(
      "Provider reaction fixture requires monotonic exact ordering."
    );
  }
  const orderingBefore =
    previous?.providerObservation?.orderingCommit.after ?? null;
  const orderingRevision =
    orderingBefore === null
      ? "1"
      : (BigInt(orderingBefore.revision) + 1n).toString();
  const orderingAfter = {
    tenantId: action.tenantId,
    semanticFamilyId: "core:message.reaction" as const,
    externalMessageReference: externalReference,
    sourceAccount: semanticProof.sourceAccount,
    sourceThreadBinding: semanticProof.sourceThreadBinding,
    bindingGeneration: semanticProof.bindingGeneration,
    scopeToken: semanticProof.ordering.scopeToken,
    comparatorId: semanticProof.ordering.comparatorId,
    comparatorRevision: semanticProof.ordering.comparatorRevision,
    position: semanticProof.ordering.position,
    normalizedInboundEvent: semanticProof.normalizedInboundEvent,
    proofToken: semanticProof.proofToken,
    revision: orderingRevision,
    updatedAt: recordedAt
  };
  const reactionReference = targetReference(
    action.tenantId,
    "message_reaction",
    reactionId
  );
  const slotHeadBefore = previous?.slotHeadAfter ?? null;
  const commit = inboxV2MessageReactionCommitSchema.parse({
    tenantId: action.tenantId,
    beforeMessage: fixtureMessage("source"),
    beforeTimelineItem: fixtureTimelineItem("external"),
    beforeReaction,
    transition: {
      tenantId: action.tenantId,
      id: `message_reaction_transition:source-effect-${suffix}`,
      reaction: reactionReference,
      semanticSlotKey,
      mode: "provider_observed",
      operation: action.action.operation,
      expectedRevision: beforeReaction?.revision ?? null,
      resultingRevision,
      beforeState: beforeReaction?.state ?? null,
      afterState: state,
      actionAttribution: {
        actionParticipant: participantReference,
        appActor: null,
        sourceOccurrence: occurrenceReference,
        automationCausation: null
      },
      externalAuthority: authority,
      occurredAt: action.observedAt,
      recordedAt,
      recordRevision: "1"
    },
    afterReaction,
    participantSnapshots: [participant],
    externalAuthorityEvidence: {
      externalMessageReference: target,
      sourceOccurrence: resolvedOccurrence,
      outboundRoute: null
    },
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: {
      semanticProof,
      orderingCommit: {
        tenantId: action.tenantId,
        semanticFamilyId: "core:message.reaction",
        before: orderingBefore,
        proof: semanticProof,
        after: orderingAfter,
        committedAt: recordedAt
      },
      normalizedState: state,
      providerActorParticipant: participantReference
    },
    providerResultProof: null,
    slotHeadBefore,
    slotHeadAfter: {
      tenantId: action.tenantId,
      message: target.message,
      semanticSlotKey,
      reaction: reactionReference,
      state,
      revision:
        slotHeadBefore === null
          ? "1"
          : (BigInt(slotHeadBefore.revision) + 1n).toString(),
      updatedAt: recordedAt
    }
  });
  return { kind: "message_reaction", commit };
}

function providerObservedDeliveryEffect(
  action: InboxV2DeferredMessageSourceAction & {
    action: Extract<
      InboxV2DeferredMessageSourceAction["action"],
      { kind: "delivery" }
    >;
  },
  target: InboxV2ExternalMessageReference,
  resolvedOccurrence: InboxV2SourceOccurrence,
  recordedAt: string
): Extract<
  InboxV2DeferredMessageSourceActionEffectProof,
  { kind: "message_transport_fact" }
> {
  const suffix = fixtureIdSuffix(action.id);
  const externalReference = targetReference(
    action.tenantId,
    "external_message_reference",
    target.id
  );
  const occurrenceReference = targetReference(
    action.tenantId,
    "source_occurrence",
    resolvedOccurrence.id
  );
  const semanticProof = {
    ...action.semanticProof,
    externalMessageReference: externalReference,
    sourceOccurrence: occurrenceReference,
    sourceAccount: resolvedOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: resolvedOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: resolvedOccurrence.bindingContext.bindingGeneration,
    adapterContract: resolvedOccurrence.descriptor.adapterContract,
    actor: null,
    proofToken: `proof:source-effect-${suffix}`,
    occurredAt: action.observedAt,
    recordedAt
  };
  const observation = {
    tenantId: action.tenantId,
    id: `message_delivery_observation:source-effect-${suffix}`,
    message: target.message,
    fact: action.action.fact,
    scope: {
      kind: "external_reference" as const,
      externalMessageReference: externalReference,
      sourceOccurrence: occurrenceReference
    },
    sourceAccount: resolvedOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: resolvedOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: resolvedOccurrence.bindingContext.bindingGeneration,
    adapterContract: resolvedOccurrence.descriptor.adapterContract,
    capabilityId: action.semanticProof.capabilityId,
    capabilityRevision: action.semanticProof.capabilityRevision,
    evidence: {
      kind: "provider_event" as const,
      normalizedInboundEvent: action.action.normalizedEvent,
      externalMessageReference: externalReference,
      sourceOccurrence: occurrenceReference
    },
    semanticProof,
    evidenceKindId: "module:synthetic:provider-event",
    evidenceDigestSha256: "d".repeat(64),
    failureReasonId:
      action.action.fact === "failed"
        ? "module:synthetic:delivery-failed"
        : null,
    observedAt: action.observedAt,
    recordedAt,
    revision: "1" as const
  };
  const commit = inboxV2MessageTransportFactCommitSchema.parse({
    tenantId: action.tenantId,
    beforeMessage: fixtureMessage("hulee"),
    beforeTimelineItem: fixtureTimelineItem("external"),
    fact: { kind: "delivery", observation },
    transportEvidence: {
      kind: "external_reference",
      externalMessageReference: target,
      sourceOccurrence: resolvedOccurrence,
      externalThreadMapping: fixtureExternalThreadMapping()
    },
    commitToken: `transport:source-effect-${suffix}`,
    committedAt: recordedAt
  });
  return { kind: "message_transport_fact", commit };
}

function providerObservedReceiptEffect(
  action: InboxV2DeferredMessageSourceAction & {
    action: Extract<
      InboxV2DeferredMessageSourceAction["action"],
      { kind: "receipt" }
    >;
  },
  target: InboxV2ExternalMessageReference,
  resolvedOccurrence: InboxV2SourceOccurrence,
  recordedAt: string
): Extract<
  InboxV2DeferredMessageSourceActionEffectProof,
  { kind: "message_transport_fact" }
> {
  const suffix = fixtureIdSuffix(action.id);
  const externalReference = targetReference(
    action.tenantId,
    "external_message_reference",
    target.id
  );
  const occurrenceReference = targetReference(
    action.tenantId,
    "source_occurrence",
    resolvedOccurrence.id
  );
  const providerActor = resolvedOccurrence.providerActor;
  const reader =
    providerActor?.kind === "source_external_identity"
      ? providerActor
      : {
          kind: "aggregate_only" as const,
          aggregateKey: `provider-read-${suffix}`
        };
  const semanticProof = {
    ...action.semanticProof,
    externalMessageReference: externalReference,
    sourceOccurrence: occurrenceReference,
    sourceAccount: resolvedOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: resolvedOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: resolvedOccurrence.bindingContext.bindingGeneration,
    adapterContract: resolvedOccurrence.descriptor.adapterContract,
    actor:
      reader.kind === "source_external_identity"
        ? reader.sourceExternalIdentity
        : null,
    proofToken: `proof:source-effect-${suffix}`,
    occurredAt: action.observedAt,
    recordedAt
  };
  const observation = {
    tenantId: action.tenantId,
    id: `provider_receipt_observation:source-effect-${suffix}`,
    fact: "read" as const,
    target: {
      kind: "exact_message" as const,
      message: target.message,
      externalMessageReference: externalReference,
      sourceOccurrence: occurrenceReference
    },
    reader,
    sourceAccount: resolvedOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: resolvedOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: resolvedOccurrence.bindingContext.bindingGeneration,
    adapterContract: resolvedOccurrence.descriptor.adapterContract,
    capabilityId: action.semanticProof.capabilityId,
    capabilityRevision: action.semanticProof.capabilityRevision,
    evidenceEvent: action.action.normalizedEvent,
    semanticProof,
    evidenceKindId: "module:synthetic:provider-event",
    evidenceDigestSha256: "e".repeat(64),
    observedAt: action.observedAt,
    recordedAt,
    revision: "1" as const
  };
  const commit = inboxV2MessageTransportFactCommitSchema.parse({
    tenantId: action.tenantId,
    beforeMessage: fixtureMessage("hulee"),
    beforeTimelineItem: fixtureTimelineItem("external"),
    fact: { kind: "receipt", observation },
    transportEvidence: {
      kind: "external_reference",
      externalMessageReference: target,
      sourceOccurrence: resolvedOccurrence,
      externalThreadMapping: fixtureExternalThreadMapping()
    },
    commitToken: `transport:source-effect-${suffix}`,
    committedAt: recordedAt
  });
  return { kind: "message_transport_fact", commit };
}

function fixtureIdSuffix(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "-").slice(-120);
}
