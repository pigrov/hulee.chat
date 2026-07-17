import { describe, expect, it } from "vitest";

import {
  inboxV2DeferredMessageSourceActionCommitSchema,
  inboxV2DeferredMessageSourceActionSchema,
  inboxV2DeferredSourceActionOrderingHeadSchema
} from "./message-source-action";
import {
  fixtureAdapterContract,
  fixtureBindingReference,
  fixtureExternalMessageReference,
  fixtureExternalReference,
  fixtureExternalThreadMapping,
  fixtureMessage,
  fixtureMessageKey,
  fixtureMessageReference,
  fixtureOccurrence,
  fixtureProviderSemanticOrderingCommit,
  fixtureProviderSemanticProof,
  fixtureReference,
  fixtureSourceAccountReference,
  fixtureSourceIdentityReference,
  fixtureT1,
  fixtureT2,
  fixtureT3,
  fixtureT4,
  fixtureTenantId,
  fixtureTimelineItem
} from "./timeline-message-fixtures.type-fixture";

type NormalizedEventReference = {
  tenantId: string;
  kind: "normalized_inbound_event";
  id: string;
};

type DeferredPayload =
  | {
      kind: "edit";
      normalizedEvent: NormalizedEventReference;
      normalizedContentDigestSha256: string;
    }
  | {
      kind: "delete";
      normalizedEvent: NormalizedEventReference;
      reasonId: string;
    }
  | {
      kind: "reaction";
      operation: "set" | "replace" | "clear";
      value: { kind: "unicode"; value: string } | null;
      normalizedEvent: NormalizedEventReference;
    }
  | {
      kind: "delivery";
      fact: "accepted" | "sent" | "delivered" | "failed";
      normalizedEvent: NormalizedEventReference;
    }
  | {
      kind: "receipt";
      fact: "read";
      scope: "exact_message";
      normalizedEvent: NormalizedEventReference;
    };

function normalizedEvent(id: string) {
  return fixtureReference(
    "normalized_inbound_event",
    `normalized_inbound_event:${id}`
  );
}

