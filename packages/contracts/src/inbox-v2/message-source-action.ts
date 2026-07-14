import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ExternalMessageKeySchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2SourceOccurrenceResolutionCommitSchema,
  inboxV2SourceOccurrenceSchema,
  type InboxV2ExternalMessageReference,
  type InboxV2SourceOccurrence
} from "./external-message-reference";
import {
  inboxV2DeferredMessageSourceActionIdSchema,
  inboxV2DeferredMessageSourceActionReferenceSchema,
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2MessageReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2MessageMutationCommitSchema } from "./message-lifecycle";
import {
  inboxV2MessageProviderLifecycleOperationCreationCommitSchema,
  inboxV2MessageProviderLifecycleTransitionCommitSchema
} from "./message-provider-lifecycle";
import { inboxV2ReactionValueSchema } from "./message-reaction";
import { inboxV2MessageReactionCommitSchema } from "./message-reaction";
import { inboxV2MessageTransportFactCommitSchema } from "./message-transport";
import { inboxV2ProviderSemanticProofSchema } from "./provider-semantic-proof";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import { inboxV2RoutingTokenSchema } from "./source-routing-primitives";

export const INBOX_V2_DEFERRED_MESSAGE_SOURCE_ACTION_SCHEMA_ID =
  "core:inbox-v2.deferred-message-source-action" as const;
export const INBOX_V2_DEFERRED_MESSAGE_SOURCE_ACTION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.deferred-message-source-action-commit" as const;
export const INBOX_V2_MESSAGE_SOURCE_ACTION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2DeferredSourceActionReasonIdSchema = inboxV2CatalogIdSchema;

export const inboxV2DeferredSourceActionOrderingLaneSchema = z.enum([
  "message_lifecycle",
  "reaction",
  "delivery",
  "receipt"
]);

/** Stable replay identity; database uniqueness is over this complete tuple. */
export const inboxV2DeferredSourceActionIdempotencyKeySchema = z
  .object({
    normalizedInboundEvent: inboxV2NormalizedInboundEventReferenceSchema,
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    semanticId: inboxV2CatalogIdSchema,
    eventFingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();

export const inboxV2DeferredMessageSourceActionPayloadSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("edit"),
        normalizedEvent: inboxV2NormalizedInboundEventReferenceSchema,
        normalizedContentDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u)
      })
      .strict(),
    z
      .object({
        kind: z.literal("delete"),
        normalizedEvent: inboxV2NormalizedInboundEventReferenceSchema,
        reasonId: inboxV2DeferredSourceActionReasonIdSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("reaction"),
        operation: z.enum(["set", "replace", "clear"]),
        value: inboxV2ReactionValueSchema.nullable(),
        normalizedEvent: inboxV2NormalizedInboundEventReferenceSchema
      })
      .strict()
      .superRefine((action, context) => {
        if ((action.operation === "clear") !== (action.value === null)) {
          addIssue(
            context,
            ["value"],
            "Deferred reaction clear has no value; set/replace preserve one value."
          );
        }
      }),
    z
      .object({
        kind: z.literal("delivery"),
        fact: z.enum(["accepted", "sent", "delivered", "failed"]),
        normalizedEvent: inboxV2NormalizedInboundEventReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("receipt"),
        fact: z.literal("read"),
        scope: z.literal("exact_message"),
        normalizedEvent: inboxV2NormalizedInboundEventReferenceSchema
      })
      .strict()
  ]);

export const inboxV2DeferredMessageSourceActionEffectProofSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("message_lifecycle"),
        commit: inboxV2MessageMutationCommitSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("message_reaction"),
        commit: inboxV2MessageReactionCommitSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("message_transport_fact"),
        commit: inboxV2MessageTransportFactCommitSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_delete_retain_local"),
        operationCreationCommit:
          inboxV2MessageProviderLifecycleOperationCreationCommitSchema,
        policyTransitionCommit:
          inboxV2MessageProviderLifecycleTransitionCommitSchema
      })
      .strict()
  ]);

export const inboxV2DeferredSourceActionOrderingHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    externalMessageKey: inboxV2ExternalMessageKeySchema,
    lane: inboxV2DeferredSourceActionOrderingLaneSchema,
    scopeToken: inboxV2RoutingTokenSchema,
    comparatorId: inboxV2CatalogIdSchema,
    comparatorRevision: inboxV2EntityRevisionSchema,
    latest: z
      .object({
        action: inboxV2DeferredMessageSourceActionReferenceSchema,
        idempotencyKey: inboxV2DeferredSourceActionIdempotencyKeySchema,
        position: z.string().regex(/^(0|[1-9]\d*)$/u)
      })
      .strict(),
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    addMessageKeyTenantIssues(context, head.tenantId, head.externalMessageKey, [
      "externalMessageKey"
    ]);
    for (const [field, reference] of [
      ["action", head.latest.action],
      [
        "normalizedInboundEvent",
        head.latest.idempotencyKey.normalizedInboundEvent
      ],
      ["sourceOccurrence", head.latest.idempotencyKey.sourceOccurrence]
    ] as const) {
      addTenantReferenceIssue(context, head.tenantId, reference, [
        "latest",
        field
      ]);
    }
    if (!isInboxV2TimestampOrderValid(head.createdAt, head.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "Deferred source-action ordering head preserves creation/update chronology."
      );
    }
  });

export const inboxV2DeferredMessageSourceActionStateSchema =
  z.discriminatedUnion("state", [
    z.object({ state: z.literal("pending") }).strict(),
    z
      .object({
        state: z.literal("applied"),
        externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
        message: inboxV2MessageReferenceSchema,
        appliedMessageRevision: inboxV2EntityRevisionSchema,
        effectKind: z.enum([
          "message_lifecycle",
          "message_reaction",
          "message_transport_fact",
          "provider_delete_retain_local"
        ]),
        appliedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("target_conflicted"),
        candidates: z
          .array(inboxV2ExternalMessageReferenceSchema)
          .min(2)
          .max(100),
        reasonId: inboxV2DeferredSourceActionReasonIdSchema,
        conflictedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("stale"),
        headAction: inboxV2DeferredMessageSourceActionReferenceSchema,
        staleAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("duplicate"),
        canonicalAction: inboxV2DeferredMessageSourceActionReferenceSchema,
        duplicateAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("ordering_conflict"),
        conflictingAction:
          inboxV2DeferredMessageSourceActionReferenceSchema.nullable(),
        reasonId: inboxV2DeferredSourceActionReasonIdSchema,
        conflictedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("expired"),
        reasonId: inboxV2DeferredSourceActionReasonIdSchema,
        expiredAt: inboxV2TimestampSchema
      })
      .strict()
  ]);

/** Exact-key durable action; it has no fallback/latest-Message selector. */
export const inboxV2DeferredMessageSourceActionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2DeferredMessageSourceActionIdSchema,
    externalMessageKey: inboxV2ExternalMessageKeySchema,
    sourceOccurrence: inboxV2SourceOccurrenceSchema,
    action: inboxV2DeferredMessageSourceActionPayloadSchema,
    semanticProof: inboxV2ProviderSemanticProofSchema,
    idempotencyKey: inboxV2DeferredSourceActionIdempotencyKeySchema,
    state: inboxV2DeferredMessageSourceActionStateSchema,
    revision: inboxV2EntityRevisionSchema,
    observedAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((action, context) => {
    addTenantReferenceIssue(
      context,
      action.tenantId,
      action.externalMessageKey.externalThread,
      ["externalMessageKey", "externalThread"]
    );
    if (action.externalMessageKey.scope.kind !== "provider_thread") {
      addTenantReferenceIssue(
        context,
        action.tenantId,
        action.externalMessageKey.scope.owner,
        ["externalMessageKey", "scope", "owner"]
      );
    }
    if (action.sourceOccurrence.tenantId !== action.tenantId) {
      addIssue(
        context,
        ["sourceOccurrence"],
        "Deferred source action must carry one full same-tenant SourceOccurrence."
      );
    }
    addTenantReferenceIssue(
      context,
      action.tenantId,
      action.action.normalizedEvent,
      ["action", "normalizedEvent"]
    );
    addDeferredInductionIssues(context, action);
    addDeferredStateTenantIssues(context, action);
    if (
      action.revision === "1" &&
      (action.state.state !== "pending" ||
        action.createdAt !== action.updatedAt)
    ) {
      addIssue(
        context,
        ["revision"],
        "Deferred source action starts pending at revision 1."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(action.observedAt, action.recordedAt) ||
      action.recordedAt !== action.createdAt ||
      !isInboxV2TimestampOrderValid(action.createdAt, action.updatedAt)
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "Deferred action preserves observed, recorded and updated order."
      );
    }
  });

