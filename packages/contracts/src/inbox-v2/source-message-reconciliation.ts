import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ExternalMessageIdentityDeclarationSchema,
  inboxV2ExternalMessageKeySchema,
  inboxV2ExternalReferencePortabilitySchema,
  inboxV2ProviderTimestampSchema,
  inboxV2SourceOccurrenceDescriptorSchema,
  inboxV2SourceOccurrenceProviderActorSchema,
  inboxV2SourceOccurrenceSchema
} from "./external-message-reference";
import {
  inboxV2DeferredMessageSourceActionIdSchema,
  inboxV2ExternalMessageReferenceIdSchema,
  inboxV2MessageIdSchema,
  inboxV2MessageTransportOccurrenceLinkIdSchema,
  inboxV2TimelineItemIdSchema
} from "./ids";
import {
  inboxV2DeferredMessageSourceActionPayloadSchema,
  inboxV2DeferredMessageSourceActionSchema
} from "./message-source-action";
import { inboxV2ProviderSemanticProofSchema } from "./provider-semantic-proof";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2SourceConversationAtomicResolutionResultSchema,
  type InboxV2SourceConversationAtomicResolutionResult
} from "./source-conversation-resolution";
import { inboxV2SourceNormalizationHmacSha256Schema } from "./source-normalized-ingress";
import {
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema
} from "./source-routing-primitives";

export const INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_PLAN_SCHEMA_ID =
  "core:inbox-v2.source-message-reconciliation-plan" as const;
export const INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_SOURCE_MESSAGE_WEAK_CORRELATION_EVIDENCE_MAX = 8;
export const INBOX_V2_SOURCE_MESSAGE_WEAK_CORRELATION_RETENTION_MAX_MS =
  30 * 24 * 60 * 60 * 1000;

type ResolvedSourceConversation = Extract<
  InboxV2SourceConversationAtomicResolutionResult,
  { outcome: "resolved" }
>;

/**
 * The persisted SRC-005 result is the only admissible thread/binding context.
 * A caller cannot replace it with a hand-built Conversation, Client or sender
 * selector.
 */
export const inboxV2ResolvedSourceConversationContextSchema =
  inboxV2SourceConversationAtomicResolutionResultSchema
    .superRefine((result, context) => {
      if (result.outcome !== "resolved") {
        addIssue(
          context,
          [],
          "Message reconciliation requires a resolved canonical SRC-005 context."
        );
      }
    })
    .transform((result) => result as ResolvedSourceConversation);

/**
 * Safe, deliberately non-authoritative evidence. It may help an operator or a
 * later exact-correlation adapter, but it cannot carry a target/reference ID.
 */
export const inboxV2SourceMessageWeakCorrelationEvidenceSchema = z
  .object({
    codeId: inboxV2CatalogIdSchema,
    evidenceHmacSha256: inboxV2SourceNormalizationHmacSha256Schema,
    expiresAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2SourceMessageWeakCorrelationEvidenceListSchema = z
  .array(inboxV2SourceMessageWeakCorrelationEvidenceSchema)
  .max(INBOX_V2_SOURCE_MESSAGE_WEAK_CORRELATION_EVIDENCE_MAX)
  .superRefine((evidenceList, context) => {
    const identities = new Set<string>();
    for (const [index, evidence] of evidenceList.entries()) {
      const identity = `${String(evidence.codeId)}\u0000${evidence.evidenceHmacSha256}`;
      if (identities.has(identity)) {
        addIssue(
          context,
          [index],
          "Weak-correlation evidence must be unique by safe code and HMAC."
        );
      }
      identities.add(identity);
    }
  });

export const inboxV2SourceMessageObservationOriginDescriptorSchema = z
  .object({
    kind: z.enum(["webhook", "stream", "poll", "history", "provider_echo"])
  })
  .strict();

export const inboxV2SourceMessageAdapterIntentDescriptorSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("message_create"),
        transportRole: z.enum(["origin", "native_outbound"])
      })
      .strict(),
    z
      .object({
        kind: z.literal("source_action"),
        action: inboxV2DeferredMessageSourceActionPayloadSchema,
        semanticProof: inboxV2ProviderSemanticProofSchema,
        eventFingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/u)
      })
      .strict(),
    z
      .object({
        kind: z.literal("echo_handoff"),
        transportRole: z.literal("provider_echo")
      })
      .strict()
  ]);

