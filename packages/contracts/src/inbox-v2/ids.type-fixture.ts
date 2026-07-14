import { z } from "zod";

import type {
  InboxV2AuthExternalIdentityLinkId,
  InboxV2ClientId,
  InboxV2ClientMergeRedirectId,
  InboxV2ClientMergeRedirectReference,
  InboxV2ClientReference,
  InboxV2ClientStageId,
  InboxV2ConversationParticipantReference,
  InboxV2ConversationId,
  InboxV2ConversationClientLinkId,
  InboxV2ConversationClientLinkReference,
  InboxV2ConversationClientLinkTransitionId,
  InboxV2ConversationReference,
  InboxV2ConversationWorkItemSlotId,
  InboxV2DeferredMessageSourceActionId,
  InboxV2EventReference,
  InboxV2ExternalMessageReferenceRef,
  InboxV2ExternalThreadAliasId,
  InboxV2MessageDeliveryObservationId,
  InboxV2MessageId,
  InboxV2MessageProviderLifecycleOperationId,
  InboxV2MessageReactionId,
  InboxV2MessageReactionTransitionId,
  InboxV2MessageReference,
  InboxV2MessageRevisionId,
  InboxV2MessageTransportOccurrenceLinkId,
  InboxV2OutboundDispatchArtifactReferenceLinkId,
  InboxV2OutboundDispatchAttemptId,
  InboxV2OutboundDispatchId,
  InboxV2OutboundDispatchReconciliationDecisionId,
  InboxV2ParticipantMembershipTransitionId,
  InboxV2ProviderRosterEvidenceId,
  InboxV2ProviderRosterMemberEvidenceId,
  InboxV2ProviderReceiptObservationId,
  InboxV2SourceAccountIdentityAliasId,
  InboxV2SourceAccountIdentityTransitionId,
  InboxV2SourceExternalIdentityId,
  InboxV2SourceIdentityClaimId,
  InboxV2SourceIdentityClaimTransitionId,
  InboxV2SourceObjectId,
  InboxV2SourceObjectReference,
  InboxV2SourceOccurrenceId,
  InboxV2SourceOccurrenceReference,
  InboxV2StaffNoteId,
  InboxV2StaffNoteReference,
  InboxV2StaffNoteRevisionId,
  InboxV2StaffNoteRevisionReference,
  InboxV2TenantId,
  InboxV2TimelineContentId,
  InboxV2ThreadRoutePolicyId,
  InboxV2WorkItemId,
  InboxV2WorkItemPrimaryAssignmentId,
  InboxV2WorkItemRelationTransitionId,
  InboxV2WorkItemTransitionId,
  InboxV2WatcherSubscriptionId
} from "./ids";
import { inboxV2ConversationReferenceSchema } from "./ids";
import {
  inboxV2AppActorSchema,
  inboxV2TimelineItemSubjectSchema
} from "./timeline";

type TimelineSubject = z.infer<typeof inboxV2TimelineItemSubjectSchema>;
type MessageSubject = Extract<TimelineSubject, { kind: "message" }>;
type StaffNoteSubject = Extract<TimelineSubject, { kind: "staff_note" }>;
type CallSubject = Extract<TimelineSubject, { kind: "call" }>;
type AppActor = z.infer<typeof inboxV2AppActorSchema>;