export const inboxV2DeferredMessageSourceActionTransitionSchema = z
  .object({
    action: inboxV2DeferredMessageSourceActionReferenceSchema,
    expectedRevision: inboxV2EntityRevisionSchema,
    resultingRevision: inboxV2EntityRevisionSchema,
    afterState: inboxV2DeferredMessageSourceActionStateSchema,
    orderingOutcome: z.enum([
      "advance",
      "stale",
      "duplicate",
      "conflict",
      "not_evaluated"
    ]),
    expectedOrderingHeadRevision: inboxV2EntityRevisionSchema.nullable(),
    resultingOrderingHeadRevision: inboxV2EntityRevisionSchema.nullable(),
    recordedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((transition, context) => {
    if (
      BigInt(transition.resultingRevision) !==
        BigInt(transition.expectedRevision) + 1n ||
      transition.afterState.state === "pending"
    ) {
      addIssue(
        context,
        ["resultingRevision"],
        "Deferred action leaves pending through one exact CAS revision."
      );
    }
    const expectedOutcome = orderingOutcomeForState(transition.afterState);
    if (transition.orderingOutcome !== expectedOutcome) {
      addIssue(
        context,
        ["orderingOutcome"],
        "Deferred source-action terminal state must expose its exact ordering decision."
      );
    }
  });

export const inboxV2DeferredMessageSourceActionCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    before: inboxV2DeferredMessageSourceActionSchema,
    transition: inboxV2DeferredMessageSourceActionTransitionSchema,
    targetExternalMessageReference:
      inboxV2ExternalMessageReferenceSchema.nullable(),
    sourceOccurrenceResolution:
      inboxV2SourceOccurrenceResolutionCommitSchema.nullable(),
    effectProof: inboxV2DeferredMessageSourceActionEffectProofSchema.nullable(),
    beforeOrderingHead:
      inboxV2DeferredSourceActionOrderingHeadSchema.nullable(),
    afterOrderingHead: inboxV2DeferredSourceActionOrderingHeadSchema.nullable(),
    after: inboxV2DeferredMessageSourceActionSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const { before, transition, after } = commit;
    if (
      commit.tenantId !== before.tenantId ||
      commit.tenantId !== after.tenantId ||
      transition.action.tenantId !== commit.tenantId ||
      transition.action.id !== before.id ||
      before.id !== after.id ||
      before.state.state !== "pending" ||
      before.revision !== transition.expectedRevision ||
      after.revision !== transition.resultingRevision ||
      after.updatedAt !== transition.recordedAt ||
      !isInboxV2TimestampOrderValid(before.updatedAt, transition.recordedAt) ||
      !sameValue(after.state, transition.afterState) ||
      !sameValue(deferredIdentity(before), deferredIdentity(after))
    ) {
      addIssue(
        context,
        ["after"],
        "Deferred action CAS may change only resolution state and revision time."
      );
    }
    addTerminalTimestampIssues(context, transition);
    addOrderingCommitIssues(context, commit);
    if (after.state.state === "applied") {
      const target = commit.targetExternalMessageReference;
      if (
        target === null ||
        target.tenantId !== commit.tenantId ||
        target.id !== after.state.externalMessageReference.id ||
        target.message.id !== after.state.message.id ||
        !sameValue(target.key, before.externalMessageKey)
      ) {
        addIssue(
          context,
          ["targetExternalMessageReference"],
          "Applied deferred action resolves only against its exact external key."
        );
      }
      addAppliedEffectIssues(context, commit);
    } else if (
      commit.targetExternalMessageReference !== null ||
      commit.sourceOccurrenceResolution !== null ||
      commit.effectProof !== null
    ) {
      addIssue(
        context,
        ["targetExternalMessageReference"],
        "Only an applied deferred action binds one canonical target and typed effect."
      );
    }
  });

export const inboxV2DeferredMessageSourceActionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_DEFERRED_MESSAGE_SOURCE_ACTION_SCHEMA_ID,
    INBOX_V2_MESSAGE_SOURCE_ACTION_SCHEMA_VERSION,
    inboxV2DeferredMessageSourceActionSchema
  );
export const inboxV2DeferredMessageSourceActionCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_DEFERRED_MESSAGE_SOURCE_ACTION_COMMIT_SCHEMA_ID,
    INBOX_V2_MESSAGE_SOURCE_ACTION_SCHEMA_VERSION,
    inboxV2DeferredMessageSourceActionCommitSchema
  );

export type InboxV2DeferredMessageSourceAction = z.infer<
  typeof inboxV2DeferredMessageSourceActionSchema
>;
export type InboxV2DeferredSourceActionOrderingHead = z.infer<
  typeof inboxV2DeferredSourceActionOrderingHeadSchema