/**
 * Closed adapter-owned descriptor. An exact key is intentionally absent: core
 * derives its scope owner and canonical thread from the persisted SRC-005
 * result. Content, display sender and provider timestamps remain provenance
 * only and cannot participate in canonical reuse.
 */
export const inboxV2SourceMessageAdapterReconciliationDescriptorSchema = z
  .object({
    messageIdentityDeclaration: inboxV2ExternalMessageIdentityDeclarationSchema,
    canonicalExternalSubject: inboxV2OpaqueProviderSubjectSchema,
    occurrence: z
      .object({
        origin: inboxV2SourceMessageObservationOriginDescriptorSchema,
        descriptor: inboxV2SourceOccurrenceDescriptorSchema,
        providerActor: inboxV2SourceOccurrenceProviderActorSchema,
        direction: z.enum(["inbound", "outbound", "system"]),
        providerTimestamps: z.array(inboxV2ProviderTimestampSchema).max(16),
        referencePortability: inboxV2ExternalReferencePortabilitySchema,
        observedAt: inboxV2TimestampSchema
      })
      .strict(),
    intent: inboxV2SourceMessageAdapterIntentDescriptorSchema,
    weakCorrelationEvidence:
      inboxV2SourceMessageWeakCorrelationEvidenceListSchema
  })
  .strict();

export const inboxV2SourceMessageReconciliationRequestSchema = z
  .object({
    context: inboxV2ResolvedSourceConversationContextSchema,
    descriptor: inboxV2SourceMessageAdapterReconciliationDescriptorSchema
  })
  .strict()
  .superRefine((request, context) => {
    const source = request.context.plan.source;
    const descriptor = request.descriptor;
    if (
      !sameValue(
        descriptor.messageIdentityDeclaration.adapterContract,
        source.adapterContract
      ) ||
      !sameValue(
        descriptor.occurrence.descriptor.adapterContract,
        source.adapterContract
      ) ||
      !sameValue(
        descriptor.occurrence.referencePortability.adapterContract,
        source.adapterContract
      )
    ) {
      addIssue(
        context,
        ["descriptor", "messageIdentityDeclaration", "adapterContract"],
        "Message identity, occurrence and portability must retain the exact normalized-event adapter snapshot."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        descriptor.occurrence.observedAt,
        source.recordedAt
      )
    ) {
      addIssue(
        context,
        ["descriptor", "occurrence", "observedAt"],
        "An occurrence cannot be observed after its persisted normalized-event boundary."
      );
    }
  });

const messageCreateIntentSchema = z
  .object({
    kind: z.literal("message_create"),
    transportRole: z.enum(["origin", "native_outbound"]),
    candidateTimelineItemId: inboxV2TimelineItemIdSchema,
    candidateMessageId: inboxV2MessageIdSchema,
    candidateTransportLinkId: inboxV2MessageTransportOccurrenceLinkIdSchema
  })
  .strict();

const sourceActionIntentSchema = z
  .object({
    kind: z.literal("source_action"),
    candidateDeferredActionId: inboxV2DeferredMessageSourceActionIdSchema,
    deferredAction: inboxV2DeferredMessageSourceActionSchema
  })
  .strict();

const echoHandoffIntentSchema = z
  .object({
    kind: z.literal("echo_handoff"),
    transportRole: z.literal("provider_echo"),
    candidateTransportLinkId: inboxV2MessageTransportOccurrenceLinkIdSchema
  })
  .strict();

export const inboxV2SourceMessageReconciliationPlanIntentSchema =
  z.discriminatedUnion("kind", [
    messageCreateIntentSchema,
    sourceActionIntentSchema,
    echoHandoffIntentSchema
  ]);

