import { z } from "zod";

import type {
  ClientId,
  ConversationId,
  EmployeeId,
  EventId,
  MessageId,
  NormalizedInboundEventId,
  RawInboundEventId,
  SourceAccountId,
  SourceConnectionId,
  TenantId
} from "../base-ids";
import type { Brand } from "../brand";

const inboxV2IdPrefixPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const inboxV2IdOpaquePartPattern = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$/;
const inboxV2KnownEntityKinds = [
  "tenant",
  "account",
  "auth_external_identity_link",
  "bot_identity",
  "employee",
  "client",
  "client_contact",
  "client_stage",
  "conversation",
  "conversation_participant",
  "participant_membership_episode",
  "participant_membership_transition",
  "participant_author_observation",
  "conversation_client_link",
  "conversation_client_link_transition",
  "client_merge_redirect",
  "work_item",
  "conversation_work_item_slot",
  "work_item_primary_assignment",
  "work_item_transition",
  "work_item_servicing_team_episode",
  "work_item_collaborator_episode",
  "work_item_relation_transition",
  "work_queue_eligibility_decision",
  "work_queue",
  "team",
  "org_unit",
  "timeline_item",
  "timeline_content",
  "staff_note",
  "staff_note_revision",
  "source_object",
  "message",
  "message_revision",
  "message_reaction",
  "message_reaction_transition",
  "message_delivery_observation",
  "provider_receipt_observation",
  "message_transport_occurrence_link",
  "message_provider_lifecycle_operation",
  "deferred_message_source_action",
  "message_attachment",
  "attachment_materialization_claim",
  "attachment_materialization_attempt",
  "attachment_materialization_evidence",
  "event",
  "source_connection",
  "source_account",
  "source_account_identity_alias",
  "source_account_identity_transition",
  "raw_inbound_event",
  "normalized_inbound_event",
  "source_external_identity",
  "source_identity_claim",
  "source_identity_claim_transition",
  "provider_roster_evidence",
  "provider_roster_member_evidence",
  "external_thread",
  "external_thread_alias",
  "source_thread_binding",
  "source_thread_binding_remote_access_episode",
  "source_thread_binding_transition",
  "thread_route_policy",
  "external_message_reference",
  "source_occurrence",
  "outbound_route",
  "outbound_dispatch",
  "outbound_dispatch_attempt",
  "outbound_dispatch_reconciliation_decision",
  "outbound_dispatch_artifact",
  "outbound_dispatch_artifact_reference_link",
  "outbound_dispatch_artifact_resolution",
  "outbound_provider_observation",
  "outbound_multi_send_operation",
  "file",
  "file_version",
  "file_object_version",
  "file_parent_link",
  "file_derivative_edge",
  "object_operation_evidence",
  "outbound_dispatch_content_plan",
  "watcher_subscription",
  "notification"
] as const;

export type InboxV2TenantId = TenantId;
export type InboxV2EmployeeId = EmployeeId;
export type InboxV2ClientId = ClientId;
export type InboxV2ConversationId = ConversationId;
export type InboxV2MessageId = MessageId;
export type InboxV2EventId = EventId;
export type InboxV2SourceConnectionId = SourceConnectionId;
export type InboxV2SourceAccountId = SourceAccountId;
export type InboxV2RawInboundEventId = RawInboundEventId;
export type InboxV2NormalizedInboundEventId = NormalizedInboundEventId;

export type InboxV2AccountId = Brand<string, "InboxV2AccountId">;
export type InboxV2AuthExternalIdentityLinkId = Brand<
  string,
  "InboxV2AuthExternalIdentityLinkId"
>;
export type InboxV2BotIdentityId = Brand<string, "InboxV2BotIdentityId">;
export type InboxV2ClientContactId = Brand<string, "InboxV2ClientContactId">;
/** Opaque tenant-defined stage identity; stage values/semantics belong to CRM. */
export type InboxV2ClientStageId = Brand<string, "InboxV2ClientStageId">;
export type InboxV2ConversationParticipantId = Brand<
  string,
  "InboxV2ConversationParticipantId"
>;
export type InboxV2ParticipantMembershipEpisodeId = Brand<
  string,
  "InboxV2ParticipantMembershipEpisodeId"
>;
export type InboxV2ParticipantMembershipTransitionId = Brand<
  string,
  "InboxV2ParticipantMembershipTransitionId"
>;
export type InboxV2ParticipantAuthorObservationId = Brand<
  string,
  "InboxV2ParticipantAuthorObservationId"
>;
export type InboxV2ConversationClientLinkId = Brand<
  string,
  "InboxV2ConversationClientLinkId"
>;
export type InboxV2ConversationClientLinkTransitionId = Brand<
  string,
  "InboxV2ConversationClientLinkTransitionId"
>;
export type InboxV2ClientMergeRedirectId = Brand<
  string,
  "InboxV2ClientMergeRedirectId"
>;
export type InboxV2WorkItemId = Brand<string, "InboxV2WorkItemId">;
export type InboxV2ConversationWorkItemSlotId = Brand<
  string,
  "InboxV2ConversationWorkItemSlotId"
>;
export type InboxV2WorkItemPrimaryAssignmentId = Brand<
  string,
  "InboxV2WorkItemPrimaryAssignmentId"
>;
export type InboxV2WorkItemTransitionId = Brand<
  string,
  "InboxV2WorkItemTransitionId"
>;
export type InboxV2WorkItemServicingTeamEpisodeId = Brand<
  string,
  "InboxV2WorkItemServicingTeamEpisodeId"
>;
export type InboxV2WorkItemCollaboratorEpisodeId = Brand<
  string,
  "InboxV2WorkItemCollaboratorEpisodeId"
>;
export type InboxV2WorkItemRelationTransitionId = Brand<
  string,
  "InboxV2WorkItemRelationTransitionId"
>;
export type InboxV2WorkQueueEligibilityDecisionId = Brand<
  string,
  "InboxV2WorkQueueEligibilityDecisionId"
>;
export type InboxV2WorkQueueId = Brand<string, "InboxV2WorkQueueId">;
export type InboxV2TeamId = Brand<string, "InboxV2TeamId">;
export type InboxV2OrgUnitId = Brand<string, "InboxV2OrgUnitId">;
export type InboxV2TimelineItemId = Brand<string, "InboxV2TimelineItemId">;
export type InboxV2TimelineContentId = Brand<
  string,
  "InboxV2TimelineContentId"
>;
export type InboxV2StaffNoteId = Brand<string, "InboxV2StaffNoteId">;
export type InboxV2StaffNoteRevisionId = Brand<
  string,
  "InboxV2StaffNoteRevisionId"
