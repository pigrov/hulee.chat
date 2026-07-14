import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  inboxV2ReactionSemanticSlotKeyFor,
  inboxV2MessageReactionCommitSchema,
  inboxV2MessageReactionPageSchema,
  inboxV2MessageReactionSchema,
  inboxV2MessageReactionTransitionSchema,
  inboxV2ReactionValueSchema
} from "./message-reaction";
import {
  fixtureAdapterContract,
  fixtureBindingReference,
  fixtureContent,
  fixtureEmployeeActor,
  fixtureExternalMessageReference,
  fixtureExternalReference,
  fixtureExternalTargetRoute,
  fixtureMessage,
  fixtureMessageReference,
  fixtureOccurrence,
  fixtureOutboundBindingSnapshot,
  fixtureParticipant,
  fixtureProviderSemanticOrderingCommit,
  fixtureProviderSemanticProof,
  fixtureReference,
  fixtureRouteReference,
  fixtureSourceAccountReference,
  fixtureSourceIdentityReference,
  fixtureSourceOccurrenceReference,
  fixtureT1,
  fixtureT2,
  fixtureT3,
  fixtureT4,
  fixtureTenantId,
  fixtureTimelineItem
} from "./timeline-message-fixtures.type-fixture";

const reactionId = "message_reaction:reaction-1";
const transitionId = "message_reaction_transition:transition-1";
const employeeParticipant = fixtureReference(
  "conversation_participant",
  "conversation_participant:employee-1"
);
const sourceParticipant = fixtureReference(
  "conversation_participant",
  "conversation_participant:source-1"
);
const botParticipant = fixtureReference(
  "conversation_participant",
  "conversation_participant:bot-1"
);

function unicode(value = "👍") {
  return { kind: "unicode" as const, value };
}

function providerCustom(canonicalCode = "Custom-Reaction:Wave") {
  return {
    kind: "provider_custom" as const,
    providerKindId: "module:synthetic:custom-reaction",
    canonicalCode
  };
}

function participantActor(participant = employeeParticipant) {
  return { kind: "participant" as const, participant };
}

function internalCapability() {
  return { kind: "internal" as const, cardinality: "multiple_values" as const };
}

function externalCapability(
  cardinality: "single_value" | "multiple_values" | "aggregate_only"
) {
  return {
    kind: "external" as const,
    capabilityId: "module:synthetic:reactions",
    capabilityRevision: "4",
    cardinality,
    adapterContract: fixtureAdapterContract
  };
}

function appAttribution() {
  return {
    actionParticipant: employeeParticipant,
    appActor: fixtureEmployeeActor,
    sourceOccurrence: null,
    automationCausation: null
  };
}

function sourceAttribution() {
  return {
    actionParticipant: sourceParticipant,
    appActor: null,
    sourceOccurrence: fixtureSourceOccurrenceReference,
    automationCausation: null
  };
}

function externalAuthority(
  outboundRoute: typeof fixtureRouteReference | null = null,
  overrides: Record<string, unknown> = {}
) {
  return {
    externalMessageReference: fixtureExternalMessageReference,
    sourceOccurrence: fixtureSourceOccurrenceReference,
    sourceAccount: fixtureSourceAccountReference,
    sourceThreadBinding: fixtureBindingReference,
    bindingGeneration: "1",
    outboundRoute,
    adapterContract: fixtureAdapterContract,
    capabilityFence: {
      capabilityId: "module:synthetic:reactions",
      capabilityRevision: "4",
      adapterContract: fixtureAdapterContract,
      decision: "supported" as const,
      evaluatedAt: fixtureT2,
      notAfter: fixtureT4
    },
    ...overrides
  };
}

function reaction(
  overrides: Record<string, unknown> = {},
  capability:
    | ReturnType<typeof internalCapability>
    | ReturnType<typeof externalCapability> = internalCapability()
): z.input<typeof inboxV2MessageReactionSchema> {
  const candidate = {
    tenantId: fixtureTenantId,
    id: reactionId,
    message: fixtureMessageReference,
    actor: participantActor(),
    capability,
    state: { kind: "active" as const, value: unicode() },
    revision: "1",
    createdAt: fixtureT2,
    updatedAt: fixtureT2,
    ...overrides
  };
  return {
    ...candidate,
    semanticSlotKey:
      typeof overrides.semanticSlotKey === "string"
        ? overrides.semanticSlotKey
        : inboxV2ReactionSemanticSlotKeyFor(candidate)
  };
}

function messageHead(
  origin: "internal" | "source",
  revision: string,
  updatedAt = fixtureT2
) {
  return fixtureMessage(origin, fixtureContent(), {
    revision,
    updatedAt
  });
}

function timelineHead(
  transport: "internal" | "external",
  messageRevision: string,
  revision: string,
  updatedAt = fixtureT2
) {
  return fixtureTimelineItem(transport, {
    subject: {
      kind: "message" as const,
      message: fixtureMessageReference,
      messageRevision
    },
    revision,
    updatedAt
  });
}

