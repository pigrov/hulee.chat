import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2EventReferenceSchema,
  inboxV2ConversationParticipantReferenceSchema,
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2MessageProviderLifecycleOperationIdSchema,
  inboxV2MessageProviderLifecycleOperationReferenceSchema,
  inboxV2MessageReferenceSchema,
  inboxV2OutboundRouteReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  inboxV2ExternalMessageReferenceSchema,
  inboxV2SourceOccurrenceSchema
} from "./external-message-reference";
import { inboxV2MessageSchema } from "./message";
import { inboxV2OutboundRouteSchema } from "./outbound-route";
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
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema
} from "./source-routing-primitives";
import { inboxV2SourceThreadBindingSchema } from "./source-thread-binding";
import {
  inboxV2AppActorSchema,
  inboxV2AutomationCausationSchema,
  inboxV2TimelineItemSchema
} from "./timeline";
import { inboxV2ConversationParticipantSchema } from "./participant-identity";

export const INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID =
  "core:inbox-v2.message-provider-lifecycle-operation" as const;
export const INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_TRANSITION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.message-provider-lifecycle-transition-commit" as const;
export const INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_CREATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.message-provider-lifecycle-creation-commit" as const;
export const INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2ProviderLifecycleReasonIdSchema = inboxV2CatalogIdSchema;

export const inboxV2ProviderLifecycleOutcomeSchema = z.discriminatedUnion(
  "state",
  [
    z.object({ state: z.literal("observed") }).strict(),
    z.object({ state: z.literal("pending") }).strict(),
    z.object({ state: z.literal("accepted") }).strict(),
    z.object({ state: z.literal("confirmed") }).strict(),
    z
      .object({
        state: z.literal("failed"),
        retryable: z.boolean(),
        reasonId: inboxV2ProviderLifecycleReasonIdSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("unsupported"),
        reasonId: inboxV2ProviderLifecycleReasonIdSchema
      })
      .strict(),
    z.object({ state: z.literal("outcome_unknown") }).strict()
  ]
);

export const inboxV2ProviderDeleteLocalPolicySchema = z.discriminatedUnion(
  "effect",
  [
    z.object({ effect: z.literal("not_evaluated") }).strict(),
    z
      .object({
        effect: z.literal("retain_local"),
        decisionEvent: inboxV2EventReferenceSchema,
        decisionRevision: inboxV2EntityRevisionSchema,
        decidedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        effect: z.literal("tombstone_local"),
        decisionEvent: inboxV2EventReferenceSchema,
        decisionRevision: inboxV2EntityRevisionSchema,
        decidedAt: inboxV2TimestampSchema
      })
      .strict()
  ]
);