declare const tenantId: InboxV2TenantId;
declare const clientId: InboxV2ClientId;
declare const conversationId: InboxV2ConversationId;
declare const messageId: InboxV2MessageId;
declare const timelineContentId: InboxV2TimelineContentId;
declare const staffNoteId: InboxV2StaffNoteId;
declare const staffNoteRevisionId: InboxV2StaffNoteRevisionId;
declare const sourceObjectId: InboxV2SourceObjectId;
declare const messageRevisionId: InboxV2MessageRevisionId;
declare const messageReactionId: InboxV2MessageReactionId;
declare const messageReactionTransitionId: InboxV2MessageReactionTransitionId;
declare const messageDeliveryObservationId: InboxV2MessageDeliveryObservationId;
declare const providerReceiptObservationId: InboxV2ProviderReceiptObservationId;
declare const messageTransportOccurrenceLinkId: InboxV2MessageTransportOccurrenceLinkId;
declare const messageProviderLifecycleOperationId: InboxV2MessageProviderLifecycleOperationId;
declare const deferredMessageSourceActionId: InboxV2DeferredMessageSourceActionId;
declare const authExternalIdentityLinkId: InboxV2AuthExternalIdentityLinkId;
declare const sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
declare const providerRosterEvidenceId: InboxV2ProviderRosterEvidenceId;
declare const providerRosterMemberEvidenceId: InboxV2ProviderRosterMemberEvidenceId;
declare const membershipTransitionId: InboxV2ParticipantMembershipTransitionId;
declare const claimTransitionId: InboxV2SourceIdentityClaimTransitionId;
declare const clientLinkTransitionId: InboxV2ConversationClientLinkTransitionId;
declare const clientLinkId: InboxV2ConversationClientLinkId;
declare const clientMergeRedirectId: InboxV2ClientMergeRedirectId;
declare const clientLinkReference: InboxV2ConversationClientLinkReference;
declare const clientMergeRedirectReference: InboxV2ClientMergeRedirectReference;
declare const clientReference: InboxV2ClientReference;
declare const externalThreadAliasId: InboxV2ExternalThreadAliasId;
declare const dispatchId: InboxV2OutboundDispatchId;
declare const dispatchAttemptId: InboxV2OutboundDispatchAttemptId;
declare const dispatchReconciliationDecisionId: InboxV2OutboundDispatchReconciliationDecisionId;
declare const artifactReferenceLinkId: InboxV2OutboundDispatchArtifactReferenceLinkId;
declare const sourceAccountIdentityAliasId: InboxV2SourceAccountIdentityAliasId;
declare const sourceAccountIdentityTransitionId: InboxV2SourceAccountIdentityTransitionId;
declare const threadRoutePolicyId: InboxV2ThreadRoutePolicyId;
declare const externalMessageReference: InboxV2ExternalMessageReferenceRef;
declare const workItemPrimaryAssignmentId: InboxV2WorkItemPrimaryAssignmentId;
declare const workItemTransitionId: InboxV2WorkItemTransitionId;
declare const workItemRelationTransitionId: InboxV2WorkItemRelationTransitionId;
declare const conversationWorkItemSlotId: InboxV2ConversationWorkItemSlotId;
declare const watcherSubscriptionId: InboxV2WatcherSubscriptionId;
declare const messageReference: InboxV2MessageReference;
declare const eventReference: InboxV2EventReference;
declare const staffNoteReference: InboxV2StaffNoteReference;
declare const staffNoteRevisionReference: InboxV2StaffNoteRevisionReference;
declare const sourceObjectReference: InboxV2SourceObjectReference;
declare const participantReference: InboxV2ConversationParticipantReference;
declare const sourceOccurrenceReference: InboxV2SourceOccurrenceReference;
declare const messageSubject: MessageSubject;
declare const staffNoteSubject: StaffNoteSubject;
declare const callSubject: CallSubject;
declare const appActor: AppActor;

const _validConversationReference: InboxV2ConversationReference = {
  tenantId,
  kind: "conversation",
  id: conversationId
};

const _validConversationReferenceInput: z.input<
  typeof inboxV2ConversationReferenceSchema
> = {
  tenantId: "tenant:tenant-1",
  kind: "conversation",
  id: "conversation:conversation-1"
};

const _invalidConversationReferenceInput: z.input<
  typeof inboxV2ConversationReferenceSchema
> = {
  tenantId: "tenant:tenant-1",
  kind: "conversation",
  // @ts-expect-error Reference schema inputs require string IDs, not unknown.
  id: 123
};

// @ts-expect-error Client IDs cannot substitute for Conversation IDs.
const _conversationFromClient: InboxV2ConversationId = clientId;

// @ts-expect-error Message IDs cannot substitute for Conversation IDs.
const _conversationFromMessage: InboxV2ConversationId = messageId;

// @ts-expect-error Timeline content has its own identity, not a Message identity.
const _messageFromTimelineContent: InboxV2MessageId = timelineContentId;

// @ts-expect-error StaffNote IDs cannot substitute for Message IDs.
const _messageFromStaffNote: InboxV2MessageId = staffNoteId;

// @ts-expect-error Source-object IDs cannot substitute for StaffNote IDs.
const _staffNoteFromSourceObject: InboxV2StaffNoteId = sourceObjectId;

// @ts-expect-error A StaffNote revision is append-only history, not the note entity.
const _staffNoteFromRevision: InboxV2StaffNoteId = staffNoteRevisionId;

