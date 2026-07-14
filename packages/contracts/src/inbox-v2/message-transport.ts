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
import { inboxV2ExternalThreadMappingSchema } from "./external-thread";
import {
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2MessageDeliveryObservationIdSchema,
  inboxV2MessageReferenceSchema,
  inboxV2MessageTransportOccurrenceLinkIdSchema,
  inboxV2MessageTransportOccurrenceLinkReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2OutboundDispatchArtifactReferenceSchema,
  inboxV2OutboundDispatchAttemptReferenceSchema,
  inboxV2OutboundDispatchReferenceSchema,
  inboxV2ProviderReceiptObservationIdSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceExternalIdentityReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2MessageSchema } from "./message";
import {
  inboxV2OutboundDispatchArtifactSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchSchema
} from "./outbound-dispatch";
import { inboxV2OutboundRouteSchema } from "./outbound-route";
import { inboxV2ProviderSemanticProofSchema } from "./provider-semantic-proof";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema
} from "./source-routing-primitives";
import { inboxV2SourceThreadBindingSchema } from "./source-thread-binding";
import {
  inboxV2TimelineCounterSchema,
  inboxV2TimelineItemSchema
} from "./timeline";

export const INBOX_V2_MESSAGE_TRANSPORT_OCCURRENCE_LINK_SCHEMA_ID =
  "core:inbox-v2.message-transport-occurrence-link" as const;
export const INBOX_V2_MESSAGE_TRANSPORT_ASSOCIATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.message-transport-association-commit" as const;
export const INBOX_V2_MESSAGE_TRANSPORT_LINK_HEAD_SCHEMA_ID =
  "core:inbox-v2.message-transport-link-head" as const;
export const INBOX_V2_MESSAGE_DELIVERY_OBSERVATION_SCHEMA_ID =
  "core:inbox-v2.message-delivery-observation" as const;
export const INBOX_V2_PROVIDER_RECEIPT_OBSERVATION_SCHEMA_ID =
  "core:inbox-v2.provider-receipt-observation" as const;
export const INBOX_V2_MESSAGE_TRANSPORT_FACT_COMMIT_SCHEMA_ID =
  "core:inbox-v2.message-transport-fact-commit" as const;
export const INBOX_V2_MESSAGE_TRANSPORT_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2TransportCapabilityIdSchema = inboxV2CatalogIdSchema;
export const inboxV2TransportEvidenceKindIdSchema = inboxV2CatalogIdSchema;
export const inboxV2TransportFailureReasonIdSchema = inboxV2CatalogIdSchema;

export const inboxV2MessageTransportOccurrenceLinkSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2MessageTransportOccurrenceLinkIdSchema,
    message: inboxV2MessageReferenceSchema,
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
    role: z.enum([
      "origin",
      "provider_echo",
      "provider_response",
      "native_outbound",
      "additional_artifact"
    ]),
    revision: z.literal("1"),
    linkedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((link, context) => {
    for (const [field, reference] of [
      ["message", link.message],
      ["sourceOccurrence", link.sourceOccurrence],
      ["externalMessageReference", link.externalMessageReference]
    ] as const) {
      addTenantReferenceIssue(context, link.tenantId, reference, [field]);
    }
  });

/** Independent relation head; provider echoes never serialize the Message row. */
export const inboxV2MessageTransportLinkHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    message: inboxV2MessageReferenceSchema,
    linkCount: inboxV2TimelineCounterSchema,
    latestLink: inboxV2MessageTransportOccurrenceLinkReferenceSchema,
    revision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    addTenantReferenceIssue(context, head.tenantId, head.message, ["message"]);
    addTenantReferenceIssue(context, head.tenantId, head.latestLink, [
      "latestLink"
    ]);
    if (head.linkCount === "0") {
      addIssue(
        context,
        ["linkCount"],
        "A materialized transport-link head contains at least one link."
      );
    }
  });