/** Exact original transport target; no account/binding fallback is expressible. */
export const inboxV2MessageProviderLifecycleOperationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2MessageProviderLifecycleOperationIdSchema,
    message: inboxV2MessageReferenceSchema,
    action: z.enum(["edit", "delete"]),
    origin: z.enum(["provider_observed", "hulee_requested"]),
    externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    bindingGeneration: inboxV2EntityRevisionSchema,
    outboundRoute: inboxV2OutboundRouteReferenceSchema.nullable(),
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    appActor: inboxV2AppActorSchema.nullable(),
    actionParticipant: inboxV2ConversationParticipantReferenceSchema.nullable(),
    automationCausation: inboxV2AutomationCausationSchema.nullable(),
    outcome: inboxV2ProviderLifecycleOutcomeSchema,
    deleteLocalPolicy: inboxV2ProviderDeleteLocalPolicySchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    occurredAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((operation, context) => {
    for (const [field, reference] of [
      ["message", operation.message],
      ["externalMessageReference", operation.externalMessageReference],
      ["sourceOccurrence", operation.sourceOccurrence],
      ["sourceAccount", operation.sourceAccount],
      ["sourceThreadBinding", operation.sourceThreadBinding]
    ] as const) {
      addTenantReferenceIssue(context, operation.tenantId, reference, [field]);
    }
    if (operation.outboundRoute !== null) {
      addTenantReferenceIssue(
        context,
        operation.tenantId,
        operation.outboundRoute,
        ["outboundRoute"]
      );
    }
    if (operation.appActor?.kind === "employee") {
      addTenantReferenceIssue(
        context,
        operation.tenantId,
        operation.appActor.employee,
        ["appActor", "employee"]
      );
    }
    if (operation.actionParticipant !== null) {
      addTenantReferenceIssue(
        context,
        operation.tenantId,
        operation.actionParticipant,
        ["actionParticipant"]
      );
    }
    if (operation.automationCausation !== null) {
      addTenantReferenceIssue(
        context,
        operation.tenantId,
        operation.automationCausation.causeEvent,
        ["automationCausation", "causeEvent"]
      );
      if (operation.automationCausation.kind === "employee_command") {
        addTenantReferenceIssue(
          context,
          operation.tenantId,
          operation.automationCausation.initiatingActor.employee,
          ["automationCausation", "initiatingActor", "employee"]
        );
      }
    }
    if (
      operation.origin === "provider_observed" &&
      (operation.appActor !== null ||
        operation.actionParticipant !== null ||
        operation.automationCausation !== null ||
        operation.outboundRoute !== null)
    ) {
      addIssue(
        context,
        ["origin"],
        "Provider-observed lifecycle action has source evidence, not a Hulee actor/route."
      );
    }
    if (
      operation.origin === "hulee_requested" &&
      (operation.appActor === null ||
        operation.outboundRoute === null ||
        (operation.appActor.kind === "employee" &&
          (operation.actionParticipant === null ||
            operation.automationCausation !== null)) ||
        (operation.appActor.kind === "trusted_service" &&
          operation.automationCausation === null))
    ) {
      addIssue(
        context,
        ["origin"],
        "Hulee-requested lifecycle action requires server actor and exact original route."
      );
    }
    if (
      operation.automationCausation !== null &&
      Date.parse(operation.automationCausation.causedAt) >
        Date.parse(operation.occurredAt)
    ) {
      addIssue(
        context,
        ["automationCausation", "causedAt"],
        "Provider lifecycle automation cause cannot follow the requested action."
      );
    }
    if (
      operation.revision === "1" &&
      ((operation.origin === "provider_observed" &&
        operation.outcome.state !== "observed") ||
        (operation.origin === "hulee_requested" &&
          operation.outcome.state !== "pending") ||
        operation.createdAt !== operation.updatedAt)
    ) {
      addIssue(
        context,
        ["revision"],
        "Provider lifecycle operation starts as observed or pending according to origin."
      );
    }
    if (
      (operation.action === "delete") !==
      (operation.deleteLocalPolicy !== null)
    ) {
      addIssue(
        context,
        ["deleteLocalPolicy"],
        "Only provider delete has an explicit independent local-visibility policy."
      );
    }
    if (
      operation.deleteLocalPolicy !== null &&
      operation.deleteLocalPolicy.effect !== "not_evaluated"
    ) {
      addTenantReferenceIssue(
        context,
        operation.tenantId,
        operation.deleteLocalPolicy.decisionEvent,
        ["deleteLocalPolicy", "decisionEvent"]
      );
      if (
        !isInboxV2TimestampOrderValid(
          operation.deleteLocalPolicy.decidedAt,
          operation.updatedAt
        )
      ) {
        addIssue(
          context,
          ["deleteLocalPolicy", "decidedAt"],
          "Provider-delete local policy cannot be decided after this operation revision."
        );
      }
    }
    if (
      !isInboxV2TimestampOrderValid(
        operation.occurredAt,
        operation.recordedAt
      ) ||
      operation.recordedAt !== operation.createdAt ||
      !isInboxV2TimestampOrderValid(operation.createdAt, operation.updatedAt)
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "Provider lifecycle timestamps preserve occurrence, record and update order."
      );
    }
  });

