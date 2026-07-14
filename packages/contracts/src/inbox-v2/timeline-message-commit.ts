import { z } from "zod";

import { inboxV2TimestampSchema } from "./entity-metadata";
import {
  inboxV2ExternalMessageReferenceSchema,
  inboxV2SourceOccurrenceResolutionCommitSchema
} from "./external-message-reference";
import { inboxV2ExternalThreadMappingSchema } from "./external-thread";
import {
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2MessageReferenceSchema,
  inboxV2OutboundRouteReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  inboxV2MessageSchema,
  inboxV2ProviderForwardProvenanceCompletenessSchema
} from "./message";
import { inboxV2MessageRevisionSchema } from "./message-lifecycle";
import {
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentSchema
} from "./message-content";
import {
  inboxV2MessageTransportLinkHeadSchema,
  inboxV2MessageTransportOccurrenceLinkSchema
} from "./message-transport";
import { inboxV2OutboundDispatchSchema } from "./outbound-dispatch";
import { inboxV2OutboundRouteSchema } from "./outbound-route";
import {
  inboxV2ConversationParticipantSchema,
  inboxV2SourceIdentityClaimSchema,
  type InboxV2ConversationParticipant
} from "./participant-identity";
import {
  inboxV2ProviderSemanticOrderingCommitSchema,
  inboxV2ProviderSemanticProofSchema
} from "./provider-semantic-proof";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import { inboxV2SourceOccurrenceSchema } from "./external-message-reference";
import { inboxV2TimelineSequenceAllocationSchema } from "./timeline-sequence-allocation";
import { inboxV2TimelineItemSchema } from "./timeline";
import {
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema
} from "./source-routing-primitives";
import { inboxV2SourceThreadBindingSchema } from "./source-thread-binding";

export const INBOX_V2_MESSAGE_CREATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.message-creation-commit" as const;
export const INBOX_V2_TIMELINE_MESSAGE_COMMIT_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2CanonicalMessageTargetSnapshotSchema = z
  .object({
    message: inboxV2MessageSchema,
    timelineItem: inboxV2TimelineItemSchema
  })
  .strict();

export const inboxV2ExternalMessageTargetSnapshotSchema = z
  .object({
    externalMessageReference: inboxV2ExternalMessageReferenceSchema,
    sourceOccurrence: inboxV2SourceOccurrenceSchema
  })
  .strict();

export const inboxV2ProviderReferenceSemanticEvidenceSchema = z
  .object({
    target: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("resolved_external"),
          externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
          sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("unresolved_source"),
          sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("event_classification"),
          sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
          provenanceCompleteness:
            inboxV2ProviderForwardProvenanceCompletenessSchema
        })
        .strict()
    ]),
    providerSemanticProof: inboxV2ProviderSemanticProofSchema,
    semanticOrderingCommit: inboxV2ProviderSemanticOrderingCommitSchema
  })
  .strict();

/**
 * Cross-domain bounded proof used by the materializer. Full command/event/outbox
 * atomicity is added by CON-008; this contract already forbids partial identity,
 * content, sequence and route attribution.
 */
