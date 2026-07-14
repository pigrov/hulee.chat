import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ExternalMessageReferenceSchema,
  inboxV2SourceOccurrenceSchema
} from "./external-message-reference";
import {
  inboxV2ConversationParticipantReferenceSchema,
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2MessageReactionIdSchema,
  inboxV2MessageReactionReferenceSchema,
  inboxV2MessageReactionTransitionReferenceSchema,
  inboxV2MessageReactionTransitionIdSchema,
  inboxV2MessageReferenceSchema,
  inboxV2OutboundRouteReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2MessageSchema } from "./message";
import { inboxV2MessageActionAttributionSchema } from "./message-lifecycle";
import { inboxV2OutboundRouteSchema } from "./outbound-route";
import { inboxV2ConversationParticipantSchema } from "./participant-identity";
import {
  inboxV2ProviderOperationResultProofSchema,
  inboxV2ProviderSemanticOrderingCommitSchema,
  inboxV2ProviderSemanticProofSchema
} from "./provider-semantic-proof";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema
} from "./source-routing-primitives";
import { inboxV2SourceThreadBindingSchema } from "./source-thread-binding";
import { inboxV2TimelineItemSchema } from "./timeline";

export const INBOX_V2_MESSAGE_REACTION_SCHEMA_ID =
  "core:inbox-v2.message-reaction" as const;
export const INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID =
  "core:inbox-v2.message-reaction-transition" as const;
export const INBOX_V2_MESSAGE_REACTION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.message-reaction-commit" as const;
export const INBOX_V2_MESSAGE_REACTION_SLOT_HEAD_SCHEMA_ID =
  "core:inbox-v2.message-reaction-slot-head" as const;
export const INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2ReactionCapabilityIdSchema = inboxV2CatalogIdSchema;
export const inboxV2ProviderReactionKindIdSchema = inboxV2CatalogIdSchema;

export const inboxV2ReactionActorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("participant"),
      participant: inboxV2ConversationParticipantReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("unattributed_source_observation"),
      sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
      opaqueActorKey: inboxV2OpaqueProviderSubjectSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("aggregate_only"),
      sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
      aggregateScope: z.enum(["thread", "recipient_set", "unknown"])
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider_system"),
      sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
      actorKindId: inboxV2CatalogIdSchema,
      actorSubject: inboxV2OpaqueProviderSubjectSchema
    })
    .strict()
]);

export const inboxV2ReactionValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("unicode"),
      value: z
        .string()
        .min(1)
        .max(64)
        .refine((value) => value === value.normalize("NFC"), {
          message: "Canonical Unicode reaction must use NFC normalization."
        })
        .refine(hasNoAsciiControlCharacters, {
          message: "Reaction cannot contain ASCII control characters."
        })
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider_custom"),
      providerKindId: inboxV2ProviderReactionKindIdSchema,
      canonicalCode: inboxV2OpaqueProviderSubjectSchema
    })
    .strict()
]);

export const inboxV2ReactionCapabilitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("internal"),
      cardinality: z.literal("multiple_values")
    })
    .strict(),
  z
    .object({
      kind: z.literal("external"),
      capabilityId: inboxV2ReactionCapabilityIdSchema,
      capabilityRevision: inboxV2EntityRevisionSchema,
      cardinality: z.enum([
        "single_value",
        "multiple_values",
        "aggregate_only"
      ]),
      adapterContract: inboxV2AdapterContractSnapshotSchema
    })
    .strict()
]);

export const inboxV2ReactionCanonicalStateSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({ kind: z.literal("active"), value: inboxV2ReactionValueSchema })
      .strict(),
    z
      .object({
        kind: z.literal("cleared"),
        lastValue: inboxV2ReactionValueSchema,
        clearedAt: inboxV2TimestampSchema
      })
      .strict()
  ]
);

export const inboxV2ReactionDesiredStateSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("active"), value: inboxV2ReactionValueSchema })
    .strict(),
  z
    .object({
      kind: z.literal("cleared"),
      lastValue: inboxV2ReactionValueSchema
    })
    .strict()
]);

export const inboxV2ExternalReactionTerminalOutcomeSchema = z.enum([
  "failed",
  "unsupported",
  "outcome_unknown"
]);

export const inboxV2ReactionStateSchema = z.discriminatedUnion("kind", [
  ...inboxV2ReactionCanonicalStateSchema.options,
  z
    .object({
      kind: z.literal("pending_external"),
      operation: z.enum(["set", "replace", "clear"]),
      desired: inboxV2ReactionDesiredStateSchema,
      confirmedBefore: inboxV2ReactionCanonicalStateSchema.nullable(),
      outboundRoute: inboxV2OutboundRouteReferenceSchema,
      requestTransition: inboxV2MessageReactionTransitionReferenceSchema,
      requestAttribution: inboxV2MessageActionAttributionSchema,
      requestedAt: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("external_terminal"),
      operation: z.enum(["set", "replace", "clear"]),
      desired: inboxV2ReactionDesiredStateSchema,
      confirmedState: inboxV2ReactionCanonicalStateSchema.nullable(),
      outboundRoute: inboxV2OutboundRouteReferenceSchema,
      requestTransition: inboxV2MessageReactionTransitionReferenceSchema,
      outcome: inboxV2ExternalReactionTerminalOutcomeSchema,
      resultToken: inboxV2RoutingTokenSchema,
      resultDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      resolvedAt: inboxV2TimestampSchema
    })
    .strict()
]);

export const inboxV2ReactionSemanticSlotKeySchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(/^v1:(?:[0-9]+:[\s\S]*)+$/u);