/**
 * Bounded induction proof for an immutable provider lifecycle target. Durable
 * operations keep compact references; their first commit proves those
 * references belong to one canonical Message and one exact transport context.
 */
export const inboxV2MessageProviderLifecycleOperationCreationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    message: inboxV2MessageSchema,
    timelineItem: inboxV2TimelineItemSchema,
    externalMessageReference: inboxV2ExternalMessageReferenceSchema,
    sourceOccurrence: inboxV2SourceOccurrenceSchema,
    outboundRoute: inboxV2OutboundRouteSchema.nullable(),
    outboundBindingSnapshot: inboxV2SourceThreadBindingSchema.nullable(),
    actionParticipantSnapshot: inboxV2ConversationParticipantSchema.nullable(),
    providerSemanticProof: inboxV2ProviderSemanticProofSchema.nullable(),
    semanticOrderingCommit:
      inboxV2ProviderSemanticOrderingCommitSchema.nullable(),
    routeConsumption: z
      .object({
        outboundRoute: inboxV2OutboundRouteReferenceSchema,
        operation: inboxV2MessageProviderLifecycleOperationReferenceSchema,
        mutationToken: inboxV2RoutingTokenSchema,
        idempotencyToken: inboxV2RoutingTokenSchema,
        correlationToken: inboxV2RoutingTokenSchema,
        consumedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
        consumedAt: inboxV2TimestampSchema,
        revision: z.literal("1")
      })
      .strict()
      .nullable(),
    operation: inboxV2MessageProviderLifecycleOperationSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const {
      message,
      timelineItem,
      externalMessageReference,
      sourceOccurrence,
      outboundRoute,
      outboundBindingSnapshot,
      actionParticipantSnapshot,
      providerSemanticProof,
      semanticOrderingCommit,
      routeConsumption,
      operation
    } = commit;
    if (
      commit.tenantId !== message.tenantId ||
      commit.tenantId !== timelineItem.tenantId ||
      commit.tenantId !== externalMessageReference.tenantId ||
      commit.tenantId !== sourceOccurrence.tenantId ||
      commit.tenantId !== operation.tenantId ||
      operation.revision !== "1" ||
      message.origin.kind === "internal" ||
      message.origin.kind === "migration" ||
      timelineItem.subject.kind !== "message" ||
      timelineItem.subject.message.id !== message.id ||
      timelineItem.subject.messageRevision !== message.revision ||
      message.timelineItem.id !== timelineItem.id ||
      operation.message.id !== message.id ||
      externalMessageReference.message.id !== message.id ||
      externalMessageReference.timelineItem.id !== timelineItem.id ||
      operation.externalMessageReference.id !== externalMessageReference.id ||
      operation.sourceOccurrence.id !== sourceOccurrence.id ||
      sourceOccurrence.resolution.state !== "resolved" ||
      sourceOccurrence.resolution.externalMessageReference.id !==
        externalMessageReference.id ||
      !sameValue(sourceOccurrence.messageKey, externalMessageReference.key) ||
      operation.sourceAccount.id !==
        sourceOccurrence.bindingContext.sourceAccount.id ||
      operation.sourceThreadBinding.id !==
        sourceOccurrence.bindingContext.sourceThreadBinding.id ||
      operation.bindingGeneration !==
        sourceOccurrence.bindingContext.bindingGeneration ||
      !sameValue(
        operation.adapterContract,
        sourceOccurrence.descriptor.adapterContract
      )
    ) {
      addIssue(
        context,
        ["operation"],
        "Provider lifecycle creation must prove one canonical Message and exact resolved transport occurrence."
      );
    }

    if (operation.origin === "provider_observed") {
      const normalizedEvent =
        sourceOccurrence.origin.kind === "provider_response"
          ? null
          : sourceOccurrence.origin.normalizedInboundEvent;
      const providerActor =
        sourceOccurrence.providerActor?.kind === "source_external_identity"
          ? sourceOccurrence.providerActor.sourceExternalIdentity
          : null;
      if (
        outboundRoute !== null ||
        outboundBindingSnapshot !== null ||
        actionParticipantSnapshot !== null ||
        routeConsumption !== null ||
        operation.outboundRoute !== null ||
        sourceOccurrence.origin.kind === "provider_echo" ||
        sourceOccurrence.origin.kind === "provider_response" ||
        providerSemanticProof === null ||
        semanticOrderingCommit === null ||
        normalizedEvent === null ||
        providerSemanticProof.normalizedInboundEvent.id !==
          normalizedEvent.id ||
        providerSemanticProof.externalMessageReference?.id !==
          externalMessageReference.id ||
        providerSemanticProof.sourceOccurrence?.id !== sourceOccurrence.id ||
        providerSemanticProof.sourceAccount.id !== operation.sourceAccount.id ||
        providerSemanticProof.sourceThreadBinding.id !==
          operation.sourceThreadBinding.id ||
        providerSemanticProof.bindingGeneration !==
          operation.bindingGeneration ||
        !sameValue(
          providerSemanticProof.adapterContract,
          operation.adapterContract
        ) ||
        providerSemanticProof.capabilityId !==
          expectedLifecycleCapabilityId(operation.action) ||
        providerSemanticProof.capabilityRevision !==
          sourceOccurrence.descriptor.capabilityRevision ||
        operation.capabilityRevision !==
          sourceOccurrence.descriptor.capabilityRevision ||
        providerSemanticProof.semanticId !==
          `core:message.lifecycle.${operation.action}.observed` ||
        providerSemanticProof.occurredAt !== operation.occurredAt ||
        providerSemanticProof.recordedAt !== operation.recordedAt ||
        (providerActor === null) !== (providerSemanticProof.actor === null) ||
        (providerActor !== null &&
          providerSemanticProof.actor?.id !== providerActor.id) ||
        providerSemanticProof.ordering.kind !== "monotonic_exact" ||
        semanticOrderingCommit.semanticFamilyId !== "core:message.lifecycle" ||
        !sameValue(semanticOrderingCommit.proof, providerSemanticProof) ||
        semanticOrderingCommit.committedAt !== operation.recordedAt
      ) {
        addIssue(
          context,
          ["outboundRoute"],
          "Provider-observed lifecycle induction uses native source evidence, never a Hulee echo/route."
        );
      }
      return;
    }

    const expectedAuthority = expectedLifecycleRouteAuthority(operation.action);
    if (
      providerSemanticProof !== null ||
      semanticOrderingCommit !== null ||
      routeConsumption === null ||
      outboundRoute === null ||
      outboundBindingSnapshot === null ||
      operation.outboundRoute?.id !== outboundRoute.id ||
      outboundRoute.tenantId !== commit.tenantId ||
      outboundRoute.conversation.id !== message.conversation.id ||
      outboundRoute.externalThread.id !==
        sourceOccurrence.bindingContext.externalThread.id ||
      outboundRoute.sourceAccount.id !== operation.sourceAccount.id ||
      outboundRoute.sourceThreadBinding.id !==
        operation.sourceThreadBinding.id ||
      outboundRoute.bindingFence.bindingGeneration !==
        operation.bindingGeneration ||
      !sameValue(outboundRoute.adapterContract, operation.adapterContract) ||
      operation.capabilityRevision !==
        outboundRoute.bindingFence.capabilityRevision ||
      outboundRoute.operationId !== expectedAuthority.operationId ||
      outboundRoute.requiredConversationPermissionId !==
        expectedAuthority.permissionId ||
      !outboundBindingSupportsLifecycleAction(
        outboundBindingSnapshot,
        outboundRoute,
        operation,
        operation.recordedAt
      ) ||
      routeConsumption.outboundRoute.tenantId !== commit.tenantId ||
      routeConsumption.operation.tenantId !== commit.tenantId ||
      routeConsumption.outboundRoute.id !== outboundRoute.id ||
      routeConsumption.operation.id !== operation.id ||
      routeConsumption.mutationToken !== outboundRoute.mutationToken ||
      routeConsumption.idempotencyToken !== outboundRoute.idempotencyToken ||
      routeConsumption.correlationToken !== outboundRoute.correlationToken ||
      routeConsumption.consumedAt !== operation.recordedAt ||
      routeConsumption.consumedByTrustedServiceId !==
        outboundRoute.adapterContract.loadedByTrustedServiceId ||
      outboundRoute.referenceContext.kind !== "external_message" ||
      outboundRoute.referenceContext.externalMessageReference.id !==
        externalMessageReference.id ||
      outboundRoute.referenceContext.sourceOccurrence.id !==
        sourceOccurrence.id ||
      !sameAppPrincipal(outboundRoute.principal, operation.appActor)
    ) {
      addIssue(
        context,
        ["outboundRoute"],
        "Hulee lifecycle induction pins the exact original reference, binding generation and authorized route."
      );
    }
    addRequestedActionParticipantIssues(
      context,
      commit.tenantId,
      message,
      operation,
      actionParticipantSnapshot
    );
  });