>;
export type InboxV2SourceObjectId = Brand<string, "InboxV2SourceObjectId">;
export type InboxV2MessageRevisionId = Brand<
  string,
  "InboxV2MessageRevisionId"
>;
export type InboxV2MessageReactionId = Brand<
  string,
  "InboxV2MessageReactionId"
>;
export type InboxV2MessageReactionTransitionId = Brand<
  string,
  "InboxV2MessageReactionTransitionId"
>;
export type InboxV2MessageDeliveryObservationId = Brand<
  string,
  "InboxV2MessageDeliveryObservationId"
>;
export type InboxV2ProviderReceiptObservationId = Brand<
  string,
  "InboxV2ProviderReceiptObservationId"
>;
export type InboxV2MessageTransportOccurrenceLinkId = Brand<
  string,
  "InboxV2MessageTransportOccurrenceLinkId"
>;
export type InboxV2MessageProviderLifecycleOperationId = Brand<
  string,
  "InboxV2MessageProviderLifecycleOperationId"
>;
export type InboxV2DeferredMessageSourceActionId = Brand<
  string,
  "InboxV2DeferredMessageSourceActionId"
>;
export type InboxV2MessageAttachmentId = Brand<
  string,
  "InboxV2MessageAttachmentId"
>;
export type InboxV2AttachmentMaterializationClaimId = Brand<
  string,
  "InboxV2AttachmentMaterializationClaimId"
>;
export type InboxV2AttachmentMaterializationAttemptId = Brand<
  string,
  "InboxV2AttachmentMaterializationAttemptId"
>;
export type InboxV2AttachmentMaterializationEvidenceId = Brand<
  string,
  "InboxV2AttachmentMaterializationEvidenceId"
>;
export type InboxV2SourceExternalIdentityId = Brand<
  string,
  "InboxV2SourceExternalIdentityId"
>;
export type InboxV2SourceIdentityClaimId = Brand<
  string,
  "InboxV2SourceIdentityClaimId"
>;
export type InboxV2SourceIdentityClaimTransitionId = Brand<
  string,
  "InboxV2SourceIdentityClaimTransitionId"
>;
export type InboxV2ProviderRosterEvidenceId = Brand<
  string,
  "InboxV2ProviderRosterEvidenceId"
>;
export type InboxV2ProviderRosterMemberEvidenceId = Brand<
  string,
  "InboxV2ProviderRosterMemberEvidenceId"
>;
export type InboxV2ExternalThreadId = Brand<string, "InboxV2ExternalThreadId">;
export type InboxV2ExternalThreadAliasId = Brand<
  string,
  "InboxV2ExternalThreadAliasId"
>;
export type InboxV2SourceThreadBindingId = Brand<
  string,
  "InboxV2SourceThreadBindingId"
>;
export type InboxV2SourceThreadBindingRemoteAccessEpisodeId = Brand<
  string,
  "InboxV2SourceThreadBindingRemoteAccessEpisodeId"
>;
export type InboxV2SourceThreadBindingTransitionId = Brand<
  string,
  "InboxV2SourceThreadBindingTransitionId"
>;
export type InboxV2ThreadRoutePolicyId = Brand<
  string,
  "InboxV2ThreadRoutePolicyId"
>;
export type InboxV2ExternalMessageReferenceId = Brand<
  string,
  "InboxV2ExternalMessageReferenceId"
>;
export type InboxV2SourceOccurrenceId = Brand<
  string,
  "InboxV2SourceOccurrenceId"
>;
export type InboxV2OutboundRouteId = Brand<string, "InboxV2OutboundRouteId">;
export type InboxV2OutboundDispatchId = Brand<
  string,
  "InboxV2OutboundDispatchId"
>;
export type InboxV2OutboundDispatchAttemptId = Brand<
  string,
  "InboxV2OutboundDispatchAttemptId"
>;
export type InboxV2OutboundDispatchReconciliationDecisionId = Brand<
  string,
  "InboxV2OutboundDispatchReconciliationDecisionId"
>;
export type InboxV2OutboundDispatchArtifactId = Brand<
  string,
  "InboxV2OutboundDispatchArtifactId"
>;
export type InboxV2OutboundDispatchArtifactReferenceLinkId = Brand<
  string,
  "InboxV2OutboundDispatchArtifactReferenceLinkId"
>;
export type InboxV2OutboundDispatchArtifactResolutionId = Brand<
  string,
  "InboxV2OutboundDispatchArtifactResolutionId"
>;
export type InboxV2OutboundProviderObservationId = Brand<
  string,
  "InboxV2OutboundProviderObservationId"
>;
export type InboxV2OutboundMultiSendOperationId = Brand<
  string,
  "InboxV2OutboundMultiSendOperationId"
>;
export type InboxV2SourceAccountIdentityAliasId = Brand<
  string,
  "InboxV2SourceAccountIdentityAliasId"
>;
export type InboxV2SourceAccountIdentityTransitionId = Brand<
  string,
  "InboxV2SourceAccountIdentityTransitionId"
>;
export type InboxV2FileId = Brand<string, "InboxV2FileId">;
export type InboxV2FileVersionId = Brand<string, "InboxV2FileVersionId">;
export type InboxV2ObjectVersionId = Brand<string, "InboxV2ObjectVersionId">;
export type InboxV2FileParentLinkId = Brand<string, "InboxV2FileParentLinkId">;
export type InboxV2FileLineageEdgeId = Brand<
  string,
  "InboxV2FileLineageEdgeId"
>;
export type InboxV2ObjectOperationEvidenceId = Brand<
  string,
  "InboxV2ObjectOperationEvidenceId"
>;
export type InboxV2OutboundDispatchContentPlanId = Brand<
  string,
  "InboxV2OutboundDispatchContentPlanId"
>;
export type InboxV2WatcherSubscriptionId = Brand<
  string,
  "InboxV2WatcherSubscriptionId"
>;
export type InboxV2NotificationId = Brand<string, "InboxV2NotificationId">;

export const inboxV2EntityKindSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(inboxV2IdPrefixPattern);

/**
 * Creates a canonical V2 ID parser. The prefix is a runtime type discriminator,
 * not a tenant or authorization boundary.
 */