// @ts-expect-error A Message revision is not the current Message entity.
const _messageFromRevision: InboxV2MessageId = messageRevisionId;

// @ts-expect-error A reaction transition cannot substitute for its reaction slot.
const _reactionFromTransition: InboxV2MessageReactionId =
  messageReactionTransitionId;

// @ts-expect-error A reaction slot cannot substitute for its append-only transition.
const _transitionFromReaction: InboxV2MessageReactionTransitionId =
  messageReactionId;

// @ts-expect-error Delivery and read-receipt evidence remain disjoint facts.
const _deliveryFromReceipt: InboxV2MessageDeliveryObservationId =
  providerReceiptObservationId;

// @ts-expect-error A delivery observation cannot substitute for read-receipt evidence.
const _receiptFromDelivery: InboxV2ProviderReceiptObservationId =
  messageDeliveryObservationId;

// @ts-expect-error A transport occurrence link is not a SourceOccurrence.
const _sourceOccurrenceFromTransportLink: InboxV2SourceOccurrenceId =
  messageTransportOccurrenceLinkId;

// @ts-expect-error A provider lifecycle operation is not a Message revision.
const _revisionFromProviderOperation: InboxV2MessageRevisionId =
  messageProviderLifecycleOperationId;

// @ts-expect-error A deferred source action is not a reaction slot.
const _reactionFromDeferredAction: InboxV2MessageReactionId =
  deferredMessageSourceActionId;

// @ts-expect-error Conversation IDs cannot substitute for WorkItem IDs.
const _workItemFromConversation: InboxV2WorkItemId = conversationId;

// @ts-expect-error Authentication identity links cannot substitute for source identities.
const _sourceIdentityFromAuthIdentity: InboxV2SourceExternalIdentityId =
  authExternalIdentityLinkId;

// @ts-expect-error Source identities cannot substitute for authentication identity links.
const _authIdentityFromSourceIdentity: InboxV2AuthExternalIdentityLinkId =
  sourceExternalIdentityId;

// @ts-expect-error Roster evidence cannot substitute for identity claims.
const _claimFromRosterEvidence: InboxV2SourceIdentityClaimId =
  providerRosterEvidenceId;

// @ts-expect-error Roster member evidence cannot substitute for membership transitions.
const _membershipTransitionFromRosterMember: InboxV2ParticipantMembershipTransitionId =
  providerRosterMemberEvidenceId;

// @ts-expect-error Claim transitions cannot substitute for claim records.
const _claimFromClaimTransition: InboxV2SourceIdentityClaimId =
  claimTransitionId;

// @ts-expect-error Membership transitions cannot substitute for claim transitions.
const _claimTransitionFromMembershipTransition: InboxV2SourceIdentityClaimTransitionId =
  membershipTransitionId;

// @ts-expect-error Client-link transitions cannot substitute for Conversation IDs.
const _conversationFromClientLinkTransition: InboxV2ConversationId =
  clientLinkTransitionId;

// @ts-expect-error Client-link IDs cannot substitute for merge-redirect IDs.
const _mergeRedirectFromClientLink: InboxV2ClientMergeRedirectId = clientLinkId;

// @ts-expect-error Client merge redirects cannot substitute for Client IDs.
const _clientFromMergeRedirect: InboxV2ClientId = clientMergeRedirectId;

// @ts-expect-error Client-link references cannot substitute for merge-redirect references.
const _mergeRedirectReferenceFromClientLink: InboxV2ClientMergeRedirectReference =
  clientLinkReference;

// @ts-expect-error Merge-redirect references cannot substitute for Client references.
const _clientReferenceFromMergeRedirect: InboxV2ClientReference =
  clientMergeRedirectReference;

// @ts-expect-error Tenant scope is mandatory on every V2 entity reference.
const _referenceWithoutTenant: InboxV2ConversationReference = {
  kind: "conversation",
  id: conversationId
};

// @ts-expect-error Client references cannot substitute for Conversation references.
const _conversationFromClientReference: InboxV2ConversationReference =
  clientReference;

// @ts-expect-error An immutable ExternalThread alias is not an external thread ID.
const _conversationFromExternalThreadAlias: InboxV2ConversationId =
  externalThreadAliasId;