export const inboxV2MessageProviderLifecycleTransitionSchema = z
  .object({
    operation: inboxV2MessageProviderLifecycleOperationReferenceSchema,
    expectedRevision: inboxV2EntityRevisionSchema,
    resultingRevision: inboxV2EntityRevisionSchema,
    outcome: inboxV2ProviderLifecycleOutcomeSchema,
    deleteLocalPolicy: inboxV2ProviderDeleteLocalPolicySchema.nullable(),
    resultProof: inboxV2ProviderOperationResultProofSchema.nullable(),
    recordedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((transition, context) => {
    if (
      BigInt(transition.resultingRevision) !==
      BigInt(transition.expectedRevision) + 1n
    ) {
      addIssue(
        context,
        ["resultingRevision"],
        "Provider lifecycle transition advances one CAS revision."
      );
    }
  });

export const inboxV2MessageProviderLifecycleTransitionCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    before: inboxV2MessageProviderLifecycleOperationSchema,
    transition: inboxV2MessageProviderLifecycleTransitionSchema,
    after: inboxV2MessageProviderLifecycleOperationSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const { before, transition, after } = commit;
    if (
      commit.tenantId !== before.tenantId ||
      commit.tenantId !== after.tenantId ||
      transition.operation.tenantId !== commit.tenantId ||
      transition.operation.id !== before.id ||
      before.id !== after.id ||
      before.revision !== transition.expectedRevision ||
      after.revision !== transition.resultingRevision ||
      after.updatedAt !== transition.recordedAt ||
      Date.parse(transition.recordedAt) < Date.parse(before.updatedAt) ||
      !sameValue(after.outcome, transition.outcome) ||
      !sameValue(after.deleteLocalPolicy, transition.deleteLocalPolicy) ||
      !sameValue(
        providerOperationIdentity(before),
        providerOperationIdentity(after)
      )
    ) {
      addIssue(
        context,
        ["after"],
        "Provider lifecycle CAS may update only outcome/policy and revision time."
      );
    }
    if (
      sameValue(before.outcome, after.outcome) &&
      sameValue(before.deleteLocalPolicy, after.deleteLocalPolicy)
    ) {
      addIssue(
        context,
        ["after"],
        "Provider lifecycle transition cannot be a semantic no-op."
      );
    }
    if (!isProviderOutcomeTransitionAllowed(before, after)) {
      addIssue(
        context,
        ["after", "outcome"],
        "Provider lifecycle outcome cannot regress or cross origin semantics."
      );
    }
    addProviderResultProofIssues(context, before, transition, after);
    if (
      !isProviderDeletePolicyTransitionAllowed(
        before.deleteLocalPolicy,
        after.deleteLocalPolicy
      )
    ) {
      addIssue(
        context,
        ["after", "deleteLocalPolicy"],
        "A decided provider-delete local policy is immutable."
      );
    }
  });

export const inboxV2MessageProviderLifecycleOperationEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
    INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
    inboxV2MessageProviderLifecycleOperationSchema
  );
export const inboxV2MessageProviderLifecycleOperationCreationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_CREATION_COMMIT_SCHEMA_ID,
    INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
    inboxV2MessageProviderLifecycleOperationCreationCommitSchema
  );
export const inboxV2MessageProviderLifecycleTransitionCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_TRANSITION_COMMIT_SCHEMA_ID,
    INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
    inboxV2MessageProviderLifecycleTransitionCommitSchema
  );

export type InboxV2MessageProviderLifecycleOperation = z.infer<
  typeof inboxV2MessageProviderLifecycleOperationSchema
>;
export type InboxV2MessageProviderLifecycleOperationCreationCommit = z.infer<
  typeof inboxV2MessageProviderLifecycleOperationCreationCommitSchema
>;

function providerOperationIdentity(
  operation: InboxV2MessageProviderLifecycleOperation
): unknown {
  const {
    outcome: _outcome,
    deleteLocalPolicy: _deleteLocalPolicy,
    revision: _revision,
    updatedAt: _updatedAt,
    ...identity
  } = operation;
  return identity;
}

function isProviderOutcomeTransitionAllowed(
  before: InboxV2MessageProviderLifecycleOperation,
  after: InboxV2MessageProviderLifecycleOperation
): boolean {
  if (sameValue(before.outcome, after.outcome)) {
    return true;
  }
  if (before.origin === "provider_observed") {
    return false;
  }
  switch (before.outcome.state) {
    case "pending":
      return (
        after.outcome.state === "accepted" ||
        after.outcome.state === "confirmed" ||
        after.outcome.state === "failed" ||
        after.outcome.state === "unsupported" ||
        after.outcome.state === "outcome_unknown"
      );
    case "accepted":
      return (
        after.outcome.state === "confirmed" ||
        after.outcome.state === "failed" ||
        after.outcome.state === "outcome_unknown"
      );
    case "outcome_unknown":
      return (
        after.outcome.state === "confirmed" || after.outcome.state === "failed"
      );
    case "failed":
      return false;
    case "confirmed":
    case "unsupported":
    case "observed":
      return false;
  }
}