function createInboxV2IdSchema<TId extends string>(
  prefix: string,
  compatibilityPrefixes: readonly string[] = []
) {
  const parsedPrefix = inboxV2EntityKindSchema.parse(prefix);
  const acceptedPrefixes = [
    `${parsedPrefix}:`,
    ...compatibilityPrefixes.map(parseCompatibilityIdPrefix)
  ];

  return z
    .string()
    .min(3)
    .max(256)
    .superRefine((value, context) => {
      const apparentKind = findKnownEntityKindPrefix(value);

      if (
        apparentKind &&
        apparentKind.kind !== parsedPrefix &&
        !compatibilityPrefixes.includes(apparentKind.prefix)
      ) {
        context.addIssue({
          code: "custom",
          message: `Inbox V2 ID kind ${apparentKind.kind} cannot substitute for ${parsedPrefix}.`
        });
        return;
      }

      const matchedPrefix = acceptedPrefixes.find((candidate) =>
        value.startsWith(candidate)
      );

      if (!matchedPrefix) {
        context.addIssue({
          code: "custom",
          message: `Inbox V2 ID must use the ${parsedPrefix}: prefix or an approved compatibility prefix.`
        });
        return;
      }

      if (!inboxV2IdOpaquePartPattern.test(value.slice(matchedPrefix.length))) {
        context.addIssue({
          code: "custom",
          message: "Inbox V2 ID contains an invalid opaque ID part."
        });
      }
    })
    .transform((value) => value as TId);
}

export const inboxV2TenantIdSchema = createInboxV2IdSchema<InboxV2TenantId>(
  "tenant",
  ["tenant_", "tenant-"]
);
export const inboxV2EmployeeIdSchema = createInboxV2IdSchema<InboxV2EmployeeId>(
  "employee",
  ["employee_", "employee-"]
);
export const inboxV2ClientIdSchema = createInboxV2IdSchema<InboxV2ClientId>(
  "client",
  ["client_", "client-"]
);
export const inboxV2ConversationIdSchema =
  createInboxV2IdSchema<InboxV2ConversationId>("conversation", [
    "conversation_",
    "conversation-"
  ]);
export const inboxV2MessageIdSchema = createInboxV2IdSchema<InboxV2MessageId>(
  "message",
  ["message_", "message-"]
);
export const inboxV2EventIdSchema = createInboxV2IdSchema<InboxV2EventId>(
  "event",
  ["event_", "event-"]
);
export const inboxV2SourceConnectionIdSchema =
  createInboxV2IdSchema<InboxV2SourceConnectionId>("source_connection", [
    "source_connection_",
    "source_connection-",
    "src_conn_"
  ]);
export const inboxV2SourceAccountIdSchema =
  createInboxV2IdSchema<InboxV2SourceAccountId>("source_account", [
    "source_account_",
    "source_account-",
    "src_acc_"
  ]);
export const inboxV2SourceAccountIdentityAliasIdSchema =
  createInboxV2IdSchema<InboxV2SourceAccountIdentityAliasId>(
    "source_account_identity_alias"
  );
export const inboxV2SourceAccountIdentityTransitionIdSchema =
  createInboxV2IdSchema<InboxV2SourceAccountIdentityTransitionId>(
    "source_account_identity_transition"
  );
export const inboxV2RawInboundEventIdSchema =
  createInboxV2IdSchema<InboxV2RawInboundEventId>("raw_inbound_event", [
    "raw_inbound_event_",
    "raw_inbound_event-",
    "raw_evt_"
  ]);
export const inboxV2NormalizedInboundEventIdSchema =
  createInboxV2IdSchema<InboxV2NormalizedInboundEventId>(
    "normalized_inbound_event",
    ["normalized_inbound_event_", "normalized_inbound_event-", "norm_evt_"]
  );
export const inboxV2AccountIdSchema = createInboxV2IdSchema<InboxV2AccountId>(
  "account",
  ["account_", "account-"]
);
export const inboxV2AuthExternalIdentityLinkIdSchema =
  createInboxV2IdSchema<InboxV2AuthExternalIdentityLinkId>(
    "auth_external_identity_link"
  );
export const inboxV2BotIdentityIdSchema =
  createInboxV2IdSchema<InboxV2BotIdentityId>("bot_identity");
export const inboxV2ClientContactIdSchema =
  createInboxV2IdSchema<InboxV2ClientContactId>("client_contact", [
    "client_contact_",
    "client_contact-"
  ]);
export const inboxV2ClientStageIdSchema =
  createInboxV2IdSchema<InboxV2ClientStageId>("client_stage");
export const inboxV2ConversationParticipantIdSchema =
  createInboxV2IdSchema<InboxV2ConversationParticipantId>(
    "conversation_participant"
  );
export const inboxV2ParticipantMembershipEpisodeIdSchema =
  createInboxV2IdSchema<InboxV2ParticipantMembershipEpisodeId>(
    "participant_membership_episode"
  );
export const inboxV2ParticipantMembershipTransitionIdSchema =
  createInboxV2IdSchema<InboxV2ParticipantMembershipTransitionId>(
    "participant_membership_transition"
  );
export const inboxV2ParticipantAuthorObservationIdSchema =
  createInboxV2IdSchema<InboxV2ParticipantAuthorObservationId>(
    "participant_author_observation"
  );
export const inboxV2ConversationClientLinkIdSchema =
  createInboxV2IdSchema<InboxV2ConversationClientLinkId>(
    "conversation_client_link"
  );
export const inboxV2ConversationClientLinkTransitionIdSchema =
  createInboxV2IdSchema<InboxV2ConversationClientLinkTransitionId>(
    "conversation_client_link_transition"
  );
export const inboxV2ClientMergeRedirectIdSchema =
  createInboxV2IdSchema<InboxV2ClientMergeRedirectId>("client_merge_redirect");
export const inboxV2WorkItemIdSchema =
  createInboxV2IdSchema<InboxV2WorkItemId>("work_item");
export const inboxV2ConversationWorkItemSlotIdSchema =
  createInboxV2IdSchema<InboxV2ConversationWorkItemSlotId>(
    "conversation_work_item_slot"
  );
export const inboxV2WorkItemPrimaryAssignmentIdSchema =
  createInboxV2IdSchema<InboxV2WorkItemPrimaryAssignmentId>(
    "work_item_primary_assignment"
  );
export const inboxV2WorkItemTransitionIdSchema =
  createInboxV2IdSchema<InboxV2WorkItemTransitionId>("work_item_transition");
export const inboxV2WorkItemServicingTeamEpisodeIdSchema =
  createInboxV2IdSchema<InboxV2WorkItemServicingTeamEpisodeId>(
    "work_item_servicing_team_episode"
  );
export const inboxV2WorkItemCollaboratorEpisodeIdSchema =
  createInboxV2IdSchema<InboxV2WorkItemCollaboratorEpisodeId>(
    "work_item_collaborator_episode"
  );
export const inboxV2WorkItemRelationTransitionIdSchema =
  createInboxV2IdSchema<InboxV2WorkItemRelationTransitionId>(
    "work_item_relation_transition"
  );
export const inboxV2WorkQueueEligibilityDecisionIdSchema =
  createInboxV2IdSchema<InboxV2WorkQueueEligibilityDecisionId>(
    "work_queue_eligibility_decision"
  );