>;
export type InboxV2DeferredMessageSourceActionEffectProof = z.infer<
  typeof inboxV2DeferredMessageSourceActionEffectProofSchema
>;

function addDeferredInductionIssues(
  context: z.RefinementCtx,
  action: InboxV2DeferredMessageSourceAction
): void {
  const occurrence = action.sourceOccurrence;
  const proof = action.semanticProof;
  const normalizedEvent =
    occurrence.origin.kind === "provider_response"
      ? null
      : occurrence.origin.normalizedInboundEvent;
  const expectedActor =
    occurrence.providerActor?.kind === "source_external_identity"
      ? occurrence.providerActor.sourceExternalIdentity
      : null;
  const expectedSemanticId = semanticIdForAction(action.action);

  for (const [field, reference] of [
    ["normalizedInboundEvent", action.idempotencyKey.normalizedInboundEvent],
    ["sourceOccurrence", action.idempotencyKey.sourceOccurrence]
  ] as const) {
    addTenantReferenceIssue(context, action.tenantId, reference, [
      "idempotencyKey",
      field
    ]);
  }

  if (
    occurrence.resolution.state === "resolved" ||
    !sameValue(occurrence.messageKey, action.externalMessageKey) ||
    normalizedEvent === null ||
    normalizedEvent.id !== action.action.normalizedEvent.id ||
    action.idempotencyKey.normalizedInboundEvent.id !==
      action.action.normalizedEvent.id ||
    action.idempotencyKey.sourceOccurrence.id !== occurrence.id ||
    action.idempotencyKey.semanticId !== expectedSemanticId ||
    action.observedAt !== occurrence.observedAt ||
    action.recordedAt !== occurrence.recordedAt
  ) {
    addIssue(
      context,
      ["sourceOccurrence"],
      "Deferred action induction must use one unresolved exact-key SourceOccurrence, normalized event, idempotency tuple and semantic lane."
    );
  }

  if (
    proof.tenantId !== action.tenantId ||
    proof.externalMessageReference !== null ||
    proof.sourceOccurrence !== null ||
    proof.normalizedInboundEvent.id !== action.action.normalizedEvent.id ||
    proof.sourceAccount.id !== occurrence.bindingContext.sourceAccount.id ||
    proof.sourceThreadBinding.id !==
      occurrence.bindingContext.sourceThreadBinding.id ||
    proof.bindingGeneration !== occurrence.bindingContext.bindingGeneration ||
    !sameValue(proof.adapterContract, occurrence.descriptor.adapterContract) ||
    proof.capabilityRevision !== occurrence.descriptor.capabilityRevision ||
    proof.semanticId !== expectedSemanticId ||
    !sameValue(proof.actor, expectedActor) ||
    proof.occurredAt !== occurrence.observedAt ||
    proof.recordedAt !== occurrence.recordedAt
  ) {
    addIssue(
      context,
      ["semanticProof"],
      "Deferred action requires trusted normalized semantics pinned to the exact occurrence account, binding, adapter, actor and event."
    );
  }
}

function addDeferredStateTenantIssues(
  context: z.RefinementCtx,
  action: InboxV2DeferredMessageSourceAction
): void {
  if (action.state.state === "applied") {
    for (const [field, reference] of [
      ["externalMessageReference", action.state.externalMessageReference],
      ["message", action.state.message]
    ] as const) {
      addTenantReferenceIssue(context, action.tenantId, reference, [
        "state",
        field
      ]);
    }
  } else if (action.state.state === "target_conflicted") {
    const ids = new Set<string>();
    for (const [index, candidate] of action.state.candidates.entries()) {
      if (
        candidate.tenantId !== action.tenantId ||
        !sameValue(candidate.key, action.externalMessageKey) ||
        ids.has(candidate.id)
      ) {
        addIssue(
          context,
          ["state", "candidates", index],
          "Deferred-action target conflicts preserve distinct full exact-key candidates."
        );
      }
      ids.add(candidate.id);
    }
  } else if (action.state.state === "stale") {
    addTenantReferenceIssue(context, action.tenantId, action.state.headAction, [
      "state",
      "headAction"
    ]);
  } else if (action.state.state === "duplicate") {
    addTenantReferenceIssue(
      context,
      action.tenantId,
      action.state.canonicalAction,
      ["state", "canonicalAction"]
    );
  } else if (action.state.state === "ordering_conflict") {
    if (action.state.conflictingAction !== null) {
      addTenantReferenceIssue(
        context,
        action.tenantId,
        action.state.conflictingAction,
        ["state", "conflictingAction"]
      );
    }
  }
}