export const inboxV2MessageTransportAssociationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    message: inboxV2MessageSchema,
    timelineItem: inboxV2TimelineItemSchema,
    linkHeadBefore: inboxV2MessageTransportLinkHeadSchema.nullable(),
    sourceOccurrence: inboxV2SourceOccurrenceSchema,
    externalMessageReference: inboxV2ExternalMessageReferenceSchema,
    externalThreadMapping: inboxV2ExternalThreadMappingSchema,
    occurrenceBinding: inboxV2SourceThreadBindingSchema,
    messageOriginProof: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("hulee_outbound"),
          outboundRoute: inboxV2OutboundRouteSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("source_originated"),
          originOccurrence: inboxV2SourceOccurrenceSchema
        })
        .strict()
    ]),
    link: inboxV2MessageTransportOccurrenceLinkSchema,
    linkHeadAfter: inboxV2MessageTransportLinkHeadSchema,
    committedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const { message, timelineItem, sourceOccurrence } = commit;
    if (
      commit.tenantId !== message.tenantId ||
      commit.tenantId !== sourceOccurrence.tenantId ||
      commit.tenantId !== commit.externalMessageReference.tenantId ||
      commit.tenantId !== commit.externalThreadMapping.tenantId ||
      commit.tenantId !== commit.occurrenceBinding.tenantId ||
      commit.tenantId !== commit.link.tenantId ||
      commit.link.message.id !== message.id ||
      commit.link.sourceOccurrence.id !== sourceOccurrence.id ||
      commit.link.externalMessageReference.id !==
        commit.externalMessageReference.id ||
      commit.link.linkedAt !== commit.committedAt ||
      commit.externalMessageReference.message.id !== message.id ||
      commit.externalMessageReference.timelineItem.id !==
        message.timelineItem.id ||
      !sameValue(
        commit.externalMessageReference.key,
        sourceOccurrence.messageKey
      ) ||
      !sameValue(
        commit.externalMessageReference.identityDeclaration,
        sourceOccurrence.messageIdentityDeclaration
      ) ||
      sourceOccurrence.resolution.state !== "resolved" ||
      sourceOccurrence.resolution.externalMessageReference.id !==
        commit.externalMessageReference.id ||
      commit.externalThreadMapping.thread.id !==
        sourceOccurrence.bindingContext.externalThread.id ||
      commit.externalThreadMapping.conversation.id !==
        message.conversation.id ||
      !sameValue(
        commit.externalThreadMapping.thread.identityDeclaration.adapterContract,
        sourceOccurrence.descriptor.adapterContract
      ) ||
      commit.externalMessageReference.externalThread.id !==
        commit.externalThreadMapping.thread.id ||
      commit.occurrenceBinding.id !==
        sourceOccurrence.bindingContext.sourceThreadBinding.id ||
      commit.occurrenceBinding.externalThread.id !==
        sourceOccurrence.bindingContext.externalThread.id ||
      commit.occurrenceBinding.sourceAccount.id !==
        sourceOccurrence.bindingContext.sourceAccount.id ||
      commit.occurrenceBinding.bindingGeneration !==
        sourceOccurrence.bindingContext.bindingGeneration ||
      commit.occurrenceBinding.capabilities.revision !==
        sourceOccurrence.descriptor.capabilityRevision ||
      !sameValue(
        commit.occurrenceBinding.capabilities.adapterContract,
        sourceOccurrence.descriptor.adapterContract
      ) ||
      timelineItem.tenantId !== commit.tenantId ||
      timelineItem.id !== message.timelineItem.id ||
      timelineItem.conversation.id !== message.conversation.id ||
      timelineItem.subject.kind !== "message" ||
      timelineItem.subject.message.id !== message.id ||
      timelineItem.subject.messageRevision !== message.revision
    ) {
      addIssue(
        context,
        ["message"],
        "Transport association targets one exact immutable Message/Timeline relationship."
      );
    }
    addTransportAssociationOriginIssues(context, commit);
    addTransportLinkHeadIssues(context, commit);
  });

const transportScopeFields = {
  sourceAccount: inboxV2SourceAccountReferenceSchema,
  sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
  bindingGeneration: inboxV2EntityRevisionSchema
} as const;

export const inboxV2MessageDeliveryEvidenceSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("provider_result"),
        attempt: inboxV2OutboundDispatchAttemptReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_artifact"),
        attempt: inboxV2OutboundDispatchAttemptReferenceSchema,
        artifact: inboxV2OutboundDispatchArtifactReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_event"),
        normalizedInboundEvent: inboxV2NormalizedInboundEventReferenceSchema,
        externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
        sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema
      })
      .strict()
  ]
);

export const inboxV2MessageDeliveryObservationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2MessageDeliveryObservationIdSchema,
    message: inboxV2MessageReferenceSchema,
    fact: z.enum(["accepted", "sent", "delivered", "failed"]),
    scope: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("dispatch"),
          dispatch: inboxV2OutboundDispatchReferenceSchema,
          attempt: inboxV2OutboundDispatchAttemptReferenceSchema.nullable(),
          artifact: inboxV2OutboundDispatchArtifactReferenceSchema.nullable()
        })
        .strict(),
      z
        .object({
          kind: z.literal("external_reference"),
          externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
          sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("recipient"),
          externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
          recipient: inboxV2SourceExternalIdentityReferenceSchema
        })
        .strict()
    ]),
    ...transportScopeFields,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    capabilityId: inboxV2TransportCapabilityIdSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    evidence: inboxV2MessageDeliveryEvidenceSchema,
    semanticProof: inboxV2ProviderSemanticProofSchema.nullable(),
    evidenceKindId: inboxV2TransportEvidenceKindIdSchema,
    evidenceDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    failureReasonId: inboxV2TransportFailureReasonIdSchema.nullable(),
    observedAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    revision: z.literal("1")
  })
  .strict()
  .superRefine((observation, context) => {
    addTransportScopeTenantIssues(context, observation);
    addTenantReferenceIssue(
      context,
      observation.tenantId,
      observation.message,
      ["message"]
    );
    addDeliveryScopeTenantIssues(context, observation);
    addDeliveryEvidenceTenantIssues(context, observation);
    addDeliverySemanticProofIssues(context, observation);
    if (
      (observation.fact === "failed") !==
      (observation.failureReasonId !== null)
    ) {
      addIssue(
        context,
        ["failureReasonId"],
        "Only failed provider delivery has a failure reason."
      );
    }
    if (
      (observation.fact === "sent" || observation.fact === "delivered") &&
      observation.evidence.kind !== "provider_event"
    ) {
      addIssue(
        context,
        ["evidence"],
        "Sent/delivered require an explicit normalized provider event; an attempt result proves only accepted/failed."
      );
    }
    if (
      observation.scope.kind !== "dispatch" &&
      observation.evidence.kind !== "provider_event"
    ) {
      addIssue(
        context,
        ["evidence"],
        "Non-dispatch delivery scope requires explicit provider-event evidence."
      );
    }
    if (
      observation.scope.kind === "dispatch" &&
      ((observation.evidence.kind === "provider_result" &&
        observation.scope.attempt?.id !== observation.evidence.attempt.id) ||
        (observation.evidence.kind === "provider_artifact" &&
          (observation.scope.attempt?.id !== observation.evidence.attempt.id ||
            observation.scope.artifact?.id !==
              observation.evidence.artifact.id)))
    ) {
      addIssue(
        context,
        ["scope"],
        "Dispatch delivery scope must expose the exact attempt/artifact used as evidence."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        observation.observedAt,
        observation.recordedAt
      )
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "Delivery fact cannot be recorded before it is observed."
      );
    }
  });