export const inboxV2WorkQueueIdSchema =
  createInboxV2IdSchema<InboxV2WorkQueueId>("work_queue", [
    "work_queue_",
    "work_queue-",
    "queue:",
    "queue_",
    "queue-"
  ]);
export const inboxV2TeamIdSchema = createInboxV2IdSchema<InboxV2TeamId>(
  "team",
  ["team_", "team-"]
);
export const inboxV2OrgUnitIdSchema = createInboxV2IdSchema<InboxV2OrgUnitId>(
  "org_unit",
  ["org_unit_", "org_unit-"]
);
export const inboxV2TimelineItemIdSchema =
  createInboxV2IdSchema<InboxV2TimelineItemId>("timeline_item");
export const inboxV2TimelineContentIdSchema =
  createInboxV2IdSchema<InboxV2TimelineContentId>("timeline_content");
export const inboxV2StaffNoteIdSchema =
  createInboxV2IdSchema<InboxV2StaffNoteId>("staff_note");
export const inboxV2StaffNoteRevisionIdSchema =
  createInboxV2IdSchema<InboxV2StaffNoteRevisionId>("staff_note_revision");
export const inboxV2SourceObjectIdSchema =
  createInboxV2IdSchema<InboxV2SourceObjectId>("source_object");
export const inboxV2MessageRevisionIdSchema =
  createInboxV2IdSchema<InboxV2MessageRevisionId>("message_revision");
export const inboxV2MessageReactionIdSchema =
  createInboxV2IdSchema<InboxV2MessageReactionId>("message_reaction");
export const inboxV2MessageReactionTransitionIdSchema =
  createInboxV2IdSchema<InboxV2MessageReactionTransitionId>(
    "message_reaction_transition"
  );
export const inboxV2MessageDeliveryObservationIdSchema =
  createInboxV2IdSchema<InboxV2MessageDeliveryObservationId>(
    "message_delivery_observation"
  );
export const inboxV2ProviderReceiptObservationIdSchema =
  createInboxV2IdSchema<InboxV2ProviderReceiptObservationId>(
    "provider_receipt_observation"
  );
export const inboxV2MessageTransportOccurrenceLinkIdSchema =
  createInboxV2IdSchema<InboxV2MessageTransportOccurrenceLinkId>(
    "message_transport_occurrence_link"
  );
export const inboxV2MessageProviderLifecycleOperationIdSchema =
  createInboxV2IdSchema<InboxV2MessageProviderLifecycleOperationId>(
    "message_provider_lifecycle_operation"
  );
export const inboxV2DeferredMessageSourceActionIdSchema =
  createInboxV2IdSchema<InboxV2DeferredMessageSourceActionId>(
    "deferred_message_source_action"
  );
export const inboxV2MessageAttachmentIdSchema =
  createInboxV2IdSchema<InboxV2MessageAttachmentId>("message_attachment", [
    "message_attachment_",
    "message_attachment-"
  ]);
export const inboxV2AttachmentMaterializationClaimIdSchema =
  createInboxV2IdSchema<InboxV2AttachmentMaterializationClaimId>(
    "attachment_materialization_claim"
  );
export const inboxV2AttachmentMaterializationAttemptIdSchema =
  createInboxV2IdSchema<InboxV2AttachmentMaterializationAttemptId>(
    "attachment_materialization_attempt"
  );
export const inboxV2AttachmentMaterializationEvidenceIdSchema =
  createInboxV2IdSchema<InboxV2AttachmentMaterializationEvidenceId>(
    "attachment_materialization_evidence"
  );
export const inboxV2SourceExternalIdentityIdSchema =
  createInboxV2IdSchema<InboxV2SourceExternalIdentityId>(
    "source_external_identity"
  );
export const inboxV2SourceIdentityClaimIdSchema =
  createInboxV2IdSchema<InboxV2SourceIdentityClaimId>("source_identity_claim");
export const inboxV2SourceIdentityClaimTransitionIdSchema =
  createInboxV2IdSchema<InboxV2SourceIdentityClaimTransitionId>(
    "source_identity_claim_transition"
  );
export const inboxV2ProviderRosterEvidenceIdSchema =
  createInboxV2IdSchema<InboxV2ProviderRosterEvidenceId>(
    "provider_roster_evidence"
  );
export const inboxV2ProviderRosterMemberEvidenceIdSchema =
  createInboxV2IdSchema<InboxV2ProviderRosterMemberEvidenceId>(
    "provider_roster_member_evidence"
  );
export const inboxV2ExternalThreadIdSchema =
  createInboxV2IdSchema<InboxV2ExternalThreadId>("external_thread");
export const inboxV2ExternalThreadAliasIdSchema =
  createInboxV2IdSchema<InboxV2ExternalThreadAliasId>("external_thread_alias");
export const inboxV2SourceThreadBindingIdSchema =
  createInboxV2IdSchema<InboxV2SourceThreadBindingId>("source_thread_binding");
export const inboxV2SourceThreadBindingRemoteAccessEpisodeIdSchema =
  createInboxV2IdSchema<InboxV2SourceThreadBindingRemoteAccessEpisodeId>(
    "source_thread_binding_remote_access_episode"
  );
export const inboxV2SourceThreadBindingTransitionIdSchema =
  createInboxV2IdSchema<InboxV2SourceThreadBindingTransitionId>(
    "source_thread_binding_transition"
  );
export const inboxV2ThreadRoutePolicyIdSchema =
  createInboxV2IdSchema<InboxV2ThreadRoutePolicyId>("thread_route_policy");
export const inboxV2ExternalMessageReferenceIdSchema =
  createInboxV2IdSchema<InboxV2ExternalMessageReferenceId>(
    "external_message_reference"
  );
export const inboxV2SourceOccurrenceIdSchema =
  createInboxV2IdSchema<InboxV2SourceOccurrenceId>("source_occurrence");
export const inboxV2OutboundRouteIdSchema =
  createInboxV2IdSchema<InboxV2OutboundRouteId>("outbound_route");
export const inboxV2OutboundDispatchIdSchema =
  createInboxV2IdSchema<InboxV2OutboundDispatchId>("outbound_dispatch");
export const inboxV2OutboundDispatchAttemptIdSchema =
  createInboxV2IdSchema<InboxV2OutboundDispatchAttemptId>(
    "outbound_dispatch_attempt"
  );
export const inboxV2OutboundDispatchReconciliationDecisionIdSchema =
  createInboxV2IdSchema<InboxV2OutboundDispatchReconciliationDecisionId>(
    "outbound_dispatch_reconciliation_decision"
  );
export const inboxV2OutboundDispatchArtifactIdSchema =
  createInboxV2IdSchema<InboxV2OutboundDispatchArtifactId>(
    "outbound_dispatch_artifact"
  );