function addTerminalTimestampIssues(
  context: z.RefinementCtx,
  transition: z.infer<typeof inboxV2DeferredMessageSourceActionTransitionSchema>
): void {
  const timestamp = terminalTimestamp(transition.afterState);
  if (timestamp !== transition.recordedAt) {
    addIssue(
      context,
      ["transition", "afterState"],
      "Deferred source-action terminal timestamp must equal the CAS record time."
    );
  }
}

function addOrderingCommitIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2DeferredMessageSourceActionCommitSchema>
): void {
  const { before, transition, beforeOrderingHead, afterOrderingHead } = commit;
  if (
    transition.expectedOrderingHeadRevision !==
      (beforeOrderingHead?.revision ?? null) ||
    transition.resultingOrderingHeadRevision !==
      (afterOrderingHead?.revision ?? null)
  ) {
    addIssue(
      context,
      ["transition", "expectedOrderingHeadRevision"],
      "Deferred action CAS must pin the exact before/after per-key ordering-head revisions."
    );
  }
  if (
    (beforeOrderingHead !== null &&
      !orderingHeadMatchesAction(beforeOrderingHead, before)) ||
    (afterOrderingHead !== null &&
      !orderingHeadMatchesAction(afterOrderingHead, before))
  ) {
    addIssue(
      context,
      ["beforeOrderingHead"],
      "Ordering head is scoped by the exact tenant, external key, lane, provider scope and comparator revision."
    );
    return;
  }

  const ordering = before.semanticProof.ordering;
  const positionText =
    ordering.kind === "monotonic_exact" ? ordering.position : null;
  const position = positionText === null ? null : BigInt(positionText);
  const headPosition =
    beforeOrderingHead === null
      ? null
      : BigInt(beforeOrderingHead.latest.position);
  switch (transition.orderingOutcome) {
    case "advance": {
      const expectedRevision =
        beforeOrderingHead === null
          ? "1"
          : (BigInt(beforeOrderingHead.revision) + 1n).toString();
      if (
        afterOrderingHead === null ||
        position === null ||
        (headPosition !== null && position <= headPosition) ||
        afterOrderingHead.revision !== expectedRevision ||
        afterOrderingHead.createdAt !==
          (beforeOrderingHead?.createdAt ?? transition.recordedAt) ||
        afterOrderingHead.updatedAt !== transition.recordedAt ||
        afterOrderingHead.latest.action.id !== before.id ||
        !sameValue(
          afterOrderingHead.latest.idempotencyKey,
          before.idempotencyKey
        ) ||
        afterOrderingHead.latest.position !== positionText
      ) {
        addIssue(
          context,
          ["afterOrderingHead"],
          "Applied action atomically advances one exact provider-position head; timestamps never decide ordering."
        );
      }
      break;
    }
    case "stale":
      addNonAdvancingOrderingIssues(
        context,
        commit,
        position !== null && headPosition !== null && position < headPosition,
        transition.afterState.state === "stale" &&
          beforeOrderingHead?.latest.action.id ===
            transition.afterState.headAction.id,
        "Stale action must be below the exact provider-position head."
      );
      break;
    case "duplicate":
      addNonAdvancingOrderingIssues(
        context,
        commit,
        position !== null && headPosition !== null && position === headPosition,
        transition.afterState.state === "duplicate" &&
          beforeOrderingHead?.latest.action.id ===
            transition.afterState.canonicalAction.id &&
          sameValue(
            beforeOrderingHead?.latest.idempotencyKey,
            before.idempotencyKey
          ),
        "Duplicate action must equal the head position and complete idempotency tuple."
      );
      break;
    case "conflict": {
      const conflictState =
        transition.afterState.state === "ordering_conflict"
          ? transition.afterState
          : null;
      if (ordering.kind === "monotonic_exact") {
        addNonAdvancingOrderingIssues(
          context,
          commit,
          position !== null &&
            headPosition !== null &&
            position === headPosition,
          conflictState !== null &&
            beforeOrderingHead?.latest.action.id ===
              conflictState.conflictingAction?.id &&
            !sameValue(
              beforeOrderingHead?.latest.idempotencyKey,
              before.idempotencyKey
            ),
          "Equal provider position with a different idempotency tuple is an explicit conflict."
        );
      } else if (
        conflictState === null ||
        !sameValue(beforeOrderingHead, afterOrderingHead) ||
        conflictState.conflictingAction?.id !==
          (beforeOrderingHead?.latest.action.id ?? undefined)
      ) {
        addIssue(
          context,
          ["afterOrderingHead"],
          "Incomparable/unavailable provider order is an explicit non-advancing conflict."
        );
      }
      break;
    }
    case "not_evaluated":
      if (!sameValue(beforeOrderingHead, afterOrderingHead)) {
        addIssue(
          context,
          ["afterOrderingHead"],
          "Target conflict/expiry cannot advance an unevaluated ordering head."
        );
      }
      break;
  }
}

function addNonAdvancingOrderingIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2DeferredMessageSourceActionCommitSchema>,
  validPosition: boolean,
  validStateReference: boolean,
  message: string
): void {
  if (
    commit.beforeOrderingHead === null ||
    !sameValue(commit.beforeOrderingHead, commit.afterOrderingHead) ||
    !validPosition ||
    !validStateReference
  ) {
    addIssue(context, ["afterOrderingHead"], message);
  }
}

function addAppliedEffectIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2DeferredMessageSourceActionCommitSchema>
): void {
  const { before, after, transition } = commit;
  if (after.state.state !== "applied") {
    return;
  }
  const target = commit.targetExternalMessageReference;
  const resolution = commit.sourceOccurrenceResolution;
  const effect = commit.effectProof;
  if (target === null || resolution === null || effect === null) {
    addIssue(
      context,
      ["effectProof"],
      "Applied deferred action requires exact occurrence resolution and one typed domain-effect commit."
    );
    return;
  }
  if (
    resolution.tenantId !== commit.tenantId ||
    !sameValue(resolution.before, before.sourceOccurrence) ||
    resolution.after.resolution.state !== "resolved" ||
    resolution.after.resolution.externalMessageReference.id !== target.id ||
    resolution.resolvedReference?.id !== target.id ||
    !sameValue(resolution.resolvedReference, target) ||
    !isInboxV2TimestampOrderValid(resolution.changedAt, transition.recordedAt)
  ) {
    addIssue(
      context,
      ["sourceOccurrenceResolution"],
      "Applied action must resolve its exact captured SourceOccurrence to the exact canonical external reference."
    );
  }

  const effectFacts = effectMessageFacts(effect);
  if (
    effect.kind !== after.state.effectKind ||
    effectFacts.tenantId !== commit.tenantId ||
    effectFacts.messageId !== after.state.message.id ||
    effectFacts.messageRevision !== after.state.appliedMessageRevision ||
    effectFacts.recordedAt !== after.state.appliedAt ||
    effectFacts.recordedAt !== transition.recordedAt
  ) {
    addIssue(
      context,
      ["effectProof"],
      "Typed deferred effect must bind the exact target Message revision at the terminal CAS time."
    );
  }
  addActionSpecificEffectIssues(
    context,
    before,
    target,
    resolution.after,
    effect
  );
}