/**
 * Trusted provider-neutral reconciliation capability. Reference/Message
 * candidates represent one exact provider key; SourceOccurrence and transport
 * link candidates represent one concrete observation.
 */
export const inboxV2SourceMessageReconciliationPlanSchema = z
  .object({
    context: inboxV2ResolvedSourceConversationContextSchema,
    messageKey: inboxV2ExternalMessageKeySchema,
    sourceOccurrence: inboxV2SourceOccurrenceSchema,
    candidateExternalMessageReferenceId:
      inboxV2ExternalMessageReferenceIdSchema,
    intent: inboxV2SourceMessageReconciliationPlanIntentSchema,
    weakCorrelationEvidence:
      inboxV2SourceMessageWeakCorrelationEvidenceListSchema,
    namespaceGeneration: inboxV2RoutingTokenSchema,
    materializedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    materializationToken: inboxV2RoutingTokenSchema,
    materializedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((plan, context) => {
    addPlanContextIssues(context, plan);
    addPlanIntentIssues(context, plan);

    for (const [index, evidence] of plan.weakCorrelationEvidence.entries()) {
      const retentionMs =
        Date.parse(evidence.expiresAt) - Date.parse(plan.materializedAt);
      if (
        !isInboxV2TimestampOrderValid(
          plan.materializedAt,
          evidence.expiresAt
        ) ||
        retentionMs <= 0 ||
        retentionMs > INBOX_V2_SOURCE_MESSAGE_WEAK_CORRELATION_RETENTION_MAX_MS
      ) {
        addIssue(
          context,
          ["weakCorrelationEvidence", index, "expiresAt"],
          "Weak-correlation evidence must expire after materialization and within 30 days."
        );
      }
    }
  });

export const inboxV2SourceMessageReconciliationPlanEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_PLAN_SCHEMA_ID,
    INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_SCHEMA_VERSION,
    inboxV2SourceMessageReconciliationPlanSchema
  );

export type InboxV2ResolvedSourceConversationContext = z.infer<
  typeof inboxV2ResolvedSourceConversationContextSchema
>;
export type InboxV2SourceMessageWeakCorrelationEvidence = z.infer<
  typeof inboxV2SourceMessageWeakCorrelationEvidenceSchema
>;
export type InboxV2SourceMessageObservationOriginDescriptor = z.infer<
  typeof inboxV2SourceMessageObservationOriginDescriptorSchema
>;
export type InboxV2SourceMessageAdapterIntentDescriptor = z.infer<
  typeof inboxV2SourceMessageAdapterIntentDescriptorSchema
>;
export type InboxV2SourceMessageAdapterReconciliationDescriptor = z.infer<
  typeof inboxV2SourceMessageAdapterReconciliationDescriptorSchema
>;
export type InboxV2SourceMessageReconciliationRequest = z.infer<
  typeof inboxV2SourceMessageReconciliationRequestSchema
>;
export type InboxV2SourceMessageReconciliationPlanIntent = z.infer<
  typeof inboxV2SourceMessageReconciliationPlanIntentSchema
>;
export type InboxV2SourceMessageReconciliationPlan = z.infer<
  typeof inboxV2SourceMessageReconciliationPlanSchema
>;

function addPlanContextIssues(
  context: z.RefinementCtx,
  plan: z.infer<typeof inboxV2SourceMessageReconciliationPlanSchema>
): void {
  const source = plan.context.plan.source;
  const mapping = plan.context.externalThreadMapping;
  const binding = plan.context.sourceThreadBinding.binding;
  const occurrence = plan.sourceOccurrence;

  if (
    plan.materializedByTrustedServiceId !==
      source.adapterContract.loadedByTrustedServiceId ||
    !isInboxV2TimestampOrderValid(plan.context.resolvedAt, plan.materializedAt)
  ) {
    addIssue(
      context,
      ["materializedAt"],
      "Reconciliation must be authorized by the pinned trusted service after SRC-005 resolution."
    );
  }
  if (
    occurrence.tenantId !== source.tenantId ||
    !sameValue(occurrence.messageKey, plan.messageKey) ||
    occurrence.messageKey.externalThread.id !== mapping.thread.id ||
    occurrence.bindingContext.externalThread.id !== mapping.thread.id ||
    occurrence.bindingContext.sourceAccount.id !== source.sourceAccount.id ||
    occurrence.bindingContext.sourceThreadBinding.id !== binding.id ||
    occurrence.bindingContext.bindingGeneration !== binding.bindingGeneration ||
    occurrence.recordedAt !== source.recordedAt ||
    occurrence.resolution.state !== "pending" ||
    occurrence.revision !== "1" ||
    occurrence.createdAt !== occurrence.updatedAt
  ) {
    addIssue(
      context,
      ["sourceOccurrence"],
      "Initial occurrence must retain the exact SRC-005 tenant, thread, account, binding generation, normalized record boundary and pending revision."
    );
  }
  if (
    occurrence.origin.sourceAccount.id !== source.sourceAccount.id ||
    occurrence.origin.kind === "provider_response" ||
    occurrence.origin.rawInboundEvent.id !== source.rawInboundEvent.id ||
    occurrence.origin.normalizedInboundEvent.id !==
      source.normalizedInboundEvent.id
  ) {
    addIssue(
      context,
      ["sourceOccurrence", "origin"],
      "Occurrence origin must retain the exact account-scoped raw/normalized SRC-005 observation."
    );
  }
  if (
    !sameValue(
      occurrence.messageIdentityDeclaration.adapterContract,
      source.adapterContract
    ) ||
    !sameValue(occurrence.descriptor.adapterContract, source.adapterContract) ||
    !sameValue(
      occurrence.referencePortability.adapterContract,
      source.adapterContract
    )
  ) {
    addIssue(
      context,
      ["sourceOccurrence", "messageIdentityDeclaration"],
      "Occurrence identity, descriptor and portability must retain the normalized adapter snapshot."
    );
  }
}

function addPlanIntentIssues(
  context: z.RefinementCtx,
  plan: z.infer<typeof inboxV2SourceMessageReconciliationPlanSchema>
): void {
  const originKind = plan.sourceOccurrence.origin.kind;
  const direction = plan.sourceOccurrence.direction;
  const providerActor = plan.sourceOccurrence.providerActor;
  const intent = plan.intent;
  if (intent.kind === "message_create") {
    const validRole =
      (intent.transportRole === "origin" &&
        originKind !== "provider_echo" &&
        originKind !== "provider_response" &&
        direction === "inbound") ||
      (intent.transportRole === "native_outbound" &&
        originKind !== "provider_echo" &&
        originKind !== "provider_response" &&
        direction === "outbound");
    if (providerActor?.kind !== "source_external_identity" || !validRole) {
      addIssue(
        context,
        ["intent", "transportRole"],
        "Message-create role requires one exact source actor and preserves source-originated inbound or unmatched native-outbound semantics."
      );
    }
    return;
  }
  if (intent.kind === "echo_handoff") {
    if (
      intent.transportRole !== originKind ||
      direction !== "outbound" ||
      plan.sourceOccurrence.providerActor !== null
    ) {
      addIssue(
        context,
        ["intent", "transportRole"],
        "Echo handoff must match one exact provider-echo occurrence without selecting a Message target."
      );
    }
    return;
  }

  if (
    originKind === "provider_echo" ||
    originKind === "provider_response" ||
    intent.candidateDeferredActionId !== intent.deferredAction.id ||
    !sameValue(intent.deferredAction.externalMessageKey, plan.messageKey) ||
    !sameValue(intent.deferredAction.sourceOccurrence, plan.sourceOccurrence)
  ) {
    addIssue(
      context,
      ["intent", "deferredAction"],
      "Source action must retain one unresolved exact-key event occurrence and its deterministic action candidate."
    );
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