function reactionSlotHead(
  value: ReturnType<typeof reaction>,
  updatedAt = value.updatedAt
) {
  return {
    tenantId: fixtureTenantId,
    message: fixtureMessageReference,
    semanticSlotKey: value.semanticSlotKey,
    reaction: fixtureReference("message_reaction", value.id),
    state: value.state,
    revision: value.revision,
    updatedAt
  };
}

function reactionHeads(
  beforeReaction: ReturnType<typeof reaction> | null,
  afterReaction: ReturnType<typeof reaction>,
  recordedAt = fixtureT3
) {
  return {
    slotHeadBefore:
      beforeReaction === null ? null : reactionSlotHead(beforeReaction),
    slotHeadAfter: reactionSlotHead(afterReaction, recordedAt)
  };
}

function setCommit() {
  const beforeMessage = messageHead("internal", "1");
  const beforeTimelineItem = timelineHead("internal", "1", "1");
  const afterReaction = reaction({
    createdAt: fixtureT3,
    updatedAt: fixtureT3
  });
  const transition = {
    tenantId: fixtureTenantId,
    id: transitionId,
    reaction: fixtureReference("message_reaction", reactionId),
    semanticSlotKey: afterReaction.semanticSlotKey,
    mode: "internal_apply" as const,
    operation: "set" as const,
    expectedRevision: null,
    resultingRevision: "1",
    beforeState: null,
    afterState: afterReaction.state,
    actionAttribution: appAttribution(),
    externalAuthority: null,
    occurredAt: fixtureT3,
    recordedAt: fixtureT3,
    recordRevision: "1" as const
  };
  return {
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem,
    beforeReaction: null,
    transition,
    afterReaction,
    participantSnapshots: [fixtureParticipant("employee")],
    externalAuthorityEvidence: null,
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: null,
    providerResultProof: null,
    ...reactionHeads(null, afterReaction)
  };
}

function replaceCommit() {
  const capability = externalCapability("single_value");
  const sourceOccurrence = fixtureOccurrence();
  const beforeReaction = reaction(
    {
      actor: participantActor(sourceParticipant),
      state: { kind: "active" as const, value: unicode("👍") }
    },
    capability
  );
  const afterReaction = {
    ...beforeReaction,
    state: { kind: "active" as const, value: unicode("🔥") },
    revision: "2",
    updatedAt: fixtureT3
  };
  const beforeMessage = messageHead("source", "2");
  const beforeTimelineItem = timelineHead("external", "2", "2");
  const semanticProof = fixtureProviderSemanticProof({
    semanticId: "core:message.reaction.replace",
    capabilityId: capability.capabilityId,
    capabilityRevision: capability.capabilityRevision,
    normalizedInboundEvent:
      sourceOccurrence.origin.kind === "provider_response"
        ? undefined
        : sourceOccurrence.origin.normalizedInboundEvent,
    actor: fixtureSourceIdentityReference,
    occurredAt: fixtureT2,
    recordedAt: fixtureT3
  });
  return {
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem,
    beforeReaction,
    transition: {
      tenantId: fixtureTenantId,
      id: transitionId,
      reaction: fixtureReference("message_reaction", reactionId),
      semanticSlotKey: afterReaction.semanticSlotKey,
      mode: "provider_observed" as const,
      operation: "replace" as const,
      expectedRevision: "1",
      resultingRevision: "2",
      beforeState: beforeReaction.state,
      afterState: afterReaction.state,
      actionAttribution: sourceAttribution(),
      externalAuthority: externalAuthority(),
      occurredAt: fixtureT2,
      recordedAt: fixtureT3,
      recordRevision: "1" as const
    },
    afterReaction,
    participantSnapshots: [fixtureParticipant("source")],
    externalAuthorityEvidence: {
      externalMessageReference: fixtureExternalReference(sourceOccurrence),
      sourceOccurrence,
      outboundRoute: null
    },
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: {
      semanticProof,
      orderingCommit: fixtureProviderSemanticOrderingCommit(
        semanticProof,
        "core:message.reaction",
        fixtureT3
      ),
      normalizedState: afterReaction.state,
      providerActorParticipant: sourceParticipant
    },
    providerResultProof: null,
    ...reactionHeads(beforeReaction, afterReaction)
  };
}