export const inboxV2ProviderReceiptReaderSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("source_external_identity"),
      sourceExternalIdentity: inboxV2SourceExternalIdentityReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("aggregate_only"),
      aggregateKey: inboxV2OpaqueProviderSubjectSchema
    })
    .strict()
]);

export const inboxV2ProviderReceiptObservationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ProviderReceiptObservationIdSchema,
    fact: z.literal("read"),
    target: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("exact_message"),
          message: inboxV2MessageReferenceSchema,
          externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
          sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("provider_watermark"),
          watermark: inboxV2OpaqueProviderSubjectSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("thread_readmark"),
          readThroughProviderTime: inboxV2TimestampSchema
        })
        .strict()
    ]),
    reader: inboxV2ProviderReceiptReaderSchema,
    ...transportScopeFields,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    capabilityId: inboxV2TransportCapabilityIdSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    evidenceEvent: inboxV2NormalizedInboundEventReferenceSchema,
    semanticProof: inboxV2ProviderSemanticProofSchema,
    evidenceKindId: inboxV2TransportEvidenceKindIdSchema,
    evidenceDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    observedAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    revision: z.literal("1")
  })
  .strict()
  .superRefine((receipt, context) => {
    addTransportScopeTenantIssues(context, receipt);
    addReceiptSemanticProofIssues(context, receipt);
    addTenantReferenceIssue(context, receipt.tenantId, receipt.evidenceEvent, [
      "evidenceEvent"
    ]);
    if (receipt.target.kind === "exact_message") {
      addTenantReferenceIssue(
        context,
        receipt.tenantId,
        receipt.target.message,
        ["target", "message"]
      );
      addTenantReferenceIssue(
        context,
        receipt.tenantId,
        receipt.target.externalMessageReference,
        ["target", "externalMessageReference"]
      );
      addTenantReferenceIssue(
        context,
        receipt.tenantId,
        receipt.target.sourceOccurrence,
        ["target", "sourceOccurrence"]
      );
    }
    if (receipt.reader.kind === "source_external_identity") {
      addTenantReferenceIssue(
        context,
        receipt.tenantId,
        receipt.reader.sourceExternalIdentity,
        ["reader", "sourceExternalIdentity"]
      );
    }
    if (!isInboxV2TimestampOrderValid(receipt.observedAt, receipt.recordedAt)) {
      addIssue(
        context,
        ["recordedAt"],
        "Provider receipt cannot be recorded before it is observed."
      );
    }
  });

export const inboxV2MessageTransportFactSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("delivery"),
      observation: inboxV2MessageDeliveryObservationSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("receipt"),
      observation: inboxV2ProviderReceiptObservationSchema
    })
    .strict()
]);

export const inboxV2MessageTransportFactEvidenceSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("dispatch"),
        dispatch: inboxV2OutboundDispatchSchema,
        route: inboxV2OutboundRouteSchema,
        externalThreadMapping: inboxV2ExternalThreadMappingSchema,
        attempt: inboxV2OutboundDispatchAttemptSchema.nullable(),
        artifact: inboxV2OutboundDispatchArtifactSchema.nullable(),
        externalMessageReference:
          inboxV2ExternalMessageReferenceSchema.nullable(),
        sourceOccurrence: inboxV2SourceOccurrenceSchema.nullable()
      })
      .strict(),
    z
      .object({
        kind: z.literal("external_reference"),
        externalMessageReference: inboxV2ExternalMessageReferenceSchema,
        sourceOccurrence: inboxV2SourceOccurrenceSchema,
        externalThreadMapping: inboxV2ExternalThreadMappingSchema
      })
      .strict()
  ]
);

export const inboxV2MessageTransportFactCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    beforeMessage: inboxV2MessageSchema,
    beforeTimelineItem: inboxV2TimelineItemSchema,
    fact: inboxV2MessageTransportFactSchema,
    transportEvidence: inboxV2MessageTransportFactEvidenceSchema,
    commitToken: inboxV2RoutingTokenSchema,
    committedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const targetMessage =
      commit.fact.kind === "delivery"
        ? commit.fact.observation.message
        : commit.fact.observation.target.kind === "exact_message"
          ? commit.fact.observation.target.message
          : null;
    if (targetMessage === null) {
      addIssue(
        context,
        ["fact"],
        "Watermark/thread receipts require bounded projection before a Message head commit."
      );
      return;
    }
    const { beforeMessage: before, beforeTimelineItem: timelineItem } = commit;
    const outboundMessage =
      before.origin.kind === "hulee_external" ||
      (before.origin.kind === "source_originated" &&
        before.origin.direction === "outbound");
    if (
      commit.tenantId !== before.tenantId ||
      commit.tenantId !== commit.fact.observation.tenantId ||
      targetMessage.id !== before.id ||
      commit.fact.observation.recordedAt !== commit.committedAt ||
      !outboundMessage ||
      timelineItem.tenantId !== commit.tenantId ||
      timelineItem.id !== before.timelineItem.id ||
      timelineItem.conversation.id !== before.conversation.id ||
      timelineItem.subject.kind !== "message" ||
      timelineItem.subject.message.id !== before.id ||
      timelineItem.subject.messageRevision !== before.revision
    ) {
      addIssue(
        context,
        ["beforeMessage"],
        "One append-only evidence-backed provider fact targets an exact outbound Message without mutating its hot row."
      );
    }
    addTransportFactEvidenceIssues(context, commit);
  });

