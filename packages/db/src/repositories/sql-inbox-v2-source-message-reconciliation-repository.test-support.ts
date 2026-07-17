import {
  inboxV2DeferredMessageSourceActionCommitSchema,
  inboxV2DeferredMessageSourceActionSchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2SourceOccurrenceSchema,
  type InboxV2DeferredMessageSourceAction,
  type InboxV2DeferredSourceActionOrderingHead
} from "@hulee/contracts";

import {
  fixtureAdapterContract,
  fixtureBindingReference,
  fixtureExternalMessageReference,
  fixtureExternalThreadMapping,
  fixtureMessage,
  fixtureMessageReference,
  fixtureOccurrence,
  fixtureReference,
  fixtureSourceAccountReference,
  fixtureSourceIdentityReference,
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
    position?: string;
    fingerprint?: string;
    subject?: string;
  }> = {}
): InboxV2DeferredMessageSourceAction {
  const occurrenceId =
    input.occurrenceId ?? "source_occurrence:deferred-source-action-1";
  const occurrence = fixtureOccurrence({
    occurrenceId,
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
    actor: fixtureSourceIdentityReference,
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