function addProviderResultProofIssues(
  context: z.RefinementCtx,
  before: InboxV2MessageProviderLifecycleOperation,
  transition: z.infer<typeof inboxV2MessageProviderLifecycleTransitionSchema>,
  after: InboxV2MessageProviderLifecycleOperation
): void {
  const outcomeChanged = !sameValue(before.outcome, after.outcome);
  const proof = transition.resultProof;
  if (!outcomeChanged) {
    if (proof !== null) {
      addIssue(
        context,
        ["transition", "resultProof"],
        "A policy-only lifecycle transition cannot carry an unrelated provider result."
      );
    }
    return;
  }
  if (
    before.origin !== "hulee_requested" ||
    before.outboundRoute === null ||
    proof === null ||
    after.outcome.state === "pending" ||
    after.outcome.state === "observed" ||
    proof.tenantId !== before.tenantId ||
    proof.operation.id !== before.id ||
    proof.outboundRoute.id !== before.outboundRoute.id ||
    !sameValue(proof.adapterContract, before.adapterContract) ||
    proof.capabilityId !== expectedLifecycleCapabilityId(before.action) ||
    proof.capabilityRevision !== before.capabilityRevision ||
    proof.resultState !== after.outcome.state ||
    proof.semanticId !==
      `core:message.lifecycle.${before.action}.result.${after.outcome.state}` ||
    proof.recordedAt !== transition.recordedAt
  ) {
    addIssue(
      context,
      ["transition", "resultProof"],
      "Every Hulee-requested provider outcome requires the exact trusted operation result proof."
    );
  }
}

function expectedLifecycleCapabilityId(action: "edit" | "delete"): string {
  return `core:message-${action}`;
}

function addRequestedActionParticipantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  message: z.infer<typeof inboxV2MessageSchema>,
  operation: InboxV2MessageProviderLifecycleOperation,
  participant: z.infer<typeof inboxV2ConversationParticipantSchema> | null
): void {
  if (operation.origin !== "hulee_requested") {
    return;
  }
  const reference = operation.actionParticipant;
  if ((reference === null) !== (participant === null)) {
    addIssue(
      context,
      ["actionParticipantSnapshot"],
      "Represented Hulee lifecycle participant requires one exact bounded snapshot."
    );
    return;
  }
  if (reference === null || participant === null) {
    return;
  }
  const actorMatches =
    operation.appActor?.kind === "employee"
      ? participant.subject.kind === "employee" &&
        participant.subject.employee.id === operation.appActor.employee.id
      : operation.appActor?.kind === "trusted_service" &&
        participant.subject.kind === "bot";
  if (
    participant.tenantId !== tenantId ||
    participant.id !== reference.id ||
    participant.conversation.id !== message.conversation.id ||
    !actorMatches ||
    Date.parse(participant.createdAt) > Date.parse(operation.occurredAt) ||
    Date.parse(participant.updatedAt) > Date.parse(operation.occurredAt)
  ) {
    addIssue(
      context,
      ["actionParticipantSnapshot"],
      "Hulee lifecycle participant must be the exact same-Conversation Employee/bot effective at action time."
    );
  }
}

function outboundBindingSupportsLifecycleAction(
  binding: z.infer<typeof inboxV2SourceThreadBindingSchema>,
  route: z.infer<typeof inboxV2OutboundRouteSchema>,
  operation: InboxV2MessageProviderLifecycleOperation,
  at: string
): boolean {
  const fence = route.bindingFence;
  const capability = binding.capabilities.entries.find(
    (entry) =>
      entry.capabilityId === expectedLifecycleCapabilityId(operation.action) &&
      entry.operationId === route.operationId &&
      entry.contentKindId === route.contentKindId &&
      entry.state === "supported" &&
      (entry.validUntil === null ||
        Date.parse(entry.validUntil) > Date.parse(at))
  );
  return (
    binding.tenantId === operation.tenantId &&
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
    binding.routeDescriptor.descriptorRevision ===
      fence.routeDescriptorRevision &&
    operation.capabilityRevision === binding.capabilities.revision &&
    binding.remoteAccess.state === "active" &&
    binding.administrative.state === "enabled" &&
    binding.runtimeHealth.state === "ready" &&
    Date.parse(binding.updatedAt) <= Date.parse(at) &&
    Date.parse(binding.capabilities.capturedAt) <= Date.parse(at) &&
    sameValue(binding.capabilities.adapterContract, route.adapterContract) &&
    sameValue(binding.routeDescriptor, route.routeDescriptor) &&
    capability !== undefined &&
    capability.requiredProviderRoleIds.every((roleId) =>
      binding.providerAccess.roleIds.includes(roleId)
    )
  );
}

function expectedLifecycleRouteAuthority(action: "edit" | "delete"): {
  operationId: string;
  permissionId: string;
} {
  return {
    operationId: `core:message.${action}`,
    permissionId: `core:message.${action}_external`
  };
}

function isProviderDeletePolicyTransitionAllowed(
  before: InboxV2MessageProviderLifecycleOperation["deleteLocalPolicy"],
  after: InboxV2MessageProviderLifecycleOperation["deleteLocalPolicy"]
): boolean {
  if (before === null || after === null || sameValue(before, after)) {
    return before === after || sameValue(before, after);
  }
  return before.effect === "not_evaluated";
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameAppPrincipal(
  principal: z.infer<typeof inboxV2OutboundRouteSchema>["principal"],
  actor: z.infer<typeof inboxV2AppActorSchema> | null
): boolean {
  if (actor === null || principal.kind !== actor.kind) {
    return false;
  }
  return principal.kind === "employee"
    ? actor.kind === "employee" && principal.employee.id === actor.employee.id
    : actor.kind === "trusted_service" &&
        principal.trustedServiceId === actor.trustedServiceId;
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
      "Provider lifecycle references must share one tenant."
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