export const inboxV2MessageReactionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2MessageReactionIdSchema,
    message: inboxV2MessageReferenceSchema,
    actor: inboxV2ReactionActorSchema,
    capability: inboxV2ReactionCapabilitySchema,
    semanticSlotKey: inboxV2ReactionSemanticSlotKeySchema,
    state: inboxV2ReactionStateSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((reaction, context) => {
    addTenantReferenceIssue(context, reaction.tenantId, reaction.message, [
      "message"
    ]);
    if (reaction.actor.kind === "participant") {
      addTenantReferenceIssue(
        context,
        reaction.tenantId,
        reaction.actor.participant,
        ["actor", "participant"]
      );
    } else {
      addTenantReferenceIssue(
        context,
        reaction.tenantId,
        reaction.actor.sourceOccurrence,
        ["actor", "sourceOccurrence"]
      );
    }
    if (
      reaction.state.kind === "pending_external" ||
      reaction.state.kind === "external_terminal"
    ) {
      for (const [field, reference] of [
        ["outboundRoute", reaction.state.outboundRoute],
        ["requestTransition", reaction.state.requestTransition]
      ] as const) {
        addTenantReferenceIssue(context, reaction.tenantId, reference, [
          "state",
          field
        ]);
      }
      if (reaction.state.kind === "pending_external") {
        addAttributionTenantIssues(
          context,
          reaction.tenantId,
          reaction.state.requestAttribution,
          ["state", "requestAttribution"]
        );
      }
    }
    if (
      (reaction.actor.kind === "aggregate_only") !==
      (reaction.capability.kind === "external" &&
        reaction.capability.cardinality === "aggregate_only")
    ) {
      addIssue(
        context,
        ["actor"],
        "Aggregate-only reactions require exact aggregate-only provider capability."
      );
    }
    if (
      reaction.capability.kind === "internal" &&
      reaction.actor.kind !== "participant"
    ) {
      addIssue(
        context,
        ["actor"],
        "Internal reactions always have an exact Conversation participant actor."
      );
    }
    if (
      reaction.actor.kind === "provider_system" &&
      reaction.capability.kind !== "external"
    ) {
      addIssue(
        context,
        ["actor"],
        "Provider-system reaction actors are external provider evidence."
      );
    }
    if (
      reaction.state.kind === "pending_external" &&
      (reaction.capability.kind !== "external" ||
        reaction.actor.kind !== "participant" ||
        reaction.state.requestedAt !== reaction.updatedAt)
    ) {
      addIssue(
        context,
        ["state"],
        "A pending external reaction is an app-participant desired state stamped at its current revision."
      );
    }
    if (
      reaction.state.kind === "external_terminal" &&
      (reaction.capability.kind !== "external" ||
        reaction.actor.kind !== "participant" ||
        reaction.state.resolvedAt !== reaction.updatedAt)
    ) {
      addIssue(
        context,
        ["state"],
        "Terminal external outcome preserves the app-owned slot and exact result time."
      );
    }
    if (
      reaction.semanticSlotKey !== inboxV2ReactionSemanticSlotKeyFor(reaction)
    ) {
      addIssue(
        context,
        ["semanticSlotKey"],
        "Reaction semantic slot key must be the deterministic Message/actor/capability/value key."
      );
    }
    if (
      reaction.revision === "1" &&
      (reaction.state.kind === "cleared" ||
        reaction.state.kind === "external_terminal" ||
        reaction.createdAt !== reaction.updatedAt)
    ) {
      addIssue(
        context,
        ["revision"],
        "Reaction slot starts active or pending-external at revision 1, never cleared/terminal."
      );
    }
    if (
      reaction.state.kind === "cleared" &&
      reaction.state.clearedAt !== reaction.updatedAt
    ) {
      addIssue(
        context,
        ["state", "clearedAt"],
        "Reaction clear time is the slot revision time."
      );
    }
    if (!isInboxV2TimestampOrderValid(reaction.createdAt, reaction.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "Reaction update cannot precede creation."
      );
    }
  });

export const inboxV2ExternalReactionCapabilityFenceSchema = z
  .object({
    capabilityId: inboxV2ReactionCapabilityIdSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    decision: z.literal("supported"),
    evaluatedAt: inboxV2TimestampSchema,
    notAfter: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((fence, context) => {
    if (!isInboxV2TimestampOrderValid(fence.evaluatedAt, fence.notAfter)) {
      addIssue(
        context,
        ["notAfter"],
        "Reaction capability fence cannot expire before it was evaluated."
      );
    }
  });

export const inboxV2ExternalReactionAuthoritySchema = z
  .object({
    externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    bindingGeneration: inboxV2EntityRevisionSchema,
    outboundRoute: inboxV2OutboundRouteReferenceSchema.nullable(),
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    capabilityFence: inboxV2ExternalReactionCapabilityFenceSchema
  })
  .strict();

export const inboxV2MessageReactionTransitionModeSchema = z.enum([
  "internal_apply",
  "external_request",
  "provider_observed",
  "provider_result"
]);

export const inboxV2MessageReactionTransitionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2MessageReactionTransitionIdSchema,
    reaction: inboxV2MessageReactionReferenceSchema,
    semanticSlotKey: inboxV2ReactionSemanticSlotKeySchema,
    mode: inboxV2MessageReactionTransitionModeSchema,
    operation: z.enum(["set", "replace", "clear"]),
    expectedRevision: inboxV2EntityRevisionSchema.nullable(),
    resultingRevision: inboxV2EntityRevisionSchema,
    beforeState: inboxV2ReactionStateSchema.nullable(),
    afterState: inboxV2ReactionStateSchema,
    actionAttribution: inboxV2MessageActionAttributionSchema,
    externalAuthority: inboxV2ExternalReactionAuthoritySchema.nullable(),
    occurredAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    recordRevision: z.literal("1")
  })
  .strict()
  .superRefine((transition, context) => {
    addTenantReferenceIssue(context, transition.tenantId, transition.reaction, [
      "reaction"
    ]);
    addActionTenantIssues(context, transition);
    if (transition.externalAuthority !== null) {
      for (const [field, reference] of [
        [
          "externalMessageReference",
          transition.externalAuthority.externalMessageReference
        ],
        ["sourceOccurrence", transition.externalAuthority.sourceOccurrence],
        ["sourceAccount", transition.externalAuthority.sourceAccount],
        [
          "sourceThreadBinding",
          transition.externalAuthority.sourceThreadBinding
        ]
      ] as const) {
        addTenantReferenceIssue(context, transition.tenantId, reference, [
          "externalAuthority",
          field
        ]);
      }
      if (transition.externalAuthority.outboundRoute !== null) {
        addTenantReferenceIssue(
          context,
          transition.tenantId,
          transition.externalAuthority.outboundRoute,
          ["externalAuthority", "outboundRoute"]
        );
      }
    }
    addTransitionCasIssues(context, transition);
    addTransitionModeIssues(context, transition);
    addTransitionStateIssues(context, transition);
    if (Date.parse(transition.recordedAt) < Date.parse(transition.occurredAt)) {
      addIssue(
        context,
        ["recordedAt"],
        "Reaction cannot be recorded before it occurred."
      );
    }
    if (
      transition.actionAttribution.automationCausation !== null &&
      Date.parse(transition.actionAttribution.automationCausation.causedAt) >
        Date.parse(transition.occurredAt)
    ) {
      addIssue(
        context,
        ["automationCausation", "causedAt"],
        "Reaction automation cause cannot occur after the reaction action."
      );
    }
  });

export const inboxV2MessageReactionSlotHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    message: inboxV2MessageReferenceSchema,
    semanticSlotKey: inboxV2ReactionSemanticSlotKeySchema,
    reaction: inboxV2MessageReactionReferenceSchema,
    state: inboxV2ReactionStateSchema,
    revision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    addTenantReferenceIssue(context, head.tenantId, head.message, ["message"]);
    addTenantReferenceIssue(context, head.tenantId, head.reaction, [
      "reaction"
    ]);
  });

export const inboxV2ProviderReactionObservationSchema = z
  .object({
    semanticProof: inboxV2ProviderSemanticProofSchema,
    orderingCommit: inboxV2ProviderSemanticOrderingCommitSchema,
    normalizedState: inboxV2ReactionCanonicalStateSchema,
    providerActorParticipant:
      inboxV2ConversationParticipantReferenceSchema.nullable()
  })
  .strict();

/** Immutable single-use ledger row for one requested reaction route. */
export const inboxV2MessageReactionRouteConsumptionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    outboundRoute: inboxV2OutboundRouteReferenceSchema,
    transition: inboxV2MessageReactionTransitionReferenceSchema,
    reaction: inboxV2MessageReactionReferenceSchema,
    semanticSlotKey: inboxV2ReactionSemanticSlotKeySchema,
    mutationToken: inboxV2RoutingTokenSchema,
    idempotencyToken: inboxV2RoutingTokenSchema,
    correlationToken: inboxV2RoutingTokenSchema,
    consumedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    consumedAt: inboxV2TimestampSchema,
    revision: z.literal("1")
  })
  .strict()
  .superRefine((consumption, context) => {
    for (const [field, reference] of [
      ["outboundRoute", consumption.outboundRoute],
      ["transition", consumption.transition],
      ["reaction", consumption.reaction]
    ] as const) {
      addTenantReferenceIssue(context, consumption.tenantId, reference, [
        field
      ]);
    }
  });