export const inboxV2OutboundDispatchArtifactReferenceLinkIdSchema =
  createInboxV2IdSchema<InboxV2OutboundDispatchArtifactReferenceLinkId>(
    "outbound_dispatch_artifact_reference_link"
  );
export const inboxV2OutboundDispatchArtifactResolutionIdSchema =
  createInboxV2IdSchema<InboxV2OutboundDispatchArtifactResolutionId>(
    "outbound_dispatch_artifact_resolution"
  );
export const inboxV2OutboundProviderObservationIdSchema =
  createInboxV2IdSchema<InboxV2OutboundProviderObservationId>(
    "outbound_provider_observation"
  );
export const inboxV2OutboundMultiSendOperationIdSchema =
  createInboxV2IdSchema<InboxV2OutboundMultiSendOperationId>(
    "outbound_multi_send_operation"
  );
export const inboxV2FileIdSchema = createInboxV2IdSchema<InboxV2FileId>(
  "file",
  ["file_", "file-"]
);
export const inboxV2FileVersionIdSchema =
  createInboxV2IdSchema<InboxV2FileVersionId>("file_version");
export const inboxV2ObjectVersionIdSchema =
  createInboxV2IdSchema<InboxV2ObjectVersionId>("file_object_version");
export const inboxV2FileParentLinkIdSchema =
  createInboxV2IdSchema<InboxV2FileParentLinkId>("file_parent_link");
export const inboxV2FileLineageEdgeIdSchema =
  createInboxV2IdSchema<InboxV2FileLineageEdgeId>("file_derivative_edge");
export const inboxV2ObjectOperationEvidenceIdSchema =
  createInboxV2IdSchema<InboxV2ObjectOperationEvidenceId>(
    "object_operation_evidence"
  );
export const inboxV2OutboundDispatchContentPlanIdSchema =
  createInboxV2IdSchema<InboxV2OutboundDispatchContentPlanId>(
    "outbound_dispatch_content_plan"
  );
export const inboxV2WatcherSubscriptionIdSchema =
  createInboxV2IdSchema<InboxV2WatcherSubscriptionId>("watcher_subscription");
export const inboxV2NotificationIdSchema =
  createInboxV2IdSchema<InboxV2NotificationId>("notification", [
    "notification_",
    "notification-"
  ]);

export type InboxV2TenantScopedReference<
  TKind extends string,
  TId extends string
> = Readonly<{
  tenantId: InboxV2TenantId;
  kind: TKind;
  id: TId;
}>;

function createInboxV2TenantScopedReferenceSchema<
  const TKind extends string,
  TIdSchema extends z.ZodType<string, string>
>(kind: TKind, idSchema: TIdSchema) {
  const parsedKind = inboxV2EntityKindSchema.parse(kind);

  return z
    .object({
      tenantId: inboxV2TenantIdSchema,
      kind: z.literal(parsedKind as TKind),
      id: idSchema
    })
    .strict();
}

export const inboxV2AccountReferenceSchema =
  createInboxV2TenantScopedReferenceSchema("account", inboxV2AccountIdSchema);
export const inboxV2AuthExternalIdentityLinkReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "auth_external_identity_link",
    inboxV2AuthExternalIdentityLinkIdSchema
  );
export const inboxV2BotIdentityReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "bot_identity",
    inboxV2BotIdentityIdSchema
  );
export const inboxV2EmployeeReferenceSchema =
  createInboxV2TenantScopedReferenceSchema("employee", inboxV2EmployeeIdSchema);
export const inboxV2ClientReferenceSchema =
  createInboxV2TenantScopedReferenceSchema("client", inboxV2ClientIdSchema);
export const inboxV2ClientContactReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "client_contact",
    inboxV2ClientContactIdSchema
  );
export const inboxV2ClientStageReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "client_stage",
    inboxV2ClientStageIdSchema
  );
export const inboxV2ConversationReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "conversation",
    inboxV2ConversationIdSchema
  );
export const inboxV2ConversationParticipantReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "conversation_participant",
    inboxV2ConversationParticipantIdSchema
  );
export const inboxV2ParticipantMembershipEpisodeReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "participant_membership_episode",
    inboxV2ParticipantMembershipEpisodeIdSchema
  );
export const inboxV2ParticipantMembershipTransitionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "participant_membership_transition",
    inboxV2ParticipantMembershipTransitionIdSchema
  );
export const inboxV2ParticipantAuthorObservationReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "participant_author_observation",
    inboxV2ParticipantAuthorObservationIdSchema
  );
export const inboxV2ConversationClientLinkReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "conversation_client_link",
    inboxV2ConversationClientLinkIdSchema
  );
export const inboxV2ConversationClientLinkTransitionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "conversation_client_link_transition",
    inboxV2ConversationClientLinkTransitionIdSchema
  );
export const inboxV2ClientMergeRedirectReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "client_merge_redirect",
    inboxV2ClientMergeRedirectIdSchema
  );
export const inboxV2WorkItemReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "work_item",
    inboxV2WorkItemIdSchema
  );
export const inboxV2ConversationWorkItemSlotReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "conversation_work_item_slot",
    inboxV2ConversationWorkItemSlotIdSchema
  );
export const inboxV2WorkItemPrimaryAssignmentReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "work_item_primary_assignment",
    inboxV2WorkItemPrimaryAssignmentIdSchema
  );
export const inboxV2WorkItemTransitionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "work_item_transition",
    inboxV2WorkItemTransitionIdSchema
  );
export const inboxV2WorkItemServicingTeamEpisodeReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "work_item_servicing_team_episode",
    inboxV2WorkItemServicingTeamEpisodeIdSchema
  );
export const inboxV2WorkItemCollaboratorEpisodeReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "work_item_collaborator_episode",
    inboxV2WorkItemCollaboratorEpisodeIdSchema
  );
export const inboxV2WorkItemRelationTransitionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "work_item_relation_transition",
    inboxV2WorkItemRelationTransitionIdSchema
  );
export const inboxV2WorkQueueEligibilityDecisionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "work_queue_eligibility_decision",
    inboxV2WorkQueueEligibilityDecisionIdSchema
  );
export const inboxV2WorkQueueReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "work_queue",
    inboxV2WorkQueueIdSchema
  );
export const inboxV2TeamReferenceSchema =
  createInboxV2TenantScopedReferenceSchema("team", inboxV2TeamIdSchema);
export const inboxV2OrgUnitReferenceSchema =
  createInboxV2TenantScopedReferenceSchema("org_unit", inboxV2OrgUnitIdSchema);
export const inboxV2TimelineItemReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "timeline_item",
    inboxV2TimelineItemIdSchema
  );