function externalRequestReplaceCommit() {
  const capability = externalCapability("single_value");
  const requestAttribution = appAttribution();
  const confirmedBefore = {
    kind: "active" as const,
    value: unicode("👍")
  };
  const beforeReaction = reaction({ state: confirmedBefore }, capability);
  const pendingState = {
    kind: "pending_external" as const,
    operation: "replace" as const,
    desired: { kind: "active" as const, value: unicode("🔥") },
    confirmedBefore,
    outboundRoute: fixtureRouteReference,
    requestTransition: fixtureReference(
      "message_reaction_transition",
      transitionId
    ),
    requestAttribution,
    requestedAt: fixtureT3
  };
  const afterReaction = {
    ...beforeReaction,
    state: pendingState,
    revision: "2",
    updatedAt: fixtureT3
  };
  const beforeMessage = messageHead("source", "2");
  const beforeTimelineItem = timelineHead("external", "2", "2");
  const sourceOccurrence = fixtureOccurrence();
  const outboundRoute = fixtureExternalTargetRoute(
    "core:message.reaction.replace",
    "core:message.reaction.replace_external"
  );
  return {
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem,
    beforeReaction,
    transition: {
      tenantId: fixtureTenantId,
      id: transitionId,
      reaction: fixtureReference("message_reaction", reactionId),
      semanticSlotKey: afterReaction.semanticSlotKey,
      mode: "external_request" as const,
      operation: "replace" as const,
      expectedRevision: "1",
      resultingRevision: "2",
      beforeState: beforeReaction.state,
      afterState: pendingState,
      actionAttribution: requestAttribution,
      externalAuthority: externalAuthority(fixtureRouteReference),
      occurredAt: fixtureT3,
      recordedAt: fixtureT3,
      recordRevision: "1" as const
    },
    afterReaction,
    participantSnapshots: [fixtureParticipant("employee")],
    externalAuthorityEvidence: {
      externalMessageReference: fixtureExternalReference(sourceOccurrence),
      sourceOccurrence,
      outboundRoute
    },
    outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
      outboundRoute,
      capability.capabilityId
    ),
    routeConsumption: {
      tenantId: fixtureTenantId,
      outboundRoute: fixtureRouteReference,
      transition: fixtureReference("message_reaction_transition", transitionId),
      reaction: fixtureReference("message_reaction", reactionId),
      semanticSlotKey: afterReaction.semanticSlotKey,
      mutationToken: outboundRoute.mutationToken,
      idempotencyToken: outboundRoute.idempotencyToken,
      correlationToken: outboundRoute.correlationToken,
      consumedByTrustedServiceId:
        outboundRoute.adapterContract.loadedByTrustedServiceId,
      consumedAt: fixtureT3,
      revision: "1" as const
    },
    providerObservation: null,
    providerResultProof: null,
    ...reactionHeads(beforeReaction, afterReaction)
  };
}

function confirmExternalRequestCommit() {
  const request = externalRequestReplaceCommit();
  const beforeReaction = request.afterReaction;
  if (
    beforeReaction.state.kind !== "pending_external" ||
    beforeReaction.state.desired.kind !== "active" ||
    beforeReaction.capability.kind !== "external"
  ) {
    throw new Error("Confirmation fixture requires an active pending request.");
  }
  const occurrence = fixtureOccurrence({
    origin: "provider_echo",
    direction: "outbound",
    recordedAt: fixtureT3
  });
  const afterReaction = {
    ...beforeReaction,
    state: {
      kind: "active" as const,
      value: beforeReaction.state.desired.value
    },
    revision: "3",
    updatedAt: fixtureT4
  };
  const semanticProof = fixtureProviderSemanticProof({
    semanticId: "core:message.reaction.replace",
    capabilityId: beforeReaction.capability.capabilityId,
    capabilityRevision: beforeReaction.capability.capabilityRevision,
    normalizedInboundEvent:
      occurrence.origin.kind === "provider_response"
        ? undefined
        : occurrence.origin.normalizedInboundEvent,
    actor: fixtureSourceIdentityReference,
    occurredAt: fixtureT3,
    recordedAt: fixtureT4
  });
  return {
    tenantId: fixtureTenantId,
    beforeMessage: request.beforeMessage,
    beforeTimelineItem: request.beforeTimelineItem,
    beforeReaction,
    transition: {
      tenantId: fixtureTenantId,
      id: "message_reaction_transition:confirmation-1",
      reaction: fixtureReference("message_reaction", reactionId),
      semanticSlotKey: afterReaction.semanticSlotKey,
      mode: "provider_observed" as const,
      operation: "replace" as const,
      expectedRevision: "2",
      resultingRevision: "3",
      beforeState: beforeReaction.state,
      afterState: afterReaction.state,
      actionAttribution: {
        actionParticipant: sourceParticipant,
        appActor: null,
        sourceOccurrence: fixtureSourceOccurrenceReference,
        automationCausation: null
      },
      externalAuthority: externalAuthority(),
      occurredAt: fixtureT3,
      recordedAt: fixtureT4,
      recordRevision: "1" as const
    },
    afterReaction,
    participantSnapshots: [
      fixtureParticipant("employee"),
      fixtureParticipant("source")
    ],
    externalAuthorityEvidence: {
      externalMessageReference: fixtureExternalReference(occurrence),
      sourceOccurrence: occurrence,
      outboundRoute: null
    },
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: {
      semanticProof,
      orderingCommit: fixtureProviderSemanticOrderingCommit(
        semanticProof,
        "core:message.reaction",
        fixtureT4
      ),
      normalizedState: afterReaction.state,
      providerActorParticipant: sourceParticipant
    },
    providerResultProof: null,
    ...reactionHeads(beforeReaction, afterReaction, fixtureT4)
  };
}