export const inboxV2MessageReactionCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    beforeMessage: inboxV2MessageSchema,
    beforeTimelineItem: inboxV2TimelineItemSchema,
    beforeReaction: inboxV2MessageReactionSchema.nullable(),
    transition: inboxV2MessageReactionTransitionSchema,
    afterReaction: inboxV2MessageReactionSchema,
    participantSnapshots: z.array(inboxV2ConversationParticipantSchema).max(2),
    externalAuthorityEvidence: z
      .object({
        externalMessageReference: inboxV2ExternalMessageReferenceSchema,
        sourceOccurrence: inboxV2SourceOccurrenceSchema,
        outboundRoute: inboxV2OutboundRouteSchema.nullable()
      })
      .strict()
      .nullable(),
    outboundBindingSnapshot: inboxV2SourceThreadBindingSchema.nullable(),
    routeConsumption: inboxV2MessageReactionRouteConsumptionSchema.nullable(),
    providerObservation: inboxV2ProviderReactionObservationSchema.nullable(),
    providerResultProof: inboxV2ProviderOperationResultProofSchema.nullable(),
    slotHeadBefore: inboxV2MessageReactionSlotHeadSchema.nullable(),
    slotHeadAfter: inboxV2MessageReactionSlotHeadSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addReactionCommitIssues(context, commit);
    addReactionEvidenceIssues(context, commit);
    addProviderObservationIssues(context, commit);
    addProviderResultIssues(context, commit);
    addReactionHeadIssues(context, commit);
    addReactionTargetProofIssues(context, commit);
  });

export const inboxV2MessageReactionPageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    message: inboxV2MessageReferenceSchema,
    snapshotToken: inboxV2RoutingTokenSchema,
    snapshotCreatedAt: inboxV2TimestampSchema,
    reactions: z.array(inboxV2MessageReactionSchema).max(200),
    nextCursor: z.string().min(1).max(2_048).nullable()
  })
  .strict()
  .superRefine((page, context) => {
    addTenantReferenceIssue(context, page.tenantId, page.message, ["message"]);
    const ids = new Set<string>();
    const semanticSlotKeys = new Set<string>();
    for (const [index, reaction] of page.reactions.entries()) {
      if (
        reaction.tenantId !== page.tenantId ||
        reaction.message.id !== page.message.id ||
        Date.parse(reaction.updatedAt) > Date.parse(page.snapshotCreatedAt) ||
        ids.has(reaction.id) ||
        semanticSlotKeys.has(reaction.semanticSlotKey)
      ) {
        addIssue(
          context,
          ["reactions", index],
          "Reaction page contains one row per deterministic semantic slot for one exact Message."
        );
      }
      ids.add(reaction.id);
      semanticSlotKeys.add(reaction.semanticSlotKey);
    }
  });

export const inboxV2MessageReactionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_REACTION_SCHEMA_ID,
    INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
    inboxV2MessageReactionSchema
  );
export const inboxV2MessageReactionTransitionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID,
    INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
    inboxV2MessageReactionTransitionSchema
  );
export const inboxV2MessageReactionCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_REACTION_COMMIT_SCHEMA_ID,
    INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
    inboxV2MessageReactionCommitSchema
  );
export const inboxV2MessageReactionSlotHeadEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_REACTION_SLOT_HEAD_SCHEMA_ID,
    INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
    inboxV2MessageReactionSlotHeadSchema
  );

export type InboxV2MessageReaction = z.infer<
  typeof inboxV2MessageReactionSchema
>;
export type InboxV2MessageReactionSlotHead = z.infer<
  typeof inboxV2MessageReactionSlotHeadSchema
>;
export type InboxV2ProviderReactionObservation = z.infer<
  typeof inboxV2ProviderReactionObservationSchema
>;
export type InboxV2MessageReactionRouteConsumption = z.infer<
  typeof inboxV2MessageReactionRouteConsumptionSchema
>;

function addTransitionCasIssues(
  context: z.RefinementCtx,
  transition: z.infer<typeof inboxV2MessageReactionTransitionSchema>
): void {
  const creates =
    transition.expectedRevision === null &&
    transition.beforeState === null &&
    transition.resultingRevision === "1";
  const updates =
    transition.expectedRevision !== null &&
    transition.beforeState !== null &&
    BigInt(transition.resultingRevision) ===
      BigInt(transition.expectedRevision) + 1n;
  if (!creates && !updates) {
    addIssue(
      context,
      ["resultingRevision"],
      "Reaction transition is an absent-slot create or one contiguous per-slot CAS update."
    );
  }
}

function addTransitionModeIssues(
  context: z.RefinementCtx,
  transition: z.infer<typeof inboxV2MessageReactionTransitionSchema>
): void {
  const attribution = transition.actionAttribution;
  const authority = transition.externalAuthority;
  switch (transition.mode) {
    case "internal_apply":
      if (
        authority !== null ||
        attribution.appActor === null ||
        attribution.actionParticipant === null ||
        attribution.sourceOccurrence !== null ||
        transition.afterState.kind === "pending_external" ||
        transition.afterState.kind === "external_terminal"
      ) {
        addIssue(
          context,
          ["mode"],
          "Internal reaction is synchronously app-authored and has no provider authority or occurrence."
        );
      }
      break;
    case "external_request":
      if (
        authority?.outboundRoute === null ||
        authority === null ||
        attribution.appActor === null ||
        attribution.actionParticipant === null ||
        attribution.sourceOccurrence !== null ||
        transition.afterState.kind !== "pending_external" ||
        (transition.afterState.kind === "pending_external" &&
          (transition.afterState.operation !== transition.operation ||
            transition.afterState.outboundRoute.id !==
              authority.outboundRoute?.id ||
            transition.afterState.requestTransition.id !== transition.id ||
            !sameValue(transition.afterState.requestAttribution, attribution) ||
            transition.afterState.requestedAt !== transition.recordedAt))
      ) {
        addIssue(
          context,
          ["mode"],
          "External app reaction persists only a route-bound pending desired state."
        );
      }
      break;
    case "provider_observed":
      if (
        authority === null ||
        authority.outboundRoute !== null ||
        attribution.appActor !== null ||
        attribution.sourceOccurrence?.id !== authority.sourceOccurrence.id ||
        attribution.automationCausation !== null ||
        transition.afterState.kind === "pending_external" ||
        transition.afterState.kind === "external_terminal"
      ) {
        addIssue(
          context,
          ["mode"],
          "Provider-observed reaction is canonical source evidence, never an app route request."
        );
      }
      break;
    case "provider_result":
      if (
        authority !== null ||
        transition.beforeState?.kind !== "pending_external" ||
        transition.afterState.kind !== "external_terminal" ||
        (transition.beforeState?.kind === "pending_external" &&
          (!sameValue(attribution, transition.beforeState.requestAttribution) ||
            transition.operation !== transition.beforeState.operation))
      ) {
        addIssue(
          context,
          ["mode"],
          "Provider result terminalizes only the exact pending app request attribution without a second route consumption."
        );
      }
      break;
  }

  if (
    attribution.appActor?.kind === "employee" &&
    attribution.automationCausation !== null
  ) {
    addIssue(
      context,
      ["automationCausation"],
      "Direct Employee reaction action cannot claim automation causation."
    );
  }
  if (
    attribution.appActor?.kind === "trusted_service" &&
    attribution.automationCausation === null
  ) {
    addIssue(
      context,
      ["automationCausation"],
      "Trusted-service reaction action requires explicit automation causation."
    );
  }
  if (
    authority !== null &&
    (!sameValue(
      authority.adapterContract,
      authority.capabilityFence.adapterContract
    ) ||
      Date.parse(authority.capabilityFence.evaluatedAt) >
        Date.parse(transition.occurredAt) ||
      Date.parse(authority.capabilityFence.notAfter) <
        Date.parse(transition.occurredAt) ||
      Date.parse(authority.adapterContract.loadedAt) >
        Date.parse(transition.occurredAt))
  ) {
    addIssue(
      context,
      ["externalAuthority", "capabilityFence"],
      "External reaction uses the same loaded adapter and a supported capability fence current at action time."
    );
  }
}