export const inboxV2MessageCreationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    timelineAllocation: inboxV2TimelineSequenceAllocationSchema,
    authorParticipant: inboxV2ConversationParticipantSchema,
    content: inboxV2TimelineContentSchema,
    message: inboxV2MessageSchema,
    initialRevision: inboxV2MessageRevisionSchema,
    sourceOccurrence: inboxV2SourceOccurrenceSchema.nullable(),
    claimAtOccurrenceSnapshot: inboxV2SourceIdentityClaimSchema.nullable(),
    sourceResolutionCommit:
      inboxV2SourceOccurrenceResolutionCommitSchema.nullable(),
    externalMessageReference: inboxV2ExternalMessageReferenceSchema.nullable(),
    originTransportLink: inboxV2MessageTransportOccurrenceLinkSchema.nullable(),
    originTransportLinkHead: inboxV2MessageTransportLinkHeadSchema.nullable(),
    externalThreadMapping: inboxV2ExternalThreadMappingSchema.nullable(),
    canonicalReferenceTargets: z
      .array(inboxV2CanonicalMessageTargetSnapshotSchema)
      .max(32),
    externalReferenceTargets: z
      .array(inboxV2ExternalMessageTargetSnapshotSchema)
      .max(32),
    unresolvedReferenceTarget: inboxV2SourceOccurrenceSchema.nullable(),
    providerReferenceSemantics: z
      .array(inboxV2ProviderReferenceSemanticEvidenceSchema)
      .max(33),
    outboundRoute: inboxV2OutboundRouteSchema.nullable(),
    outboundBindingSnapshot: inboxV2SourceThreadBindingSchema.nullable(),
    outboundDispatch: inboxV2OutboundDispatchSchema.nullable(),
    routeConsumption: z
      .object({
        outboundRoute: inboxV2OutboundRouteReferenceSchema,
        message: inboxV2MessageReferenceSchema,
        mutationToken: inboxV2RoutingTokenSchema,
        idempotencyToken: inboxV2RoutingTokenSchema,
        correlationToken: inboxV2RoutingTokenSchema,
        consumedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
        consumedAt: inboxV2TimestampSchema,
        revision: z.literal("1")
      })
      .strict()
      .nullable()
  })
  .strict()
  .superRefine((commit, context) => {
    const {
      message,
      authorParticipant,
      content,
      initialRevision,
      timelineAllocation
    } = commit;
    const conversation = timelineAllocation.conversationAfter;
    const timelineItem = timelineAllocation.items.find(
      (item) => item.id === message.timelineItem.id
    );
    if (
      commit.tenantId !== timelineAllocation.tenantId ||
      commit.tenantId !== message.tenantId ||
      commit.tenantId !== authorParticipant.tenantId ||
      commit.tenantId !== content.tenantId ||
      timelineAllocation.items.length !== 1 ||
      (commit.sourceOccurrence !== null &&
        commit.sourceOccurrence.tenantId !== commit.tenantId) ||
      (commit.claimAtOccurrenceSnapshot !== null &&
        commit.claimAtOccurrenceSnapshot.tenantId !== commit.tenantId) ||
      (commit.sourceResolutionCommit !== null &&
        commit.sourceResolutionCommit.tenantId !== commit.tenantId) ||
      (commit.externalMessageReference !== null &&
        commit.externalMessageReference.tenantId !== commit.tenantId) ||
      (commit.originTransportLink !== null &&
        commit.originTransportLink.tenantId !== commit.tenantId) ||
      (commit.originTransportLinkHead !== null &&
        commit.originTransportLinkHead.tenantId !== commit.tenantId) ||
      (commit.externalThreadMapping !== null &&
        commit.externalThreadMapping.tenantId !== commit.tenantId) ||
      (commit.unresolvedReferenceTarget !== null &&
        commit.unresolvedReferenceTarget.tenantId !== commit.tenantId) ||
      (commit.outboundRoute !== null &&
        commit.outboundRoute.tenantId !== commit.tenantId) ||
      (commit.outboundBindingSnapshot !== null &&
        commit.outboundBindingSnapshot.tenantId !== commit.tenantId) ||
      (commit.outboundDispatch !== null &&
        commit.outboundDispatch.tenantId !== commit.tenantId) ||
      (commit.routeConsumption !== null &&
        (commit.routeConsumption.outboundRoute.tenantId !== commit.tenantId ||
          commit.routeConsumption.message.tenantId !== commit.tenantId)) ||
      timelineItem === undefined ||
      conversation.id !== message.conversation.id ||
      conversation.id !== authorParticipant.conversation.id ||
      timelineItem.conversation.id !== conversation.id ||
      timelineItem.subject.kind !== "message" ||
      timelineItem.subject.message.id !== message.id ||
      timelineItem.subject.messageRevision !== message.revision ||
      message.revision !== "1" ||
      message.createdAt !== timelineAllocation.committedAt ||
      message.updatedAt !== timelineAllocation.committedAt ||
      content.revision !== "1" ||
      content.createdAt !== timelineAllocation.committedAt ||
      content.updatedAt !== timelineAllocation.committedAt ||
      initialRevision.tenantId !== commit.tenantId ||
      initialRevision.message.id !== message.id ||
      initialRevision.timelineItem.id !== timelineItem.id ||
      initialRevision.change.kind !== "created" ||
      initialRevision.messageRevision !== "1" ||
      initialRevision.expectedPreviousRevision !== null ||
      initialRevision.occurredAt !== timelineItem.occurredAt ||
      initialRevision.recordedAt !== timelineAllocation.committedAt ||
      !sameValue(initialRevision.change.content, message.content) ||
      !sameValue(message.content, inboxV2TimelineContentHeadOf(content))
    ) {
      addIssue(
        context,
        ["message"],
        "Message creation binds one exact sequence, participant, content and revision-1 head."
      );
      return;
    }

    const expectedVisibility =
      conversation.transport === "external"
        ? "conversation_external"
        : "internal_participants";
    if (timelineItem.visibility !== expectedVisibility) {
      addIssue(
        context,
        ["timelineAllocation", "items"],
        "Message visibility must match the exact Conversation transport."
      );
    }
    if (
      (message.origin.kind === "internal" &&
        conversation.transport !== "internal") ||
      ((message.origin.kind === "source_originated" ||
        message.origin.kind === "hulee_external") &&
        conversation.transport !== "external")
    ) {
      addIssue(
        context,
        ["message", "origin"],
        "Internal origin belongs only to internal Conversation; source/Hulee transport origins belong only to external Conversation."
      );
    }

    addAuthorIssues(context, authorParticipant, message);
    addClaimAtOccurrenceIssues(context, commit);
    if (
      initialRevision.actionAttribution.actionParticipant?.id !==
        authorParticipant.id ||
      !sameValue(
        initialRevision.actionAttribution.appActor,
        message.appActor
      ) ||
      (message.origin.kind === "source_originated"
        ? initialRevision.actionAttribution.sourceOccurrence?.id !==
          message.origin.originOccurrence.id
        : initialRevision.actionAttribution.sourceOccurrence !== null)
    ) {
      addIssue(
        context,
        ["initialRevision", "actionAttribution"],
        "Initial revision preserves the exact author, app actor and source occurrence planes."
      );
    }
    addOriginIssues(context, commit, timelineItem.id);
    addExternalThreadMappingIssues(context, commit);
    addOutboundBindingIssues(context, commit);
    addActivityAndCausationIssues(context, commit, timelineItem);
    addReferenceContextIssues(context, commit);
    addReferenceTargetSnapshotIssues(context, commit);
    addProviderReferenceSemanticIssues(context, commit);
    addOutboundReferenceProofIssues(context, commit);
    addUnsupportedContentIssues(context, commit);
  });

export const inboxV2MessageCreationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_CREATION_COMMIT_SCHEMA_ID,
    INBOX_V2_TIMELINE_MESSAGE_COMMIT_SCHEMA_VERSION,
    inboxV2MessageCreationCommitSchema
  );

export type InboxV2MessageCreationCommit = z.infer<
  typeof inboxV2MessageCreationCommitSchema
>;
export type InboxV2ProviderReferenceSemanticEvidence = z.infer<
  typeof inboxV2ProviderReferenceSemanticEvidenceSchema
>;