export const inboxV2TimelineContentReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "timeline_content",
    inboxV2TimelineContentIdSchema
  );
export const inboxV2StaffNoteReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "staff_note",
    inboxV2StaffNoteIdSchema
  );
export const inboxV2StaffNoteRevisionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "staff_note_revision",
    inboxV2StaffNoteRevisionIdSchema
  );
export const inboxV2SourceObjectReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_object",
    inboxV2SourceObjectIdSchema
  );
export const inboxV2MessageReferenceSchema =
  createInboxV2TenantScopedReferenceSchema("message", inboxV2MessageIdSchema);
export const inboxV2EventReferenceSchema =
  createInboxV2TenantScopedReferenceSchema("event", inboxV2EventIdSchema);
export const inboxV2MessageRevisionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "message_revision",
    inboxV2MessageRevisionIdSchema
  );
export const inboxV2MessageReactionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "message_reaction",
    inboxV2MessageReactionIdSchema
  );
export const inboxV2MessageReactionTransitionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "message_reaction_transition",
    inboxV2MessageReactionTransitionIdSchema
  );
export const inboxV2MessageDeliveryObservationReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "message_delivery_observation",
    inboxV2MessageDeliveryObservationIdSchema
  );
export const inboxV2ProviderReceiptObservationReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "provider_receipt_observation",
    inboxV2ProviderReceiptObservationIdSchema
  );
export const inboxV2MessageTransportOccurrenceLinkReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "message_transport_occurrence_link",
    inboxV2MessageTransportOccurrenceLinkIdSchema
  );
export const inboxV2MessageProviderLifecycleOperationReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "message_provider_lifecycle_operation",
    inboxV2MessageProviderLifecycleOperationIdSchema
  );
export const inboxV2DeferredMessageSourceActionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "deferred_message_source_action",
    inboxV2DeferredMessageSourceActionIdSchema
  );
export const inboxV2MessageAttachmentReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "message_attachment",
    inboxV2MessageAttachmentIdSchema
  );
export const inboxV2AttachmentMaterializationClaimReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "attachment_materialization_claim",
    inboxV2AttachmentMaterializationClaimIdSchema
  );
export const inboxV2AttachmentMaterializationAttemptReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "attachment_materialization_attempt",
    inboxV2AttachmentMaterializationAttemptIdSchema
  );
export const inboxV2AttachmentMaterializationEvidenceReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "attachment_materialization_evidence",
    inboxV2AttachmentMaterializationEvidenceIdSchema
  );
export const inboxV2SourceExternalIdentityReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_external_identity",
    inboxV2SourceExternalIdentityIdSchema
  );
export const inboxV2SourceIdentityClaimReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_identity_claim",
    inboxV2SourceIdentityClaimIdSchema
  );
export const inboxV2SourceIdentityClaimTransitionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_identity_claim_transition",
    inboxV2SourceIdentityClaimTransitionIdSchema
  );
export const inboxV2ProviderRosterEvidenceReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "provider_roster_evidence",
    inboxV2ProviderRosterEvidenceIdSchema
  );
export const inboxV2ProviderRosterMemberEvidenceReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "provider_roster_member_evidence",
    inboxV2ProviderRosterMemberEvidenceIdSchema
  );
export const inboxV2ExternalThreadReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "external_thread",
    inboxV2ExternalThreadIdSchema
  );
export const inboxV2ExternalThreadAliasReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "external_thread_alias",
    inboxV2ExternalThreadAliasIdSchema
  );
export const inboxV2SourceThreadBindingReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_thread_binding",
    inboxV2SourceThreadBindingIdSchema
  );
export const inboxV2SourceThreadBindingRemoteAccessEpisodeReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_thread_binding_remote_access_episode",
    inboxV2SourceThreadBindingRemoteAccessEpisodeIdSchema
  );
export const inboxV2SourceThreadBindingTransitionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_thread_binding_transition",
    inboxV2SourceThreadBindingTransitionIdSchema
  );
export const inboxV2ThreadRoutePolicyReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "thread_route_policy",
    inboxV2ThreadRoutePolicyIdSchema
  );
export const inboxV2ExternalMessageReferenceRefSchema =
  createInboxV2TenantScopedReferenceSchema(
    "external_message_reference",
    inboxV2ExternalMessageReferenceIdSchema
  );
export const inboxV2SourceOccurrenceReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_occurrence",
    inboxV2SourceOccurrenceIdSchema
  );
export const inboxV2OutboundRouteReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "outbound_route",
    inboxV2OutboundRouteIdSchema
  );
export const inboxV2OutboundDispatchReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "outbound_dispatch",
    inboxV2OutboundDispatchIdSchema
  );
export const inboxV2OutboundDispatchAttemptReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "outbound_dispatch_attempt",
    inboxV2OutboundDispatchAttemptIdSchema
  );
export const inboxV2OutboundDispatchReconciliationDecisionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "outbound_dispatch_reconciliation_decision",
    inboxV2OutboundDispatchReconciliationDecisionIdSchema
  );
export const inboxV2OutboundDispatchArtifactReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "outbound_dispatch_artifact",
    inboxV2OutboundDispatchArtifactIdSchema
  );
export const inboxV2OutboundDispatchArtifactReferenceLinkReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "outbound_dispatch_artifact_reference_link",
    inboxV2OutboundDispatchArtifactReferenceLinkIdSchema
  );
export const inboxV2OutboundDispatchArtifactResolutionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "outbound_dispatch_artifact_resolution",
    inboxV2OutboundDispatchArtifactResolutionIdSchema
  );
export const inboxV2OutboundProviderObservationReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "outbound_provider_observation",
    inboxV2OutboundProviderObservationIdSchema
  );
export const inboxV2OutboundMultiSendOperationReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "outbound_multi_send_operation",
    inboxV2OutboundMultiSendOperationIdSchema
  );
export const inboxV2SourceConnectionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_connection",
    inboxV2SourceConnectionIdSchema
  );
export const inboxV2SourceAccountReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_account",
    inboxV2SourceAccountIdSchema
  );
export const inboxV2SourceAccountIdentityAliasReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_account_identity_alias",
    inboxV2SourceAccountIdentityAliasIdSchema
  );
export const inboxV2SourceAccountIdentityTransitionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "source_account_identity_transition",
    inboxV2SourceAccountIdentityTransitionIdSchema
  );
export const inboxV2RawInboundEventReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "raw_inbound_event",
    inboxV2RawInboundEventIdSchema
  );
export const inboxV2NormalizedInboundEventReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "normalized_inbound_event",
    inboxV2NormalizedInboundEventIdSchema
  );