function addTransitionStateIssues(
  context: z.RefinementCtx,
  transition: z.infer<typeof inboxV2MessageReactionTransitionSchema>
): void {
  const before = transition.beforeState;
  const after = transition.afterState;
  const afterDesired = reactionDesiredStateOf(after);
  const confirmingRequest =
    transition.mode === "provider_observed" &&
    (before?.kind === "pending_external" ||
      (before?.kind === "external_terminal" &&
        before.outcome === "outcome_unknown"));

  if (transition.mode === "provider_result") {
    if (
      before?.kind !== "pending_external" ||
      after.kind !== "external_terminal" ||
      (before?.kind === "pending_external" &&
        after.kind === "external_terminal" &&
        (after.operation !== before.operation ||
          !sameValue(after.desired, before.desired) ||
          !sameValue(after.confirmedState, before.confirmedBefore) ||
          after.outboundRoute.id !== before.outboundRoute.id ||
          after.requestTransition.id !== before.requestTransition.id ||
          after.resolvedAt !== transition.recordedAt))
    ) {
      addIssue(
        context,
        ["afterState"],
        "Provider result terminalizes the exact pending request while preserving its last confirmed canonical state."
      );
    }
    return;
  }

  if (transition.mode === "external_request") {
    const confirmedBefore = reactionConfirmedStateOf(before);
    if (
      after.kind !== "pending_external" ||
      (after.kind === "pending_external" &&
        !sameValue(after.confirmedBefore, confirmedBefore))
    ) {
      addIssue(
        context,
        ["afterState", "confirmedBefore"],
        "Pending request preserves the exact previously confirmed provider state."
      );
    }
  }

  if (confirmingRequest) {
    if (
      before?.operation !== transition.operation ||
      !sameValue(before?.desired, afterDesired)
    ) {
      addIssue(
        context,
        ["afterState"],
        "Provider confirmation may canonicalize only the exact pending desired operation/state."
      );
    }
  } else if (transition.operation === "set") {
    const beforeConfirmed = reactionConfirmedStateOf(before);
    if (
      (beforeConfirmed !== null && beforeConfirmed.kind !== "cleared") ||
      afterDesired.kind !== "active"
    ) {
      addIssue(
        context,
        ["afterState"],
        "Reaction set opens or reactivates one cleared semantic slot with an active value."
      );
    }
  } else if (transition.operation === "replace") {
    const beforeDesired = reactionConfirmedStateOf(before);
    if (
      beforeDesired?.kind !== "active" ||
      afterDesired.kind !== "active" ||
      sameValue(beforeDesired.value, afterDesired.value)
    ) {
      addIssue(
        context,
        ["afterState"],
        "Reaction replace changes one existing active single-value slot."
      );
    }
  } else {
    const beforeDesired = reactionConfirmedStateOf(before);
    if (
      beforeDesired?.kind !== "active" ||
      afterDesired.kind !== "cleared" ||
      !sameValue(beforeDesired.value, afterDesired.lastValue)
    ) {
      addIssue(
        context,
        ["afterState"],
        "Reaction clear retains the exact current value as its desired/canonical tombstone."
      );
    }
  }

  if (after.kind === "cleared" && after.clearedAt !== transition.recordedAt) {
    addIssue(
      context,
      ["afterState", "clearedAt"],
      "Canonical reaction clear time equals transition record time."
    );
  }
}

function addReactionCommitIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageReactionCommitSchema>
): void {
  const { transition, beforeReaction, afterReaction } = commit;
  if (
    commit.tenantId !== transition.tenantId ||
    commit.tenantId !== afterReaction.tenantId ||
    afterReaction.id !== transition.reaction.id ||
    afterReaction.message.id !== commit.beforeMessage.id ||
    afterReaction.semanticSlotKey !== transition.semanticSlotKey ||
    afterReaction.revision !== transition.resultingRevision ||
    !sameValue(afterReaction.state, transition.afterState) ||
    afterReaction.updatedAt !== transition.recordedAt
  ) {
    addIssue(
      context,
      ["afterReaction"],
      "Reaction commit binds one exact Message slot and transition result."
    );
  }
  const creating = transition.expectedRevision === null;
  if (
    creating
      ? beforeReaction !== null ||
        transition.beforeState !== null ||
        afterReaction.createdAt !== transition.recordedAt
      : beforeReaction === null ||
        beforeReaction.id !== afterReaction.id ||
        beforeReaction.revision !== transition.expectedRevision ||
        !sameValue(beforeReaction.state, transition.beforeState) ||
        !sameValue(
          reactionImmutableFacts(beforeReaction),
          reactionImmutableFacts(afterReaction)
        ) ||
        Date.parse(beforeReaction.updatedAt) > Date.parse(transition.recordedAt)
  ) {
    addIssue(
      context,
      ["beforeReaction"],
      "Reaction CAS creates or advances one exact immutable semantic slot."
    );
  }
  if (
    transition.operation === "replace" &&
    (afterReaction.capability.kind !== "external" ||
      afterReaction.capability.cardinality !== "single_value")
  ) {
    addIssue(
      context,
      ["transition", "operation"],
      "Replace is reserved for a pinned single-value provider reaction slot."
    );
  }
  const external = afterReaction.capability.kind === "external";
  const requiresExternalAuthority =
    external && transition.mode !== "provider_result";
  if (
    requiresExternalAuthority !== (transition.externalAuthority !== null) ||
    (transition.mode === "internal_apply") !== !external
  ) {
    addIssue(
      context,
      ["transition", "externalAuthority"],
      "External request/observation requires transport authority; terminal provider result uses its exact result proof instead."
    );
  }
  if (
    afterReaction.capability.kind === "external" &&
    transition.externalAuthority !== null &&
    (!sameValue(
      afterReaction.capability.adapterContract,
      transition.externalAuthority.adapterContract
    ) ||
      afterReaction.capability.capabilityId !==
        transition.externalAuthority.capabilityFence.capabilityId ||
      afterReaction.capability.capabilityRevision !==
        transition.externalAuthority.capabilityFence.capabilityRevision ||
      !sameValue(
        afterReaction.capability.adapterContract,
        transition.externalAuthority.capabilityFence.adapterContract
      ))
  ) {
    addIssue(
      context,
      ["transition", "externalAuthority", "adapterContract"],
      "External reaction capability, authority and current supported fence must match exactly."
    );
  }
}

function addReactionEvidenceIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageReactionCommitSchema>
): void {
  const { transition, afterReaction, beforeMessage, beforeTimelineItem } =
    commit;
  const requiredParticipantIds = new Set<string>();
  if (afterReaction.actor.kind === "participant") {
    requiredParticipantIds.add(afterReaction.actor.participant.id);
  }
  if (transition.actionAttribution.actionParticipant !== null) {
    requiredParticipantIds.add(
      transition.actionAttribution.actionParticipant.id
    );
  }
  const suppliedParticipantIds = new Set<string>();
  for (const [index, participant] of commit.participantSnapshots.entries()) {
    if (
      suppliedParticipantIds.has(participant.id) ||
      !requiredParticipantIds.has(participant.id) ||
      participant.tenantId !== commit.tenantId ||
      participant.conversation.id !== beforeMessage.conversation.id
    ) {
      addIssue(
        context,
        ["participantSnapshots", index],
        "Reaction evidence contains each required participant exactly once in the target Conversation."
      );
    }
    suppliedParticipantIds.add(participant.id);
  }
  if (
    suppliedParticipantIds.size !== requiredParticipantIds.size ||
    [...requiredParticipantIds].some(
      (participantId) => !suppliedParticipantIds.has(participantId)
    )
  ) {
    addIssue(
      context,
      ["participantSnapshots"],
      "Reaction participant references require bounded ConversationParticipant snapshots."
    );
  }

  const actionParticipant =
    transition.actionAttribution.actionParticipant === null
      ? null
      : (commit.participantSnapshots.find(
          (participant) =>
            participant.id ===
            transition.actionAttribution.actionParticipant?.id
        ) ?? null);
  const reactionActorParticipantId =
    afterReaction.actor.kind === "participant"
      ? afterReaction.actor.participant.id
      : null;
  if (
    transition.actionAttribution.appActor?.kind === "employee" &&
    (actionParticipant?.subject.kind !== "employee" ||
      actionParticipant.subject.employee.id !==
        transition.actionAttribution.appActor.employee.id)
  ) {
    addIssue(
      context,
      ["participantSnapshots"],
      "Employee reaction attribution must use the same Employee participant in the Conversation."
    );
  }
  if (
    transition.actionAttribution.appActor?.kind === "trusted_service" &&
    (actionParticipant?.subject.kind !== "bot" ||
      transition.actionAttribution.automationCausation === null)
  ) {
    addIssue(
      context,
      ["participantSnapshots"],
      "Trusted-service reaction attribution requires an exact bot participant and automation causation."
    );
  }
  if (
    transition.actionAttribution.appActor !== null &&
    (reactionActorParticipantId === null ||
      transition.actionAttribution.actionParticipant?.id !==
        reactionActorParticipantId)
  ) {
    addIssue(
      context,
      ["afterReaction", "actor"],
      "App-authored reaction slot actor and action participant must be the same Employee/bot Conversation participant."
    );
  }

  const authority = transition.externalAuthority;
  const evidence = commit.externalAuthorityEvidence;
  const external = afterReaction.capability.kind === "external";
  if (transition.mode === "provider_result") {
    if (
      evidence !== null ||
      authority !== null ||
      commit.outboundBindingSnapshot !== null ||
      commit.routeConsumption !== null ||
      commit.providerObservation !== null
    ) {
      addIssue(
        context,
        ["externalAuthorityEvidence"],
        "Provider result reuses no route/binding/occurrence; its immutable result proof closes the already-consumed request."
      );
    }
    return;
  }
  if (external !== (evidence !== null) || external !== (authority !== null)) {
    addIssue(
      context,
      ["externalAuthorityEvidence"],
      "External reaction commit requires exact transport induction evidence; internal reaction has none."
    );
    return;
  }
  if (!external || evidence === null || authority === null) {
    if (
      transition.mode !== "internal_apply" ||
      transition.actionAttribution.sourceOccurrence !== null ||
      transition.actionAttribution.appActor === null ||
      commit.providerObservation !== null ||
      commit.outboundBindingSnapshot !== null ||
      commit.routeConsumption !== null
    ) {
      addIssue(
        context,
        ["transition", "actionAttribution"],
        "Internal reaction is app-authored and has no source occurrence."
      );
    }
    return;
  }

  const { externalMessageReference, sourceOccurrence, outboundRoute } =
    evidence;
  if (
    externalMessageReference.tenantId !== commit.tenantId ||
    sourceOccurrence.tenantId !== commit.tenantId ||
    externalMessageReference.id !== authority.externalMessageReference.id ||
    externalMessageReference.message.id !== beforeMessage.id ||
    externalMessageReference.timelineItem.id !== beforeTimelineItem.id ||
    sourceOccurrence.id !== authority.sourceOccurrence.id ||
    sourceOccurrence.resolution.state !== "resolved" ||
    sourceOccurrence.resolution.externalMessageReference.id !==
      externalMessageReference.id ||
    !sameValue(sourceOccurrence.messageKey, externalMessageReference.key) ||
    sourceOccurrence.bindingContext.sourceAccount.id !==
      authority.sourceAccount.id ||
    sourceOccurrence.bindingContext.sourceThreadBinding.id !==
      authority.sourceThreadBinding.id ||
    sourceOccurrence.bindingContext.bindingGeneration !==
      authority.bindingGeneration ||
    !sameValue(
      sourceOccurrence.descriptor.adapterContract,
      authority.adapterContract
    ) ||
    !sameValue(
      authority.capabilityFence.adapterContract,
      authority.adapterContract
    )
  ) {
    addIssue(
      context,
      ["externalAuthorityEvidence"],
      "External reaction evidence must resolve the target Message and exact account, binding and generation."
    );
  }

  if (transition.mode === "provider_observed") {
    if (
      authority.outboundRoute !== null ||
      outboundRoute !== null ||
      commit.outboundBindingSnapshot !== null ||
      commit.routeConsumption !== null ||
      transition.actionAttribution.sourceOccurrence?.id !== sourceOccurrence.id
    ) {
      addIssue(
        context,
        ["externalAuthorityEvidence", "outboundRoute"],
        "Provider-observed reaction uses its exact occurrence and no Hulee route."
      );
    }
    return;
  }
  addRequestedReactionRouteIssues(context, commit, authority, evidence);
}

function addRequestedReactionRouteIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageReactionCommitSchema>,
  authority: z.infer<typeof inboxV2ExternalReactionAuthoritySchema>,
  evidence: NonNullable<
    z.infer<
      typeof inboxV2MessageReactionCommitSchema
    >["externalAuthorityEvidence"]
  >
): void {
  const { transition, beforeMessage } = commit;
  const route = evidence.outboundRoute;
  const binding = commit.outboundBindingSnapshot;
  const consumption = commit.routeConsumption;
  const expected = expectedReactionRouteAuthority(transition.operation);
  const referenceContext = route?.referenceContext;
  const selectionIntent = route?.selection.intent;
  if (
    transition.mode !== "external_request" ||
    authority.outboundRoute === null ||
    route === null ||
    binding === null ||
    consumption === null ||
    authority.outboundRoute.id !== route.id ||
    route.tenantId !== commit.tenantId ||
    route.conversation.id !== beforeMessage.conversation.id ||
    route.sourceAccount.id !== authority.sourceAccount.id ||
    route.sourceThreadBinding.id !== authority.sourceThreadBinding.id ||
    route.bindingFence.bindingGeneration !== authority.bindingGeneration ||
    !sameValue(route.adapterContract, authority.adapterContract) ||
    route.operationId !== expected.operationId ||
    route.requiredConversationPermissionId !== expected.permissionId ||
    referenceContext?.kind !== "external_message" ||
    (referenceContext?.kind === "external_message" &&
      (referenceContext.externalMessageReference.id !==
        authority.externalMessageReference.id ||
        referenceContext.sourceOccurrence.id !==
          authority.sourceOccurrence.id ||
        Date.parse(referenceContext.resolutionDecision.notAfter) <
          Date.parse(transition.occurredAt))) ||
    selectionIntent?.kind !== "explicit_occurrence" ||
    (selectionIntent?.kind === "explicit_occurrence" &&
      selectionIntent.occurrence.id !== authority.sourceOccurrence.id) ||
    route.selection.reason !== "explicit_occurrence" ||
    !sameAppPrincipal(route.principal, transition.actionAttribution.appActor) ||
    transition.actionAttribution.sourceOccurrence !== null ||
    Date.parse(route.createdAt) > Date.parse(transition.occurredAt) ||
    Date.parse(route.conversationAuthorization.notAfter) <
      Date.parse(transition.occurredAt) ||
    Date.parse(route.sourceAccountAuthorization.notAfter) <
      Date.parse(transition.occurredAt) ||
    Date.parse(route.selection.candidateSnapshotNotAfter) <
      Date.parse(transition.occurredAt) ||
    !outboundBindingSupportsReaction(
      binding,
      route,
      commit.afterReaction,
      transition.occurredAt
    ) ||
    consumption.tenantId !== commit.tenantId ||
    consumption.outboundRoute.tenantId !== commit.tenantId ||
    consumption.transition.tenantId !== commit.tenantId ||
    consumption.reaction.tenantId !== commit.tenantId ||
    consumption.outboundRoute.id !== route.id ||
    consumption.transition.id !== transition.id ||
    consumption.reaction.id !== commit.afterReaction.id ||
    consumption.semanticSlotKey !== transition.semanticSlotKey ||
    consumption.mutationToken !== route.mutationToken ||
    consumption.idempotencyToken !== route.idempotencyToken ||
    consumption.correlationToken !== route.correlationToken ||
    consumption.consumedAt !== transition.recordedAt ||
    consumption.consumedByTrustedServiceId !==
      route.adapterContract.loadedByTrustedServiceId
  ) {
    addIssue(
      context,
      ["externalAuthorityEvidence", "outboundRoute"],
      "Requested reaction requires the exact original explicit-occurrence route, action-specific operation/permission and current capability fence; fallback routing is forbidden."
    );
  }
}

function outboundBindingSupportsReaction(
  binding: z.infer<typeof inboxV2SourceThreadBindingSchema>,
  route: z.infer<typeof inboxV2OutboundRouteSchema>,
  reaction: z.infer<typeof inboxV2MessageReactionSchema>,
  requestedAt: string
): boolean {
  if (reaction.capability.kind !== "external") {
    return false;
  }
  const reactionCapability = reaction.capability;
  const fence = route.bindingFence;
  const capability = binding.capabilities.entries.find(
    (entry) =>
      entry.capabilityId === reactionCapability.capabilityId &&
      entry.operationId === route.operationId &&
      entry.contentKindId === route.contentKindId &&
      entry.state === "supported" &&
      (entry.validUntil === null ||
        Date.parse(entry.validUntil) >= Date.parse(requestedAt)) &&
      entry.requiredProviderRoleIds.every((roleId) =>
        binding.providerAccess.roleIds.includes(roleId)
      )
  );
  return (
    binding.tenantId === route.tenantId &&
    binding.id === route.sourceThreadBinding.id &&
    binding.externalThread.id === route.externalThread.id &&
    binding.sourceAccount.id === route.sourceAccount.id &&
    binding.sourceConnection.id === route.sourceConnection.id &&
    binding.accountIdentitySnapshot.accountGeneration ===
      fence.accountGeneration &&
    binding.bindingGeneration === fence.bindingGeneration &&
    binding.remoteAccess.revision === fence.remoteAccessRevision &&
    binding.administrative.revision === fence.administrativeRevision &&
    binding.capabilities.revision === fence.capabilityRevision &&
    reactionCapability.capabilityRevision === binding.capabilities.revision &&
    binding.routeDescriptor.descriptorRevision ===
      fence.routeDescriptorRevision &&
    sameValue(binding.capabilities.adapterContract, route.adapterContract) &&
    sameValue(binding.routeDescriptor, route.routeDescriptor) &&
    binding.remoteAccess.state === "active" &&
    binding.administrative.state === "enabled" &&
    binding.runtimeHealth.state === "ready" &&
    Date.parse(binding.updatedAt) <= Date.parse(requestedAt) &&
    Date.parse(binding.capabilities.capturedAt) <= Date.parse(requestedAt) &&
    capability !== undefined
  );
}

function addProviderObservationIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageReactionCommitSchema>
): void {
  const providerObserved = commit.transition.mode === "provider_observed";
  const observation = commit.providerObservation;
  if (providerObserved !== (observation !== null)) {
    addIssue(
      context,
      ["providerObservation"],
      "Only provider-observed reaction apply carries semantic proof and ordering CAS."
    );
    return;
  }
  if (!providerObserved || observation === null) {
    return;
  }
  const evidence = commit.externalAuthorityEvidence;
  const authority = commit.transition.externalAuthority;
  const capability = commit.afterReaction.capability;
  if (
    evidence === null ||
    authority === null ||
    capability.kind !== "external"
  ) {
    return;
  }
  const occurrence = evidence.sourceOccurrence;
  const proof = observation.semanticProof;
  const ordering = observation.orderingCommit;
  const normalizedEvent =
    occurrence.origin.kind === "provider_response"
      ? null
      : occurrence.origin.normalizedInboundEvent;
  const providerIdentity =
    occurrence.providerActor?.kind === "source_external_identity"
      ? occurrence.providerActor.sourceExternalIdentity
      : null;
  const preservesPendingAppActor =
    commit.beforeReaction?.state.kind === "pending_external" ||
    (commit.beforeReaction?.state.kind === "external_terminal" &&
      commit.beforeReaction.state.outcome === "outcome_unknown");
  if (observation.providerActorParticipant !== null) {
    addTenantReferenceIssue(
      context,
      commit.tenantId,
      observation.providerActorParticipant,
      ["providerObservation", "providerActorParticipant"]
    );
  }
  if (
    proof.tenantId !== commit.tenantId ||
    proof.externalMessageReference?.id !==
      evidence.externalMessageReference.id ||
    proof.sourceOccurrence?.id !== occurrence.id ||
    proof.sourceAccount.id !== authority.sourceAccount.id ||
    proof.sourceThreadBinding.id !== authority.sourceThreadBinding.id ||
    proof.bindingGeneration !== authority.bindingGeneration ||
    !sameValue(proof.adapterContract, authority.adapterContract) ||
    proof.capabilityId !== capability.capabilityId ||
    proof.capabilityRevision !== capability.capabilityRevision ||
    proof.semanticId !==
      `core:message.reaction.${commit.transition.operation}` ||
    normalizedEvent === null ||
    proof.normalizedInboundEvent.id !== normalizedEvent?.id ||
    proof.occurredAt !== commit.transition.occurredAt ||
    Date.parse(proof.recordedAt) > Date.parse(commit.transition.recordedAt) ||
    (!preservesPendingAppActor && !sameValue(proof.actor, providerIdentity)) ||
    !sameValue(observation.normalizedState, commit.transition.afterState) ||
    !sameValue(ordering.proof, proof) ||
    ordering.tenantId !== commit.tenantId ||
    ordering.semanticFamilyId !== "core:message.reaction" ||
    ordering.committedAt !== commit.transition.recordedAt
  ) {
    addIssue(
      context,
      ["providerObservation"],
      "Provider reaction apply requires one exact trusted semantic proof, normalized state and monotonic reaction-family ordering CAS."
    );
  }
  addProviderReactionActorIssues(context, commit, occurrence, proof.actor);
}

function addProviderReactionActorIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageReactionCommitSchema>,
  occurrence: z.infer<typeof inboxV2SourceOccurrenceSchema>,
  proofActor: z.infer<typeof inboxV2ProviderSemanticProofSchema>["actor"]
): void {
  const actor = commit.afterReaction.actor;
  const actionParticipant =
    commit.transition.actionAttribution.actionParticipant;
  const providerActor = occurrence.providerActor;
  const observation = commit.providerObservation;
  const providerParticipantReference =
    observation?.providerActorParticipant ?? null;
  const providerParticipant =
    providerParticipantReference === null
      ? null
      : (commit.participantSnapshots.find(
          (candidate) => candidate.id === providerParticipantReference.id
        ) ?? null);
  const occurrenceSourceIdentity =
    providerActor?.kind === "source_external_identity"
      ? providerActor.sourceExternalIdentity
      : null;
  const exactSourceIdentity = proofActor ?? occurrenceSourceIdentity;
  const sourceIdentityPlanesConflict =
    proofActor !== null &&
    occurrenceSourceIdentity !== null &&
    proofActor.id !== occurrenceSourceIdentity.id;
  const beforeState = commit.beforeReaction?.state;
  const preservesAppActor =
    beforeState?.kind === "pending_external" ||
    (beforeState?.kind === "external_terminal" &&
      beforeState.outcome === "outcome_unknown");

  if (preservesAppActor) {
    if (
      !sameValue(actor, commit.beforeReaction?.actor) ||
      sourceIdentityPlanesConflict ||
      (exactSourceIdentity === null
        ? providerParticipantReference !== null || actionParticipant !== null
        : providerParticipant?.subject.kind !== "source_external_identity" ||
          providerParticipant.subject.sourceExternalIdentity.id !==
            exactSourceIdentity.id ||
          actionParticipant?.id !== providerParticipantReference?.id)
    ) {
      addIssue(
        context,
        ["afterReaction", "actor"],
        "Provider confirmation preserves the pending Employee/bot slot actor while mapping any known provider actor only in proof/action-participant planes."
      );
    }
    return;
  }

  if (providerActor?.kind === "source_external_identity") {
    const slotParticipant =
      actor.kind === "participant"
        ? commit.participantSnapshots.find(
            (candidate) => candidate.id === actor.participant.id
          )
        : undefined;
    if (
      sourceIdentityPlanesConflict ||
      proofActor?.id !== providerActor.sourceExternalIdentity.id ||
      actor.kind !== "participant" ||
      slotParticipant?.subject.kind !== "source_external_identity" ||
      slotParticipant.subject.sourceExternalIdentity.id !==
        providerActor.sourceExternalIdentity.id ||
      providerParticipantReference?.id !== actor.participant.id ||
      actionParticipant?.id !== actor.participant.id
    ) {
      addIssue(
        context,
        ["afterReaction", "actor"],
        "Native provider reaction keeps one exact source identity across occurrence, proof, provider actor participant, slot and action planes."
      );
    }
    return;
  }
  if (providerActor?.kind === "provider_system") {
    if (
      actor.kind !== "provider_system" ||
      actor.sourceOccurrence.id !== occurrence.id ||
      actor.actorKindId !== providerActor.actorKindId ||
      actor.actorSubject !== providerActor.actorSubject ||
      proofActor !== null ||
      providerParticipantReference !== null ||
      actionParticipant !== null
    ) {
      addIssue(
        context,
        ["afterReaction", "actor"],
        "Known provider-system actor must remain exact and cannot be downgraded to aggregate/unattributed evidence."
      );
    }
    return;
  }

  const sourceOccurrenceMatches =
    actor.kind !== "participant" && actor.sourceOccurrence.id === occurrence.id;
  if (
    !sourceOccurrenceMatches ||
    actor.kind === "provider_system" ||
    proofActor !== null ||
    providerParticipantReference !== null ||
    actionParticipant !== null
  ) {
    addIssue(
      context,
      ["afterReaction", "actor"],
      "Actorless provider reaction remains explicitly unattributed/aggregate with its exact occurrence."
    );
  }
}

function addProviderResultIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageReactionCommitSchema>
): void {
  const providerResult = commit.transition.mode === "provider_result";
  const proof = commit.providerResultProof;
  if (providerResult !== (proof !== null)) {
    addIssue(
      context,
      ["providerResultProof"],
      "Only a provider-result transition carries one exact trusted terminal result proof."
    );
    return;
  }
  if (!providerResult || proof === null) {
    return;
  }
  const before = commit.beforeReaction?.state;
  const after = commit.afterReaction.state;
  const capability = commit.afterReaction.capability;
  if (
    before?.kind !== "pending_external" ||
    after.kind !== "external_terminal" ||
    capability.kind !== "external" ||
    proof.tenantId !== commit.tenantId ||
    proof.operation.kind !== "message_reaction_transition" ||
    proof.operation.id !== before.requestTransition.id ||
    proof.outboundRoute.id !== before.outboundRoute.id ||
    !sameValue(proof.adapterContract, capability.adapterContract) ||
    proof.capabilityId !== capability.capabilityId ||
    proof.capabilityRevision !== capability.capabilityRevision ||
    proof.semanticId !== `core:message.reaction.${before.operation}.result` ||
    proof.resultState !== after.outcome ||
    proof.resultToken !== after.resultToken ||
    proof.resultDigestSha256 !== after.resultDigestSha256 ||
    proof.recordedAt !== commit.transition.recordedAt ||
    after.resolvedAt !== commit.transition.recordedAt
  ) {
    addIssue(
      context,
      ["providerResultProof"],
      "Terminal reaction result must exactly close the pending transition/route/capability with failed, unsupported or outcome_unknown provider truth."
    );
  }
}

function addReactionHeadIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageReactionCommitSchema>
): void {
  const { transition, beforeReaction, afterReaction } = commit;
  const slotBefore = commit.slotHeadBefore;
  const slotAfter = commit.slotHeadAfter;
  if (
    slotAfter.tenantId !== commit.tenantId ||
    slotAfter.message.id !== commit.beforeMessage.id ||
    slotAfter.semanticSlotKey !== transition.semanticSlotKey ||
    slotAfter.reaction.id !== afterReaction.id ||
    slotAfter.revision !== afterReaction.revision ||
    !sameValue(slotAfter.state, afterReaction.state) ||
    slotAfter.updatedAt !== transition.recordedAt
  ) {
    addIssue(
      context,
      ["slotHeadAfter"],
      "Reaction slot CAS head materializes the exact deterministic slot result."
    );
  }
  if (
    beforeReaction === null
      ? slotBefore !== null
      : slotBefore === null ||
        slotBefore.tenantId !== commit.tenantId ||
        slotBefore.message.id !== commit.beforeMessage.id ||
        slotBefore.semanticSlotKey !== beforeReaction.semanticSlotKey ||
        slotBefore.reaction.id !== beforeReaction.id ||
        slotBefore.revision !== beforeReaction.revision ||
        !sameValue(slotBefore.state, beforeReaction.state) ||
        slotBefore.updatedAt !== beforeReaction.updatedAt ||
        BigInt(slotAfter.revision) !== BigInt(slotBefore.revision) + 1n
  ) {
    addIssue(
      context,
      ["slotHeadBefore"],
      "Reaction slot head proves absence for create or the exact current slot revision for update."
    );
  }
}

function addReactionTargetProofIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageReactionCommitSchema>
): void {
  const message = commit.beforeMessage;
  const timelineItem = commit.beforeTimelineItem;
  if (
    message.tenantId !== commit.tenantId ||
    timelineItem.tenantId !== commit.tenantId ||
    timelineItem.id !== message.timelineItem.id ||
    timelineItem.conversation.id !== message.conversation.id ||
    timelineItem.subject.kind !== "message" ||
    timelineItem.subject.message.id !== message.id ||
    timelineItem.subject.messageRevision !== message.revision ||
    commit.afterReaction.message.id !== message.id ||
    Date.parse(message.updatedAt) > Date.parse(commit.transition.recordedAt) ||
    Date.parse(timelineItem.updatedAt) >
      Date.parse(commit.transition.recordedAt)
  ) {
    addIssue(
      context,
      ["beforeMessage"],
      "Reaction uses immutable bounded Message/Timeline target proof without mutating either hot row."
    );
  }
}

function addActionTenantIssues(
  context: z.RefinementCtx,
  transition: z.infer<typeof inboxV2MessageReactionTransitionSchema>
): void {
  const attribution = transition.actionAttribution;
  addAttributionTenantIssues(context, transition.tenantId, attribution, [
    "actionAttribution"
  ]);
  for (const [field, state] of [
    ["beforeState", transition.beforeState],
    ["afterState", transition.afterState]
  ] as const) {
    if (
      state?.kind === "pending_external" ||
      state?.kind === "external_terminal"
    ) {
      for (const [stateField, reference] of [
        ["outboundRoute", state.outboundRoute],
        ["requestTransition", state.requestTransition]
      ] as const) {
        addTenantReferenceIssue(context, transition.tenantId, reference, [
          field,
          stateField
        ]);
      }
      if (state.kind === "pending_external") {
        addAttributionTenantIssues(
          context,
          transition.tenantId,
          state.requestAttribution,
          [field, "requestAttribution"]
        );
      }
    }
  }
}

function addAttributionTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  attribution: z.infer<typeof inboxV2MessageActionAttributionSchema>,
  path: PropertyKey[]
): void {
  if (attribution.actionParticipant !== null) {
    addTenantReferenceIssue(context, tenantId, attribution.actionParticipant, [
      ...path,
      "actionParticipant"
    ]);
  }
  if (attribution.appActor?.kind === "employee") {
    addTenantReferenceIssue(context, tenantId, attribution.appActor.employee, [
      ...path,
      "appActor",
      "employee"
    ]);
  }
  if (attribution.sourceOccurrence !== null) {
    addTenantReferenceIssue(context, tenantId, attribution.sourceOccurrence, [
      ...path,
      "sourceOccurrence"
    ]);
  }
  if (attribution.automationCausation !== null) {
    addTenantReferenceIssue(
      context,
      tenantId,
      attribution.automationCausation.causeEvent,
      [...path, "automationCausation", "causeEvent"]
    );
    if (attribution.automationCausation.kind === "employee_command") {
      addTenantReferenceIssue(
        context,
        tenantId,
        attribution.automationCausation.initiatingActor.employee,
        [...path, "automationCausation", "initiatingActor", "employee"]
      );
    }
  }
}

function reactionImmutableFacts(
  reaction: z.infer<typeof inboxV2MessageReactionSchema>
): unknown {
  const {
    state: _state,
    revision: _revision,
    updatedAt: _updatedAt,
    ...facts
  } = reaction;
  return facts;
}

export function inboxV2ReactionSemanticSlotKeyFor(input: {
  message: z.input<typeof inboxV2MessageReferenceSchema>;
  actor: z.input<typeof inboxV2ReactionActorSchema>;
  capability: z.input<typeof inboxV2ReactionCapabilitySchema>;
  state: z.input<typeof inboxV2ReactionStateSchema>;
}): string {
  const actorKey =
    input.actor.kind === "participant"
      ? encodeSlotSegments(["participant", input.actor.participant.id])
      : input.actor.kind === "unattributed_source_observation"
        ? encodeSlotSegments(["unattributed", input.actor.opaqueActorKey])
        : input.actor.kind === "aggregate_only"
          ? encodeSlotSegments(["aggregate", input.actor.aggregateScope])
          : encodeSlotSegments([
              "provider_system",
              input.actor.actorKindId,
              input.actor.actorSubject
            ]);
  const capabilityKey =
    input.capability.kind === "internal"
      ? "internal"
      : encodeSlotSegments(["external", input.capability.capabilityId]);
  const cardinality = input.capability.cardinality;
  const valueKey =
    cardinality === "multiple_values"
      ? reactionValueSlotKey(reactionValueOfState(input.state))
      : "single-lane";
  return `v1:${encodeSlotSegments([
    input.message.id,
    actorKey,
    capabilityKey,
    valueKey
  ])}`;
}

function reactionDesiredStateOf(
  state: z.input<typeof inboxV2ReactionStateSchema>
): z.input<typeof inboxV2ReactionDesiredStateSchema> {
  if (state.kind === "pending_external" || state.kind === "external_terminal") {
    return state.desired;
  }
  return state.kind === "active"
    ? { kind: "active", value: state.value }
    : { kind: "cleared", lastValue: state.lastValue };
}

function reactionConfirmedStateOf(
  state: z.input<typeof inboxV2ReactionStateSchema> | null
): z.input<typeof inboxV2ReactionCanonicalStateSchema> | null {
  if (state === null) {
    return null;
  }
  if (state.kind === "pending_external") {
    return state.confirmedBefore;
  }
  if (state.kind === "external_terminal") {
    return state.confirmedState;
  }
  return state;
}

function reactionValueOfState(
  state: z.input<typeof inboxV2ReactionStateSchema>
): z.input<typeof inboxV2ReactionValueSchema> {
  const desired = reactionDesiredStateOf(state);
  return desired.kind === "active" ? desired.value : desired.lastValue;
}

function reactionValueSlotKey(
  value: z.input<typeof inboxV2ReactionValueSchema>
): string {
  return value.kind === "unicode"
    ? encodeSlotSegments(["unicode", value.value])
    : encodeSlotSegments([
        "provider_custom",
        value.providerKindId,
        value.canonicalCode
      ]);
}

function encodeSlotSegments(segments: readonly string[]): string {
  return segments.map((segment) => `${segment.length}:${segment}`).join("");
}

function expectedReactionRouteAuthority(
  operation: "set" | "replace" | "clear"
) {
  return {
    operationId: `core:message.reaction.${operation}`,
    permissionId: `core:message.reaction.${operation}_external`
  };
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(context, path, "Reaction references must share one tenant.");
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameAppPrincipal(
  principal: z.infer<typeof inboxV2OutboundRouteSchema>["principal"],
  actor: z.infer<typeof inboxV2MessageActionAttributionSchema>["appActor"]
): boolean {
  if (actor === null || principal.kind !== actor.kind) {
    return false;
  }
  return principal.kind === "employee"
    ? actor.kind === "employee" && principal.employee.id === actor.employee.id
    : actor.kind === "trusted_service" &&
        principal.trustedServiceId === actor.trustedServiceId;
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function hasNoAsciiControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return false;
    }
  }
  return true;
}