function semanticIdFor(payload: DeferredPayload): string {
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

function orderingLaneFor(payload: DeferredPayload) {
  return payload.kind === "edit" || payload.kind === "delete"
    ? ("message_lifecycle" as const)
    : payload.kind;
}

function pendingAction(
  payload: DeferredPayload,
  input: {
    id?: string;
    occurrenceId?: string;
    position?: string;
    fingerprint?: string;
  } = {}
) {
  const occurrenceId =
    input.occurrenceId ?? "source_occurrence:deferred-source-action-1";
  const resolvedOccurrence = fixtureOccurrence({ occurrenceId });
  if (resolvedOccurrence.origin.kind === "provider_response") {
    throw new Error("fixture must expose a normalized inbound event");
  }
  const sourceOccurrence = {
    ...resolvedOccurrence,
    origin: {
      ...resolvedOccurrence.origin,
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
  const fingerprint = input.fingerprint ?? "a".repeat(64);
  return {
    tenantId: fixtureTenantId,
    id: input.id ?? "deferred_message_source_action:before-create-1",
    externalMessageKey: fixtureMessageKey(),
    sourceOccurrence,
    action: payload,
    semanticProof: {
      ...fixtureProviderSemanticProof({
        semanticId,
        capabilityId: `module:synthetic:${payload.kind}`,
        normalizedInboundEvent: payload.normalizedEvent,
        externalMessageReference: null,
        sourceOccurrence: null,
        actor: fixtureSourceIdentityReference,
        occurredAt: fixtureT1,
        recordedAt: fixtureT2
      }),
      ordering: {
        kind: "monotonic_exact" as const,
        scopeToken: `scope:${payload.kind}:provider-message-42`,
        comparatorId: "module:synthetic:provider-sequence",
        comparatorRevision: "1",
        position: input.position ?? "10"
      }
    },
    idempotencyKey: {
      normalizedInboundEvent: payload.normalizedEvent,
      sourceOccurrence: fixtureReference("source_occurrence", occurrenceId),
      semanticId,
      eventFingerprintSha256: fingerprint
    },
    state: { state: "pending" as const },
    revision: "1",
    observedAt: fixtureT1,
    recordedAt: fixtureT2,
    createdAt: fixtureT2,
    updatedAt: fixtureT2
  };
}

function orderingHead(
  action: ReturnType<typeof pendingAction>,
  input: { actionId?: string; position?: string; revision?: string } = {}
) {
  if (action.semanticProof.ordering.kind !== "monotonic_exact") {
    throw new Error("ordering head fixture requires a monotonic exact proof");
  }
  const ordering = action.semanticProof.ordering;
  return {
    tenantId: fixtureTenantId,
    externalMessageKey: action.externalMessageKey,
    lane: orderingLaneFor(action.action),
    scopeToken: ordering.scopeToken,
    comparatorId: ordering.comparatorId,
    comparatorRevision: ordering.comparatorRevision,
    latest: {
      action: fixtureReference(
        "deferred_message_source_action",
        input.actionId ?? "deferred_message_source_action:canonical-1"
      ),
      idempotencyKey: action.idempotencyKey,
      position: input.position ?? ordering.position
    },
    revision: input.revision ?? "1",
    createdAt: fixtureT2,
    updatedAt: fixtureT2
  };
}

function terminalCommit(
  before: ReturnType<typeof pendingAction>,
  state: Record<string, unknown>,
  input: {
    outcome?: "stale" | "duplicate" | "conflict" | "not_evaluated";
    beforeHead?: ReturnType<typeof orderingHead> | null;
    afterHead?: ReturnType<typeof orderingHead> | null;
  } = {}
) {
  const beforeHead = input.beforeHead ?? null;
  const afterHead = input.afterHead ?? beforeHead;
  return {
    tenantId: fixtureTenantId,
    before,
    transition: {
      action: fixtureReference("deferred_message_source_action", before.id),
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
  };
}

function occurrenceResolution(
  action: ReturnType<typeof pendingAction>,
  target: ReturnType<typeof fixtureExternalReference>
) {
  const after = {
    ...action.sourceOccurrence,
    resolution: {
      state: "resolved" as const,
      externalMessageReference: fixtureExternalMessageReference
    },
    revision: "2"
  };
  return {
    tenantId: fixtureTenantId,
    expectedRevision: "1",
    resultingRevision: "2",
    changedAt: fixtureT2,
    resolver: {
      kind: "trusted_service" as const,
      trustedServiceId: "core:source-runtime",
      resolutionToken: "resolution:deferred-source-action"
    },
    before: action.sourceOccurrence,
    after,
    resolvedReference: target
  };
}

function receiptEffect(
  action: ReturnType<typeof pendingAction>,
  target: ReturnType<typeof fixtureExternalReference>,
  resolvedOccurrence: ReturnType<typeof occurrenceResolution>["after"]
) {
  const beforeMessage = fixtureMessage("hulee");
  const semanticProof = fixtureProviderSemanticProof({
    semanticId: "core:message.receipt.read",
    capabilityId: "module:synthetic:receipt",
    normalizedInboundEvent: action.action.normalizedEvent,
    externalMessageReference: fixtureExternalMessageReference,
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      resolvedOccurrence.id
    ),
    actor: fixtureSourceIdentityReference,
    occurredAt: fixtureT1,
    recordedAt: fixtureT3
  });
  const observation = {
    tenantId: fixtureTenantId,
    id: "provider_receipt_observation:deferred-read-1",
    fact: "read" as const,
    target: {
      kind: "exact_message" as const,
      message: fixtureMessageReference,
      externalMessageReference: fixtureExternalMessageReference,
      sourceOccurrence: fixtureReference(
        "source_occurrence",
        resolvedOccurrence.id
      )
    },
    reader: {
      kind: "source_external_identity" as const,
      sourceExternalIdentity: fixtureSourceIdentityReference
    },
    sourceAccount: fixtureSourceAccountReference,
    sourceThreadBinding: fixtureBindingReference,
    bindingGeneration: "1",
    adapterContract: fixtureAdapterContract,
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
      tenantId: fixtureTenantId,
      beforeMessage,
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

function retainedDeleteEffect(
  action: ReturnType<typeof pendingAction>,
  target: ReturnType<typeof fixtureExternalReference>,
  resolvedOccurrence: ReturnType<typeof occurrenceResolution>["after"]
) {
  if (action.action.kind !== "delete") {
    throw new Error("retained delete fixture requires a delete action");
  }
  const semanticProof = fixtureProviderSemanticProof({
    semanticId: "core:message.lifecycle.delete.observed",
    capabilityId: "core:message-delete",
    normalizedInboundEvent: action.action.normalizedEvent,
    externalMessageReference: fixtureReference(
      "external_message_reference",
      target.id
    ),
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      resolvedOccurrence.id
    ),
    actor: fixtureSourceIdentityReference,
    occurredAt: action.observedAt,
    recordedAt: action.recordedAt
  });
  const operation = {
    tenantId: fixtureTenantId,
    id: "message_provider_lifecycle_operation:deferred-delete-1",
    message: target.message,
    action: "delete" as const,
    origin: "provider_observed" as const,
    externalMessageReference: fixtureReference(
      "external_message_reference",
      target.id
    ),
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      resolvedOccurrence.id
    ),
    sourceAccount: resolvedOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: resolvedOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: resolvedOccurrence.bindingContext.bindingGeneration,
    outboundRoute: null,
    adapterContract: resolvedOccurrence.descriptor.adapterContract,
    capabilityRevision: resolvedOccurrence.descriptor.capabilityRevision,
    appActor: null,
    actionParticipant: null,
    automationCausation: null,
    outcome: { state: "observed" as const },
    deleteLocalPolicy: { effect: "not_evaluated" as const },
    revision: "1",
    occurredAt: action.observedAt,
    recordedAt: action.recordedAt,
    createdAt: action.recordedAt,
    updatedAt: action.recordedAt
  };
  const operationCreationCommit = {
    tenantId: fixtureTenantId,
    message: fixtureMessage("source"),
    timelineItem: fixtureTimelineItem("external"),
    externalMessageReference: target,
    sourceOccurrence: resolvedOccurrence,
    outboundRoute: null,
    outboundBindingSnapshot: null,
    actionParticipantSnapshot: null,
    providerSemanticProof: semanticProof,
    semanticOrderingCommit:
      fixtureProviderSemanticOrderingCommit(semanticProof),
    routeConsumption: null,
    operation
  };
  const retainPolicy = {
    effect: "retain_local" as const,
    decisionEvent: fixtureReference(
      "event",
      "event:deferred-delete-retain-local-1"
    ),
    decisionRevision: "1",
    decidedAt: fixtureT3
  };
  const afterOperation = {
    ...operation,
    deleteLocalPolicy: retainPolicy,
    revision: "2",
    updatedAt: fixtureT3
  };
  return {
    kind: "provider_delete_retain_local" as const,
    operationCreationCommit,
    policyTransitionCommit: {
      tenantId: fixtureTenantId,
      before: operation,
      transition: {
        operation: fixtureReference(
          "message_provider_lifecycle_operation",
          operation.id
        ),
        expectedRevision: "1",
        resultingRevision: "2",
        outcome: afterOperation.outcome,
        deleteLocalPolicy: retainPolicy,
        resultProof: null,
        recordedAt: fixtureT3
      },
      after: afterOperation
    }
  };
}

describe("Inbox V2 deferred Message source actions", () => {
  it("bounds the durable ordering-head position to the shared provider limit", () => {
    const action = pendingAction({
      kind: "edit",
      normalizedEvent: normalizedEvent("head-position-limit"),
      normalizedContentDigestSha256: "a".repeat(64)
    });

    expect(
      inboxV2DeferredSourceActionOrderingHeadSchema.safeParse(
        orderingHead(action, { position: "9".repeat(128) })
      ).success
    ).toBe(true);
    expect(
      inboxV2DeferredSourceActionOrderingHeadSchema.safeParse(
        orderingHead(action, { position: "9".repeat(129) })
      ).success
    ).toBe(false);
  });

  it("induces each exact-message action from full occurrence and trusted normalized semantics", () => {
    const actions: DeferredPayload[] = [
      {
        kind: "edit",
        normalizedEvent: normalizedEvent("edit-1"),
        normalizedContentDigestSha256: "a".repeat(64)
      },
      {
        kind: "delete",
        normalizedEvent: normalizedEvent("delete-1"),
        reasonId: "core:provider-delete"
      },
      {
        kind: "reaction",
        operation: "set",
        value: { kind: "unicode", value: "👍" },
        normalizedEvent: normalizedEvent("reaction-1")
      },
      {
        kind: "delivery",
        fact: "delivered",
        normalizedEvent: normalizedEvent("delivery-1")
      },
      {
        kind: "receipt",
        fact: "read",
        scope: "exact_message",
        normalizedEvent: normalizedEvent("receipt-1")
      }
    ];

    for (const [index, action] of actions.entries()) {
      expect(
        inboxV2DeferredMessageSourceActionSchema.safeParse(
          pendingAction(action, {
            id: `deferred_message_source_action:before-create-${index + 1}`,
            occurrenceId: `source_occurrence:before-create-${index + 1}`
          })
        ).success
      ).toBe(true);
    }

    const receipt = pendingAction(actions[4]);
    expect(
      inboxV2DeferredMessageSourceActionSchema.safeParse({
        ...receipt,
        action: { ...receipt.action, scope: "provider_watermark" }
      }).success
    ).toBe(false);
    expect(
      inboxV2DeferredMessageSourceActionSchema.safeParse({
        ...receipt,
        sourceOccurrence: fixtureReference(
          "source_occurrence",
          receipt.sourceOccurrence.id
        )
      }).success
    ).toBe(false);
    expect(
      inboxV2DeferredMessageSourceActionSchema.safeParse({
        ...receipt,
        idempotencyKey: {
          ...receipt.idempotencyKey,
          normalizedInboundEvent: normalizedEvent("unrelated")
        }
      }).success
    ).toBe(false);
  });

  it("keeps reaction clear structurally distinct from set and replace", () => {
    const event = normalizedEvent("reaction-clear-1");
    expect(
      inboxV2DeferredMessageSourceActionSchema.safeParse(
        pendingAction({
          kind: "reaction",
          normalizedEvent: event,
          operation: "clear",
          value: null
        })
      ).success
    ).toBe(true);
    expect(
      inboxV2DeferredMessageSourceActionSchema.safeParse(
        pendingAction({
          kind: "reaction",
          normalizedEvent: event,
          operation: "clear",
          value: { kind: "unicode", value: "👍" }
        })
      ).success
    ).toBe(false);
  });

  it("allows only pending-to-terminal CAS with monotonic and exact terminal time", () => {
    const before = pendingAction({
      kind: "delivery",
      fact: "sent",
      normalizedEvent: normalizedEvent("delivery-sent-1")
    });
    const expiredState = {
      state: "expired" as const,
      reasonId: "core:expired",
      expiredAt: fixtureT3
    };
    const commit = terminalCommit(before, expiredState);
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse({
        ...commit,
        transition: {
          ...commit.transition,
          afterState: { ...expiredState, expiredAt: fixtureT4 }
        },
        after: {
          ...commit.after,
          state: { ...expiredState, expiredAt: fixtureT4 }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse({
        ...commit,
        before: commit.after,
        transition: {
          ...commit.transition,
          expectedRevision: "2",
          resultingRevision: "3"
        },
        after: { ...commit.after, revision: "3" }
      }).success
    ).toBe(false);
  });

  it("converges stale, duplicate and equal-position conflict by provider position rather than time", () => {
    const canonical = pendingAction(
      {
        kind: "delivery",
        fact: "delivered",
        normalizedEvent: normalizedEvent("canonical-delivery")
      },
      { id: "deferred_message_source_action:canonical-1", position: "10" }
    );
    const head = orderingHead(canonical, { actionId: canonical.id });

    const stale = pendingAction(
      {
        kind: "delivery",
        fact: "delivered",
        normalizedEvent: normalizedEvent("stale-delivery")
      },
      {
        id: "deferred_message_source_action:stale-1",
        occurrenceId: "source_occurrence:stale-1",
        position: "9",
        fingerprint: "b".repeat(64)
      }
    );
    const staleCommit = terminalCommit(
      stale,
      {
        state: "stale",
        headAction: head.latest.action,
        staleAt: fixtureT3
      },
      { outcome: "stale", beforeHead: head }
    );
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(staleCommit)
        .success
    ).toBe(true);
    const stalePreliminaryTarget =
      fixtureExternalReference(fixtureOccurrence());
    const staleResolution = occurrenceResolution(stale, stalePreliminaryTarget);
    const staleTarget = fixtureExternalReference(staleResolution.after);
    const staleWithExactProvenance = {
      ...staleCommit,
      targetExternalMessageReference: staleTarget,
      sourceOccurrenceResolution: {
        ...staleResolution,
        resolvedReference: staleTarget
      }
    };
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(
        staleWithExactProvenance
      ).success
    ).toBe(true);
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse({
        ...staleWithExactProvenance,
        sourceOccurrenceResolution: null
      }).success
    ).toBe(false);

    const duplicate = pendingAction(
      {
        ...canonical.action,
        normalizedEvent: normalizedEvent("duplicate-delivery")
      },
      {
        id: "deferred_message_source_action:duplicate-1",
        occurrenceId: "source_occurrence:duplicate-1",
        position: "10"
      }
    );
    const duplicateCommit = terminalCommit(
      duplicate,
      {
        state: "duplicate",
        canonicalAction: head.latest.action,
        duplicateAt: fixtureT3
      },
      { outcome: "duplicate", beforeHead: head }
    );
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(duplicateCommit)
        .success
    ).toBe(true);
    const occurrenceOnlyDuplicate = pendingAction(canonical.action, {
      id: "deferred_message_source_action:occurrence-duplicate-1",
      occurrenceId: "source_occurrence:occurrence-duplicate-1",
      position: "10"
    });
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(
        terminalCommit(
          occurrenceOnlyDuplicate,
          {
            state: "duplicate",
            canonicalAction: head.latest.action,
            duplicateAt: fixtureT3
          },
          { outcome: "duplicate", beforeHead: head }
        )
      ).success
    ).toBe(true);
    const exactReplay = pendingAction(canonical.action, {
      id: "deferred_message_source_action:exact-replay-1",
      position: "10"
    });
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(
        terminalCommit(
          exactReplay,
          {
            state: "duplicate",
            canonicalAction: head.latest.action,
            duplicateAt: fixtureT3
          },
          { outcome: "duplicate", beforeHead: head }
        )
      ).success
    ).toBe(false);
    const duplicatePreliminaryTarget =
      fixtureExternalReference(fixtureOccurrence());
    const duplicateResolution = occurrenceResolution(
      duplicate,
      duplicatePreliminaryTarget
    );
    const duplicateTarget = fixtureExternalReference(duplicateResolution.after);
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse({
        ...duplicateCommit,
        targetExternalMessageReference: duplicateTarget,
        sourceOccurrenceResolution: {
          ...duplicateResolution,
          resolvedReference: duplicateTarget
        }
      }).success
    ).toBe(true);

    const conflict = pendingAction(
      {
        kind: "delivery",
        fact: "delivered",
        normalizedEvent: normalizedEvent("conflicting-delivery")
      },
      {
        id: "deferred_message_source_action:conflict-1",
        occurrenceId: "source_occurrence:conflict-1",
        position: "10",
        fingerprint: "c".repeat(64)
      }
    );
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(
        terminalCommit(
          conflict,
          {
            state: "ordering_conflict",
            conflictingAction: head.latest.action,
            reasonId: "core:provider-order-conflict",
            conflictedAt: fixtureT3
          },
          { outcome: "conflict", beforeHead: head }
        )
      ).success
    ).toBe(true);
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(
        terminalCommit(
          duplicate,
          {
            state: "ordering_conflict",
            conflictingAction: head.latest.action,
            reasonId: "core:provider-order-conflict",
            conflictedAt: fixtureT3
          },
          { outcome: "conflict", beforeHead: head }
        )
      ).success
    ).toBe(false);

    const incomparable = {
      ...pendingAction(
        {
          kind: "delivery",
          fact: "delivered",
          normalizedEvent: normalizedEvent("incomparable-delivery")
        },
        {
          id: "deferred_message_source_action:incomparable-1",
          occurrenceId: "source_occurrence:incomparable-1",
          fingerprint: "d".repeat(64)
        }
      ),
      semanticProof: {
        ...conflict.semanticProof,
        normalizedInboundEvent: normalizedEvent("incomparable-delivery"),
        sourceOccurrence: null,
        ordering: {
          kind: "incomparable" as const,
          conflictToken: "ordering:incomparable-delivery"
        },
        proofToken: "proof:incomparable-delivery"
      }
    };
    const incomparableState = {
      state: "ordering_conflict",
      conflictingAction: head.latest.action,
      reasonId: "core:provider-order-incomparable",
      conflictedAt: fixtureT3
    };
    const incomparableBase = terminalCommit(conflict, incomparableState, {
      outcome: "conflict",
      beforeHead: head
    });
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse({
        ...incomparableBase,
        before: incomparable,
        transition: {
          ...incomparableBase.transition,
          action: fixtureReference(
            "deferred_message_source_action",
            incomparable.id
          )
        },
        after: {
          ...incomparable,
          state: incomparableState,
          revision: "2",
          updatedAt: fixtureT3
        }
      }).success
    ).toBe(true);
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(
        terminalCommit(
          {
            ...stale,
            semanticProof: {
              ...stale.semanticProof,
              ordering: { ...stale.semanticProof.ordering, position: "11" }
            }
          },
          {
            state: "stale",
            headAction: head.latest.action,
            staleAt: fixtureT3
          },
          { outcome: "stale", beforeHead: head }
        )
      ).success
    ).toBe(false);
  });

  it("applies only with exact occurrence resolution, provider head CAS and typed transport effect", () => {
    const before = pendingAction({
      kind: "receipt",
      fact: "read",
      scope: "exact_message",
      normalizedEvent: normalizedEvent("deferred-read-1")
    });
    const preliminaryTarget = fixtureExternalReference(fixtureOccurrence());
    const resolution = occurrenceResolution(before, preliminaryTarget);
    const target = fixtureExternalReference(resolution.after);
    const exactResolution = { ...resolution, resolvedReference: target };
    const effect = receiptEffect(before, target, resolution.after);
    const appliedState = {
      state: "applied" as const,
      externalMessageReference: fixtureExternalMessageReference,
      message: fixtureMessageReference,
      appliedMessageRevision: "1",
      effectKind: "message_transport_fact" as const,
      appliedAt: fixtureT3
    };
    const afterHead = {
      ...orderingHead(before, { actionId: before.id }),
      createdAt: fixtureT3,
      updatedAt: fixtureT3
    };
    const commit = {
      tenantId: fixtureTenantId,
      before,
      transition: {
        action: fixtureReference("deferred_message_source_action", before.id),
        expectedRevision: "1",
        resultingRevision: "2",
        afterState: appliedState,
        orderingOutcome: "advance" as const,
        expectedOrderingHeadRevision: null,
        resultingOrderingHeadRevision: "1",
        recordedAt: fixtureT3
      },
      targetExternalMessageReference: target,
      sourceOccurrenceResolution: exactResolution,
      effectProof: effect,
      beforeOrderingHead: null,
      afterOrderingHead: afterHead,
      after: {
        ...before,
        state: appliedState,
        revision: "2",
        updatedAt: fixtureT3
      }
    };

    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse({
        ...commit,
        effectProof: null
      }).success
    ).toBe(false);
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse({
        ...commit,
        targetExternalMessageReference: {
          ...target,
          key: fixtureMessageKey("another-provider-message")
        }
      }).success
    ).toBe(false);
  });

  it("completes a deferred provider delete with an exact retain-local decision and no Message tombstone", () => {
    const before = pendingAction({
      kind: "delete",
      normalizedEvent: normalizedEvent("deferred-delete-retain-1"),
      reasonId: "core:provider-delete"
    });
    const preliminaryTarget = fixtureExternalReference(fixtureOccurrence());
    const resolution = occurrenceResolution(before, preliminaryTarget);
    const target = fixtureExternalReference(resolution.after);
    const exactResolution = { ...resolution, resolvedReference: target };
    const effect = retainedDeleteEffect(before, target, resolution.after);
    const appliedState = {
      state: "applied" as const,
      externalMessageReference: fixtureExternalMessageReference,
      message: fixtureMessageReference,
      appliedMessageRevision: "1",
      effectKind: "provider_delete_retain_local" as const,
      appliedAt: fixtureT3
    };
    const afterHead = {
      ...orderingHead(before, { actionId: before.id }),
      createdAt: fixtureT3,
      updatedAt: fixtureT3
    };
    const commit = {
      tenantId: fixtureTenantId,
      before,
      transition: {
        action: fixtureReference("deferred_message_source_action", before.id),
        expectedRevision: "1",
        resultingRevision: "2",
        afterState: appliedState,
        orderingOutcome: "advance" as const,
        expectedOrderingHeadRevision: null,
        resultingOrderingHeadRevision: "1",
        recordedAt: fixtureT3
      },
      targetExternalMessageReference: target,
      sourceOccurrenceResolution: exactResolution,
      effectProof: effect,
      beforeOrderingHead: null,
      afterOrderingHead: afterHead,
      after: {
        ...before,
        state: appliedState,
        revision: "2",
        updatedAt: fixtureT3
      }
    };

    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(effect.operationCreationCommit.message.lifecycle).toEqual({
      kind: "active"
    });
    expect(
      inboxV2DeferredMessageSourceActionCommitSchema.safeParse({
        ...commit,
        effectProof: {
          ...effect,
          policyTransitionCommit: {
            ...effect.policyTransitionCommit,
            after: {
              ...effect.policyTransitionCommit.after,
              deleteLocalPolicy: {
                ...effect.policyTransitionCommit.after.deleteLocalPolicy,
                effect: "tombstone_local"
              }
            }
          }
        }
      }).success
    ).toBe(false);
  });
});