function addActionSpecificEffectIssues(
  context: z.RefinementCtx,
  action: InboxV2DeferredMessageSourceAction,
  target: InboxV2ExternalMessageReference,
  resolvedOccurrence: InboxV2SourceOccurrence,
  effect: InboxV2DeferredMessageSourceActionEffectProof
): void {
  if (
    action.action.kind === "delete" &&
    effect.kind === "provider_delete_retain_local"
  ) {
    addRetainedProviderDeleteEffectIssues(
      context,
      action,
      target,
      resolvedOccurrence,
      effect
    );
    return;
  }

  if (action.action.kind === "edit" || action.action.kind === "delete") {
    const validChange =
      effect.kind === "message_lifecycle" &&
      ((action.action.kind === "edit" &&
        effect.commit.revision.change.kind === "edited") ||
        (action.action.kind === "delete" &&
          effect.commit.revision.change.kind ===
            "provider_delete_policy_tombstone"));
    const operation =
      effect.kind === "message_lifecycle"
        ? effect.commit.providerOperation
        : null;
    if (
      !validChange ||
      effect.kind !== "message_lifecycle" ||
      effect.commit.revision.actionAttribution.sourceOccurrence?.id !==
        action.sourceOccurrence.id ||
      operation === null ||
      operation.origin !== "provider_observed" ||
      operation.action !== action.action.kind ||
      operation.externalMessageReference.id !== target.id ||
      operation.sourceOccurrence.id !== action.sourceOccurrence.id ||
      operation.sourceAccount.id !==
        resolvedOccurrence.bindingContext.sourceAccount.id ||
      operation.sourceThreadBinding.id !==
        resolvedOccurrence.bindingContext.sourceThreadBinding.id ||
      operation.bindingGeneration !==
        resolvedOccurrence.bindingContext.bindingGeneration ||
      !sameValue(
        operation.adapterContract,
        resolvedOccurrence.descriptor.adapterContract
      )
    ) {
      addIssue(
        context,
        ["effectProof"],
        "Deferred edit/delete requires the exact provider-observed lifecycle mutation and transport authority."
      );
    }
    return;
  }

  if (action.action.kind === "reaction") {
    const reaction = effect.kind === "message_reaction" ? effect.commit : null;
    if (
      reaction === null ||
      reaction.transition.operation !== action.action.operation ||
      !sameValue(
        reaction.transition.afterState,
        reaction.afterReaction.state
      ) ||
      (action.action.operation === "clear"
        ? reaction.transition.afterState.kind !== "cleared"
        : reaction.transition.afterState.kind !== "active" ||
          !sameValue(
            reaction.transition.afterState.value,
            action.action.value
          )) ||
      reaction.transition.actionAttribution.sourceOccurrence?.id !==
        action.sourceOccurrence.id ||
      reaction.afterReaction.message.id !== target.message.id ||
      reaction.externalAuthorityEvidence?.externalMessageReference.id !==
        target.id ||
      reaction.externalAuthorityEvidence.sourceOccurrence.id !==
        resolvedOccurrence.id
    ) {
      addIssue(
        context,
        ["effectProof"],
        "Deferred reaction requires the exact source-attributed reaction transition and external target evidence."
      );
    }
    return;
  }

  const transport =
    effect.kind === "message_transport_fact" ? effect.commit : null;
  const observation = transport?.fact.observation;
  const correctFact =
    action.action.kind === "delivery"
      ? transport?.fact.kind === "delivery" &&
        transport.fact.observation.fact === action.action.fact
      : transport?.fact.kind === "receipt" &&
        transport.fact.observation.fact === "read" &&
        transport.fact.observation.target.kind === "exact_message";
  const semanticProof = observation?.semanticProof;
  if (
    transport === null ||
    !correctFact ||
    transport.beforeMessage.id !== target.message.id ||
    semanticProof === null ||
    semanticProof === undefined ||
    semanticProof.normalizedInboundEvent.id !==
      action.action.normalizedEvent.id ||
    semanticProof.externalMessageReference?.id !== target.id ||
    semanticProof.sourceOccurrence?.id !== resolvedOccurrence.id
  ) {
    addIssue(
      context,
      ["effectProof"],
      "Deferred delivery/read requires one exact-message transport fact with matching provider semantic evidence."
    );
  }
}

function addRetainedProviderDeleteEffectIssues(
  context: z.RefinementCtx,
  action: InboxV2DeferredMessageSourceAction,
  target: InboxV2ExternalMessageReference,
  resolvedOccurrence: InboxV2SourceOccurrence,
  effect: Extract<
    InboxV2DeferredMessageSourceActionEffectProof,
    { kind: "provider_delete_retain_local" }
  >
): void {
  const creation = effect.operationCreationCommit;
  const policy = effect.policyTransitionCommit;
  const operation = creation.operation;
  const retained = policy.after.deleteLocalPolicy;
  if (
    action.action.kind !== "delete" ||
    operation.origin !== "provider_observed" ||
    operation.action !== "delete" ||
    operation.externalMessageReference.id !== target.id ||
    operation.sourceOccurrence.id !== action.sourceOccurrence.id ||
    creation.externalMessageReference.id !== target.id ||
    !sameValue(creation.sourceOccurrence, resolvedOccurrence) ||
    creation.message.id !== target.message.id ||
    creation.timelineItem.id !== target.timelineItem.id ||
    creation.providerSemanticProof?.normalizedInboundEvent.id !==
      action.action.normalizedEvent.id ||
    creation.providerSemanticProof.externalMessageReference?.id !== target.id ||
    creation.providerSemanticProof.sourceOccurrence?.id !==
      resolvedOccurrence.id ||
    !sameValue(policy.before, operation) ||
    policy.after.id !== operation.id ||
    policy.after.outcome.state !== "observed" ||
    retained?.effect !== "retain_local" ||
    retained.decidedAt !== policy.transition.recordedAt ||
    policy.transition.resultProof !== null
  ) {
    addIssue(
      context,
      ["effectProof"],
      "Retained deferred provider delete requires the exact observed operation and immutable retain-local policy decision without a Message tombstone."
    );
  }
}

