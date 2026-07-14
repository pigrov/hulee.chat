import { describe, expect, it } from "vitest";

import {
  inboxV2AccountIdSchema,
  inboxV2AuthExternalIdentityLinkIdSchema,
  inboxV2BotIdentityIdSchema,
  inboxV2ClientContactIdSchema,
  inboxV2ClientIdSchema,
  inboxV2ClientMergeRedirectReferenceSchema,
  inboxV2ClientReferenceSchema,
  inboxV2ClientStageIdSchema,
  inboxV2ConversationClientLinkIdSchema,
  inboxV2ConversationClientLinkReferenceSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationClientLinkTransitionIdSchema,
  inboxV2ConversationWorkItemSlotIdSchema,
  inboxV2ConversationParticipantIdSchema,
  inboxV2ClientMergeRedirectIdSchema,
  inboxV2ConversationReferenceSchema,
  inboxV2DeferredMessageSourceActionReferenceSchema,
  inboxV2DeferredMessageSourceActionIdSchema,
  inboxV2EventIdSchema,
  inboxV2EventReferenceSchema,
  inboxV2ExternalMessageReferenceIdSchema,
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2ExternalThreadAliasIdSchema,
  inboxV2ExternalThreadIdSchema,
  inboxV2FileIdSchema,
  inboxV2MessageDeliveryObservationIdSchema,
  inboxV2MessageDeliveryObservationReferenceSchema,
  inboxV2MessageAttachmentIdSchema,
  inboxV2MessageIdSchema,
  inboxV2MessageProviderLifecycleOperationIdSchema,
  inboxV2MessageProviderLifecycleOperationReferenceSchema,
  inboxV2MessageReactionIdSchema,
  inboxV2MessageReactionReferenceSchema,
  inboxV2MessageReactionTransitionIdSchema,
  inboxV2MessageReactionTransitionReferenceSchema,
  inboxV2MessageRevisionIdSchema,
  inboxV2MessageRevisionReferenceSchema,
  inboxV2MessageTransportOccurrenceLinkIdSchema,
  inboxV2MessageTransportOccurrenceLinkReferenceSchema,
  inboxV2NormalizedInboundEventIdSchema,
  inboxV2NotificationIdSchema,
  inboxV2OrgUnitIdSchema,
  inboxV2OutboundDispatchArtifactIdSchema,
  inboxV2OutboundDispatchArtifactReferenceLinkIdSchema,
  inboxV2OutboundDispatchAttemptIdSchema,
  inboxV2OutboundDispatchIdSchema,
  inboxV2OutboundDispatchReconciliationDecisionIdSchema,
  inboxV2OutboundMultiSendOperationIdSchema,
  inboxV2OutboundRouteIdSchema,
  inboxV2ParticipantAuthorObservationIdSchema,
  inboxV2ParticipantMembershipEpisodeIdSchema,
  inboxV2ParticipantMembershipTransitionIdSchema,
  inboxV2ProviderRosterEvidenceIdSchema,
  inboxV2ProviderRosterMemberEvidenceIdSchema,
  inboxV2ProviderReceiptObservationIdSchema,
  inboxV2ProviderReceiptObservationReferenceSchema,
  inboxV2RawInboundEventIdSchema,
  inboxV2SourceAccountIdentityAliasIdSchema,
  inboxV2SourceAccountIdentityTransitionIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceIdentityClaimTransitionIdSchema,
  inboxV2SourceObjectIdSchema,
  inboxV2SourceObjectReferenceSchema,
  inboxV2SourceOccurrenceIdSchema,
  inboxV2SourceThreadBindingRemoteAccessEpisodeIdSchema,
  inboxV2SourceThreadBindingTransitionIdSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2TeamIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineContentIdSchema,
  inboxV2TimelineContentReferenceSchema,
  inboxV2TimelineItemIdSchema,
  inboxV2StaffNoteIdSchema,
  inboxV2StaffNoteReferenceSchema,
  inboxV2StaffNoteRevisionIdSchema,
  inboxV2StaffNoteRevisionReferenceSchema,
  inboxV2ThreadRoutePolicyIdSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkItemCollaboratorEpisodeIdSchema,
  inboxV2WorkItemPrimaryAssignmentIdSchema,
  inboxV2WorkItemRelationTransitionIdSchema,
  inboxV2WorkItemServicingTeamEpisodeIdSchema,
  inboxV2WorkItemTransitionIdSchema,
  inboxV2WorkQueueEligibilityDecisionIdSchema,
  inboxV2WatcherSubscriptionIdSchema,
  inboxV2WorkQueueIdSchema
} from "../index";