export const inboxV2FileReferenceSchema =
  createInboxV2TenantScopedReferenceSchema("file", inboxV2FileIdSchema);
export const inboxV2FileVersionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "file_version",
    inboxV2FileVersionIdSchema
  );
export const inboxV2ObjectVersionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "file_object_version",
    inboxV2ObjectVersionIdSchema
  );
export const inboxV2FileParentLinkReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "file_parent_link",
    inboxV2FileParentLinkIdSchema
  );
export const inboxV2FileLineageEdgeReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "file_derivative_edge",
    inboxV2FileLineageEdgeIdSchema
  );
export const inboxV2ObjectOperationEvidenceReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "object_operation_evidence",
    inboxV2ObjectOperationEvidenceIdSchema
  );
export const inboxV2OutboundDispatchContentPlanReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "outbound_dispatch_content_plan",
    inboxV2OutboundDispatchContentPlanIdSchema
  );
export const inboxV2WatcherSubscriptionReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "watcher_subscription",
    inboxV2WatcherSubscriptionIdSchema
  );
export const inboxV2NotificationReferenceSchema =
  createInboxV2TenantScopedReferenceSchema(
    "notification",
    inboxV2NotificationIdSchema
  );

export type InboxV2AccountReference = z.infer<
  typeof inboxV2AccountReferenceSchema
>;
export type InboxV2AuthExternalIdentityLinkReference = z.infer<
  typeof inboxV2AuthExternalIdentityLinkReferenceSchema
>;
export type InboxV2BotIdentityReference = z.infer<
  typeof inboxV2BotIdentityReferenceSchema
>;
export type InboxV2EmployeeReference = z.infer<
  typeof inboxV2EmployeeReferenceSchema
>;
export type InboxV2ClientReference = z.infer<
  typeof inboxV2ClientReferenceSchema
>;
export type InboxV2ClientContactReference = z.infer<
  typeof inboxV2ClientContactReferenceSchema
>;
export type InboxV2ClientStageReference = z.infer<
  typeof inboxV2ClientStageReferenceSchema
>;
export type InboxV2ConversationReference = z.infer<
  typeof inboxV2ConversationReferenceSchema
>;
export type InboxV2ConversationParticipantReference = z.infer<
  typeof inboxV2ConversationParticipantReferenceSchema
>;
export type InboxV2ParticipantMembershipEpisodeReference = z.infer<
  typeof inboxV2ParticipantMembershipEpisodeReferenceSchema
>;
export type InboxV2ParticipantMembershipTransitionReference = z.infer<
  typeof inboxV2ParticipantMembershipTransitionReferenceSchema
>;
export type InboxV2ParticipantAuthorObservationReference = z.infer<
  typeof inboxV2ParticipantAuthorObservationReferenceSchema
>;
export type InboxV2ConversationClientLinkReference = z.infer<
  typeof inboxV2ConversationClientLinkReferenceSchema
>;
export type InboxV2ConversationClientLinkTransitionReference = z.infer<
  typeof inboxV2ConversationClientLinkTransitionReferenceSchema
>;
export type InboxV2ClientMergeRedirectReference = z.infer<
  typeof inboxV2ClientMergeRedirectReferenceSchema
>;
export type InboxV2WorkItemReference = z.infer<
  typeof inboxV2WorkItemReferenceSchema
>;
export type InboxV2ConversationWorkItemSlotReference = z.infer<
  typeof inboxV2ConversationWorkItemSlotReferenceSchema
>;
export type InboxV2WorkItemPrimaryAssignmentReference = z.infer<
  typeof inboxV2WorkItemPrimaryAssignmentReferenceSchema
>;
export type InboxV2WorkItemTransitionReference = z.infer<
  typeof inboxV2WorkItemTransitionReferenceSchema
>;
export type InboxV2WorkItemServicingTeamEpisodeReference = z.infer<
  typeof inboxV2WorkItemServicingTeamEpisodeReferenceSchema
>;
export type InboxV2WorkItemCollaboratorEpisodeReference = z.infer<
  typeof inboxV2WorkItemCollaboratorEpisodeReferenceSchema
>;
export type InboxV2WorkItemRelationTransitionReference = z.infer<
  typeof inboxV2WorkItemRelationTransitionReferenceSchema
>;
export type InboxV2WorkQueueEligibilityDecisionReference = z.infer<
  typeof inboxV2WorkQueueEligibilityDecisionReferenceSchema
>;
export type InboxV2WorkQueueReference = z.infer<
  typeof inboxV2WorkQueueReferenceSchema
>;
export type InboxV2TeamReference = z.infer<typeof inboxV2TeamReferenceSchema>;
export type InboxV2OrgUnitReference = z.infer<
  typeof inboxV2OrgUnitReferenceSchema
>;
export type InboxV2TimelineItemReference = z.infer<
  typeof inboxV2TimelineItemReferenceSchema
>;
export type InboxV2TimelineContentReference = z.infer<
  typeof inboxV2TimelineContentReferenceSchema
>;
export type InboxV2StaffNoteReference = z.infer<
  typeof inboxV2StaffNoteReferenceSchema
>;
export type InboxV2StaffNoteRevisionReference = z.infer<
  typeof inboxV2StaffNoteRevisionReferenceSchema
>;
export type InboxV2SourceObjectReference = z.infer<
  typeof inboxV2SourceObjectReferenceSchema
>;
export type InboxV2MessageReference = z.infer<
  typeof inboxV2MessageReferenceSchema
>;
export type InboxV2EventReference = z.infer<typeof inboxV2EventReferenceSchema>;
export type InboxV2MessageRevisionReference = z.infer<
  typeof inboxV2MessageRevisionReferenceSchema
>;
export type InboxV2MessageReactionReference = z.infer<
  typeof inboxV2MessageReactionReferenceSchema
>;
export type InboxV2MessageReactionTransitionReference = z.infer<
  typeof inboxV2MessageReactionTransitionReferenceSchema
>;
export type InboxV2MessageDeliveryObservationReference = z.infer<
  typeof inboxV2MessageDeliveryObservationReferenceSchema
>;
export type InboxV2ProviderReceiptObservationReference = z.infer<
  typeof inboxV2ProviderReceiptObservationReferenceSchema
>;
export type InboxV2MessageTransportOccurrenceLinkReference = z.infer<
  typeof inboxV2MessageTransportOccurrenceLinkReferenceSchema
>;
export type InboxV2MessageProviderLifecycleOperationReference = z.infer<
  typeof inboxV2MessageProviderLifecycleOperationReferenceSchema
>;
export type InboxV2DeferredMessageSourceActionReference = z.infer<
  typeof inboxV2DeferredMessageSourceActionReferenceSchema