function effectMessageFacts(
  effect: InboxV2DeferredMessageSourceActionEffectProof
): {
  tenantId: string;
  messageId: string;
  messageRevision: string;
  recordedAt: string;
} {
  if (effect.kind === "message_lifecycle") {
    return {
      tenantId: effect.commit.tenantId,
      messageId: effect.commit.afterMessage.id,
      messageRevision: effect.commit.afterMessage.revision,
      recordedAt: effect.commit.revision.recordedAt
    };
  }
  if (effect.kind === "message_reaction") {
    return {
      tenantId: effect.commit.tenantId,
      messageId: effect.commit.beforeMessage.id,
      messageRevision: effect.commit.beforeMessage.revision,
      recordedAt: effect.commit.transition.recordedAt
    };
  }
  if (effect.kind === "provider_delete_retain_local") {
    return {
      tenantId: effect.operationCreationCommit.tenantId,
      messageId: effect.operationCreationCommit.message.id,
      messageRevision: effect.operationCreationCommit.message.revision,
      recordedAt: effect.policyTransitionCommit.transition.recordedAt
    };
  }
  return {
    tenantId: effect.commit.tenantId,
    messageId: effect.commit.beforeMessage.id,
    messageRevision: effect.commit.beforeMessage.revision,
    recordedAt: effect.commit.committedAt
  };
}

function orderingHeadMatchesAction(
  head: InboxV2DeferredSourceActionOrderingHead,
  action: InboxV2DeferredMessageSourceAction
): boolean {
  const baseMatches =
    head.tenantId === action.tenantId &&
    sameValue(head.externalMessageKey, action.externalMessageKey) &&
    head.lane === orderingLaneForAction(action.action);
  const ordering = action.semanticProof.ordering;
  return (
    baseMatches &&
    (ordering.kind !== "monotonic_exact" ||
      (head.scopeToken === ordering.scopeToken &&
        head.comparatorId === ordering.comparatorId &&
        head.comparatorRevision === ordering.comparatorRevision))
  );
}

function orderingOutcomeForState(
  state: z.infer<typeof inboxV2DeferredMessageSourceActionStateSchema>
): "advance" | "stale" | "duplicate" | "conflict" | "not_evaluated" {
  switch (state.state) {
    case "applied":
      return "advance";
    case "stale":
      return "stale";
    case "duplicate":
      return "duplicate";
    case "ordering_conflict":
      return "conflict";
    case "target_conflicted":
    case "expired":
    case "pending":
      return "not_evaluated";
  }
}

function terminalTimestamp(
  state: z.infer<typeof inboxV2DeferredMessageSourceActionStateSchema>
): string | null {
  switch (state.state) {
    case "applied":
      return state.appliedAt;
    case "target_conflicted":
    case "ordering_conflict":
      return state.conflictedAt;
    case "stale":
      return state.staleAt;
    case "duplicate":
      return state.duplicateAt;
    case "expired":
      return state.expiredAt;
    case "pending":
      return null;
  }
}

function semanticIdForAction(
  action: InboxV2DeferredMessageSourceAction["action"]
): string {
  switch (action.kind) {
    case "edit":
      return "core:message.lifecycle.edit.observed";
    case "delete":
      return "core:message.lifecycle.delete.observed";
    case "reaction":
      return `core:message.reaction.${action.operation}`;
    case "delivery":
      return `core:message.delivery.${action.fact}`;
    case "receipt":
      return "core:message.receipt.read";
  }
}

function orderingLaneForAction(
  action: InboxV2DeferredMessageSourceAction["action"]
): z.infer<typeof inboxV2DeferredSourceActionOrderingLaneSchema> {
  if (action.kind === "edit" || action.kind === "delete") {
    return "message_lifecycle";
  }
  return action.kind;
}

function addMessageKeyTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  key: z.infer<typeof inboxV2ExternalMessageKeySchema>,
  path: PropertyKey[]
): void {
  addTenantReferenceIssue(context, tenantId, key.externalThread, [
    ...path,
    "externalThread"
  ]);
  if (key.scope.kind !== "provider_thread") {
    addTenantReferenceIssue(context, tenantId, key.scope.owner, [
      ...path,
      "scope",
      "owner"
    ]);
  }
}

function deferredIdentity(action: InboxV2DeferredMessageSourceAction): unknown {
  const {
    state: _state,
    revision: _revision,
    updatedAt: _updatedAt,
    ...identity
  } = action;
  return identity;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(
      context,
      path,
      "Deferred source-action references must share one tenant."
    );
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