export const inboxV2MessageTransportFactPageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    message: inboxV2MessageReferenceSchema,
    facts: z.array(inboxV2MessageTransportFactSchema).max(200),
    snapshotToken: inboxV2RoutingTokenSchema,
    nextCursor: z.string().min(1).max(2_048).nullable()
  })
  .strict()
  .superRefine((page, context) => {
    addTenantReferenceIssue(context, page.tenantId, page.message, ["message"]);
    const observationIds = new Set<string>();
    let previousSortKey: string | null = null;
    for (const [index, fact] of page.facts.entries()) {
      const observation = fact.observation;
      const observationKey = `${fact.kind}:${observation.id}`;
      const sortKey = `${observation.recordedAt}:${observationKey}`;
      if (observation.tenantId !== page.tenantId) {
        addIssue(
          context,
          ["facts", index],
          "Transport fact page and observations must share one tenant."
        );
      }
      if (
        observationIds.has(observationKey) ||
        (previousSortKey !== null && sortKey <= previousSortKey)
      ) {
        addIssue(
          context,
          ["facts", index],
          "Transport fact page contains unique observations in stable recorded-time/id order."
        );
      }
      observationIds.add(observationKey);
      previousSortKey = sortKey;
      const exactMessage =
        fact.kind === "delivery"
          ? fact.observation.message
          : fact.observation.target.kind === "exact_message"
            ? fact.observation.target.message
            : null;
      if (exactMessage === null) {
        addIssue(
          context,
          ["facts", index],
          "Range receipt must be projected before entering an exact Message fact page."
        );
      } else if (exactMessage.id !== page.message.id) {
        addIssue(
          context,
          ["facts", index],
          "Exact transport facts must reference the page Message."
        );
      }
    }
  });

export const inboxV2MessageTransportOccurrenceLinkEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_TRANSPORT_OCCURRENCE_LINK_SCHEMA_ID,
    INBOX_V2_MESSAGE_TRANSPORT_SCHEMA_VERSION,
    inboxV2MessageTransportOccurrenceLinkSchema
  );
export const inboxV2MessageTransportLinkHeadEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_TRANSPORT_LINK_HEAD_SCHEMA_ID,
    INBOX_V2_MESSAGE_TRANSPORT_SCHEMA_VERSION,
    inboxV2MessageTransportLinkHeadSchema
  );
export const inboxV2MessageTransportAssociationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_TRANSPORT_ASSOCIATION_COMMIT_SCHEMA_ID,
    INBOX_V2_MESSAGE_TRANSPORT_SCHEMA_VERSION,
    inboxV2MessageTransportAssociationCommitSchema
  );
export const inboxV2MessageDeliveryObservationEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_DELIVERY_OBSERVATION_SCHEMA_ID,
    INBOX_V2_MESSAGE_TRANSPORT_SCHEMA_VERSION,
    inboxV2MessageDeliveryObservationSchema
  );
export const inboxV2ProviderReceiptObservationEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROVIDER_RECEIPT_OBSERVATION_SCHEMA_ID,
    INBOX_V2_MESSAGE_TRANSPORT_SCHEMA_VERSION,
    inboxV2ProviderReceiptObservationSchema
  );
export const inboxV2MessageTransportFactCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_TRANSPORT_FACT_COMMIT_SCHEMA_ID,
    INBOX_V2_MESSAGE_TRANSPORT_SCHEMA_VERSION,
    inboxV2MessageTransportFactCommitSchema
  );

export type InboxV2MessageTransportOccurrenceLink = z.infer<
  typeof inboxV2MessageTransportOccurrenceLinkSchema
>;
export type InboxV2MessageTransportLinkHead = z.infer<
  typeof inboxV2MessageTransportLinkHeadSchema
>;
export type InboxV2MessageDeliveryObservation = z.infer<
  typeof inboxV2MessageDeliveryObservationSchema
>;
export type InboxV2ProviderReceiptObservation = z.infer<
  typeof inboxV2ProviderReceiptObservationSchema
>;

function addTransportFactEvidenceIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageTransportFactCommitSchema>
): void {
  const {
    fact,
    transportEvidence: evidence,
    beforeMessage,
    beforeTimelineItem
  } = commit;
  const observation = fact.observation;
  if (evidence.kind === "dispatch") {
    if (
      fact.kind !== "delivery" ||
      fact.observation.scope.kind !== "dispatch"
    ) {
      addIssue(
        context,
        ["transportEvidence"],
        "Dispatch evidence is valid only for a dispatch-scoped delivery fact."
      );
      return;
    }
    const scope = fact.observation.scope;
    const {
      dispatch,
      route,
      externalThreadMapping,
      attempt,
      artifact,
      externalMessageReference,
      sourceOccurrence
    } = evidence;
    const deliveryEvidence = fact.observation.evidence;
    const providerResultValid =
      deliveryEvidence.kind === "provider_result" &&
      attempt !== null &&
      artifact === null &&
      externalMessageReference === null &&
      sourceOccurrence === null &&
      deliveryEvidence.attempt.id === attempt.id &&
      ((fact.observation.fact === "accepted" &&
        attempt.outcome.kind === "accepted") ||
        (fact.observation.fact === "failed" &&
          (attempt.outcome.kind === "retryable_failure" ||
            attempt.outcome.kind === "terminal_failure")));
    const providerArtifactValid =
      deliveryEvidence.kind === "provider_artifact" &&
      attempt !== null &&
      artifact !== null &&
      externalMessageReference === null &&
      sourceOccurrence === null &&
      deliveryEvidence.attempt.id === attempt.id &&
      deliveryEvidence.artifact.id === artifact.id &&
      ((fact.observation.fact === "accepted" &&
        artifact.state === "accepted") ||
        (fact.observation.fact === "failed" && artifact.state === "failed"));
    const providerEventValid =
      deliveryEvidence.kind === "provider_event" &&
      externalMessageReference !== null &&
      sourceOccurrence !== null &&
      deliveryEvidence.externalMessageReference.id ===
        externalMessageReference.id &&
      deliveryEvidence.sourceOccurrence.id === sourceOccurrence.id &&
      sourceOccurrence.origin.kind === "provider_echo" &&
      deliveryEvidence.normalizedInboundEvent.id ===
        sourceOccurrence.origin.normalizedInboundEvent.id &&
      externalMessageReference.message.id === beforeMessage.id &&
      externalMessageReference.timelineItem.id === beforeTimelineItem.id &&
      sourceOccurrence.resolution.state === "resolved" &&
      sourceOccurrence.resolution.externalMessageReference.id ===
        externalMessageReference.id &&
      sourceOccurrence.direction === "outbound" &&
      sameValue(sourceOccurrence.messageKey, externalMessageReference.key) &&
      sourceOccurrence.bindingContext.sourceAccount.id ===
        observation.sourceAccount.id &&
      sourceOccurrence.bindingContext.sourceThreadBinding.id ===
        observation.sourceThreadBinding.id &&
      sourceOccurrence.bindingContext.bindingGeneration ===
        observation.bindingGeneration &&
      sameValue(
        sourceOccurrence.descriptor.adapterContract,
        observation.adapterContract
      );
    if (
      dispatch.tenantId !== commit.tenantId ||
      route.tenantId !== commit.tenantId ||
      externalThreadMapping.tenantId !== commit.tenantId ||
      externalThreadMapping.thread.id !== route.externalThread.id ||
      externalThreadMapping.conversation.id !== beforeMessage.conversation.id ||
      dispatch.id !== scope.dispatch.id ||
      dispatch.message.id !== beforeMessage.id ||
      dispatch.route.id !== route.id ||
      beforeMessage.origin.kind !== "hulee_external" ||
      beforeMessage.origin.outboundRoute.id !== route.id ||
      route.conversation.id !== beforeMessage.conversation.id ||
      route.sourceAccount.id !== observation.sourceAccount.id ||
      route.sourceThreadBinding.id !== observation.sourceThreadBinding.id ||
      route.bindingFence.bindingGeneration !== observation.bindingGeneration ||
      !sameValue(route.adapterContract, observation.adapterContract) ||
      dispatch.state === "queued" ||
      attempt === null ||
      dispatch.lastAttempt?.id !== attempt.id ||
      dispatch.attemptCount < attempt.attemptNumber ||
      attempt.tenantId !== commit.tenantId ||
      (artifact !== null && artifact.tenantId !== commit.tenantId) ||
      (scope.attempt === null) !== (attempt === null) ||
      (scope.artifact === null) !== (artifact === null) ||
      (attempt !== null &&
        (scope.attempt?.id !== attempt.id ||
          attempt.dispatch.id !== dispatch.id ||
          attempt.route.id !== route.id)) ||
      (artifact !== null &&
        (scope.artifact?.id !== artifact.id ||
          artifact.dispatch.id !== dispatch.id ||
          artifact.route.id !== route.id ||
          attempt === null ||
          artifact.attempt.id !== attempt.id)) ||
      (!providerResultValid && !providerArtifactValid && !providerEventValid)
    ) {
      addIssue(
        context,
        ["transportEvidence"],
        "Delivery fact must prove the exact Message dispatch, attempt/artifact and pinned route."
      );
    }
    return;
  }

  if (fact.kind === "delivery" && fact.observation.scope.kind === "dispatch") {
    addIssue(
      context,
      ["transportEvidence"],
      "Dispatch-scoped delivery cannot use external-reference evidence."
    );
    return;
  }
  const { externalMessageReference, sourceOccurrence, externalThreadMapping } =
    evidence;
  if (
    externalMessageReference.tenantId !== commit.tenantId ||
    sourceOccurrence.tenantId !== commit.tenantId ||
    externalThreadMapping.tenantId !== commit.tenantId ||
    externalThreadMapping.thread.id !==
      sourceOccurrence.bindingContext.externalThread.id ||
    externalThreadMapping.conversation.id !== beforeMessage.conversation.id ||
    externalMessageReference.message.id !== beforeMessage.id ||
    externalMessageReference.timelineItem.id !== beforeTimelineItem.id ||
    sourceOccurrence.resolution.state !== "resolved" ||
    sourceOccurrence.resolution.externalMessageReference.id !==
      externalMessageReference.id ||
    !sameValue(sourceOccurrence.messageKey, externalMessageReference.key) ||
    sourceOccurrence.bindingContext.sourceAccount.id !==
      observation.sourceAccount.id ||
    sourceOccurrence.bindingContext.sourceThreadBinding.id !==
      observation.sourceThreadBinding.id ||
    sourceOccurrence.bindingContext.bindingGeneration !==
      observation.bindingGeneration ||
    !sameValue(
      sourceOccurrence.descriptor.adapterContract,
      observation.adapterContract
    )
  ) {
    addIssue(
      context,
      ["transportEvidence"],
      "Provider fact must resolve one canonical Message and exact account/binding generation."
    );
  }

  if (fact.kind === "delivery") {
    const scope = fact.observation.scope;
    if (
      fact.observation.evidence.kind !== "provider_event" ||
      sourceOccurrence.origin.kind === "provider_response" ||
      fact.observation.evidence.normalizedInboundEvent.id !==
        sourceOccurrence.origin.normalizedInboundEvent.id ||
      fact.observation.evidence.externalMessageReference.id !==
        externalMessageReference.id ||
      fact.observation.evidence.sourceOccurrence.id !== sourceOccurrence.id ||
      (scope.kind === "external_reference" &&
        (scope.externalMessageReference.id !== externalMessageReference.id ||
          scope.sourceOccurrence.id !== sourceOccurrence.id)) ||
      (scope.kind === "recipient" &&
        scope.externalMessageReference.id !== externalMessageReference.id)
    ) {
      addIssue(
        context,
        ["fact", "observation", "scope"],
        "Delivery scope and external transport evidence must identify the same provider Message."
      );
    }
    return;
  }

  if (
    fact.observation.target.kind !== "exact_message" ||
    fact.observation.target.externalMessageReference.id !==
      externalMessageReference.id ||
    fact.observation.target.sourceOccurrence.id !== sourceOccurrence.id ||
    sourceOccurrence.origin.kind === "provider_response" ||
    fact.observation.evidenceEvent.id !==
      sourceOccurrence.origin.normalizedInboundEvent.id ||
    (sourceOccurrence.providerActor?.kind === "source_external_identity"
      ? fact.observation.reader.kind !== "source_external_identity" ||
        fact.observation.reader.sourceExternalIdentity.id !==
          sourceOccurrence.providerActor.sourceExternalIdentity.id
      : fact.observation.reader.kind === "source_external_identity")
  ) {
    addIssue(
      context,
      ["fact", "observation", "target"],
      "Exact receipt target and external transport evidence must identify the same provider Message."
    );
  }
}

function addTransportAssociationOriginIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageTransportAssociationCommitSchema>
): void {
  const { message, messageOriginProof, sourceOccurrence, link } = commit;

  if (message.origin.kind === "hulee_external") {
    if (messageOriginProof.kind !== "hulee_outbound") {
      addIssue(
        context,
        ["messageOriginProof"],
        "A Hulee outbound Message association requires its exact immutable route proof."
      );
      return;
    }

    const route = messageOriginProof.outboundRoute;
    const sameRouteBinding =
      route.sourceAccount.id ===
        sourceOccurrence.bindingContext.sourceAccount.id &&
      route.sourceThreadBinding.id ===
        sourceOccurrence.bindingContext.sourceThreadBinding.id;
    const exactSameRouteGeneration =
      sameRouteBinding &&
      route.bindingFence.bindingGeneration ===
        sourceOccurrence.bindingContext.bindingGeneration;
    const exactProviderWideEcho =
      !sameRouteBinding &&
      link.role === "provider_echo" &&
      sourceOccurrence.origin.kind === "provider_echo" &&
      sourceOccurrence.messageKey.scope.kind === "provider_thread" &&
      sourceOccurrence.messageIdentityDeclaration.scopeKind ===
        "provider_thread" &&
      sourceOccurrence.messageIdentityDeclaration.decisionStrength ===
        "authoritative" &&
      commit.externalThreadMapping.thread.key.scope.kind === "provider" &&
      commit.externalThreadMapping.thread.identityDeclaration.scopeKind ===
        "provider" &&
      commit.externalThreadMapping.thread.identityDeclaration
        .decisionStrength === "authoritative";
    if (
      route.tenantId !== commit.tenantId ||
      route.id !== message.origin.outboundRoute.id ||
      route.conversation.id !== message.conversation.id ||
      route.externalThread.id !==
        sourceOccurrence.bindingContext.externalThread.id ||
      route.externalThread.id !== commit.externalThreadMapping.thread.id ||
      (!exactSameRouteGeneration && !exactProviderWideEcho) ||
      !sameValue(
        route.adapterContract,
        sourceOccurrence.descriptor.adapterContract
      )
    ) {
      addIssue(
        context,
        ["messageOriginProof", "outboundRoute"],
        "A Hulee outbound occurrence must retain its exact route, or prove an authoritative provider-wide echo through another exact binding."
      );
    }

    if (
      (link.role !== "provider_echo" && link.role !== "provider_response") ||
      (link.role === "provider_echo" &&
        sourceOccurrence.origin.kind !== "provider_echo") ||
      (link.role === "provider_response" &&
        sourceOccurrence.origin.kind !== "provider_response")
    ) {
      addIssue(
        context,
        ["link", "role"],
        "A Hulee outbound Message accepts only its exact provider echo or provider response occurrence."
      );
    }
    return;
  }

  if (message.origin.kind !== "source_originated") {
    addIssue(
      context,
      ["message", "origin"],
      "Internal and migration Messages cannot acquire provider transport occurrences."
    );
    return;
  }

  if (messageOriginProof.kind !== "source_originated") {
    addIssue(
      context,
      ["messageOriginProof"],
      "A source-originated Message association requires its exact immutable origin occurrence."
    );
    return;
  }

  const originOccurrence = messageOriginProof.originOccurrence;
  const originResolvedReference =
    originOccurrence.resolution.state === "resolved"
      ? originOccurrence.resolution.externalMessageReference
      : null;
  if (
    originOccurrence.tenantId !== commit.tenantId ||
    originOccurrence.id !== message.origin.originOccurrence.id ||
    originOccurrence.id === sourceOccurrence.id ||
    originOccurrence.direction !== message.origin.direction ||
    originOccurrence.origin.kind === "provider_echo" ||
    originOccurrence.origin.kind === "provider_response" ||
    originOccurrence.providerActor?.kind !== "source_external_identity" ||
    originResolvedReference?.id !== commit.externalMessageReference.id ||
    !sameValue(
      originOccurrence.messageKey,
      commit.externalMessageReference.key
    ) ||
    !sameValue(sourceOccurrence.messageKey, originOccurrence.messageKey) ||
    originOccurrence.bindingContext.externalThread.id !==
      commit.externalThreadMapping.thread.id ||
    commit.linkHeadBefore === null
  ) {
    addIssue(
      context,
      ["messageOriginProof", "originOccurrence"],
      "An additional occurrence must prove the Message's original source occurrence and the same exact canonical provider key."
    );
  }

  const isOrdinaryProviderOccurrence =
    sourceOccurrence.origin.kind !== "provider_echo" &&
    sourceOccurrence.origin.kind !== "provider_response";
  const validInboundArtifact =
    message.origin.direction === "inbound" &&
    link.role === "additional_artifact" &&
    sourceOccurrence.direction === "inbound" &&
    isOrdinaryProviderOccurrence &&
    sourceOccurrence.providerActor?.kind === "source_external_identity";
  const validNativeOutbound =
    message.origin.direction === "outbound" &&
    link.role === "native_outbound" &&
    sourceOccurrence.direction === "outbound" &&
    isOrdinaryProviderOccurrence &&
    sourceOccurrence.providerActor?.kind === "source_external_identity";
  const validCrossAccountEcho =
    message.origin.direction === "outbound" &&
    link.role === "provider_echo" &&
    sourceOccurrence.direction === "outbound" &&
    sourceOccurrence.origin.kind === "provider_echo";
  if (!validInboundArtifact && !validNativeOutbound && !validCrossAccountEcho) {
    addIssue(
      context,
      ["link", "role"],
      "A source Message accepts only a same-direction additional inbound occurrence, native outbound occurrence or exact provider echo."
    );
  }
}

function addTransportLinkHeadIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageTransportAssociationCommitSchema>
): void {
  const before = commit.linkHeadBefore;
  const after = commit.linkHeadAfter;
  const expectedRevision = before === null ? 1n : BigInt(before.revision) + 1n;
  const expectedCount = before === null ? 1n : BigInt(before.linkCount) + 1n;
  if (
    after.tenantId !== commit.tenantId ||
    after.message.id !== commit.message.id ||
    after.latestLink.id !== commit.link.id ||
    BigInt(after.revision) !== expectedRevision ||
    BigInt(after.linkCount) !== expectedCount ||
    after.updatedAt !== commit.committedAt ||
    (before !== null &&
      (before.tenantId !== commit.tenantId ||
        before.message.id !== commit.message.id ||
        Date.parse(before.updatedAt) > Date.parse(commit.committedAt)))
  ) {
    addIssue(
      context,
      ["linkHeadAfter"],
      "Transport association advances only its independent per-Message relation head."
    );
  }
}

function addTransportScopeTenantIssues(
  context: z.RefinementCtx,
  value: {
    tenantId: string;
    sourceAccount: { tenantId: string };
    sourceThreadBinding: { tenantId: string };
  }
): void {
  addTenantReferenceIssue(context, value.tenantId, value.sourceAccount, [
    "sourceAccount"
  ]);
  addTenantReferenceIssue(context, value.tenantId, value.sourceThreadBinding, [
    "sourceThreadBinding"
  ]);
}

function addDeliveryScopeTenantIssues(
  context: z.RefinementCtx,
  observation: z.infer<typeof inboxV2MessageDeliveryObservationSchema>
): void {
  const { scope } = observation;
  if (scope.kind === "dispatch") {
    addTenantReferenceIssue(context, observation.tenantId, scope.dispatch, [
      "scope",
      "dispatch"
    ]);
    for (const [field, reference] of [
      ["attempt", scope.attempt],
      ["artifact", scope.artifact]
    ] as const) {
      if (reference !== null) {
        addTenantReferenceIssue(context, observation.tenantId, reference, [
          "scope",
          field
        ]);
      }
    }
  } else if (scope.kind === "external_reference") {
    addTenantReferenceIssue(
      context,
      observation.tenantId,
      scope.externalMessageReference,
      ["scope", "externalMessageReference"]
    );
    addTenantReferenceIssue(
      context,
      observation.tenantId,
      scope.sourceOccurrence,
      ["scope", "sourceOccurrence"]
    );
  } else if (scope.kind === "recipient") {
    addTenantReferenceIssue(
      context,
      observation.tenantId,
      scope.externalMessageReference,
      ["scope", "externalMessageReference"]
    );
    addTenantReferenceIssue(context, observation.tenantId, scope.recipient, [
      "scope",
      "recipient"
    ]);
  }
}