function providerResultCommit(
  outcome: "failed" | "unsupported" | "outcome_unknown" = "failed"
) {
  const request = externalRequestReplaceCommit();
  const beforeReaction = request.afterReaction;
  if (
    beforeReaction.state.kind !== "pending_external" ||
    beforeReaction.capability.kind !== "external"
  ) {
    throw new Error("Provider result fixture requires a pending request.");
  }
  const resultToken = `result:reaction-${outcome}`;
  const resultDigestSha256 = "d".repeat(64);
  const afterReaction = {
    ...beforeReaction,
    state: {
      kind: "external_terminal" as const,
      operation: beforeReaction.state.operation,
      desired: beforeReaction.state.desired,
      confirmedState: beforeReaction.state.confirmedBefore,
      outboundRoute: beforeReaction.state.outboundRoute,
      requestTransition: beforeReaction.state.requestTransition,
      outcome,
      resultToken,
      resultDigestSha256,
      resolvedAt: fixtureT4
    },
    revision: "3",
    updatedAt: fixtureT4
  };
  return {
    tenantId: fixtureTenantId,
    beforeMessage: request.beforeMessage,
    beforeTimelineItem: request.beforeTimelineItem,
    beforeReaction,
    transition: {
      tenantId: fixtureTenantId,
      id: "message_reaction_transition:result-1",
      reaction: fixtureReference("message_reaction", reactionId),
      semanticSlotKey: afterReaction.semanticSlotKey,
      mode: "provider_result" as const,
      operation: beforeReaction.state.operation,
      expectedRevision: "2",
      resultingRevision: "3",
      beforeState: beforeReaction.state,
      afterState: afterReaction.state,
      actionAttribution: beforeReaction.state.requestAttribution,
      externalAuthority: null,
      occurredAt: fixtureT4,
      recordedAt: fixtureT4,
      recordRevision: "1" as const
    },
    afterReaction,
    participantSnapshots: [fixtureParticipant("employee")],
    externalAuthorityEvidence: null,
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: null,
    providerResultProof: {
      tenantId: fixtureTenantId,
      operation: beforeReaction.state.requestTransition,
      outboundRoute: beforeReaction.state.outboundRoute,
      adapterContract: beforeReaction.capability.adapterContract,
      capabilityId: beforeReaction.capability.capabilityId,
      capabilityRevision: beforeReaction.capability.capabilityRevision,
      semanticId: `core:message.reaction.${beforeReaction.state.operation}.result`,
      semanticRevision: "1",
      resultState: outcome,
      declaredByTrustedServiceId:
        beforeReaction.capability.adapterContract.loadedByTrustedServiceId,
      resultToken,
      resultDigestSha256,
      recordedAt: fixtureT4,
      revision: "1" as const
    },
    ...reactionHeads(beforeReaction, afterReaction, fixtureT4)
  };
}

function clearCommit() {
  const beforeReaction = reaction();
  if (beforeReaction.state.kind !== "active") {
    throw new Error("Internal clear fixture requires an active reaction.");
  }
  const afterReaction = {
    ...beforeReaction,
    state: {
      kind: "cleared" as const,
      lastValue: beforeReaction.state.value,
      clearedAt: fixtureT3
    },
    revision: "2",
    updatedAt: fixtureT3
  };
  const beforeMessage = messageHead("internal", "2");
  const beforeTimelineItem = timelineHead("internal", "2", "2");
  return {
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem,
    beforeReaction,
    transition: {
      tenantId: fixtureTenantId,
      id: transitionId,
      reaction: fixtureReference("message_reaction", reactionId),
      semanticSlotKey: afterReaction.semanticSlotKey,
      mode: "internal_apply" as const,
      operation: "clear" as const,
      expectedRevision: "1",
      resultingRevision: "2",
      beforeState: beforeReaction.state,
      afterState: afterReaction.state,
      actionAttribution: appAttribution(),
      externalAuthority: null,
      occurredAt: fixtureT3,
      recordedAt: fixtureT3,
      recordRevision: "1" as const
    },
    afterReaction,
    participantSnapshots: [fixtureParticipant("employee")],
    externalAuthorityEvidence: null,
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: null,
    providerResultProof: null,
    ...reactionHeads(beforeReaction, afterReaction)
  };
}