>;
export type InboxV2MessageAttachmentReference = z.infer<
  typeof inboxV2MessageAttachmentReferenceSchema
>;
export type InboxV2AttachmentMaterializationClaimReference = z.infer<
  typeof inboxV2AttachmentMaterializationClaimReferenceSchema
>;
export type InboxV2AttachmentMaterializationAttemptReference = z.infer<
  typeof inboxV2AttachmentMaterializationAttemptReferenceSchema
>;
export type InboxV2AttachmentMaterializationEvidenceReference = z.infer<
  typeof inboxV2AttachmentMaterializationEvidenceReferenceSchema
>;
export type InboxV2SourceExternalIdentityReference = z.infer<
  typeof inboxV2SourceExternalIdentityReferenceSchema
>;
export type InboxV2SourceIdentityClaimReference = z.infer<
  typeof inboxV2SourceIdentityClaimReferenceSchema
>;
export type InboxV2SourceIdentityClaimTransitionReference = z.infer<
  typeof inboxV2SourceIdentityClaimTransitionReferenceSchema
>;
export type InboxV2ProviderRosterEvidenceReference = z.infer<
  typeof inboxV2ProviderRosterEvidenceReferenceSchema
>;
export type InboxV2ProviderRosterMemberEvidenceReference = z.infer<
  typeof inboxV2ProviderRosterMemberEvidenceReferenceSchema
>;
export type InboxV2ExternalThreadReference = z.infer<
  typeof inboxV2ExternalThreadReferenceSchema
>;
export type InboxV2ExternalThreadAliasReference = z.infer<
  typeof inboxV2ExternalThreadAliasReferenceSchema
>;
export type InboxV2SourceThreadBindingReference = z.infer<
  typeof inboxV2SourceThreadBindingReferenceSchema
>;
export type InboxV2SourceThreadBindingRemoteAccessEpisodeReference = z.infer<
  typeof inboxV2SourceThreadBindingRemoteAccessEpisodeReferenceSchema
>;
export type InboxV2SourceThreadBindingTransitionReference = z.infer<
  typeof inboxV2SourceThreadBindingTransitionReferenceSchema
>;
export type InboxV2ThreadRoutePolicyReference = z.infer<
  typeof inboxV2ThreadRoutePolicyReferenceSchema
>;
export type InboxV2ExternalMessageReferenceRef = z.infer<
  typeof inboxV2ExternalMessageReferenceRefSchema
>;
export type InboxV2SourceOccurrenceReference = z.infer<
  typeof inboxV2SourceOccurrenceReferenceSchema
>;
export type InboxV2OutboundRouteReference = z.infer<
  typeof inboxV2OutboundRouteReferenceSchema
>;
export type InboxV2OutboundDispatchReference = z.infer<
  typeof inboxV2OutboundDispatchReferenceSchema
>;
export type InboxV2OutboundDispatchAttemptReference = z.infer<
  typeof inboxV2OutboundDispatchAttemptReferenceSchema
>;
export type InboxV2OutboundDispatchReconciliationDecisionReference = z.infer<
  typeof inboxV2OutboundDispatchReconciliationDecisionReferenceSchema
>;
export type InboxV2OutboundDispatchArtifactReference = z.infer<
  typeof inboxV2OutboundDispatchArtifactReferenceSchema
>;
export type InboxV2OutboundDispatchArtifactReferenceLinkReference = z.infer<
  typeof inboxV2OutboundDispatchArtifactReferenceLinkReferenceSchema
>;
export type InboxV2OutboundDispatchArtifactResolutionReference = z.infer<
  typeof inboxV2OutboundDispatchArtifactResolutionReferenceSchema
>;
export type InboxV2OutboundProviderObservationReference = z.infer<
  typeof inboxV2OutboundProviderObservationReferenceSchema
>;
export type InboxV2OutboundMultiSendOperationReference = z.infer<
  typeof inboxV2OutboundMultiSendOperationReferenceSchema
>;
export type InboxV2SourceConnectionReference = z.infer<
  typeof inboxV2SourceConnectionReferenceSchema
>;
export type InboxV2SourceAccountReference = z.infer<
  typeof inboxV2SourceAccountReferenceSchema
>;
export type InboxV2SourceAccountIdentityAliasReference = z.infer<
  typeof inboxV2SourceAccountIdentityAliasReferenceSchema
>;
export type InboxV2SourceAccountIdentityTransitionReference = z.infer<
  typeof inboxV2SourceAccountIdentityTransitionReferenceSchema
>;
export type InboxV2RawInboundEventReference = z.infer<
  typeof inboxV2RawInboundEventReferenceSchema
>;
export type InboxV2NormalizedInboundEventReference = z.infer<
  typeof inboxV2NormalizedInboundEventReferenceSchema
>;
export type InboxV2FileReference = z.infer<typeof inboxV2FileReferenceSchema>;
export type InboxV2FileVersionReference = z.infer<
  typeof inboxV2FileVersionReferenceSchema
>;
export type InboxV2ObjectVersionReference = z.infer<
  typeof inboxV2ObjectVersionReferenceSchema
>;
export type InboxV2FileParentLinkReference = z.infer<
  typeof inboxV2FileParentLinkReferenceSchema
>;
export type InboxV2FileLineageEdgeReference = z.infer<
  typeof inboxV2FileLineageEdgeReferenceSchema
>;
export type InboxV2ObjectOperationEvidenceReference = z.infer<
  typeof inboxV2ObjectOperationEvidenceReferenceSchema
>;
export type InboxV2OutboundDispatchContentPlanReference = z.infer<
  typeof inboxV2OutboundDispatchContentPlanReferenceSchema
>;
export type InboxV2WatcherSubscriptionReference = z.infer<
  typeof inboxV2WatcherSubscriptionReferenceSchema
>;
export type InboxV2NotificationReference = z.infer<
  typeof inboxV2NotificationReferenceSchema
>;

function parseCompatibilityIdPrefix(prefix: string): string {
  if (!/^[a-z][a-z0-9_]*(?::|_|-)$/.test(prefix)) {
    throw new Error(`Invalid Inbox V2 compatibility ID prefix: ${prefix}.`);
  }

  return prefix;
}

function findKnownEntityKindPrefix(
  value: string
): { kind: string; prefix: string } | null {
  let bestMatch: { kind: string; prefix: string } | null = null;

  for (const kind of inboxV2KnownEntityKinds) {
    for (const separator of [":", "_", "-"] as const) {
      const prefix = `${kind}${separator}`;

      if (
        value.startsWith(prefix) &&
        (!bestMatch || prefix.length > bestMatch.prefix.length)
      ) {
        bestMatch = { kind, prefix };
      }
    }
  }

  return bestMatch;
}