function addAuthorIssues(
  context: z.RefinementCtx,
  participant: InboxV2ConversationParticipant,
  message: z.infer<typeof inboxV2MessageSchema>
): void {
  if (participant.id !== message.authorParticipant.id) {
    addIssue(
      context,
      ["authorParticipant", "id"],
      "Message author must be the supplied immutable participant."
    );
    return;
  }
  switch (message.origin.kind) {
    case "source_originated":
      if (participant.subject.kind !== "source_external_identity") {
        addIssue(
          context,
          ["authorParticipant", "subject"],
          "Source-originated Message author must be its source identity participant."
        );
      }
      return;
    case "hulee_external":
    case "internal":
      if (participant.subject.kind === "employee") {
        if (
          message.appActor?.kind !== "employee" ||
          message.appActor.employee.id !== participant.subject.employee.id
        ) {
          addIssue(
            context,
            ["message", "appActor"],
            "Employee app author and Employee participant must match exactly."
          );
        }
      } else if (
        participant.subject.kind !== "bot" ||
        message.appActor?.kind !== "trusted_service" ||
        message.automationCausation === null
      ) {
        addIssue(
          context,
          ["authorParticipant", "subject"],
          "Automated app Message uses a bot participant, trusted service and explicit causation."
        );
      }
      return;
    case "migration":
      if (
        participant.subject.kind !== "legacy_unknown" &&
        participant.subject.kind !== "system"
      ) {
        addIssue(
          context,
          ["authorParticipant", "subject"],
          "Migration cannot invent a current Employee, Client or source author."
        );
      }
  }
}

function addClaimAtOccurrenceIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>
): void {
  const message = commit.message;
  const declared =
    message.origin.kind === "source_originated"
      ? message.origin.claimAtOccurrence
      : null;
  const claim = commit.claimAtOccurrenceSnapshot;
  if ((declared === null) !== (claim === null)) {
    addIssue(
      context,
      ["claimAtOccurrenceSnapshot"],
      "A claim-at-occurrence reference requires exactly one full immutable claim snapshot."
    );
    return;
  }
  if (declared === null || claim === null) {
    return;
  }

  const occurrence = commit.sourceOccurrence;
  const participant = commit.authorParticipant;
  const validAtOccurrence =
    occurrence !== null &&
    Date.parse(claim.createdAt) <= Date.parse(occurrence.observedAt) &&
    (claim.status === "active" ||
      (claim.revocation !== null &&
        Date.parse(claim.revocation.revokedAt) >
          Date.parse(occurrence.observedAt)));
  if (
    occurrence === null ||
    participant.subject.kind !== "source_external_identity" ||
    occurrence.providerActor?.kind !== "source_external_identity" ||
    claim.id !== declared.claim.id ||
    String(claim.claimVersion) !== String(declared.claimVersion) ||
    claim.target.kind !== "employee" ||
    claim.target.employee.id !== declared.resolvedEmployee.id ||
    claim.sourceExternalIdentity.id !==
      participant.subject.sourceExternalIdentity.id ||
    claim.sourceExternalIdentity.id !==
      occurrence.providerActor.sourceExternalIdentity.id ||
    !validAtOccurrence
  ) {
    addIssue(
      context,
      ["claimAtOccurrenceSnapshot"],
      "Claim-at-occurrence must prove the exact source identity, Employee target and claim version effective at provider observation time."
    );
  }
}

function addExternalThreadMappingIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>
): void {
  const externalOrigin =
    commit.message.origin.kind === "source_originated" ||
    commit.message.origin.kind === "hulee_external";
  const mapping = commit.externalThreadMapping;
  if (externalOrigin !== (mapping !== null)) {
    addIssue(
      context,
      ["externalThreadMapping"],
      "External Message creation requires one exact ExternalThread-to-Conversation mapping; internal creation has none."
    );
    return;
  }
  if (mapping === null) {
    return;
  }
  const mappedThreadId = mapping.thread.id;
  const sourceThreadMatches =
    commit.message.origin.kind !== "source_originated" ||
    (commit.sourceOccurrence !== null &&
      commit.externalMessageReference !== null &&
      commit.sourceOccurrence.bindingContext.externalThread.id ===
        mappedThreadId &&
      commit.externalMessageReference.externalThread.id === mappedThreadId);
  const routeThreadMatches =
    commit.message.origin.kind !== "hulee_external" ||
    (commit.outboundRoute !== null &&
      commit.outboundRoute.externalThread.id === mappedThreadId);
  if (
    !sameValue(
      mapping.conversation,
      commit.timelineAllocation.conversationBefore
    ) ||
    !sourceThreadMatches ||
    !routeThreadMatches
  ) {
    addIssue(
      context,
      ["externalThreadMapping"],
      "External thread, occurrence/route and exact pre-allocation Conversation snapshot must agree."
    );
  }
}

function addOutboundBindingIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>
): void {
  const route = commit.outboundRoute;
  const binding = commit.outboundBindingSnapshot;
  if (commit.message.origin.kind !== "hulee_external") {
    if (binding !== null) {
      addIssue(
        context,
        ["outboundBindingSnapshot"],
        "Only Hulee-originated external creation consumes an outbound binding snapshot."
      );
    }
    return;
  }
  if (route === null || binding === null) {
    addIssue(
      context,
      ["outboundBindingSnapshot"],
      "Hulee external creation requires the exact selected SourceThreadBinding snapshot."
    );
    return;
  }

  const fence = route.bindingFence;
  const committedAt = commit.timelineAllocation.committedAt;
  const matchingCapabilities = binding.capabilities.entries.filter(
    (entry) =>
      entry.operationId === route.operationId &&
      entry.contentKindId === route.contentKindId
  );
  const capability = matchingCapabilities.find(
    (entry) =>
      entry.state === "supported" &&
      (entry.validUntil === null ||
        Date.parse(entry.validUntil) > Date.parse(committedAt)) &&
      entry.requiredProviderRoleIds.every((roleId) =>
        binding.providerAccess.roleIds.includes(roleId)
      )
  );
  const nativeForward =
    commit.message.referenceContext.kind === "forward_provider_native"
      ? commit.message.referenceContext
      : null;
  if (
    binding.id !== route.sourceThreadBinding.id ||
    binding.externalThread.id !== route.externalThread.id ||
    binding.sourceAccount.id !== route.sourceAccount.id ||
    binding.sourceConnection.id !== route.sourceConnection.id ||
    binding.accountIdentitySnapshot.accountGeneration !==
      fence.accountGeneration ||
    binding.bindingGeneration !== fence.bindingGeneration ||
    binding.remoteAccess.revision !== fence.remoteAccessRevision ||
    binding.administrative.revision !== fence.administrativeRevision ||
    binding.capabilities.revision !== fence.capabilityRevision ||
    binding.routeDescriptor.descriptorRevision !==
      fence.routeDescriptorRevision ||
    !sameValue(binding.capabilities.adapterContract, route.adapterContract) ||
    !sameValue(binding.routeDescriptor, route.routeDescriptor) ||
    binding.remoteAccess.state !== "active" ||
    binding.administrative.state !== "enabled" ||
    binding.runtimeHealth.state !== "ready" ||
    Date.parse(binding.updatedAt) > Date.parse(committedAt) ||
    Date.parse(binding.capabilities.capturedAt) > Date.parse(committedAt) ||
    capability === undefined ||
    (nativeForward !== null &&
      (capability.capabilityId !== nativeForward.capability.capabilityId ||
        binding.capabilities.revision !==
          nativeForward.capability.capabilityRevision ||
        !sameValue(
          route.adapterContract,
          nativeForward.capability.adapterContract
        ) ||
        capability.referencePortability === "not_applicable"))
  ) {
    addIssue(
      context,
      ["outboundBindingSnapshot"],
      "Outbound route must consume one current, authorized, capability-bearing binding snapshot at its exact fence."
    );
  }
}

function addActivityAndCausationIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>,
  timelineItem: z.infer<typeof inboxV2TimelineItemSchema>
): void {
  const { message, sourceOccurrence } = commit;
  if (message.origin.kind === "source_originated") {
    const history = sourceOccurrence?.origin.kind === "history";
    if (
      history
        ? timelineItem.activity.kind !== "history_import" ||
          timelineItem.activity.sourceOccurrence.id !== sourceOccurrence.id ||
          timelineItem.activity.importedAt !==
            commit.timelineAllocation.committedAt
        : timelineItem.activity.kind !== "eligible"
    ) {
      addIssue(
        context,
        ["timelineAllocation", "items", 0, "activity"],
        "History is explicit non-activity; every live source Message, including native outbound, is eligible timeline activity."
      );
    }
  } else if (message.origin.kind === "migration") {
    if (
      timelineItem.activity.kind !== "migration" ||
      timelineItem.activity.provenanceId !== message.origin.provenanceId ||
      timelineItem.activity.importedAt !== commit.timelineAllocation.committedAt
    ) {
      addIssue(
        context,
        ["timelineAllocation", "items", 0, "activity"],
        "Migration Message carries explicit non-activity provenance and import time."
      );
    }
  } else if (timelineItem.activity.kind !== "eligible") {
    addIssue(
      context,
      ["timelineAllocation", "items", 0, "activity"],
      "Ordinary internal/Hulee Message creation is eligible timeline activity."
    );
  }

  if (
    message.automationCausation !== null &&
    Date.parse(message.automationCausation.causedAt) >
      Date.parse(timelineItem.occurredAt)
  ) {
    addIssue(
      context,
      ["message", "automationCausation", "causedAt"],
      "Automation cause cannot occur after the resulting Message action."
    );
  }
}

function addOriginIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>,
  timelineItemId: string
): void {
  const { message } = commit;
  if (message.origin.kind === "source_originated") {
    const occurrence = commit.sourceOccurrence;
    const resolutionCommit = commit.sourceResolutionCommit;
    const reference = commit.externalMessageReference;
    const link = commit.originTransportLink;
    const linkHead = commit.originTransportLinkHead;
    if (
      occurrence === null ||
      resolutionCommit === null ||
      reference === null ||
      link === null ||
      linkHead === null ||
      commit.outboundRoute !== null ||
      commit.outboundDispatch !== null ||
      commit.routeConsumption !== null ||
      resolutionCommit.tenantId !== commit.tenantId ||
      resolutionCommit.changedAt !== commit.timelineAllocation.committedAt ||
      !sameValue(resolutionCommit.after, occurrence) ||
      !sameValue(resolutionCommit.resolvedReference, reference) ||
      occurrence.id !== message.origin.originOccurrence.id ||
      occurrence.direction !== message.origin.direction ||
      occurrence.origin.kind === "provider_echo" ||
      occurrence.origin.kind === "provider_response" ||
      occurrence.resolution.state !== "resolved" ||
      occurrence.resolution.externalMessageReference.id !== reference.id ||
      occurrence.providerActor?.kind !== "source_external_identity" ||
      reference.message.id !== message.id ||
      reference.timelineItem.id !== timelineItemId ||
      reference.createdAt !== commit.timelineAllocation.committedAt ||
      link.message.id !== message.id ||
      link.sourceOccurrence.id !== occurrence.id ||
      link.externalMessageReference.id !== reference.id ||
      link.role !==
        (message.origin.direction === "outbound"
          ? "native_outbound"
          : "origin") ||
      link.linkedAt !== commit.timelineAllocation.committedAt ||
      linkHead.message.id !== message.id ||
      linkHead.linkCount !== "1" ||
      linkHead.latestLink.id !== link.id ||
      linkHead.revision !== "1" ||
      linkHead.updatedAt !== commit.timelineAllocation.committedAt ||
      !sameValue(reference.key, occurrence.messageKey)
    ) {
      addIssue(
        context,
        ["sourceOccurrence"],
        "Source Message creation requires one exact non-echo occurrence and immutable external reference."
      );
      return;
    }
    const participant = commit.authorParticipant;
    if (
      participant.subject.kind !== "source_external_identity" ||
      occurrence.providerActor.sourceExternalIdentity.id !==
        participant.subject.sourceExternalIdentity.id
    ) {
      addIssue(
        context,
        ["authorParticipant"],
        "Provider-observed source actor and immutable Message author must match."
      );
    }
    return;
  }

  if (message.origin.kind === "hulee_external") {
    const route = commit.outboundRoute;
    const dispatch = commit.outboundDispatch;
    const consumption = commit.routeConsumption;
    const committedAt = commit.timelineAllocation.committedAt;
    const expectedRouteAuthority = expectedRouteAuthorityFor(
      message.referenceContext
    );
    if (
      commit.sourceOccurrence !== null ||
      commit.sourceResolutionCommit !== null ||
      commit.externalMessageReference !== null ||
      commit.originTransportLink !== null ||
      commit.originTransportLinkHead !== null ||
      route === null ||
      dispatch === null ||
      consumption === null ||
      route.id !== message.origin.outboundRoute.id ||
      route.conversation.id !== message.conversation.id ||
      dispatch.message.id !== message.id ||
      dispatch.route.id !== route.id ||
      dispatch.state !== "queued" ||
      dispatch.revision !== "1" ||
      route.createdAt !== committedAt ||
      dispatch.createdAt !== committedAt ||
      dispatch.updatedAt !== committedAt ||
      route.operationId !== expectedRouteAuthority.operationId ||
      route.requiredConversationPermissionId !==
        expectedRouteAuthority.permissionId ||
      route.contentKindId !==
        (message.referenceContext.kind === "forward_provider_native"
          ? null
          : contentKindIdFor(commit.content)) ||
      consumption.mutationToken !== route.mutationToken ||
      consumption.idempotencyToken !== route.idempotencyToken ||
      consumption.correlationToken !== route.correlationToken ||
      consumption.outboundRoute.id !== route.id ||
      consumption.message.id !== message.id ||
      consumption.consumedAt !== committedAt ||
      consumption.consumedByTrustedServiceId !==
        route.adapterContract.loadedByTrustedServiceId ||
      Date.parse(route.conversationAuthorization.notAfter) <
        Date.parse(committedAt) ||
      Date.parse(route.sourceAccountAuthorization.notAfter) <
        Date.parse(committedAt) ||
      Date.parse(route.selection.candidateSnapshotNotAfter) <
        Date.parse(committedAt) ||
      (route.referenceContext.kind === "external_message" &&
        Date.parse(route.referenceContext.resolutionDecision.notAfter) <
          Date.parse(committedAt)) ||
      !samePrincipal(route.principal, message.appActor)
    ) {
      addIssue(
        context,
        ["outboundDispatch"],
        "Hulee external creation atomically pins one exact route and queued dispatch."
      );
    }
    return;
  }

  if (
    commit.sourceOccurrence !== null ||
    commit.sourceResolutionCommit !== null ||
    commit.externalMessageReference !== null ||
    commit.originTransportLink !== null ||
    commit.outboundRoute !== null ||
    commit.outboundBindingSnapshot !== null ||
    commit.outboundDispatch !== null ||
    commit.routeConsumption !== null
  ) {
    addIssue(
      context,
      ["message", "origin"],
      "Internal and migration Messages have no provider occurrence, route or dispatch."
    );
  }
}

function addReferenceContextIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>
): void {
  const { message, outboundRoute } = commit;
  const reference = message.referenceContext;
  if (message.origin.kind === "internal") {
    if (
      reference.kind === "forward_provider_native" ||
      reference.kind === "forward_provider_observed" ||
      (reference.kind === "reply" &&
        reference.target.state !== "resolved_internal")
    ) {
      addIssue(
        context,
        ["message", "referenceContext"],
        "Internal Message references cannot enter provider reply/forward semantics."
      );
    }
    return;
  }
  if (message.origin.kind === "hulee_external") {
    const invalidKind =
      reference.kind === "forward_provider_observed" ||
      (reference.kind === "reply" &&
        reference.target.state !== "resolved_external");
    if (invalidKind) {
      addIssue(
        context,
        ["message", "referenceContext"],
        "Hulee external reply requires a resolved provider target; provider-observed forward belongs only to source ingestion."
      );
    }

    const routeReference = outboundRoute?.referenceContext;
    const expectedExternal =
      reference.kind === "reply" &&
      reference.target.state === "resolved_external"
        ? reference.target.external
        : reference.kind === "forward_provider_native" &&
            reference.sources.length === 1
          ? reference.sources[0]
          : null;
    const routeReferenceMatches =
      expectedExternal === null
        ? routeReference?.kind === "none"
        : routeReference?.kind === "external_message" &&
          routeReference.externalMessageReference.id ===
            expectedExternal.externalMessageReference.id &&
          routeReference.sourceOccurrence.id ===
            expectedExternal.sourceOccurrence.id;
    if (
      (reference.kind === "forward_provider_native" &&
        reference.sources.length !== 1) ||
      !routeReferenceMatches
    ) {
      addIssue(
        context,
        ["outboundRoute", "referenceContext"],
        "External reply/native-forward route must pin exactly one referenced occurrence; non-provider references use no provider target."
      );
    }
    return;
  }

  if (message.origin.kind === "source_originated") {
    const invalidKind =
      reference.kind === "forward_content_copy" ||
      reference.kind === "forward_provider_native" ||
      (reference.kind === "reply" &&
        reference.target.state === "resolved_internal");
    const wrongObservedOrigin =
      reference.kind === "forward_provider_observed" &&
      reference.originOccurrence.id !== message.origin.originOccurrence.id;
    if (invalidKind || wrongObservedOrigin) {
      addIssue(
        context,
        ["message", "referenceContext"],
        "Source-originated Message may preserve provider reply/observed-forward semantics only, bound to its exact origin occurrence."
      );
    }
    return;
  }

  if (
    reference.kind === "forward_provider_native" ||
    reference.kind === "forward_provider_observed" ||
    (reference.kind === "reply" &&
      reference.target.state === "unresolved_source")
  ) {
    addIssue(
      context,
      ["message", "referenceContext"],
      "Migration cannot execute live provider forwards or preserve an unresolved live reply."
    );
  }
}

function addReferenceTargetSnapshotIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>
): void {
  const reference = commit.message.referenceContext;
  addUnresolvedReferenceTargetIssues(context, commit);
  const canonicalTargets: Array<{
    message: { id: string };
    timelineItem: { id: string };
    messageRevision: string;
    mustShareConversation: boolean;
  }> = [];
  const externalTargets: Array<{
    externalMessageReference: { id: string };
    sourceOccurrence: { id: string };
  }> = [];

  if (reference.kind === "reply") {
    if (reference.target.state !== "unresolved_source") {
      canonicalTargets.push({
        ...reference.target.canonical,
        mustShareConversation: true
      });
      if (reference.target.state === "resolved_external") {
        externalTargets.push(reference.target.external);
      }
    }
  } else if (reference.kind === "forward_content_copy") {
    canonicalTargets.push(
      ...reference.sources.map((source) => ({
        ...source,
        mustShareConversation: false
      }))
    );
  } else if (reference.kind === "forward_provider_native") {
    externalTargets.push(...reference.sources);
  } else if (reference.kind === "forward_provider_observed") {
    externalTargets.push(...reference.sourceReferences);
  }

  const canonicalIds = new Set<string>();
  if (commit.canonicalReferenceTargets.length !== canonicalTargets.length) {
    addIssue(
      context,
      ["canonicalReferenceTargets"],
      "Canonical reference snapshots must exactly cover every resolved reply/content-copy target."
    );
  }
  for (const [index, target] of canonicalTargets.entries()) {
    const snapshot = commit.canonicalReferenceTargets.find(
      (candidate) =>
        candidate.message.id === target.message.id &&
        candidate.timelineItem.id === target.timelineItem.id
    );
    const key = `${target.message.id}:${target.timelineItem.id}`;
    if (
      snapshot === undefined ||
      canonicalIds.has(key) ||
      snapshot.message.tenantId !== commit.tenantId ||
      snapshot.timelineItem.tenantId !== commit.tenantId ||
      snapshot.message.id === commit.message.id ||
      snapshot.message.timelineItem.id !== snapshot.timelineItem.id ||
      snapshot.timelineItem.conversation.id !==
        snapshot.message.conversation.id ||
      snapshot.message.revision !== target.messageRevision ||
      snapshot.timelineItem.revision !== target.messageRevision ||
      snapshot.timelineItem.subject.kind !== "message" ||
      snapshot.timelineItem.subject.message.id !== snapshot.message.id ||
      snapshot.timelineItem.subject.messageRevision !==
        snapshot.message.revision ||
      (target.mustShareConversation &&
        snapshot.message.conversation.id !== commit.message.conversation.id)
    ) {
      addIssue(
        context,
        ["canonicalReferenceTargets", index],
        "Resolved canonical target must prove the exact Message revision and reply Conversation."
      );
    }
    canonicalIds.add(key);
  }

  const externalIds = new Set<string>();
  if (commit.externalReferenceTargets.length !== externalTargets.length) {
    addIssue(
      context,
      ["externalReferenceTargets"],
      "External reference snapshots must exactly cover every resolved provider target."
    );
  }
  for (const [index, target] of externalTargets.entries()) {
    const snapshot = commit.externalReferenceTargets.find(
      (candidate) =>
        candidate.externalMessageReference.id ===
          target.externalMessageReference.id &&
        candidate.sourceOccurrence.id === target.sourceOccurrence.id
    );
    const key = `${target.externalMessageReference.id}:${target.sourceOccurrence.id}`;
    if (
      snapshot === undefined ||
      externalIds.has(key) ||
      snapshot.externalMessageReference.tenantId !== commit.tenantId ||
      snapshot.sourceOccurrence.tenantId !== commit.tenantId ||
      snapshot.externalMessageReference.message.id === commit.message.id ||
      snapshot.sourceOccurrence.resolution.state !== "resolved" ||
      snapshot.sourceOccurrence.resolution.externalMessageReference.id !==
        snapshot.externalMessageReference.id ||
      !sameValue(
        snapshot.sourceOccurrence.messageKey,
        snapshot.externalMessageReference.key
      )
    ) {
      addIssue(
        context,
        ["externalReferenceTargets", index],
        "Resolved provider target must prove one exact external reference and occurrence."
      );
    }
    externalIds.add(key);
  }

  if (
    reference.kind === "reply" &&
    reference.target.state === "resolved_external"
  ) {
    const canonical = reference.target.canonical;
    const externalTarget = reference.target.external;
    const external = commit.externalReferenceTargets.find(
      (candidate) =>
        candidate.externalMessageReference.id ===
        externalTarget.externalMessageReference.id
    );
    if (
      external === undefined ||
      external.externalMessageReference.message.id !== canonical.message.id ||
      external.externalMessageReference.timelineItem.id !==
        canonical.timelineItem.id
    ) {
      addIssue(
        context,
        ["externalReferenceTargets"],
        "External reply target and canonical target must resolve to the same Message and TimelineItem."
      );
    }
  }
}

function addProviderReferenceSemanticIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>
): void {
  const { message } = commit;
  const reference = message.referenceContext;
  const expected =
    message.origin.kind !== "source_originated"
      ? []
      : reference.kind === "reply"
        ? reference.target.state === "resolved_external"
          ? [
              {
                kind: "resolved_external" as const,
                externalMessageReference:
                  reference.target.external.externalMessageReference,
                sourceOccurrence: reference.target.external.sourceOccurrence,
                semanticId: "core:message.reference.reply.observed",
                capabilityId: "core:message-reply-reference-observed",
                semanticFamilyId: "core:message.reference.reply"
              }
            ]
          : reference.target.state === "unresolved_source"
            ? [
                {
                  kind: "unresolved_source" as const,
                  sourceOccurrence: reference.target.source.sourceOccurrence,
                  semanticId: "core:message.reference.reply.observed",
                  capabilityId: "core:message-reply-reference-observed",
                  semanticFamilyId: "core:message.reference.reply"
                }
              ]
            : []
        : reference.kind === "forward_provider_observed"
          ? [
              {
                kind: "event_classification" as const,
                sourceOccurrence: message.origin.originOccurrence,
                provenanceCompleteness: reference.provenanceCompleteness,
                semanticId: `core:message.reference.forward.observed.${reference.provenanceCompleteness}`,
                capabilityId: "core:message-forward-reference-observed",
                semanticFamilyId:
                  "core:message.reference.forward.classification"
              },
              ...reference.sourceReferences.map((target) => ({
                kind: "resolved_external" as const,
                externalMessageReference: target.externalMessageReference,
                sourceOccurrence: target.sourceOccurrence,
                semanticId: "core:message.reference.forward.observed",
                capabilityId: "core:message-forward-reference-observed",
                semanticFamilyId: "core:message.reference.forward"
              }))
            ]
          : [];

  const evidenceKeys = commit.providerReferenceSemantics.map((evidence) =>
    providerReferenceSemanticTargetKey(evidence.target)
  );
  const expectedKeys = expected.map((target) =>
    providerReferenceSemanticTargetKey(target)
  );
  if (
    evidenceKeys.length !== expectedKeys.length ||
    new Set(evidenceKeys).size !== evidenceKeys.length ||
    !sameValue([...evidenceKeys].sort(), [...expectedKeys].sort())
  ) {
    addIssue(
      context,
      ["providerReferenceSemantics"],
      "Provider reply/observed-forward semantics must exactly cover the event classification and every declared reference target once."
    );
  }
  if (expected.length === 0) {
    return;
  }

  const occurrence = commit.sourceOccurrence;
  const currentReference = commit.externalMessageReference;
  const normalizedEvent =
    occurrence === null || occurrence.origin.kind === "provider_response"
      ? null
      : occurrence.origin.normalizedInboundEvent;
  const expectedActor =
    occurrence?.providerActor?.kind === "source_external_identity"
      ? occurrence.providerActor.sourceExternalIdentity
      : null;
  if (
    occurrence === null ||
    currentReference === null ||
    normalizedEvent === null ||
    expectedActor === null
  ) {
    addIssue(
      context,
      ["providerReferenceSemantics"],
      "Provider reference semantics require the exact source origin occurrence, normalized event and actor."
    );
    return;
  }

  for (const [index, target] of expected.entries()) {
    const targetKey = providerReferenceSemanticTargetKey(target);
    const evidence = commit.providerReferenceSemantics.find(
      (candidate) =>
        providerReferenceSemanticTargetKey(candidate.target) === targetKey
    );
    if (evidence === undefined) {
      continue;
    }
    const proof = evidence.providerSemanticProof;
    const orderingCommit = evidence.semanticOrderingCommit;
    const proofTarget =
      target.kind === "resolved_external"
        ? {
            externalMessageReference: target.externalMessageReference,
            sourceOccurrence: target.sourceOccurrence
          }
        : {
            externalMessageReference: {
              tenantId: commit.tenantId,
              kind: "external_message_reference" as const,
              id: currentReference.id
            },
            sourceOccurrence: {
              tenantId: commit.tenantId,
              kind: "source_occurrence" as const,
              id: occurrence.id
            }
          };
    const targetSnapshotExists =
      target.kind === "resolved_external"
        ? commit.externalReferenceTargets.some(
            (snapshot) =>
              snapshot.externalMessageReference.id ===
                target.externalMessageReference.id &&
              snapshot.sourceOccurrence.id === target.sourceOccurrence.id
          )
        : target.kind === "unresolved_source"
          ? commit.unresolvedReferenceTarget?.id === target.sourceOccurrence.id
          : occurrence.id === target.sourceOccurrence.id;

    if (
      evidence.target.sourceOccurrence.tenantId !== commit.tenantId ||
      (evidence.target.kind === "resolved_external" &&
        evidence.target.externalMessageReference.tenantId !==
          commit.tenantId) ||
      !targetSnapshotExists ||
      proof.normalizedInboundEvent.id !== normalizedEvent.id ||
      proof.externalMessageReference?.id !==
        proofTarget.externalMessageReference.id ||
      proof.sourceOccurrence?.id !== proofTarget.sourceOccurrence.id ||
      proof.sourceAccount.id !== occurrence.bindingContext.sourceAccount.id ||
      proof.sourceThreadBinding.id !==
        occurrence.bindingContext.sourceThreadBinding.id ||
      proof.bindingGeneration !== occurrence.bindingContext.bindingGeneration ||
      !sameValue(
        proof.adapterContract,
        occurrence.descriptor.adapterContract
      ) ||
      proof.capabilityId !== target.capabilityId ||
      proof.capabilityRevision !== occurrence.descriptor.capabilityRevision ||
      proof.semanticId !== target.semanticId ||
      proof.actor?.id !== expectedActor.id ||
      proof.ordering.kind !== "monotonic_exact" ||
      proof.occurredAt !== occurrence.observedAt ||
      proof.recordedAt !== occurrence.recordedAt ||
      orderingCommit.semanticFamilyId !== target.semanticFamilyId ||
      !sameValue(orderingCommit.proof, proof) ||
      orderingCommit.committedAt !== occurrence.recordedAt
    ) {
      addIssue(
        context,
        ["providerReferenceSemantics", index],
        "Trusted provider reference semantics must bind the exact normalized event, origin transport and target snapshot under one ordered semantic family."
      );
    }
  }
}

function providerReferenceSemanticTargetKey(target: {
  kind: "resolved_external" | "unresolved_source" | "event_classification";
  sourceOccurrence: { id: string };
  externalMessageReference?: { id: string };
  provenanceCompleteness?: "exact" | "partial" | "opaque";
}): string {
  return target.kind === "resolved_external"
    ? `resolved:${target.externalMessageReference?.id ?? "missing"}:${target.sourceOccurrence.id}`
    : target.kind === "unresolved_source"
      ? `unresolved:${target.sourceOccurrence.id}`
      : `event:${target.sourceOccurrence.id}:${target.provenanceCompleteness ?? "missing"}`;
}

function addOutboundReferenceProofIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>
): void {
  if (commit.message.origin.kind !== "hulee_external") {
    return;
  }
  const route = commit.outboundRoute;
  const reference = commit.message.referenceContext;
  const target =
    reference.kind === "reply" && reference.target.state === "resolved_external"
      ? reference.target.external
      : reference.kind === "forward_provider_native" &&
          reference.sources.length === 1
        ? reference.sources[0]
        : null;
  if (target === null || route === null) {
    return;
  }
  const snapshot = commit.externalReferenceTargets.find(
    (candidate) =>
      candidate.externalMessageReference.id ===
        target.externalMessageReference.id &&
      candidate.sourceOccurrence.id === target.sourceOccurrence.id
  );
  if (
    snapshot === undefined ||
    snapshot.externalMessageReference.externalThread.id !==
      route.externalThread.id ||
    snapshot.sourceOccurrence.bindingContext.externalThread.id !==
      route.externalThread.id ||
    snapshot.sourceOccurrence.bindingContext.sourceAccount.id !==
      route.sourceAccount.id ||
    snapshot.sourceOccurrence.bindingContext.sourceThreadBinding.id !==
      route.sourceThreadBinding.id ||
    snapshot.sourceOccurrence.bindingContext.bindingGeneration !==
      route.bindingFence.bindingGeneration ||
    !sameValue(
      snapshot.sourceOccurrence.messageIdentityDeclaration.adapterContract,
      route.adapterContract
    )
  ) {
    addIssue(
      context,
      ["externalReferenceTargets"],
      "Outbound reply/native-forward target must belong to the route's exact thread, account, binding generation and adapter contract."
    );
  }
}

function addUnresolvedReferenceTargetIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>
): void {
  const reference = commit.message.referenceContext;
  const expected =
    reference.kind === "reply" && reference.target.state === "unresolved_source"
      ? reference.target.source
      : null;
  const occurrence = commit.unresolvedReferenceTarget;
  if (expected === null) {
    if (occurrence !== null) {
      addIssue(
        context,
        ["unresolvedReferenceTarget"],
        "Only an unresolved source reply may carry an unresolved occurrence proof."
      );
    }
    return;
  }

  const resolutionMatches =
    occurrence !== null &&
    ((expected.resolution.state === "pending" &&
      occurrence.resolution.state === "pending") ||
      (expected.resolution.state === "conflicted" &&
        occurrence.resolution.state === "conflicted" &&
        sameValue(
          occurrence.resolution.candidateExternalMessageReferences,
          expected.resolution.candidates
        )));
  if (
    occurrence === null ||
    occurrence.id !== expected.sourceOccurrence.id ||
    !sameValue(occurrence.messageKey, expected.externalMessageKey) ||
    !resolutionMatches
  ) {
    addIssue(
      context,
      ["unresolvedReferenceTarget"],
      "Unresolved source reply requires the exact pending/conflicted SourceOccurrence and candidate set; unavailable targets need a separate authoritative decision."
    );
  }
}

function addUnsupportedContentIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageCreationCommitSchema>
): void {
  if (commit.content.state.kind !== "available") {
    return;
  }
  for (const [index, block] of commit.content.state.blocks.entries()) {
    if (
      block.kind === "unsupported_source_content" &&
      (commit.message.origin.kind !== "source_originated" ||
        block.sourceOccurrence.id !== commit.message.origin.originOccurrence.id)
    ) {
      addIssue(
        context,
        ["content", "state", "blocks", index],
        "Unsupported fallback is inbound/source evidence, never outbound fake success."
      );
    }
    if (
      commit.message.origin.kind === "hulee_external" &&
      (block.kind === "image" ||
        block.kind === "audio" ||
        block.kind === "video" ||
        block.kind === "file" ||
        block.kind === "sticker") &&
      block.attachment.state !== "ready"
    ) {
      addIssue(
        context,
        ["content", "state", "blocks", index, "attachment"],
        "Hulee external Message cannot enter queued dispatch before every attachment is ready."
      );
    }
  }
}

function samePrincipal(
  principal: z.infer<typeof inboxV2OutboundRouteSchema>["principal"],
  actor: z.infer<typeof inboxV2MessageSchema>["appActor"]
): boolean {
  if (actor === null || principal.kind !== actor.kind) {
    return false;
  }
  return principal.kind === "employee" && actor.kind === "employee"
    ? principal.employee.id === actor.employee.id
    : principal.kind === "trusted_service" && actor.kind === "trusted_service"
      ? principal.trustedServiceId === actor.trustedServiceId
      : false;
}

function expectedRouteAuthorityFor(
  reference: z.infer<typeof inboxV2MessageSchema>["referenceContext"]
): { operationId: string; permissionId: string } {
  switch (reference.kind) {
    case "none":
      return {
        operationId: "core:message.send",
        permissionId: "core:message.send_external"
      };
    case "reply":
      return {
        operationId: "core:message.reply",
        permissionId: "core:message.reply_external"
      };
    case "forward_content_copy":
      return {
        operationId: "core:message.forward_content_copy",
        permissionId: "core:message.forward_content_copy_external"
      };
    case "forward_provider_native":
      return {
        operationId: "core:message.forward_provider_native",
        permissionId: "core:message.forward_provider_native_external"
      };
    case "forward_provider_observed":
      return {
        operationId: "core:message.forward_provider_observed",
        permissionId: "core:message.forward_provider_observed_external"
      };
  }
}

function contentKindIdFor(
  content: z.infer<typeof inboxV2TimelineContentSchema>
): string | null {
  if (content.state.kind !== "available") {
    return null;
  }
  if (content.state.blocks.length !== 1) {
    return "core:multipart";
  }
  const block = content.state.blocks[0];
  switch (block.kind) {
    case "audio":
    case "video":
      return `core:${block.semantic}`;
    case "extension":
      return block.blockKindId;
    case "unsupported_source_content":
      return block.providerContentKindId;
    default:
      return `core:${block.kind}`;
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