// @ts-expect-error A dispatch attempt cannot substitute for its parent dispatch.
const _dispatchFromAttempt: InboxV2OutboundDispatchId = dispatchAttemptId;

// @ts-expect-error A reconciliation decision is not a provider-call attempt.
const _attemptFromReconciliation: InboxV2OutboundDispatchAttemptId =
  dispatchReconciliationDecisionId;

// @ts-expect-error An artifact-reference link is not a reconciliation decision.
const _reconciliationFromArtifactLink: InboxV2OutboundDispatchReconciliationDecisionId =
  artifactReferenceLinkId;

// @ts-expect-error A dispatch cannot substitute for a route policy.
const _routePolicyFromDispatch: InboxV2ThreadRoutePolicyId = dispatchId;

// @ts-expect-error Account identity aliases and transitions are different audit rows.
const _identityTransitionFromAlias: InboxV2SourceAccountIdentityTransitionId =
  sourceAccountIdentityAliasId;

// @ts-expect-error Account identity transitions cannot substitute for alias rows.
const _identityAliasFromTransition: InboxV2SourceAccountIdentityAliasId =
  sourceAccountIdentityTransitionId;

// @ts-expect-error An external message reference cannot substitute for a Conversation reference.
const _conversationFromExternalMessageReference: InboxV2ConversationReference =
  externalMessageReference;

// @ts-expect-error A primary-assignment episode cannot substitute for its WorkItem.
const _workItemFromPrimaryAssignment: InboxV2WorkItemId =
  workItemPrimaryAssignmentId;

// @ts-expect-error Lifecycle and relation transition IDs are disjoint histories.
const _relationTransitionFromWorkTransition: InboxV2WorkItemRelationTransitionId =
  workItemTransitionId;

// @ts-expect-error A relation transition cannot substitute for a Conversation slot.
const _slotFromRelationTransition: InboxV2ConversationWorkItemSlotId =
  workItemRelationTransitionId;

// @ts-expect-error Notification-owned watcher subscriptions are not WorkItems.
const _workItemFromWatcher: InboxV2WorkItemId = watcherSubscriptionId;

// @ts-expect-error Message and StaffNote references identify different entities.
const _messageReferenceFromStaffNote: InboxV2MessageReference =
  staffNoteReference;

// @ts-expect-error StaffNote and Message references identify different entities.
const _staffNoteReferenceFromMessage: InboxV2StaffNoteReference =
  messageReference;

// @ts-expect-error StaffNote current and revision references remain disjoint.
const _staffNoteReferenceFromRevision: InboxV2StaffNoteReference =
  staffNoteRevisionReference;

// @ts-expect-error Event and Message references identify different entities.
const _messageReferenceFromEvent: InboxV2MessageReference = eventReference;

// @ts-expect-error Calls are SourceObjects, not Message references.
const _messageReferenceFromCallSource: InboxV2MessageReference =
  sourceObjectReference;

// @ts-expect-error SourceObjects used by calls are not StaffNote references.
const _staffNoteReferenceFromCallSource: InboxV2StaffNoteReference =
  sourceObjectReference;

// @ts-expect-error Timeline subject discriminants keep StaffNote out of Message slots.
const _messageSubjectFromStaffNote: MessageSubject = staffNoteSubject;

// @ts-expect-error Timeline subject discriminants keep calls out of Message slots.
const _messageSubjectFromCall: MessageSubject = callSubject;

// @ts-expect-error Timeline subject discriminants keep Messages out of call slots.
const _callSubjectFromMessage: CallSubject = messageSubject;

// @ts-expect-error A source participant is authorship evidence, not an app actor.
const _appActorFromParticipant: AppActor = participantReference;

// @ts-expect-error A SourceOccurrence is transport evidence, not an app actor.
const _appActorFromSourceOccurrence: AppActor = sourceOccurrenceReference;

// @ts-expect-error An app actor cannot substitute for the canonical author participant.
const _participantFromAppActor: InboxV2ConversationParticipantReference =
  appActor;

void conversationWorkItemSlotId;

void threadRoutePolicyId;

// @ts-expect-error A pipeline state word is not an opaque ClientStageId.
const _closedClientStageValue: InboxV2ClientStageId = "won";

// @ts-expect-error Inbox V2 must never expose a closed Client-stage vocabulary.
import type { InboxV2ClientStage as _InboxV2ClientStage } from "./index";