function addDeliveryEvidenceTenantIssues(
  context: z.RefinementCtx,
  observation: z.infer<typeof inboxV2MessageDeliveryObservationSchema>
): void {
  const { evidence } = observation;
  if (evidence.kind === "provider_result") {
    addTenantReferenceIssue(context, observation.tenantId, evidence.attempt, [
      "evidence",
      "attempt"
    ]);
    return;
  }
  if (evidence.kind === "provider_artifact") {
    addTenantReferenceIssue(context, observation.tenantId, evidence.attempt, [
      "evidence",
      "attempt"
    ]);
    addTenantReferenceIssue(context, observation.tenantId, evidence.artifact, [
      "evidence",
      "artifact"
    ]);
    return;
  }
  for (const [field, reference] of [
    ["normalizedInboundEvent", evidence.normalizedInboundEvent],
    ["externalMessageReference", evidence.externalMessageReference],
    ["sourceOccurrence", evidence.sourceOccurrence]
  ] as const) {
    addTenantReferenceIssue(context, observation.tenantId, reference, [
      "evidence",
      field
    ]);
  }
  if (
    (observation.scope.kind === "external_reference" &&
      (observation.scope.externalMessageReference.id !==
        evidence.externalMessageReference.id ||
        observation.scope.sourceOccurrence.id !==
          evidence.sourceOccurrence.id)) ||
    (observation.scope.kind === "recipient" &&
      observation.scope.externalMessageReference.id !==
        evidence.externalMessageReference.id)
  ) {
    addIssue(
      context,
      ["evidence"],
      "Provider-event delivery evidence must identify the same external Message as its scope."
    );
  }
}

function addDeliverySemanticProofIssues(
  context: z.RefinementCtx,
  observation: z.infer<typeof inboxV2MessageDeliveryObservationSchema>
): void {
  const providerEvent = observation.evidence.kind === "provider_event";
  const proof = observation.semanticProof;
  if (providerEvent !== (proof !== null)) {
    addIssue(
      context,
      ["semanticProof"],
      "Normalized provider-event delivery requires a trusted semantic proof; direct attempt/artifact result does not."
    );
    return;
  }
  if (proof === null || observation.evidence.kind !== "provider_event") {
    return;
  }
  if (
    proof.tenantId !== observation.tenantId ||
    proof.semanticId !== `core:message.delivery.${observation.fact}` ||
    proof.semanticRevision !== "1" ||
    proof.normalizedInboundEvent.id !==
      observation.evidence.normalizedInboundEvent.id ||
    proof.externalMessageReference?.id !==
      observation.evidence.externalMessageReference.id ||
    proof.sourceOccurrence?.id !== observation.evidence.sourceOccurrence.id ||
    proof.sourceAccount.id !== observation.sourceAccount.id ||
    proof.sourceThreadBinding.id !== observation.sourceThreadBinding.id ||
    proof.bindingGeneration !== observation.bindingGeneration ||
    !sameValue(proof.adapterContract, observation.adapterContract) ||
    proof.capabilityId !== observation.capabilityId ||
    proof.capabilityRevision !== observation.capabilityRevision ||
    (observation.scope.kind === "recipient"
      ? proof.actor?.id !== observation.scope.recipient.id
      : proof.actor !== null) ||
    proof.occurredAt !== observation.observedAt ||
    proof.recordedAt !== observation.recordedAt
  ) {
    addIssue(
      context,
      ["semanticProof"],
      "Delivery fact must exactly match the trusted adapter semantic, target and capability revision."
    );
  }
}

function addReceiptSemanticProofIssues(
  context: z.RefinementCtx,
  receipt: z.infer<typeof inboxV2ProviderReceiptObservationSchema>
): void {
  const proof = receipt.semanticProof;
  const exactTarget = receipt.target.kind === "exact_message";
  if (
    proof.tenantId !== receipt.tenantId ||
    proof.semanticId !== "core:message.receipt.read" ||
    proof.semanticRevision !== "1" ||
    proof.normalizedInboundEvent.id !== receipt.evidenceEvent.id ||
    proof.sourceAccount.id !== receipt.sourceAccount.id ||
    proof.sourceThreadBinding.id !== receipt.sourceThreadBinding.id ||
    proof.bindingGeneration !== receipt.bindingGeneration ||
    !sameValue(proof.adapterContract, receipt.adapterContract) ||
    proof.capabilityId !== receipt.capabilityId ||
    proof.capabilityRevision !== receipt.capabilityRevision ||
    proof.occurredAt !== receipt.observedAt ||
    proof.recordedAt !== receipt.recordedAt ||
    exactTarget !== (proof.externalMessageReference !== null) ||
    exactTarget !== (proof.sourceOccurrence !== null) ||
    (exactTarget &&
      proof.externalMessageReference?.id !==
        (receipt.target.kind === "exact_message"
          ? receipt.target.externalMessageReference.id
          : undefined)) ||
    (exactTarget &&
      proof.sourceOccurrence?.id !==
        (receipt.target.kind === "exact_message"
          ? receipt.target.sourceOccurrence.id
          : undefined)) ||
    (receipt.reader.kind === "source_external_identity"
      ? proof.actor?.id !== receipt.reader.sourceExternalIdentity.id
      : proof.actor !== null)
  ) {
    addIssue(
      context,
      ["semanticProof"],
      "Read receipt must exactly match the trusted target scope, reader fidelity and adapter capability."
    );
  }
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
    addIssue(context, path, "Transport facts must share one tenant.");
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