describe("Inbox V2 IDs", () => {
  it("parses every foundational ID through its canonical kind prefix", () => {
    const fixtures = [
      [inboxV2TenantIdSchema, "tenant:tenant-1"],
      [inboxV2AccountIdSchema, "account:account-1"],
      [
        inboxV2AuthExternalIdentityLinkIdSchema,
        "auth_external_identity_link:identity-link-1"
      ],
      [inboxV2BotIdentityIdSchema, "bot_identity:bot-1"],
      [inboxV2ClientIdSchema, "client:client-1"],
      [inboxV2ClientContactIdSchema, "client_contact:contact-1"],
      [inboxV2ClientStageIdSchema, "client_stage:enterprise.discovery"],
      [inboxV2ConversationIdSchema, "conversation:conversation-1"],
      [
        inboxV2ConversationParticipantIdSchema,
        "conversation_participant:participant-1"
      ],
      [
        inboxV2ConversationClientLinkIdSchema,
        "conversation_client_link:link-1"
      ],
      [
        inboxV2ConversationClientLinkTransitionIdSchema,
        "conversation_client_link_transition:transition-1"
      ],
      [inboxV2ClientMergeRedirectIdSchema, "client_merge_redirect:redirect-1"],
      [inboxV2WorkItemIdSchema, "work_item:work-1"],
      [
        inboxV2ConversationWorkItemSlotIdSchema,
        "conversation_work_item_slot:slot-1"
      ],
      [
        inboxV2WorkItemPrimaryAssignmentIdSchema,
        "work_item_primary_assignment:assignment-1"
      ],
      [inboxV2WorkItemTransitionIdSchema, "work_item_transition:transition-1"],
      [
        inboxV2WorkItemServicingTeamEpisodeIdSchema,
        "work_item_servicing_team_episode:team-1"
      ],
      [
        inboxV2WorkItemCollaboratorEpisodeIdSchema,
        "work_item_collaborator_episode:collaborator-1"
      ],
      [
        inboxV2WorkItemRelationTransitionIdSchema,
        "work_item_relation_transition:relation-1"
      ],
      [
        inboxV2WorkQueueEligibilityDecisionIdSchema,
        "work_queue_eligibility_decision:decision-1"
      ],
      [inboxV2WorkQueueIdSchema, "work_queue:queue-1"],
      [inboxV2TeamIdSchema, "team:team-1"],
      [inboxV2OrgUnitIdSchema, "org_unit:unit-1"],
      [inboxV2TimelineItemIdSchema, "timeline_item:item-1"],
      [inboxV2TimelineContentIdSchema, "timeline_content:content-1"],
      [inboxV2StaffNoteIdSchema, "staff_note:note-1"],
      [inboxV2StaffNoteRevisionIdSchema, "staff_note_revision:revision-1"],
      [inboxV2SourceObjectIdSchema, "source_object:call-1"],
      [inboxV2MessageIdSchema, "message:message-1"],
      [inboxV2MessageRevisionIdSchema, "message_revision:revision-1"],
      [inboxV2MessageReactionIdSchema, "message_reaction:reaction-1"],
      [
        inboxV2MessageReactionTransitionIdSchema,
        "message_reaction_transition:transition-1"
      ],
      [
        inboxV2MessageDeliveryObservationIdSchema,
        "message_delivery_observation:observation-1"
      ],
      [
        inboxV2ProviderReceiptObservationIdSchema,
        "provider_receipt_observation:observation-1"
      ],
      [
        inboxV2MessageTransportOccurrenceLinkIdSchema,
        "message_transport_occurrence_link:link-1"
      ],
      [
        inboxV2MessageProviderLifecycleOperationIdSchema,
        "message_provider_lifecycle_operation:operation-1"
      ],
      [
        inboxV2DeferredMessageSourceActionIdSchema,
        "deferred_message_source_action:action-1"
      ],
      [inboxV2MessageAttachmentIdSchema, "message_attachment:attachment-1"],
      [inboxV2EventIdSchema, "event:event-1"],
      [inboxV2RawInboundEventIdSchema, "raw_inbound_event:raw-event-1"],
      [
        inboxV2NormalizedInboundEventIdSchema,
        "normalized_inbound_event:normalized-event-1"
      ],
      [
        inboxV2SourceExternalIdentityIdSchema,
        "source_external_identity:identity-1"
      ],
      [inboxV2ExternalThreadIdSchema, "external_thread:thread-1"],
      [inboxV2ExternalThreadAliasIdSchema, "external_thread_alias:alias-1"],
      [inboxV2SourceThreadBindingIdSchema, "source_thread_binding:binding-1"],
      [
        inboxV2SourceThreadBindingRemoteAccessEpisodeIdSchema,
        "source_thread_binding_remote_access_episode:episode-1"
      ],
      [
        inboxV2SourceThreadBindingTransitionIdSchema,
        "source_thread_binding_transition:transition-1"
      ],
      [inboxV2ThreadRoutePolicyIdSchema, "thread_route_policy:policy-1"],
      [
        inboxV2ExternalMessageReferenceIdSchema,
        "external_message_reference:reference-1"
      ],
      [inboxV2SourceOccurrenceIdSchema, "source_occurrence:occurrence-1"],
      [inboxV2OutboundRouteIdSchema, "outbound_route:route-1"],
      [inboxV2OutboundDispatchIdSchema, "outbound_dispatch:dispatch-1"],
      [
        inboxV2OutboundDispatchAttemptIdSchema,
        "outbound_dispatch_attempt:attempt-1"
      ],
      [
        inboxV2OutboundDispatchArtifactIdSchema,
        "outbound_dispatch_artifact:artifact-1"
      ],
      [
        inboxV2OutboundDispatchReconciliationDecisionIdSchema,
        "outbound_dispatch_reconciliation_decision:decision-1"
      ],
      [
        inboxV2OutboundDispatchArtifactReferenceLinkIdSchema,
        "outbound_dispatch_artifact_reference_link:link-1"
      ],
      [
        inboxV2OutboundMultiSendOperationIdSchema,
        "outbound_multi_send_operation:operation-1"
      ],
      [inboxV2SourceConnectionIdSchema, "source_connection:connection-1"],
      [inboxV2SourceAccountIdSchema, "source_account:source-account-1"],
      [
        inboxV2SourceAccountIdentityAliasIdSchema,
        "source_account_identity_alias:identity-alias-1"
      ],
      [
        inboxV2SourceAccountIdentityTransitionIdSchema,
        "source_account_identity_transition:identity-transition-1"
      ],
      [inboxV2FileIdSchema, "file:file-1"],
      [inboxV2WatcherSubscriptionIdSchema, "watcher_subscription:watcher-1"],
      [inboxV2NotificationIdSchema, "notification:notification-1"],
      [
        inboxV2ParticipantMembershipEpisodeIdSchema,
        "participant_membership_episode:episode-1"
      ],
      [
        inboxV2ParticipantMembershipTransitionIdSchema,
        "participant_membership_transition:transition-1"
      ],
      [
        inboxV2ParticipantAuthorObservationIdSchema,
        "participant_author_observation:observation-1"
      ],
      [
        inboxV2ProviderRosterEvidenceIdSchema,
        "provider_roster_evidence:evidence-1"
      ],
      [
        inboxV2ProviderRosterMemberEvidenceIdSchema,
        "provider_roster_member_evidence:member-evidence-1"
      ],
      [inboxV2SourceIdentityClaimIdSchema, "source_identity_claim:claim-1"],
      [
        inboxV2SourceIdentityClaimTransitionIdSchema,
        "source_identity_claim_transition:transition-1"
      ]
    ] as const;

    for (const [schema, value] of fixtures) {
      expect(schema.parse(value)).toBe(value);
    }
  });

  it("accepts established shared-ID formats without changing their brands", () => {
    const compatibilityFixtures = [
      [inboxV2TenantIdSchema, "tenant_migration_1"],
      [inboxV2TenantIdSchema, "tenant-1"],
      [inboxV2ClientIdSchema, "client_migration_1"],
      [inboxV2ConversationIdSchema, "conversation_migration_1"],
      [inboxV2MessageIdSchema, "message_migration_1"],
      [inboxV2EventIdSchema, "event_message_received_migration_1"],
      [inboxV2ClientContactIdSchema, "client_contact_migration_1"],
      [inboxV2MessageAttachmentIdSchema, "message_attachment_migration_1"],
      [inboxV2SourceConnectionIdSchema, "src_conn_market_1"],
      [inboxV2SourceAccountIdSchema, "src_acc_shop_1"],
      [inboxV2RawInboundEventIdSchema, "raw_evt_1"],
      [inboxV2NormalizedInboundEventIdSchema, "norm_evt_1"],
      [inboxV2WorkQueueIdSchema, "queue:tenant_migration_1:queue-1"],
      [inboxV2TeamIdSchema, "team:tenant_migration_1:team-1"],
      [inboxV2OrgUnitIdSchema, "org_unit:tenant_migration_1:unit-1"]
    ] as const;

    for (const [schema, value] of compatibilityFixtures) {
      expect(schema.parse(value)).toBe(value);
    }
  });

  it("rejects cross-kind ID substitution at runtime", () => {
    expect(
      inboxV2ConversationIdSchema.safeParse("client:client-1").success
    ).toBe(false);
    expect(
      inboxV2ClientIdSchema.safeParse("client_contact:contact-1").success
    ).toBe(false);
    expect(
      inboxV2WorkItemIdSchema.safeParse("conversation:conversation-1").success
    ).toBe(false);
    expect(
      inboxV2ClientIdSchema.safeParse("client_contact_migration_1").success
    ).toBe(false);
    expect(
      inboxV2ClientIdSchema.safeParse("client_contact-migration-1").success
    ).toBe(false);
    expect(
      inboxV2ConversationIdSchema.safeParse(
        "conversation_participant_migration_1"
      ).success
    ).toBe(false);
    expect(
      inboxV2MessageIdSchema.safeParse("message_attachment_migration_1").success
    ).toBe(false);
    expect(
      inboxV2AuthExternalIdentityLinkIdSchema.safeParse(
        "source_external_identity:identity-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceExternalIdentityIdSchema.safeParse(
        "auth_external_identity_link:identity-link-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimIdSchema.safeParse(
        "provider_roster_evidence:evidence-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimTransitionIdSchema.safeParse(
        "source_identity_claim:claim-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipTransitionIdSchema.safeParse(
        "participant_membership_episode:episode-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2ProviderRosterMemberEvidenceIdSchema.safeParse(
        "provider_roster_evidence:evidence-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkTransitionIdSchema.safeParse(
        "conversation_client_link:link-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2ClientMergeRedirectIdSchema.safeParse(
        "conversation_client_link:link-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchAttemptIdSchema.safeParse(
        "outbound_dispatch:dispatch-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2ExternalThreadAliasIdSchema.safeParse("external_thread:thread-1")
        .success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchArtifactReferenceLinkIdSchema.safeParse(
        "outbound_dispatch_artifact:artifact-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkItemPrimaryAssignmentIdSchema.safeParse("work_item:work-1")
        .success
    ).toBe(false);
    expect(
      inboxV2WorkItemCollaboratorEpisodeIdSchema.safeParse(
        "watcher_subscription:watcher-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkItemRelationTransitionIdSchema.safeParse(
        "work_item_transition:transition-1"
      ).success
    ).toBe(false);
    expect(inboxV2MessageIdSchema.safeParse("staff_note:note-1").success).toBe(
      false
    );
    expect(
      inboxV2StaffNoteIdSchema.safeParse("message:message-1").success
    ).toBe(false);
    expect(
      inboxV2StaffNoteIdSchema.safeParse("staff_note_revision:revision-1")
        .success
    ).toBe(false);
    expect(
      inboxV2StaffNoteRevisionIdSchema.safeParse("staff_note:note-1").success
    ).toBe(false);
    expect(
      inboxV2MessageRevisionIdSchema.safeParse("message:message-1").success
    ).toBe(false);
    expect(
      inboxV2MessageReactionTransitionIdSchema.safeParse(
        "message_reaction:reaction-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2MessageDeliveryObservationIdSchema.safeParse(
        "provider_receipt_observation:observation-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2MessageTransportOccurrenceLinkIdSchema.safeParse(
        "source_occurrence:occurrence-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2MessageProviderLifecycleOperationIdSchema.safeParse(
        "message_revision:revision-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2DeferredMessageSourceActionIdSchema.safeParse(
        "external_message_reference:reference-1"
      ).success
    ).toBe(false);
  });

  it("rejects normalization, unsafe characters and oversized IDs", () => {
    expect(
      inboxV2ConversationIdSchema.safeParse(" conversation:conversation-1")
        .success
    ).toBe(false);
    expect(
      inboxV2ConversationIdSchema.safeParse("conversation:conversation-1 ")
        .success
    ).toBe(false);
    expect(
      inboxV2ConversationIdSchema.safeParse("conversation:conversation/1")
        .success
    ).toBe(false);
    expect(
      inboxV2ConversationIdSchema.safeParse(`conversation:${"a".repeat(201)}`)
        .success
    ).toBe(false);
  });

  it("requires tenant scope and the exact entity kind on references", () => {
    const conversationReference = {
      tenantId: "tenant:tenant-1",
      kind: "conversation",
      id: "conversation:conversation-1"
    };

    expect(
      inboxV2ConversationReferenceSchema.parse(conversationReference)
    ).toEqual(conversationReference);
    expect(
      inboxV2ConversationReferenceSchema.safeParse({
        kind: "conversation",
        id: "conversation:conversation-1"
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationReferenceSchema.safeParse({
        tenantId: "tenant:tenant-1",
        kind: "client",
        id: "client:client-1"
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationReferenceSchema.safeParse({
        ...conversationReference,
        provider: "telegram"
      }).success
    ).toBe(false);
  });

  it("keeps the external-message entity reference distinct from its row schema", () => {
    const reference = {
      tenantId: "tenant:tenant-1",
      kind: "external_message_reference",
      id: "external_message_reference:reference-1"
    };

    expect(inboxV2ExternalMessageReferenceRefSchema.parse(reference)).toEqual(
      reference
    );
    expect(
      inboxV2ExternalMessageReferenceRefSchema.safeParse({
        ...reference,
        kind: "source_occurrence"
      }).success
    ).toBe(false);
  });

  it("keeps Client-link and merge-redirect references tenant-scoped and disjoint", () => {
    const linkReference = {
      tenantId: "tenant:tenant-1",
      kind: "conversation_client_link",
      id: "conversation_client_link:link-1"
    };
    const redirectReference = {
      tenantId: "tenant:tenant-1",
      kind: "client_merge_redirect",
      id: "client_merge_redirect:redirect-1"
    };

    expect(
      inboxV2ConversationClientLinkReferenceSchema.parse(linkReference)
    ).toEqual(linkReference);
    expect(
      inboxV2ClientMergeRedirectReferenceSchema.parse(redirectReference)
    ).toEqual(redirectReference);
    expect(
      inboxV2ConversationClientLinkReferenceSchema.safeParse(redirectReference)
        .success
    ).toBe(false);
    expect(
      inboxV2ClientMergeRedirectReferenceSchema.safeParse(linkReference).success
    ).toBe(false);
    expect(
      inboxV2ClientMergeRedirectReferenceSchema.safeParse({
        kind: "client_merge_redirect",
        id: "client_merge_redirect:redirect-1"
      }).success
    ).toBe(false);
  });

  it("keeps timeline, lifecycle and transport evidence references disjoint", () => {
    const tenantId = "tenant:tenant-1";
    const fixtures = [
      [
        inboxV2TimelineContentReferenceSchema,
        {
          tenantId,
          kind: "timeline_content",
          id: "timeline_content:content-1"
        }
      ],
      [
        inboxV2StaffNoteReferenceSchema,
        { tenantId, kind: "staff_note", id: "staff_note:note-1" }
      ],
      [
        inboxV2SourceObjectReferenceSchema,
        { tenantId, kind: "source_object", id: "source_object:call-1" }
      ],
      [
        inboxV2EventReferenceSchema,
        { tenantId, kind: "event", id: "event:event-1" }
      ],
      [
        inboxV2MessageRevisionReferenceSchema,
        {
          tenantId,
          kind: "message_revision",
          id: "message_revision:revision-1"
        }
      ],
      [
        inboxV2MessageReactionReferenceSchema,
        {
          tenantId,
          kind: "message_reaction",
          id: "message_reaction:reaction-1"
        }
      ],
      [
        inboxV2MessageReactionTransitionReferenceSchema,
        {
          tenantId,
          kind: "message_reaction_transition",
          id: "message_reaction_transition:transition-1"
        }
      ],
      [
        inboxV2MessageDeliveryObservationReferenceSchema,
        {
          tenantId,
          kind: "message_delivery_observation",
          id: "message_delivery_observation:observation-1"
        }
      ],
      [
        inboxV2ProviderReceiptObservationReferenceSchema,
        {
          tenantId,
          kind: "provider_receipt_observation",
          id: "provider_receipt_observation:observation-1"
        }
      ],
      [
        inboxV2MessageTransportOccurrenceLinkReferenceSchema,
        {
          tenantId,
          kind: "message_transport_occurrence_link",
          id: "message_transport_occurrence_link:link-1"
        }
      ],
      [
        inboxV2MessageProviderLifecycleOperationReferenceSchema,
        {
          tenantId,
          kind: "message_provider_lifecycle_operation",
          id: "message_provider_lifecycle_operation:operation-1"
        }
      ],
      [
        inboxV2DeferredMessageSourceActionReferenceSchema,
        {
          tenantId,
          kind: "deferred_message_source_action",
          id: "deferred_message_source_action:action-1"
        }
      ],
      [
        inboxV2StaffNoteRevisionReferenceSchema,
        {
          tenantId,
          kind: "staff_note_revision",
          id: "staff_note_revision:revision-1"
        }
      ]
    ] as const;

    for (const [schema, reference] of fixtures) {
      expect(schema.parse(reference)).toEqual(reference);
      expect(
        schema.safeParse({ kind: reference.kind, id: reference.id }).success
      ).toBe(false);
    }

    expect(
      inboxV2StaffNoteReferenceSchema.safeParse(fixtures[2][1]).success
    ).toBe(false);
    expect(
      inboxV2MessageReactionReferenceSchema.safeParse(fixtures[6][1]).success
    ).toBe(false);
    expect(
      inboxV2MessageDeliveryObservationReferenceSchema.safeParse(fixtures[8][1])
        .success
    ).toBe(false);
    expect(
      inboxV2MessageRevisionReferenceSchema.safeParse(fixtures[10][1]).success
    ).toBe(false);
    expect(
      inboxV2EventReferenceSchema.safeParse({
        tenantId,
        kind: "message",
        id: "message:message-1"
      }).success
    ).toBe(false);
  });

  it("keeps tenant-defined Client stages opaque instead of a closed enum", () => {
    expect(
      inboxV2ClientStageIdSchema.parse(
        "client_stage:enterprise.custom_discovery_2026"
      )
    ).toBe("client_stage:enterprise.custom_discovery_2026");
    expect(inboxV2ClientStageIdSchema.safeParse("won").success).toBe(false);

    const clientReference = inboxV2ClientReferenceSchema.parse({
      tenantId: "tenant:tenant-1",
      kind: "client",
      id: "client:client-1"
    });

    expect(
      inboxV2ConversationReferenceSchema.safeParse(clientReference).success
    ).toBe(false);
  });
});