describe("Inbox V2 Message reaction contracts", () => {
  it("sets a new internal reaction slot at exact revision 1", () => {
    const commit = setCommit();
    const parsed = inboxV2MessageReactionCommitSchema.safeParse(commit);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    for (const invalidTransition of [
      { ...commit.transition, expectedRevision: "1" },
      { ...commit.transition, beforeState: commit.afterReaction.state },
      { ...commit.transition, resultingRevision: "2" },
      {
        ...commit.transition,
        afterState: {
          kind: "cleared",
          lastValue: unicode(),
          clearedAt: fixtureT3
        }
      }
    ]) {
      expect(
        inboxV2MessageReactionTransitionSchema.safeParse(invalidTransition)
          .success
      ).toBe(false);
    }
  });

  it("replaces exactly one active external single-value slot", () => {
    const commit = replaceCommit();
    const parsed = inboxV2MessageReactionCommitSchema.safeParse(commit);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        transition: {
          ...commit.transition,
          resultingRevision: "3"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        transition: {
          ...commit.transition,
          afterState: commit.transition.beforeState
        },
        afterReaction: {
          ...commit.afterReaction,
          state: commit.transition.beforeState
        }
      }).success
    ).toBe(false);
  });

  it("clears a slot while retaining its exact last value and clear time", () => {
    const commit = clearCommit();
    const parsed = inboxV2MessageReactionCommitSchema.safeParse(commit);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        transition: {
          ...commit.transition,
          afterState: {
            ...commit.transition.afterState,
            lastValue: unicode("🔥")
          }
        },
        afterReaction: {
          ...commit.afterReaction,
          state: {
            ...commit.afterReaction.state,
            lastValue: unicode("🔥")
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        transition: {
          ...commit.transition,
          afterState: {
            ...commit.transition.afterState,
            clearedAt: fixtureT2
          }
        },
        afterReaction: {
          ...commit.afterReaction,
          state: { ...commit.afterReaction.state, clearedAt: fixtureT2 }
        }
      }).success
    ).toBe(false);
  });

  it("reserves replace for external single-value capabilities", () => {
    for (const cardinality of ["multiple_values", "aggregate_only"] as const) {
      const commit = replaceCommit();
      const capability = externalCapability(cardinality);
      expect(
        inboxV2MessageReactionCommitSchema.safeParse({
          ...commit,
          beforeReaction: { ...commit.beforeReaction, capability },
          afterReaction: { ...commit.afterReaction, capability }
        }).success
      ).toBe(false);
    }
  });

  it("binds aggregate actors only to aggregate-only external capability", () => {
    const aggregateActor = {
      kind: "aggregate_only" as const,
      sourceOccurrence: fixtureSourceOccurrenceReference,
      aggregateScope: "recipient_set" as const
    };
    expect(
      inboxV2MessageReactionSchema.safeParse(
        reaction(
          { actor: aggregateActor },
          externalCapability("aggregate_only")
        )
      ).success
    ).toBe(true);
    expect(
      inboxV2MessageReactionSchema.safeParse(
        reaction({ actor: aggregateActor }, externalCapability("single_value"))
      ).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionSchema.safeParse(
        reaction({}, externalCapability("aggregate_only"))
      ).success
    ).toBe(false);
  });

  it("keeps canonical Unicode in NFC and custom provider identity opaque", () => {
    expect(inboxV2ReactionValueSchema.safeParse(unicode("é")).success).toBe(
      true
    );
    expect(
      inboxV2ReactionValueSchema.safeParse(unicode("e\u0301")).success
    ).toBe(false);
    expect(inboxV2ReactionValueSchema.safeParse(unicode("👨‍👩‍👧‍👦")).success).toBe(
      true
    );
    expect(
      inboxV2ReactionValueSchema.safeParse(unicode("ok\u0000")).success
    ).toBe(false);
    expect(
      inboxV2ReactionValueSchema.parse(providerCustom("  Case:Exact  "))
    ).toEqual(providerCustom("  Case:Exact  "));
    expect(
      inboxV2ReactionValueSchema.safeParse(providerCustom("   ")).success
    ).toBe(false);
  });

  it("requires external authority, matching adapter evidence and route/app plane", () => {
    const external = replaceCommit();
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...external,
        transition: { ...external.transition, externalAuthority: null }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...external,
        transition: {
          ...external.transition,
          externalAuthority: externalAuthority(null, {
            adapterContract: {
              ...fixtureAdapterContract,
              declarationRevision: "8"
            }
          })
        }
      }).success
    ).toBe(false);

    const outbound = externalRequestReplaceCommit();
    const parsedOutbound =
      inboxV2MessageReactionCommitSchema.safeParse(outbound);
    expect(parsedOutbound.success ? [] : parsedOutbound.error.issues).toEqual(
      []
    );
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...outbound,
        outboundBindingSnapshot: null
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...outbound,
        routeConsumption: null
      }).success
    ).toBe(false);
    if (outbound.outboundBindingSnapshot === null) {
      throw new Error("Outbound fixture must carry a binding snapshot.");
    }
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...outbound,
        outboundBindingSnapshot: {
          ...outbound.outboundBindingSnapshot,
          capabilities: {
            ...outbound.outboundBindingSnapshot.capabilities,
            entries: outbound.outboundBindingSnapshot.capabilities.entries.map(
              (entry) => ({ ...entry, state: "unsupported" as const })
            )
          }
        }
      }).success
    ).toBe(false);
    if (outbound.routeConsumption === null) {
      throw new Error("Outbound fixture must carry route consumption.");
    }
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...outbound,
        routeConsumption: {
          ...outbound.routeConsumption,
          transition: fixtureReference(
            "message_reaction_transition",
            "message_reaction_transition:other"
          )
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...outbound,
        externalAuthorityEvidence: {
          ...outbound.externalAuthorityEvidence,
          outboundRoute: fixtureExternalTargetRoute(
            "core:message.reaction.set",
            "core:message.reaction.set_external"
          )
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...outbound,
        transition: {
          ...outbound.transition,
          afterState: { kind: "active", value: unicode("🔥") }
        },
        afterReaction: {
          ...outbound.afterReaction,
          state: { kind: "active", value: unicode("🔥") }
        },
        slotHeadAfter: {
          ...outbound.slotHeadAfter,
          state: { kind: "active", value: unicode("🔥") }
        }
      }).success
    ).toBe(false);
    if (outbound.externalAuthorityEvidence?.outboundRoute === null) {
      throw new Error("Outbound fixture must carry an exact route.");
    }
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...outbound,
        externalAuthorityEvidence: {
          ...outbound.externalAuthorityEvidence,
          outboundRoute: {
            ...outbound.externalAuthorityEvidence.outboundRoute,
            selection: {
              ...outbound.externalAuthorityEvidence.outboundRoute.selection,
              intent: { kind: "automatic" },
              reason: "sole_eligible_binding"
            }
          }
        }
      }).success
    ).toBe(false);

    const internal = setCommit();
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...internal,
        transition: {
          ...internal.transition,
          externalAuthority: externalAuthority(fixtureRouteReference)
        }
      }).success
    ).toBe(false);
  });

  it("keeps app external intent pending until an exact trusted provider outcome", () => {
    const request = externalRequestReplaceCommit();
    const parsedRequest = inboxV2MessageReactionCommitSchema.safeParse(request);
    expect(parsedRequest.success ? [] : parsedRequest.error.issues).toEqual([]);
    expect(request.afterReaction.state.kind).toBe("pending_external");

    const confirmation = confirmExternalRequestCommit();
    const parsedConfirmation =
      inboxV2MessageReactionCommitSchema.safeParse(confirmation);
    expect(
      parsedConfirmation.success ? [] : parsedConfirmation.error.issues
    ).toEqual([]);
    expect(confirmation.afterReaction.state.kind).toBe("active");
    expect(confirmation.afterReaction.actor).toEqual(
      confirmation.beforeReaction.actor
    );
    expect(confirmation.providerObservation?.semanticProof.actor).toEqual(
      fixtureSourceIdentityReference
    );
    expect(confirmation.providerObservation?.providerActorParticipant).toEqual(
      sourceParticipant
    );
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...confirmation,
        providerObservation: null
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...confirmation,
        outboundBindingSnapshot: request.outboundBindingSnapshot,
        routeConsumption: request.routeConsumption
      }).success
    ).toBe(false);
  });

  it("terminalizes pending provider requests with exact trusted result proof and slot CAS", () => {
    for (const outcome of [
      "failed",
      "unsupported",
      "outcome_unknown"
    ] as const) {
      const commit = providerResultCommit(outcome);
      const parsed = inboxV2MessageReactionCommitSchema.safeParse(commit);
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
      expect(commit.afterReaction.state.outcome).toBe(outcome);
      expect(commit.afterReaction.state.confirmedState).toEqual(
        commit.beforeReaction.state.kind === "pending_external"
          ? commit.beforeReaction.state.confirmedBefore
          : null
      );
    }

    const commit = providerResultCommit();
    for (const invalidProof of [
      null,
      { ...commit.providerResultProof, resultState: "accepted" },
      { ...commit.providerResultProof, resultState: "confirmed" },
      {
        ...commit.providerResultProof,
        operation: fixtureReference(
          "message_reaction_transition",
          "message_reaction_transition:other"
        )
      },
      {
        ...commit.providerResultProof,
        outboundRoute: fixtureReference(
          "outbound_route",
          "outbound_route:other"
        )
      },
      { ...commit.providerResultProof, capabilityRevision: "5" },
      { ...commit.providerResultProof, resultToken: "result:other" },
      { ...commit.providerResultProof, resultDigestSha256: "e".repeat(64) }
    ]) {
      expect(
        inboxV2MessageReactionCommitSchema.safeParse({
          ...commit,
          providerResultProof: invalidProof
        }).success
      ).toBe(false);
    }
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        transition: { ...commit.transition, expectedRevision: "1" }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        externalAuthorityEvidence:
          externalRequestReplaceCommit().externalAuthorityEvidence
      }).success
    ).toBe(false);
  });

  it("requires exact provider semantic proof, ordering head and known actor", () => {
    const commit = replaceCommit();
    if (commit.providerObservation === null || commit.beforeReaction === null) {
      throw new Error("Provider fixture must carry proof and current slot.");
    }
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        providerObservation: {
          ...commit.providerObservation,
          semanticProof: {
            ...commit.providerObservation.semanticProof,
            semanticId: "core:message.reaction.clear"
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        providerObservation: {
          ...commit.providerObservation,
          orderingCommit: {
            ...commit.providerObservation.orderingCommit,
            semanticFamilyId: "core:message.delivery"
          }
        }
      }).success
    ).toBe(false);

    const downgradedActor = {
      kind: "unattributed_source_observation" as const,
      sourceOccurrence: fixtureSourceOccurrenceReference,
      opaqueActorKey: "Actor-1"
    };
    const beforeReaction = {
      ...commit.beforeReaction,
      actor: downgradedActor
    };
    const beforeSemanticSlotKey =
      inboxV2ReactionSemanticSlotKeyFor(beforeReaction);
    const afterReaction = {
      ...commit.afterReaction,
      actor: downgradedActor,
      semanticSlotKey: beforeSemanticSlotKey
    };
    beforeReaction.semanticSlotKey = beforeSemanticSlotKey;
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        beforeReaction,
        afterReaction,
        participantSnapshots: [],
        transition: {
          ...commit.transition,
          semanticSlotKey: beforeSemanticSlotKey,
          actionAttribution: {
            ...commit.transition.actionAttribution,
            actionParticipant: null
          }
        },
        ...reactionHeads(beforeReaction, afterReaction)
      }).success
    ).toBe(false);
  });

  it("uses deterministic semantic slot keys and absent/current slot CAS", () => {
    const internalOne = reaction({
      state: { kind: "active", value: unicode("👍") }
    });
    const internalTwo = reaction({
      id: "message_reaction:other",
      state: { kind: "active", value: unicode("🔥") }
    });
    expect(internalOne.semanticSlotKey).not.toBe(internalTwo.semanticSlotKey);

    const singleCapability = externalCapability("single_value");
    const externalOne = reaction(
      { state: { kind: "active", value: unicode("👍") } },
      singleCapability
    );
    const externalTwo = reaction(
      { state: { kind: "active", value: unicode("🔥") } },
      singleCapability
    );
    expect(externalOne.semanticSlotKey).toBe(externalTwo.semanticSlotKey);
    expect(
      inboxV2MessageReactionSchema.safeParse({
        ...externalOne,
        semanticSlotKey: `${externalOne.semanticSlotKey}:forged`
      }).success
    ).toBe(false);

    const create = setCommit();
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...create,
        slotHeadBefore: create.slotHeadAfter
      }).success
    ).toBe(false);
    const update = replaceCommit();
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...update,
        slotHeadBefore: null
      }).success
    ).toBe(false);
  });

  it("requires trusted-service bot attribution, causation and valid chronology", () => {
    const base = setCommit();
    const botActor = participantActor(botParticipant);
    const afterReaction = {
      ...base.afterReaction,
      actor: botActor
    };
    afterReaction.semanticSlotKey =
      inboxV2ReactionSemanticSlotKeyFor(afterReaction);
    const automationCausation = {
      kind: "system_event" as const,
      causeEvent: fixtureReference("event", "event:automation-1"),
      correlationId: "correlation:automation-1",
      causedAt: fixtureT2
    };
    const trusted = {
      ...base,
      afterReaction,
      participantSnapshots: [fixtureParticipant("bot")],
      transition: {
        ...base.transition,
        semanticSlotKey: afterReaction.semanticSlotKey,
        actionAttribution: {
          actionParticipant: botParticipant,
          appActor: {
            kind: "trusted_service" as const,
            trustedServiceId: "core:automation-service"
          },
          sourceOccurrence: null,
          automationCausation
        }
      },
      slotHeadAfter: reactionSlotHead(afterReaction, fixtureT3)
    };
    const parsedTrusted = inboxV2MessageReactionCommitSchema.safeParse(trusted);
    expect(parsedTrusted.success ? [] : parsedTrusted.error.issues).toEqual([]);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...trusted,
        transition: {
          ...trusted.transition,
          actionAttribution: {
            ...trusted.transition.actionAttribution,
            automationCausation: null
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...trusted,
        transition: {
          ...trusted.transition,
          actionAttribution: {
            ...trusted.transition.actionAttribution,
            automationCausation: {
              ...automationCausation,
              causedAt: fixtureT4
            }
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionTransitionSchema.safeParse({
        ...base.transition,
        occurredAt: fixtureT3,
        recordedAt: fixtureT2
      }).success
    ).toBe(false);
  });

  it("rejects cross-tenant authority and participant references", () => {
    const commit = replaceCommit();
    const otherTenant = "tenant:tenant-2";
    for (const externalAuthorityOverride of [
      {
        externalMessageReference: {
          ...fixtureExternalMessageReference,
          tenantId: otherTenant
        }
      },
      {
        sourceOccurrence: {
          ...fixtureSourceOccurrenceReference,
          tenantId: otherTenant
        }
      },
      {
        sourceAccount: {
          ...fixtureSourceAccountReference,
          tenantId: otherTenant
        }
      },
      {
        sourceThreadBinding: {
          ...fixtureBindingReference,
          tenantId: otherTenant
        }
      }
    ]) {
      expect(
        inboxV2MessageReactionCommitSchema.safeParse({
          ...commit,
          transition: {
            ...commit.transition,
            externalAuthority: externalAuthority(
              null,
              externalAuthorityOverride
            )
          }
        }).success
      ).toBe(false);
    }
    expect(
      inboxV2MessageReactionSchema.safeParse(
        reaction({
          actor: participantActor({
            ...employeeParticipant,
            tenantId: otherTenant
          })
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionTransitionSchema.safeParse({
        ...setCommit().transition,
        actionAttribution: {
          ...appAttribution(),
          actionParticipant: {
            ...employeeParticipant,
            tenantId: otherTenant
          }
        }
      }).success
    ).toBe(false);
  });

  it("rejects unrelated same-tenant transport and participant evidence", () => {
    const commit = replaceCommit();
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        transition: {
          ...commit.transition,
          externalAuthority: externalAuthority(null, {
            sourceAccount: fixtureReference(
              "source_account",
              "source_account:unrelated"
            )
          })
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        participantSnapshots: [
          {
            ...fixtureParticipant("source"),
            conversation: fixtureReference(
              "conversation",
              "conversation:unrelated"
            )
          }
        ]
      }).success
    ).toBe(false);
    if (commit.externalAuthorityEvidence === null) {
      throw new Error("External fixture must carry authority evidence.");
    }
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        externalAuthorityEvidence: {
          ...commit.externalAuthorityEvidence,
          externalMessageReference: {
            ...commit.externalAuthorityEvidence.externalMessageReference,
            message: fixtureReference("message", "message:unrelated")
          }
        }
      }).success
    ).toBe(false);
  });

  it("binds commit to one exact Message and reaction slot", () => {
    const commit = setCommit();
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        afterReaction: {
          ...commit.afterReaction,
          message: fixtureReference("message", "message:message-2")
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        transition: {
          ...commit.transition,
          reaction: fixtureReference(
            "message_reaction",
            "message_reaction:reaction-2"
          )
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        beforeMessage: {
          ...commit.beforeMessage,
          tenantId: "tenant:tenant-2"
        }
      }).success
    ).toBe(false);
  });

  it("advances only the deterministic slot head and preserves Message/Timeline rows", () => {
    const commit = setCommit();
    const parsed = inboxV2MessageReactionCommitSchema.safeParse(commit);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        beforeTimelineItem: {
          ...commit.beforeTimelineItem,
          subject: {
            ...commit.beforeTimelineItem.subject,
            messageRevision: "99"
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        reactionSetHeadAfter: {
          tenantId: fixtureTenantId,
          message: fixtureMessageReference,
          revision: "1",
          updatedAt: fixtureT3
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        slotHeadAfter: {
          ...commit.slotHeadAfter,
          semanticSlotKey: `${commit.slotHeadAfter.semanticSlotKey}:other`
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionCommitSchema.safeParse({
        ...commit,
        afterMessage: commit.beforeMessage
      }).success
    ).toBe(false);
  });

  it("returns bounded distinct reaction pages for one exact Message", () => {
    const reactions = Array.from({ length: 200 }, (_, index) =>
      reaction({
        id: `message_reaction:reaction-${index + 1}`,
        state: { kind: "active", value: unicode(`reaction-${index + 1}`) }
      })
    );
    const page = {
      tenantId: fixtureTenantId,
      message: fixtureMessageReference,
      snapshotToken: "snapshot:reaction-page-1",
      snapshotCreatedAt: fixtureT4,
      reactions,
      nextCursor: "cursor:reaction-page-2"
    };
    expect(inboxV2MessageReactionPageSchema.safeParse(page).success).toBe(true);
    expect(
      inboxV2MessageReactionPageSchema.safeParse({
        ...page,
        reactions: [
          ...reactions,
          reaction({ id: "message_reaction:reaction-201" })
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionPageSchema.safeParse({
        ...page,
        reactions: [reactions[0], reactions[0]]
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionPageSchema.safeParse({
        ...page,
        reactions: [
          reaction({
            message: fixtureReference("message", "message:message-2")
          })
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionPageSchema.safeParse({
        ...page,
        snapshotCreatedAt: fixtureT1
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionPageSchema.safeParse({
        ...page,
        message: { ...fixtureMessageReference, tenantId: "tenant:tenant-2" }
      }).success
    ).toBe(false);
  });

  it("enforces reaction slot start, clear and timestamp invariants", () => {
    expect(inboxV2MessageReactionSchema.safeParse(reaction()).success).toBe(
      true
    );
    expect(
      inboxV2MessageReactionSchema.safeParse(
        reaction({ revision: "1", updatedAt: fixtureT3 })
      ).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionSchema.safeParse(
        reaction({
          revision: "2",
          state: {
            kind: "cleared",
            lastValue: unicode(),
            clearedAt: fixtureT2
          },
          updatedAt: fixtureT3
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionSchema.safeParse(
        reaction({ createdAt: fixtureT3, updatedAt: fixtureT1 })
      ).success
    ).toBe(false);
  });
});
