import {
  INBOX_V2_MESSAGE_CREATION_COMMIT_SCHEMA_ID,
  INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
  INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
  INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_SOURCE_OCCURRENCE_RESOLUTION_COMMIT_SCHEMA_ID,
  INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID,
  INBOX_V2_TIMELINE_MESSAGE_COMMIT_SCHEMA_VERSION,
  inboxV2BigintCounterSchema,
  inboxV2AdapterContractSnapshotSchema,
  inboxV2AppActorSchema,
  inboxV2AutomationCausationSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationParticipantIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2MessageIdSchema,
  inboxV2MessageContentBlockSchema,
  inboxV2MessageLifecycleSchema,
  inboxV2MessageOriginSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2MessageReferenceContextSchema,
  inboxV2MessageMutationCommitSchema,
  inboxV2MessageRevisionPageSchema,
  inboxV2MessageRevisionSchema,
  inboxV2MessageProviderLifecycleOperationCreationCommitSchema,
  inboxV2MessageProviderLifecycleOperationIdSchema,
  inboxV2MessageProviderLifecycleOperationSchema,
  inboxV2MessageProviderLifecycleTransitionSchema,
  inboxV2MessageProviderLifecycleTransitionCommitSchema,
  inboxV2MessageReactionPageSchema,
  inboxV2MessageReactionIdSchema,
  inboxV2MessageReactionSchema,
  inboxV2MessageReactionCommitSchema,
  inboxV2ReactionCapabilitySchema,
  inboxV2ReactionStateSchema,
  inboxV2ProviderSemanticOrderingCommitSchema,
  inboxV2ProviderSemanticOrderingHeadSchema,
  inboxV2ProviderSemanticProofSchema,
  inboxV2MessageSchema,
  inboxV2MessageTransportAssociationCommitSchema,
  inboxV2MessageTransportFactCommitSchema,
  inboxV2MessageTransportFactPageSchema,
  inboxV2MessageTransportFactSchema,
  inboxV2MessageTransportLinkHeadSchema,
  inboxV2MessageTransportOccurrenceLinkSchema,
  inboxV2RoutingTokenSchema,
  inboxV2SourceOccurrenceIdSchema,
  inboxV2TenantIdSchema,
  inboxV2ExternalMessageKeySchema,
  inboxV2TimelineActivitySchema,
  inboxV2TimelineContentSchema,
  inboxV2TimelineItemIdSchema,
  inboxV2TimelineItemPageSchema,
  inboxV2TimelineItemSchema,
  inboxV2TimelineSequenceSchema,
  inboxV2TimestampSchema,
  type InboxV2BigintCounter,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2ConversationId,
  type InboxV2EntityRevision,
  type InboxV2Message,
  type InboxV2MessageContentBlock,
  type InboxV2MessageId,
  type InboxV2MessageRevision,
  type InboxV2OutboundDispatchRerouteCommit,
  type InboxV2SourceOccurrenceId,
  type InboxV2TenantId,
  type InboxV2TimelineItem,
  type InboxV2TimelineItemId,
  type InboxV2TimelineContent,
  type InboxV2TimelineSequence
} from "@hulee/contracts";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import {
  consumeInboxV2AtomicOutboundRouteProof,
  consumeInboxV2AtomicOutboundRerouteProof,
  consumeInboxV2AtomicAttachmentMaterializationProof,
  deriveInboxV2AttachmentMaterializationAuditReference,
  issueInboxV2AtomicMaterializationSealReceipt,
  requireInboxV2AtomicSealExecutor,
  type InboxV2AtomicAttachmentMaterializationProof,
  type InboxV2AtomicMaterializationSealReceipt
} from "./sql-inbox-v2-atomic-materialization-internal";
import {
  assertInboxV2AuthorizedAtomicMaterializationContext,
  assertInboxV2AuthorizedCommandMutationContext,
  type InboxV2AuthorizedAtomicMaterializationContext,
  type InboxV2AuthorizedCommandMutationContext
} from "./sql-inbox-v2-authorization-repository";
import {
  prepareInboxV2FileParentAttachmentsInTransaction,
  sealInboxV2PreparedFileParentAttachmentsInTransaction,
  type InboxV2PreparedFileParentAttachmentsCapability,
  type InboxV2ReadyFileParentAttachment
} from "./sql-inbox-v2-file-parent-materialization";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql,
  buildInsertInboxV2AtomicOutboundDispatchMaterializationSql,
  buildInsertInboxV2ExternalMessageReferenceValuesSql,
  buildInsertInboxV2OutboundDispatchSql,
  buildInsertInboxV2SourceOccurrenceResolutionTransitionSql,
  computeInboxV2OutboundRouteDigest,
  deriveInboxV2SourceOccurrenceResolutionTransitionId
} from "./sql-inbox-v2-outbound-transport-repository";

const TIMELINE_MESSAGE_TRANSACTION_CONFIG = Object.freeze({
  isolationLevel: "read committed" as const
});
const TIMELINE_MESSAGE_SNAPSHOT_CONFIG = Object.freeze({
  isolationLevel: "repeatable read" as const
});
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const TRANSACTION_ATTEMPTS = 3;
const DEFAULT_TIMELINE_PAGE_SIZE = 50;
const MAX_TIMELINE_PAGE_SIZE = 200;
const MAX_MESSAGE_HISTORY_PAGE_SIZE = 200;
const MAX_MESSAGE_AUXILIARY_PAGE_SIZE = 200;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export type InboxV2MessageCreationCommit = ReturnType<
  typeof inboxV2MessageCreationCommitSchema.parse
>;
export type InboxV2MessageMutationCommit = ReturnType<
  typeof inboxV2MessageMutationCommitSchema.parse
>;
export type InboxV2MessageTransportAssociationCommit = ReturnType<
  typeof inboxV2MessageTransportAssociationCommitSchema.parse
>;
export type InboxV2MessageTransportFactCommit = ReturnType<
  typeof inboxV2MessageTransportFactCommitSchema.parse
>;
export type InboxV2MessageReactionCommit = ReturnType<
  typeof inboxV2MessageReactionCommitSchema.parse
>;
export type InboxV2MessageProviderLifecycleCreationCommit = ReturnType<
  typeof inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse
>;
export type InboxV2MessageProviderLifecycleTransitionCommit = ReturnType<
  typeof inboxV2MessageProviderLifecycleTransitionCommitSchema.parse
>;
type InboxV2ProviderSemanticOrderingCommit = ReturnType<
  typeof inboxV2ProviderSemanticOrderingCommitSchema.parse
>;
type InboxV2ProviderSemanticOrderingHead = ReturnType<
  typeof inboxV2ProviderSemanticOrderingHeadSchema.parse
>;

export type InboxV2TimelineMessageTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{
      isolationLevel: "read committed" | "repeatable read";
    }>
  ): Promise<TResult>;
};

export type InboxV2TimelineMessageConflictCode =
  | "revision.conflict"
  | "message.identity_conflict"
  | "message.state_conflict"
  | "message.reference_conflict"
  | "message.transport_conflict";

export type InboxV2SafeGenericEnvelope = Readonly<{
  tenantId: InboxV2TenantId;
  entityKind:
    | "timeline_item"
    | "message"
    | "message_reaction"
    | "message_transport"
    | "provider_lifecycle";
  entityId: string;
  entityRevision: InboxV2EntityRevision;
  timelineItemId: InboxV2TimelineItemId;
  timelineSequence: InboxV2TimelineSequence;
  streamPosition: InboxV2BigintCounter;
  changeKind: string;
  occurredAt: string;
}>;

export type PersistInboxV2MessageCreationResult<TResult = undefined> =
  | Readonly<{
      kind: "created";
      message: InboxV2Message;
      timelineItem: InboxV2TimelineItem;
      envelope: InboxV2SafeGenericEnvelope;
      result: TResult;
    }>
  | Readonly<{
      kind: "already_applied";
      message: InboxV2Message;
      timelineItem: InboxV2TimelineItem;
      envelope: InboxV2SafeGenericEnvelope;
    }>
  | Readonly<{
      kind: "conflict";
      code:
        | "revision.conflict"
        | "message.identity_conflict"
        | "message.reference_conflict"
        | "message.transport_conflict";
      current: InboxV2Message | null;
    }>
  | Readonly<{
      kind:
        | "conversation_not_found"
        | "author_not_found"
        | "source_reference_not_found";
    }>;

const inboxV2PreparedMessageCreationCapabilityBrand: unique symbol = Symbol(
  "inbox-v2-prepared-message-creation-capability"
);

/**
 * An in-memory, transaction-local proof that all blocking Message creation
 * reads and domain locks have completed. The value can only be issued by this
 * module and is additionally validated against its exact executor at runtime.
 */
export type InboxV2PreparedMessageCreationCapability = Readonly<{
  [inboxV2PreparedMessageCreationCapabilityBrand]: true;
}>;

export type InboxV2MessageCreationSourceOccurrenceFence = Readonly<{
  sourceOccurrenceId: InboxV2SourceOccurrenceId;
  expectedRevision: InboxV2EntityRevision;
  expectedResolutionState: "pending" | "conflicted";
  expectedUpdatedAt: string;
}>;

export type PrepareInboxV2MessageCreationInput = Readonly<{
  commit: InboxV2MessageCreationCommit;
}>;

export type PrepareInboxV2MessageCreationResult =
  | Readonly<{
      kind: "ready";
      capability: InboxV2PreparedMessageCreationCapability;
    }>
  | Exclude<
      PersistInboxV2MessageCreationResult<never>,
      Readonly<{ kind: "created" }>
    >;

export type SealInboxV2MessageCreationContext = Readonly<{
  executor: RawSqlExecutor;
  message: InboxV2Message;
  timelineItem: InboxV2TimelineItem;
  envelope: InboxV2SafeGenericEnvelope;
}>;

type SealedInboxV2PreparedMessageCreationDomainResult<TResult = undefined> =
  Extract<
    PersistInboxV2MessageCreationResult<TResult>,
    Readonly<{ kind: "created" }>
  >;

export type SealInboxV2PreparedMessageCreationResult<TResult = undefined> =
  SealedInboxV2PreparedMessageCreationDomainResult<TResult> &
    Readonly<{ receipt: InboxV2AtomicMaterializationSealReceipt }>;

export type PersistInboxV2MessageMutationResult<TResult = undefined> =
  | Readonly<{
      kind: "applied";
      message: InboxV2Message;
      timelineItem: InboxV2TimelineItem;
      envelope: InboxV2SafeGenericEnvelope;
      result: TResult;
    }>
  | Readonly<{
      kind: "already_applied";
      message: InboxV2Message;
      timelineItem: InboxV2TimelineItem;
      envelope: InboxV2SafeGenericEnvelope;
    }>
  | Readonly<{
      kind: "conflict";
      code: "revision.conflict" | "message.state_conflict";
      current: InboxV2Message;
    }>
  | Readonly<{ kind: "message_not_found" }>;

const inboxV2PreparedAttachmentMaterializationMessageMutationCapabilityBrand: unique symbol =
  Symbol(
    "inbox-v2-prepared-attachment-materialization-message-mutation-capability"
  );

export type InboxV2PreparedAttachmentMaterializationMessageMutationCapability =
  Readonly<{
    [inboxV2PreparedAttachmentMaterializationMessageMutationCapabilityBrand]: true;
  }>;

export type InboxV2MessageMutationPlanCurrent = Readonly<{
  message: InboxV2Message;
  timelineItem: InboxV2TimelineItem;
  content: InboxV2TimelineContent;
  /** Database clock sampled after the exact Message/Timeline/Content locks. */
  databaseNow: string;
}>;

export type PrepareInboxV2AttachmentMaterializationMessageMutationResult =
  | Readonly<{
      kind: "ready";
      capability: InboxV2PreparedAttachmentMaterializationMessageMutationCapability;
      commit: InboxV2MessageMutationCommit;
    }>
  | Readonly<{
      kind: "already_applied";
      commit: InboxV2MessageMutationCommit;
      message: InboxV2Message;
      timelineItem: InboxV2TimelineItem;
      streamPosition: InboxV2BigintCounter;
    }>
  | Readonly<{
      kind: "conflict";
      code: "revision.conflict" | "message.state_conflict";
      current: InboxV2Message;
    }>
  | Readonly<{ kind: "message_not_found" }>;

/**
 * Server-side terminal-command preflight. This is a read-only snapshot; the
 * opaque prepare capability below re-locks and verifies the same aggregate in
 * the authorized transaction before any stream position can be consumed.
 */
export async function readInboxV2AttachmentMaterializationMessageCurrent(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    messageId: InboxV2MessageId;
  }>
): Promise<InboxV2MessageMutationPlanCurrent | null> {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const conversationId = inboxV2ConversationIdSchema.parse(
    input.conversationId
  );
  const messageId = inboxV2MessageIdSchema.parse(input.messageId);
  const current = await loadTimelineMessageAggregate(executor, {
    tenantId,
    messageId,
    lock: false
  });
  if (
    current === null ||
    String(current.message.conversation.id) !== String(conversationId)
  ) {
    return null;
  }
  return Object.freeze({
    message: current.message,
    timelineItem: current.timelineItem,
    content: current.content,
    databaseNow: current.databaseNow
  });
}

export type PersistInboxV2MessageAuxiliaryResult<TResult = undefined> =
  | Readonly<{
      kind: "appended";
      envelope: InboxV2SafeGenericEnvelope;
      result: TResult;
    }>
  | Readonly<{
      kind: "already_applied";
      envelope: InboxV2SafeGenericEnvelope;
    }>
  | Readonly<{
      kind: "conflict";
      code: InboxV2TimelineMessageConflictCode;
    }>
  | Readonly<{ kind: "message_not_found" }>;

export type ListInboxV2TimelineInput = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  anchor?:
    | Readonly<{ kind: "latest" }>
    | Readonly<{ kind: "before" | "after"; sequence: InboxV2TimelineSequence }>
    | Readonly<{ kind: "around"; timelineItemId: InboxV2TimelineItemId }>;
  limit?: number;
}>;

export type ListInboxV2MessageHistoryInput = Readonly<{
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
  afterRevision?: InboxV2EntityRevision | null;
  limit?: number;
}>;

type InboxV2MessageReaction = ReturnType<
  typeof inboxV2MessageReactionSchema.parse
>;
type InboxV2MessageTransportFact = ReturnType<
  typeof inboxV2MessageTransportFactSchema.parse
>;
type InboxV2MessageProviderLifecycleOperation = ReturnType<
  typeof inboxV2MessageProviderLifecycleOperationSchema.parse
>;
type InboxV2MessageProviderLifecycleTransition = ReturnType<
  typeof inboxV2MessageProviderLifecycleTransitionSchema.parse
>;

export type InboxV2MessageTransportLinkRead = Readonly<{
  link: ReturnType<typeof inboxV2MessageTransportOccurrenceLinkSchema.parse>;
  resultingHeadRevision: InboxV2EntityRevision;
  recordedStreamPosition: InboxV2BigintCounter;
}>;

export type InboxV2MessageTransportLinkHeadRead = Readonly<{
  head: ReturnType<typeof inboxV2MessageTransportLinkHeadSchema.parse>;
  lastChangedStreamPosition: InboxV2BigintCounter;
}>;

export type InboxV2MessageTransportLinkPage = Readonly<{
  tenantId: InboxV2TenantId;
  message: Readonly<{
    tenantId: InboxV2TenantId;
    kind: "message";
    id: InboxV2MessageId;
  }>;
  snapshotToken: string;
  throughHeadRevision: string;
  head: InboxV2MessageTransportLinkHeadRead | null;
  links: readonly InboxV2MessageTransportLinkRead[];
  nextCursor: string | null;
}>;

export type InboxV2PurgedReactionActor =
  | Readonly<{
      kind: "unattributed_source_observation";
      sourceOccurrence: Readonly<{
        tenantId: InboxV2TenantId;
        kind: "source_occurrence";
        id: string;
      }>;
      identity: Readonly<{
        state: "purged";
        dataClassId: string;
        tombstoneEvent: Readonly<{
          tenantId: InboxV2TenantId;
          kind: "event";
          id: string;
        }>;
        purgedAt: string;
      }>;
    }>
  | Readonly<{
      kind: "provider_system";
      sourceOccurrence: Readonly<{
        tenantId: InboxV2TenantId;
        kind: "source_occurrence";
        id: string;
      }>;
      actorKindId: string;
      identity: Readonly<{
        state: "purged";
        dataClassId: string;
        tombstoneEvent: Readonly<{
          tenantId: InboxV2TenantId;
          kind: "event";
          id: string;
        }>;
        purgedAt: string;
      }>;
    }>;

export type InboxV2QueryableMessageReaction =
  | Readonly<{
      projectionState: "available";
      reaction: InboxV2MessageReaction;
    }>
  | Readonly<{
      projectionState: "actor_identity_purged";
      reaction: Omit<InboxV2MessageReaction, "actor"> &
        Readonly<{ actor: InboxV2PurgedReactionActor }>;
    }>;

export type InboxV2QueryableMessageReactionPage = Readonly<{
  tenantId: InboxV2TenantId;
  message: Readonly<{
    tenantId: InboxV2TenantId;
    kind: "message";
    id: InboxV2MessageId;
  }>;
  snapshotToken: string;
  snapshotCreatedAt: string;
  reactions: readonly InboxV2QueryableMessageReaction[];
  nextCursor: string | null;
}>;

export type InboxV2QueryableOpaqueValue =
  | Readonly<{
      state: "available";
      value: string;
      digestSha256: string;
    }>
  | Readonly<{
      state: "purged";
      digestSha256: string;
      dataClassId: string;
    }>;

type InboxV2ProviderReceiptObservation = Extract<
  InboxV2MessageTransportFact,
  { kind: "receipt" }
>["observation"];

export type InboxV2PurgedProviderReceiptObservation = Omit<
  InboxV2ProviderReceiptObservation,
  "target" | "reader"
> &
  Readonly<{
    target:
      | Extract<
          InboxV2ProviderReceiptObservation["target"],
          { kind: "exact_message" | "thread_readmark" }
        >
      | Readonly<{
          kind: "provider_watermark";
          watermark: Extract<InboxV2QueryableOpaqueValue, { state: "purged" }>;
        }>;
    reader:
      | Extract<
          InboxV2ProviderReceiptObservation["reader"],
          { kind: "source_external_identity" }
        >
      | Readonly<{
          kind: "aggregate_only";
          aggregateKey: Extract<
            InboxV2QueryableOpaqueValue,
            { state: "purged" }
          >;
        }>;
  }>;

export type InboxV2QueryableMessageTransportFact =
  | Readonly<{
      projectionState: "available";
      fact: InboxV2MessageTransportFact;
    }>
  | Readonly<{
      projectionState: "classified_payload_purged";
      fact: Readonly<{
        kind: "receipt";
        observation: InboxV2PurgedProviderReceiptObservation;
      }>;
    }>;

export type InboxV2QueryableMessageTransportFactPage = Readonly<{
  tenantId: InboxV2TenantId;
  message: Readonly<{
    tenantId: InboxV2TenantId;
    kind: "message";
    id: InboxV2MessageId;
  }>;
  snapshotToken: string;
  facts: readonly InboxV2QueryableMessageTransportFact[];
  nextCursor: string | null;
}>;

export type InboxV2ProviderLifecycleOperationRead = Readonly<{
  operation: InboxV2MessageProviderLifecycleOperation;
  initialOperation: InboxV2MessageProviderLifecycleOperation;
  createdStreamPosition: InboxV2BigintCounter;
  lastChangedStreamPosition: InboxV2BigintCounter;
}>;

export type InboxV2ProviderLifecycleTransitionRead = Readonly<{
  transition: InboxV2MessageProviderLifecycleTransition;
  recordedStreamPosition: InboxV2BigintCounter;
}>;

export type InboxV2ProviderLifecycleTransitionPage = Readonly<{
  tenantId: InboxV2TenantId;
  operation: Readonly<{
    tenantId: InboxV2TenantId;
    kind: "message_provider_lifecycle_operation";
    id: string;
  }>;
  snapshotToken: string;
  throughRevision: InboxV2EntityRevision;
  transitions: readonly InboxV2ProviderLifecycleTransitionRead[];
  nextCursor: string | null;
}>;

type InboxV2BoundedReadInput = Readonly<{
  snapshotToken?: string | null;
  cursor?: string | null;
  limit?: number;
}>;

export type ListInboxV2MessageTransportLinksInput = InboxV2BoundedReadInput &
  Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
  }>;

export type ListInboxV2MessageReactionsInput = InboxV2BoundedReadInput &
  Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
  }>;

export type ListInboxV2MessageTransportFactsInput = InboxV2BoundedReadInput &
  Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
  }>;

export type ListInboxV2ProviderLifecycleTransitionsInput =
  InboxV2BoundedReadInput &
    Readonly<{
      tenantId: InboxV2TenantId;
      operationId: string;
    }>;

export type InboxV2TimelineMessageRepository = Readonly<{
  createMessage(
    input: Readonly<{
      commit: InboxV2MessageCreationCommit;
      streamPosition: InboxV2BigintCounter;
    }>
  ): Promise<PersistInboxV2MessageCreationResult>;
  withMessageCreation<TResult>(
    input: Readonly<{
      commit: InboxV2MessageCreationCommit;
      streamPosition: InboxV2BigintCounter;
    }>,
    persist: (context: {
      executor: RawSqlExecutor;
      message: InboxV2Message;
      timelineItem: InboxV2TimelineItem;
      envelope: InboxV2SafeGenericEnvelope;
    }) => Promise<TResult>
  ): Promise<PersistInboxV2MessageCreationResult<TResult>>;
  mutateMessage(
    input: Readonly<{
      commit: InboxV2MessageMutationCommit;
      streamPosition: InboxV2BigintCounter;
    }>
  ): Promise<PersistInboxV2MessageMutationResult>;
  withMessageMutation<TResult>(
    input: Readonly<{
      commit: InboxV2MessageMutationCommit;
      streamPosition: InboxV2BigintCounter;
    }>,
    persist: (context: {
      executor: RawSqlExecutor;
      message: InboxV2Message;
      timelineItem: InboxV2TimelineItem;
      envelope: InboxV2SafeGenericEnvelope;
    }) => Promise<TResult>
  ): Promise<PersistInboxV2MessageMutationResult<TResult>>;
  associateTransportOccurrence(
    input: Readonly<{
      commit: InboxV2MessageTransportAssociationCommit;
      streamPosition: InboxV2BigintCounter;
    }>
  ): Promise<PersistInboxV2MessageAuxiliaryResult>;
  appendTransportFact(
    input: Readonly<{
      commit: InboxV2MessageTransportFactCommit;
      streamPosition: InboxV2BigintCounter;
    }>
  ): Promise<PersistInboxV2MessageAuxiliaryResult>;
  applyReaction(
    input: Readonly<{
      commit: InboxV2MessageReactionCommit;
      streamPosition: InboxV2BigintCounter;
    }>
  ): Promise<PersistInboxV2MessageAuxiliaryResult>;
  createProviderLifecycleOperation(
    input: Readonly<{
      commit: InboxV2MessageProviderLifecycleCreationCommit;
      streamPosition: InboxV2BigintCounter;
    }>
  ): Promise<PersistInboxV2MessageAuxiliaryResult>;
  transitionProviderLifecycleOperation(
    input: Readonly<{
      commit: InboxV2MessageProviderLifecycleTransitionCommit;
      streamPosition: InboxV2BigintCounter;
    }>
  ): Promise<PersistInboxV2MessageAuxiliaryResult>;
  findMessage(input: {
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
  }): Promise<InboxV2Message | null>;
  findTimelineContent(input: {
    tenantId: InboxV2TenantId;
    contentId: string;
  }): Promise<InboxV2TimelineContent | null>;
  listMessageTransportLinks(
    input: ListInboxV2MessageTransportLinksInput
  ): Promise<InboxV2MessageTransportLinkPage | null>;
  listMessageReactions(
    input: ListInboxV2MessageReactionsInput
  ): Promise<InboxV2QueryableMessageReactionPage | null>;
  listMessageTransportFacts(
    input: ListInboxV2MessageTransportFactsInput
  ): Promise<InboxV2QueryableMessageTransportFactPage | null>;
  findProviderLifecycleOperation(input: {
    tenantId: InboxV2TenantId;
    operationId: string;
  }): Promise<InboxV2ProviderLifecycleOperationRead | null>;
  listProviderLifecycleTransitions(
    input: ListInboxV2ProviderLifecycleTransitionsInput
  ): Promise<InboxV2ProviderLifecycleTransitionPage | null>;
  listMessageHistory(
    input: ListInboxV2MessageHistoryInput
  ): Promise<ReturnType<typeof inboxV2MessageRevisionPageSchema.parse> | null>;
  listTimeline(
    input: ListInboxV2TimelineInput
  ): Promise<ReturnType<typeof inboxV2TimelineItemPageSchema.parse>>;
}>;

type IdRow = { id: unknown };
type SourceOccurrenceFenceRow = IdRow & {
  resolution_state: unknown;
  revision: unknown;
  updated_at: unknown;
};
type MessageRevisionReplayRow = Record<string, unknown> & {
  id: unknown;
  change_kind: unknown;
  occurred_at: unknown;
  recorded_stream_position: unknown;
};
type ConversationHeadRow = {
  id: unknown;
  revision: unknown;
  latest_timeline_sequence: unknown;
  latest_activity_item_id: unknown;
  latest_activity_timeline_sequence: unknown;
  latest_activity_at: unknown;
  updated_at: unknown;
};
type MessageHeadRow = {
  database_now?: unknown;
  tenant_id: unknown;
  message_id: unknown;
  conversation_id: unknown;
  timeline_item_id: unknown;
  author_participant_id: unknown;
  origin_kind: unknown;
  origin_source_occurrence_id: unknown;
  origin_source_direction: unknown;
  claim_at_occurrence_id: unknown;
  claim_at_occurrence_version: unknown;
  claim_resolved_employee_id: unknown;
  origin_outbound_route_id: unknown;
  migration_provenance_id: unknown;
  app_actor_kind: unknown;
  app_actor_employee_id: unknown;
  app_authorization_epoch: unknown;
  app_trusted_service_id: unknown;
  automation_kind: unknown;
  automation_cause_event_id: unknown;
  automation_correlation_id: unknown;
  automation_caused_at: unknown;
  automation_initiating_employee_id: unknown;
  automation_initiating_authorization_epoch: unknown;
  content_id: unknown;
  content_revision: unknown;
  content_state: unknown;
  content_digest_sha256: unknown;
  tombstone_event_id: unknown;
  tombstone_reason_id: unknown;
  retention_policy_id: unknown;
  retention_policy_version: unknown;
  retention_policy_revision: unknown;
  reference_kind: unknown;
  lifecycle: unknown;
  lifecycle_revision_id: unknown;
  lifecycle_reason_id: unknown;
  lifecycle_provider_operation_id: unknown;
  lifecycle_policy_reason_id: unknown;
  lifecycle_changed_at: unknown;
  message_revision: unknown;
  message_created_at: unknown;
  message_updated_at: unknown;
  message_last_changed_stream_position: unknown;
  timeline_revision: unknown;
  timeline_sequence: unknown;
  timeline_subject_kind: unknown;
  timeline_subject_id: unknown;
  timeline_visibility: unknown;
  timeline_activity_kind: unknown;
  timeline_activity_source_occurrence_id: unknown;
  timeline_activity_reason_id: unknown;
  timeline_migration_provenance_id: unknown;
  timeline_activity_imported_at: unknown;
  timeline_occurred_at: unknown;
  timeline_received_at: unknown;
  timeline_created_at: unknown;
  timeline_updated_at: unknown;
  timeline_last_changed_stream_position: unknown;
};
type ContentPayloadRow = Record<string, unknown> & {
  tenant_id: unknown;
  content_id: unknown;
  content_revision: unknown;
  ordinal: unknown;
  block_key: unknown;
  kind: unknown;
};
type ContactValueRow = Record<string, unknown> & {
  tenant_id: unknown;
  content_id: unknown;
  content_revision: unknown;
  block_ordinal: unknown;
  value_ordinal: unknown;
  kind: unknown;
  value: unknown;
  label: unknown;
};
type ContentHeadRow = {
  tenant_id: unknown;
  id: unknown;
  state: unknown;
  content_digest_sha256: unknown;
  tombstone_event_id: unknown;
  tombstone_reason_id: unknown;
  retention_policy_id: unknown;
  retention_policy_version: unknown;
  retention_policy_revision: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

export function createSqlInboxV2TimelineMessageRepository(
  executor: InboxV2TimelineMessageTransactionExecutor | HuleeDatabase
): InboxV2TimelineMessageRepository {
  const transactionExecutor =
    executor as unknown as InboxV2TimelineMessageTransactionExecutor;

  return {
    async createMessage(input) {
      const normalized = normalizeMessageCreationInput(input);
      return persistMessageCreation(
        transactionExecutor,
        normalized,
        async () => undefined,
        true
      );
    },

    async withMessageCreation(input, persist) {
      const normalized = normalizeMessageCreationInput(input);
      return persistMessageCreation(
        transactionExecutor,
        normalized,
        persist,
        false
      );
    },

    async mutateMessage(input) {
      const normalized = normalizeMessageMutationInput(input);
      return persistMessageMutation(
        transactionExecutor,
        normalized,
        async () => undefined,
        true
      );
    },

    async withMessageMutation(input, persist) {
      const normalized = normalizeMessageMutationInput(input);
      return persistMessageMutation(
        transactionExecutor,
        normalized,
        persist,
        false
      );
    },

    async associateTransportOccurrence(input) {
      const commit = inboxV2MessageTransportAssociationCommitSchema.parse(
        input.commit
      );
      const streamPosition = inboxV2BigintCounterSchema.parse(
        input.streamPosition
      );
      return persistTransportAssociation(transactionExecutor, {
        commit,
        streamPosition
      });
    },

    async appendTransportFact(input) {
      const commit = inboxV2MessageTransportFactCommitSchema.parse(
        input.commit
      );
      const streamPosition = inboxV2BigintCounterSchema.parse(
        input.streamPosition
      );
      return persistTransportFact(transactionExecutor, {
        commit,
        streamPosition
      });
    },

    async applyReaction(input) {
      const commit = inboxV2MessageReactionCommitSchema.parse(input.commit);
      const streamPosition = inboxV2BigintCounterSchema.parse(
        input.streamPosition
      );
      return persistReaction(transactionExecutor, { commit, streamPosition });
    },

    async createProviderLifecycleOperation(input) {
      const commit =
        inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse(
          input.commit
        );
      const streamPosition = inboxV2BigintCounterSchema.parse(
        input.streamPosition
      );
      return persistProviderLifecycleCreation(transactionExecutor, {
        commit,
        streamPosition
      });
    },

    async transitionProviderLifecycleOperation(input) {
      const commit =
        inboxV2MessageProviderLifecycleTransitionCommitSchema.parse(
          input.commit
        );
      const streamPosition = inboxV2BigintCounterSchema.parse(
        input.streamPosition
      );
      return persistProviderLifecycleTransition(transactionExecutor, {
        commit,
        streamPosition
      });
    },

    async findMessage(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const messageId = inboxV2MessageIdSchema.parse(input.messageId);
      return transactionExecutor.transaction(
        async (transaction) =>
          (
            await loadTimelineMessageAggregate(transaction, {
              tenantId,
              messageId,
              lock: false
            })
          )?.message ?? null,
        TIMELINE_MESSAGE_SNAPSHOT_CONFIG
      );
    },

    async findTimelineContent(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      return transactionExecutor.transaction(
        (transaction) =>
          loadTimelineContent(transaction, {
            tenantId,
            contentId: parseEntityId(input.contentId, "TimelineContent id"),
            lock: false
          }),
        TIMELINE_MESSAGE_SNAPSHOT_CONFIG
      );
    },

    async listMessageTransportLinks(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const messageId = inboxV2MessageIdSchema.parse(input.messageId);
      const control = normalizeBoundedReadControl(input);
      const limit = parsePageLimit(
        input.limit,
        MAX_MESSAGE_AUXILIARY_PAGE_SIZE,
        "Message transport links"
      );
      return transactionExecutor.transaction(
        (transaction) =>
          loadMessageTransportLinkPage(transaction, {
            tenantId,
            messageId,
            ...control,
            limit
          }),
        TIMELINE_MESSAGE_SNAPSHOT_CONFIG
      );
    },

    async listMessageReactions(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const messageId = inboxV2MessageIdSchema.parse(input.messageId);
      const control = normalizeBoundedReadControl(input);
      const limit = parsePageLimit(
        input.limit,
        MAX_MESSAGE_AUXILIARY_PAGE_SIZE,
        "Message reactions"
      );
      return transactionExecutor.transaction(
        (transaction) =>
          loadMessageReactionPage(transaction, {
            tenantId,
            messageId,
            ...control,
            limit
          }),
        TIMELINE_MESSAGE_SNAPSHOT_CONFIG
      );
    },

    async listMessageTransportFacts(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const messageId = inboxV2MessageIdSchema.parse(input.messageId);
      const control = normalizeBoundedReadControl(input);
      const limit = parsePageLimit(
        input.limit,
        MAX_MESSAGE_AUXILIARY_PAGE_SIZE,
        "Message transport facts"
      );
      return transactionExecutor.transaction(
        (transaction) =>
          loadMessageTransportFactPage(transaction, {
            tenantId,
            messageId,
            ...control,
            limit
          }),
        TIMELINE_MESSAGE_SNAPSHOT_CONFIG
      );
    },

    async findProviderLifecycleOperation(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const operationId =
        inboxV2MessageProviderLifecycleOperationIdSchema.parse(
          input.operationId
        );
      return transactionExecutor.transaction(
        (transaction) =>
          loadProviderLifecycleOperation(transaction, {
            tenantId,
            operationId
          }),
        TIMELINE_MESSAGE_SNAPSHOT_CONFIG
      );
    },

    async listProviderLifecycleTransitions(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const operationId =
        inboxV2MessageProviderLifecycleOperationIdSchema.parse(
          input.operationId
        );
      const control = normalizeBoundedReadControl(input);
      const limit = parsePageLimit(
        input.limit,
        MAX_MESSAGE_AUXILIARY_PAGE_SIZE,
        "Provider lifecycle transitions"
      );
      return transactionExecutor.transaction(
        (transaction) =>
          loadProviderLifecycleTransitionPage(transaction, {
            tenantId,
            operationId,
            ...control,
            limit
          }),
        TIMELINE_MESSAGE_SNAPSHOT_CONFIG
      );
    },

    async listMessageHistory(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const messageId = inboxV2MessageIdSchema.parse(input.messageId);
      const afterRevision =
        input.afterRevision === null || input.afterRevision === undefined
          ? null
          : inboxV2EntityRevisionSchema.parse(input.afterRevision);
      const limit = parsePageLimit(
        input.limit,
        MAX_MESSAGE_HISTORY_PAGE_SIZE,
        "Message history"
      );
      return transactionExecutor.transaction(
        (transaction) =>
          loadMessageHistory(transaction, {
            tenantId,
            messageId,
            afterRevision,
            limit
          }),
        TIMELINE_MESSAGE_SNAPSHOT_CONFIG
      );
    },

    async listTimeline(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const conversationId = inboxV2ConversationIdSchema.parse(
        input.conversationId
      );
      const limit = parsePageLimit(
        input.limit,
        MAX_TIMELINE_PAGE_SIZE,
        "Timeline"
      );
      const anchor = normalizeTimelineAnchor(input.anchor);
      return transactionExecutor.transaction(
        (transaction) =>
          loadTimelinePage(transaction, {
            tenantId,
            conversationId,
            anchor,
            limit
          }),
        TIMELINE_MESSAGE_SNAPSHOT_CONFIG
      );
    }
  };
}

export class InboxV2TimelineMessagePersistenceInvariantError extends Error {
  readonly code = "inbox_v2.timeline_message_persistence_invariant" as const;

  constructor(message: string) {
    super(message);
    this.name = "InboxV2TimelineMessagePersistenceInvariantError";
  }
}

export function buildInboxV2SafeGenericEnvelope(input: {
  tenantId: InboxV2TenantId;
  entityKind: InboxV2SafeGenericEnvelope["entityKind"];
  entityId: string;
  entityRevision: InboxV2EntityRevision;
  timelineItemId: InboxV2TimelineItemId;
  timelineSequence: InboxV2TimelineSequence;
  streamPosition: InboxV2BigintCounter;
  changeKind: string;
  occurredAt: string;
}): InboxV2SafeGenericEnvelope {
  return Object.freeze({
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    entityKind: input.entityKind,
    entityId: input.entityId,
    entityRevision: inboxV2EntityRevisionSchema.parse(input.entityRevision),
    timelineItemId: inboxV2TimelineItemIdSchema.parse(input.timelineItemId),
    timelineSequence: inboxV2TimelineSequenceSchema.parse(
      input.timelineSequence
    ),
    streamPosition: inboxV2BigintCounterSchema.parse(input.streamPosition),
    changeKind: input.changeKind,
    occurredAt: input.occurredAt
  });
}

type NormalizedMessageCreationInput = Readonly<{
  commit: InboxV2MessageCreationCommit;
  streamPosition: InboxV2BigintCounter;
}>;
type PreparedInboxV2MessageCreationState = {
  readonly executor: RawSqlExecutor;
  readonly atomicMaterializationToken: object | null;
  readonly commit: InboxV2MessageCreationCommit;
  readonly timelineItem: InboxV2TimelineItem;
  readonly routeDisposition: InboxV2OutboundRouteConsumptionDisposition;
  readonly fileParentAttachmentsCapability: InboxV2PreparedFileParentAttachmentsCapability;
  consumed: boolean;
};
type SealInboxV2PreparedMessageCreationOptions = Readonly<{
  atomicMaterializationToken: object | null;
  atomicMaterializationProvenance: Readonly<{
    mutationId: string;
    streamCommitId: string;
    streamPosition: string;
  }> | null;
  materializeSourceResolution: boolean;
}>;
const preparedInboxV2MessageCreations = new WeakMap<
  InboxV2PreparedMessageCreationCapability,
  PreparedInboxV2MessageCreationState
>();
type NormalizedMessageMutationInput = Readonly<{
  commit: InboxV2MessageMutationCommit;
  streamPosition: InboxV2BigintCounter;
}>;
type PreparedInboxV2AttachmentMaterializationMessageMutationState = {
  readonly atomicMaterializationToken: object;
  readonly sealExecutor: RawSqlExecutor;
  readonly commit: InboxV2MessageMutationCommit;
  readonly current: LoadedTimelineMessageAggregate;
  consumed: boolean;
};
const preparedInboxV2AttachmentMaterializationMessageMutations = new WeakMap<
  InboxV2PreparedAttachmentMaterializationMessageMutationCapability,
  PreparedInboxV2AttachmentMaterializationMessageMutationState
>();
export type InboxV2OutboundRouteConsumptionRecord = Readonly<{
  tenantId: InboxV2TenantId;
  consumerKind: "message_creation" | "provider_lifecycle" | "reaction";
  consumerId: string;
  messageId: InboxV2MessageId;
  outboundRouteId: string;
  mutationToken: string;
  idempotencyToken: string;
  correlationToken: string;
  consumedByTrustedServiceId: string;
  consumedAt: string;
  revision: InboxV2EntityRevision;
  commitDigestSha256: string;
}>;
type InboxV2OutboundRouteConsumptionDisposition =
  | "absent"
  | "exact"
  | "conflict";
type InboxV2MessageCreationDispatchDisposition =
  | "absent"
  | "exact"
  | "conflict";
export type InboxV2MessageCreationDispatchRow = Readonly<{
  id: unknown;
  message_id: unknown;
  conversation_id: unknown;
  timeline_item_id: unknown;
  route_id: unknown;
  multi_send_operation_id: unknown;
  created_at: unknown;
}>;
export type InboxV2MessageCreationDispatchIdentity = Readonly<{
  dispatch: NonNullable<InboxV2MessageCreationCommit["outboundDispatch"]>;
  conversationId: InboxV2ConversationId;
  timelineItemId: InboxV2TimelineItemId;
}>;
type LoadedTimelineMessageAggregate = Readonly<{
  message: InboxV2Message;
  timelineItem: InboxV2TimelineItem;
  content: InboxV2TimelineContent;
  databaseNow: string;
  streamPosition: InboxV2BigintCounter;
}>;

function normalizeMessageCreationInput(input: {
  commit: InboxV2MessageCreationCommit;
  streamPosition: InboxV2BigintCounter;
}): NormalizedMessageCreationInput {
  return {
    commit: inboxV2MessageCreationCommitSchema.parse(input.commit),
    streamPosition: inboxV2BigintCounterSchema.parse(input.streamPosition)
  };
}

function normalizeMessageMutationInput(input: {
  commit: InboxV2MessageMutationCommit;
  streamPosition: InboxV2BigintCounter;
}): NormalizedMessageMutationInput {
  return {
    commit: inboxV2MessageMutationCommitSchema.parse(input.commit),
    streamPosition: inboxV2BigintCounterSchema.parse(input.streamPosition)
  };
}

function messageRouteConsumptionRecord(
  commit: InboxV2MessageCreationCommit
): InboxV2OutboundRouteConsumptionRecord | null {
  const consumption = commit.routeConsumption;
  if (consumption === null) return null;
  return {
    tenantId: commit.tenantId,
    consumerKind: "message_creation",
    consumerId: commit.message.id,
    messageId: commit.message.id,
    outboundRouteId: consumption.outboundRoute.id,
    mutationToken: consumption.mutationToken,
    idempotencyToken: consumption.idempotencyToken,
    correlationToken: consumption.correlationToken,
    consumedByTrustedServiceId: consumption.consumedByTrustedServiceId,
    consumedAt: consumption.consumedAt,
    revision: inboxV2EntityRevisionSchema.parse(consumption.revision),
    commitDigestSha256: computeInboxV2TimelineMessageCommitDigest(consumption)
  };
}

function providerLifecycleRouteConsumptionRecord(
  commit: InboxV2MessageProviderLifecycleCreationCommit
): InboxV2OutboundRouteConsumptionRecord | null {
  const consumption = commit.routeConsumption;
  if (consumption === null) return null;
  return {
    tenantId: commit.tenantId,
    consumerKind: "provider_lifecycle",
    consumerId: commit.operation.id,
    messageId: commit.message.id,
    outboundRouteId: consumption.outboundRoute.id,
    mutationToken: consumption.mutationToken,
    idempotencyToken: consumption.idempotencyToken,
    correlationToken: consumption.correlationToken,
    consumedByTrustedServiceId: consumption.consumedByTrustedServiceId,
    consumedAt: consumption.consumedAt,
    revision: inboxV2EntityRevisionSchema.parse(consumption.revision),
    commitDigestSha256: computeInboxV2TimelineMessageCommitDigest(consumption)
  };
}

function reactionRouteConsumptionRecord(
  commit: InboxV2MessageReactionCommit
): InboxV2OutboundRouteConsumptionRecord | null {
  const consumption = commit.routeConsumption;
  if (consumption === null) return null;
  return {
    tenantId: commit.tenantId,
    consumerKind: "reaction",
    consumerId: commit.transition.id,
    messageId: commit.beforeMessage.id,
    outboundRouteId: consumption.outboundRoute.id,
    mutationToken: consumption.mutationToken,
    idempotencyToken: consumption.idempotencyToken,
    correlationToken: consumption.correlationToken,
    consumedByTrustedServiceId: consumption.consumedByTrustedServiceId,
    consumedAt: consumption.consumedAt,
    revision: inboxV2EntityRevisionSchema.parse(consumption.revision),
    commitDigestSha256: computeInboxV2TimelineMessageCommitDigest(consumption)
  };
}

async function inspectOutboundRouteConsumption(
  transaction: RawSqlExecutor,
  consumption: InboxV2OutboundRouteConsumptionRecord
): Promise<InboxV2OutboundRouteConsumptionDisposition> {
  const routeResult = await transaction.execute<IdRow>(
    buildLockInboxV2OutboundRouteForConsumptionSql({
      tenantId: consumption.tenantId,
      outboundRouteId: consumption.outboundRouteId
    })
  );
  assertAtMostOneRow(routeResult, "Outbound-route consumption route lock");
  if (routeResult.rows.length === 0) return "conflict";

  const consumptionResult = await transaction.execute<Record<string, unknown>>(
    buildFindInboxV2OutboundRouteConsumptionSql(consumption)
  );
  if (consumptionResult.rows.length === 0) return "absent";
  if (consumptionResult.rows.length !== 1) return "conflict";
  return outboundRouteConsumptionRowMatches(
    consumptionResult.rows[0] as Record<string, unknown>,
    consumption
  )
    ? "exact"
    : "conflict";
}

function outboundRouteConsumptionRowMatches(
  row: Record<string, unknown>,
  consumption: InboxV2OutboundRouteConsumptionRecord
): boolean {
  return (
    row.id ===
      derivedInboxV2Id(
        "outbound_route_consumption",
        `${consumption.consumerKind}:${consumption.consumerId}`
      ) &&
    row.consumer_kind === consumption.consumerKind &&
    row.consumer_id === consumption.consumerId &&
    row.message_id === consumption.messageId &&
    row.outbound_route_id === consumption.outboundRouteId &&
    row.mutation_token === consumption.mutationToken &&
    row.idempotency_token === consumption.idempotencyToken &&
    row.correlation_token === consumption.correlationToken &&
    row.consumed_by_trusted_service_id ===
      consumption.consumedByTrustedServiceId &&
    parseTimestamp(row.consumed_at, "Outbound-route consumedAt") ===
      consumption.consumedAt &&
    parseRevision(row.revision, "Outbound-route consumption revision") ===
      consumption.revision &&
    row.commit_digest_sha256 === consumption.commitDigestSha256
  );
}

async function inspectMessageCreationDispatch(
  transaction: RawSqlExecutor,
  commit: InboxV2MessageCreationCommit,
  timelineItem: InboxV2TimelineItem
): Promise<InboxV2MessageCreationDispatchDisposition> {
  const expected = commit.outboundDispatch;
  const result = await transaction.execute<InboxV2MessageCreationDispatchRow>(
    buildFindInboxV2MessageCreationDispatchSql({
      tenantId: commit.tenantId,
      messageId: commit.message.id,
      expectedDispatch: expected
    })
  );
  if (result.rows.length === 0) return "absent";
  if (expected === null || result.rows.length !== 1) return "conflict";

  const row = result.rows[0] as InboxV2MessageCreationDispatchRow;
  return messageCreationDispatchRowMatches(row, {
    dispatch: expected,
    conversationId: commit.message.conversation.id,
    timelineItemId: timelineItem.id
  })
    ? "exact"
    : "conflict";
}

export function buildFindInboxV2MessageCreationDispatchSql(
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
    expectedDispatch: InboxV2MessageCreationCommit["outboundDispatch"];
  }>
): SQL {
  const expected = input.expectedDispatch;
  return expected === null
    ? sql`
        select id, message_id, conversation_id, timeline_item_id, route_id,
               multi_send_operation_id, created_at
          from inbox_v2_outbound_dispatches
         where tenant_id = ${input.tenantId}
           and message_id = ${input.messageId}
         limit 2
         for update
      `
    : sql`
        select id, message_id, conversation_id, timeline_item_id, route_id,
               multi_send_operation_id, created_at
          from inbox_v2_outbound_dispatches
         where tenant_id = ${input.tenantId}
           and (
             id = ${expected.id}
             or route_id = ${expected.route.id}
             or message_id = ${input.messageId}
           )
         order by case when id = ${expected.id} then 0 else 1 end,
                  case when route_id = ${expected.route.id} then 0 else 1 end
         limit 2
         for update
      `;
}

export function messageCreationDispatchRowMatches(
  row: InboxV2MessageCreationDispatchRow,
  expected: InboxV2MessageCreationDispatchIdentity
): boolean {
  return (
    row.id === expected.dispatch.id &&
    row.message_id === expected.dispatch.message.id &&
    row.conversation_id === expected.conversationId &&
    row.timeline_item_id === expected.timelineItemId &&
    row.route_id === expected.dispatch.route.id &&
    nullableString(row.multi_send_operation_id) ===
      (expected.dispatch.multiSendOperation?.id ?? null) &&
    parseTimestamp(row.created_at, "Message creation dispatch createdAt") ===
      expected.dispatch.createdAt
  );
}

async function persistMessageCreation<TResult>(
  transactionExecutor: InboxV2TimelineMessageTransactionExecutor,
  input: NormalizedMessageCreationInput,
  persist: (context: SealInboxV2MessageCreationContext) => Promise<TResult>,
  retrySafe: boolean
): Promise<PersistInboxV2MessageCreationResult<TResult>> {
  return runTimelineMessageTransaction(
    transactionExecutor,
    async (transaction) => {
      const preparation = await prepareInboxV2MessageCreationInTransaction(
        transaction,
        { commit: input.commit },
        null,
        transaction
      );
      if (preparation.kind !== "ready") return preparation;
      return sealInboxV2PreparedMessageCreationInTransaction(
        transaction,
        {
          capability: preparation.capability,
          streamPosition: input.streamPosition
        },
        persist,
        {
          atomicMaterializationToken: null,
          atomicMaterializationProvenance: null,
          materializeSourceResolution: false
        }
      );
    },
    retrySafe ? TRANSACTION_ATTEMPTS : 1
  );
}

export async function prepareInboxV2MessageCreation(
  context: InboxV2AuthorizedCommandMutationContext,
  input: PrepareInboxV2MessageCreationInput
): Promise<PrepareInboxV2MessageCreationResult> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  if (context.profile !== "domain") {
    throw invariantError(
      "Inbox V2 Message preparation requires an authorized domain context."
    );
  }
  if (context.atomicMaterializationToken === undefined) {
    throw invariantError(
      "Inbox V2 Message preparation requires an atomic materialization token."
    );
  }
  const commit = inboxV2MessageCreationCommitSchema.parse(input.commit);
  if (commit.tenantId !== context.tenantId) {
    throw invariantError(
      "Inbox V2 Message preparation cannot cross the authorized tenant boundary."
    );
  }
  assertInboxV2MessageCreationAuthority(context, commit);
  return prepareInboxV2MessageCreationInTransaction(
    context.executor,
    { commit },
    context.atomicMaterializationToken,
    requireInboxV2AtomicSealExecutor(context)
  );
}

async function prepareInboxV2MessageCreationInTransaction(
  executor: RawSqlExecutor,
  input: PrepareInboxV2MessageCreationInput,
  atomicMaterializationToken: object | null,
  sealExecutor: RawSqlExecutor
): Promise<PrepareInboxV2MessageCreationResult> {
  const commit = inboxV2MessageCreationCommitSchema.parse(input.commit);
  const sourceOccurrenceFence =
    deriveInboxV2MessageCreationSourceOccurrenceFenceFromCommit(commit);
  const timelineItem = commit.timelineAllocation.items[0];
  if (timelineItem === undefined) {
    throw invariantError("Message creation has no TimelineItem.");
  }

  const headResult = await executor.execute<ConversationHeadRow>(
    buildLockInboxV2TimelineConversationHeadSql({
      tenantId: commit.tenantId,
      conversationId: commit.message.conversation.id
    })
  );
  assertAtMostOneRow(headResult, "Message Conversation-head lock");
  if (headResult.rows.length === 0) {
    return { kind: "conversation_not_found" };
  }

  const existing = await loadTimelineMessageAggregate(executor, {
    tenantId: commit.tenantId,
    messageId: commit.message.id,
    lock: true
  });
  const routeConsumption = messageRouteConsumptionRecord(commit);
  const routeDisposition =
    routeConsumption === null
      ? "absent"
      : await inspectOutboundRouteConsumption(executor, routeConsumption);
  if (routeDisposition === "conflict") {
    return {
      kind: "conflict",
      code: "message.reference_conflict",
      current: existing?.message ?? null
    };
  }
  const dispatchDisposition = await inspectMessageCreationDispatch(
    executor,
    commit,
    timelineItem
  );
  if (dispatchDisposition === "conflict") {
    return {
      kind: "conflict",
      code: "message.transport_conflict",
      current: existing?.message ?? null
    };
  }
  const revisionDisposition = await inspectMessageRevisionReplay(
    executor,
    commit.initialRevision
  );
  if (existing !== null) {
    return revisionDisposition.kind === "exact" &&
      sameValue(existing.message, commit.message) &&
      sameValue(existing.timelineItem, timelineItem) &&
      sameValue(existing.content, commit.content) &&
      (routeConsumption === null || routeDisposition === "exact") &&
      (commit.outboundDispatch === null
        ? dispatchDisposition === "absent"
        : dispatchDisposition === "exact")
      ? {
          kind: "already_applied",
          message: existing.message,
          timelineItem: existing.timelineItem,
          envelope: messageEnvelope({
            message: existing.message,
            timelineItem: existing.timelineItem,
            streamPosition: revisionDisposition.streamPosition,
            changeKind: revisionDisposition.revision.change.kind,
            occurredAt: revisionDisposition.revision.occurredAt
          })
        }
      : {
          kind: "conflict",
          code: "message.identity_conflict",
          current: existing.message
        };
  }
  if (revisionDisposition.kind !== "absent") {
    return {
      kind: "conflict",
      code: "message.identity_conflict",
      current: null
    };
  }
  if (dispatchDisposition !== "absent") {
    return {
      kind: "conflict",
      code: "message.transport_conflict",
      current: null
    };
  }

  if (
    !conversationHeadMatches(
      headResult.rows[0] as ConversationHeadRow,
      commit.timelineAllocation.conversationBefore.head
    )
  ) {
    return {
      kind: "conflict",
      code: "revision.conflict",
      current: null
    };
  }

  const authorResult = await executor.execute<IdRow>(
    buildFindInboxV2MessageAuthorSql({
      tenantId: commit.tenantId,
      conversationId: commit.message.conversation.id,
      participantId: commit.authorParticipant.id
    })
  );
  assertAtMostOneRow(authorResult, "Message author lookup");
  if (authorResult.rows.length === 0) {
    return { kind: "author_not_found" };
  }
  if (sourceOccurrenceFence !== null) {
    const occurrenceResult = await executor.execute<SourceOccurrenceFenceRow>(
      buildFindInboxV2MessageSourceOccurrenceSql({
        tenantId: commit.tenantId,
        sourceOccurrenceId: sourceOccurrenceFence.sourceOccurrenceId
      })
    );
    assertAtMostOneRow(occurrenceResult, "Message source occurrence lookup");
    if (occurrenceResult.rows.length === 0) {
      return { kind: "source_reference_not_found" };
    }
    if (
      !inboxV2MessageCreationSourceOccurrenceFenceRowMatches(
        occurrenceResult.rows[0]!,
        sourceOccurrenceFence
      )
    ) {
      return {
        kind: "conflict",
        code: "revision.conflict",
        current: null
      };
    }
  }

  const attachmentAnchors = messageAttachmentAnchorBlocks(
    commit.content.state.kind === "available" ? commit.content.state.blocks : []
  );
  if (
    attachmentAnchors.length > 0 &&
    (
      await executor.execute<Record<string, unknown>>(
        buildFindInboxV2ClaimedMessageAttachmentAnchorsSql({
          tenantId: commit.tenantId,
          attachmentIds: attachmentAnchors.map(
            ({ attachmentId }) => attachmentId
          )
        })
      )
    ).rows.length > 0
  ) {
    return {
      kind: "conflict",
      code: "message.reference_conflict",
      current: null
    };
  }

  const fileParentPreparation =
    await prepareInboxV2FileParentAttachmentsInTransaction(
      executor,
      sealExecutor,
      atomicMaterializationToken,
      {
        tenantId: commit.tenantId,
        attachments: deriveInboxV2MessageCreationReadyFileParents(
          commit,
          timelineItem
        )
      }
    );
  if (fileParentPreparation.kind !== "ready") {
    return {
      kind: "conflict",
      code: "message.reference_conflict",
      current: null
    };
  }

  const capability = Object.freeze({
    [inboxV2PreparedMessageCreationCapabilityBrand]: true as const
  });
  preparedInboxV2MessageCreations.set(capability, {
    executor: sealExecutor,
    atomicMaterializationToken,
    commit,
    timelineItem,
    routeDisposition,
    fileParentAttachmentsCapability: fileParentPreparation.capability,
    consumed: false
  });
  return { kind: "ready", capability };
}

export function deriveInboxV2MessageCreationReadyFileParents(
  commit: InboxV2MessageCreationCommit,
  timelineItem: InboxV2TimelineItem
): readonly InboxV2ReadyFileParentAttachment[] {
  const visibilityBoundary =
    timelineItem.visibility === "conversation_external"
      ? "external_work"
      : "internal";
  const commonParent = Object.freeze({
    kind: "message" as const,
    visibilityBoundary,
    parentConversationVisibility: null,
    entityId: commit.message.id,
    entityRevision: commit.message.revision,
    conversationId: commit.message.conversation.id,
    timelineItemId: timelineItem.id,
    contentId: commit.content.id,
    contentRevision: commit.content.revision
  });
  const attachments: InboxV2ReadyFileParentAttachment[] = [];
  if (commit.content.state.kind !== "available") {
    return Object.freeze(attachments);
  }
  for (const block of commit.content.state.blocks) {
    if (block.kind === "extension") {
      if (block.payloadPin.state !== "exact") continue;
      attachments.push({
        fileId: block.payloadFile.id,
        expectedFileRevision: block.payloadPin.fileRevision,
        fileVersionId: block.payloadPin.fileVersion.id,
        objectVersionId: block.payloadPin.objectVersion.id,
        parent: {
          ...commonParent,
          purpose: "extension_payload",
          blockKey: block.blockKey
        },
        processingPurposeId:
          commit.timelineAllocation.conversationAfter.purposeId,
        retentionAnchorAt: timelineItem.occurredAt
      });
      continue;
    }
    if (
      block.kind !== "image" &&
      block.kind !== "audio" &&
      block.kind !== "video" &&
      block.kind !== "file" &&
      block.kind !== "sticker"
    ) {
      continue;
    }
    if (block.attachment.state !== "ready") continue;
    attachments.push({
      fileId: block.attachment.file.id,
      expectedFileRevision: block.attachment.fileRevision,
      fileVersionId: block.attachment.fileVersion.id,
      objectVersionId: block.attachment.objectVersion.id,
      parent: {
        ...commonParent,
        purpose: "attachment",
        blockKey: block.blockKey
      },
      processingPurposeId:
        commit.timelineAllocation.conversationAfter.purposeId,
      retentionAnchorAt: timelineItem.occurredAt
    });
  }
  attachments.sort((left, right) => {
    const fileOrder = left.fileId.localeCompare(right.fileId);
    if (fileOrder !== 0) return fileOrder;
    return (left.parent.blockKey ?? "").localeCompare(
      right.parent.blockKey ?? ""
    );
  });
  return Object.freeze(attachments);
}

export function deriveInboxV2MessageCreationSourceOccurrenceFence(
  input: InboxV2MessageCreationCommit
): InboxV2MessageCreationSourceOccurrenceFence | null {
  return deriveInboxV2MessageCreationSourceOccurrenceFenceFromCommit(
    inboxV2MessageCreationCommitSchema.parse(input)
  );
}

function deriveInboxV2MessageCreationSourceOccurrenceFenceFromCommit(
  commit: InboxV2MessageCreationCommit
): InboxV2MessageCreationSourceOccurrenceFence | null {
  if (commit.sourceOccurrence === null) return null;

  const resolutionCommit = commit.sourceResolutionCommit;
  if (resolutionCommit === null) {
    throw invariantError(
      "Source Message creation has no SourceOccurrence resolution commit."
    );
  }
  const expectedResolutionState = resolutionCommit.before.resolution.state;
  if (expectedResolutionState === "resolved") {
    throw invariantError(
      "Source Message creation cannot overwrite a resolved SourceOccurrence."
    );
  }
  return Object.freeze({
    sourceOccurrenceId: resolutionCommit.before.id,
    expectedRevision: resolutionCommit.expectedRevision,
    expectedResolutionState,
    expectedUpdatedAt: resolutionCommit.before.updatedAt
  });
}

export function inboxV2MessageCreationSourceOccurrenceFenceRowMatches(
  row: Readonly<{
    resolution_state: unknown;
    revision: unknown;
    updated_at: unknown;
  }>,
  fence: InboxV2MessageCreationSourceOccurrenceFence
): boolean {
  return (
    parseRevision(row.revision, "SourceOccurrence revision") ===
      fence.expectedRevision &&
    requireString(row.resolution_state, "SourceOccurrence resolution state") ===
      fence.expectedResolutionState &&
    parseTimestamp(row.updated_at, "SourceOccurrence updatedAt") ===
      fence.expectedUpdatedAt
  );
}

export function buildInboxV2AtomicSourceMessageResolutionSql(
  input: InboxV2MessageCreationCommit
): readonly SQL[] {
  return buildInboxV2AtomicSourceMessageResolutionSqlFromCommit(
    inboxV2MessageCreationCommitSchema.parse(input)
  );
}

function buildInboxV2AtomicSourceMessageResolutionSqlFromCommit(
  commit: InboxV2MessageCreationCommit
): readonly SQL[] {
  if (commit.message.origin.kind !== "source_originated") return [];
  const externalMessageReference = commit.externalMessageReference;
  const sourceResolutionCommit = commit.sourceResolutionCommit;
  if (externalMessageReference === null || sourceResolutionCommit === null) {
    throw invariantError(
      "Source Message creation has no external reference or resolution commit."
    );
  }
  return Object.freeze([
    buildInsertInboxV2ExternalMessageReferenceValuesSql({
      reference: externalMessageReference,
      conversationId: commit.message.conversation.id
    }),
    buildInsertInboxV2SourceOccurrenceResolutionTransitionSql(
      sourceResolutionCommit
    ),
    buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql(
      sourceResolutionCommit
    )
  ]);
}

async function persistInboxV2AtomicSourceMessageResolution(
  executor: RawSqlExecutor,
  commit: InboxV2MessageCreationCommit
): Promise<void> {
  const statements =
    buildInboxV2AtomicSourceMessageResolutionSqlFromCommit(commit);
  const operations = [
    "ExternalMessageReference insert",
    "SourceOccurrence resolution transition insert",
    "SourceOccurrence resolution compare-and-swap"
  ] as const;
  for (const [index, statement] of statements.entries()) {
    await expectOneRow(
      executor,
      statement,
      operations[index] ?? "Source Message atomic resolution write"
    );
  }
}

export function buildInsertInboxV2AtomicSourceResolutionMaterializationSql(input: {
  tenantId: string;
  sourceOccurrenceId: string;
  resolutionTransitionId: string;
  externalMessageReferenceId: string;
  messageId: string;
  mutationId: string;
  streamCommitId: string;
  streamPosition: string;
  resultingRevision: string;
  createdAt: string;
}): SQL {
  return sql`
    insert into inbox_v2_atomic_source_resolution_materializations (
      tenant_id, source_occurrence_id, resolution_transition_id,
      external_message_reference_id, message_id, mutation_id,
      stream_commit_id, stream_position, resulting_revision, created_at
    ) values (
      ${input.tenantId}, ${input.sourceOccurrenceId},
      ${input.resolutionTransitionId}, ${input.externalMessageReferenceId},
      ${input.messageId}, ${input.mutationId}, ${input.streamCommitId},
      ${BigInt(input.streamPosition)}, ${BigInt(input.resultingRevision)},
      ${new Date(input.createdAt)}
    )
    returning source_occurrence_id as id
  `;
}

function sealInboxV2PreparedMessageCreationInTransaction(
  executor: RawSqlExecutor,
  input: Readonly<{
    capability: InboxV2PreparedMessageCreationCapability;
    streamPosition: InboxV2BigintCounter;
  }>,
  persist: undefined,
  options: SealInboxV2PreparedMessageCreationOptions
): Promise<SealedInboxV2PreparedMessageCreationDomainResult>;
function sealInboxV2PreparedMessageCreationInTransaction<TResult>(
  executor: RawSqlExecutor,
  input: Readonly<{
    capability: InboxV2PreparedMessageCreationCapability;
    streamPosition: InboxV2BigintCounter;
  }>,
  persist: (context: SealInboxV2MessageCreationContext) => Promise<TResult>,
  options: SealInboxV2PreparedMessageCreationOptions
): Promise<SealedInboxV2PreparedMessageCreationDomainResult<TResult>>;
async function sealInboxV2PreparedMessageCreationInTransaction<TResult>(
  executor: RawSqlExecutor,
  input: Readonly<{
    capability: InboxV2PreparedMessageCreationCapability;
    streamPosition: InboxV2BigintCounter;
  }>,
  persist:
    | ((context: SealInboxV2MessageCreationContext) => Promise<TResult>)
    | undefined,
  options: SealInboxV2PreparedMessageCreationOptions
): Promise<
  SealedInboxV2PreparedMessageCreationDomainResult<TResult | undefined>
> {
  const streamPosition = inboxV2BigintCounterSchema.parse(input.streamPosition);
  const prepared = preparedInboxV2MessageCreations.get(input.capability);
  if (prepared === undefined) {
    throw invariantError(
      "Message creation capability was not issued by this repository."
    );
  }
  if (prepared.executor !== executor) {
    throw invariantError(
      "Message creation capability belongs to a different transaction executor."
    );
  }
  if (
    prepared.atomicMaterializationToken !== options.atomicMaterializationToken
  ) {
    throw invariantError(
      "Message creation capability belongs to a different atomic materialization."
    );
  }
  if (prepared.consumed) {
    throw invariantError("Message creation capability was already consumed.");
  }
  prepared.consumed = true;

  const {
    commit,
    timelineItem,
    routeDisposition,
    fileParentAttachmentsCapability
  } = prepared;
  const envelope = messageEnvelope({
    message: commit.message,
    timelineItem,
    streamPosition,
    changeKind: "created",
    occurredAt: commit.initialRevision.occurredAt
  });
  const attributionId = derivedInboxV2Id(
    "action_attribution",
    commit.initialRevision.id
  );
  await expectOneRow(
    executor,
    buildInsertInboxV2ActionAttributionSql({
      tenantId: commit.tenantId,
      id: attributionId,
      conversationId: commit.message.conversation.id,
      attribution: commit.initialRevision.actionAttribution,
      createdAt: commit.initialRevision.recordedAt
    }),
    "Message creation attribution insert"
  );
  await expectOneRow(
    executor,
    buildInsertInboxV2TimelineContentSql({
      tenantId: commit.tenantId,
      ownerKind: "message",
      ownerId: commit.message.id,
      processingPurposeId:
        commit.timelineAllocation.conversationAfter.purposeId,
      retentionAnchorAt: timelineItem.occurredAt,
      content: commit.content,
      streamPosition
    }),
    "Message content head insert"
  );
  await expectOneRow(
    executor,
    buildInsertInboxV2TimelineContentRevisionSql({
      tenantId: commit.tenantId,
      content: commit.content,
      transitionKind: "created",
      expectedPreviousRevision: null,
      eventId: null,
      occurredAt: timelineItem.occurredAt,
      recordedAt: commit.timelineAllocation.committedAt,
      streamPosition
    }),
    "Message content revision insert"
  );
  await expectOneRow(
    executor,
    buildInsertInboxV2TimelineItemSql({ item: timelineItem, streamPosition }),
    "Message TimelineItem insert"
  );
  await expectOneRow(
    executor,
    buildInsertInboxV2MessageSql({
      message: commit.message,
      creationAttributionId: attributionId,
      streamPosition
    }),
    "Message head insert"
  );
  await persistNewMessageAttachmentAnchors(executor, {
    tenantId: commit.tenantId,
    messageId: commit.message.id,
    timelineItemId: timelineItem.id,
    timelineContentId: commit.content.id,
    blocks: messageAttachmentAnchorBlocks(
      commit.content.state.kind === "available"
        ? commit.content.state.blocks
        : []
    ),
    createdAt: commit.message.createdAt
  });
  await persistAvailableContentPayload(executor, commit.content);
  await sealInboxV2PreparedFileParentAttachmentsInTransaction(
    executor,
    options.atomicMaterializationToken,
    fileParentAttachmentsCapability
  );
  if (options.materializeSourceResolution) {
    await persistInboxV2AtomicSourceMessageResolution(executor, commit);
  }
  if (options.atomicMaterializationProvenance !== null) {
    if (
      commit.message.origin.kind === "source_originated" &&
      commit.sourceResolutionCommit !== null &&
      commit.externalMessageReference !== null
    ) {
      await expectOneRow(
        executor,
        buildInsertInboxV2AtomicSourceResolutionMaterializationSql({
          tenantId: commit.tenantId,
          sourceOccurrenceId: commit.sourceResolutionCommit.after.id,
          resolutionTransitionId:
            deriveInboxV2SourceOccurrenceResolutionTransitionId(
              commit.sourceResolutionCommit
            ),
          externalMessageReferenceId: commit.externalMessageReference.id,
          messageId: commit.message.id,
          mutationId: options.atomicMaterializationProvenance.mutationId,
          streamCommitId:
            options.atomicMaterializationProvenance.streamCommitId,
          streamPosition:
            options.atomicMaterializationProvenance.streamPosition,
          resultingRevision: commit.sourceResolutionCommit.resultingRevision,
          createdAt: commit.sourceResolutionCommit.changedAt
        }),
        "SourceOccurrence atomic resolution provenance insert"
      );
    }
  }
  if (commit.outboundDispatch !== null) {
    await expectOneRow(
      executor,
      buildInsertInboxV2OutboundDispatchSql({
        dispatch: commit.outboundDispatch,
        conversationId: commit.message.conversation.id,
        timelineItemId: timelineItem.id
      }),
      "Message outbound dispatch insert"
    );
    if (options.atomicMaterializationProvenance !== null) {
      await expectOneRow(
        executor,
        buildInsertInboxV2AtomicOutboundDispatchMaterializationSql({
          tenantId: commit.tenantId,
          dispatchId: commit.outboundDispatch.id,
          mutationId: options.atomicMaterializationProvenance.mutationId,
          streamCommitId:
            options.atomicMaterializationProvenance.streamCommitId,
          streamPosition:
            options.atomicMaterializationProvenance.streamPosition,
          resultingRevision: commit.outboundDispatch.revision,
          createdAt: commit.outboundDispatch.createdAt
        }),
        "Message outbound dispatch atomic provenance insert"
      );
    }
  }
  const routeConsumption = messageRouteConsumptionRecord(commit);
  if (routeConsumption !== null && routeDisposition === "absent") {
    await expectOneRow(
      executor,
      buildInsertInboxV2OutboundRouteConsumptionSql(routeConsumption),
      "Message outbound-route consumption insert"
    );
  }
  await expectOneRow(
    executor,
    buildInsertInboxV2MessageRevisionSql({
      revision: commit.initialRevision,
      actionAttributionId: attributionId,
      streamPosition
    }),
    "Message initial revision insert"
  );
  await persistMessageReferenceContext(executor, commit.message);
  if (
    commit.originTransportLink !== null &&
    commit.originTransportLinkHead !== null
  ) {
    await persistInitialTransportLink(executor, {
      link: commit.originTransportLink,
      head: commit.originTransportLinkHead,
      streamPosition
    });
  }
  const beforeHead = commit.timelineAllocation.conversationBefore.head;
  const afterHead = commit.timelineAllocation.conversationAfter.head;
  await expectOneRow(
    executor,
    buildAdvanceInboxV2TimelineConversationHeadSql({
      tenantId: commit.tenantId,
      conversationId: commit.message.conversation.id,
      expectedRevision: beforeHead.revision,
      expectedLatestSequence: beforeHead.latestTimelineSequence,
      latestSequence: afterHead.latestTimelineSequence,
      latestActivityItemId: afterHead.latestActivityItemId,
      latestActivitySequence: afterHead.latestActivityTimelineSequence,
      latestActivityAt: afterHead.latestActivityAt,
      streamPosition,
      changedAt: commit.timelineAllocation.committedAt
    }),
    "Message Conversation-head advance"
  );
  const result = persist
    ? await persist({
        executor,
        message: commit.message,
        timelineItem,
        envelope
      })
    : undefined;
  return {
    kind: "created",
    message: commit.message,
    timelineItem,
    envelope,
    result
  };
}

export async function sealInboxV2PreparedMessageCreation(
  context: InboxV2AuthorizedAtomicMaterializationContext,
  input: Readonly<{
    capability: InboxV2PreparedMessageCreationCapability;
  }>
): Promise<SealInboxV2PreparedMessageCreationResult> {
  assertInboxV2AuthorizedAtomicMaterializationContext(context);
  const prepared = preparedInboxV2MessageCreations.get(input.capability);
  if (prepared === undefined) {
    throw invariantError(
      "Message creation capability was not issued by this repository."
    );
  }
  if (prepared.commit.tenantId !== context.tenantId) {
    throw invariantError(
      "Inbox V2 Message seal cannot cross the authorized tenant boundary."
    );
  }
  assertInboxV2MessageCreationAuthority(context, prepared.commit);
  consumeInboxV2AtomicOutboundRouteProof(
    context.atomicMaterializationToken,
    inboxV2AtomicOutboundRouteProofFromCommit(prepared.commit)
  );
  const outboundReroute = consumeInboxV2AtomicOutboundRerouteProof(
    context.atomicMaterializationToken,
    inboxV2AtomicOutboundRerouteExpectationFromCommit(prepared.commit)
  );
  const sealed = await sealInboxV2PreparedMessageCreationInTransaction(
    prepared.executor,
    {
      capability: input.capability,
      streamPosition: inboxV2BigintCounterSchema.parse(context.streamPosition)
    },
    undefined,
    {
      atomicMaterializationToken: context.atomicMaterializationToken,
      atomicMaterializationProvenance: {
        mutationId: context.mutationId,
        streamCommitId: context.streamCommitId,
        streamPosition: context.streamPosition
      },
      materializeSourceResolution: true
    }
  );
  const messagePayloadReference = inboxV2AtomicPayloadReference({
    tenantId: prepared.commit.tenantId,
    recordId: prepared.commit.message.id,
    schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
    payload: prepared.commit.message
  });
  const domainCommitReference = inboxV2AtomicPayloadReference({
    tenantId: prepared.commit.tenantId,
    recordId: prepared.commit.initialRevision.id,
    schemaId: INBOX_V2_MESSAGE_CREATION_COMMIT_SCHEMA_ID,
    schemaVersion: INBOX_V2_TIMELINE_MESSAGE_COMMIT_SCHEMA_VERSION,
    payload: prepared.commit
  });
  return {
    ...sealed,
    receipt: issueInboxV2AtomicMaterializationSealReceipt(
      context.atomicMaterializationToken,
      {
        kind: "message_creation",
        tenantId: prepared.commit.tenantId,
        messageId: prepared.commit.message.id,
        messageRevision: prepared.commit.message.revision,
        conversationId: prepared.commit.message.conversation.id,
        timelineSequence: sealed.timelineItem.timelineSequence,
        audience: inboxV2AtomicMessageAudience(sealed.timelineItem.visibility),
        stateSchemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
        stateSchemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
        stateHash: messagePayloadReference.digest,
        payloadReference: messagePayloadReference,
        domainCommitReference,
        event: {
          typeId: "core:message.changed",
          payloadSchemaId: INBOX_V2_MESSAGE_CREATION_COMMIT_SCHEMA_ID,
          payloadSchemaVersion: INBOX_V2_TIMELINE_MESSAGE_COMMIT_SCHEMA_VERSION,
          payloadReference: domainCommitReference,
          occurredAt: prepared.commit.initialRevision.occurredAt,
          recordedAt: prepared.commit.initialRevision.recordedAt
        },
        outboundDispatch: inboxV2AtomicOutboundDispatchSealManifest(
          prepared.commit
        ),
        outboundReroute: inboxV2AtomicOutboundRerouteSealManifest(
          prepared.commit,
          outboundReroute
        ),
        sourceOccurrence: inboxV2AtomicSourceOccurrenceSealManifest(
          prepared.commit
        )
      }
    )
  };
}

function inboxV2AtomicOutboundRerouteExpectationFromCommit(
  commit: InboxV2MessageCreationCommit
) {
  const route = commit.outboundRoute;
  const dispatch = commit.outboundDispatch;
  if (route?.selection.intent.kind !== "explicit_reroute") return null;
  if (dispatch === null) {
    throw invariantError(
      "Inbox V2 explicit reroute Message seal requires its replacement dispatch."
    );
  }
  const intent = route.selection.intent;
  return {
    tenantId: commit.tenantId,
    originalRouteId: intent.originalRoute.id,
    originalDispatchId: intent.originalDispatch.id,
    expectedOriginalDispatchRevision: intent.expectedOriginalDispatchRevision,
    replacementMessageId: commit.message.id,
    replacementRouteId: route.id,
    replacementDispatchId: dispatch.id,
    reasonId: intent.reasonId
  };
}

function inboxV2AtomicOutboundRerouteSealManifest(
  commit: InboxV2MessageCreationCommit,
  reroute: InboxV2OutboundDispatchRerouteCommit | null
) {
  const route = commit.outboundRoute;
  const dispatch = commit.outboundDispatch;
  if (reroute === null) {
    if (route?.selection.intent.kind === "explicit_reroute") {
      throw invariantError(
        "Inbox V2 explicit reroute Message seal requires its live reroute proof."
      );
    }
    return null;
  }
  if (
    route?.selection.intent.kind !== "explicit_reroute" ||
    dispatch === null
  ) {
    throw invariantError(
      "Inbox V2 normal Message seal cannot carry an outbound reroute proof."
    );
  }
  const originalPayloadReference = inboxV2AtomicPayloadReference({
    tenantId: commit.tenantId,
    recordId: reroute.original.dispatchAfter.id,
    schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
    schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    payload: reroute.original.dispatchAfter
  });
  const domainCommitReference = inboxV2AtomicPayloadReference({
    tenantId: commit.tenantId,
    recordId: reroute.original.dispatchAfter.id,
    schemaId: INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
    schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
    payload: reroute
  });
  return {
    originalRouteId: reroute.original.dispatchBefore.route.id,
    expectedOriginalDispatchRevision: reroute.original.dispatchBefore.revision,
    originalDispatch: {
      dispatchId: reroute.original.dispatchAfter.id,
      resultingRevision: reroute.original.dispatchAfter.revision,
      stateSchemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
      stateSchemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
      stateHash: originalPayloadReference.digest,
      payloadReference: originalPayloadReference
    },
    originalOutboxIntentId: reroute.original.outboxIntentId,
    replacement: {
      messageId: reroute.replacement.message.id,
      routeId: reroute.replacement.route.id,
      dispatchId: reroute.replacement.dispatch.id,
      outboxIntentId: reroute.replacement.outboxIntentId
    },
    reasonId: reroute.reasonId,
    changedAt: reroute.changedAt,
    domainCommitReference,
    event: {
      typeId: "core:outbound-dispatch.changed",
      payloadSchemaId: INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
      payloadSchemaVersion:
        INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
      payloadReference: domainCommitReference,
      occurredAt: reroute.changedAt,
      recordedAt: commit.timelineAllocation.committedAt
    }
  };
}

function inboxV2AtomicPayloadReference(
  input: Readonly<{
    tenantId: string;
    recordId: string;
    schemaId: string;
    schemaVersion: string;
    payload: unknown;
  }>
) {
  return inboxV2PayloadReferenceSchema.parse({
    tenantId: input.tenantId,
    recordId: input.recordId,
    schemaId: input.schemaId,
    schemaVersion: input.schemaVersion,
    digest:
      `sha256:${computeInboxV2TimelineMessageCommitDigest(input.payload)}` as const
  });
}

function inboxV2AtomicOutboundDispatchSealManifest(
  commit: InboxV2MessageCreationCommit
) {
  const dispatch = commit.outboundDispatch;
  if (dispatch === null) return null;
  const payloadReference = inboxV2AtomicPayloadReference({
    tenantId: commit.tenantId,
    recordId: dispatch.id,
    schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
    schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    payload: dispatch
  });
  return {
    dispatchId: dispatch.id,
    resultingRevision: dispatch.revision,
    stateSchemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
    stateSchemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    stateHash: payloadReference.digest,
    payloadReference
  };
}

function inboxV2AtomicSourceOccurrenceSealManifest(
  commit: InboxV2MessageCreationCommit
) {
  const resolution = commit.sourceResolutionCommit;
  if (resolution === null) return null;
  const transitionId =
    deriveInboxV2SourceOccurrenceResolutionTransitionId(resolution);
  const payloadReference = inboxV2AtomicPayloadReference({
    tenantId: commit.tenantId,
    recordId: resolution.after.id,
    schemaId: INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID,
    schemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
    payload: resolution.after
  });
  const domainCommitReference = inboxV2AtomicPayloadReference({
    tenantId: commit.tenantId,
    recordId: transitionId,
    schemaId: INBOX_V2_SOURCE_OCCURRENCE_RESOLUTION_COMMIT_SCHEMA_ID,
    schemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
    payload: resolution
  });
  return {
    sourceOccurrenceId: resolution.after.id,
    resultingRevision: resolution.resultingRevision,
    audience: "policy_filtered" as const,
    stateSchemaId: INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID,
    stateSchemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
    stateHash: payloadReference.digest,
    payloadReference,
    domainCommitReference,
    event: {
      typeId: "core:source-occurrence.changed",
      payloadSchemaId: INBOX_V2_SOURCE_OCCURRENCE_RESOLUTION_COMMIT_SCHEMA_ID,
      payloadSchemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
      payloadReference: domainCommitReference,
      occurredAt: resolution.changedAt,
      recordedAt: commit.timelineAllocation.committedAt
    }
  };
}

function inboxV2AtomicMessageAudience(
  visibility: InboxV2TimelineItem["visibility"]
): "internal_participants" | "conversation_external" {
  if (
    visibility === "internal_participants" ||
    visibility === "conversation_external"
  ) {
    return visibility;
  }
  throw invariantError(
    "Inbox V2 Message TimelineItem has no supported tenant-stream audience."
  );
}

function inboxV2AtomicOutboundRouteProofFromCommit(
  commit: InboxV2MessageCreationCommit
) {
  if (commit.message.origin.kind !== "hulee_external") return null;
  const route = commit.outboundRoute;
  if (route === null) {
    throw invariantError("External Message creation has no OutboundRoute.");
  }
  return {
    tenantId: commit.tenantId,
    routeId: route.id,
    conversationId: route.conversation.id,
    sourceAccountId: route.sourceAccount.id,
    routePolicyId: route.routePolicy.id,
    routePolicyRevision: route.routePolicyRevision,
    routeDigest: computeInboxV2OutboundRouteDigest(route)
  };
}

export function assertInboxV2MessageCreationAuthority(
  context: Readonly<{
    tenantId: string;
    commandTypeId: string;
    actor: InboxV2AuthorizedCommandMutationContext["actor"];
    authorizationEpoch: string;
    authorizationDecisionId: string;
    authorizationDecisionRefs: readonly InboxV2AuthorizationDecisionReference[];
    authorizationResourceRevisionFences: InboxV2AuthorizedCommandMutationContext["authorizationResourceRevisionFences"];
    occurredAt: string;
  }>,
  commit: InboxV2MessageCreationCommit
): void {
  if (commit.timelineAllocation.committedAt !== context.occurredAt) {
    throw invariantError(
      "Inbox V2 Message commit time must match the authorized command time."
    );
  }
  if (
    commit.message.origin.kind === "hulee_external" &&
    context.commandTypeId === "core:source.dispatch.reroute"
  ) {
    assertInboxV2ExternalRerouteMessageCreationAuthority(context, commit);
    assertInboxV2MessageAppActorMatchesContext(context, commit);
    return;
  }
  const requiredAuthority = (() => {
    switch (commit.message.origin.kind) {
      case "source_originated":
        return {
          commandTypeId: "core:message.receive",
          permissionId: "core:message.receive_external"
        } as const;
      case "hulee_external":
        return {
          commandTypeId: "core:message.send",
          permissionId: "core:message.reply_external"
        } as const;
      case "internal":
        return {
          commandTypeId: "core:message.send",
          permissionId: "core:message.send_internal"
        } as const;
      case "migration":
        throw invariantError(
          "Inbox V2 migration Message creation requires a dedicated authorized command contract."
        );
    }
  })();
  if (context.commandTypeId !== requiredAuthority.commandTypeId) {
    throw invariantError(
      "Inbox V2 Message origin does not match the authorized command type."
    );
  }

  const matchingDecisions = context.authorizationDecisionRefs.filter(
    (candidate) => candidate.id === context.authorizationDecisionId
  );
  const decision = matchingDecisions[0];
  const decisionPrincipalMatchesActor =
    decision !== undefined &&
    messageAuthorizationDecisionPrincipalMatchesActor(decision, context.actor);
  if (
    matchingDecisions.length !== 1 ||
    decision === undefined ||
    decision.tenantId !== context.tenantId ||
    decision.authorizationEpoch !== context.authorizationEpoch ||
    decision.permissionId !== requiredAuthority.permissionId ||
    decision.resourceScopeId !== "core:conversation" ||
    decision.outcome !== "allowed" ||
    decision.resource.tenantId !== context.tenantId ||
    decision.resource.entityTypeId !== "core:conversation" ||
    String(decision.resource.entityId) !==
      String(commit.message.conversation.id) ||
    !decisionPrincipalMatchesActor
  ) {
    throw invariantError(
      "Inbox V2 Message creation requires the exact allowed Conversation authorization decision."
    );
  }
  const matchingConversationFences =
    context.authorizationResourceRevisionFences.filter(
      (fence) =>
        fence.resourceKind === "conversation" &&
        String(fence.resourceId) === String(commit.message.conversation.id) &&
        String(fence.expectedResourceAccessRevision) ===
          String(decision.resourceAccessRevision) &&
        fence.advance === "none"
    );
  if (matchingConversationFences.length !== 1) {
    throw invariantError(
      "Inbox V2 Message creation requires the exact allowed Conversation authorization decision and resource revision fence."
    );
  }

  if (commit.message.origin.kind === "source_originated") return;
  if (commit.message.origin.kind === "hulee_external") {
    assertInboxV2ExternalMessageSourceAccountAuthority(
      context,
      commit,
      decision
    );
  }
  assertInboxV2MessageAppActorMatchesContext(context, commit);
}

function assertInboxV2ExternalRerouteMessageCreationAuthority(
  context: Parameters<typeof assertInboxV2MessageCreationAuthority>[0],
  commit: InboxV2MessageCreationCommit
): void {
  const route = commit.outboundRoute;
  if (route?.selection.intent.kind !== "explicit_reroute") {
    throw invariantError(
      "Inbox V2 explicit reroute Message creation requires an explicitly rerouted OutboundRoute."
    );
  }
  const primaryDecisions = context.authorizationDecisionRefs.filter(
    (candidate) => candidate.id === context.authorizationDecisionId
  );
  const primaryDecision = primaryDecisions[0];
  if (
    primaryDecisions.length !== 1 ||
    primaryDecision === undefined ||
    primaryDecision.tenantId !== context.tenantId ||
    primaryDecision.authorizationEpoch !== context.authorizationEpoch ||
    primaryDecision.permissionId !== "core:source.dispatch.reroute" ||
    primaryDecision.resourceScopeId !== "core:source-account" ||
    primaryDecision.outcome !== "allowed" ||
    primaryDecision.resource.tenantId !== context.tenantId ||
    primaryDecision.resource.entityTypeId !== "core:source-account" ||
    !messageAuthorizationDecisionPrincipalMatchesActor(
      primaryDecision,
      context.actor
    )
  ) {
    throw invariantError(
      "Inbox V2 explicit reroute Message creation requires the exact allowed reroute authorization decision."
    );
  }

  const conversationDecisions = context.authorizationDecisionRefs.filter(
    (candidate) =>
      candidate.tenantId === context.tenantId &&
      candidate.authorizationEpoch === context.authorizationEpoch &&
      candidate.permissionId === "core:message.reply_external" &&
      candidate.resourceScopeId === "core:conversation" &&
      candidate.outcome === "allowed" &&
      candidate.resource.tenantId === context.tenantId &&
      candidate.resource.entityTypeId === "core:conversation" &&
      String(candidate.resource.entityId) ===
        String(commit.message.conversation.id) &&
      messageAuthorizationDecisionPrincipalMatchesActor(
        candidate,
        context.actor
      )
  );
  const conversationDecision = conversationDecisions[0];
  const matchingConversationFences =
    conversationDecision === undefined
      ? []
      : context.authorizationResourceRevisionFences.filter(
          (fence) =>
            fence.resourceKind === "conversation" &&
            String(fence.resourceId) ===
              String(commit.message.conversation.id) &&
            String(fence.expectedResourceAccessRevision) ===
              String(conversationDecision.resourceAccessRevision) &&
            fence.advance === "none"
        );
  if (
    conversationDecisions.length !== 1 ||
    conversationDecision === undefined ||
    matchingConversationFences.length !== 1 ||
    !messageRouteAuthorizationSnapshotMatchesDecision(
      route.conversationAuthorization,
      conversationDecision,
      route,
      "conversation"
    )
  ) {
    throw invariantError(
      "Inbox V2 explicit reroute Message creation requires the exact allowed Conversation reply authorization decision, resource revision fence and route snapshot."
    );
  }
  assertInboxV2ExternalMessageSourceAccountAuthority(
    context,
    commit,
    conversationDecision
  );
}

function assertInboxV2MessageAppActorMatchesContext(
  context: Parameters<typeof assertInboxV2MessageCreationAuthority>[0],
  commit: InboxV2MessageCreationCommit
): void {
  const appActor = commit.message.appActor;
  const exactActor =
    context.actor.kind === "employee"
      ? appActor?.kind === "employee" &&
        appActor.employee.id === context.actor.employeeId &&
        appActor.authorizationEpoch === context.authorizationEpoch
      : appActor?.kind === "trusted_service" &&
        appActor.trustedServiceId === context.actor.trustedServiceId;
  if (!exactActor) {
    throw invariantError(
      "Inbox V2 Message app actor must match the authenticated command actor."
    );
  }
}

function assertInboxV2ExternalMessageSourceAccountAuthority(
  context: Parameters<typeof assertInboxV2MessageCreationAuthority>[0],
  commit: InboxV2MessageCreationCommit,
  conversationDecision: InboxV2AuthorizationDecisionReference
): void {
  const route = commit.outboundRoute;
  if (route === null) throw externalMessageSourceAccountAuthorityError();
  const matchingDecisions = context.authorizationDecisionRefs.filter(
    (candidate) =>
      candidate.tenantId === context.tenantId &&
      candidate.authorizationEpoch === context.authorizationEpoch &&
      candidate.permissionId === "core:source_account.use" &&
      candidate.resourceScopeId === "core:source-account" &&
      candidate.outcome === "allowed" &&
      candidate.resource.tenantId === context.tenantId &&
      candidate.resource.entityTypeId === "core:source-account" &&
      String(candidate.resource.entityId) === String(route.sourceAccount.id) &&
      messageAuthorizationDecisionPrincipalMatchesActor(
        candidate,
        context.actor
      )
  );
  const decision = matchingDecisions[0];
  const matchingFences =
    decision === undefined
      ? []
      : context.authorizationResourceRevisionFences.filter(
          (fence) =>
            fence.resourceKind === "source_account" &&
            String(fence.resourceId) === String(route.sourceAccount.id) &&
            String(fence.expectedResourceAccessRevision) ===
              String(decision.resourceAccessRevision) &&
            fence.advance === "none"
        );
  const sourceAccountSnapshotMatches =
    decision !== undefined &&
    messageRouteAuthorizationSnapshotMatchesDecision(
      route.sourceAccountAuthorization,
      decision,
      route,
      "source_account"
    );
  const conversationSnapshotMatches =
    messageRouteAuthorizationSnapshotMatchesDecision(
      route.conversationAuthorization,
      conversationDecision,
      route,
      "conversation"
    );
  if (
    matchingDecisions.length !== 1 ||
    matchingFences.length !== 1 ||
    !sourceAccountSnapshotMatches ||
    !conversationSnapshotMatches
  ) {
    throw externalMessageSourceAccountAuthorityError();
  }
}

function messageRouteAuthorizationSnapshotMatchesDecision(
  snapshot:
    | NonNullable<
        InboxV2MessageCreationCommit["outboundRoute"]
      >["conversationAuthorization"]
    | NonNullable<
        InboxV2MessageCreationCommit["outboundRoute"]
      >["sourceAccountAuthorization"],
  decision: InboxV2AuthorizationDecisionReference,
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>,
  resourceKind: "conversation" | "source_account"
): boolean {
  const expectedEntityTypeId =
    resourceKind === "conversation"
      ? "core:conversation"
      : "core:source-account";
  const expectedResourceId =
    resourceKind === "conversation"
      ? route.conversation.id
      : route.sourceAccount.id;
  const expectedDecisionKind =
    resourceKind === "conversation"
      ? "conversation_action"
      : "source_account_use";
  return (
    snapshot.decisionKind === expectedDecisionKind &&
    snapshot.tenantId === decision.tenantId &&
    messageRouteAuthorizationPrincipalsMatch(
      snapshot.principal,
      decision.principal
    ) &&
    snapshot.effect === "allow" &&
    snapshot.requiredPermissionId === decision.permissionId &&
    snapshot.matchedPermissionIds.length === 1 &&
    snapshot.matchedPermissionIds[0] === decision.permissionId &&
    snapshot.decisionRevision === decision.decisionRevision &&
    snapshot.decidedAt === decision.decidedAt &&
    snapshot.notAfter === decision.notAfter &&
    decision.resource.tenantId === route.tenantId &&
    decision.resource.entityTypeId === expectedEntityTypeId &&
    String(decision.resource.entityId) === String(expectedResourceId) &&
    messageRouteAuthorizationTargetMatchesRoute(snapshot.target, route)
  );
}

function messageRouteAuthorizationTargetMatchesRoute(
  target: NonNullable<
    InboxV2MessageCreationCommit["outboundRoute"]
  >["conversationAuthorization"]["target"],
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>
): boolean {
  const expectedReferenceTarget =
    route.referenceContext.kind === "none"
      ? { kind: "none" as const }
      : {
          kind: "external_message" as const,
          externalMessageReference:
            route.referenceContext.externalMessageReference,
          sourceOccurrence: route.referenceContext.sourceOccurrence
        };
  return (
    target.authorizationEpoch === route.authorizationEpoch &&
    target.conversation.tenantId === route.tenantId &&
    String(target.conversation.id) === String(route.conversation.id) &&
    target.externalThread.tenantId === route.tenantId &&
    String(target.externalThread.id) === String(route.externalThread.id) &&
    target.sourceThreadBinding.tenantId === route.tenantId &&
    String(target.sourceThreadBinding.id) ===
      String(route.sourceThreadBinding.id) &&
    target.sourceAccount.tenantId === route.tenantId &&
    String(target.sourceAccount.id) === String(route.sourceAccount.id) &&
    target.sourceConnection.tenantId === route.tenantId &&
    String(target.sourceConnection.id) === String(route.sourceConnection.id) &&
    target.operationId === route.operationId &&
    target.contentKindId === route.contentKindId &&
    computeInboxV2TimelineMessageCommitDigest(target.bindingFence) ===
      computeInboxV2TimelineMessageCommitDigest(route.bindingFence) &&
    computeInboxV2TimelineMessageCommitDigest(target.referenceTarget) ===
      computeInboxV2TimelineMessageCommitDigest(expectedReferenceTarget)
  );
}

function messageAuthorizationDecisionPrincipalMatchesActor(
  decision: InboxV2AuthorizationDecisionReference,
  actor: InboxV2AuthorizedCommandMutationContext["actor"]
): boolean {
  return actor.kind === "employee"
    ? decision.principal.kind === "employee" &&
        decision.principal.employee.id === actor.employeeId
    : decision.principal.kind === "trusted_service" &&
        decision.principal.trustedServiceId === actor.trustedServiceId;
}

function messageRouteAuthorizationPrincipalsMatch(
  routePrincipal: NonNullable<
    InboxV2MessageCreationCommit["outboundRoute"]
  >["sourceAccountAuthorization"]["principal"],
  decisionPrincipal: InboxV2AuthorizationDecisionReference["principal"]
): boolean {
  if (routePrincipal.kind !== decisionPrincipal.kind) return false;
  return routePrincipal.kind === "employee" &&
    decisionPrincipal.kind === "employee"
    ? routePrincipal.employee.tenantId ===
        decisionPrincipal.employee.tenantId &&
        routePrincipal.employee.id === decisionPrincipal.employee.id
    : routePrincipal.kind === "trusted_service" &&
        decisionPrincipal.kind === "trusted_service" &&
        routePrincipal.trustedServiceId === decisionPrincipal.trustedServiceId;
}

function externalMessageSourceAccountAuthorityError(): Error {
  return invariantError(
    "Inbox V2 external Message creation requires the exact allowed SourceAccount authorization decision and resource revision fence."
  );
}

export const INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID =
  "core:attachment.materialization.complete" as const;

function assertInboxV2AttachmentMaterializationMessageMutationAuthority(
  context: Readonly<{
    tenantId: string;
    commandTypeId: string;
    actor: InboxV2AuthorizedCommandMutationContext["actor"];
    authorizationEpoch: string;
    authorizationDecisionId: string;
    authorizationDecisionRefs: readonly InboxV2AuthorizationDecisionReference[];
    authorizationResourceRevisionFences: InboxV2AuthorizedCommandMutationContext["authorizationResourceRevisionFences"];
    occurredAt: string;
  }>,
  commit: InboxV2MessageMutationCommit
): void {
  const transition = commit.contentTransition;
  const attribution = commit.revision.actionAttribution;
  const actor = attribution.appActor;
  const causation = attribution.automationCausation;
  if (context.actor.kind !== "trusted_service") {
    throw invariantError(
      "Attachment materialization completion requires a trusted-service actor."
    );
  }
  const authorizedTrustedServiceId = context.actor.trustedServiceId;
  if (
    context.commandTypeId !==
      INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID ||
    actor?.kind !== "trusted_service" ||
    actor.trustedServiceId !== authorizedTrustedServiceId ||
    commit.tenantId !== context.tenantId ||
    transition === null ||
    transition.transition.kind !== "attachment_materialization" ||
    commit.revision.change.kind !== "attachment_materialized" ||
    commit.providerOperation !== null ||
    commit.providerOperationCreationCommit !== null ||
    attribution.actionParticipant !== null ||
    attribution.sourceOccurrence !== null ||
    causation === null ||
    causation.kind !== "system_event" ||
    causation.causeEvent.tenantId !== context.tenantId ||
    commit.revision.occurredAt !== context.occurredAt ||
    commit.revision.recordedAt !== context.occurredAt ||
    transition.transition.occurredAt !== context.occurredAt ||
    transition.transition.event.tenantId !== context.tenantId
  ) {
    throw invariantError(
      "Attachment materialization requires one exact trusted-service command, system-event causation and authorized command timestamp."
    );
  }

  const conversationId = commit.beforeMessage.conversation.id;
  const requiredReadPermissionId =
    commit.beforeTimelineItem.visibility === "conversation_external"
      ? "core:conversation.read"
      : commit.beforeTimelineItem.visibility === "internal_participants"
        ? "core:conversation.internal.read"
        : null;
  if (requiredReadPermissionId === null) {
    throw invariantError(
      "Attachment materialization is closed to staff-note and non-Message visibility until its dedicated authority contract exists."
    );
  }
  const requiredPermissionIds = new Set([
    "core:file.upload",
    requiredReadPermissionId
  ]);
  const decisions = context.authorizationDecisionRefs.filter(
    (candidate) =>
      candidate.tenantId === context.tenantId &&
      candidate.authorizationEpoch === context.authorizationEpoch &&
      requiredPermissionIds.has(candidate.permissionId) &&
      candidate.resourceScopeId === "core:conversation" &&
      candidate.outcome === "allowed" &&
      candidate.resource.tenantId === context.tenantId &&
      candidate.resource.entityTypeId === "core:conversation" &&
      String(candidate.resource.entityId) === String(conversationId) &&
      candidate.principal.kind === "trusted_service" &&
      candidate.principal.trustedServiceId === authorizedTrustedServiceId
  );
  const primaryDecision = context.authorizationDecisionRefs.find(
    (candidate) => candidate.id === context.authorizationDecisionId
  );
  if (
    context.authorizationDecisionRefs.length !== requiredPermissionIds.size ||
    decisions.length !== requiredPermissionIds.size ||
    new Set(decisions.map(({ permissionId }) => permissionId)).size !==
      requiredPermissionIds.size ||
    primaryDecision === undefined ||
    primaryDecision.permissionId !== "core:file.upload" ||
    !decisions.some(({ id }) => id === primaryDecision.id)
  ) {
    throw invariantError(
      "Attachment materialization requires the exact file-upload and current Conversation-visibility decisions."
    );
  }
  const fileUploadDecision = decisions.find(
    ({ permissionId }) => permissionId === "core:file.upload"
  );
  const readDecision = decisions.find(
    ({ permissionId }) => permissionId === requiredReadPermissionId
  );
  const fences = context.authorizationResourceRevisionFences.filter(
    (fence) =>
      fence.resourceKind === "conversation" &&
      String(fence.resourceId) === String(conversationId) &&
      fileUploadDecision !== undefined &&
      readDecision !== undefined &&
      String(fence.expectedResourceAccessRevision) ===
        String(fileUploadDecision.resourceAccessRevision) &&
      String(fence.expectedResourceAccessRevision) ===
        String(readDecision.resourceAccessRevision) &&
      fence.advance === "none"
  );
  if (
    context.authorizationResourceRevisionFences.length !== 1 ||
    fences.length !== 1
  ) {
    throw invariantError(
      "Attachment materialization requires the exact Conversation authorization revision fence."
    );
  }
}

export async function prepareInboxV2AttachmentMaterializationMessageMutation(
  context: InboxV2AuthorizedCommandMutationContext,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    messageId: InboxV2MessageId;
    plan: (
      current: InboxV2MessageMutationPlanCurrent
    ) => InboxV2MessageMutationCommit;
  }>
): Promise<PrepareInboxV2AttachmentMaterializationMessageMutationResult> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  const { atomicMaterializationToken } = context;
  if (atomicMaterializationToken === undefined) {
    throw invariantError(
      "Attachment materialization requires the coordinator-owned atomic prepare token."
    );
  }
  const sealExecutor = requireInboxV2AtomicSealExecutor(context);
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const conversationId = inboxV2ConversationIdSchema.parse(
    input.conversationId
  );
  const messageId = inboxV2MessageIdSchema.parse(input.messageId);
  const prepared = await prepareMessageMutationInTransaction(context.executor, {
    tenantId,
    conversationId,
    messageId,
    plan: input.plan
  });
  if (prepared.kind !== "ready") return prepared;
  if (
    prepared.commit.revision.change.kind !== "attachment_materialized" ||
    prepared.commit.contentTransition?.transition.kind !==
      "attachment_materialization" ||
    prepared.commit.providerOperation !== null ||
    prepared.commit.providerOperationCreationCommit !== null
  ) {
    throw invariantError(
      "Prepared attachment materialization must be one trusted local Message content transition."
    );
  }
  assertInboxV2AttachmentMaterializationMessageMutationAuthority(
    context,
    prepared.commit
  );
  const capability = Object.freeze({
    [inboxV2PreparedAttachmentMaterializationMessageMutationCapabilityBrand]:
      true as const
  });
  preparedInboxV2AttachmentMaterializationMessageMutations.set(capability, {
    atomicMaterializationToken,
    sealExecutor,
    commit: prepared.commit,
    current: prepared.current,
    consumed: false
  });
  return { kind: "ready", capability, commit: prepared.commit };
}

export async function sealInboxV2PreparedAttachmentMaterializationMessageMutation(
  context: InboxV2AuthorizedAtomicMaterializationContext,
  input: Readonly<{
    capability: InboxV2PreparedAttachmentMaterializationMessageMutationCapability;
  }>
): Promise<
  Extract<
    PersistInboxV2MessageMutationResult<undefined>,
    Readonly<{ kind: "applied" }>
  > &
    Readonly<{ receipt: InboxV2AtomicMaterializationSealReceipt }>
> {
  assertInboxV2AuthorizedAtomicMaterializationContext(context);
  const prepared = preparedInboxV2AttachmentMaterializationMessageMutations.get(
    input.capability
  );
  if (prepared === undefined) {
    throw invariantError(
      "Attachment materialization capability was not issued by this repository."
    );
  }
  if (prepared.consumed) {
    throw invariantError(
      "Attachment materialization capability was already consumed."
    );
  }
  if (
    prepared.atomicMaterializationToken !== context.atomicMaterializationToken
  ) {
    throw invariantError(
      "Attachment materialization capability belongs to a different live authorized mutation."
    );
  }
  assertInboxV2AttachmentMaterializationMessageMutationAuthority(
    context,
    prepared.commit
  );
  prepared.consumed = true;
  const result = await applyPreparedMessageMutationWrites(
    prepared.sealExecutor,
    prepared.current,
    prepared.commit,
    inboxV2BigintCounterSchema.parse(context.streamPosition),
    async () => undefined
  );
  if (result.kind !== "applied") {
    throw invariantError(
      "Prepared attachment materialization produced a non-write-only Message result."
    );
  }
  const messagePayloadReference = inboxV2AtomicPayloadReference({
    tenantId: prepared.commit.tenantId,
    recordId: prepared.commit.afterMessage.id,
    schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
    payload: prepared.commit.afterMessage
  });
  const domainCommitReference = inboxV2AtomicPayloadReference({
    tenantId: prepared.commit.tenantId,
    recordId: prepared.commit.revision.id,
    schemaId: INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
    payload: prepared.commit.revision
  });
  const causation =
    prepared.commit.revision.actionAttribution.automationCausation;
  const actor = prepared.commit.revision.actionAttribution.appActor;
  const contentTransition = prepared.commit.contentTransition;
  const materialization = consumeInboxV2AtomicAttachmentMaterializationProof(
    context.atomicMaterializationToken
  );
  assertInboxV2AttachmentMaterializationProofMatchesCommit(
    materialization,
    prepared.commit
  );
  if (
    actor?.kind !== "trusted_service" ||
    contentTransition === null ||
    causation === null ||
    causation.kind !== "system_event"
  ) {
    throw invariantError(
      "Attachment materialization seal requires trusted-service system-event causation."
    );
  }
  return {
    ...result,
    receipt: issueInboxV2AtomicMaterializationSealReceipt(
      context.atomicMaterializationToken,
      {
        kind: "message_mutation",
        tenantId: prepared.commit.tenantId,
        messageId: prepared.commit.afterMessage.id,
        messageRevision: prepared.commit.afterMessage.revision,
        conversationId: prepared.commit.afterMessage.conversation.id,
        timelineSequence: prepared.commit.afterTimelineItem.timelineSequence,
        timelineItemId: prepared.commit.afterTimelineItem.id,
        timelineItemRevision: prepared.commit.afterTimelineItem.revision,
        contentId: contentTransition.after.id,
        contentRevision: contentTransition.after.revision,
        audience: inboxV2AtomicMessageAudience(
          prepared.commit.afterTimelineItem.visibility
        ),
        stateSchemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
        stateSchemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
        stateHash: messagePayloadReference.digest,
        payloadReference: messagePayloadReference,
        domainCommitReference,
        auditTarget: deriveInboxV2AttachmentMaterializationAuditReference({
          tenantId: prepared.commit.tenantId,
          entityTypeId: "core:message",
          referenceDomain: "message",
          entityId: prepared.commit.afterMessage.id
        }),
        auditFacetReference:
          deriveInboxV2AttachmentMaterializationAuditReference({
            tenantId: prepared.commit.tenantId,
            entityTypeId: "core:conversation",
            referenceDomain: "conversation",
            entityId: prepared.commit.afterMessage.conversation.id
          }),
        trustedServiceId: actor.trustedServiceId,
        causeEventId: causation.causeEvent.id,
        correlationId: causation.correlationId,
        causedAt: causation.causedAt,
        materialization,
        event: {
          typeId: "core:message.changed",
          payloadSchemaId: INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
          payloadSchemaVersion: INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
          payloadReference: domainCommitReference,
          occurredAt: prepared.commit.revision.occurredAt,
          recordedAt: prepared.commit.revision.recordedAt
        }
      }
    )
  };
}

function assertInboxV2AttachmentMaterializationProofMatchesCommit(
  proof: InboxV2AtomicAttachmentMaterializationProof,
  commit: InboxV2MessageMutationCommit
): void {
  const transition = commit.contentTransition;
  const actor = commit.revision.actionAttribution.appActor;
  const causation = commit.revision.actionAttribution.automationCausation;
  if (
    transition === null ||
    transition.after.state.kind !== "available" ||
    actor?.kind !== "trusted_service" ||
    causation === null ||
    causation.kind !== "system_event"
  ) {
    throw invariantError(
      "Attachment materialization proof requires available terminal Message content."
    );
  }
  const matchingBlocks = transition.after.state.blocks.filter(
    (block) =>
      block.blockKey === proof.contentBlockKey &&
      "attachment" in block &&
      block.attachment.attachment.id === proof.attachmentId
  );
  const block = matchingBlocks[0];
  const sharedMatches =
    proof.tenantId === commit.tenantId &&
    proof.completedByTrustedServiceId === actor.trustedServiceId &&
    proof.causeEventId === causation.causeEvent.id &&
    proof.correlationId === causation.correlationId &&
    proof.causedAt === causation.causedAt &&
    proof.conversationId === commit.afterMessage.conversation.id &&
    proof.timelineItemId === commit.afterTimelineItem.id &&
    proof.contentId === transition.after.id &&
    proof.resultingContentRevision === transition.after.revision &&
    proof.parentKind === "message" &&
    proof.parentEntityId === commit.afterMessage.id &&
    proof.parentEntityRevision === commit.afterMessage.revision &&
    matchingBlocks.length === 1 &&
    block !== undefined &&
    "attachment" in block;
  if (!sharedMatches || block === undefined || !("attachment" in block)) {
    throw invariantError(
      "File/Object materialization proof does not match the exact Message content transition."
    );
  }
  const attachment = block.attachment;
  const outcomeMatches =
    proof.outcome === "ready"
      ? attachment.state === "ready" &&
        attachment.file.id === proof.fileId &&
        attachment.fileRevision === proof.resultingFileRevision &&
        proof.fileVersionId !== null &&
        attachment.fileVersion.id === proof.fileVersionId &&
        proof.objectVersionId !== null &&
        attachment.objectVersion.id === proof.objectVersionId &&
        proof.safeReasonId === null
      : attachment.state === "failed" &&
        attachment.reasonId === proof.safeReasonId &&
        proof.fileVersionId === null &&
        proof.objectVersionId === null;
  if (!outcomeMatches) {
    throw invariantError(
      "File/Object materialization outcome does not match the exact terminal attachment block."
    );
  }
}

async function persistMessageMutation<TResult>(
  transactionExecutor: InboxV2TimelineMessageTransactionExecutor,
  input: NormalizedMessageMutationInput,
  persist: (context: {
    executor: RawSqlExecutor;
    message: InboxV2Message;
    timelineItem: InboxV2TimelineItem;
    envelope: InboxV2SafeGenericEnvelope;
  }) => Promise<TResult>,
  retrySafe: boolean
): Promise<PersistInboxV2MessageMutationResult<TResult>> {
  const { commit, streamPosition } = input;
  return runTimelineMessageTransaction(
    transactionExecutor,
    async (transaction) => {
      const prepared = await prepareMessageMutationInTransaction(transaction, {
        tenantId: commit.tenantId,
        conversationId: commit.beforeMessage.conversation.id,
        messageId: commit.beforeMessage.id,
        plan: () => commit
      });
      if (prepared.kind === "already_applied") {
        return {
          kind: "already_applied",
          message: prepared.message,
          timelineItem: prepared.timelineItem,
          envelope: messageEnvelope({
            message: prepared.message,
            timelineItem: prepared.timelineItem,
            streamPosition: prepared.streamPosition,
            changeKind: prepared.commit.revision.change.kind,
            occurredAt: prepared.commit.revision.occurredAt
          })
        } as const;
      }
      if (prepared.kind !== "ready") return prepared;
      return applyPreparedMessageMutationWrites(
        transaction,
        prepared.current,
        prepared.commit,
        streamPosition,
        persist
      );
    },
    retrySafe ? TRANSACTION_ATTEMPTS : 1
  );
}

async function prepareMessageMutationInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    messageId: InboxV2MessageId;
    plan: (
      current: InboxV2MessageMutationPlanCurrent
    ) => InboxV2MessageMutationCommit;
  }>
) {
  const conversationLock = await transaction.execute<ConversationHeadRow>(
    buildLockInboxV2TimelineConversationHeadSql({
      tenantId: input.tenantId,
      conversationId: input.conversationId
    })
  );
  assertAtMostOneRow(conversationLock, "Message mutation Conversation lock");
  if (conversationLock.rows.length === 0) {
    return { kind: "message_not_found" } as const;
  }
  const current = await loadTimelineMessageAggregate(transaction, {
    tenantId: input.tenantId,
    messageId: input.messageId,
    lock: true
  });
  if (current === null) return { kind: "message_not_found" } as const;
  const commit = inboxV2MessageMutationCommitSchema.parse(input.plan(current));
  if (
    commit.tenantId !== input.tenantId ||
    commit.beforeMessage.id !== input.messageId ||
    commit.beforeMessage.conversation.id !== input.conversationId
  ) {
    throw invariantError(
      "Message mutation plan crossed its prepared tenant, Conversation or Message boundary."
    );
  }
  const replay = await inspectMessageRevisionReplay(
    transaction,
    commit.revision
  );
  if (replay.kind === "exact") {
    return sameValue(current.message, commit.afterMessage) &&
      sameValue(current.timelineItem, commit.afterTimelineItem) &&
      (commit.contentTransition === null ||
        sameValue(current.content, commit.contentTransition.after))
      ? ({
          kind: "already_applied",
          commit,
          message: current.message,
          timelineItem: current.timelineItem,
          streamPosition: replay.streamPosition
        } as const)
      : ({
          kind: "conflict",
          code: "message.state_conflict",
          current: current.message
        } as const);
  }
  if (replay.kind === "conflict") {
    return {
      kind: "conflict",
      code: "message.state_conflict",
      current: current.message
    } as const;
  }
  if (
    !sameValue(current.message, commit.beforeMessage) ||
    !sameValue(current.timelineItem, commit.beforeTimelineItem) ||
    (commit.contentTransition !== null &&
      !sameValue(current.content, commit.contentTransition.before))
  ) {
    return {
      kind: "conflict",
      code:
        current.message.revision === commit.beforeMessage.revision
          ? "message.state_conflict"
          : "revision.conflict",
      current: current.message
    } as const;
  }
  const newAttachmentIds = deriveNewMessageAttachmentAnchorBlocks(commit).map(
    ({ attachmentId }) => attachmentId
  );
  if (
    newAttachmentIds.length > 0 &&
    (
      await transaction.execute<Record<string, unknown>>(
        buildFindInboxV2ClaimedMessageAttachmentAnchorsSql({
          tenantId: commit.tenantId,
          attachmentIds: newAttachmentIds
        })
      )
    ).rows.length > 0
  ) {
    return {
      kind: "conflict",
      code: "message.state_conflict",
      current: current.message
    } as const;
  }
  return { kind: "ready", commit, current } as const;
}

async function applyPreparedMessageMutationWrites<TResult>(
  transaction: RawSqlExecutor,
  current: LoadedTimelineMessageAggregate,
  commit: InboxV2MessageMutationCommit,
  streamPosition: InboxV2BigintCounter,
  persist: (context: {
    executor: RawSqlExecutor;
    message: InboxV2Message;
    timelineItem: InboxV2TimelineItem;
    envelope: InboxV2SafeGenericEnvelope;
  }) => Promise<TResult>
): Promise<PersistInboxV2MessageMutationResult<TResult>> {
  const envelope = messageEnvelope({
    message: commit.afterMessage,
    timelineItem: commit.afterTimelineItem,
    streamPosition,
    changeKind: commit.revision.change.kind,
    occurredAt: commit.revision.occurredAt
  });
  const attributionId = derivedInboxV2Id(
    "action_attribution",
    commit.revision.id
  );
  await expectOneRow(
    transaction,
    buildInsertInboxV2ActionAttributionSql({
      tenantId: commit.tenantId,
      id: attributionId,
      conversationId: commit.beforeMessage.conversation.id,
      attribution: commit.revision.actionAttribution,
      createdAt: commit.revision.recordedAt
    }),
    "Message mutation attribution insert"
  );

  if (
    commit.providerOperationCreationCommit !== null &&
    commit.providerOperation !== null
  ) {
    const operationPersistence =
      await persistProviderLifecycleCreationInTransaction(transaction, {
        commit: commit.providerOperationCreationCommit,
        streamPosition
      });
    if (operationPersistence.kind === "conflict") {
      return {
        kind: "conflict",
        code: "message.state_conflict",
        current: current.message
      } as const;
    }
  }

  if (commit.contentTransition !== null) {
    const transition = commit.contentTransition;
    await expectOneRow(
      transaction,
      buildInsertInboxV2TimelineContentRevisionSql({
        tenantId: commit.tenantId,
        content: transition.after,
        transitionKind: transition.transition.kind,
        expectedPreviousRevision: transition.transition.expectedRevision,
        eventId: transition.transition.event.id,
        occurredAt: transition.transition.occurredAt,
        recordedAt: commit.revision.recordedAt,
        streamPosition
      }),
      "Message content revision append"
    );
    if (transition.after.state.kind === "available") {
      if (transition.transition.kind === "edit") {
        await persistNewMessageAttachmentAnchors(transaction, {
          tenantId: commit.tenantId,
          messageId: commit.afterMessage.id,
          timelineItemId: commit.afterTimelineItem.id,
          timelineContentId: transition.after.id,
          blocks: deriveNewMessageAttachmentAnchorBlocks(commit),
          createdAt: transition.after.updatedAt
        });
      }
      await persistAvailableContentPayload(transaction, transition.after);
    } else {
      await transaction.execute(
        buildPurgeInboxV2TimelineContentPayloadSql({
          tenantId: commit.tenantId,
          contentId: transition.after.id
        })
      );
    }
    await expectOneRow(
      transaction,
      buildAdvanceInboxV2TimelineContentSql({
        before: transition.before,
        after: transition.after,
        streamPosition
      }),
      "Message content head CAS"
    );
  }

  await expectOneRow(
    transaction,
    buildAdvanceInboxV2MessageSql({
      before: commit.beforeMessage,
      after: commit.afterMessage,
      streamPosition
    }),
    "Message head CAS"
  );
  await expectOneRow(
    transaction,
    buildAdvanceInboxV2TimelineItemSql({
      before: commit.beforeTimelineItem,
      after: commit.afterTimelineItem,
      streamPosition
    }),
    "Message TimelineItem CAS"
  );
  await expectOneRow(
    transaction,
    buildInsertInboxV2MessageRevisionSql({
      revision: commit.revision,
      actionAttributionId: attributionId,
      streamPosition
    }),
    "Message revision append"
  );
  const result = await persist({
    executor: transaction,
    message: commit.afterMessage,
    timelineItem: commit.afterTimelineItem,
    envelope
  });
  return {
    kind: "applied",
    message: commit.afterMessage,
    timelineItem: commit.afterTimelineItem,
    envelope,
    result
  } as const;
}

async function persistTransportFact(
  transactionExecutor: InboxV2TimelineMessageTransactionExecutor,
  input: Readonly<{
    commit: InboxV2MessageTransportFactCommit;
    streamPosition: InboxV2BigintCounter;
  }>
): Promise<PersistInboxV2MessageAuxiliaryResult> {
  const { commit, streamPosition } = input;
  return runTimelineMessageTransaction(
    transactionExecutor,
    async (transaction) => {
      const conversationLock = await transaction.execute<ConversationHeadRow>(
        buildLockInboxV2TimelineConversationHeadSql({
          tenantId: commit.tenantId,
          conversationId: commit.beforeMessage.conversation.id
        })
      );
      assertAtMostOneRow(conversationLock, "Transport fact Conversation lock");
      if (conversationLock.rows.length === 0) {
        return { kind: "message_not_found" } as const;
      }
      const current = await loadTimelineMessageAggregate(transaction, {
        tenantId: commit.tenantId,
        messageId: commit.beforeMessage.id,
        lock: true
      });
      if (current === null) return { kind: "message_not_found" } as const;
      const observation = commit.fact.observation;
      const envelope = buildInboxV2SafeGenericEnvelope({
        tenantId: commit.tenantId,
        entityKind: "message_transport",
        entityId: observation.id,
        entityRevision: inboxV2EntityRevisionSchema.parse(observation.revision),
        timelineItemId: current.timelineItem.id,
        timelineSequence: current.timelineItem.timelineSequence,
        streamPosition,
        changeKind:
          commit.fact.kind === "delivery"
            ? `delivery.${commit.fact.observation.fact}`
            : "receipt.read",
        occurredAt: observation.observedAt
      });
      const existing = await transaction.execute<Record<string, unknown>>(
        buildFindInboxV2MessageTransportFactCommitSql({
          tenantId: commit.tenantId,
          commitToken: commit.commitToken,
          observationId: observation.id
        })
      );
      const expectedDigest = computeInboxV2TimelineMessageCommitDigest(commit);
      if (existing.rows.length > 0) {
        return transportFactReplayResult({
          rows: existing.rows,
          commit,
          current,
          expectedDigest
        });
      }
      if (
        !sameValue(current.message, commit.beforeMessage) ||
        !sameValue(current.timelineItem, commit.beforeTimelineItem)
      ) {
        return { kind: "conflict", code: "revision.conflict" } as const;
      }
      const claimResult = await transaction.execute<Record<string, unknown>>(
        buildInsertInboxV2MessageTransportFactCommitSql(input)
      );
      if (claimResult.rows.length !== 1) {
        const winner = await transaction.execute<Record<string, unknown>>(
          buildFindInboxV2MessageTransportFactCommitSql({
            tenantId: commit.tenantId,
            commitToken: commit.commitToken,
            observationId: observation.id
          })
        );
        if (winner.rows.length === 0) {
          return {
            kind: "conflict",
            code: "message.transport_conflict"
          } as const;
        }
        return transportFactReplayResult({
          rows: winner.rows,
          commit,
          current,
          expectedDigest
        });
      }
      if (commit.fact.kind === "delivery") {
        await expectOneRow(
          transaction,
          buildInsertInboxV2MessageDeliveryObservationSql(input),
          "Message delivery observation insert"
        );
      } else {
        await expectOneRow(
          transaction,
          buildInsertInboxV2ProviderReceiptObservationSql(input),
          "Provider receipt observation insert"
        );
        const payload =
          buildInsertInboxV2ProviderReceiptOpaquePayloadSql(commit);
        if (payload !== null) {
          await expectOneRow(
            transaction,
            payload,
            "Provider receipt opaque payload insert"
          );
        }
      }
      return { kind: "appended", envelope, result: undefined } as const;
    }
  );
}

function transportFactReplayResult(
  input: Readonly<{
    rows: readonly Record<string, unknown>[];
    commit: InboxV2MessageTransportFactCommit;
    current: LoadedTimelineMessageAggregate;
    expectedDigest: string;
  }>
): PersistInboxV2MessageAuxiliaryResult {
  if (input.rows.length !== 1) {
    return { kind: "conflict", code: "message.transport_conflict" };
  }
  const persisted = input.rows[0] as Record<string, unknown>;
  const observation = input.commit.fact.observation;
  const exact =
    persisted.commit_token === input.commit.commitToken &&
    persisted.fact_kind === input.commit.fact.kind &&
    persisted.observation_id === observation.id &&
    persisted.message_id === input.commit.beforeMessage.id &&
    persisted.commit_digest_sha256 === input.expectedDigest &&
    parseTimestamp(
      persisted.observed_at,
      "Transport fact replay observedAt"
    ) === observation.observedAt &&
    parseTimestamp(
      persisted.recorded_at,
      "Transport fact replay recordedAt"
    ) === observation.recordedAt &&
    parseRevision(persisted.revision, "Transport fact replay revision") ===
      inboxV2EntityRevisionSchema.parse(observation.revision) &&
    (input.commit.fact.kind === "delivery"
      ? persisted.delivery_observation_id === observation.id &&
        persisted.receipt_observation_id === null
      : persisted.receipt_observation_id === observation.id &&
        persisted.delivery_observation_id === null);
  if (!exact) {
    return { kind: "conflict", code: "message.transport_conflict" };
  }
  return {
    kind: "already_applied",
    envelope: buildInboxV2SafeGenericEnvelope({
      tenantId: input.commit.tenantId,
      entityKind: "message_transport",
      entityId: requireString(
        persisted.observation_id,
        "Transport fact replay observation id"
      ),
      entityRevision: parseRevision(
        persisted.revision,
        "Transport fact replay revision"
      ),
      timelineItemId: input.current.timelineItem.id,
      timelineSequence: input.current.timelineItem.timelineSequence,
      streamPosition: inboxV2BigintCounterSchema.parse(
        parseDatabaseBigint(
          persisted.recorded_stream_position,
          "Transport fact replay stream position"
        )
      ),
      changeKind:
        persisted.fact_kind === "delivery"
          ? `delivery.${requireString(
              persisted.fact_value,
              "Transport delivery replay fact"
            )}`
          : "receipt.read",
      occurredAt: parseTimestamp(
        persisted.observed_at,
        "Transport fact replay observedAt"
      )
    })
  };
}

async function persistTransportAssociation(
  transactionExecutor: InboxV2TimelineMessageTransactionExecutor,
  input: Readonly<{
    commit: InboxV2MessageTransportAssociationCommit;
    streamPosition: InboxV2BigintCounter;
  }>
): Promise<PersistInboxV2MessageAuxiliaryResult> {
  const { commit, streamPosition } = input;
  return runTimelineMessageTransaction(
    transactionExecutor,
    async (transaction) => {
      const conversationLock = await transaction.execute<ConversationHeadRow>(
        buildLockInboxV2TimelineConversationHeadSql({
          tenantId: commit.tenantId,
          conversationId: commit.message.conversation.id
        })
      );
      assertAtMostOneRow(conversationLock, "Transport link Conversation lock");
      if (conversationLock.rows.length === 0) {
        return { kind: "message_not_found" } as const;
      }
      const current = await loadTimelineMessageAggregate(transaction, {
        tenantId: commit.tenantId,
        messageId: commit.message.id,
        lock: true
      });
      if (current === null) return { kind: "message_not_found" } as const;
      const headResult = await transaction.execute<Record<string, unknown>>(
        buildLockInboxV2MessageTransportLinkHeadSql({
          tenantId: commit.tenantId,
          messageId: commit.message.id
        })
      );
      assertAtMostOneRow(headResult, "Transport link-head lock");
      const envelope = buildInboxV2SafeGenericEnvelope({
        tenantId: commit.tenantId,
        entityKind: "message_transport",
        entityId: commit.link.id,
        entityRevision: commit.linkHeadAfter.revision,
        timelineItemId: commit.timelineItem.id,
        timelineSequence: commit.timelineItem.timelineSequence,
        streamPosition,
        changeKind: `transport_link.${commit.link.role}`,
        occurredAt: commit.committedAt
      });
      const existing = await transaction.execute<Record<string, unknown>>(
        buildFindInboxV2MessageTransportLinkSql({
          tenantId: commit.tenantId,
          linkId: commit.link.id,
          sourceOccurrenceId: commit.link.sourceOccurrence.id
        })
      );
      if (existing.rows.length > 0) {
        if (existing.rows.length !== 1) {
          return {
            kind: "conflict",
            code: "message.transport_conflict"
          } as const;
        }
        const persisted = existing.rows[0];
        return transportLinkRowMatches(
          persisted,
          commit.link,
          commit.linkHeadAfter.revision
        )
          ? ({
              kind: "already_applied",
              envelope: buildInboxV2SafeGenericEnvelope({
                tenantId: commit.tenantId,
                entityKind: "message_transport",
                entityId: requireString(
                  persisted.id,
                  "Transport link replay id"
                ),
                entityRevision: parseRevision(
                  persisted.resulting_head_revision,
                  "Transport link replay resulting head revision"
                ),
                timelineItemId: current.timelineItem.id,
                timelineSequence: current.timelineItem.timelineSequence,
                streamPosition: inboxV2BigintCounterSchema.parse(
                  parseDatabaseBigint(
                    persisted.recorded_stream_position,
                    "Transport link replay stream position"
                  )
                ),
                changeKind: `transport_link.${requireString(
                  persisted.role,
                  "Transport link replay role"
                )}`,
                occurredAt: parseTimestamp(
                  persisted.linked_at,
                  "Transport link replay linkedAt"
                )
              })
            } as const)
          : ({
              kind: "conflict",
              code: "message.transport_conflict"
            } as const);
      }
      if (
        !sameValue(current.message, commit.message) ||
        !sameValue(current.timelineItem, commit.timelineItem)
      ) {
        return { kind: "conflict", code: "revision.conflict" } as const;
      }
      const currentHead = headResult.rows[0];
      if (
        (commit.linkHeadBefore === null) !== (currentHead === undefined) ||
        (commit.linkHeadBefore !== null &&
          currentHead !== undefined &&
          !transportLinkHeadRowMatches(currentHead, commit.linkHeadBefore))
      ) {
        return {
          kind: "conflict",
          code: "message.transport_conflict"
        } as const;
      }
      const linkInsert = await transaction.execute<IdRow>(
        buildInsertInboxV2MessageTransportLinkSql({
          link: commit.link,
          resultingHeadRevision: commit.linkHeadAfter.revision,
          streamPosition
        })
      );
      if (linkInsert.rows.length !== 1) {
        return {
          kind: "conflict",
          code: "message.transport_conflict"
        } as const;
      }
      if (commit.linkHeadBefore === null) {
        await expectOneRow(
          transaction,
          buildInsertInboxV2MessageTransportLinkHeadSql({
            head: commit.linkHeadAfter,
            streamPosition
          }),
          "Message transport link-head insert"
        );
      } else {
        await expectOneRow(
          transaction,
          buildAdvanceInboxV2MessageTransportLinkHeadSql({
            before: commit.linkHeadBefore,
            after: commit.linkHeadAfter,
            streamPosition
          }),
          "Message transport link-head CAS"
        );
      }
      return { kind: "appended", envelope, result: undefined } as const;
    }
  );
}

async function persistProviderLifecycleCreation(
  transactionExecutor: InboxV2TimelineMessageTransactionExecutor,
  input: Readonly<{
    commit: InboxV2MessageProviderLifecycleCreationCommit;
    streamPosition: InboxV2BigintCounter;
  }>
): Promise<PersistInboxV2MessageAuxiliaryResult> {
  const { commit, streamPosition } = input;
  return runTimelineMessageTransaction(
    transactionExecutor,
    async (transaction) => {
      const conversationLock = await transaction.execute<ConversationHeadRow>(
        buildLockInboxV2TimelineConversationHeadSql({
          tenantId: commit.tenantId,
          conversationId: commit.message.conversation.id
        })
      );
      assertAtMostOneRow(
        conversationLock,
        "Provider lifecycle creation Conversation lock"
      );
      if (conversationLock.rows.length === 0) {
        return { kind: "message_not_found" } as const;
      }

      const current = await loadTimelineMessageAggregate(transaction, {
        tenantId: commit.tenantId,
        messageId: commit.message.id,
        lock: true
      });
      if (current === null) return { kind: "message_not_found" } as const;

      const envelope = buildInboxV2SafeGenericEnvelope({
        tenantId: commit.tenantId,
        entityKind: "provider_lifecycle",
        entityId: commit.operation.id,
        entityRevision: commit.operation.revision,
        timelineItemId: current.timelineItem.id,
        timelineSequence: current.timelineItem.timelineSequence,
        streamPosition,
        changeKind: `provider_lifecycle.${commit.operation.action}.${commit.operation.origin}`,
        occurredAt: commit.operation.occurredAt
      });

      const replayInspection = await inspectProviderLifecycleCreationReplay(
        transaction,
        commit
      );
      if (replayInspection.kind === "conflict") {
        return {
          kind: "conflict",
          code: "message.state_conflict"
        } as const;
      }
      if (
        replayInspection.kind === "absent" &&
        (!sameValue(current.message, commit.message) ||
          !sameValue(current.timelineItem, commit.timelineItem))
      ) {
        return { kind: "conflict", code: "revision.conflict" } as const;
      }

      const result =
        replayInspection.kind === "already_applied"
          ? replayInspection
          : await persistProviderLifecycleCreationInTransaction(
              transaction,
              input
            );
      if (result.kind === "conflict") {
        return {
          kind: "conflict",
          code: "message.state_conflict"
        } as const;
      }
      if (result.kind === "already_applied") {
        const persisted = result.row;
        return {
          kind: "already_applied",
          envelope: buildInboxV2SafeGenericEnvelope({
            tenantId: commit.tenantId,
            entityKind: "provider_lifecycle",
            entityId: requireString(
              persisted.id,
              "Provider lifecycle operation id"
            ),
            entityRevision: commit.operation.revision,
            timelineItemId: current.timelineItem.id,
            timelineSequence: current.timelineItem.timelineSequence,
            streamPosition: inboxV2BigintCounterSchema.parse(
              parseDatabaseBigint(
                persisted.created_stream_position,
                "Provider lifecycle operation created stream position"
              )
            ),
            changeKind: `provider_lifecycle.${commit.operation.action}.${commit.operation.origin}`,
            occurredAt: commit.operation.occurredAt
          })
        } as const;
      }
      return { kind: "appended", envelope, result: undefined } as const;
    }
  );
}

type ProviderSemanticOrderingPreparation = Readonly<{
  commit: InboxV2ProviderSemanticOrderingCommit;
  currentLastChangedStreamPosition: InboxV2BigintCounter | null;
}>;

type ProviderLifecycleCreationReplayInspection =
  | Readonly<{
      kind: "absent";
      routeConsumption: InboxV2OutboundRouteConsumptionRecord | null;
      routeDisposition: Exclude<
        InboxV2OutboundRouteConsumptionDisposition,
        "conflict"
      >;
    }>
  | Readonly<{
      kind: "already_applied";
      row: Record<string, unknown>;
    }>
  | Readonly<{ kind: "conflict" }>;

async function inspectProviderLifecycleCreationReplay(
  transaction: RawSqlExecutor,
  commit: InboxV2MessageProviderLifecycleCreationCommit
): Promise<ProviderLifecycleCreationReplayInspection> {
  const routeConsumption = providerLifecycleRouteConsumptionRecord(commit);
  const routeDisposition =
    routeConsumption === null
      ? "absent"
      : await inspectOutboundRouteConsumption(transaction, routeConsumption);
  if (routeDisposition === "conflict") return { kind: "conflict" };

  const operationResult = await transaction.execute<Record<string, unknown>>(
    buildFindInboxV2ProviderLifecycleOperationSql({
      tenantId: commit.tenantId,
      operationId: commit.operation.id,
      lock: true
    })
  );
  assertAtMostOneRow(operationResult, "Provider lifecycle operation replay");
  if (operationResult.rows[0] !== undefined) {
    return providerLifecycleCreationRowMatches(
      operationResult.rows[0],
      commit
    ) &&
      (routeConsumption === null || routeDisposition === "exact")
      ? { kind: "already_applied", row: operationResult.rows[0] }
      : { kind: "conflict" };
  }

  return { kind: "absent", routeConsumption, routeDisposition };
}

async function prepareProviderSemanticOrderingAdvance(
  transaction: RawSqlExecutor,
  input: Readonly<{
    commit: InboxV2ProviderSemanticOrderingCommit;
    streamPosition: InboxV2BigintCounter;
  }>
): Promise<
  | Readonly<{
      kind: "ready";
      preparation: ProviderSemanticOrderingPreparation;
    }>
  | Readonly<{ kind: "conflict" }>
> {
  const referenceResult = await transaction.execute<Record<string, unknown>>(
    buildLockInboxV2ProviderSemanticOrderingReferenceSql({
      tenantId: input.commit.tenantId,
      externalMessageReferenceId: input.commit.after.externalMessageReference.id
    })
  );
  assertAtMostOneRow(
    referenceResult,
    "Provider semantic ordering ExternalMessageReference lock"
  );
  if (referenceResult.rows.length === 0) return { kind: "conflict" };

  const headResult = await transaction.execute<Record<string, unknown>>(
    buildFindInboxV2ProviderSemanticOrderingHeadSql({
      tenantId: input.commit.tenantId,
      externalMessageReferenceId:
        input.commit.after.externalMessageReference.id,
      semanticFamilyId: input.commit.semanticFamilyId,
      lock: true
    })
  );
  assertAtMostOneRow(headResult, "Provider semantic ordering head lock");
  const currentRow = headResult.rows[0];
  if (
    (input.commit.before === null) !== (currentRow === undefined) ||
    (input.commit.before !== null &&
      currentRow !== undefined &&
      !providerSemanticOrderingHeadRowMatches(currentRow, input.commit.before))
  ) {
    return { kind: "conflict" };
  }

  const currentLastChangedStreamPosition =
    currentRow === undefined
      ? null
      : inboxV2BigintCounterSchema.parse(
          parseDatabaseBigint(
            currentRow.last_changed_stream_position,
            "Provider semantic ordering last stream position"
          )
        );
  if (
    currentLastChangedStreamPosition !== null &&
    BigInt(input.streamPosition) <= BigInt(currentLastChangedStreamPosition)
  ) {
    return { kind: "conflict" };
  }

  return {
    kind: "ready",
    preparation: {
      commit: input.commit,
      currentLastChangedStreamPosition
    }
  };
}

async function persistProviderSemanticOrderingAdvance(
  transaction: RawSqlExecutor,
  input: Readonly<{
    preparation: ProviderSemanticOrderingPreparation;
    streamPosition: InboxV2BigintCounter;
  }>
): Promise<void> {
  const { commit, currentLastChangedStreamPosition } = input.preparation;
  if (commit.before === null) {
    await expectOneRow(
      transaction,
      buildInsertInboxV2ProviderSemanticOrderingHeadSql({
        head: commit.after,
        streamPosition: input.streamPosition
      }),
      "Provider semantic ordering head insert"
    );
    return;
  }
  if (currentLastChangedStreamPosition === null) {
    throw new Error(
      "Provider semantic ordering advance lost its current head."
    );
  }
  await expectOneRow(
    transaction,
    buildAdvanceInboxV2ProviderSemanticOrderingHeadSql({
      before: commit.before,
      after: commit.after,
      currentLastChangedStreamPosition,
      streamPosition: input.streamPosition
    }),
    "Provider semantic ordering head CAS"
  );
}

async function persistProviderLifecycleCreationInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    commit: InboxV2MessageProviderLifecycleCreationCommit;
    streamPosition: InboxV2BigintCounter;
  }>
): Promise<
  | Readonly<{ kind: "inserted" }>
  | Readonly<{ kind: "already_applied"; row: Record<string, unknown> }>
  | Readonly<{ kind: "conflict" }>
> {
  const { commit, streamPosition } = input;
  const replayInspection = await inspectProviderLifecycleCreationReplay(
    transaction,
    commit
  );
  if (replayInspection.kind !== "absent") return replayInspection;
  const { routeConsumption, routeDisposition } = replayInspection;

  const semanticOrderingPreparation =
    commit.semanticOrderingCommit === null
      ? null
      : await prepareProviderSemanticOrderingAdvance(transaction, {
          commit: commit.semanticOrderingCommit,
          streamPosition
        });
  if (semanticOrderingPreparation?.kind === "conflict") {
    return { kind: "conflict" };
  }

  let actionAttributionId: string | null = null;
  if (commit.operation.origin === "hulee_requested") {
    actionAttributionId = derivedInboxV2Id(
      "action_attribution",
      commit.operation.id
    );
    await expectOneRow(
      transaction,
      buildInsertInboxV2ActionAttributionSql({
        tenantId: commit.tenantId,
        id: actionAttributionId,
        conversationId: commit.message.conversation.id,
        attribution: {
          actionParticipant: commit.operation.actionParticipant,
          appActor: commit.operation.appActor,
          sourceOccurrence: null,
          automationCausation: commit.operation.automationCausation
        },
        createdAt: commit.operation.recordedAt
      }),
      "Provider lifecycle action attribution insert"
    );
  }

  await expectOneRow(
    transaction,
    buildInsertInboxV2ProviderLifecycleOperationSql({
      commit,
      actionAttributionId,
      streamPosition
    }),
    "Provider lifecycle operation insert"
  );
  if (routeConsumption !== null && routeDisposition === "absent") {
    await expectOneRow(
      transaction,
      buildInsertInboxV2OutboundRouteConsumptionSql(routeConsumption),
      "Provider lifecycle outbound-route consumption insert"
    );
  }
  if (semanticOrderingPreparation?.kind === "ready") {
    await persistProviderSemanticOrderingAdvance(transaction, {
      preparation: semanticOrderingPreparation.preparation,
      streamPosition
    });
  }
  return { kind: "inserted" };
}

async function persistProviderLifecycleTransition(
  transactionExecutor: InboxV2TimelineMessageTransactionExecutor,
  input: Readonly<{
    commit: InboxV2MessageProviderLifecycleTransitionCommit;
    streamPosition: InboxV2BigintCounter;
  }>
): Promise<PersistInboxV2MessageAuxiliaryResult> {
  const { commit, streamPosition } = input;
  return runTimelineMessageTransaction(
    transactionExecutor,
    async (transaction) => {
      const conversationResult = await transaction.execute<{
        conversation_id: unknown;
      }>(
        buildFindInboxV2MessageConversationIdSql({
          tenantId: commit.tenantId,
          messageId: commit.before.message.id
        })
      );
      assertAtMostOneRow(
        conversationResult,
        "Provider lifecycle Message conversation read"
      );
      const conversationRow = conversationResult.rows[0];
      if (conversationRow === undefined) {
        return { kind: "message_not_found" } as const;
      }
      const conversationId = inboxV2ConversationIdSchema.parse(
        conversationRow.conversation_id
      );
      const conversationLock = await transaction.execute<ConversationHeadRow>(
        buildLockInboxV2TimelineConversationHeadSql({
          tenantId: commit.tenantId,
          conversationId
        })
      );
      assertAtMostOneRow(
        conversationLock,
        "Provider lifecycle transition Conversation lock"
      );
      if (conversationLock.rows.length === 0) {
        return { kind: "message_not_found" } as const;
      }
      const current = await loadTimelineMessageAggregate(transaction, {
        tenantId: commit.tenantId,
        messageId: commit.before.message.id,
        lock: true
      });
      if (current === null) return { kind: "message_not_found" } as const;

      const operationResult = await transaction.execute<
        Record<string, unknown>
      >(
        buildFindInboxV2ProviderLifecycleOperationSql({
          tenantId: commit.tenantId,
          operationId: commit.before.id,
          lock: true
        })
      );
      assertAtMostOneRow(operationResult, "Provider lifecycle operation lock");
      const operationRow = operationResult.rows[0];
      if (operationRow === undefined) {
        return { kind: "conflict", code: "message.state_conflict" } as const;
      }

      const transitionResult = await transaction.execute<
        Record<string, unknown>
      >(buildFindInboxV2ProviderLifecycleTransitionSql(commit));
      assertAtMostOneRow(
        transitionResult,
        "Provider lifecycle transition replay"
      );
      const transitionRow = transitionResult.rows[0];
      const envelope = buildInboxV2SafeGenericEnvelope({
        tenantId: commit.tenantId,
        entityKind: "provider_lifecycle",
        entityId: commit.after.id,
        entityRevision: commit.after.revision,
        timelineItemId: current.timelineItem.id,
        timelineSequence: current.timelineItem.timelineSequence,
        streamPosition,
        changeKind: `provider_lifecycle.${commit.after.action}.${commit.after.outcome.state}`,
        occurredAt: commit.transition.recordedAt
      });

      if (transitionRow !== undefined) {
        const exact =
          providerLifecycleOperationRowMatches(operationRow, commit.after) &&
          providerLifecycleTransitionRowMatches(transitionRow, commit);
        return exact
          ? ({
              kind: "already_applied",
              envelope: buildInboxV2SafeGenericEnvelope({
                tenantId: commit.tenantId,
                entityKind: "provider_lifecycle",
                entityId: requireString(
                  transitionRow.operation_id,
                  "Provider lifecycle transition operation id"
                ),
                entityRevision: parseRevision(
                  transitionRow.resulting_revision,
                  "Provider lifecycle transition resulting revision"
                ),
                timelineItemId: current.timelineItem.id,
                timelineSequence: current.timelineItem.timelineSequence,
                streamPosition: inboxV2BigintCounterSchema.parse(
                  parseDatabaseBigint(
                    transitionRow.recorded_stream_position,
                    "Provider lifecycle transition stream position"
                  )
                ),
                changeKind: `provider_lifecycle.${requireString(
                  operationRow.action,
                  "Provider lifecycle transition action"
                )}.${requireString(
                  transitionRow.outcome,
                  "Provider lifecycle transition outcome"
                )}`,
                occurredAt: parseTimestamp(
                  transitionRow.recorded_at,
                  "Provider lifecycle transition recordedAt"
                )
              })
            } as const)
          : ({
              kind: "conflict",
              code: "message.state_conflict"
            } as const);
      }
      if (!providerLifecycleOperationRowMatches(operationRow, commit.before)) {
        return { kind: "conflict", code: "revision.conflict" } as const;
      }

      await expectOneRow(
        transaction,
        buildInsertInboxV2ProviderLifecycleTransitionSql({
          commit,
          streamPosition
        }),
        "Provider lifecycle transition insert"
      );
      await expectOneRow(
        transaction,
        buildAdvanceInboxV2ProviderLifecycleOperationSql(
          commit,
          streamPosition
        ),
        "Provider lifecycle operation CAS"
      );
      return { kind: "appended", envelope, result: undefined } as const;
    }
  );
}

async function persistReaction(
  transactionExecutor: InboxV2TimelineMessageTransactionExecutor,
  input: Readonly<{
    commit: InboxV2MessageReactionCommit;
    streamPosition: InboxV2BigintCounter;
  }>
): Promise<PersistInboxV2MessageAuxiliaryResult> {
  const { commit, streamPosition } = input;
  return runTimelineMessageTransaction(
    transactionExecutor,
    async (transaction) => {
      const conversationLock = await transaction.execute<ConversationHeadRow>(
        buildLockInboxV2TimelineConversationHeadSql({
          tenantId: commit.tenantId,
          conversationId: commit.beforeMessage.conversation.id
        })
      );
      assertAtMostOneRow(conversationLock, "Reaction Conversation lock");
      if (conversationLock.rows.length === 0) {
        return { kind: "message_not_found" } as const;
      }
      const currentMessage = await loadTimelineMessageAggregate(transaction, {
        tenantId: commit.tenantId,
        messageId: commit.beforeMessage.id,
        lock: true
      });
      if (currentMessage === null) {
        return { kind: "message_not_found" } as const;
      }

      const routeConsumption = reactionRouteConsumptionRecord(commit);
      const routeDisposition =
        routeConsumption === null
          ? "absent"
          : await inspectOutboundRouteConsumption(
              transaction,
              routeConsumption
            );
      if (routeDisposition === "conflict") {
        return {
          kind: "conflict",
          code: "message.transport_conflict"
        } as const;
      }

      const slotResult = await transaction.execute<Record<string, unknown>>(
        buildLockInboxV2MessageReactionSlotHeadSql({
          tenantId: commit.tenantId,
          messageId: commit.beforeMessage.id,
          semanticSlotKey: commit.afterReaction.semanticSlotKey
        })
      );
      assertAtMostOneRow(slotResult, "Reaction slot-head lock");
      const reactionResult = await transaction.execute<Record<string, unknown>>(
        buildFindInboxV2MessageReactionSql({
          tenantId: commit.tenantId,
          reactionId: commit.afterReaction.id,
          lock: true
        })
      );
      assertAtMostOneRow(reactionResult, "Reaction head lock");
      const transitionResult = await transaction.execute<
        Record<string, unknown>
      >(
        buildFindInboxV2MessageReactionTransitionSql({
          tenantId: commit.tenantId,
          transitionId: commit.transition.id
        })
      );
      assertAtMostOneRow(transitionResult, "Reaction transition replay");

      const envelope = buildInboxV2SafeGenericEnvelope({
        tenantId: commit.tenantId,
        entityKind: "message_reaction",
        entityId: commit.afterReaction.id,
        entityRevision: commit.afterReaction.revision,
        timelineItemId: currentMessage.timelineItem.id,
        timelineSequence: currentMessage.timelineItem.timelineSequence,
        streamPosition,
        changeKind: `reaction.${commit.transition.mode}.${commit.transition.operation}`,
        occurredAt: commit.transition.occurredAt
      });

      if (transitionResult.rows[0] !== undefined) {
        const persistedTransition = transitionResult.rows[0];
        const exact =
          reactionTransitionRowMatches(persistedTransition, commit) &&
          (await reactionEvidenceReplayMatches(transaction, commit)) &&
          (routeConsumption === null || routeDisposition === "exact");
        return exact
          ? ({
              kind: "already_applied",
              envelope: buildInboxV2SafeGenericEnvelope({
                tenantId: commit.tenantId,
                entityKind: "message_reaction",
                entityId: requireString(
                  persistedTransition.reaction_id,
                  "Reaction transition reaction id"
                ),
                entityRevision: parseRevision(
                  persistedTransition.resulting_revision,
                  "Reaction transition resulting revision"
                ),
                timelineItemId: currentMessage.timelineItem.id,
                timelineSequence: currentMessage.timelineItem.timelineSequence,
                streamPosition: inboxV2BigintCounterSchema.parse(
                  parseDatabaseBigint(
                    persistedTransition.recorded_stream_position,
                    "Reaction transition stream position"
                  )
                ),
                changeKind: `reaction.${requireString(
                  persistedTransition.mode,
                  "Reaction transition mode"
                )}.${requireString(
                  persistedTransition.operation,
                  "Reaction transition operation"
                )}`,
                occurredAt: parseTimestamp(
                  persistedTransition.occurred_at,
                  "Reaction transition occurredAt"
                )
              })
            } as const)
          : ({
              kind: "conflict",
              code: "message.state_conflict"
            } as const);
      }

      const semanticOrderingPreparation =
        commit.providerObservation === null
          ? null
          : await prepareProviderSemanticOrderingAdvance(transaction, {
              commit: commit.providerObservation.orderingCommit,
              streamPosition
            });
      if (semanticOrderingPreparation?.kind === "conflict") {
        return {
          kind: "conflict",
          code: "message.state_conflict"
        } as const;
      }

      if (
        !sameValue(currentMessage.message, commit.beforeMessage) ||
        !sameValue(currentMessage.timelineItem, commit.beforeTimelineItem)
      ) {
        return { kind: "conflict", code: "revision.conflict" } as const;
      }
      const currentSlot = slotResult.rows[0];
      const currentReaction = reactionResult.rows[0];
      if (
        (commit.beforeReaction === null) !== (currentReaction === undefined) ||
        (commit.slotHeadBefore === null) !== (currentSlot === undefined) ||
        (commit.beforeReaction !== null &&
          currentReaction !== undefined &&
          !reactionRowMatches(currentReaction, commit.beforeReaction)) ||
        (commit.slotHeadBefore !== null &&
          currentSlot !== undefined &&
          !reactionSlotHeadRowMatches(currentSlot, commit.slotHeadBefore))
      ) {
        return {
          kind: "conflict",
          code: "message.state_conflict"
        } as const;
      }

      const attributionId = derivedInboxV2Id(
        "action_attribution",
        commit.transition.id
      );
      await expectOneRow(
        transaction,
        buildInsertInboxV2ActionAttributionSql({
          tenantId: commit.tenantId,
          id: attributionId,
          conversationId: commit.beforeMessage.conversation.id,
          attribution: commit.transition.actionAttribution,
          createdAt: commit.transition.recordedAt
        }),
        "Reaction action attribution insert"
      );

      if (commit.beforeReaction === null) {
        await expectOneRow(
          transaction,
          buildInsertInboxV2MessageReactionSql({
            reaction: commit.afterReaction,
            streamPosition
          }),
          "Reaction head insert"
        );
      }
      await expectOneRow(
        transaction,
        buildInsertInboxV2MessageReactionTransitionSql({
          commit,
          actionAttributionId: attributionId,
          streamPosition
        }),
        "Reaction transition insert"
      );
      if (routeConsumption !== null && routeDisposition === "absent") {
        await expectOneRow(
          transaction,
          buildInsertInboxV2OutboundRouteConsumptionSql(routeConsumption),
          "Reaction outbound-route consumption insert"
        );
      }
      if (commit.beforeReaction !== null) {
        await expectOneRow(
          transaction,
          buildAdvanceInboxV2MessageReactionSql({
            before: commit.beforeReaction,
            after: commit.afterReaction,
            streamPosition
          }),
          "Reaction head CAS"
        );
      }
      if (commit.providerObservation !== null) {
        await expectOneRow(
          transaction,
          buildInsertInboxV2ProviderReactionObservationSql(commit),
          "Provider reaction observation insert"
        );
      }
      if (semanticOrderingPreparation?.kind === "ready") {
        await persistProviderSemanticOrderingAdvance(transaction, {
          preparation: semanticOrderingPreparation.preparation,
          streamPosition
        });
      }
      if (commit.slotHeadBefore === null) {
        await expectOneRow(
          transaction,
          buildInsertInboxV2MessageReactionSlotHeadSql({
            head: commit.slotHeadAfter,
            streamPosition
          }),
          "Reaction slot-head insert"
        );
      } else {
        await expectOneRow(
          transaction,
          buildAdvanceInboxV2MessageReactionSlotHeadSql({
            before: commit.slotHeadBefore,
            after: commit.slotHeadAfter,
            streamPosition
          }),
          "Reaction slot-head CAS"
        );
      }
      return { kind: "appended", envelope, result: undefined } as const;
    }
  );
}

async function reactionEvidenceReplayMatches(
  transaction: RawSqlExecutor,
  commit: InboxV2MessageReactionCommit
): Promise<boolean> {
  const result = await transaction.execute<Record<string, unknown>>(
    buildFindInboxV2ProviderReactionObservationSql({
      tenantId: commit.tenantId,
      transitionId: commit.transition.id
    })
  );
  assertAtMostOneRow(result, "Provider reaction observation replay");
  return commit.providerObservation === null
    ? result.rows.length === 0
    : result.rows[0] !== undefined &&
        providerReactionObservationRowMatches(
          result.rows[0],
          commit.providerObservation,
          commit.transition.id
        );
}

type InboxV2MessageAttachmentAnchorBlock = Readonly<{
  attachmentId: string;
  blockKey: string;
  materializationState: "pending" | "ready" | "failed" | "quarantined";
}>;

function messageAttachmentAnchorBlocks(
  blocks: readonly InboxV2MessageContentBlock[]
): readonly InboxV2MessageAttachmentAnchorBlock[] {
  return blocks.flatMap((block) => {
    if (!("attachment" in block)) return [];
    if (block.attachment.state === "legacy_unpinned") {
      throw invariantError(
        "A new Message content revision cannot persist a legacy unpinned attachment anchor."
      );
    }
    return [
      Object.freeze({
        attachmentId: block.attachment.attachment.id,
        blockKey: block.blockKey,
        materializationState: block.attachment.state
      })
    ];
  });
}

function deriveNewMessageAttachmentAnchorBlocks(
  commit: InboxV2MessageMutationCommit
): readonly InboxV2MessageAttachmentAnchorBlock[] {
  const transition = commit.contentTransition;
  if (transition === null || transition.after.state.kind !== "available") {
    return [];
  }
  const beforeIds = new Set(
    transition.before.state.kind === "available"
      ? messageAttachmentAnchorBlocks(transition.before.state.blocks).map(
          ({ attachmentId }) => attachmentId
        )
      : []
  );
  return messageAttachmentAnchorBlocks(transition.after.state.blocks).filter(
    ({ attachmentId }) => !beforeIds.has(attachmentId)
  );
}

async function persistNewMessageAttachmentAnchors(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: string;
    timelineItemId: string;
    timelineContentId: string;
    blocks: readonly InboxV2MessageAttachmentAnchorBlock[];
    createdAt: string;
  }>
): Promise<void> {
  if (input.blocks.length === 0) return;
  await expectRows(
    executor,
    buildInsertInboxV2MessageAttachmentAnchorsSql(input),
    input.blocks.length,
    "Message attachment anchor insert"
  );
}

async function persistAvailableContentPayload(
  executor: RawSqlExecutor,
  content: InboxV2TimelineContent
): Promise<void> {
  if (content.state.kind !== "available") return;
  const payloadSql = buildInsertInboxV2TimelineContentPayloadSql({
    tenantId: content.tenantId,
    contentId: content.id,
    contentRevision: content.revision,
    blocks: content.state.blocks,
    createdAt: content.updatedAt
  });
  if (payloadSql !== null) {
    await expectRows(
      executor,
      payloadSql,
      content.state.blocks.length,
      "Timeline content payload insert"
    );
  }
  const contactSql = buildInsertInboxV2TimelineContentContactValuesSql({
    tenantId: content.tenantId,
    contentId: content.id,
    contentRevision: content.revision,
    blocks: content.state.blocks
  });
  if (contactSql !== null) {
    const count = content.state.blocks.reduce(
      (total, block) =>
        total + (block.kind === "contact" ? block.values.length : 0),
      0
    );
    await expectRows(
      executor,
      contactSql,
      count,
      "Timeline content contact insert"
    );
  }
}

async function persistMessageReferenceContext(
  executor: RawSqlExecutor,
  message: InboxV2Message
): Promise<void> {
  const unresolved = unresolvedReferenceTarget(message);
  const unresolvedCandidateCount =
    unresolved?.resolution.state === "conflicted"
      ? unresolved.resolution.candidates.length
      : 0;
  await expectOneRow(
    executor,
    buildInsertInboxV2MessageReferenceContextSql(message),
    "Message reference context insert"
  );
  for (const [statement, count, operation] of [
    [
      buildInsertInboxV2MessageReferenceCanonicalTargetsSql(message),
      canonicalReferenceTargets(message).length,
      "Message canonical reference targets insert"
    ],
    [
      buildInsertInboxV2MessageReferenceExternalTargetsSql(message),
      externalReferenceTargets(message).length,
      "Message external reference targets insert"
    ],
    [
      buildInsertInboxV2MessageReferenceUnresolvedTargetSql(message),
      unresolved === null ? 0 : 1,
      "Message unresolved reference target insert"
    ],
    [
      buildInsertInboxV2MessageReferenceUnresolvedCandidatesSql(message),
      unresolvedCandidateCount,
      "Message unresolved reference candidates insert"
    ]
  ] as const) {
    if (statement !== null) {
      await expectRows(executor, statement, count, operation);
    }
  }
}

async function persistInitialTransportLink(
  executor: RawSqlExecutor,
  input: Readonly<{
    link: NonNullable<InboxV2MessageCreationCommit["originTransportLink"]>;
    head: NonNullable<InboxV2MessageCreationCommit["originTransportLinkHead"]>;
    streamPosition: InboxV2BigintCounter;
  }>
): Promise<void> {
  await expectOneRow(
    executor,
    buildInsertInboxV2MessageTransportLinkSql({
      link: input.link,
      resultingHeadRevision: input.head.revision,
      streamPosition: input.streamPosition
    }),
    "Origin transport link insert"
  );
  await expectOneRow(
    executor,
    buildInsertInboxV2MessageTransportLinkHeadSql({
      head: input.head,
      streamPosition: input.streamPosition
    }),
    "Origin transport link head insert"
  );
}

async function loadTimelineMessageAggregate(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
    lock: boolean;
  }>
): Promise<LoadedTimelineMessageAggregate | null> {
  const result = await executor.execute<MessageHeadRow>(
    buildFindInboxV2TimelineMessageSql(input)
  );
  assertAtMostOneRow(result, "Message aggregate read");
  const row = result.rows[0];
  if (row === undefined) return null;
  const referenceContext = await loadMessageReferenceContext(executor, input);
  const content = await loadTimelineContent(executor, {
    tenantId: input.tenantId,
    contentId: requireString(row.content_id, "Message content id"),
    lock: false
  });
  if (content === null) {
    throw invariantError("Message points to a missing TimelineContent head.");
  }
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== input.tenantId) {
    throw invariantError("Message aggregate crossed its tenant boundary.");
  }
  const timelineItem = mapMessageTimelineRow(row, tenantId);
  const message = inboxV2MessageSchema.parse({
    tenantId,
    id: row.message_id,
    conversation: {
      tenantId,
      kind: "conversation",
      id: row.conversation_id
    },
    timelineItem: {
      tenantId,
      kind: "timeline_item",
      id: row.timeline_item_id
    },
    authorParticipant: {
      tenantId,
      kind: "conversation_participant",
      id: row.author_participant_id
    },
    origin: mapMessageOriginRow(row, tenantId),
    appActor: mapAppActorRow(row, tenantId),
    automationCausation: mapAutomationRow(row, tenantId),
    content: {
      content: { tenantId, kind: "timeline_content", id: content.id },
      contentRevision: parseRevision(
        row.content_revision,
        "Message content revision"
      ),
      stateKind: row.content_state
    },
    referenceContext,
    lifecycle: mapMessageLifecycleRow(row, tenantId),
    revision: parseRevision(row.message_revision, "Message revision"),
    createdAt: parseTimestamp(row.message_created_at, "Message createdAt"),
    updatedAt: parseTimestamp(row.message_updated_at, "Message updatedAt")
  });
  const streamPosition = inboxV2BigintCounterSchema.parse(
    parseDatabaseBigint(
      row.message_last_changed_stream_position,
      "Message last-changed stream position"
    )
  );
  const timelineStreamPosition = inboxV2BigintCounterSchema.parse(
    parseDatabaseBigint(
      row.timeline_last_changed_stream_position,
      "TimelineItem last-changed stream position"
    )
  );
  if (streamPosition !== timelineStreamPosition) {
    throw invariantError(
      "Message and TimelineItem last-changed stream positions diverged."
    );
  }
  const databaseNow =
    row.database_now === undefined
      ? [
          message.updatedAt,
          timelineItem.updatedAt,
          content.updatedAt
        ].sort()[2]!
      : parseTimestamp(row.database_now, "Message aggregate database clock");
  return { message, timelineItem, content, databaseNow, streamPosition };
}

async function loadTimelineContent(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    contentId: string;
    lock: boolean;
  }>
): Promise<InboxV2TimelineContent | null> {
  const headResult = await executor.execute<ContentHeadRow>(
    buildFindInboxV2TimelineContentSql(input)
  );
  assertAtMostOneRow(headResult, "TimelineContent head read");
  const head = headResult.rows[0];
  if (head === undefined) return null;
  const tenantId = inboxV2TenantIdSchema.parse(head.tenant_id);
  if (tenantId !== input.tenantId) {
    throw invariantError("TimelineContent crossed its tenant boundary.");
  }
  const revision = parseRevision(head.revision, "TimelineContent revision");
  let state: Record<string, unknown>;
  if (head.state === "available") {
    const [payloadResult, contactsResult] = await Promise.all([
      executor.execute<ContentPayloadRow>(
        buildListInboxV2TimelineContentPayloadSql({
          tenantId,
          contentId: input.contentId,
          contentRevision: revision
        })
      ),
      executor.execute<ContactValueRow>(
        buildListInboxV2TimelineContentContactValuesSql({
          tenantId,
          contentId: input.contentId,
          contentRevision: revision
        })
      )
    ]);
    state = {
      kind: "available",
      blocks: payloadResult.rows.map((row) =>
        mapContentBlockRow(row, contactsResult.rows, tenantId)
      ),
      contentDigestSha256: head.content_digest_sha256
    };
  } else if (head.state === "privacy_erased") {
    state = {
      kind: "privacy_erased",
      tombstoneEvent: {
        tenantId,
        kind: "event",
        id: head.tombstone_event_id
      },
      reasonId: head.tombstone_reason_id,
      erasedAt: parseTimestamp(head.updated_at, "Content erasedAt")
    };
  } else if (head.state === "retention_purged") {
    state = {
      kind: "retention_purged",
      tombstoneEvent: {
        tenantId,
        kind: "event",
        id: head.tombstone_event_id
      },
      policyId: head.retention_policy_id,
      policyVersion: head.retention_policy_version,
      policyRevision: parseRevision(
        head.retention_policy_revision,
        "Content retention policy revision"
      ),
      purgedAt: parseTimestamp(head.updated_at, "Content purgedAt")
    };
  } else {
    throw invariantError("TimelineContent has an unknown state.");
  }
  return inboxV2TimelineContentSchema.parse({
    tenantId,
    id: head.id,
    state,
    revision,
    createdAt: parseTimestamp(head.created_at, "Content createdAt"),
    updatedAt: parseTimestamp(head.updated_at, "Content updatedAt")
  });
}

async function loadMessageReferenceContext(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
  }>
): Promise<InboxV2Message["referenceContext"]> {
  const [
    contextResult,
    canonicalResult,
    externalResult,
    unresolvedResult,
    candidatesResult
  ] = await Promise.all([
    executor.execute<Record<string, unknown>>(
      buildFindInboxV2MessageReferenceContextSql(input)
    ),
    executor.execute<Record<string, unknown>>(
      buildListInboxV2MessageReferenceCanonicalTargetsSql(input)
    ),
    executor.execute<Record<string, unknown>>(
      buildListInboxV2MessageReferenceExternalTargetsSql(input)
    ),
    executor.execute<Record<string, unknown>>(
      buildFindInboxV2MessageReferenceUnresolvedTargetSql(input)
    ),
    executor.execute<Record<string, unknown>>(
      buildListInboxV2MessageReferenceUnresolvedCandidatesSql(input)
    )
  ]);
  assertAtMostOneRow(contextResult, "Message reference context read");
  assertAtMostOneRow(unresolvedResult, "Message unresolved reference read");
  const context = contextResult.rows[0];
  if (context === undefined) {
    throw invariantError("Message reference context is missing.");
  }
  const canonical = canonicalResult.rows.map((row) => ({
    message: {
      tenantId: input.tenantId,
      kind: "message" as const,
      id: row.target_message_id
    },
    timelineItem: {
      tenantId: input.tenantId,
      kind: "timeline_item" as const,
      id: row.target_timeline_item_id
    },
    messageRevision: parseRevision(
      row.target_message_revision,
      "Message reference target revision"
    )
  }));
  const external = externalResult.rows.map((row) => ({
    externalMessageReference: {
      tenantId: input.tenantId,
      kind: "external_message_reference" as const,
      id: row.external_message_reference_id
    },
    sourceOccurrence: {
      tenantId: input.tenantId,
      kind: "source_occurrence" as const,
      id: row.source_occurrence_id
    }
  }));
  switch (context.kind) {
    case "none":
      return inboxV2MessageReferenceContextSchema.parse({ kind: "none" });
    case "reply": {
      const unresolved = unresolvedResult.rows[0];
      if (unresolved !== undefined) {
        const key = mapExternalMessageKeyFromOccurrenceRow(
          unresolved,
          input.tenantId
        );
        if (
          computeInboxV2TimelineMessageCommitDigest(key) !==
          unresolved.external_message_key_digest_sha256
        ) {
          throw invariantError("Unresolved message-key digest mismatch.");
        }
        const source = {
          externalMessageKey: key,
          sourceOccurrence: {
            tenantId: input.tenantId,
            kind: "source_occurrence" as const,
            id: unresolved.source_occurrence_id
          },
          resolution:
            unresolved.resolution_state === "pending"
              ? ({ state: "pending" } as const)
              : ({
                  state: "conflicted" as const,
                  candidates: candidatesResult.rows.map((row) => ({
                    tenantId: input.tenantId,
                    kind: "external_message_reference" as const,
                    id: row.external_message_reference_id
                  }))
                } as const)
        };
        return inboxV2MessageReferenceContextSchema.parse({
          kind: "reply",
          target: { state: "unresolved_source", source }
        });
      }
      const target = canonical[0];
      if (target === undefined || canonical.length !== 1) {
        throw invariantError("Reply has no exact canonical target.");
      }
      return inboxV2MessageReferenceContextSchema.parse(
        external.length === 0
          ? {
              kind: "reply",
              target: { state: "resolved_internal", canonical: target }
            }
          : external.length === 1
            ? {
                kind: "reply",
                target: {
                  state: "resolved_external",
                  canonical: target,
                  external: external[0] as (typeof external)[number]
                }
              }
            : (() => {
                throw invariantError("Reply has multiple external targets.");
              })()
      );
    }
    case "forward_content_copy":
      return inboxV2MessageReferenceContextSchema.parse({
        kind: "forward_content_copy",
        sources: canonical
      });
    case "forward_provider_native":
      return inboxV2MessageReferenceContextSchema.parse({
        kind: "forward_provider_native",
        sources: external,
        capability: {
          capabilityId: context.native_capability_id,
          capabilityRevision: parseRevision(
            context.native_capability_revision,
            "Native-forward capability revision"
          ),
          adapterContract: {
            contractId: context.native_adapter_contract_id,
            contractVersion: context.native_adapter_contract_version,
            declarationRevision: parseRevision(
              context.native_adapter_declaration_revision,
              "Native-forward adapter declaration revision"
            ),
            surfaceId: context.native_adapter_surface_id,
            loadedByTrustedServiceId:
              context.native_adapter_loaded_by_trusted_service_id,
            loadedAt: parseTimestamp(
              context.native_adapter_loaded_at,
              "Native-forward adapter loadedAt"
            )
          },
          decision: "supported"
        }
      });
    case "forward_provider_observed":
      return inboxV2MessageReferenceContextSchema.parse({
        kind: "forward_provider_observed",
        originOccurrence: {
          tenantId: input.tenantId,
          kind: "source_occurrence",
          id: context.origin_source_occurrence_id
        },
        provenanceCompleteness: context.provenance_completeness,
        sourceReferences: external
      });
    default:
      throw invariantError("Message reference context kind is unknown.");
  }
}

async function loadMessageTransportLinkPage(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
    snapshotToken: string | null;
    cursor: string | null;
    limit: number;
  }>
): Promise<InboxV2MessageTransportLinkPage | null> {
  const identity = await executor.execute<IdRow>(
    buildFindInboxV2MessageIdentitySql(input)
  );
  assertAtMostOneRow(identity, "Message transport-link owner read");
  if (identity.rows.length === 0) return null;

  let snapshotToken = input.snapshotToken;
  let through: string;
  if (snapshotToken === null) {
    const headResult = await executor.execute<Record<string, unknown>>(
      buildFindInboxV2MessageTransportLinkHeadReadSql(input)
    );
    assertAtMostOneRow(headResult, "Message transport-link head read");
    through =
      headResult.rows[0] === undefined
        ? "0"
        : parseRevision(
            headResult.rows[0].revision,
            "Message transport-link head revision"
          );
    snapshotToken = encodeInboxV2AuxiliaryReadSnapshotToken({
      kind: "transport_links",
      tenantId: input.tenantId,
      ownerId: input.messageId,
      through
    });
  } else {
    through = decodeInboxV2AuxiliaryReadSnapshotToken({
      token: snapshotToken,
      kind: "transport_links",
      tenantId: input.tenantId,
      ownerId: input.messageId
    }).through;
  }

  const afterRevision =
    input.cursor === null
      ? "0"
      : (decodeInboxV2AuxiliaryReadCursor({
          cursor: input.cursor,
          kind: "transport_links",
          snapshotToken,
          partCount: 1
        })[0] ?? "");
  parseReadBound(afterRevision, "Message transport-link cursor revision");
  if (BigInt(afterRevision) > BigInt(through)) {
    throw invalidAuxiliaryReadToken("cursor");
  }

  let head: InboxV2MessageTransportLinkHeadRead | null = null;
  if (through !== "0") {
    const throughRevision = inboxV2EntityRevisionSchema.parse(through);
    const anchorResult = await executor.execute<Record<string, unknown>>(
      buildFindInboxV2MessageTransportLinkAtRevisionSql({
        tenantId: input.tenantId,
        messageId: input.messageId,
        resultingHeadRevision: throughRevision
      })
    );
    assertAtMostOneRow(anchorResult, "Message transport-link snapshot anchor");
    const anchor = anchorResult.rows[0];
    if (anchor === undefined) {
      throw invariantError(
        "Message transport-link snapshot anchor is missing."
      );
    }
    const anchorRead = mapTransportLinkReadRow(anchor, input.tenantId);
    if (anchorRead.resultingHeadRevision !== throughRevision) {
      throw invariantError("Message transport-link snapshot anchor diverged.");
    }
    head = Object.freeze({
      head: inboxV2MessageTransportLinkHeadSchema.parse({
        tenantId: input.tenantId,
        message: messageReference(input.tenantId, input.messageId),
        linkCount: through,
        latestLink: {
          tenantId: input.tenantId,
          kind: "message_transport_occurrence_link",
          id: anchorRead.link.id
        },
        revision: throughRevision,
        updatedAt: anchorRead.link.linkedAt
      }),
      lastChangedStreamPosition: anchorRead.recordedStreamPosition
    });
  }

  const result =
    through === "0"
      ? ({ rows: [] } as RawSqlQueryResult<Record<string, unknown>>)
      : await executor.execute<Record<string, unknown>>(
          buildListInboxV2MessageTransportLinksReadSql({
            tenantId: input.tenantId,
            messageId: input.messageId,
            throughHeadRevision: inboxV2EntityRevisionSchema.parse(through),
            afterHeadRevision: afterRevision,
            limit: input.limit
          })
        );
  const hasMore = result.rows.length > input.limit;
  const links = result.rows
    .slice(0, input.limit)
    .map((row) => mapTransportLinkReadRow(row, input.tenantId));
  const last = links.at(-1);
  const nextCursor =
    hasMore && last !== undefined
      ? encodeInboxV2AuxiliaryReadCursor({
          kind: "transport_links",
          snapshotToken,
          after: [last.resultingHeadRevision]
        })
      : null;
  return Object.freeze({
    tenantId: input.tenantId,
    message: messageReference(input.tenantId, input.messageId),
    snapshotToken,
    throughHeadRevision: through,
    head,
    links: Object.freeze(links),
    nextCursor
  });
}

export function mapTransportLinkReadRow(
  row: Record<string, unknown>,
  tenantId: InboxV2TenantId
): InboxV2MessageTransportLinkRead {
  if (row.tenant_id !== tenantId) {
    throw invariantError("Message transport link crossed its tenant boundary.");
  }
  return Object.freeze({
    link: inboxV2MessageTransportOccurrenceLinkSchema.parse({
      tenantId,
      id: row.id,
      message: messageReference(
        tenantId,
        inboxV2MessageIdSchema.parse(row.message_id)
      ),
      sourceOccurrence: {
        tenantId,
        kind: "source_occurrence",
        id: row.source_occurrence_id
      },
      externalMessageReference: {
        tenantId,
        kind: "external_message_reference",
        id: row.external_message_reference_id
      },
      role: row.role,
      revision: parseDatabaseBigint(row.revision, "Transport link revision"),
      linkedAt: parseTimestamp(row.linked_at, "Transport link linkedAt")
    }),
    resultingHeadRevision: parseRevision(
      row.resulting_head_revision,
      "Transport link resulting head revision"
    ),
    recordedStreamPosition: inboxV2BigintCounterSchema.parse(
      parseDatabaseBigint(
        row.recorded_stream_position,
        "Transport link stream position"
      )
    )
  });
}

async function loadMessageReactionPage(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
    snapshotToken: string | null;
    cursor: string | null;
    limit: number;
  }>
): Promise<InboxV2QueryableMessageReactionPage | null> {
  const identity = await executor.execute<IdRow>(
    buildFindInboxV2MessageIdentitySql(input)
  );
  assertAtMostOneRow(identity, "Message reaction owner read");
  if (identity.rows.length === 0) return null;

  let snapshotToken = input.snapshotToken;
  let snapshot: InboxV2AuxiliaryReadSnapshot;
  if (snapshotToken === null) {
    const snapshotResult = await executor.execute<Record<string, unknown>>(
      buildFindInboxV2MessageReactionSnapshotSql(input)
    );
    assertAtMostOneRow(snapshotResult, "Message reaction snapshot read");
    const row = snapshotResult.rows[0];
    if (row === undefined)
      throw invariantError("Reaction snapshot is missing.");
    const through = parseReadBound(
      row.snapshot_position,
      "Reaction snapshot stream position"
    );
    const snapshotCreatedAt = parseTimestamp(
      row.snapshot_created_at,
      "Reaction snapshot createdAt"
    );
    snapshotToken = encodeInboxV2AuxiliaryReadSnapshotToken({
      kind: "reactions",
      tenantId: input.tenantId,
      ownerId: input.messageId,
      through,
      snapshotCreatedAt
    });
    snapshot = { kind: "reactions", through, snapshotCreatedAt };
  } else {
    snapshot = decodeInboxV2AuxiliaryReadSnapshotToken({
      token: snapshotToken,
      kind: "reactions",
      tenantId: input.tenantId,
      ownerId: input.messageId
    });
  }
  if (snapshot.snapshotCreatedAt === null) {
    throw invalidAuxiliaryReadToken("snapshot");
  }
  const afterReactionId =
    input.cursor === null
      ? null
      : parseEntityId(
          decodeInboxV2AuxiliaryReadCursor({
            cursor: input.cursor,
            kind: "reactions",
            snapshotToken,
            partCount: 1
          })[0],
          "Message reaction cursor id"
        );
  const result = await executor.execute<Record<string, unknown>>(
    buildListInboxV2MessageReactionsReadSql({
      tenantId: input.tenantId,
      messageId: input.messageId,
      throughStreamPosition: snapshot.through,
      afterReactionId,
      limit: input.limit
    })
  );
  const hasMore = result.rows.length > input.limit;
  const reactions = result.rows.slice(0, input.limit).map((row) =>
    mapQueryableReactionReadRow(row, {
      tenantId: input.tenantId,
      messageId: input.messageId,
      throughStreamPosition: snapshot.through
    })
  );
  const available = reactions
    .filter(
      (
        reaction
      ): reaction is Extract<
        InboxV2QueryableMessageReaction,
        { projectionState: "available" }
      > => reaction.projectionState === "available"
    )
    .map((reaction) => reaction.reaction);
  const last = reactions.at(-1)?.reaction;
  const nextCursor =
    hasMore && last !== undefined
      ? encodeInboxV2AuxiliaryReadCursor({
          kind: "reactions",
          snapshotToken,
          after: [last.id]
        })
      : null;
  inboxV2MessageReactionPageSchema.parse({
    tenantId: input.tenantId,
    message: messageReference(input.tenantId, input.messageId),
    snapshotToken,
    snapshotCreatedAt: snapshot.snapshotCreatedAt,
    reactions: available,
    nextCursor
  });
  return Object.freeze({
    tenantId: input.tenantId,
    message: messageReference(input.tenantId, input.messageId),
    snapshotToken,
    snapshotCreatedAt: snapshot.snapshotCreatedAt,
    reactions: Object.freeze(reactions),
    nextCursor
  });
}

export function mapQueryableReactionReadRow(
  row: Record<string, unknown>,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
    throughStreamPosition: string;
  }>
): InboxV2QueryableMessageReaction {
  const reactionRow = requireJsonRecord(row.reaction_row, "Reaction head");
  const transitionRow = requireJsonRecord(
    row.transition_row,
    "Reaction snapshot transition"
  );
  if (
    reactionRow.tenant_id !== input.tenantId ||
    reactionRow.message_id !== input.messageId ||
    transitionRow.tenant_id !== input.tenantId ||
    transitionRow.reaction_id !== reactionRow.id ||
    transitionRow.semantic_slot_key !== reactionRow.semantic_slot_key ||
    BigInt(
      parseReadBound(
        transitionRow.recorded_stream_position,
        "Reaction transition stream position"
      )
    ) > BigInt(input.throughStreamPosition)
  ) {
    throw invariantError("Reaction snapshot row is incoherent.");
  }
  const capability = parseDigestedJson(
    reactionRow.capability_detail,
    reactionRow.capability_detail_digest_sha256,
    inboxV2ReactionCapabilitySchema,
    "Reaction capability"
  );
  const state = parseDigestedJson(
    transitionRow.after_state_detail,
    transitionRow.after_state_detail_digest_sha256,
    inboxV2ReactionStateSchema,
    "Reaction state"
  );
  if (state.kind !== transitionRow.after_state_kind) {
    throw invariantError("Reaction transition state discriminator diverged.");
  }
  const common = {
    tenantId: input.tenantId,
    id: inboxV2MessageReactionIdSchema.parse(reactionRow.id),
    message: messageReference(input.tenantId, input.messageId),
    capability,
    semanticSlotKey: requireString(
      reactionRow.semantic_slot_key,
      "Reaction semantic slot key"
    ),
    state,
    revision: parseRevision(
      transitionRow.resulting_revision,
      "Reaction snapshot revision"
    ),
    createdAt: parseTimestamp(reactionRow.created_at, "Reaction createdAt"),
    updatedAt: parseTimestamp(
      transitionRow.recorded_at,
      "Reaction snapshot updatedAt"
    )
  } as const;
  const actor = mapQueryableReactionActor(reactionRow, input.tenantId);
  if (actor.projectionState === "available") {
    return Object.freeze({
      projectionState: "available",
      reaction: inboxV2MessageReactionSchema.parse({
        ...common,
        actor: actor.actor
      })
    });
  }
  return Object.freeze({
    projectionState: "actor_identity_purged",
    reaction: Object.freeze({ ...common, actor: actor.actor })
  });
}

function mapQueryableReactionActor(
  row: Record<string, unknown>,
  tenantId: InboxV2TenantId
):
  | Readonly<{
      projectionState: "available";
      actor: InboxV2MessageReaction["actor"];
    }>
  | Readonly<{
      projectionState: "actor_identity_purged";
      actor: InboxV2PurgedReactionActor;
    }> {
  if (row.actor_kind === "participant") {
    return {
      projectionState: "available",
      actor: {
        kind: "participant",
        participant: {
          tenantId,
          kind: "conversation_participant",
          id: inboxV2ConversationParticipantIdSchema.parse(
            row.actor_participant_id
          )
        }
      }
    };
  }
  const sourceOccurrence = {
    tenantId,
    kind: "source_occurrence" as const,
    id: inboxV2SourceOccurrenceIdSchema.parse(row.actor_source_occurrence_id)
  };
  if (row.actor_kind === "aggregate_only") {
    return {
      projectionState: "available",
      actor: {
        kind: "aggregate_only",
        sourceOccurrence,
        aggregateScope: row.aggregate_scope as
          | "thread"
          | "recipient_set"
          | "unknown"
      }
    };
  }
  if (
    row.actor_kind !== "unattributed_source_observation" &&
    row.actor_kind !== "provider_system"
  ) {
    throw invariantError("Reaction actor kind is unknown.");
  }
  if (row.actor_identity_state === "purged") {
    const identity = {
      state: "purged" as const,
      dataClassId: requireString(
        row.actor_identity_data_class_id,
        "Reaction actor data class"
      ),
      tombstoneEvent: {
        tenantId,
        kind: "event" as const,
        id: requireString(
          row.actor_identity_tombstone_event_id,
          "Reaction actor tombstone event"
        )
      },
      purgedAt: parseTimestamp(
        row.actor_identity_purged_at,
        "Reaction actor purgedAt"
      )
    };
    return row.actor_kind === "unattributed_source_observation"
      ? {
          projectionState: "actor_identity_purged",
          actor: {
            kind: row.actor_kind,
            sourceOccurrence,
            identity
          }
        }
      : {
          projectionState: "actor_identity_purged",
          actor: {
            kind: row.actor_kind,
            sourceOccurrence,
            actorKindId: requireString(
              row.provider_actor_kind_id,
              "Reaction provider actor kind"
            ),
            identity
          }
        };
  }
  if (row.actor_identity_state !== "available") {
    throw invariantError("Reaction actor identity state is unknown.");
  }
  if (row.actor_kind === "unattributed_source_observation") {
    const value = requireString(
      row.opaque_actor_key,
      "Reaction opaque actor key"
    );
    verifyUtf8Digest(
      value,
      row.opaque_actor_key_digest_sha256,
      "Reaction opaque actor key"
    );
    return {
      projectionState: "available",
      actor: {
        kind: row.actor_kind,
        sourceOccurrence,
        opaqueActorKey: value
      }
    };
  }
  const subject = requireString(
    row.provider_actor_subject,
    "Reaction provider actor subject"
  );
  verifyUtf8Digest(
    subject,
    row.provider_actor_subject_digest_sha256,
    "Reaction provider actor subject"
  );
  return {
    projectionState: "available",
    actor: {
      kind: row.actor_kind,
      sourceOccurrence,
      actorKindId: row.provider_actor_kind_id as never,
      actorSubject: subject
    }
  };
}

async function loadMessageTransportFactPage(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
    snapshotToken: string | null;
    cursor: string | null;
    limit: number;
  }>
): Promise<InboxV2QueryableMessageTransportFactPage | null> {
  const identity = await executor.execute<IdRow>(
    buildFindInboxV2MessageIdentitySql(input)
  );
  assertAtMostOneRow(identity, "Message transport-fact owner read");
  if (identity.rows.length === 0) return null;

  let snapshotToken = input.snapshotToken;
  let through: string;
  if (snapshotToken === null) {
    const snapshotResult = await executor.execute<Record<string, unknown>>(
      buildFindInboxV2MessageTransportFactSnapshotSql(input)
    );
    assertAtMostOneRow(snapshotResult, "Message transport-fact snapshot read");
    const row = snapshotResult.rows[0];
    if (row === undefined) {
      throw invariantError("Message transport-fact snapshot is missing.");
    }
    through = parseReadBound(
      row.snapshot_position,
      "Message transport-fact snapshot position"
    );
    snapshotToken = encodeInboxV2AuxiliaryReadSnapshotToken({
      kind: "transport_facts",
      tenantId: input.tenantId,
      ownerId: input.messageId,
      through
    });
  } else {
    through = decodeInboxV2AuxiliaryReadSnapshotToken({
      token: snapshotToken,
      kind: "transport_facts",
      tenantId: input.tenantId,
      ownerId: input.messageId
    }).through;
  }
  const afterParts =
    input.cursor === null
      ? null
      : decodeInboxV2AuxiliaryReadCursor({
          cursor: input.cursor,
          kind: "transport_facts",
          snapshotToken,
          partCount: 3
        });
  const after =
    afterParts === null
      ? null
      : {
          recordedAt: inboxV2TimestampSchema.parse(afterParts[0]),
          factKind: parseTransportFactKind(afterParts[1]),
          observationId: parseEntityId(
            afterParts[2],
            "Message transport-fact cursor observation"
          )
        };
  const result = await executor.execute<Record<string, unknown>>(
    buildListInboxV2MessageTransportFactsReadSql({
      tenantId: input.tenantId,
      messageId: input.messageId,
      throughStreamPosition: through,
      after,
      limit: input.limit
    })
  );
  const hasMore = result.rows.length > input.limit;
  const pageRows = result.rows.slice(0, input.limit);
  const facts = pageRows.map((row) =>
    mapQueryableTransportFactReadRow(row, {
      tenantId: input.tenantId,
      messageId: input.messageId,
      throughStreamPosition: through
    })
  );
  const availableFacts = facts
    .filter(
      (
        fact
      ): fact is Extract<
        InboxV2QueryableMessageTransportFact,
        { projectionState: "available" }
      > => fact.projectionState === "available"
    )
    .map((fact) => fact.fact);
  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow !== undefined
      ? encodeInboxV2AuxiliaryReadCursor({
          kind: "transport_facts",
          snapshotToken,
          after: [
            parseTimestamp(lastRow.recorded_at, "Transport fact cursor time"),
            parseTransportFactKind(lastRow.fact_kind),
            parseEntityId(
              lastRow.observation_id,
              "Transport fact cursor observation"
            )
          ]
        })
      : null;
  inboxV2MessageTransportFactPageSchema.parse({
    tenantId: input.tenantId,
    message: messageReference(input.tenantId, input.messageId),
    facts: availableFacts,
    snapshotToken,
    nextCursor
  });
  return Object.freeze({
    tenantId: input.tenantId,
    message: messageReference(input.tenantId, input.messageId),
    snapshotToken,
    facts: Object.freeze(facts),
    nextCursor
  });
}

export function mapQueryableTransportFactReadRow(
  row: Record<string, unknown>,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
    throughStreamPosition: string;
  }>
): InboxV2QueryableMessageTransportFact {
  const factKind = parseTransportFactKind(row.fact_kind);
  const observationId = parseEntityId(
    row.observation_id,
    "Transport fact observation id"
  );
  const recordedPosition = parseReadBound(
    row.recorded_stream_position,
    "Transport fact stream position"
  );
  if (
    row.tenant_id !== input.tenantId ||
    row.message_id !== input.messageId ||
    BigInt(recordedPosition) > BigInt(input.throughStreamPosition)
  ) {
    throw invariantError(
      "Transport fact ledger crossed its bounded Message scope."
    );
  }
  const childValue =
    factKind === "delivery" ? row.delivery_row : row.receipt_row;
  const siblingValue =
    factKind === "delivery" ? row.receipt_row : row.delivery_row;
  if (childValue === null || childValue === undefined || siblingValue != null) {
    throw invariantError("Transport fact ledger has no exact single child.");
  }
  const child = requireJsonRecord(childValue, "Transport fact child");
  const ledgerDigest = requireSha256Digest(
    row.commit_digest_sha256,
    "Transport fact ledger commit digest"
  );
  if (
    child.tenant_id !== input.tenantId ||
    child.id !== observationId ||
    child.commit_token !== row.commit_token ||
    child.commit_digest_sha256 !== ledgerDigest ||
    parseTimestamp(child.observed_at, "Transport fact child observedAt") !==
      parseTimestamp(row.observed_at, "Transport fact ledger observedAt") ||
    parseTimestamp(child.recorded_at, "Transport fact child recordedAt") !==
      parseTimestamp(row.recorded_at, "Transport fact ledger recordedAt") ||
    parseReadBound(
      child.recorded_stream_position,
      "Transport fact child stream position"
    ) !== recordedPosition
  ) {
    throw invariantError("Transport fact ledger and child diverged.");
  }

  if (factKind === "delivery") {
    if (child.message_id !== input.messageId) {
      throw invariantError("Delivery fact points to another Message.");
    }
    return Object.freeze({
      projectionState: "available",
      fact: inboxV2MessageTransportFactSchema.parse({
        kind: "delivery",
        observation: mapDeliveryObservationReadRow(child, input.tenantId)
      })
    });
  }
  if (child.target_message_id !== input.messageId) {
    throw invariantError("Receipt fact points to another Message.");
  }
  const receipt = mapReceiptObservationReadRow(
    child,
    row.opaque_row,
    input.tenantId
  );
  if (receipt.projectionState === "available") {
    return Object.freeze({
      projectionState: "available",
      fact: inboxV2MessageTransportFactSchema.parse({
        kind: "receipt",
        observation: receipt.observation
      })
    });
  }
  return Object.freeze({
    projectionState: "classified_payload_purged",
    fact: Object.freeze({
      kind: "receipt",
      observation: receipt.observation
    })
  });
}

function mapDeliveryObservationReadRow(
  row: Record<string, unknown>,
  tenantId: InboxV2TenantId
): Extract<InboxV2MessageTransportFact, { kind: "delivery" }>["observation"] {
  const reference = (kind: string, id: unknown) => ({
    tenantId,
    kind,
    id
  });
  let scope: Record<string, unknown>;
  switch (row.scope_kind) {
    case "dispatch":
      scope = {
        kind: "dispatch",
        dispatch: reference("outbound_dispatch", row.scope_dispatch_id),
        attempt:
          row.scope_attempt_id === null
            ? null
            : reference("outbound_dispatch_attempt", row.scope_attempt_id),
        artifact:
          row.scope_artifact_id === null
            ? null
            : reference("outbound_dispatch_artifact", row.scope_artifact_id)
      };
      break;
    case "external_reference":
      scope = {
        kind: "external_reference",
        externalMessageReference: reference(
          "external_message_reference",
          row.scope_external_message_reference_id
        ),
        sourceOccurrence: reference(
          "source_occurrence",
          row.scope_source_occurrence_id
        )
      };
      break;
    case "recipient":
      scope = {
        kind: "recipient",
        externalMessageReference: reference(
          "external_message_reference",
          row.scope_external_message_reference_id
        ),
        recipient: reference(
          "source_external_identity",
          row.scope_recipient_source_identity_id
        )
      };
      break;
    default:
      throw invariantError("Delivery scope kind is unknown.");
  }
  let evidence: Record<string, unknown>;
  switch (row.evidence_kind) {
    case "provider_result":
      evidence = {
        kind: "provider_result",
        attempt: reference("outbound_dispatch_attempt", row.evidence_attempt_id)
      };
      break;
    case "provider_artifact":
      evidence = {
        kind: "provider_artifact",
        attempt: reference(
          "outbound_dispatch_attempt",
          row.evidence_attempt_id
        ),
        artifact: reference(
          "outbound_dispatch_artifact",
          row.evidence_artifact_id
        )
      };
      break;
    case "provider_event":
      evidence = {
        kind: "provider_event",
        normalizedInboundEvent: reference(
          "normalized_inbound_event",
          row.evidence_normalized_inbound_event_id
        ),
        externalMessageReference: reference(
          "external_message_reference",
          row.evidence_external_message_reference_id
        ),
        sourceOccurrence: reference(
          "source_occurrence",
          row.evidence_source_occurrence_id
        )
      };
      break;
    default:
      throw invariantError("Delivery evidence kind is unknown.");
  }
  const semanticProof =
    row.semantic_proof_detail === null
      ? null
      : parseDigestedJson(
          row.semantic_proof_detail,
          row.semantic_proof_digest_sha256,
          inboxV2ProviderSemanticProofSchema,
          "Delivery semantic proof"
        );
  const parsed = inboxV2MessageTransportFactSchema.parse({
    kind: "delivery",
    observation: {
      tenantId,
      id: row.id,
      message: messageReference(
        tenantId,
        inboxV2MessageIdSchema.parse(row.message_id)
      ),
      fact: row.fact,
      scope,
      sourceAccount: reference("source_account", row.source_account_id),
      sourceThreadBinding: reference(
        "source_thread_binding",
        row.source_thread_binding_id
      ),
      bindingGeneration: parseRevision(
        row.binding_generation,
        "Delivery binding generation"
      ),
      adapterContract: mapAdapterContractRow(row, "Delivery"),
      capabilityId: row.capability_id,
      capabilityRevision: parseRevision(
        row.capability_revision,
        "Delivery capability revision"
      ),
      evidence,
      semanticProof,
      evidenceKindId: row.evidence_kind_id,
      evidenceDigestSha256: requireSha256Digest(
        row.evidence_digest_sha256,
        "Delivery evidence digest"
      ),
      failureReasonId: nullableString(row.failure_reason_id),
      observedAt: parseTimestamp(row.observed_at, "Delivery observedAt"),
      recordedAt: parseTimestamp(row.recorded_at, "Delivery recordedAt"),
      revision: parseDatabaseBigint(row.revision, "Delivery revision")
    }
  });
  if (parsed.kind !== "delivery") {
    throw invariantError("Delivery projection parsed as another fact kind.");
  }
  return parsed.observation;
}

function mapReceiptObservationReadRow(
  row: Record<string, unknown>,
  opaqueValue: unknown,
  tenantId: InboxV2TenantId
):
  | Readonly<{
      projectionState: "available";
      observation: InboxV2ProviderReceiptObservation;
    }>
  | Readonly<{
      projectionState: "classified_payload_purged";
      observation: InboxV2PurgedProviderReceiptObservation;
    }> {
  const reference = (kind: string, id: unknown) => ({ tenantId, kind, id });
  const opaque =
    opaqueValue === null || opaqueValue === undefined
      ? null
      : requireJsonRecord(opaqueValue, "Receipt opaque payload");
  const opaquePayloadId = nullableString(row.opaque_payload_id);
  if (opaque !== null) {
    if (
      opaque.tenant_id !== tenantId ||
      opaque.id !== opaquePayloadId ||
      opaque.receipt_observation_id !== row.id ||
      opaque.data_class_id !== row.opaque_data_class_id
    ) {
      throw invariantError(
        "Receipt opaque payload crossed its durable anchor."
      );
    }
  }
  const opaqueState = <TValue extends string>(
    raw: unknown,
    digest: unknown,
    label: string
  ): InboxV2QueryableOpaqueValue => {
    const digestSha256 = requireSha256Digest(digest, `${label} digest`);
    if (opaque === null) {
      if (opaquePayloadId === null) {
        throw invariantError(`${label} has no classified payload anchor.`);
      }
      return {
        state: "purged",
        digestSha256,
        dataClassId: requireString(
          row.opaque_data_class_id,
          `${label} data class`
        )
      };
    }
    const value = requireString(raw, label) as TValue;
    verifyUtf8Digest(value, digestSha256, label);
    return { state: "available", value, digestSha256 };
  };

  let target:
    | InboxV2ProviderReceiptObservation["target"]
    | Record<string, unknown>;
  switch (row.target_kind) {
    case "exact_message":
      target = {
        kind: "exact_message",
        message: messageReference(
          tenantId,
          inboxV2MessageIdSchema.parse(row.target_message_id)
        ),
        externalMessageReference: reference(
          "external_message_reference",
          row.target_external_message_reference_id
        ),
        sourceOccurrence: reference(
          "source_occurrence",
          row.target_source_occurrence_id
        )
      };
      break;
    case "provider_watermark": {
      const value = opaqueState(
        opaque?.provider_watermark,
        row.provider_watermark_digest_sha256,
        "Receipt provider watermark"
      );
      target = {
        kind: "provider_watermark",
        watermark: value.state === "available" ? value.value : value
      };
      break;
    }
    case "thread_readmark":
      target = {
        kind: "thread_readmark",
        readThroughProviderTime: parseTimestamp(
          row.read_through_provider_time,
          "Receipt read-through provider time"
        )
      };
      break;
    default:
      throw invariantError("Receipt target kind is unknown.");
  }
  let reader:
    | InboxV2ProviderReceiptObservation["reader"]
    | Record<string, unknown>;
  if (row.reader_kind === "source_external_identity") {
    reader = {
      kind: "source_external_identity",
      sourceExternalIdentity: reference(
        "source_external_identity",
        row.reader_source_external_identity_id
      )
    };
  } else if (row.reader_kind === "aggregate_only") {
    const value = opaqueState(
      opaque?.reader_aggregate_key,
      row.reader_aggregate_key_digest_sha256,
      "Receipt aggregate reader key"
    );
    reader = {
      kind: "aggregate_only",
      aggregateKey: value.state === "available" ? value.value : value
    };
  } else {
    throw invariantError("Receipt reader kind is unknown.");
  }
  const common = {
    tenantId,
    id: row.id,
    fact: "read" as const,
    target,
    reader,
    sourceAccount: reference("source_account", row.source_account_id),
    sourceThreadBinding: reference(
      "source_thread_binding",
      row.source_thread_binding_id
    ),
    bindingGeneration: parseRevision(
      row.binding_generation,
      "Receipt binding generation"
    ),
    adapterContract: mapAdapterContractRow(row, "Receipt"),
    capabilityId: row.capability_id,
    capabilityRevision: parseRevision(
      row.capability_revision,
      "Receipt capability revision"
    ),
    evidenceEvent: reference(
      "normalized_inbound_event",
      row.evidence_normalized_inbound_event_id
    ),
    semanticProof: parseDigestedJson(
      row.semantic_proof_detail,
      row.semantic_proof_digest_sha256,
      inboxV2ProviderSemanticProofSchema,
      "Receipt semantic proof"
    ),
    evidenceKindId: row.evidence_kind_id,
    evidenceDigestSha256: requireSha256Digest(
      row.evidence_digest_sha256,
      "Receipt evidence digest"
    ),
    observedAt: parseTimestamp(row.observed_at, "Receipt observedAt"),
    recordedAt: parseTimestamp(row.recorded_at, "Receipt recordedAt"),
    revision: parseDatabaseBigint(row.revision, "Receipt revision")
  };
  const hasPurgedValue =
    (target.kind === "provider_watermark" &&
      isPlainRecord(target.watermark) &&
      target.watermark.state === "purged") ||
    (reader.kind === "aggregate_only" &&
      isPlainRecord(reader.aggregateKey) &&
      reader.aggregateKey.state === "purged");
  const validationTarget =
    target.kind === "provider_watermark" && isPlainRecord(target.watermark)
      ? { kind: "provider_watermark", watermark: "purged" }
      : target;
  const validationReader =
    reader.kind === "aggregate_only" && isPlainRecord(reader.aggregateKey)
      ? { kind: "aggregate_only", aggregateKey: "purged" }
      : reader;
  const parsed = inboxV2MessageTransportFactSchema.parse({
    kind: "receipt",
    observation: {
      ...common,
      target: validationTarget,
      reader: validationReader
    }
  });
  if (parsed.kind !== "receipt") {
    throw invariantError("Receipt projection parsed as another fact kind.");
  }
  if (hasPurgedValue) {
    return {
      projectionState: "classified_payload_purged",
      observation: {
        ...parsed.observation,
        target,
        reader
      } as InboxV2PurgedProviderReceiptObservation
    };
  }
  return { projectionState: "available", observation: parsed.observation };
}

function parseTransportFactKind(value: unknown): "delivery" | "receipt" {
  if (value !== "delivery" && value !== "receipt") {
    throw invariantError("Transport fact kind is unknown.");
  }
  return value;
}

async function loadProviderLifecycleOperation(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    operationId: string;
  }>
): Promise<InboxV2ProviderLifecycleOperationRead | null> {
  const result = await executor.execute<Record<string, unknown>>(
    buildFindInboxV2ProviderLifecycleOperationSql(input)
  );
  assertAtMostOneRow(result, "Provider lifecycle operation recovery read");
  const row = result.rows[0];
  return row === undefined
    ? null
    : mapProviderLifecycleOperationReadRow(row, input.tenantId);
}

async function loadProviderLifecycleTransitionPage(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    operationId: string;
    snapshotToken: string | null;
    cursor: string | null;
    limit: number;
  }>
): Promise<InboxV2ProviderLifecycleTransitionPage | null> {
  const operationResult = await executor.execute<Record<string, unknown>>(
    buildFindInboxV2ProviderLifecycleOperationSql(input)
  );
  assertAtMostOneRow(
    operationResult,
    "Provider lifecycle transition owner read"
  );
  const operationRow = operationResult.rows[0];
  if (operationRow === undefined) return null;
  const currentRevision = parseRevision(
    operationRow.revision,
    "Provider lifecycle current revision"
  );
  let snapshotToken = input.snapshotToken;
  let throughRevision: InboxV2EntityRevision;
  if (snapshotToken === null) {
    throughRevision = currentRevision;
    snapshotToken = encodeInboxV2AuxiliaryReadSnapshotToken({
      kind: "provider_lifecycle",
      tenantId: input.tenantId,
      ownerId: input.operationId,
      through: throughRevision
    });
  } else {
    const through = decodeInboxV2AuxiliaryReadSnapshotToken({
      token: snapshotToken,
      kind: "provider_lifecycle",
      tenantId: input.tenantId,
      ownerId: input.operationId
    }).through;
    throughRevision = inboxV2EntityRevisionSchema.parse(through);
    if (BigInt(throughRevision) > BigInt(currentRevision)) {
      throw invalidAuxiliaryReadToken("snapshot");
    }
  }
  const afterRevision =
    input.cursor === null
      ? "1"
      : (decodeInboxV2AuxiliaryReadCursor({
          cursor: input.cursor,
          kind: "provider_lifecycle",
          snapshotToken,
          partCount: 1
        })[0] ?? "");
  parseReadBound(afterRevision, "Provider lifecycle cursor revision");
  if (
    BigInt(afterRevision) < 1n ||
    BigInt(afterRevision) > BigInt(throughRevision)
  ) {
    throw invalidAuxiliaryReadToken("cursor");
  }
  const result = await executor.execute<Record<string, unknown>>(
    buildListInboxV2ProviderLifecycleTransitionsReadSql({
      tenantId: input.tenantId,
      operationId: input.operationId,
      throughRevision,
      afterRevision,
      limit: input.limit
    })
  );
  const hasMore = result.rows.length > input.limit;
  const transitions = result.rows
    .slice(0, input.limit)
    .map((row) => mapProviderLifecycleTransitionReadRow(row, input.tenantId));
  const last = transitions.at(-1);
  const nextCursor =
    hasMore && last !== undefined
      ? encodeInboxV2AuxiliaryReadCursor({
          kind: "provider_lifecycle",
          snapshotToken,
          after: [last.transition.resultingRevision]
        })
      : null;
  return Object.freeze({
    tenantId: input.tenantId,
    operation: {
      tenantId: input.tenantId,
      kind: "message_provider_lifecycle_operation" as const,
      id: input.operationId
    },
    snapshotToken,
    throughRevision,
    transitions: Object.freeze(transitions),
    nextCursor
  });
}

export function mapProviderLifecycleOperationReadRow(
  row: Record<string, unknown>,
  tenantId: InboxV2TenantId
): InboxV2ProviderLifecycleOperationRead {
  if (row.tenant_id !== tenantId) {
    throw invariantError(
      "Provider lifecycle operation crossed its tenant boundary."
    );
  }
  const operationId = inboxV2MessageProviderLifecycleOperationIdSchema.parse(
    row.id
  );
  const messageId = inboxV2MessageIdSchema.parse(row.message_id);
  const adapterContract = mapAdapterContractRow(row, "Provider lifecycle");
  const actionParticipant =
    row.action_participant_id === null
      ? null
      : {
          tenantId,
          kind: "conversation_participant" as const,
          id: row.action_participant_id
        };
  const appActor = mapAppActorRow(
    {
      app_actor_kind: row.app_actor_kind,
      app_actor_employee_id: row.app_actor_employee_id,
      app_authorization_epoch: row.app_authorization_epoch,
      app_trusted_service_id: row.app_trusted_service_id
    },
    tenantId
  );
  const automationCausation = mapAutomationRow(
    {
      automation_kind: row.automation_kind,
      automation_cause_event_id: row.automation_cause_event_id,
      automation_correlation_id: row.automation_correlation_id,
      automation_caused_at: row.automation_caused_at,
      automation_initiating_employee_id: row.automation_initiating_employee_id,
      automation_initiating_authorization_epoch:
        row.automation_initiating_authorization_epoch
    },
    tenantId
  );
  const identity = {
    tenantId,
    id: operationId,
    message: messageReference(tenantId, messageId),
    action: row.action,
    origin: row.origin,
    externalMessageReference: {
      tenantId,
      kind: "external_message_reference",
      id: row.external_message_reference_id
    },
    sourceOccurrence: {
      tenantId,
      kind: "source_occurrence",
      id: row.source_occurrence_id
    },
    sourceAccount: {
      tenantId,
      kind: "source_account",
      id: row.source_account_id
    },
    sourceThreadBinding: {
      tenantId,
      kind: "source_thread_binding",
      id: row.source_thread_binding_id
    },
    bindingGeneration: parseRevision(
      row.binding_generation,
      "Provider lifecycle binding generation"
    ),
    outboundRoute:
      row.outbound_route_id === null
        ? null
        : {
            tenantId,
            kind: "outbound_route" as const,
            id: row.outbound_route_id
          },
    adapterContract,
    capabilityRevision: parseRevision(
      row.capability_revision,
      "Provider lifecycle capability revision"
    ),
    appActor,
    actionParticipant,
    automationCausation,
    occurredAt: parseTimestamp(
      row.occurred_at,
      "Provider lifecycle occurredAt"
    ),
    recordedAt: parseTimestamp(
      row.recorded_at,
      "Provider lifecycle recordedAt"
    ),
    createdAt: parseTimestamp(row.created_at, "Provider lifecycle createdAt")
  } as const;
  const initialOperation = inboxV2MessageProviderLifecycleOperationSchema.parse(
    {
      ...identity,
      outcome: mapProviderOutcomeRow(row, "initial_"),
      deleteLocalPolicy: mapProviderDeletePolicyRow(row, tenantId, "initial_"),
      revision: "1",
      updatedAt: identity.createdAt
    }
  );
  const operation = inboxV2MessageProviderLifecycleOperationSchema.parse({
    ...identity,
    outcome: mapProviderOutcomeRow(row, ""),
    deleteLocalPolicy: mapProviderDeletePolicyRow(row, tenantId, ""),
    revision: parseRevision(row.revision, "Provider lifecycle revision"),
    updatedAt: parseTimestamp(row.updated_at, "Provider lifecycle updatedAt")
  });
  return Object.freeze({
    operation,
    initialOperation,
    createdStreamPosition: inboxV2BigintCounterSchema.parse(
      parseDatabaseBigint(
        row.created_stream_position,
        "Provider lifecycle created stream position"
      )
    ),
    lastChangedStreamPosition: inboxV2BigintCounterSchema.parse(
      parseDatabaseBigint(
        row.last_changed_stream_position,
        "Provider lifecycle last-changed stream position"
      )
    )
  });
}

export function mapProviderLifecycleTransitionReadRow(
  row: Record<string, unknown>,
  tenantId: InboxV2TenantId
): InboxV2ProviderLifecycleTransitionRead {
  if (row.tenant_id !== tenantId) {
    throw invariantError(
      "Provider lifecycle transition crossed its tenant boundary."
    );
  }
  const operationId = inboxV2MessageProviderLifecycleOperationIdSchema.parse(
    row.operation_id
  );
  const resultProof =
    row.result_token === null
      ? null
      : {
          tenantId,
          operation: {
            tenantId,
            kind: "message_provider_lifecycle_operation" as const,
            id: operationId
          },
          outboundRoute: {
            tenantId,
            kind: "outbound_route" as const,
            id: row.result_proof_outbound_route_id
          },
          adapterContract: parseDigestedJson(
            row.result_proof_adapter_contract_detail,
            row.result_proof_adapter_contract_detail_digest_sha256,
            inboxV2AdapterContractSnapshotSchema,
            "Provider lifecycle result adapter contract"
          ),
          capabilityId: row.result_proof_capability_id,
          capabilityRevision: parseRevision(
            row.result_proof_capability_revision,
            "Provider lifecycle result capability revision"
          ),
          semanticId: row.result_proof_semantic_id,
          semanticRevision: parseRevision(
            row.result_proof_semantic_revision,
            "Provider lifecycle result semantic revision"
          ),
          resultState: row.result_proof_state,
          declaredByTrustedServiceId:
            row.result_proof_declared_by_trusted_service_id,
          resultToken: row.result_token,
          resultDigestSha256: requireSha256Digest(
            row.result_digest_sha256,
            "Provider lifecycle result digest"
          ),
          recordedAt: parseTimestamp(
            row.result_proof_recorded_at,
            "Provider lifecycle result recordedAt"
          ),
          revision: "1"
        };
  const transition = inboxV2MessageProviderLifecycleTransitionSchema.parse({
    operation: {
      tenantId,
      kind: "message_provider_lifecycle_operation",
      id: operationId
    },
    expectedRevision: parseRevision(
      row.expected_revision,
      "Provider lifecycle transition expected revision"
    ),
    resultingRevision: parseRevision(
      row.resulting_revision,
      "Provider lifecycle transition resulting revision"
    ),
    outcome: mapProviderOutcomeRow(row, ""),
    deleteLocalPolicy: mapProviderDeletePolicyRow(row, tenantId, ""),
    resultProof,
    recordedAt: parseTimestamp(
      row.recorded_at,
      "Provider lifecycle transition recordedAt"
    )
  });
  return Object.freeze({
    transition,
    recordedStreamPosition: inboxV2BigintCounterSchema.parse(
      parseDatabaseBigint(
        row.recorded_stream_position,
        "Provider lifecycle transition stream position"
      )
    )
  });
}

function mapProviderOutcomeRow(
  row: Record<string, unknown>,
  prefix: "" | "initial_"
): Record<string, unknown> {
  const state = row[`${prefix}outcome`];
  if (state === "failed") {
    const retryable = nullableInteger(row[`${prefix}outcome_retryable`]);
    if (retryable !== 0 && retryable !== 1) {
      throw invariantError("Provider lifecycle failed outcome is malformed.");
    }
    return {
      state,
      retryable: retryable === 1,
      reasonId: requireString(
        row[`${prefix}outcome_reason_id`],
        "Provider lifecycle failure reason"
      )
    };
  }
  if (state === "unsupported") {
    return {
      state,
      reasonId: requireString(
        row[`${prefix}outcome_reason_id`],
        "Provider lifecycle unsupported reason"
      )
    };
  }
  if (
    state === "observed" ||
    state === "pending" ||
    state === "accepted" ||
    state === "confirmed" ||
    state === "outcome_unknown"
  ) {
    return { state };
  }
  throw invariantError("Provider lifecycle outcome is unknown.");
}

function mapProviderDeletePolicyRow(
  row: Record<string, unknown>,
  tenantId: InboxV2TenantId,
  prefix: "" | "initial_"
): Record<string, unknown> | null {
  const effect = row[`${prefix}delete_local_effect`];
  if (effect === null || effect === undefined) return null;
  if (effect === "not_evaluated") return { effect };
  if (effect !== "retain_local" && effect !== "tombstone_local") {
    throw invariantError("Provider lifecycle delete policy is unknown.");
  }
  return {
    effect,
    decisionEvent: {
      tenantId,
      kind: "event",
      id: row[`${prefix}policy_decision_event_id`]
    },
    decisionRevision: parseRevision(
      row[`${prefix}policy_decision_revision`],
      "Provider lifecycle policy decision revision"
    ),
    decidedAt: parseTimestamp(
      row[`${prefix}policy_decided_at`],
      "Provider lifecycle policy decidedAt"
    )
  };
}

async function loadMessageHistory(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
    afterRevision: InboxV2EntityRevision | null;
    limit: number;
  }>
): Promise<ReturnType<typeof inboxV2MessageRevisionPageSchema.parse> | null> {
  const identity = await executor.execute<IdRow>(
    buildFindInboxV2MessageIdentitySql(input)
  );
  assertAtMostOneRow(identity, "Message history owner read");
  if (identity.rows.length === 0) return null;
  const result = await executor.execute<Record<string, unknown>>(
    buildListInboxV2MessageHistorySql(input)
  );
  const hasMore = result.rows.length > input.limit;
  const pageRows = result.rows.slice(0, input.limit);
  const revisions = pageRows.map((row) =>
    mapMessageRevisionRow(row, input.tenantId)
  );
  return inboxV2MessageRevisionPageSchema.parse({
    tenantId: input.tenantId,
    message: {
      tenantId: input.tenantId,
      kind: "message",
      id: input.messageId
    },
    revisions,
    nextCursor:
      hasMore && revisions.length > 0
        ? (revisions[revisions.length - 1]?.messageRevision ?? null)
        : null
  });
}

async function loadTimelinePage(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    anchor: Exclude<ListInboxV2TimelineInput["anchor"], undefined>;
    limit: number;
  }>
): Promise<ReturnType<typeof inboxV2TimelineItemPageSchema.parse>> {
  let aroundSequence: InboxV2TimelineSequence | null = null;
  if (input.anchor.kind === "around") {
    const sequenceResult = await executor.execute<{
      timeline_sequence: unknown;
    }>(
      buildFindInboxV2TimelineItemSequenceSql({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        timelineItemId: input.anchor.timelineItemId
      })
    );
    assertAtMostOneRow(sequenceResult, "Timeline around-anchor read");
    aroundSequence =
      sequenceResult.rows[0] === undefined
        ? null
        : parseTimelineSequence(
            sequenceResult.rows[0].timeline_sequence,
            "Timeline around-anchor sequence"
          );
  }
  const result = await executor.execute<Record<string, unknown>>(
    buildListInboxV2TimelineSql({
      ...input,
      aroundSequence,
      limit: input.limit
    })
  );
  const hasExtra = result.rows.length > input.limit;
  let pageRows = result.rows.slice(0, input.limit);
  if (input.anchor.kind !== "after") pageRows = [...pageRows].reverse();
  const items = pageRows.map((row) => mapTimelineRow(row, input.tenantId));
  const anchor =
    input.anchor.kind === "around"
      ? {
          kind: "around" as const,
          timelineItem: {
            tenantId: input.tenantId,
            kind: "timeline_item" as const,
            id: input.anchor.timelineItemId
          }
        }
      : input.anchor;
  return inboxV2TimelineItemPageSchema.parse({
    tenantId: input.tenantId,
    conversation: {
      tenantId: input.tenantId,
      kind: "conversation",
      id: input.conversationId
    },
    anchor,
    items,
    hasMoreBefore:
      input.anchor.kind === "after"
        ? items.length > 0
        : input.anchor.kind === "around"
          ? (items[0]?.timelineSequence ?? "0") !== "1"
          : hasExtra,
    hasMoreAfter:
      input.anchor.kind === "after"
        ? hasExtra
        : input.anchor.kind === "before"
          ? items.length > 0
          : false
  });
}

export function buildLockInboxV2TimelineConversationHeadSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}): SQL {
  return sql`
    select c.id, h.revision, h.latest_timeline_sequence,
           h.latest_activity_item_id, h.latest_activity_timeline_sequence,
           h.latest_activity_at, h.updated_at
      from inbox_v2_conversations c
      inner join inbox_v2_conversation_heads h
        on h.tenant_id = c.tenant_id
       and h.conversation_id = c.id
     where c.tenant_id = ${input.tenantId}
       and c.id = ${input.conversationId}
     for update of c, h
  `;
}

export function buildFindInboxV2MessageAuthorSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  participantId: string;
}): SQL {
  return sql`
    select id
      from inbox_v2_conversation_participants
     where tenant_id = ${input.tenantId}
       and conversation_id = ${input.conversationId}
       and id = ${input.participantId}
     for key share
  `;
}

export function buildFindInboxV2MessageSourceOccurrenceSql(input: {
  tenantId: InboxV2TenantId;
  sourceOccurrenceId: string;
}): SQL {
  return sql`
    select id, resolution_state, revision, updated_at
      from inbox_v2_source_occurrences
     where tenant_id = ${input.tenantId}
       and id = ${input.sourceOccurrenceId}
     for update
  `;
}

export function buildFindInboxV2TimelineMessageSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
  lock?: boolean;
}): SQL {
  const lockClause = input.lock
    ? sql`for update of timeline_row, content_row, message_row`
    : sql``;
  return sql`
    select
      clock_timestamp() as database_now,
      message_row.tenant_id,
      message_row.id as message_id,
      message_row.conversation_id,
      message_row.timeline_item_id,
      message_row.author_participant_id,
      message_row.origin_kind,
      message_row.origin_source_occurrence_id,
      message_row.origin_source_direction,
      message_row.claim_at_occurrence_id,
      message_row.claim_at_occurrence_version,
      message_row.claim_resolved_employee_id,
      message_row.origin_outbound_route_id,
      message_row.migration_provenance_id,
      attribution_row.app_actor_kind,
      attribution_row.app_actor_employee_id,
      attribution_row.app_authorization_epoch,
      attribution_row.app_trusted_service_id,
      attribution_row.automation_kind,
      attribution_row.automation_cause_event_id,
      attribution_row.automation_correlation_id,
      attribution_row.automation_caused_at,
      attribution_row.automation_initiating_employee_id,
      attribution_row.automation_initiating_authorization_epoch,
      message_row.content_id,
      message_row.content_revision,
      message_row.content_state,
      content_row.content_digest_sha256,
      content_row.tombstone_event_id,
      content_row.tombstone_reason_id,
      content_row.retention_policy_id,
      content_row.retention_policy_version,
      content_row.retention_policy_revision,
      message_row.reference_kind,
      message_row.lifecycle,
      message_row.lifecycle_revision_id,
      message_row.lifecycle_reason_id,
      message_row.lifecycle_provider_operation_id,
      message_row.lifecycle_policy_reason_id,
      message_row.lifecycle_changed_at,
      message_row.revision as message_revision,
      message_row.created_at as message_created_at,
      message_row.updated_at as message_updated_at,
      message_row.last_changed_stream_position as message_last_changed_stream_position,
      timeline_row.revision as timeline_revision,
      timeline_row.timeline_sequence,
      timeline_row.subject_kind as timeline_subject_kind,
      timeline_row.subject_id as timeline_subject_id,
      timeline_row.visibility as timeline_visibility,
      timeline_row.activity_kind as timeline_activity_kind,
      timeline_row.activity_source_occurrence_id as timeline_activity_source_occurrence_id,
      timeline_row.activity_reason_id as timeline_activity_reason_id,
      timeline_row.migration_provenance_id as timeline_migration_provenance_id,
      timeline_row.activity_imported_at as timeline_activity_imported_at,
      timeline_row.occurred_at as timeline_occurred_at,
      timeline_row.received_at as timeline_received_at,
      timeline_row.created_at as timeline_created_at,
      timeline_row.updated_at as timeline_updated_at,
      timeline_row.last_changed_stream_position as timeline_last_changed_stream_position
    from inbox_v2_messages message_row
    inner join inbox_v2_timeline_items timeline_row
      on timeline_row.tenant_id = message_row.tenant_id
     and timeline_row.id = message_row.timeline_item_id
     and timeline_row.conversation_id = message_row.conversation_id
    inner join inbox_v2_timeline_contents content_row
      on content_row.tenant_id = message_row.tenant_id
     and content_row.id = message_row.content_id
    inner join inbox_v2_action_attributions attribution_row
      on attribution_row.tenant_id = message_row.tenant_id
     and attribution_row.id = message_row.creation_attribution_id
     and attribution_row.conversation_id = message_row.conversation_id
    where message_row.tenant_id = ${input.tenantId}
      and message_row.id = ${input.messageId}
    ${lockClause}
  `;
}

export function buildFindInboxV2MessageReferenceContextSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select *
      from inbox_v2_message_reference_contexts
     where tenant_id = ${input.tenantId}
       and message_id = ${input.messageId}
  `;
}

export function buildListInboxV2MessageReferenceCanonicalTargetsSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select *
      from inbox_v2_message_reference_canonical_targets
     where tenant_id = ${input.tenantId}
       and message_id = ${input.messageId}
     order by ordinal asc
  `;
}

export function buildListInboxV2MessageReferenceExternalTargetsSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select *
      from inbox_v2_message_reference_external_targets
     where tenant_id = ${input.tenantId}
       and message_id = ${input.messageId}
     order by ordinal asc
  `;
}

export function buildFindInboxV2MessageReferenceUnresolvedTargetSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select target_row.*,
           occurrence_row.external_thread_id,
           occurrence_row.message_realm_id,
           occurrence_row.message_realm_version,
           occurrence_row.message_canonicalization_version,
           occurrence_row.message_scope_kind,
           occurrence_row.message_scope_source_account_id,
           occurrence_row.message_scope_source_thread_binding_id,
           occurrence_row.message_object_kind_id,
           occurrence_row.canonical_external_subject
      from inbox_v2_message_reference_unresolved_targets target_row
      inner join inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = target_row.tenant_id
       and occurrence_row.id = target_row.source_occurrence_id
     where target_row.tenant_id = ${input.tenantId}
       and target_row.message_id = ${input.messageId}
  `;
}

export function buildListInboxV2MessageReferenceUnresolvedCandidatesSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select *
      from inbox_v2_message_reference_unresolved_candidates
     where tenant_id = ${input.tenantId}
       and message_id = ${input.messageId}
     order by ordinal asc
  `;
}

export function buildAdvanceInboxV2TimelineConversationHeadSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  expectedRevision: InboxV2EntityRevision;
  expectedLatestSequence: string;
  latestSequence: string;
  latestActivityItemId: InboxV2TimelineItemId | null;
  latestActivitySequence: string | null;
  latestActivityAt: string | null;
  streamPosition: InboxV2BigintCounter;
  changedAt: string;
}): SQL {
  return sql`
    update inbox_v2_conversation_heads
       set latest_timeline_sequence = ${input.latestSequence},
           latest_activity_item_id = ${input.latestActivityItemId},
           latest_activity_timeline_sequence = ${input.latestActivitySequence},
           latest_activity_at = ${input.latestActivityAt},
           revision = revision + 1,
           last_changed_stream_position = ${input.streamPosition},
           updated_at = ${input.changedAt}
     where tenant_id = ${input.tenantId}
       and conversation_id = ${input.conversationId}
       and revision = ${input.expectedRevision}
       and latest_timeline_sequence = ${input.expectedLatestSequence}
    returning conversation_id as id
  `;
}

export function buildInsertInboxV2ActionAttributionSql(input: {
  tenantId: InboxV2TenantId;
  id: string;
  conversationId: InboxV2ConversationId;
  attribution: InboxV2MessageRevision["actionAttribution"];
  createdAt: string;
}): SQL {
  const actor = actionAttributionColumns(input.attribution);
  return sql`
    insert into inbox_v2_action_attributions (
      tenant_id, id, conversation_id, action_participant_id,
      app_actor_kind, app_actor_employee_id, app_authorization_epoch,
      app_trusted_service_id, source_occurrence_id,
      automation_kind, automation_cause_event_id,
      automation_correlation_id, automation_caused_at,
      automation_initiating_employee_id,
      automation_initiating_authorization_epoch, created_at
    ) values (
      ${input.tenantId}, ${input.id}, ${input.conversationId},
      ${input.attribution.actionParticipant?.id ?? null},
      ${actor.appActorKind}, ${actor.appActorEmployeeId},
      ${actor.appAuthorizationEpoch}, ${actor.appTrustedServiceId},
      ${input.attribution.sourceOccurrence?.id ?? null},
      ${actor.automationKind}, ${actor.automationCauseEventId},
      ${actor.automationCorrelationId}, ${actor.automationCausedAt},
      ${actor.automationInitiatingEmployeeId},
      ${actor.automationInitiatingAuthorizationEpoch}, ${input.createdAt}
    )
    returning id
  `;
}

function buildFindInboxV2ClaimedMessageAttachmentAnchorsSql(input: {
  tenantId: InboxV2TenantId;
  attachmentIds: readonly string[];
}): SQL {
  if (input.attachmentIds.length === 0) {
    throw invariantError("Attachment-anchor conflict lookup cannot be empty.");
  }
  return sql`
    select id
      from inbox_v2_message_attachment_anchors
     where tenant_id = ${input.tenantId}
       and id in (${sql.join(
         input.attachmentIds.map((attachmentId) => sql`${attachmentId}`),
         sql`, `
       )})
     order by id collate "C"
     for update
  `;
}

function buildInsertInboxV2MessageAttachmentAnchorsSql(
  input: Readonly<{
    tenantId: InboxV2TenantId;
    messageId: string;
    timelineItemId: string;
    timelineContentId: string;
    blocks: readonly InboxV2MessageAttachmentAnchorBlock[];
    createdAt: string;
  }>
): SQL {
  if (input.blocks.length === 0) {
    throw invariantError("Attachment-anchor insert cannot be empty.");
  }
  const rows = input.blocks.map(
    (block) => sql`(
      ${input.tenantId}, ${block.attachmentId}, ${input.messageId},
      ${input.timelineItemId}, ${input.timelineContentId}, ${block.blockKey},
      ${block.materializationState}, 1, ${input.createdAt}::timestamptz
    )`
  );
  return sql`
    insert into inbox_v2_message_attachment_anchors (
      tenant_id, id, owner_message_id, owner_timeline_item_id,
      owner_timeline_content_id, owner_block_key, materialization_state,
      revision, created_at
    ) values ${sql.join(rows, sql`, `)}
    returning id
  `;
}

export function buildInsertInboxV2TimelineContentSql(input: {
  tenantId: InboxV2TenantId;
  ownerKind: "message" | "staff_note";
  ownerId: string;
  processingPurposeId: string;
  retentionAnchorAt: string;
  content: InboxV2TimelineContent;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const state = contentStateColumns(input.content);
  return sql`
    insert into inbox_v2_timeline_contents (
      tenant_id, id, owner_kind, owner_id, data_class_id,
      processing_purpose_id, retention_anchor_at, state,
      content_digest_sha256, tombstone_event_id, tombstone_reason_id,
      retention_policy_id, retention_policy_version,
      retention_policy_revision, state_changed_at, revision,
      last_changed_stream_position, created_at, updated_at
    ) values (
      ${input.tenantId}, ${input.content.id}, ${input.ownerKind},
      ${input.ownerId},
      ${input.ownerKind === "message" ? "core:message_content_blocks" : "core:staff_note_content_blocks"},
      ${input.processingPurposeId}, ${input.retentionAnchorAt},
      ${input.content.state.kind}, ${state.contentDigestSha256},
      ${state.tombstoneEventId}, ${state.tombstoneReasonId},
      ${state.retentionPolicyId}, ${state.retentionPolicyVersion},
      ${state.retentionPolicyRevision}, ${input.content.updatedAt},
      ${input.content.revision}, ${input.streamPosition},
      ${input.content.createdAt}, ${input.content.updatedAt}
    )
    returning id
  `;
}

export function buildInsertInboxV2TimelineContentRevisionSql(input: {
  tenantId: InboxV2TenantId;
  content: InboxV2TimelineContent;
  transitionKind:
    | "created"
    | "edit"
    | "attachment_materialization"
    | "privacy_erasure"
    | "retention_purge";
  expectedPreviousRevision: InboxV2EntityRevision | null;
  eventId: string | null;
  occurredAt: string;
  recordedAt: string;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const state = contentStateColumns(input.content);
  return sql`
    insert into inbox_v2_timeline_content_revisions (
      tenant_id, content_id, revision, expected_previous_revision,
      transition_kind, state, event_id, reason_id,
      retention_policy_id, retention_policy_version,
      retention_policy_revision, occurred_at, recorded_at,
      recorded_stream_position, record_revision
    ) values (
      ${input.tenantId}, ${input.content.id}, ${input.content.revision},
      ${input.expectedPreviousRevision}, ${input.transitionKind},
      ${input.content.state.kind}, ${input.eventId}, ${state.tombstoneReasonId},
      ${state.retentionPolicyId}, ${state.retentionPolicyVersion},
      ${state.retentionPolicyRevision}, ${input.occurredAt},
      ${input.recordedAt}, ${input.streamPosition}, 1
    )
    returning content_id as id
  `;
}

export function buildInsertInboxV2TimelineContentPayloadSql(input: {
  tenantId: InboxV2TenantId;
  contentId: string;
  contentRevision: InboxV2EntityRevision;
  blocks: readonly InboxV2MessageContentBlock[];
  createdAt: string;
}): SQL | null {
  if (input.blocks.length === 0) return null;
  const rows = input.blocks.map((block, ordinal) => {
    const columns = contentBlockColumns(block);
    return sql`(
      ${input.tenantId}, ${input.contentId}, ${input.contentRevision},
      ${ordinal}, ${block.blockKey}, ${block.kind},
      ${columns.textRole}, ${columns.textValue}, ${columns.language},
      ${columns.attachmentId}, ${columns.attachmentState},
      ${columns.attachmentFileId}, ${columns.attachmentV2FileId},
      ${columns.attachmentFileRevision},
      ${columns.attachmentFileVersionId},
      ${columns.attachmentObjectVersionId},
      ${columns.attachmentFailureReasonId},
      ${columns.displayName}, ${columns.mediaSemantic},
      ${columns.latitude}, ${columns.longitude}, ${columns.accuracyMeters},
      ${columns.locationMode}, ${columns.liveUntil}, ${columns.headingDegrees},
      ${columns.locationLabel}, ${columns.locationAddress},
      ${columns.contactDisplayName}, ${columns.contactOrganization},
      ${columns.unsupportedSourceOccurrenceId},
      ${columns.providerContentKindId}, ${columns.safeFallbackReasonId},
      ${columns.extensionBlockKindId}, ${columns.extensionPayloadSchemaId},
      ${columns.extensionPayloadSchemaVersion},
      ${columns.extensionPayloadFileId},
      ${columns.extensionPayloadV2FileId},
      ${columns.extensionPayloadFileRevision},
      ${columns.extensionPayloadFileVersionId},
      ${columns.extensionPayloadObjectVersionId},
      ${columns.extensionPayloadDigestSha256}, ${columns.extensionRendererId},
      ${input.createdAt}
    )`;
  });
  return sql`
    insert into inbox_v2_timeline_content_payloads (
      tenant_id, content_id, content_revision, ordinal, block_key, kind,
      text_role, text_value, language, attachment_id, attachment_state,
      attachment_file_id, attachment_v2_file_id,
      attachment_file_revision,
      attachment_file_version_id, attachment_object_version_id,
      attachment_failure_reason_id, display_name,
      media_semantic, latitude, longitude, accuracy_meters, location_mode,
      live_until, heading_degrees, location_label, location_address,
      contact_display_name, contact_organization,
      unsupported_source_occurrence_id, provider_content_kind_id,
      safe_fallback_reason_id, extension_block_kind_id,
      extension_payload_schema_id, extension_payload_schema_version,
      extension_payload_file_id, extension_payload_v2_file_id,
      extension_payload_file_revision,
      extension_payload_file_version_id,
      extension_payload_object_version_id,
      extension_payload_digest_sha256,
      extension_renderer_id, created_at
    ) values ${sql.join(rows, sql`, `)}
    returning content_id as id
  `;
}

export function buildInsertInboxV2TimelineContentContactValuesSql(input: {
  tenantId: InboxV2TenantId;
  contentId: string;
  contentRevision: InboxV2EntityRevision;
  blocks: readonly InboxV2MessageContentBlock[];
}): SQL | null {
  const rows = input.blocks.flatMap((block, blockOrdinal) =>
    block.kind !== "contact"
      ? []
      : block.values.map(
          (value, valueOrdinal) => sql`(
            ${input.tenantId}, ${input.contentId}, ${input.contentRevision},
            ${blockOrdinal}, ${valueOrdinal}, ${value.kind}, ${value.value},
            ${value.label}
          )`
        )
  );
  if (rows.length === 0) return null;
  return sql`
    insert into inbox_v2_timeline_content_contact_values (
      tenant_id, content_id, content_revision, block_ordinal,
      value_ordinal, kind, value, label
    ) values ${sql.join(rows, sql`, `)}
    returning content_id as id
  `;
}

export function buildPurgeInboxV2TimelineContentPayloadSql(input: {
  tenantId: InboxV2TenantId;
  contentId: string;
}): SQL {
  return sql`
    delete from inbox_v2_timeline_content_payloads
     where tenant_id = ${input.tenantId}
       and content_id = ${input.contentId}
  `;
}

export function buildInsertInboxV2TimelineItemSql(input: {
  item: InboxV2TimelineItem;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const activity = timelineActivityColumns(input.item);
  const subjectId = timelineSubjectId(input.item);
  return sql`
    insert into inbox_v2_timeline_items (
      tenant_id, id, conversation_id, timeline_sequence,
      subject_kind, subject_id, visibility, activity_kind,
      activity_source_occurrence_id, activity_reason_id,
      migration_provenance_id, activity_imported_at,
      occurred_at, received_at, revision, last_changed_stream_position,
      created_at, updated_at
    ) values (
      ${input.item.tenantId}, ${input.item.id},
      ${input.item.conversation.id}, ${input.item.timelineSequence},
      ${input.item.subject.kind}, ${subjectId}, ${input.item.visibility},
      ${input.item.activity.kind}, ${activity.sourceOccurrenceId},
      ${activity.reasonId}, ${activity.migrationProvenanceId},
      ${activity.importedAt}, ${input.item.occurredAt},
      ${input.item.receivedAt}, ${input.item.revision},
      ${input.streamPosition}, ${input.item.createdAt}, ${input.item.updatedAt}
    )
    returning id
  `;
}

export function buildInsertInboxV2MessageSql(input: {
  message: InboxV2Message;
  creationAttributionId: string;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const origin = messageOriginColumns(input.message);
  const lifecycle = messageLifecycleColumns(input.message);
  return sql`
    insert into inbox_v2_messages (
      tenant_id, id, conversation_id, timeline_item_id,
      author_participant_id, origin_kind, origin_source_occurrence_id,
      origin_source_direction, claim_at_occurrence_id,
      claim_at_occurrence_version, claim_resolved_employee_id,
      origin_outbound_route_id, migration_provenance_id,
      creation_attribution_id, content_id, content_revision, content_state,
      reference_kind, lifecycle, lifecycle_revision_id,
      lifecycle_reason_id, lifecycle_provider_operation_id,
      lifecycle_policy_reason_id, lifecycle_changed_at, revision,
      last_changed_stream_position, created_at, updated_at
    ) values (
      ${input.message.tenantId}, ${input.message.id},
      ${input.message.conversation.id}, ${input.message.timelineItem.id},
      ${input.message.authorParticipant.id}, ${input.message.origin.kind},
      ${origin.sourceOccurrenceId}, ${origin.sourceDirection},
      ${origin.claimId}, ${origin.claimVersion}, ${origin.claimEmployeeId},
      ${origin.outboundRouteId}, ${origin.migrationProvenanceId},
      ${input.creationAttributionId}, ${input.message.content.content.id},
      ${input.message.content.contentRevision}, ${input.message.content.stateKind},
      ${messageReferenceKind(input.message)}, ${input.message.lifecycle.kind},
      ${lifecycle.revisionId}, ${lifecycle.reasonId},
      ${lifecycle.providerOperationId}, ${lifecycle.policyReasonId},
      ${lifecycle.changedAt}, ${input.message.revision},
      ${input.streamPosition}, ${input.message.createdAt},
      ${input.message.updatedAt}
    )
    returning id
  `;
}

export function buildInsertInboxV2MessageReferenceContextSql(
  message: InboxV2Message
): SQL {
  const context = messageReferenceContextColumns(message);
  return sql`
    insert into inbox_v2_message_reference_contexts (
      tenant_id, message_id, kind, origin_source_occurrence_id,
      provenance_completeness, native_capability_id,
      native_capability_revision, native_adapter_contract_id,
      native_adapter_contract_version, native_adapter_declaration_revision,
      native_adapter_surface_id,
      native_adapter_loaded_by_trusted_service_id,
      native_adapter_loaded_at, revision, created_at
    ) values (
      ${message.tenantId}, ${message.id}, ${context.kind},
      ${context.originSourceOccurrenceId}, ${context.provenanceCompleteness},
      ${context.nativeCapabilityId}, ${context.nativeCapabilityRevision},
      ${context.nativeAdapterContractId},
      ${context.nativeAdapterContractVersion},
      ${context.nativeAdapterDeclarationRevision},
      ${context.nativeAdapterSurfaceId},
      ${context.nativeAdapterLoadedByTrustedServiceId},
      ${context.nativeAdapterLoadedAt}, 1, ${message.createdAt}
    )
    returning message_id as id
  `;
}

export function buildInsertInboxV2MessageReferenceCanonicalTargetsSql(
  message: InboxV2Message
): SQL | null {
  const targets = canonicalReferenceTargets(message);
  if (targets.length === 0) return null;
  return sql`
    insert into inbox_v2_message_reference_canonical_targets (
      tenant_id, message_id, ordinal, target_message_id,
      target_timeline_item_id, target_message_revision, created_at
    ) values ${sql.join(
      targets.map(
        (target, ordinal) => sql`(
          ${message.tenantId}, ${message.id}, ${ordinal},
          ${target.message.id}, ${target.timelineItem.id},
          ${target.messageRevision}, ${message.createdAt}
        )`
      ),
      sql`, `
    )}
    returning message_id as id
  `;
}

export function buildInsertInboxV2MessageReferenceExternalTargetsSql(
  message: InboxV2Message
): SQL | null {
  const targets = externalReferenceTargets(message);
  if (targets.length === 0) return null;
  return sql`
    insert into inbox_v2_message_reference_external_targets (
      tenant_id, message_id, ordinal, external_message_reference_id,
      source_occurrence_id, created_at
    ) values ${sql.join(
      targets.map(
        (target, ordinal) => sql`(
          ${message.tenantId}, ${message.id}, ${ordinal},
          ${target.externalMessageReference.id},
          ${target.sourceOccurrence.id}, ${message.createdAt}
        )`
      ),
      sql`, `
    )}
    returning message_id as id
  `;
}

export function buildInsertInboxV2MessageReferenceUnresolvedTargetSql(
  message: InboxV2Message
): SQL | null {
  const target = unresolvedReferenceTarget(message);
  if (target === null) return null;
  return sql`
    insert into inbox_v2_message_reference_unresolved_targets (
      tenant_id, message_id, external_message_key_digest_sha256,
      source_occurrence_id, resolution_state, created_at
    ) values (
      ${message.tenantId}, ${message.id},
      ${computeInboxV2TimelineMessageCommitDigest(target.externalMessageKey)},
      ${target.sourceOccurrence.id}, ${target.resolution.state},
      ${message.createdAt}
    )
    returning message_id as id
  `;
}

export function buildInsertInboxV2MessageReferenceUnresolvedCandidatesSql(
  message: InboxV2Message
): SQL | null {
  const target = unresolvedReferenceTarget(message);
  const candidates =
    target?.resolution.state === "conflicted"
      ? target.resolution.candidates
      : [];
  if (candidates.length === 0) return null;
  return sql`
    insert into inbox_v2_message_reference_unresolved_candidates (
      tenant_id, message_id, ordinal, external_message_reference_id,
      created_at
    ) values ${sql.join(
      candidates.map(
        (candidate, ordinal) => sql`(
          ${message.tenantId}, ${message.id}, ${ordinal}, ${candidate.id},
          ${message.createdAt}
        )`
      ),
      sql`, `
    )}
    returning message_id as id
  `;
}

export function buildFindInboxV2MessageReactionSql(input: {
  tenantId: InboxV2TenantId;
  reactionId: string;
  lock?: boolean;
}): SQL {
  const lockClause = input.lock ? sql`for update` : sql``;
  return sql`
    select *
      from inbox_v2_message_reactions
     where tenant_id = ${input.tenantId}
       and id = ${input.reactionId}
     ${lockClause}
  `;
}

export function buildLockInboxV2MessageReactionSlotHeadSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
  semanticSlotKey: string;
}): SQL {
  return sql`
    select *
      from inbox_v2_message_reaction_slot_heads
     where tenant_id = ${input.tenantId}
       and message_id = ${input.messageId}
       and semantic_slot_key = ${input.semanticSlotKey}
     for update
  `;
}

export function buildFindInboxV2MessageReactionTransitionSql(input: {
  tenantId: InboxV2TenantId;
  transitionId: string;
}): SQL {
  return sql`
    select transition_row.*,
           attribution_row.action_participant_id,
           attribution_row.app_actor_kind,
           attribution_row.app_actor_employee_id,
           attribution_row.app_authorization_epoch,
           attribution_row.app_trusted_service_id,
           attribution_row.source_occurrence_id as attribution_source_occurrence_id,
           attribution_row.automation_kind,
           attribution_row.automation_cause_event_id,
           attribution_row.automation_correlation_id,
           attribution_row.automation_caused_at,
           attribution_row.automation_initiating_employee_id,
           attribution_row.automation_initiating_authorization_epoch
      from inbox_v2_message_reaction_transitions transition_row
      join inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = transition_row.tenant_id
       and attribution_row.id = transition_row.action_attribution_id
     where transition_row.tenant_id = ${input.tenantId}
       and transition_row.id = ${input.transitionId}
  `;
}

export function buildFindInboxV2ProviderReactionObservationSql(input: {
  tenantId: InboxV2TenantId;
  transitionId: string;
}): SQL {
  return sql`
    select *
      from inbox_v2_message_provider_reaction_observations
     where tenant_id = ${input.tenantId}
       and transition_id = ${input.transitionId}
  `;
}

export function buildInsertInboxV2MessageReactionSql(input: {
  reaction: InboxV2MessageReactionCommit["afterReaction"];
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const reaction = input.reaction;
  const actor = reactionActorColumns(reaction.actor);
  const capability = reactionCapabilityColumns(reaction.capability);
  const state = reactionStateColumns(reaction.state);
  return sql`
    insert into inbox_v2_message_reactions (
      tenant_id, id, message_id, actor_kind, actor_participant_id,
      actor_source_occurrence_id, opaque_actor_key,
      opaque_actor_key_digest_sha256, aggregate_scope,
      provider_actor_kind_id, provider_actor_subject,
      provider_actor_subject_digest_sha256, actor_identity_data_class_id,
      actor_identity_state, actor_identity_tombstone_event_id,
      actor_identity_purged_at, capability_kind, capability_id,
      capability_revision, cardinality, adapter_contract_id,
      adapter_contract_version, capability_detail,
      capability_detail_digest_sha256, semantic_slot_key, state_kind,
      value_kind, unicode_value, provider_reaction_kind_id,
      provider_canonical_code, cleared_at, external_operation,
      outbound_route_id, request_transition_id, request_attribution_id,
      external_outcome, result_token, result_digest_sha256, resolved_at,
      state_detail, state_detail_digest_sha256, revision,
      last_changed_stream_position, created_at, updated_at
    ) values (
      ${reaction.tenantId}, ${reaction.id}, ${reaction.message.id},
      ${reaction.actor.kind}, ${actor.participantId},
      ${actor.sourceOccurrenceId}, ${actor.opaqueActorKey},
      ${actor.opaqueActorKeyDigestSha256}, ${actor.aggregateScope},
      ${actor.providerActorKindId}, ${actor.providerActorSubject},
      ${actor.providerActorSubjectDigestSha256}, ${actor.identityDataClassId},
      ${actor.identityState}, ${actor.identityTombstoneEventId},
      ${actor.identityPurgedAt}, ${reaction.capability.kind},
      ${capability.capabilityId}, ${capability.capabilityRevision},
      ${reaction.capability.cardinality}, ${capability.adapterContractId},
      ${capability.adapterContractVersion}, ${jsonbDetail(reaction.capability)},
      ${computeInboxV2TimelineMessageCommitDigest(reaction.capability)},
      ${reaction.semanticSlotKey}, ${reaction.state.kind}, ${state.valueKind},
      ${state.unicodeValue}, ${state.providerReactionKindId},
      ${state.providerCanonicalCode}, ${state.clearedAt},
      ${state.externalOperation}, ${state.outboundRouteId},
      ${state.requestTransitionId}, ${state.requestAttributionId},
      ${state.externalOutcome}, ${state.resultToken},
      ${state.resultDigestSha256}, ${state.resolvedAt},
      ${jsonbDetail(reaction.state)},
      ${computeInboxV2TimelineMessageCommitDigest(reaction.state)},
      ${reaction.revision}, ${input.streamPosition}, ${reaction.createdAt},
      ${reaction.updatedAt}
    )
    returning id
  `;
}

export function buildAdvanceInboxV2MessageReactionSql(input: {
  before: NonNullable<InboxV2MessageReactionCommit["beforeReaction"]>;
  after: InboxV2MessageReactionCommit["afterReaction"];
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const state = reactionStateColumns(input.after.state);
  return sql`
    update inbox_v2_message_reactions
       set state_kind = ${input.after.state.kind},
           value_kind = ${state.valueKind},
           unicode_value = ${state.unicodeValue},
           provider_reaction_kind_id = ${state.providerReactionKindId},
           provider_canonical_code = ${state.providerCanonicalCode},
           cleared_at = ${state.clearedAt},
           external_operation = ${state.externalOperation},
           outbound_route_id = ${state.outboundRouteId},
           request_transition_id = ${state.requestTransitionId},
           request_attribution_id = ${state.requestAttributionId},
           external_outcome = ${state.externalOutcome},
           result_token = ${state.resultToken},
           result_digest_sha256 = ${state.resultDigestSha256},
           resolved_at = ${state.resolvedAt},
           state_detail = ${jsonbDetail(input.after.state)},
           state_detail_digest_sha256 = ${computeInboxV2TimelineMessageCommitDigest(
             input.after.state
           )},
           revision = ${input.after.revision},
           last_changed_stream_position = ${input.streamPosition},
           updated_at = ${input.after.updatedAt}
     where tenant_id = ${input.before.tenantId}
       and id = ${input.before.id}
       and message_id = ${input.before.message.id}
       and semantic_slot_key = ${input.before.semanticSlotKey}
       and revision = ${input.before.revision}
       and state_detail_digest_sha256 = ${computeInboxV2TimelineMessageCommitDigest(
         input.before.state
       )}
    returning id
  `;
}

export function buildInsertInboxV2MessageReactionTransitionSql(input: {
  commit: InboxV2MessageReactionCommit;
  actionAttributionId: string;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const { commit } = input;
  const transition = commit.transition;
  const afterState = reactionStateColumns(transition.afterState);
  const authority = reactionExternalAuthorityColumns(
    transition.externalAuthority
  );
  const resultProof = commit.providerResultProof;
  return sql`
    insert into inbox_v2_message_reaction_transitions (
      tenant_id, id, reaction_id, semantic_slot_key, mode, operation,
      expected_revision, resulting_revision, before_state_kind,
      after_state_kind, before_state_detail,
      before_state_detail_digest_sha256, after_state_detail,
      after_state_detail_digest_sha256, value_kind, unicode_value,
      provider_reaction_kind_id, provider_canonical_code,
      action_attribution_id, external_message_reference_id,
      source_occurrence_id, source_account_id, source_thread_binding_id,
      binding_generation, outbound_route_id, capability_id,
      capability_revision, adapter_contract_id, adapter_contract_version,
      external_authority_detail, external_authority_detail_digest_sha256,
      provider_result_proof_detail,
      provider_result_proof_detail_digest_sha256, result_token,
      result_digest_sha256, occurred_at, recorded_at,
      recorded_stream_position, record_revision
    ) values (
      ${commit.tenantId}, ${transition.id}, ${transition.reaction.id},
      ${transition.semanticSlotKey}, ${transition.mode},
      ${transition.operation}, ${transition.expectedRevision},
      ${transition.resultingRevision},
      ${transition.beforeState?.kind ?? null}, ${transition.afterState.kind},
      ${jsonbDetail(transition.beforeState)},
      ${
        transition.beforeState === null
          ? null
          : computeInboxV2TimelineMessageCommitDigest(transition.beforeState)
      },
      ${jsonbDetail(transition.afterState)},
      ${computeInboxV2TimelineMessageCommitDigest(transition.afterState)},
      ${afterState.valueKind}, ${afterState.unicodeValue},
      ${afterState.providerReactionKindId}, ${afterState.providerCanonicalCode},
      ${input.actionAttributionId}, ${authority.externalMessageReferenceId},
      ${authority.sourceOccurrenceId}, ${authority.sourceAccountId},
      ${authority.sourceThreadBindingId}, ${authority.bindingGeneration},
      ${authority.outboundRouteId}, ${authority.capabilityId},
      ${authority.capabilityRevision}, ${authority.adapterContractId},
      ${authority.adapterContractVersion},
      ${jsonbDetail(transition.externalAuthority)},
      ${
        transition.externalAuthority === null
          ? null
          : computeInboxV2TimelineMessageCommitDigest(
              transition.externalAuthority
            )
      },
      ${jsonbDetail(resultProof)},
      ${
        resultProof === null
          ? null
          : computeInboxV2TimelineMessageCommitDigest(resultProof)
      },
      ${resultProof?.resultToken ?? null},
      ${resultProof?.resultDigestSha256 ?? null}, ${transition.occurredAt},
      ${transition.recordedAt}, ${input.streamPosition},
      ${transition.recordRevision}
    )
    returning id
  `;
}

export function buildInsertInboxV2MessageReactionSlotHeadSql(input: {
  head: InboxV2MessageReactionCommit["slotHeadAfter"];
  streamPosition: InboxV2BigintCounter;
}): SQL {
  return sql`
    insert into inbox_v2_message_reaction_slot_heads (
      tenant_id, message_id, semantic_slot_key, reaction_id, state_kind,
      revision, last_changed_stream_position, updated_at
    ) values (
      ${input.head.tenantId}, ${input.head.message.id},
      ${input.head.semanticSlotKey}, ${input.head.reaction.id},
      ${input.head.state.kind}, ${input.head.revision},
      ${input.streamPosition}, ${input.head.updatedAt}
    )
    returning reaction_id as id
  `;
}

export function buildAdvanceInboxV2MessageReactionSlotHeadSql(input: {
  before: NonNullable<InboxV2MessageReactionCommit["slotHeadBefore"]>;
  after: InboxV2MessageReactionCommit["slotHeadAfter"];
  streamPosition: InboxV2BigintCounter;
}): SQL {
  return sql`
    update inbox_v2_message_reaction_slot_heads
       set reaction_id = ${input.after.reaction.id},
           state_kind = ${input.after.state.kind},
           revision = ${input.after.revision},
           last_changed_stream_position = ${input.streamPosition},
           updated_at = ${input.after.updatedAt}
     where tenant_id = ${input.before.tenantId}
       and message_id = ${input.before.message.id}
       and semantic_slot_key = ${input.before.semanticSlotKey}
       and reaction_id = ${input.before.reaction.id}
       and state_kind = ${input.before.state.kind}
       and revision = ${input.before.revision}
    returning reaction_id as id
  `;
}

export function buildInsertInboxV2ProviderReactionObservationSql(
  commit: InboxV2MessageReactionCommit
): SQL {
  const observation = commit.providerObservation;
  if (observation === null) {
    throw invariantError(
      "Provider reaction observation insert requires proof."
    );
  }
  const proof = observation.semanticProof;
  const occurrence = proof.sourceOccurrence;
  if (occurrence === null || proof.ordering.kind !== "monotonic_exact") {
    throw invariantError(
      "Provider reaction observation requires exact monotonic source proof."
    );
  }
  const normalized = reactionStateColumns(observation.normalizedState);
  return sql`
    insert into inbox_v2_message_provider_reaction_observations (
      tenant_id, id, transition_id, normalized_inbound_event_id,
      source_occurrence_id, semantic_id, semantic_proof_digest_sha256,
      semantic_proof_detail, ordering_position,
      ordering_proof_digest_sha256, ordering_commit_detail,
      normalized_state_kind, normalized_value_kind,
      normalized_unicode_value, normalized_provider_reaction_kind_id,
      normalized_provider_canonical_code, provider_actor_participant_id,
      observed_at, recorded_at, revision
    ) values (
      ${commit.tenantId},
      ${derivedInboxV2Id(
        "provider_reaction_observation",
        commit.transition.id
      )},
      ${commit.transition.id}, ${proof.normalizedInboundEvent.id},
      ${occurrence.id}, ${proof.semanticId},
      ${computeInboxV2TimelineMessageCommitDigest(proof)},
      ${jsonbDetail(proof)}, ${proof.ordering.position},
      ${computeInboxV2TimelineMessageCommitDigest(observation.orderingCommit)},
      ${jsonbDetail(observation.orderingCommit)},
      ${observation.normalizedState.kind}, ${normalized.valueKind},
      ${normalized.unicodeValue}, ${normalized.providerReactionKindId},
      ${normalized.providerCanonicalCode},
      ${observation.providerActorParticipant?.id ?? null},
      ${proof.occurredAt}, ${proof.recordedAt}, 1
    )
    returning id
  `;
}

export function buildLockInboxV2OutboundRouteForConsumptionSql(input: {
  tenantId: InboxV2TenantId;
  outboundRouteId: string;
}): SQL {
  return sql`
    select id
      from inbox_v2_outbound_routes
     where tenant_id = ${input.tenantId}
       and id = ${input.outboundRouteId}
     for update
  `;
}

export function buildFindInboxV2OutboundRouteConsumptionSql(
  consumption: InboxV2OutboundRouteConsumptionRecord
): SQL {
  return sql`
    select *
      from inbox_v2_outbound_route_consumptions
     where tenant_id = ${consumption.tenantId}
       and (
         outbound_route_id = ${consumption.outboundRouteId}
         or (
           consumer_kind = ${consumption.consumerKind}
           and consumer_id = ${consumption.consumerId}
         )
       )
     for update
  `;
}

export function buildInsertInboxV2OutboundRouteConsumptionSql(
  consumption: InboxV2OutboundRouteConsumptionRecord
): SQL {
  return sql`
    insert into inbox_v2_outbound_route_consumptions (
      tenant_id, id, consumer_kind, consumer_id, message_id,
      outbound_route_id, mutation_token, idempotency_token,
      correlation_token, consumed_at, consumed_by_trusted_service_id,
      revision, commit_digest_sha256
    ) values (
      ${consumption.tenantId},
      ${derivedInboxV2Id(
        "outbound_route_consumption",
        `${consumption.consumerKind}:${consumption.consumerId}`
      )},
      ${consumption.consumerKind}, ${consumption.consumerId},
      ${consumption.messageId}, ${consumption.outboundRouteId},
      ${consumption.mutationToken}, ${consumption.idempotencyToken},
      ${consumption.correlationToken}, ${consumption.consumedAt},
      ${consumption.consumedByTrustedServiceId}, ${consumption.revision},
      ${consumption.commitDigestSha256}
    )
    returning id
  `;
}

export function buildInsertInboxV2MessageTransportLinkSql(input: {
  link: InboxV2MessageTransportAssociationCommit["link"];
  resultingHeadRevision: InboxV2EntityRevision;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const { link } = input;
  return sql`
    insert into inbox_v2_message_transport_links (
      tenant_id, id, message_id, source_occurrence_id,
      external_message_reference_id, role, resulting_head_revision,
      revision, linked_at, recorded_stream_position
    ) values (
      ${link.tenantId}, ${link.id}, ${link.message.id},
      ${link.sourceOccurrence.id}, ${link.externalMessageReference.id},
      ${link.role}, ${input.resultingHeadRevision}, ${link.revision},
      ${link.linkedAt}, ${input.streamPosition}
    )
    on conflict do nothing
    returning id
  `;
}

export function buildInsertInboxV2MessageTransportLinkHeadSql(input: {
  head: InboxV2MessageTransportAssociationCommit["linkHeadAfter"];
  streamPosition: InboxV2BigintCounter;
}): SQL {
  return sql`
    insert into inbox_v2_message_transport_link_heads (
      tenant_id, message_id, link_count, latest_link_id, revision,
      last_changed_stream_position, updated_at
    ) values (
      ${input.head.tenantId}, ${input.head.message.id},
      ${input.head.linkCount}, ${input.head.latestLink.id},
      ${input.head.revision}, ${input.streamPosition}, ${input.head.updatedAt}
    )
    returning message_id as id
  `;
}

export function buildAdvanceInboxV2MessageTransportLinkHeadSql(input: {
  before: NonNullable<
    InboxV2MessageTransportAssociationCommit["linkHeadBefore"]
  >;
  after: InboxV2MessageTransportAssociationCommit["linkHeadAfter"];
  streamPosition: InboxV2BigintCounter;
}): SQL {
  return sql`
    update inbox_v2_message_transport_link_heads
       set link_count = ${input.after.linkCount},
           latest_link_id = ${input.after.latestLink.id},
           revision = ${input.after.revision},
           last_changed_stream_position = ${input.streamPosition},
           updated_at = ${input.after.updatedAt}
     where tenant_id = ${input.before.tenantId}
       and message_id = ${input.before.message.id}
       and link_count = ${input.before.linkCount}
       and latest_link_id = ${input.before.latestLink.id}
       and revision = ${input.before.revision}
    returning message_id as id
  `;
}

export function buildFindInboxV2MessageTransportLinkSql(input: {
  tenantId: InboxV2TenantId;
  linkId: string;
  sourceOccurrenceId: string;
}): SQL {
  return sql`
    select id, message_id, source_occurrence_id,
           external_message_reference_id, role, resulting_head_revision,
           revision, linked_at, recorded_stream_position
      from inbox_v2_message_transport_links
     where tenant_id = ${input.tenantId}
       and (
         id = ${input.linkId}
         or source_occurrence_id = ${input.sourceOccurrenceId}
       )
     for update
  `;
}

export function buildLockInboxV2MessageTransportLinkHeadSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select message_id, link_count, latest_link_id, revision, updated_at
      from inbox_v2_message_transport_link_heads
     where tenant_id = ${input.tenantId}
       and message_id = ${input.messageId}
     for update
  `;
}

export function buildFindInboxV2MessageTransportFactCommitSql(input: {
  tenantId: InboxV2TenantId;
  commitToken: string;
  observationId: string;
}): SQL {
  return sql`
    select commit_row.*, delivery_row.id as delivery_observation_id,
           receipt_row.id as receipt_observation_id,
           delivery_row.fact as fact_value
      from inbox_v2_message_transport_fact_commits commit_row
      left join inbox_v2_message_delivery_observations delivery_row
        on delivery_row.tenant_id = commit_row.tenant_id
       and delivery_row.commit_token = commit_row.commit_token
       and delivery_row.id = commit_row.observation_id
      left join inbox_v2_provider_receipt_observations receipt_row
        on receipt_row.tenant_id = commit_row.tenant_id
       and receipt_row.commit_token = commit_row.commit_token
       and receipt_row.id = commit_row.observation_id
     where commit_row.tenant_id = ${input.tenantId}
       and (
         commit_row.commit_token = ${input.commitToken}
         or commit_row.observation_id = ${input.observationId}
       )
     for update of commit_row
  `;
}

export function buildInsertInboxV2MessageTransportFactCommitSql(input: {
  commit: InboxV2MessageTransportFactCommit;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const observation = input.commit.fact.observation;
  return sql`
    insert into inbox_v2_message_transport_fact_commits (
      tenant_id, commit_token, fact_kind, observation_id, message_id,
      commit_digest_sha256, observed_at, recorded_at,
      recorded_stream_position, revision
    ) values (
      ${input.commit.tenantId}, ${input.commit.commitToken},
      ${input.commit.fact.kind}, ${observation.id},
      ${input.commit.beforeMessage.id},
      ${computeInboxV2TimelineMessageCommitDigest(input.commit)},
      ${observation.observedAt}, ${observation.recordedAt},
      ${input.streamPosition}, ${observation.revision}
    )
    on conflict do nothing
    returning *
  `;
}

export function buildInsertInboxV2MessageDeliveryObservationSql(input: {
  commit: InboxV2MessageTransportFactCommit;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  if (input.commit.fact.kind !== "delivery") {
    throw invariantError("Delivery insert requires a delivery fact.");
  }
  const observation = input.commit.fact.observation;
  const scope = deliveryScopeColumns(observation.scope);
  const evidence = deliveryEvidenceColumns(observation.evidence);
  const adapter = observation.adapterContract;
  const semanticProof = observation.semanticProof;
  return sql`
    insert into inbox_v2_message_delivery_observations (
      tenant_id, id, message_id, commit_token, commit_digest_sha256,
      fact, scope_kind, scope_dispatch_id, scope_attempt_id,
      scope_artifact_id, scope_external_message_reference_id,
      scope_source_occurrence_id, scope_recipient_source_identity_id,
      source_account_id, source_thread_binding_id, binding_generation,
      adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      adapter_loaded_by_trusted_service_id, adapter_loaded_at,
      capability_id, capability_revision, evidence_kind,
      evidence_attempt_id, evidence_artifact_id,
      evidence_normalized_inbound_event_id,
      evidence_external_message_reference_id,
      evidence_source_occurrence_id, semantic_proof_detail,
      semantic_proof_digest_sha256, evidence_kind_id,
      evidence_digest_sha256, failure_reason_id, observed_at, recorded_at,
      recorded_stream_position, revision
    ) values (
      ${observation.tenantId}, ${observation.id}, ${observation.message.id},
      ${input.commit.commitToken},
      ${computeInboxV2TimelineMessageCommitDigest(input.commit)},
      ${observation.fact}, ${observation.scope.kind}, ${scope.dispatchId},
      ${scope.attemptId}, ${scope.artifactId},
      ${scope.externalMessageReferenceId}, ${scope.sourceOccurrenceId},
      ${scope.recipientSourceIdentityId}, ${observation.sourceAccount.id},
      ${observation.sourceThreadBinding.id}, ${observation.bindingGeneration},
      ${adapter.contractId}, ${adapter.contractVersion},
      ${adapter.declarationRevision}, ${adapter.surfaceId},
      ${adapter.loadedByTrustedServiceId}, ${adapter.loadedAt},
      ${observation.capabilityId}, ${observation.capabilityRevision},
      ${observation.evidence.kind}, ${evidence.attemptId},
      ${evidence.artifactId}, ${evidence.normalizedInboundEventId},
      ${evidence.externalMessageReferenceId}, ${evidence.sourceOccurrenceId},
      ${jsonbDetail(semanticProof)},
      ${semanticProof === null ? null : computeInboxV2TimelineMessageCommitDigest(semanticProof)},
      ${observation.evidenceKindId}, ${observation.evidenceDigestSha256},
      ${observation.failureReasonId}, ${observation.observedAt},
      ${observation.recordedAt}, ${input.streamPosition},
      ${observation.revision}
    )
    returning id
  `;
}

export function buildInsertInboxV2ProviderReceiptObservationSql(input: {
  commit: InboxV2MessageTransportFactCommit;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  if (input.commit.fact.kind !== "receipt") {
    throw invariantError("Receipt insert requires a receipt fact.");
  }
  const observation = input.commit.fact.observation;
  const target = receiptTargetColumns(observation.target);
  const reader = receiptReaderColumns(observation.reader);
  const adapter = observation.adapterContract;
  const hasOpaquePayload =
    target.providerWatermark !== null || reader.aggregateKey !== null;
  return sql`
    insert into inbox_v2_provider_receipt_observations (
      tenant_id, id, commit_token, commit_digest_sha256, target_kind,
      target_message_id, target_external_message_reference_id,
      target_source_occurrence_id, provider_watermark_digest_sha256,
      read_through_provider_time, reader_kind,
      reader_source_external_identity_id, reader_aggregate_key_digest_sha256,
      opaque_payload_id, opaque_data_class_id,
      source_account_id, source_thread_binding_id, binding_generation,
      adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      adapter_loaded_by_trusted_service_id, adapter_loaded_at,
      capability_id, capability_revision,
      evidence_normalized_inbound_event_id, semantic_proof_detail,
      semantic_proof_digest_sha256, evidence_kind_id,
      evidence_digest_sha256, observed_at, recorded_at,
      recorded_stream_position, revision
    ) values (
      ${observation.tenantId}, ${observation.id}, ${input.commit.commitToken},
      ${computeInboxV2TimelineMessageCommitDigest(input.commit)},
      ${observation.target.kind}, ${target.messageId},
      ${target.externalMessageReferenceId}, ${target.sourceOccurrenceId},
      ${target.providerWatermark === null ? null : computeUtf8Digest(target.providerWatermark)},
      ${target.readThroughProviderTime}, ${observation.reader.kind},
      ${reader.sourceExternalIdentityId},
      ${reader.aggregateKey === null ? null : computeUtf8Digest(reader.aggregateKey)},
      ${
        hasOpaquePayload
          ? derivedInboxV2Id("provider_receipt_opaque_payload", observation.id)
          : null
      },
      ${
        hasOpaquePayload
          ? "core:source_occurrence_and_external_reference"
          : null
      },
      ${observation.sourceAccount.id}, ${observation.sourceThreadBinding.id},
      ${observation.bindingGeneration}, ${adapter.contractId},
      ${adapter.contractVersion}, ${adapter.declarationRevision},
      ${adapter.surfaceId}, ${adapter.loadedByTrustedServiceId},
      ${adapter.loadedAt}, ${observation.capabilityId},
      ${observation.capabilityRevision}, ${observation.evidenceEvent.id},
      ${jsonbDetail(observation.semanticProof)},
      ${computeInboxV2TimelineMessageCommitDigest(observation.semanticProof)},
      ${observation.evidenceKindId}, ${observation.evidenceDigestSha256},
      ${observation.observedAt}, ${observation.recordedAt},
      ${input.streamPosition}, ${observation.revision}
    )
    returning id
  `;
}

export function buildInsertInboxV2ProviderReceiptOpaquePayloadSql(
  commit: InboxV2MessageTransportFactCommit
): SQL | null {
  if (commit.fact.kind !== "receipt") return null;
  const observation = commit.fact.observation;
  const target = receiptTargetColumns(observation.target);
  const reader = receiptReaderColumns(observation.reader);
  if (target.providerWatermark === null && reader.aggregateKey === null)
    return null;
  return sql`
    insert into inbox_v2_provider_receipt_opaque_payloads (
      tenant_id, id, receipt_observation_id, data_class_id,
      provider_watermark, reader_aggregate_key, created_at
    ) values (
      ${observation.tenantId},
      ${derivedInboxV2Id("provider_receipt_opaque_payload", observation.id)},
      ${observation.id},
      'core:source_occurrence_and_external_reference',
      ${target.providerWatermark}, ${reader.aggregateKey},
      ${observation.recordedAt}
    )
    returning id
  `;
}

export function buildFindInboxV2MessageConversationIdSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select conversation_id
      from inbox_v2_messages
     where tenant_id = ${input.tenantId}
       and id = ${input.messageId}
  `;
}

export function buildLockInboxV2ProviderSemanticOrderingReferenceSql(input: {
  tenantId: InboxV2TenantId;
  externalMessageReferenceId: string;
}): SQL {
  return sql`
    select tenant_id, id
      from inbox_v2_external_message_references
     where tenant_id = ${input.tenantId}
       and id = ${input.externalMessageReferenceId}
     for update
  `;
}

export function buildFindInboxV2ProviderSemanticOrderingHeadSql(input: {
  tenantId: InboxV2TenantId;
  externalMessageReferenceId: string;
  semanticFamilyId: string;
  lock?: boolean;
}): SQL {
  const lockClause = input.lock ? sql`for update` : sql``;
  return sql`
    select *
      from inbox_v2_provider_semantic_ordering_heads
     where tenant_id = ${input.tenantId}
       and external_message_reference_id = ${input.externalMessageReferenceId}
       and semantic_family_id = ${input.semanticFamilyId}
     ${lockClause}
  `;
}

export function buildInsertInboxV2ProviderSemanticOrderingHeadSql(input: {
  head: InboxV2ProviderSemanticOrderingHead;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const { head } = input;
  return sql`
    insert into inbox_v2_provider_semantic_ordering_heads (
      tenant_id, external_message_reference_id, semantic_family_id,
      source_account_id, source_thread_binding_id, binding_generation,
      scope_token, comparator_id, comparator_revision, position,
      normalized_inbound_event_id, proof_token, revision,
      head_detail, head_detail_digest_sha256, last_changed_stream_position,
      created_at, updated_at
    ) values (
      ${head.tenantId}, ${head.externalMessageReference.id},
      ${head.semanticFamilyId}, ${head.sourceAccount.id},
      ${head.sourceThreadBinding.id}, ${head.bindingGeneration},
      ${head.scopeToken}, ${head.comparatorId}, ${head.comparatorRevision},
      ${head.position}, ${head.normalizedInboundEvent.id}, ${head.proofToken},
      ${head.revision}, ${jsonbDetail(head)},
      ${computeInboxV2TimelineMessageCommitDigest(head)},
      ${input.streamPosition}, ${head.updatedAt}, ${head.updatedAt}
    )
    returning revision
  `;
}

export function buildAdvanceInboxV2ProviderSemanticOrderingHeadSql(input: {
  before: InboxV2ProviderSemanticOrderingHead;
  after: InboxV2ProviderSemanticOrderingHead;
  currentLastChangedStreamPosition: InboxV2BigintCounter;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const { before, after } = input;
  return sql`
    update inbox_v2_provider_semantic_ordering_heads
       set source_account_id = ${after.sourceAccount.id},
           source_thread_binding_id = ${after.sourceThreadBinding.id},
           binding_generation = ${after.bindingGeneration},
           scope_token = ${after.scopeToken},
           comparator_id = ${after.comparatorId},
           comparator_revision = ${after.comparatorRevision},
           position = ${after.position},
           normalized_inbound_event_id = ${after.normalizedInboundEvent.id},
           proof_token = ${after.proofToken},
           revision = ${after.revision},
           head_detail = ${jsonbDetail(after)},
           head_detail_digest_sha256 =
             ${computeInboxV2TimelineMessageCommitDigest(after)},
           last_changed_stream_position = ${input.streamPosition},
           updated_at = ${after.updatedAt}
     where tenant_id = ${before.tenantId}
       and external_message_reference_id =
         ${before.externalMessageReference.id}
       and semantic_family_id = ${before.semanticFamilyId}
       and revision = ${before.revision}
       and position = ${before.position}
       and proof_token = ${before.proofToken}
       and head_detail_digest_sha256 =
         ${computeInboxV2TimelineMessageCommitDigest(before)}
       and last_changed_stream_position =
         ${input.currentLastChangedStreamPosition}
    returning revision
  `;
}

export function buildFindInboxV2ProviderLifecycleOperationSql(input: {
  tenantId: InboxV2TenantId;
  operationId: string;
  lock?: boolean;
}): SQL {
  const lockClause = input.lock ? sql`for update of operation_row` : sql``;
  return sql`
    select operation_row.*,
           attribution_row.action_participant_id,
           attribution_row.app_actor_kind,
           attribution_row.app_actor_employee_id,
           attribution_row.app_authorization_epoch,
           attribution_row.app_trusted_service_id,
           attribution_row.source_occurrence_id as attribution_source_occurrence_id,
           attribution_row.automation_kind,
           attribution_row.automation_cause_event_id,
           attribution_row.automation_correlation_id,
           attribution_row.automation_caused_at,
           attribution_row.automation_initiating_employee_id,
           attribution_row.automation_initiating_authorization_epoch
      from inbox_v2_message_provider_lifecycle_operations operation_row
      left join inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = operation_row.tenant_id
       and attribution_row.id = operation_row.action_attribution_id
     where operation_row.tenant_id = ${input.tenantId}
       and operation_row.id = ${input.operationId}
     ${lockClause}
  `;
}

export function buildInsertInboxV2ProviderLifecycleOperationSql(input: {
  commit: InboxV2MessageProviderLifecycleCreationCommit;
  actionAttributionId: string | null;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const operation = input.commit.operation;
  const adapter = operation.adapterContract;
  const outcome = providerOutcomeColumns(operation.outcome);
  const policy = providerDeletePolicyColumns(operation.deleteLocalPolicy);
  const proof = input.commit.providerSemanticProof;
  const orderingCommit = input.commit.semanticOrderingCommit;
  const monotonicOrdering =
    proof?.ordering.kind === "monotonic_exact" ? proof.ordering : null;
  return sql`
    insert into inbox_v2_message_provider_lifecycle_operations (
      tenant_id, id, message_id, action, origin,
      external_message_reference_id, source_occurrence_id,
      source_account_id, source_thread_binding_id, binding_generation,
      outbound_route_id, adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      adapter_loaded_by_trusted_service_id, adapter_loaded_at,
      capability_revision, action_attribution_id,
      initial_outcome, initial_outcome_retryable, initial_outcome_reason_id,
      initial_delete_local_effect, initial_policy_decision_event_id,
      initial_policy_decision_revision, initial_policy_decided_at,
      provider_semantic_normalized_inbound_event_id,
      provider_semantic_actor_external_identity_id,
      provider_semantic_capability_id, provider_semantic_capability_revision,
      provider_semantic_id, provider_semantic_revision,
      provider_semantic_proof_token, provider_semantic_ordering_scope_token,
      provider_semantic_ordering_position,
      provider_semantic_ordering_comparator_id,
      provider_semantic_ordering_comparator_revision,
      provider_semantic_declared_by_trusted_service_id,
      provider_semantic_proof_revision, provider_semantic_proof_detail,
      provider_semantic_proof_digest_sha256,
      semantic_ordering_commit_detail,
      semantic_ordering_commit_digest_sha256,
      semantic_ordering_committed_at, outcome,
      outcome_retryable, outcome_reason_id, delete_local_effect,
      policy_decision_event_id, policy_decision_revision, policy_decided_at,
      revision, created_stream_position, last_changed_stream_position,
      occurred_at, recorded_at, created_at, updated_at
    ) values (
      ${operation.tenantId}, ${operation.id}, ${operation.message.id},
      ${operation.action}, ${operation.origin},
      ${operation.externalMessageReference.id}, ${operation.sourceOccurrence.id},
      ${operation.sourceAccount.id}, ${operation.sourceThreadBinding.id},
      ${operation.bindingGeneration}, ${operation.outboundRoute?.id ?? null},
      ${adapter.contractId}, ${adapter.contractVersion},
      ${adapter.declarationRevision}, ${adapter.surfaceId},
      ${adapter.loadedByTrustedServiceId}, ${adapter.loadedAt},
      ${operation.capabilityRevision}, ${input.actionAttributionId},
      ${operation.outcome.state}, ${outcome.retryable}, ${outcome.reasonId},
      ${policy.effect}, ${policy.decisionEventId}, ${policy.decisionRevision},
      ${policy.decidedAt}, ${proof?.normalizedInboundEvent.id ?? null},
      ${proof?.actor?.id ?? null}, ${proof?.capabilityId ?? null},
      ${proof?.capabilityRevision ?? null}, ${proof?.semanticId ?? null},
      ${proof?.semanticRevision ?? null}, ${proof?.proofToken ?? null},
      ${monotonicOrdering?.scopeToken ?? null},
      ${monotonicOrdering?.position ?? null},
      ${monotonicOrdering?.comparatorId ?? null},
      ${monotonicOrdering?.comparatorRevision ?? null},
      ${proof?.declaredByTrustedServiceId ?? null}, ${proof?.revision ?? null},
      ${jsonbDetail(proof)},
      ${
        proof === null ? null : computeInboxV2TimelineMessageCommitDigest(proof)
      },
      ${jsonbDetail(orderingCommit)},
      ${
        orderingCommit === null
          ? null
          : computeInboxV2TimelineMessageCommitDigest(orderingCommit)
      },
      ${orderingCommit?.committedAt ?? null},
      ${operation.outcome.state}, ${outcome.retryable}, ${outcome.reasonId},
      ${policy.effect}, ${policy.decisionEventId}, ${policy.decisionRevision},
      ${policy.decidedAt}, ${operation.revision}, ${input.streamPosition},
      ${input.streamPosition}, ${operation.occurredAt},
      ${operation.recordedAt}, ${operation.createdAt}, ${operation.updatedAt}
    )
    returning id
  `;
}

export function buildInsertInboxV2ProviderLifecycleTransitionSql(input: {
  commit: InboxV2MessageProviderLifecycleTransitionCommit;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const { commit } = input;
  const transition = commit.transition;
  const outcome = providerOutcomeColumns(transition.outcome);
  const policy = providerDeletePolicyColumns(transition.deleteLocalPolicy);
  const proof = transition.resultProof;
  return sql`
    insert into inbox_v2_message_provider_lifecycle_transitions (
      tenant_id, id, operation_id, expected_revision, resulting_revision,
      outcome, outcome_retryable, outcome_reason_id, delete_local_effect,
      policy_decision_event_id, policy_decision_revision, policy_decided_at,
      result_token, result_digest_sha256, result_proof_outbound_route_id,
      result_proof_capability_id, result_proof_capability_revision,
      result_proof_semantic_id, result_proof_semantic_revision,
      result_proof_state, result_proof_declared_by_trusted_service_id,
      result_proof_recorded_at, result_proof_adapter_contract_detail,
      result_proof_adapter_contract_detail_digest_sha256, recorded_at,
      recorded_stream_position, record_revision
    ) values (
      ${commit.tenantId},
      ${derivedInboxV2Id(
        "message_provider_lifecycle_transition",
        `${transition.operation.id}:${transition.resultingRevision}`
      )},
      ${transition.operation.id}, ${transition.expectedRevision},
      ${transition.resultingRevision}, ${transition.outcome.state},
      ${outcome.retryable}, ${outcome.reasonId}, ${policy.effect},
      ${policy.decisionEventId}, ${policy.decisionRevision},
      ${policy.decidedAt}, ${proof?.resultToken ?? null},
      ${proof?.resultDigestSha256 ?? null}, ${proof?.outboundRoute.id ?? null},
      ${proof?.capabilityId ?? null}, ${proof?.capabilityRevision ?? null},
      ${proof?.semanticId ?? null}, ${proof?.semanticRevision ?? null},
      ${proof?.resultState ?? null},
      ${proof?.declaredByTrustedServiceId ?? null},
      ${proof?.recordedAt ?? null},
      ${proof === null ? sql`null` : jsonbDetail(proof.adapterContract)},
      ${
        proof === null
          ? null
          : computeInboxV2TimelineMessageCommitDigest(proof.adapterContract)
      },
      ${transition.recordedAt}, ${input.streamPosition}, 1
    )
    returning id
  `;
}

export function buildFindInboxV2ProviderLifecycleTransitionSql(
  commit: InboxV2MessageProviderLifecycleTransitionCommit
): SQL {
  return sql`
    select *
      from inbox_v2_message_provider_lifecycle_transitions
     where tenant_id = ${commit.tenantId}
       and operation_id = ${commit.transition.operation.id}
       and resulting_revision = ${commit.transition.resultingRevision}
  `;
}

export function buildAdvanceInboxV2ProviderLifecycleOperationSql(
  commit: InboxV2MessageProviderLifecycleTransitionCommit,
  streamPosition: InboxV2BigintCounter
): SQL {
  const outcome = providerOutcomeColumns(commit.after.outcome);
  const policy = providerDeletePolicyColumns(commit.after.deleteLocalPolicy);
  return sql`
    update inbox_v2_message_provider_lifecycle_operations
       set outcome = ${commit.after.outcome.state},
           outcome_retryable = ${outcome.retryable},
           outcome_reason_id = ${outcome.reasonId},
           delete_local_effect = ${policy.effect},
           policy_decision_event_id = ${policy.decisionEventId},
           policy_decision_revision = ${policy.decisionRevision},
           policy_decided_at = ${policy.decidedAt},
           revision = ${commit.after.revision},
           last_changed_stream_position = ${streamPosition},
           updated_at = ${commit.after.updatedAt}
     where tenant_id = ${commit.tenantId}
       and id = ${commit.before.id}
       and message_id = ${commit.before.message.id}
       and revision = ${commit.before.revision}
    returning id
  `;
}

export function buildInsertInboxV2MessageRevisionSql(input: {
  revision: InboxV2MessageRevision;
  actionAttributionId: string;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const change = messageRevisionColumns(input.revision);
  return sql`
    insert into inbox_v2_message_revisions (
      tenant_id, id, message_id, timeline_item_id,
      expected_previous_revision, message_revision, change_kind,
      before_content_id, before_content_revision, before_content_state,
      after_content_id, after_content_revision, after_content_state,
      provider_operation_id, reason_id, action_attribution_id,
      occurred_at, recorded_at, recorded_stream_position, record_revision
    ) values (
      ${input.revision.tenantId}, ${input.revision.id},
      ${input.revision.message.id}, ${input.revision.timelineItem.id},
      ${input.revision.expectedPreviousRevision},
      ${input.revision.messageRevision}, ${input.revision.change.kind},
      ${change.beforeContentId}, ${change.beforeContentRevision},
      ${change.beforeContentState}, ${change.afterContentId},
      ${change.afterContentRevision}, ${change.afterContentState},
      ${change.providerOperationId}, ${change.reasonId},
      ${input.actionAttributionId}, ${input.revision.occurredAt},
      ${input.revision.recordedAt}, ${input.streamPosition},
      ${input.revision.recordRevision}
    )
    returning id
  `;
}

export function buildAdvanceInboxV2TimelineContentSql(input: {
  before: InboxV2TimelineContent;
  after: InboxV2TimelineContent;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const state = contentStateColumns(input.after);
  return sql`
    update inbox_v2_timeline_contents
       set state = ${input.after.state.kind},
           content_digest_sha256 = ${state.contentDigestSha256},
           tombstone_event_id = ${state.tombstoneEventId},
           tombstone_reason_id = ${state.tombstoneReasonId},
           retention_policy_id = ${state.retentionPolicyId},
           retention_policy_version = ${state.retentionPolicyVersion},
           retention_policy_revision = ${state.retentionPolicyRevision},
           state_changed_at = ${input.after.updatedAt},
           revision = ${input.after.revision},
           last_changed_stream_position = ${input.streamPosition},
           updated_at = ${input.after.updatedAt}
     where tenant_id = ${input.before.tenantId}
       and id = ${input.before.id}
       and revision = ${input.before.revision}
       and state = ${input.before.state.kind}
    returning id
  `;
}

export function buildAdvanceInboxV2MessageSql(input: {
  before: InboxV2Message;
  after: InboxV2Message;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  const lifecycle = messageLifecycleColumns(input.after);
  return sql`
    update inbox_v2_messages
       set content_id = ${input.after.content.content.id},
           content_revision = ${input.after.content.contentRevision},
           content_state = ${input.after.content.stateKind},
           lifecycle = ${input.after.lifecycle.kind},
           lifecycle_revision_id = ${lifecycle.revisionId},
           lifecycle_reason_id = ${lifecycle.reasonId},
           lifecycle_provider_operation_id = ${lifecycle.providerOperationId},
           lifecycle_policy_reason_id = ${lifecycle.policyReasonId},
           lifecycle_changed_at = ${lifecycle.changedAt},
           revision = ${input.after.revision},
           last_changed_stream_position = ${input.streamPosition},
           updated_at = ${input.after.updatedAt}
     where tenant_id = ${input.before.tenantId}
       and id = ${input.before.id}
       and timeline_item_id = ${input.before.timelineItem.id}
       and revision = ${input.before.revision}
       and content_id = ${input.before.content.content.id}
       and content_revision = ${input.before.content.contentRevision}
       and content_state = ${input.before.content.stateKind}
       and lifecycle = ${input.before.lifecycle.kind}
    returning id
  `;
}

export function buildAdvanceInboxV2TimelineItemSql(input: {
  before: InboxV2TimelineItem;
  after: InboxV2TimelineItem;
  streamPosition: InboxV2BigintCounter;
}): SQL {
  return sql`
    update inbox_v2_timeline_items
       set revision = ${input.after.revision},
           last_changed_stream_position = ${input.streamPosition},
           updated_at = ${input.after.updatedAt}
     where tenant_id = ${input.before.tenantId}
       and id = ${input.before.id}
       and conversation_id = ${input.before.conversation.id}
       and timeline_sequence = ${input.before.timelineSequence}
       and subject_kind = ${input.before.subject.kind}
       and subject_id = ${timelineSubjectId(input.before)}
       and revision = ${input.before.revision}
    returning id
  `;
}

export function buildListInboxV2TimelineSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  anchor: Exclude<ListInboxV2TimelineInput["anchor"], undefined>;
  aroundSequence?: InboxV2TimelineSequence | null;
  limit: number;
}): SQL {
  const sequencePredicate =
    input.anchor.kind === "before"
      ? sql`and timeline_sequence < ${input.anchor.sequence}`
      : input.anchor.kind === "after"
        ? sql`and timeline_sequence > ${input.anchor.sequence}`
        : input.anchor.kind === "around" && input.aroundSequence !== null
          ? sql`and timeline_sequence between greatest(1, ${input.aroundSequence}::bigint - ${Math.floor(
              input.limit / 2
            )}) and ${input.aroundSequence}::bigint + ${Math.ceil(input.limit / 2)}`
          : sql``;
  const direction = input.anchor.kind === "after" ? sql`asc` : sql`desc`;
  return sql`
    select
      timeline_row.tenant_id, timeline_row.id, timeline_row.conversation_id,
      timeline_row.timeline_sequence, timeline_row.subject_kind,
      timeline_row.subject_id, timeline_row.visibility,
      timeline_row.activity_kind,
      timeline_row.activity_source_occurrence_id,
      timeline_row.activity_reason_id, timeline_row.migration_provenance_id,
      timeline_row.activity_imported_at, timeline_row.occurred_at,
      timeline_row.received_at, timeline_row.revision,
      timeline_row.created_at, timeline_row.updated_at,
      detail_row.source_object_id, detail_row.source_object_kind_id,
      detail_row.source_object_revision,
      detail_row.normalized_source_event_id,
      detail_row.actor_participant_id, detail_row.module_item_kind_id,
      detail_row.participant_transition_id, detail_row.work_transition_kind,
      detail_row.work_item_transition_id,
      detail_row.work_item_relation_transition_id,
      detail_row.system_event_id, detail_row.system_actor_id,
      detail_row.system_app_actor_kind,
      detail_row.system_app_actor_employee_id,
      detail_row.system_app_authorization_epoch,
      detail_row.system_app_trusted_service_id
      from inbox_v2_timeline_items timeline_row
      left join inbox_v2_timeline_subject_details detail_row
        on detail_row.tenant_id = timeline_row.tenant_id
       and detail_row.timeline_item_id = timeline_row.id
       and detail_row.subject_kind = timeline_row.subject_kind
     where timeline_row.tenant_id = ${input.tenantId}
       and timeline_row.conversation_id = ${input.conversationId}
       ${sequencePredicate}
     order by timeline_row.timeline_sequence ${direction}
     limit ${input.limit + 1}
  `;
}

export function buildFindInboxV2TimelineItemSequenceSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  timelineItemId: InboxV2TimelineItemId;
}): SQL {
  return sql`
    select timeline_sequence
      from inbox_v2_timeline_items
     where tenant_id = ${input.tenantId}
       and conversation_id = ${input.conversationId}
       and id = ${input.timelineItemId}
  `;
}

export function buildListInboxV2TimelineContentPayloadSql(input: {
  tenantId: InboxV2TenantId;
  contentId: string;
  contentRevision: InboxV2EntityRevision;
}): SQL {
  return sql`
    select
      tenant_id, content_id, content_revision, ordinal, block_key, kind,
      text_role, text_value, language,
      attachment_id, attachment_state, attachment_file_id,
      attachment_v2_file_id, attachment_file_revision,
      attachment_file_version_id,
      attachment_object_version_id,
      attachment_failure_reason_id, display_name, media_semantic,
      latitude, longitude, accuracy_meters, location_mode, live_until,
      heading_degrees, location_label, location_address,
      contact_display_name, contact_organization,
      unsupported_source_occurrence_id, provider_content_kind_id,
      safe_fallback_reason_id, extension_block_kind_id,
      extension_payload_schema_id, extension_payload_schema_version,
      extension_payload_file_id, extension_payload_v2_file_id,
      extension_payload_file_revision,
      extension_payload_file_version_id,
      extension_payload_object_version_id,
      extension_payload_digest_sha256,
      extension_renderer_id, created_at
      from inbox_v2_timeline_content_payloads
     where tenant_id = ${input.tenantId}
       and content_id = ${input.contentId}
       and content_revision = ${input.contentRevision}
     order by ordinal asc
  `;
}

export function buildFindInboxV2TimelineContentSql(input: {
  tenantId: InboxV2TenantId;
  contentId: string;
  lock?: boolean;
}): SQL {
  const lockClause = input.lock ? sql`for update` : sql``;
  return sql`
    select
      tenant_id, id, state, content_digest_sha256, tombstone_event_id,
      tombstone_reason_id, retention_policy_id, retention_policy_version,
      retention_policy_revision, revision, created_at, updated_at
      from inbox_v2_timeline_contents
     where tenant_id = ${input.tenantId}
       and id = ${input.contentId}
     ${lockClause}
  `;
}

export function buildListInboxV2TimelineContentContactValuesSql(input: {
  tenantId: InboxV2TenantId;
  contentId: string;
  contentRevision: InboxV2EntityRevision;
}): SQL {
  return sql`
    select
      tenant_id, content_id, content_revision, block_ordinal,
      value_ordinal, kind, value, label
      from inbox_v2_timeline_content_contact_values
     where tenant_id = ${input.tenantId}
       and content_id = ${input.contentId}
       and content_revision = ${input.contentRevision}
     order by block_ordinal asc, value_ordinal asc
  `;
}

export function buildListInboxV2MessageHistorySql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
  afterRevision: InboxV2EntityRevision | null;
  limit: number;
}): SQL {
  const cursor =
    input.afterRevision === null
      ? sql``
      : sql`and revision_row.message_revision > ${input.afterRevision}`;
  return sql`
    select
      revision_row.tenant_id, revision_row.id, revision_row.message_id,
      revision_row.timeline_item_id, revision_row.expected_previous_revision,
      revision_row.message_revision, revision_row.change_kind,
      revision_row.before_content_id, revision_row.before_content_revision,
      revision_row.before_content_state, revision_row.after_content_id,
      revision_row.after_content_revision, revision_row.after_content_state,
      revision_row.provider_operation_id, revision_row.reason_id,
      revision_row.occurred_at, revision_row.recorded_at,
      revision_row.record_revision,
      attribution_row.action_participant_id,
      attribution_row.app_actor_kind, attribution_row.app_actor_employee_id,
      attribution_row.app_authorization_epoch,
      attribution_row.app_trusted_service_id,
      attribution_row.source_occurrence_id,
      attribution_row.automation_kind,
      attribution_row.automation_cause_event_id,
      attribution_row.automation_correlation_id,
      attribution_row.automation_caused_at,
      attribution_row.automation_initiating_employee_id,
      attribution_row.automation_initiating_authorization_epoch
      from inbox_v2_message_revisions revision_row
      inner join inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = revision_row.tenant_id
       and attribution_row.id = revision_row.action_attribution_id
     where revision_row.tenant_id = ${input.tenantId}
       and revision_row.message_id = ${input.messageId}
       ${cursor}
     order by revision_row.message_revision asc, revision_row.id collate "C" asc
     limit ${input.limit + 1}
  `;
}

export function buildFindInboxV2MessageRevisionIdentitySql(input: {
  tenantId: InboxV2TenantId;
  revisionId: string;
  messageId: InboxV2MessageId;
  messageRevision: InboxV2EntityRevision;
}): SQL {
  return sql`
    select
      revision_row.tenant_id, revision_row.id, revision_row.message_id,
      revision_row.timeline_item_id, revision_row.expected_previous_revision,
      revision_row.message_revision, revision_row.change_kind,
      revision_row.before_content_id, revision_row.before_content_revision,
      revision_row.before_content_state, revision_row.after_content_id,
      revision_row.after_content_revision, revision_row.after_content_state,
      revision_row.provider_operation_id, revision_row.reason_id,
      revision_row.occurred_at, revision_row.recorded_at,
      revision_row.recorded_stream_position, revision_row.record_revision,
      attribution_row.action_participant_id,
      attribution_row.app_actor_kind, attribution_row.app_actor_employee_id,
      attribution_row.app_authorization_epoch,
      attribution_row.app_trusted_service_id,
      attribution_row.source_occurrence_id,
      attribution_row.automation_kind,
      attribution_row.automation_cause_event_id,
      attribution_row.automation_correlation_id,
      attribution_row.automation_caused_at,
      attribution_row.automation_initiating_employee_id,
      attribution_row.automation_initiating_authorization_epoch
      from inbox_v2_message_revisions revision_row
      inner join inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = revision_row.tenant_id
       and attribution_row.id = revision_row.action_attribution_id
     where revision_row.tenant_id = ${input.tenantId}
       and (
         revision_row.id = ${input.revisionId}
         or (
           revision_row.message_id = ${input.messageId}
           and revision_row.message_revision = ${input.messageRevision}
         )
       )
  `;
}

export function buildFindInboxV2MessageIdentitySql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select id
      from inbox_v2_messages
     where tenant_id = ${input.tenantId}
       and id = ${input.messageId}
  `;
}

export function buildFindInboxV2MessageTransportLinkHeadReadSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select tenant_id, message_id, link_count, latest_link_id, revision,
           last_changed_stream_position, updated_at
      from inbox_v2_message_transport_link_heads
     where tenant_id = ${input.tenantId}
       and message_id = ${input.messageId}
  `;
}

export function buildFindInboxV2MessageTransportLinkAtRevisionSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
  resultingHeadRevision: InboxV2EntityRevision;
}): SQL {
  return sql`
    select tenant_id, id, message_id, source_occurrence_id,
           external_message_reference_id, role, resulting_head_revision,
           revision, linked_at, recorded_stream_position
      from inbox_v2_message_transport_links
     where tenant_id = ${input.tenantId}
       and message_id = ${input.messageId}
       and resulting_head_revision = ${input.resultingHeadRevision}
  `;
}

export function buildListInboxV2MessageTransportLinksReadSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
  throughHeadRevision: InboxV2EntityRevision;
  afterHeadRevision: string;
  limit: number;
}): SQL {
  return sql`
    select tenant_id, id, message_id, source_occurrence_id,
           external_message_reference_id, role, resulting_head_revision,
           revision, linked_at, recorded_stream_position
      from inbox_v2_message_transport_links
     where tenant_id = ${input.tenantId}
       and message_id = ${input.messageId}
       and resulting_head_revision > ${input.afterHeadRevision}
       and resulting_head_revision <= ${input.throughHeadRevision}
     order by resulting_head_revision asc, id collate "C" asc
     limit ${input.limit + 1}
  `;
}

export function buildFindInboxV2MessageReactionSnapshotSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select coalesce(max(transition_row.recorded_stream_position), 0)::text
             as snapshot_position,
           coalesce(max(transition_row.recorded_at), transaction_timestamp())
             as snapshot_created_at
      from inbox_v2_message_reactions reaction_row
      inner join inbox_v2_message_reaction_transitions transition_row
        on transition_row.tenant_id = reaction_row.tenant_id
       and transition_row.reaction_id = reaction_row.id
     where reaction_row.tenant_id = ${input.tenantId}
       and reaction_row.message_id = ${input.messageId}
  `;
}

export function buildListInboxV2MessageReactionsReadSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
  throughStreamPosition: string;
  afterReactionId: string | null;
  limit: number;
}): SQL {
  const cursor =
    input.afterReactionId === null
      ? sql``
      : sql`and reaction_row.id collate "C" > ${input.afterReactionId} collate "C"`;
  return sql`
    select
      to_jsonb(reaction_row) || jsonb_build_object(
        'revision', reaction_row.revision::text,
        'last_changed_stream_position',
          reaction_row.last_changed_stream_position::text
      ) as reaction_row,
      to_jsonb(transition_row) || jsonb_build_object(
        'expected_revision', transition_row.expected_revision::text,
        'resulting_revision', transition_row.resulting_revision::text,
        'binding_generation', transition_row.binding_generation::text,
        'capability_revision', transition_row.capability_revision::text,
        'recorded_stream_position',
          transition_row.recorded_stream_position::text,
        'record_revision', transition_row.record_revision::text
      ) as transition_row
      from inbox_v2_message_reactions reaction_row
      inner join lateral (
        select candidate.*
          from inbox_v2_message_reaction_transitions candidate
         where candidate.tenant_id = reaction_row.tenant_id
           and candidate.reaction_id = reaction_row.id
           and candidate.recorded_stream_position <= ${input.throughStreamPosition}
         order by candidate.recorded_stream_position desc,
                  candidate.resulting_revision desc
         limit 1
      ) transition_row on true
     where reaction_row.tenant_id = ${input.tenantId}
       and reaction_row.message_id = ${input.messageId}
       ${cursor}
     order by reaction_row.id collate "C" asc
     limit ${input.limit + 1}
  `;
}

export function buildFindInboxV2MessageTransportFactSnapshotSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
}): SQL {
  return sql`
    select coalesce(max(recorded_stream_position), 0)::text
             as snapshot_position
      from inbox_v2_message_transport_fact_commits
     where tenant_id = ${input.tenantId}
       and message_id = ${input.messageId}
  `;
}

export function buildListInboxV2MessageTransportFactsReadSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
  throughStreamPosition: string;
  after: Readonly<{
    recordedAt: string;
    factKind: "delivery" | "receipt";
    observationId: string;
  }> | null;
  limit: number;
}): SQL {
  const cursor =
    input.after === null
      ? sql``
      : sql`and (
          commit_row.recorded_at > ${input.after.recordedAt}
          or (commit_row.recorded_at = ${input.after.recordedAt}
            and commit_row.fact_kind::text collate "C" >
              ${input.after.factKind} collate "C")
          or (commit_row.recorded_at = ${input.after.recordedAt}
            and commit_row.fact_kind::text = ${input.after.factKind}
            and commit_row.observation_id collate "C" >
              ${input.after.observationId} collate "C")
        )`;
  return sql`
    select commit_row.tenant_id, commit_row.commit_token,
           commit_row.fact_kind, commit_row.observation_id,
           commit_row.message_id, commit_row.commit_digest_sha256,
           commit_row.observed_at, commit_row.recorded_at,
           commit_row.recorded_stream_position,
           case when delivery_row.id is null then null else
             to_jsonb(delivery_row) || jsonb_build_object(
               'binding_generation', delivery_row.binding_generation::text,
               'adapter_declaration_revision',
                 delivery_row.adapter_declaration_revision::text,
               'capability_revision', delivery_row.capability_revision::text,
               'recorded_stream_position',
                 delivery_row.recorded_stream_position::text,
               'revision', delivery_row.revision::text
             )
           end as delivery_row,
           case when receipt_row.id is null then null else
             to_jsonb(receipt_row) || jsonb_build_object(
               'binding_generation', receipt_row.binding_generation::text,
               'adapter_declaration_revision',
                 receipt_row.adapter_declaration_revision::text,
               'capability_revision', receipt_row.capability_revision::text,
               'recorded_stream_position',
                 receipt_row.recorded_stream_position::text,
               'revision', receipt_row.revision::text
             )
           end as receipt_row,
           case when opaque_row.id is null then null else
             to_jsonb(opaque_row)
           end as opaque_row
      from inbox_v2_message_transport_fact_commits commit_row
      left join inbox_v2_message_delivery_observations delivery_row
        on commit_row.fact_kind = 'delivery'
       and delivery_row.tenant_id = commit_row.tenant_id
       and delivery_row.id = commit_row.observation_id
       and delivery_row.commit_token = commit_row.commit_token
      left join inbox_v2_provider_receipt_observations receipt_row
        on commit_row.fact_kind = 'receipt'
       and receipt_row.tenant_id = commit_row.tenant_id
       and receipt_row.id = commit_row.observation_id
       and receipt_row.commit_token = commit_row.commit_token
      left join inbox_v2_provider_receipt_opaque_payloads opaque_row
        on opaque_row.tenant_id = receipt_row.tenant_id
       and opaque_row.id = receipt_row.opaque_payload_id
       and opaque_row.receipt_observation_id = receipt_row.id
     where commit_row.tenant_id = ${input.tenantId}
       and commit_row.message_id = ${input.messageId}
       and commit_row.recorded_stream_position <= ${input.throughStreamPosition}
       ${cursor}
     order by commit_row.recorded_at asc,
              commit_row.fact_kind::text collate "C" asc,
              commit_row.observation_id collate "C" asc
     limit ${input.limit + 1}
  `;
}

export function buildListInboxV2ProviderLifecycleTransitionsReadSql(input: {
  tenantId: InboxV2TenantId;
  operationId: string;
  throughRevision: InboxV2EntityRevision;
  afterRevision: string;
  limit: number;
}): SQL {
  return sql`
    select *
      from inbox_v2_message_provider_lifecycle_transitions
     where tenant_id = ${input.tenantId}
       and operation_id = ${input.operationId}
       and resulting_revision > ${input.afterRevision}
       and resulting_revision <= ${input.throughRevision}
     order by resulting_revision asc, id collate "C" asc
     limit ${input.limit + 1}
  `;
}

export function computeInboxV2TimelineMessageCommitDigest(
  value: unknown
): string {
  return createHash("sha256")
    .update(stableSerialize(value), "utf8")
    .digest("hex");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(",")}}`;
}

export type InboxV2AuxiliaryReadKind =
  | "transport_links"
  | "reactions"
  | "transport_facts"
  | "provider_lifecycle";

type InboxV2AuxiliaryReadSnapshot = Readonly<{
  kind: InboxV2AuxiliaryReadKind;
  through: string;
  snapshotCreatedAt: string | null;
}>;

const AUXILIARY_READ_KIND_CODE = Object.freeze({
  transport_links: "l",
  reactions: "r",
  transport_facts: "f",
  provider_lifecycle: "p"
} satisfies Record<InboxV2AuxiliaryReadKind, string>);

export function encodeInboxV2AuxiliaryReadSnapshotToken(input: {
  kind: InboxV2AuxiliaryReadKind;
  tenantId: InboxV2TenantId;
  ownerId: string;
  through: string;
  snapshotCreatedAt?: string | null;
}): string {
  const through = parseReadBound(input.through, "Auxiliary read snapshot");
  const snapshotCreatedAt =
    input.snapshotCreatedAt === null || input.snapshotCreatedAt === undefined
      ? null
      : inboxV2TimestampSchema.parse(input.snapshotCreatedAt);
  const epoch =
    snapshotCreatedAt === null
      ? "0"
      : new Date(snapshotCreatedAt).getTime().toString();
  const kindCode = AUXILIARY_READ_KIND_CODE[input.kind];
  const scope = auxiliaryReadScopeDigest(
    input.kind,
    input.tenantId,
    input.ownerId
  );
  const unsigned = `iv2s:v1:${kindCode}:${through}:${epoch}:${scope}`;
  return inboxV2RoutingTokenSchema.parse(
    `${unsigned}:${computeInboxV2TimelineMessageCommitDigest(unsigned)}`
  );
}

export function decodeInboxV2AuxiliaryReadSnapshotToken(input: {
  token: string;
  kind: InboxV2AuxiliaryReadKind;
  tenantId: InboxV2TenantId;
  ownerId: string;
}): InboxV2AuxiliaryReadSnapshot {
  const token = inboxV2RoutingTokenSchema.parse(input.token);
  const parts = token.split(":");
  if (parts.length !== 7) throw invalidAuxiliaryReadToken("snapshot");
  const [prefix, version, kindCode, rawThrough, rawEpoch, scope, checksum] =
    parts;
  const expectedKindCode = AUXILIARY_READ_KIND_CODE[input.kind];
  const expectedScope = auxiliaryReadScopeDigest(
    input.kind,
    input.tenantId,
    input.ownerId
  );
  const unsigned = parts.slice(0, 6).join(":");
  if (
    prefix !== "iv2s" ||
    version !== "v1" ||
    kindCode !== expectedKindCode ||
    scope !== expectedScope ||
    checksum !== computeInboxV2TimelineMessageCommitDigest(unsigned)
  ) {
    throw invalidAuxiliaryReadToken("snapshot");
  }
  const through = parseReadBound(rawThrough, "Auxiliary read snapshot bound");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(rawEpoch ?? "")) {
    throw invalidAuxiliaryReadToken("snapshot");
  }
  const epoch = Number(rawEpoch);
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw invalidAuxiliaryReadToken("snapshot");
  }
  const snapshotCreatedAt =
    epoch === 0
      ? null
      : inboxV2TimestampSchema.parse(new Date(epoch).toISOString());
  return Object.freeze({
    kind: input.kind,
    through,
    snapshotCreatedAt
  });
}

export function encodeInboxV2AuxiliaryReadCursor(input: {
  kind: InboxV2AuxiliaryReadKind;
  snapshotToken: string;
  after: readonly string[];
}): string {
  const snapshotToken = inboxV2RoutingTokenSchema.parse(input.snapshotToken);
  if (
    input.after.length === 0 ||
    input.after.some(
      (part) =>
        typeof part !== "string" || part.length === 0 || part.length > 256
    )
  ) {
    throw invalidAuxiliaryReadToken("cursor");
  }
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      k: AUXILIARY_READ_KIND_CODE[input.kind],
      s: computeInboxV2TimelineMessageCommitDigest(snapshotToken),
      a: input.after
    }),
    "utf8"
  ).toString("base64url");
  const cursor = `iv2c:${payload}:${computeInboxV2TimelineMessageCommitDigest(payload)}`;
  if (cursor.length > 2_048) throw invalidAuxiliaryReadToken("cursor");
  return cursor;
}

export function decodeInboxV2AuxiliaryReadCursor(input: {
  cursor: string;
  kind: InboxV2AuxiliaryReadKind;
  snapshotToken: string;
  partCount: number;
}): readonly string[] {
  if (
    typeof input.cursor !== "string" ||
    input.cursor.length === 0 ||
    input.cursor.length > 2_048
  ) {
    throw invalidAuxiliaryReadToken("cursor");
  }
  const parts = input.cursor.split(":");
  if (parts.length !== 3 || parts[0] !== "iv2c") {
    throw invalidAuxiliaryReadToken("cursor");
  }
  const payload = parts[1] ?? "";
  if (
    parts[2] !== computeInboxV2TimelineMessageCommitDigest(payload) ||
    Buffer.from(payload, "base64url").toString("base64url") !== payload
  ) {
    throw invalidAuxiliaryReadToken("cursor");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw invalidAuxiliaryReadToken("cursor");
  }
  if (!isPlainRecord(decoded)) throw invalidAuxiliaryReadToken("cursor");
  const keys = Object.keys(decoded).sort();
  const after = decoded.a;
  if (
    !sameValue(keys, ["a", "k", "s", "v"]) ||
    decoded.v !== 1 ||
    decoded.k !== AUXILIARY_READ_KIND_CODE[input.kind] ||
    decoded.s !==
      computeInboxV2TimelineMessageCommitDigest(
        inboxV2RoutingTokenSchema.parse(input.snapshotToken)
      ) ||
    !Array.isArray(after) ||
    after.length !== input.partCount ||
    after.some(
      (part) =>
        typeof part !== "string" || part.length === 0 || part.length > 256
    )
  ) {
    throw invalidAuxiliaryReadToken("cursor");
  }
  return Object.freeze([...after]) as readonly string[];
}

function auxiliaryReadScopeDigest(
  kind: InboxV2AuxiliaryReadKind,
  tenantId: InboxV2TenantId,
  ownerId: string
): string {
  return computeInboxV2TimelineMessageCommitDigest({
    kind,
    tenantId,
    ownerId
  });
}

function parseReadBound(value: unknown, label: string): string {
  const parsed = parseDatabaseBigint(value, label);
  return parsed;
}

function invalidAuxiliaryReadToken(kind: "snapshot" | "cursor"): RangeError {
  return new RangeError(
    `Inbox V2 auxiliary read ${kind} is invalid or out of scope.`
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function actionAttributionColumns(
  attribution: InboxV2MessageRevision["actionAttribution"]
): Readonly<{
  appActorKind: string | null;
  appActorEmployeeId: string | null;
  appAuthorizationEpoch: string | null;
  appTrustedServiceId: string | null;
  automationKind: string | null;
  automationCauseEventId: string | null;
  automationCorrelationId: string | null;
  automationCausedAt: string | null;
  automationInitiatingEmployeeId: string | null;
  automationInitiatingAuthorizationEpoch: string | null;
}> {
  const appActor = attribution.appActor;
  const automation = attribution.automationCausation;
  return {
    appActorKind: appActor?.kind ?? null,
    appActorEmployeeId:
      appActor?.kind === "employee" ? appActor.employee.id : null,
    appAuthorizationEpoch:
      appActor?.kind === "employee" ? appActor.authorizationEpoch : null,
    appTrustedServiceId:
      appActor?.kind === "trusted_service" ? appActor.trustedServiceId : null,
    automationKind: automation?.kind ?? null,
    automationCauseEventId: automation?.causeEvent.id ?? null,
    automationCorrelationId: automation?.correlationId ?? null,
    automationCausedAt: automation?.causedAt ?? null,
    automationInitiatingEmployeeId:
      automation?.kind === "employee_command"
        ? automation.initiatingActor.employee.id
        : null,
    automationInitiatingAuthorizationEpoch:
      automation?.kind === "employee_command"
        ? automation.initiatingActor.authorizationEpoch
        : null
  };
}

function contentStateColumns(content: InboxV2TimelineContent): Readonly<{
  contentDigestSha256: string | null;
  tombstoneEventId: string | null;
  tombstoneReasonId: string | null;
  retentionPolicyId: string | null;
  retentionPolicyVersion: string | null;
  retentionPolicyRevision: InboxV2EntityRevision | null;
}> {
  switch (content.state.kind) {
    case "available":
      return {
        contentDigestSha256: content.state.contentDigestSha256,
        tombstoneEventId: null,
        tombstoneReasonId: null,
        retentionPolicyId: null,
        retentionPolicyVersion: null,
        retentionPolicyRevision: null
      };
    case "privacy_erased":
      return {
        contentDigestSha256: null,
        tombstoneEventId: content.state.tombstoneEvent.id,
        tombstoneReasonId: content.state.reasonId,
        retentionPolicyId: null,
        retentionPolicyVersion: null,
        retentionPolicyRevision: null
      };
    case "retention_purged":
      return {
        contentDigestSha256: null,
        tombstoneEventId: content.state.tombstoneEvent.id,
        tombstoneReasonId: null,
        retentionPolicyId: content.state.policyId,
        retentionPolicyVersion: content.state.policyVersion,
        retentionPolicyRevision: content.state.policyRevision
      };
  }
}

type ContentBlockColumns = Readonly<{
  textRole: string | null;
  textValue: string | null;
  language: string | null;
  attachmentId: string | null;
  attachmentState: string | null;
  attachmentFileId: string | null;
  attachmentV2FileId: string | null;
  attachmentFileRevision: InboxV2EntityRevision | null;
  attachmentFileVersionId: string | null;
  attachmentObjectVersionId: string | null;
  attachmentFailureReasonId: string | null;
  displayName: string | null;
  mediaSemantic: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  locationMode: string | null;
  liveUntil: string | null;
  headingDegrees: number | null;
  locationLabel: string | null;
  locationAddress: string | null;
  contactDisplayName: string | null;
  contactOrganization: string | null;
  unsupportedSourceOccurrenceId: string | null;
  providerContentKindId: string | null;
  safeFallbackReasonId: string | null;
  extensionBlockKindId: string | null;
  extensionPayloadSchemaId: string | null;
  extensionPayloadSchemaVersion: string | null;
  extensionPayloadFileId: string | null;
  extensionPayloadV2FileId: string | null;
  extensionPayloadFileRevision: InboxV2EntityRevision | null;
  extensionPayloadFileVersionId: string | null;
  extensionPayloadObjectVersionId: string | null;
  extensionPayloadDigestSha256: string | null;
  extensionRendererId: string | null;
}>;

function contentBlockColumns(
  block: InboxV2MessageContentBlock
): ContentBlockColumns {
  const empty: ContentBlockColumns = {
    textRole: null,
    textValue: null,
    language: null,
    attachmentId: null,
    attachmentState: null,
    attachmentFileId: null,
    attachmentV2FileId: null,
    attachmentFileRevision: null,
    attachmentFileVersionId: null,
    attachmentObjectVersionId: null,
    attachmentFailureReasonId: null,
    displayName: null,
    mediaSemantic: null,
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    locationMode: null,
    liveUntil: null,
    headingDegrees: null,
    locationLabel: null,
    locationAddress: null,
    contactDisplayName: null,
    contactOrganization: null,
    unsupportedSourceOccurrenceId: null,
    providerContentKindId: null,
    safeFallbackReasonId: null,
    extensionBlockKindId: null,
    extensionPayloadSchemaId: null,
    extensionPayloadSchemaVersion: null,
    extensionPayloadFileId: null,
    extensionPayloadV2FileId: null,
    extensionPayloadFileRevision: null,
    extensionPayloadFileVersionId: null,
    extensionPayloadObjectVersionId: null,
    extensionPayloadDigestSha256: null,
    extensionRendererId: null
  };
  switch (block.kind) {
    case "text":
      return {
        ...empty,
        textRole: block.role,
        textValue: block.text,
        language: block.language
      };
    case "image":
    case "file":
    case "sticker":
      return {
        ...empty,
        ...attachmentColumns(block.attachment),
        displayName: block.displayName
      };
    case "audio":
    case "video":
      return {
        ...empty,
        ...attachmentColumns(block.attachment),
        mediaSemantic: block.semantic
      };
    case "location":
      return {
        ...empty,
        latitude: block.latitude,
        longitude: block.longitude,
        accuracyMeters: block.accuracyMeters,
        locationMode: block.mode,
        liveUntil: block.liveUntil,
        headingDegrees: block.headingDegrees,
        locationLabel: block.label,
        locationAddress: block.address
      };
    case "contact":
      return {
        ...empty,
        contactDisplayName: block.displayName,
        contactOrganization: block.organization
      };
    case "unsupported_source_content":
      return {
        ...empty,
        unsupportedSourceOccurrenceId: block.sourceOccurrence.id,
        providerContentKindId: block.providerContentKindId,
        safeFallbackReasonId: block.safeFallbackReasonId
      };
    case "extension":
      return {
        ...empty,
        extensionBlockKindId: block.blockKindId,
        extensionPayloadSchemaId: block.payloadSchemaId,
        extensionPayloadSchemaVersion: block.payloadSchemaVersion,
        extensionPayloadFileId:
          block.payloadPin.state === "legacy_unpinned"
            ? block.payloadFile.id
            : null,
        extensionPayloadV2FileId:
          block.payloadPin.state === "exact" ? block.payloadFile.id : null,
        extensionPayloadFileRevision:
          block.payloadPin.state === "exact"
            ? block.payloadPin.fileRevision
            : null,
        extensionPayloadFileVersionId:
          block.payloadPin.state === "exact"
            ? block.payloadPin.fileVersion.id
            : null,
        extensionPayloadObjectVersionId:
          block.payloadPin.state === "exact"
            ? block.payloadPin.objectVersion.id
            : null,
        extensionPayloadDigestSha256: block.payloadDigestSha256,
        extensionRendererId: block.rendererId
      };
  }
}

function attachmentColumns(
  attachment: Extract<
    InboxV2MessageContentBlock,
    { kind: "image" }
  >["attachment"]
): Pick<
  ContentBlockColumns,
  | "attachmentId"
  | "attachmentState"
  | "attachmentFileId"
  | "attachmentV2FileId"
  | "attachmentFileRevision"
  | "attachmentFileVersionId"
  | "attachmentObjectVersionId"
  | "attachmentFailureReasonId"
> {
  return {
    attachmentId: attachment.attachment.id,
    // The legacy SQL enum predates the explicit contract compatibility state.
    // Column family, not a forged V2 pin, distinguishes legacy_unpinned.
    attachmentState:
      attachment.state === "legacy_unpinned" ? "ready" : attachment.state,
    attachmentFileId:
      attachment.state === "legacy_unpinned" ? attachment.file.id : null,
    attachmentV2FileId:
      attachment.state === "ready" ? attachment.file.id : null,
    attachmentFileRevision:
      attachment.state === "ready" ? attachment.fileRevision : null,
    attachmentFileVersionId:
      attachment.state === "ready" ? attachment.fileVersion.id : null,
    attachmentObjectVersionId:
      attachment.state === "ready" ? attachment.objectVersion.id : null,
    attachmentFailureReasonId:
      attachment.state === "failed" || attachment.state === "quarantined"
        ? attachment.reasonId
        : null
  };
}

function timelineActivityColumns(item: InboxV2TimelineItem): Readonly<{
  sourceOccurrenceId: string | null;
  reasonId: string | null;
  migrationProvenanceId: string | null;
  importedAt: string | null;
}> {
  switch (item.activity.kind) {
    case "eligible":
      return {
        sourceOccurrenceId: null,
        reasonId: null,
        migrationProvenanceId: null,
        importedAt: null
      };
    case "history_import":
      return {
        sourceOccurrenceId: item.activity.sourceOccurrence.id,
        reasonId: null,
        migrationProvenanceId: null,
        importedAt: item.activity.importedAt
      };
    case "migration":
      return {
        sourceOccurrenceId: null,
        reasonId: null,
        migrationProvenanceId: item.activity.provenanceId,
        importedAt: item.activity.importedAt
      };
    case "non_activity":
      return {
        sourceOccurrenceId: null,
        reasonId: item.activity.reasonId,
        migrationProvenanceId: null,
        importedAt: null
      };
  }
}

function timelineSubjectId(item: InboxV2TimelineItem): string {
  switch (item.subject.kind) {
    case "message":
      return item.subject.message.id;
    case "staff_note":
      return item.subject.staffNote.id;
    case "call":
    case "review":
    case "module_event":
      return item.subject.source.sourceObject.id;
    case "participant_change":
    case "work_change":
      return item.subject.transition.id;
    case "system_event":
      return item.subject.event.id;
  }
}

function messageOriginColumns(message: InboxV2Message): Readonly<{
  sourceOccurrenceId: string | null;
  sourceDirection: string | null;
  claimId: string | null;
  claimVersion: InboxV2EntityRevision | null;
  claimEmployeeId: string | null;
  outboundRouteId: string | null;
  migrationProvenanceId: string | null;
}> {
  switch (message.origin.kind) {
    case "source_originated":
      return {
        sourceOccurrenceId: message.origin.originOccurrence.id,
        sourceDirection: message.origin.direction,
        claimId: message.origin.claimAtOccurrence?.claim.id ?? null,
        claimVersion: message.origin.claimAtOccurrence?.claimVersion ?? null,
        claimEmployeeId:
          message.origin.claimAtOccurrence?.resolvedEmployee.id ?? null,
        outboundRouteId: null,
        migrationProvenanceId: null
      };
    case "hulee_external":
      return {
        sourceOccurrenceId: null,
        sourceDirection: null,
        claimId: null,
        claimVersion: null,
        claimEmployeeId: null,
        outboundRouteId: message.origin.outboundRoute.id,
        migrationProvenanceId: null
      };
    case "internal":
      return {
        sourceOccurrenceId: null,
        sourceDirection: null,
        claimId: null,
        claimVersion: null,
        claimEmployeeId: null,
        outboundRouteId: null,
        migrationProvenanceId: null
      };
    case "migration":
      return {
        sourceOccurrenceId: null,
        sourceDirection: null,
        claimId: null,
        claimVersion: null,
        claimEmployeeId: null,
        outboundRouteId: null,
        migrationProvenanceId: message.origin.provenanceId
      };
  }
}

function messageReferenceKind(message: InboxV2Message): string {
  const reference = message.referenceContext;
  if (reference.kind === "none") return "none";
  if (reference.kind === "reply") {
    return reference.target.state === "resolved_internal"
      ? "reply_resolved_internal"
      : reference.target.state === "resolved_external"
        ? "reply_resolved_external"
        : "reply_unresolved_source";
  }
  return reference.kind;
}

function messageLifecycleColumns(message: InboxV2Message): Readonly<{
  revisionId: string | null;
  reasonId: string | null;
  providerOperationId: string | null;
  policyReasonId: string | null;
  changedAt: string | null;
}> {
  switch (message.lifecycle.kind) {
    case "active":
      return {
        revisionId: null,
        reasonId: null,
        providerOperationId: null,
        policyReasonId: null,
        changedAt: null
      };
    case "local_delete_tombstone":
      return {
        revisionId: message.lifecycle.revision.id,
        reasonId: message.lifecycle.reasonId,
        providerOperationId: null,
        policyReasonId: null,
        changedAt: message.lifecycle.deletedAt
      };
    case "provider_delete_tombstone":
      return {
        revisionId: message.lifecycle.revision.id,
        reasonId: null,
        providerOperationId: message.lifecycle.providerOperation.id,
        policyReasonId: message.lifecycle.policyReasonId,
        changedAt: message.lifecycle.appliedAt
      };
  }
}

function messageRevisionColumns(revision: InboxV2MessageRevision): Readonly<{
  beforeContentId: string | null;
  beforeContentRevision: InboxV2EntityRevision | null;
  beforeContentState: string | null;
  afterContentId: string | null;
  afterContentRevision: InboxV2EntityRevision | null;
  afterContentState: string | null;
  providerOperationId: string | null;
  reasonId: string | null;
}> {
  const empty = {
    beforeContentId: null,
    beforeContentRevision: null,
    beforeContentState: null,
    afterContentId: null,
    afterContentRevision: null,
    afterContentState: null,
    providerOperationId: null,
    reasonId: null
  } as const;
  const columns = (head: InboxV2Message["content"]) => ({
    contentId: head.content.id,
    contentRevision: head.contentRevision,
    contentState: head.stateKind
  });
  switch (revision.change.kind) {
    case "created": {
      const after = columns(revision.change.content);
      return {
        ...empty,
        afterContentId: after.contentId,
        afterContentRevision: after.contentRevision,
        afterContentState: after.contentState
      };
    }
    case "edited": {
      const before = columns(revision.change.beforeContent);
      const after = columns(revision.change.afterContent);
      return {
        ...empty,
        beforeContentId: before.contentId,
        beforeContentRevision: before.contentRevision,
        beforeContentState: before.contentState,
        afterContentId: after.contentId,
        afterContentRevision: after.contentRevision,
        afterContentState: after.contentState,
        providerOperationId: revision.change.providerOperation?.id ?? null
      };
    }
    case "attachment_materialized":
    case "privacy_erasure_tombstone":
    case "retention_purge_tombstone": {
      const before = columns(revision.change.beforeContent);
      const after = columns(revision.change.afterContent);
      return {
        ...empty,
        beforeContentId: before.contentId,
        beforeContentRevision: before.contentRevision,
        beforeContentState: before.contentState,
        afterContentId: after.contentId,
        afterContentRevision: after.contentRevision,
        afterContentState: after.contentState
      };
    }
    case "local_delete_tombstone":
      return { ...empty, reasonId: revision.change.reasonId };
    case "provider_delete_policy_tombstone":
      return {
        ...empty,
        reasonId: revision.change.policyReasonId,
        providerOperationId: revision.change.providerOperation.id
      };
  }
}

function messageReferenceContextColumns(message: InboxV2Message): Readonly<{
  kind:
    | "none"
    | "reply"
    | "forward_content_copy"
    | "forward_provider_native"
    | "forward_provider_observed";
  originSourceOccurrenceId: string | null;
  provenanceCompleteness: string | null;
  nativeCapabilityId: string | null;
  nativeCapabilityRevision: InboxV2EntityRevision | null;
  nativeAdapterContractId: string | null;
  nativeAdapterContractVersion: string | null;
  nativeAdapterDeclarationRevision: InboxV2EntityRevision | null;
  nativeAdapterSurfaceId: string | null;
  nativeAdapterLoadedByTrustedServiceId: string | null;
  nativeAdapterLoadedAt: string | null;
}> {
  const reference = message.referenceContext;
  const empty = {
    originSourceOccurrenceId: null,
    provenanceCompleteness: null,
    nativeCapabilityId: null,
    nativeCapabilityRevision: null,
    nativeAdapterContractId: null,
    nativeAdapterContractVersion: null,
    nativeAdapterDeclarationRevision: null,
    nativeAdapterSurfaceId: null,
    nativeAdapterLoadedByTrustedServiceId: null,
    nativeAdapterLoadedAt: null
  } as const;
  if (reference.kind === "forward_provider_native") {
    const adapter = reference.capability.adapterContract;
    return {
      ...empty,
      kind: reference.kind,
      nativeCapabilityId: reference.capability.capabilityId,
      nativeCapabilityRevision: reference.capability.capabilityRevision,
      nativeAdapterContractId: adapter.contractId,
      nativeAdapterContractVersion: adapter.contractVersion,
      nativeAdapterDeclarationRevision: adapter.declarationRevision,
      nativeAdapterSurfaceId: adapter.surfaceId,
      nativeAdapterLoadedByTrustedServiceId: adapter.loadedByTrustedServiceId,
      nativeAdapterLoadedAt: adapter.loadedAt
    };
  }
  if (reference.kind === "forward_provider_observed") {
    return {
      ...empty,
      kind: reference.kind,
      originSourceOccurrenceId: reference.originOccurrence.id,
      provenanceCompleteness: reference.provenanceCompleteness
    };
  }
  return { ...empty, kind: reference.kind };
}

function canonicalReferenceTargets(message: InboxV2Message): readonly Readonly<{
  message: { id: string };
  timelineItem: { id: string };
  messageRevision: InboxV2EntityRevision;
}>[] {
  const reference = message.referenceContext;
  if (reference.kind === "reply") {
    return reference.target.state === "unresolved_source"
      ? []
      : [reference.target.canonical];
  }
  return reference.kind === "forward_content_copy" ? reference.sources : [];
}

function externalReferenceTargets(message: InboxV2Message): readonly Readonly<{
  externalMessageReference: { id: string };
  sourceOccurrence: { id: string };
}>[] {
  const reference = message.referenceContext;
  if (reference.kind === "reply") {
    return reference.target.state === "resolved_external"
      ? [reference.target.external]
      : [];
  }
  return reference.kind === "forward_provider_native"
    ? reference.sources
    : reference.kind === "forward_provider_observed"
      ? reference.sourceReferences
      : [];
}

function unresolvedReferenceTarget(message: InboxV2Message) {
  const reference = message.referenceContext;
  return reference.kind === "reply" &&
    reference.target.state === "unresolved_source"
    ? reference.target.source
    : null;
}

function deliveryScopeColumns(
  scope: InboxV2MessageTransportFactCommit["fact"] extends infer _T
    ? Extract<
        InboxV2MessageTransportFactCommit["fact"],
        { kind: "delivery" }
      >["observation"]["scope"]
    : never
): Readonly<{
  dispatchId: string | null;
  attemptId: string | null;
  artifactId: string | null;
  externalMessageReferenceId: string | null;
  sourceOccurrenceId: string | null;
  recipientSourceIdentityId: string | null;
}> {
  switch (scope.kind) {
    case "dispatch":
      return {
        dispatchId: scope.dispatch.id,
        attemptId: scope.attempt?.id ?? null,
        artifactId: scope.artifact?.id ?? null,
        externalMessageReferenceId: null,
        sourceOccurrenceId: null,
        recipientSourceIdentityId: null
      };
    case "external_reference":
      return {
        dispatchId: null,
        attemptId: null,
        artifactId: null,
        externalMessageReferenceId: scope.externalMessageReference.id,
        sourceOccurrenceId: scope.sourceOccurrence.id,
        recipientSourceIdentityId: null
      };
    case "recipient":
      return {
        dispatchId: null,
        attemptId: null,
        artifactId: null,
        externalMessageReferenceId: scope.externalMessageReference.id,
        sourceOccurrenceId: null,
        recipientSourceIdentityId: scope.recipient.id
      };
  }
}

function deliveryEvidenceColumns(
  evidence: Extract<
    InboxV2MessageTransportFactCommit["fact"],
    { kind: "delivery" }
  >["observation"]["evidence"]
): Readonly<{
  attemptId: string | null;
  artifactId: string | null;
  normalizedInboundEventId: string | null;
  externalMessageReferenceId: string | null;
  sourceOccurrenceId: string | null;
}> {
  switch (evidence.kind) {
    case "provider_result":
      return {
        attemptId: evidence.attempt.id,
        artifactId: null,
        normalizedInboundEventId: null,
        externalMessageReferenceId: null,
        sourceOccurrenceId: null
      };
    case "provider_artifact":
      return {
        attemptId: evidence.attempt.id,
        artifactId: evidence.artifact.id,
        normalizedInboundEventId: null,
        externalMessageReferenceId: null,
        sourceOccurrenceId: null
      };
    case "provider_event":
      return {
        attemptId: null,
        artifactId: null,
        normalizedInboundEventId: evidence.normalizedInboundEvent.id,
        externalMessageReferenceId: evidence.externalMessageReference.id,
        sourceOccurrenceId: evidence.sourceOccurrence.id
      };
  }
}

function receiptTargetColumns(
  target: Extract<
    InboxV2MessageTransportFactCommit["fact"],
    { kind: "receipt" }
  >["observation"]["target"]
): Readonly<{
  messageId: string | null;
  externalMessageReferenceId: string | null;
  sourceOccurrenceId: string | null;
  providerWatermark: string | null;
  readThroughProviderTime: string | null;
}> {
  switch (target.kind) {
    case "exact_message":
      return {
        messageId: target.message.id,
        externalMessageReferenceId: target.externalMessageReference.id,
        sourceOccurrenceId: target.sourceOccurrence.id,
        providerWatermark: null,
        readThroughProviderTime: null
      };
    case "provider_watermark":
      return {
        messageId: null,
        externalMessageReferenceId: null,
        sourceOccurrenceId: null,
        providerWatermark: target.watermark,
        readThroughProviderTime: null
      };
    case "thread_readmark":
      return {
        messageId: null,
        externalMessageReferenceId: null,
        sourceOccurrenceId: null,
        providerWatermark: null,
        readThroughProviderTime: target.readThroughProviderTime
      };
  }
}

function receiptReaderColumns(
  reader: Extract<
    InboxV2MessageTransportFactCommit["fact"],
    { kind: "receipt" }
  >["observation"]["reader"]
): Readonly<{
  sourceExternalIdentityId: string | null;
  aggregateKey: string | null;
}> {
  return reader.kind === "source_external_identity"
    ? {
        sourceExternalIdentityId: reader.sourceExternalIdentity.id,
        aggregateKey: null
      }
    : { sourceExternalIdentityId: null, aggregateKey: reader.aggregateKey };
}

function jsonbDetail(value: unknown): SQL {
  return value === null
    ? sql`null`
    : sql`${JSON.stringify(canonicalizePersistenceValue(value))}::jsonb`;
}

function computeUtf8Digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function derivedInboxV2Id(prefix: string, source: string): string {
  return `${prefix}:${computeUtf8Digest(source)}`;
}

type ReactionActor = InboxV2MessageReactionCommit["afterReaction"]["actor"];
type ReactionCapability =
  InboxV2MessageReactionCommit["afterReaction"]["capability"];
type ReactionState = InboxV2MessageReactionCommit["afterReaction"]["state"];
type ReactionAuthority =
  InboxV2MessageReactionCommit["transition"]["externalAuthority"];

function reactionActorColumns(actor: ReactionActor): Readonly<{
  participantId: string | null;
  sourceOccurrenceId: string | null;
  opaqueActorKey: string | null;
  opaqueActorKeyDigestSha256: string | null;
  aggregateScope: string | null;
  providerActorKindId: string | null;
  providerActorSubject: string | null;
  providerActorSubjectDigestSha256: string | null;
  identityDataClassId: string | null;
  identityState: string | null;
  identityTombstoneEventId: string | null;
  identityPurgedAt: string | null;
}> {
  const empty = {
    participantId: null,
    sourceOccurrenceId: null,
    opaqueActorKey: null,
    opaqueActorKeyDigestSha256: null,
    aggregateScope: null,
    providerActorKindId: null,
    providerActorSubject: null,
    providerActorSubjectDigestSha256: null,
    identityDataClassId: null,
    identityState: null,
    identityTombstoneEventId: null,
    identityPurgedAt: null
  };
  switch (actor.kind) {
    case "participant":
      return { ...empty, participantId: actor.participant.id };
    case "unattributed_source_observation":
      return {
        ...empty,
        sourceOccurrenceId: actor.sourceOccurrence.id,
        opaqueActorKey: actor.opaqueActorKey,
        opaqueActorKeyDigestSha256: computeUtf8Digest(actor.opaqueActorKey),
        identityDataClassId: "core:source_occurrence_and_external_reference",
        identityState: "available"
      };
    case "aggregate_only":
      return {
        ...empty,
        sourceOccurrenceId: actor.sourceOccurrence.id,
        aggregateScope: actor.aggregateScope
      };
    case "provider_system":
      return {
        ...empty,
        sourceOccurrenceId: actor.sourceOccurrence.id,
        providerActorKindId: actor.actorKindId,
        providerActorSubject: actor.actorSubject,
        providerActorSubjectDigestSha256: computeUtf8Digest(actor.actorSubject),
        identityDataClassId: "core:source_occurrence_and_external_reference",
        identityState: "available"
      };
  }
}

function reactionCapabilityColumns(capability: ReactionCapability): Readonly<{
  capabilityId: string | null;
  capabilityRevision: InboxV2EntityRevision | null;
  adapterContractId: string | null;
  adapterContractVersion: string | null;
}> {
  return capability.kind === "internal"
    ? {
        capabilityId: null,
        capabilityRevision: null,
        adapterContractId: null,
        adapterContractVersion: null
      }
    : {
        capabilityId: capability.capabilityId,
        capabilityRevision: capability.capabilityRevision,
        adapterContractId: capability.adapterContract.contractId,
        adapterContractVersion: capability.adapterContract.contractVersion
      };
}

function reactionStateColumns(state: ReactionState): Readonly<{
  valueKind: "unicode" | "provider_custom";
  unicodeValue: string | null;
  providerReactionKindId: string | null;
  providerCanonicalCode: string | null;
  clearedAt: string | null;
  externalOperation: string | null;
  outboundRouteId: string | null;
  requestTransitionId: string | null;
  requestAttributionId: string | null;
  externalOutcome: string | null;
  resultToken: string | null;
  resultDigestSha256: string | null;
  resolvedAt: string | null;
}> {
  const value = reactionValue(state);
  const valueColumns =
    value.kind === "unicode"
      ? {
          valueKind: value.kind,
          unicodeValue: value.value,
          providerReactionKindId: null,
          providerCanonicalCode: null
        }
      : {
          valueKind: value.kind,
          unicodeValue: null,
          providerReactionKindId: value.providerKindId,
          providerCanonicalCode: value.canonicalCode
        };
  if (state.kind === "active") {
    return {
      ...valueColumns,
      clearedAt: null,
      externalOperation: null,
      outboundRouteId: null,
      requestTransitionId: null,
      requestAttributionId: null,
      externalOutcome: null,
      resultToken: null,
      resultDigestSha256: null,
      resolvedAt: null
    };
  }
  if (state.kind === "cleared") {
    return {
      ...valueColumns,
      clearedAt: state.clearedAt,
      externalOperation: null,
      outboundRouteId: null,
      requestTransitionId: null,
      requestAttributionId: null,
      externalOutcome: null,
      resultToken: null,
      resultDigestSha256: null,
      resolvedAt: null
    };
  }
  if (state.kind === "pending_external") {
    return {
      ...valueColumns,
      clearedAt: null,
      externalOperation: state.operation,
      outboundRouteId: state.outboundRoute.id,
      requestTransitionId: state.requestTransition.id,
      requestAttributionId: derivedInboxV2Id(
        "action_attribution",
        state.requestTransition.id
      ),
      externalOutcome: null,
      resultToken: null,
      resultDigestSha256: null,
      resolvedAt: null
    };
  }
  return {
    ...valueColumns,
    clearedAt: null,
    externalOperation: state.operation,
    outboundRouteId: state.outboundRoute.id,
    requestTransitionId: state.requestTransition.id,
    requestAttributionId: null,
    externalOutcome: state.outcome,
    resultToken: state.resultToken,
    resultDigestSha256: state.resultDigestSha256,
    resolvedAt: state.resolvedAt
  };
}

function reactionValue(state: ReactionState) {
  if (state.kind === "active") return state.value;
  if (state.kind === "cleared") return state.lastValue;
  return state.desired.kind === "active"
    ? state.desired.value
    : state.desired.lastValue;
}

function reactionExternalAuthorityColumns(
  authority: ReactionAuthority
): Readonly<{
  externalMessageReferenceId: string | null;
  sourceOccurrenceId: string | null;
  sourceAccountId: string | null;
  sourceThreadBindingId: string | null;
  bindingGeneration: InboxV2EntityRevision | null;
  outboundRouteId: string | null;
  capabilityId: string | null;
  capabilityRevision: InboxV2EntityRevision | null;
  adapterContractId: string | null;
  adapterContractVersion: string | null;
}> {
  if (authority === null) {
    return {
      externalMessageReferenceId: null,
      sourceOccurrenceId: null,
      sourceAccountId: null,
      sourceThreadBindingId: null,
      bindingGeneration: null,
      outboundRouteId: null,
      capabilityId: null,
      capabilityRevision: null,
      adapterContractId: null,
      adapterContractVersion: null
    };
  }
  return {
    externalMessageReferenceId: authority.externalMessageReference.id,
    sourceOccurrenceId: authority.sourceOccurrence.id,
    sourceAccountId: authority.sourceAccount.id,
    sourceThreadBindingId: authority.sourceThreadBinding.id,
    bindingGeneration: authority.bindingGeneration,
    outboundRouteId: authority.outboundRoute?.id ?? null,
    capabilityId: authority.capabilityFence.capabilityId,
    capabilityRevision: authority.capabilityFence.capabilityRevision,
    adapterContractId: authority.adapterContract.contractId,
    adapterContractVersion: authority.adapterContract.contractVersion
  };
}

function reactionRowMatches(
  row: Record<string, unknown>,
  reaction: NonNullable<InboxV2MessageReactionCommit["beforeReaction"]>
): boolean {
  const actor = reactionActorColumns(reaction.actor);
  const capability = reactionCapabilityColumns(reaction.capability);
  const state = reactionStateColumns(reaction.state);
  return (
    row.id === reaction.id &&
    row.message_id === reaction.message.id &&
    row.actor_kind === reaction.actor.kind &&
    nullableString(row.actor_participant_id) === actor.participantId &&
    nullableString(row.actor_source_occurrence_id) ===
      actor.sourceOccurrenceId &&
    nullableString(row.opaque_actor_key) === actor.opaqueActorKey &&
    nullableString(row.opaque_actor_key_digest_sha256) ===
      actor.opaqueActorKeyDigestSha256 &&
    nullableString(row.aggregate_scope) === actor.aggregateScope &&
    nullableString(row.provider_actor_kind_id) === actor.providerActorKindId &&
    nullableString(row.provider_actor_subject) === actor.providerActorSubject &&
    nullableString(row.provider_actor_subject_digest_sha256) ===
      actor.providerActorSubjectDigestSha256 &&
    row.capability_kind === reaction.capability.kind &&
    nullableString(row.capability_id) === capability.capabilityId &&
    nullableRevision(
      row.capability_revision,
      "Reaction capability revision"
    ) === capability.capabilityRevision &&
    row.cardinality === reaction.capability.cardinality &&
    nullableString(row.adapter_contract_id) === capability.adapterContractId &&
    nullableString(row.adapter_contract_version) ===
      capability.adapterContractVersion &&
    sameValue(row.capability_detail, reaction.capability) &&
    row.capability_detail_digest_sha256 ===
      computeInboxV2TimelineMessageCommitDigest(reaction.capability) &&
    row.semantic_slot_key === reaction.semanticSlotKey &&
    row.state_kind === reaction.state.kind &&
    reactionValueColumnsRowMatch(row, state) &&
    sameValue(row.state_detail, reaction.state) &&
    row.state_detail_digest_sha256 ===
      computeInboxV2TimelineMessageCommitDigest(reaction.state) &&
    parseRevision(row.revision, "Reaction revision") === reaction.revision &&
    parseTimestamp(row.created_at, "Reaction createdAt") ===
      reaction.createdAt &&
    parseTimestamp(row.updated_at, "Reaction updatedAt") === reaction.updatedAt
  );
}

function reactionValueColumnsRowMatch(
  row: Record<string, unknown>,
  state: ReturnType<typeof reactionStateColumns>
): boolean {
  return (
    row.value_kind === state.valueKind &&
    nullableString(row.unicode_value) === state.unicodeValue &&
    nullableString(row.provider_reaction_kind_id) ===
      state.providerReactionKindId &&
    nullableString(row.provider_canonical_code) ===
      state.providerCanonicalCode &&
    nullableTimestamp(row.cleared_at, "Reaction clearedAt") ===
      state.clearedAt &&
    nullableString(row.external_operation) === state.externalOperation &&
    nullableString(row.outbound_route_id) === state.outboundRouteId &&
    nullableString(row.request_transition_id) === state.requestTransitionId &&
    nullableString(row.request_attribution_id) === state.requestAttributionId &&
    nullableString(row.external_outcome) === state.externalOutcome &&
    nullableString(row.result_token) === state.resultToken &&
    nullableString(row.result_digest_sha256) === state.resultDigestSha256 &&
    nullableTimestamp(row.resolved_at, "Reaction resolvedAt") ===
      state.resolvedAt
  );
}

function reactionSlotHeadRowMatches(
  row: Record<string, unknown>,
  head: NonNullable<InboxV2MessageReactionCommit["slotHeadBefore"]>
): boolean {
  return (
    row.message_id === head.message.id &&
    row.semantic_slot_key === head.semanticSlotKey &&
    row.reaction_id === head.reaction.id &&
    row.state_kind === head.state.kind &&
    parseRevision(row.revision, "Reaction slot-head revision") ===
      head.revision &&
    parseTimestamp(row.updated_at, "Reaction slot-head updatedAt") ===
      head.updatedAt
  );
}

function reactionTransitionRowMatches(
  row: Record<string, unknown>,
  commit: InboxV2MessageReactionCommit
): boolean {
  const transition = commit.transition;
  const afterState = reactionStateColumns(transition.afterState);
  const authority = reactionExternalAuthorityColumns(
    transition.externalAuthority
  );
  const proof = commit.providerResultProof;
  return (
    row.id === transition.id &&
    row.reaction_id === transition.reaction.id &&
    row.semantic_slot_key === transition.semanticSlotKey &&
    row.mode === transition.mode &&
    row.operation === transition.operation &&
    nullableRevision(row.expected_revision, "Reaction expected revision") ===
      transition.expectedRevision &&
    parseRevision(row.resulting_revision, "Reaction resulting revision") ===
      transition.resultingRevision &&
    nullableString(row.before_state_kind) ===
      (transition.beforeState?.kind ?? null) &&
    row.after_state_kind === transition.afterState.kind &&
    sameValue(row.before_state_detail ?? null, transition.beforeState) &&
    nullableString(row.before_state_detail_digest_sha256) ===
      (transition.beforeState === null
        ? null
        : computeInboxV2TimelineMessageCommitDigest(transition.beforeState)) &&
    sameValue(row.after_state_detail, transition.afterState) &&
    row.after_state_detail_digest_sha256 ===
      computeInboxV2TimelineMessageCommitDigest(transition.afterState) &&
    reactionValueColumnsRowMatch(row, {
      ...afterState,
      clearedAt: nullableTimestamp(row.cleared_at, "Unused clearedAt"),
      externalOperation: nullableString(row.external_operation),
      outboundRouteId: nullableString(row.outbound_route_id),
      requestTransitionId: nullableString(row.request_transition_id),
      requestAttributionId: nullableString(row.request_attribution_id),
      externalOutcome: nullableString(row.external_outcome),
      resultToken: nullableString(row.result_token),
      resultDigestSha256: nullableString(row.result_digest_sha256),
      resolvedAt: nullableTimestamp(row.resolved_at, "Unused resolvedAt")
    }) &&
    nullableString(row.external_message_reference_id) ===
      authority.externalMessageReferenceId &&
    nullableString(row.source_occurrence_id) === authority.sourceOccurrenceId &&
    nullableString(row.source_account_id) === authority.sourceAccountId &&
    nullableString(row.source_thread_binding_id) ===
      authority.sourceThreadBindingId &&
    nullableRevision(row.binding_generation, "Reaction binding generation") ===
      authority.bindingGeneration &&
    nullableString(row.outbound_route_id) === authority.outboundRouteId &&
    nullableString(row.capability_id) === authority.capabilityId &&
    nullableRevision(
      row.capability_revision,
      "Reaction authority capability revision"
    ) === authority.capabilityRevision &&
    nullableString(row.adapter_contract_id) === authority.adapterContractId &&
    nullableString(row.adapter_contract_version) ===
      authority.adapterContractVersion &&
    sameValue(
      row.external_authority_detail ?? null,
      transition.externalAuthority
    ) &&
    nullableString(row.external_authority_detail_digest_sha256) ===
      (transition.externalAuthority === null
        ? null
        : computeInboxV2TimelineMessageCommitDigest(
            transition.externalAuthority
          )) &&
    sameValue(row.provider_result_proof_detail ?? null, proof) &&
    nullableString(row.provider_result_proof_detail_digest_sha256) ===
      (proof === null
        ? null
        : computeInboxV2TimelineMessageCommitDigest(proof)) &&
    nullableString(row.result_token) === (proof?.resultToken ?? null) &&
    nullableString(row.result_digest_sha256) ===
      (proof?.resultDigestSha256 ?? null) &&
    row.action_attribution_id ===
      derivedInboxV2Id("action_attribution", transition.id) &&
    actionAttributionRowMatches(row, transition.actionAttribution) &&
    parseTimestamp(row.occurred_at, "Reaction transition occurredAt") ===
      transition.occurredAt &&
    parseTimestamp(row.recorded_at, "Reaction transition recordedAt") ===
      transition.recordedAt
  );
}

function providerReactionObservationRowMatches(
  row: Record<string, unknown>,
  observation: NonNullable<InboxV2MessageReactionCommit["providerObservation"]>,
  transitionId: string
): boolean {
  const proof = observation.semanticProof;
  const occurrence = proof.sourceOccurrence;
  if (occurrence === null || proof.ordering.kind !== "monotonic_exact") {
    return false;
  }
  const normalized = reactionStateColumns(observation.normalizedState);
  return (
    row.id ===
      derivedInboxV2Id("provider_reaction_observation", transitionId) &&
    row.transition_id === transitionId &&
    row.normalized_inbound_event_id === proof.normalizedInboundEvent.id &&
    row.source_occurrence_id === occurrence.id &&
    row.semantic_id === proof.semanticId &&
    row.semantic_proof_digest_sha256 ===
      computeInboxV2TimelineMessageCommitDigest(proof) &&
    sameValue(row.semantic_proof_detail, proof) &&
    requireString(row.ordering_position, "Reaction ordering position") ===
      proof.ordering.position &&
    row.ordering_proof_digest_sha256 ===
      computeInboxV2TimelineMessageCommitDigest(observation.orderingCommit) &&
    sameValue(row.ordering_commit_detail, observation.orderingCommit) &&
    row.normalized_state_kind === observation.normalizedState.kind &&
    row.normalized_value_kind === normalized.valueKind &&
    nullableString(row.normalized_unicode_value) === normalized.unicodeValue &&
    nullableString(row.normalized_provider_reaction_kind_id) ===
      normalized.providerReactionKindId &&
    nullableString(row.normalized_provider_canonical_code) ===
      normalized.providerCanonicalCode &&
    nullableString(row.provider_actor_participant_id) ===
      (observation.providerActorParticipant?.id ?? null) &&
    parseTimestamp(row.observed_at, "Provider reaction observedAt") ===
      proof.occurredAt &&
    parseTimestamp(row.recorded_at, "Provider reaction recordedAt") ===
      proof.recordedAt
  );
}

function providerOutcomeColumns(
  outcome:
    | InboxV2MessageProviderLifecycleCreationCommit["operation"]["outcome"]
    | InboxV2MessageProviderLifecycleTransitionCommit["transition"]["outcome"]
): Readonly<{ retryable: number | null; reasonId: string | null }> {
  return outcome.state === "failed"
    ? { retryable: outcome.retryable ? 1 : 0, reasonId: outcome.reasonId }
    : outcome.state === "unsupported"
      ? { retryable: null, reasonId: outcome.reasonId }
      : { retryable: null, reasonId: null };
}

function providerDeletePolicyColumns(
  policy:
    | InboxV2MessageProviderLifecycleCreationCommit["operation"]["deleteLocalPolicy"]
    | InboxV2MessageProviderLifecycleTransitionCommit["transition"]["deleteLocalPolicy"]
): Readonly<{
  effect: string | null;
  decisionEventId: string | null;
  decisionRevision: InboxV2EntityRevision | null;
  decidedAt: string | null;
}> {
  if (policy === null) {
    return {
      effect: null,
      decisionEventId: null,
      decisionRevision: null,
      decidedAt: null
    };
  }
  if (policy.effect === "not_evaluated") {
    return {
      effect: policy.effect,
      decisionEventId: null,
      decisionRevision: null,
      decidedAt: null
    };
  }
  return {
    effect: policy.effect,
    decisionEventId: policy.decisionEvent.id,
    decisionRevision: policy.decisionRevision,
    decidedAt: policy.decidedAt
  };
}

export function mapProviderSemanticOrderingHeadRow(
  row: Record<string, unknown>
): Readonly<{
  head: InboxV2ProviderSemanticOrderingHead;
  lastChangedStreamPosition: InboxV2BigintCounter;
}> {
  const head = inboxV2ProviderSemanticOrderingHeadSchema.parse(row.head_detail);
  const digest = requireString(
    row.head_detail_digest_sha256,
    "Provider semantic ordering head digest"
  );
  if (
    digest !== computeInboxV2TimelineMessageCommitDigest(head) ||
    row.tenant_id !== head.tenantId ||
    row.external_message_reference_id !== head.externalMessageReference.id ||
    row.semantic_family_id !== head.semanticFamilyId ||
    row.source_account_id !== head.sourceAccount.id ||
    row.source_thread_binding_id !== head.sourceThreadBinding.id ||
    parseRevision(
      row.binding_generation,
      "Provider semantic ordering binding generation"
    ) !== head.bindingGeneration ||
    row.scope_token !== head.scopeToken ||
    row.comparator_id !== head.comparatorId ||
    parseRevision(
      row.comparator_revision,
      "Provider semantic ordering comparator revision"
    ) !== head.comparatorRevision ||
    row.position !== head.position ||
    row.normalized_inbound_event_id !== head.normalizedInboundEvent.id ||
    row.proof_token !== head.proofToken ||
    parseRevision(row.revision, "Provider semantic ordering revision") !==
      head.revision ||
    parseTimestamp(row.updated_at, "Provider semantic ordering updatedAt") !==
      head.updatedAt
  ) {
    throw new Error(
      "Provider semantic ordering head flattened/detail coherence mismatch."
    );
  }
  return {
    head,
    lastChangedStreamPosition: inboxV2BigintCounterSchema.parse(
      parseDatabaseBigint(
        row.last_changed_stream_position,
        "Provider semantic ordering last stream position"
      )
    )
  };
}

function providerSemanticOrderingHeadRowMatches(
  row: Record<string, unknown>,
  head: InboxV2ProviderSemanticOrderingHead
): boolean {
  return sameValue(mapProviderSemanticOrderingHeadRow(row).head, head);
}

function providerLifecycleCreationRowMatches(
  row: Record<string, unknown>,
  commit: InboxV2MessageProviderLifecycleCreationCommit
): boolean {
  const operation = commit.operation;
  if (!providerLifecycleOperationIdentityRowMatches(row, operation)) {
    return false;
  }
  const outcome = providerOutcomeColumns(operation.outcome);
  const policy = providerDeletePolicyColumns(operation.deleteLocalPolicy);
  const proof = commit.providerSemanticProof;
  const orderingCommit = commit.semanticOrderingCommit;
  const monotonicOrdering =
    proof?.ordering.kind === "monotonic_exact" ? proof.ordering : null;
  return (
    row.initial_outcome === operation.outcome.state &&
    nullableInteger(row.initial_outcome_retryable) === outcome.retryable &&
    nullableString(row.initial_outcome_reason_id) === outcome.reasonId &&
    nullableString(row.initial_delete_local_effect) === policy.effect &&
    nullableString(row.initial_policy_decision_event_id) ===
      policy.decisionEventId &&
    nullableRevision(
      row.initial_policy_decision_revision,
      "Provider lifecycle initial policy revision"
    ) === policy.decisionRevision &&
    nullableTimestamp(
      row.initial_policy_decided_at,
      "Provider lifecycle initial policy decidedAt"
    ) === policy.decidedAt &&
    nullableString(row.provider_semantic_normalized_inbound_event_id) ===
      (proof?.normalizedInboundEvent.id ?? null) &&
    nullableString(row.provider_semantic_actor_external_identity_id) ===
      (proof?.actor?.id ?? null) &&
    nullableString(row.provider_semantic_capability_id) ===
      (proof?.capabilityId ?? null) &&
    nullableRevision(
      row.provider_semantic_capability_revision,
      "Provider lifecycle semantic capability revision"
    ) === (proof?.capabilityRevision ?? null) &&
    nullableString(row.provider_semantic_id) === (proof?.semanticId ?? null) &&
    nullableRevision(
      row.provider_semantic_revision,
      "Provider lifecycle semantic revision"
    ) === (proof?.semanticRevision ?? null) &&
    nullableString(row.provider_semantic_proof_token) ===
      (proof?.proofToken ?? null) &&
    nullableString(row.provider_semantic_ordering_scope_token) ===
      (monotonicOrdering?.scopeToken ?? null) &&
    nullableString(row.provider_semantic_ordering_position) ===
      (monotonicOrdering?.position ?? null) &&
    nullableString(row.provider_semantic_ordering_comparator_id) ===
      (monotonicOrdering?.comparatorId ?? null) &&
    nullableRevision(
      row.provider_semantic_ordering_comparator_revision,
      "Provider lifecycle semantic comparator revision"
    ) === (monotonicOrdering?.comparatorRevision ?? null) &&
    nullableString(row.provider_semantic_declared_by_trusted_service_id) ===
      (proof?.declaredByTrustedServiceId ?? null) &&
    nullableRevision(
      row.provider_semantic_proof_revision,
      "Provider lifecycle semantic proof revision"
    ) === (proof?.revision ?? null) &&
    sameValue(row.provider_semantic_proof_detail ?? null, proof) &&
    nullableString(row.provider_semantic_proof_digest_sha256) ===
      (proof === null
        ? null
        : computeInboxV2TimelineMessageCommitDigest(proof)) &&
    sameValue(row.semantic_ordering_commit_detail ?? null, orderingCommit) &&
    nullableString(row.semantic_ordering_commit_digest_sha256) ===
      (orderingCommit === null
        ? null
        : computeInboxV2TimelineMessageCommitDigest(orderingCommit)) &&
    nullableTimestamp(
      row.semantic_ordering_committed_at,
      "Provider lifecycle semantic ordering committedAt"
    ) === (orderingCommit?.committedAt ?? null)
  );
}

function providerLifecycleOperationRowMatches(
  row: Record<string, unknown>,
  operation:
    | InboxV2MessageProviderLifecycleCreationCommit["operation"]
    | InboxV2MessageProviderLifecycleTransitionCommit["before"]
): boolean {
  return (
    providerLifecycleOperationIdentityRowMatches(row, operation) &&
    providerLifecycleOperationMutableRowMatches(row, operation)
  );
}

function providerLifecycleOperationIdentityRowMatches(
  row: Record<string, unknown>,
  operation:
    | InboxV2MessageProviderLifecycleCreationCommit["operation"]
    | InboxV2MessageProviderLifecycleTransitionCommit["before"]
): boolean {
  const adapter = operation.adapterContract;
  const expectedAttribution = {
    actionParticipant: operation.actionParticipant,
    appActor: operation.appActor,
    sourceOccurrence: null,
    automationCausation: operation.automationCausation
  };
  return (
    row.id === operation.id &&
    row.message_id === operation.message.id &&
    row.action === operation.action &&
    row.origin === operation.origin &&
    row.external_message_reference_id ===
      operation.externalMessageReference.id &&
    row.source_occurrence_id === operation.sourceOccurrence.id &&
    row.source_account_id === operation.sourceAccount.id &&
    row.source_thread_binding_id === operation.sourceThreadBinding.id &&
    parseRevision(
      row.binding_generation,
      "Provider lifecycle binding generation"
    ) === operation.bindingGeneration &&
    nullableString(row.outbound_route_id) ===
      (operation.outboundRoute?.id ?? null) &&
    row.adapter_contract_id === adapter.contractId &&
    row.adapter_contract_version === adapter.contractVersion &&
    parseRevision(
      row.adapter_declaration_revision,
      "Provider lifecycle adapter declaration revision"
    ) === adapter.declarationRevision &&
    row.adapter_surface_id === adapter.surfaceId &&
    row.adapter_loaded_by_trusted_service_id ===
      adapter.loadedByTrustedServiceId &&
    parseTimestamp(
      row.adapter_loaded_at,
      "Provider lifecycle adapter loadedAt"
    ) === adapter.loadedAt &&
    parseRevision(
      row.capability_revision,
      "Provider lifecycle capability revision"
    ) === operation.capabilityRevision &&
    parseTimestamp(row.occurred_at, "Provider lifecycle occurredAt") ===
      operation.occurredAt &&
    parseTimestamp(row.recorded_at, "Provider lifecycle recordedAt") ===
      operation.recordedAt &&
    parseTimestamp(row.created_at, "Provider lifecycle createdAt") ===
      operation.createdAt &&
    (operation.origin === "provider_observed"
      ? row.action_attribution_id === null
      : row.action_attribution_id ===
          derivedInboxV2Id("action_attribution", operation.id) &&
        actionAttributionRowMatches(row, expectedAttribution))
  );
}

function providerLifecycleOperationMutableRowMatches(
  row: Record<string, unknown>,
  operation:
    | InboxV2MessageProviderLifecycleCreationCommit["operation"]
    | InboxV2MessageProviderLifecycleTransitionCommit["before"]
): boolean {
  const outcome = providerOutcomeColumns(operation.outcome);
  const policy = providerDeletePolicyColumns(operation.deleteLocalPolicy);
  return (
    row.outcome === operation.outcome.state &&
    nullableInteger(row.outcome_retryable) === outcome.retryable &&
    nullableString(row.outcome_reason_id) === outcome.reasonId &&
    nullableString(row.delete_local_effect) === policy.effect &&
    nullableString(row.policy_decision_event_id) === policy.decisionEventId &&
    nullableRevision(
      row.policy_decision_revision,
      "Provider lifecycle policy decision revision"
    ) === policy.decisionRevision &&
    nullableTimestamp(
      row.policy_decided_at,
      "Provider lifecycle policy decidedAt"
    ) === policy.decidedAt &&
    parseRevision(row.revision, "Provider lifecycle operation revision") ===
      operation.revision &&
    parseTimestamp(row.updated_at, "Provider lifecycle updatedAt") ===
      operation.updatedAt
  );
}

function providerLifecycleTransitionRowMatches(
  row: Record<string, unknown>,
  commit: InboxV2MessageProviderLifecycleTransitionCommit
): boolean {
  const transition = commit.transition;
  const outcome = providerOutcomeColumns(transition.outcome);
  const policy = providerDeletePolicyColumns(transition.deleteLocalPolicy);
  const proof = transition.resultProof;
  return (
    row.id ===
      derivedInboxV2Id(
        "message_provider_lifecycle_transition",
        `${transition.operation.id}:${transition.resultingRevision}`
      ) &&
    row.operation_id === transition.operation.id &&
    parseRevision(
      row.expected_revision,
      "Provider lifecycle expected revision"
    ) === transition.expectedRevision &&
    parseRevision(
      row.resulting_revision,
      "Provider lifecycle resulting revision"
    ) === transition.resultingRevision &&
    row.outcome === transition.outcome.state &&
    nullableInteger(row.outcome_retryable) === outcome.retryable &&
    nullableString(row.outcome_reason_id) === outcome.reasonId &&
    nullableString(row.delete_local_effect) === policy.effect &&
    nullableString(row.policy_decision_event_id) === policy.decisionEventId &&
    nullableRevision(
      row.policy_decision_revision,
      "Provider lifecycle transition policy revision"
    ) === policy.decisionRevision &&
    nullableTimestamp(
      row.policy_decided_at,
      "Provider lifecycle transition policy decidedAt"
    ) === policy.decidedAt &&
    nullableString(row.result_token) === (proof?.resultToken ?? null) &&
    nullableString(row.result_digest_sha256) ===
      (proof?.resultDigestSha256 ?? null) &&
    nullableString(row.result_proof_outbound_route_id) ===
      (proof?.outboundRoute.id ?? null) &&
    nullableString(row.result_proof_capability_id) ===
      (proof?.capabilityId ?? null) &&
    nullableRevision(
      row.result_proof_capability_revision,
      "Provider lifecycle proof capability revision"
    ) === (proof?.capabilityRevision ?? null) &&
    nullableString(row.result_proof_semantic_id) ===
      (proof?.semanticId ?? null) &&
    nullableRevision(
      row.result_proof_semantic_revision,
      "Provider lifecycle proof semantic revision"
    ) === (proof?.semanticRevision ?? null) &&
    nullableString(row.result_proof_state) === (proof?.resultState ?? null) &&
    nullableString(row.result_proof_declared_by_trusted_service_id) ===
      (proof?.declaredByTrustedServiceId ?? null) &&
    nullableTimestamp(
      row.result_proof_recorded_at,
      "Provider lifecycle proof recordedAt"
    ) === (proof?.recordedAt ?? null) &&
    sameValue(
      row.result_proof_adapter_contract_detail ?? null,
      proof?.adapterContract ?? null
    ) &&
    nullableString(row.result_proof_adapter_contract_detail_digest_sha256) ===
      (proof === null
        ? null
        : computeInboxV2TimelineMessageCommitDigest(proof.adapterContract)) &&
    parseTimestamp(
      row.recorded_at,
      "Provider lifecycle transition recordedAt"
    ) === transition.recordedAt
  );
}

export function actionAttributionRowMatches(
  row: Record<string, unknown>,
  attribution: InboxV2MessageRevision["actionAttribution"]
): boolean {
  const columns = actionAttributionColumns(attribution);
  return (
    nullableString(row.action_participant_id) ===
      (attribution.actionParticipant?.id ?? null) &&
    nullableString(row.app_actor_kind) === columns.appActorKind &&
    nullableString(row.app_actor_employee_id) === columns.appActorEmployeeId &&
    nullableString(row.app_authorization_epoch) ===
      columns.appAuthorizationEpoch &&
    nullableString(row.app_trusted_service_id) ===
      columns.appTrustedServiceId &&
    nullableString(row.attribution_source_occurrence_id) ===
      (attribution.sourceOccurrence?.id ?? null) &&
    nullableString(row.automation_kind) === columns.automationKind &&
    nullableString(row.automation_cause_event_id) ===
      columns.automationCauseEventId &&
    nullableString(row.automation_correlation_id) ===
      columns.automationCorrelationId &&
    nullableTimestamp(row.automation_caused_at, "Automation causedAt") ===
      columns.automationCausedAt &&
    nullableString(row.automation_initiating_employee_id) ===
      columns.automationInitiatingEmployeeId &&
    nullableString(row.automation_initiating_authorization_epoch) ===
      columns.automationInitiatingAuthorizationEpoch
  );
}

function transportLinkRowMatches(
  row: Record<string, unknown>,
  link: InboxV2MessageTransportAssociationCommit["link"],
  resultingHeadRevision: InboxV2EntityRevision
): boolean {
  return (
    row.id === link.id &&
    row.message_id === link.message.id &&
    row.source_occurrence_id === link.sourceOccurrence.id &&
    row.external_message_reference_id === link.externalMessageReference.id &&
    row.role === link.role &&
    parseRevision(
      row.resulting_head_revision,
      "Transport link resulting head revision"
    ) === resultingHeadRevision &&
    parseRevision(row.revision, "Transport link revision") === link.revision &&
    parseTimestamp(row.linked_at, "Transport link linkedAt") === link.linkedAt
  );
}

function transportLinkHeadRowMatches(
  row: Record<string, unknown>,
  head: NonNullable<InboxV2MessageTransportAssociationCommit["linkHeadBefore"]>
): boolean {
  return (
    row.message_id === head.message.id &&
    parseDatabaseBigint(row.link_count, "Transport link count") ===
      head.linkCount &&
    row.latest_link_id === head.latestLink.id &&
    parseRevision(row.revision, "Transport link-head revision") ===
      head.revision &&
    parseTimestamp(row.updated_at, "Transport link-head updatedAt") ===
      head.updatedAt
  );
}

function mapMessageTimelineRow(
  row: MessageHeadRow,
  tenantId: InboxV2TenantId
): InboxV2TimelineItem {
  if (row.timeline_subject_kind !== "message") {
    throw invariantError("Message points to a non-message TimelineItem.");
  }
  return inboxV2TimelineItemSchema.parse({
    tenantId,
    id: row.timeline_item_id,
    conversation: {
      tenantId,
      kind: "conversation",
      id: row.conversation_id
    },
    timelineSequence: parseTimelineSequence(
      row.timeline_sequence,
      "Message Timeline sequence"
    ),
    subject: {
      kind: "message",
      message: { tenantId, kind: "message", id: row.timeline_subject_id },
      messageRevision: parseRevision(
        row.timeline_revision,
        "Timeline Message revision"
      )
    },
    visibility: row.timeline_visibility,
    activity: mapTimelineActivityRow(row, tenantId),
    occurredAt: parseTimestamp(row.timeline_occurred_at, "Timeline occurredAt"),
    receivedAt: parseTimestamp(row.timeline_received_at, "Timeline receivedAt"),
    revision: parseRevision(row.timeline_revision, "Timeline revision"),
    createdAt: parseTimestamp(row.timeline_created_at, "Timeline createdAt"),
    updatedAt: parseTimestamp(row.timeline_updated_at, "Timeline updatedAt")
  });
}

function mapTimelineActivityRow(
  row: MessageHeadRow,
  tenantId: InboxV2TenantId
): InboxV2TimelineItem["activity"] {
  switch (row.timeline_activity_kind) {
    case "eligible":
      return inboxV2TimelineActivitySchema.parse({ kind: "eligible" });
    case "history_import":
      return inboxV2TimelineActivitySchema.parse({
        kind: "history_import",
        sourceOccurrence: {
          tenantId,
          kind: "source_occurrence",
          id: row.timeline_activity_source_occurrence_id as string
        },
        importedAt: parseTimestamp(
          row.timeline_activity_imported_at,
          "Timeline history importedAt"
        )
      });
    case "migration":
      return inboxV2TimelineActivitySchema.parse({
        kind: "migration",
        provenanceId: row.timeline_migration_provenance_id as never,
        importedAt: parseTimestamp(
          row.timeline_activity_imported_at,
          "Timeline migration importedAt"
        )
      });
    case "non_activity":
      return inboxV2TimelineActivitySchema.parse({
        kind: "non_activity",
        reasonId: row.timeline_activity_reason_id as never
      });
    default:
      throw invariantError("Timeline activity kind is unknown.");
  }
}

function mapMessageOriginRow(
  row: MessageHeadRow,
  tenantId: InboxV2TenantId
): InboxV2Message["origin"] {
  switch (row.origin_kind) {
    case "source_originated":
      return inboxV2MessageOriginSchema.parse({
        kind: "source_originated",
        originOccurrence: {
          tenantId,
          kind: "source_occurrence",
          id: row.origin_source_occurrence_id as string
        },
        direction: row.origin_source_direction as "inbound" | "outbound",
        claimAtOccurrence:
          row.claim_at_occurrence_id === null
            ? null
            : {
                claim: {
                  tenantId,
                  kind: "source_identity_claim",
                  id: row.claim_at_occurrence_id as string
                },
                claimVersion: parseRevision(
                  row.claim_at_occurrence_version,
                  "Message claim-at-occurrence version"
                ),
                resolvedEmployee: {
                  tenantId,
                  kind: "employee",
                  id: row.claim_resolved_employee_id as string
                }
              }
      });
    case "hulee_external":
      return inboxV2MessageOriginSchema.parse({
        kind: "hulee_external",
        outboundRoute: {
          tenantId,
          kind: "outbound_route",
          id: row.origin_outbound_route_id as string
        }
      });
    case "internal":
      return inboxV2MessageOriginSchema.parse({ kind: "internal" });
    case "migration":
      return inboxV2MessageOriginSchema.parse({
        kind: "migration",
        provenanceId: row.migration_provenance_id as never
      });
    default:
      throw invariantError("Message origin kind is unknown.");
  }
}

function mapAppActorRow(
  row: Pick<
    MessageHeadRow,
    | "app_actor_kind"
    | "app_actor_employee_id"
    | "app_authorization_epoch"
    | "app_trusted_service_id"
  >,
  tenantId: InboxV2TenantId
): InboxV2Message["appActor"] {
  if (row.app_actor_kind === null) return null;
  if (row.app_actor_kind === "employee") {
    return inboxV2AppActorSchema.parse({
      kind: "employee",
      employee: {
        tenantId,
        kind: "employee",
        id: row.app_actor_employee_id as string
      },
      authorizationEpoch: row.app_authorization_epoch as never
    });
  }
  if (row.app_actor_kind === "trusted_service") {
    return inboxV2AppActorSchema.parse({
      kind: "trusted_service",
      trustedServiceId: row.app_trusted_service_id as never
    });
  }
  throw invariantError("Message app actor kind is unknown.");
}

function mapAutomationRow(
  row: Pick<
    MessageHeadRow,
    | "automation_kind"
    | "automation_cause_event_id"
    | "automation_correlation_id"
    | "automation_caused_at"
    | "automation_initiating_employee_id"
    | "automation_initiating_authorization_epoch"
  >,
  tenantId: InboxV2TenantId
): InboxV2Message["automationCausation"] {
  if (row.automation_kind === null) return null;
  const common = {
    causeEvent: {
      tenantId,
      kind: "event" as const,
      id: row.automation_cause_event_id as string
    },
    correlationId: row.automation_correlation_id as never,
    causedAt: parseTimestamp(row.automation_caused_at, "Automation causedAt")
  };
  if (row.automation_kind === "system_event") {
    return inboxV2AutomationCausationSchema.parse({
      kind: "system_event",
      ...common
    });
  }
  if (row.automation_kind === "employee_command") {
    return inboxV2AutomationCausationSchema.parse({
      kind: "employee_command",
      initiatingActor: {
        kind: "employee",
        employee: {
          tenantId,
          kind: "employee",
          id: row.automation_initiating_employee_id as string
        },
        authorizationEpoch:
          row.automation_initiating_authorization_epoch as never
      },
      ...common
    });
  }
  throw invariantError("Message automation kind is unknown.");
}

function mapMessageLifecycleRow(
  row: MessageHeadRow,
  tenantId: InboxV2TenantId
): InboxV2Message["lifecycle"] {
  if (row.lifecycle === "active") {
    return inboxV2MessageLifecycleSchema.parse({ kind: "active" });
  }
  const revision = {
    tenantId,
    kind: "message_revision" as const,
    id: row.lifecycle_revision_id as string
  };
  if (row.lifecycle === "local_delete_tombstone") {
    return inboxV2MessageLifecycleSchema.parse({
      kind: "local_delete_tombstone",
      revision,
      reasonId: row.lifecycle_reason_id as never,
      deletedAt: parseTimestamp(row.lifecycle_changed_at, "Message deletedAt")
    });
  }
  if (row.lifecycle === "provider_delete_tombstone") {
    return inboxV2MessageLifecycleSchema.parse({
      kind: "provider_delete_tombstone",
      revision,
      providerOperation: {
        tenantId,
        kind: "message_provider_lifecycle_operation",
        id: row.lifecycle_provider_operation_id as string
      },
      policyReasonId: row.lifecycle_policy_reason_id as never,
      appliedAt: parseTimestamp(
        row.lifecycle_changed_at,
        "Message provider-delete appliedAt"
      )
    });
  }
  throw invariantError("Message lifecycle is unknown.");
}

function mapContentBlockRow(
  row: ContentPayloadRow,
  contacts: readonly ContactValueRow[],
  tenantId: InboxV2TenantId
): InboxV2MessageContentBlock {
  const blockKey = row.block_key;
  switch (row.kind) {
    case "text":
      return {
        blockKey: blockKey as never,
        kind: "text",
        role: row.text_role as "body" | "caption",
        text: requireString(row.text_value, "Content text"),
        language: nullableString(row.language)
      };
    case "image":
    case "file":
    case "sticker":
      return inboxV2MessageContentBlockSchema.parse({
        blockKey: blockKey as never,
        kind: row.kind,
        attachment: mapAttachmentRow(row, tenantId),
        displayName: nullableString(row.display_name)
      });
    case "audio":
    case "video":
      return inboxV2MessageContentBlockSchema.parse({
        blockKey: blockKey as never,
        kind: row.kind,
        semantic: row.media_semantic,
        attachment: mapAttachmentRow(row, tenantId)
      });
    case "location":
      return inboxV2MessageContentBlockSchema.parse({
        blockKey: blockKey as never,
        kind: "location",
        latitude: parseFiniteNumber(row.latitude, "Location latitude"),
        longitude: parseFiniteNumber(row.longitude, "Location longitude"),
        accuracyMeters: nullableFiniteNumber(
          row.accuracy_meters,
          "Location accuracy"
        ),
        mode: row.location_mode as "static" | "live",
        liveUntil: nullableTimestamp(row.live_until, "Location liveUntil"),
        headingDegrees: nullableFiniteNumber(
          row.heading_degrees,
          "Location heading"
        ),
        label: nullableString(row.location_label),
        address: nullableString(row.location_address)
      });
    case "contact": {
      const ordinal = parseNonNegativeInteger(
        row.ordinal,
        "Contact block ordinal"
      );
      return inboxV2MessageContentBlockSchema.parse({
        blockKey: blockKey as never,
        kind: "contact",
        displayName: requireString(
          row.contact_display_name,
          "Contact display name"
        ),
        organization: nullableString(row.contact_organization),
        values: contacts
          .filter(
            (contact) =>
              parseNonNegativeInteger(
                contact.block_ordinal,
                "Contact block ordinal"
              ) === ordinal
          )
          .map((contact) => ({
            kind: contact.kind as "phone" | "email" | "url" | "other",
            value: requireString(contact.value, "Contact value"),
            label: nullableString(contact.label)
          }))
      });
    }
    case "unsupported_source_content":
      return inboxV2MessageContentBlockSchema.parse({
        blockKey: blockKey as never,
        kind: "unsupported_source_content",
        sourceOccurrence: {
          tenantId,
          kind: "source_occurrence",
          id: row.unsupported_source_occurrence_id as string
        },
        providerContentKindId: row.provider_content_kind_id as never,
        safeFallbackReasonId: row.safe_fallback_reason_id as never
      });
    case "extension":
      return inboxV2MessageContentBlockSchema.parse({
        blockKey: blockKey as never,
        kind: "extension",
        blockKindId: row.extension_block_kind_id as never,
        payloadSchemaId: row.extension_payload_schema_id as never,
        payloadSchemaVersion: row.extension_payload_schema_version as never,
        payloadFile: {
          tenantId,
          kind: "file",
          id:
            row.extension_payload_v2_file_id === null
              ? (row.extension_payload_file_id as string)
              : (row.extension_payload_v2_file_id as string)
        },
        payloadPin:
          row.extension_payload_v2_file_id === null
            ? { state: "legacy_unpinned" }
            : {
                state: "exact",
                fileRevision: parseRevision(
                  row.extension_payload_file_revision,
                  "Extension payload file revision"
                ),
                fileVersion: {
                  tenantId,
                  kind: "file_version",
                  id: row.extension_payload_file_version_id as string
                },
                objectVersion: {
                  tenantId,
                  kind: "file_object_version",
                  id: row.extension_payload_object_version_id as string
                }
              },
        payloadDigestSha256: row.extension_payload_digest_sha256 as never,
        rendererId: row.extension_renderer_id as never
      });
    default:
      throw invariantError("TimelineContent payload kind is unknown.");
  }
}

/**
 * Public row mapper used by repository contract tests and migration probes.
 * It intentionally accepts a raw SQL row so tests exercise the same strict
 * V2-versus-legacy reconstruction path as production reads.
 */
export function mapInboxV2TimelineContentBlockRow(
  row: Record<string, unknown>,
  contacts: readonly Record<string, unknown>[],
  tenantId: InboxV2TenantId
): InboxV2MessageContentBlock {
  return mapContentBlockRow(
    row as ContentPayloadRow,
    contacts as readonly ContactValueRow[],
    tenantId
  );
}

function mapAttachmentRow(
  row: ContentPayloadRow,
  tenantId: InboxV2TenantId
): unknown {
  const attachment = {
    tenantId,
    kind: "message_attachment" as const,
    id: row.attachment_id as string
  };
  if (row.attachment_state === "pending")
    return { state: "pending", attachment };
  if (row.attachment_state === "ready") {
    if (row.attachment_v2_file_id === null) {
      return {
        state: "legacy_unpinned",
        attachment,
        file: {
          tenantId,
          kind: "file",
          id: row.attachment_file_id as string
        }
      };
    }
    return {
      state: "ready",
      attachment,
      file: {
        tenantId,
        kind: "file",
        id: row.attachment_v2_file_id as string
      },
      fileRevision: parseRevision(
        row.attachment_file_revision,
        "Attachment file revision"
      ),
      fileVersion: {
        tenantId,
        kind: "file_version",
        id: row.attachment_file_version_id as string
      },
      objectVersion: {
        tenantId,
        kind: "file_object_version",
        id: row.attachment_object_version_id as string
      }
    };
  }
  if (
    row.attachment_state === "failed" ||
    row.attachment_state === "quarantined"
  ) {
    return {
      state: row.attachment_state,
      attachment,
      reasonId: row.attachment_failure_reason_id as never
    };
  }
  throw invariantError("Attachment materialization state is unknown.");
}

function mapExternalMessageKeyFromOccurrenceRow(
  row: Record<string, unknown>,
  tenantId: InboxV2TenantId
): ReturnType<typeof inboxV2ExternalMessageKeySchema.parse> {
  const scopeKind = requireString(
    row.message_scope_kind,
    "External message scope kind"
  );
  const scope =
    scopeKind === "provider_thread"
      ? { kind: "provider_thread" }
      : scopeKind === "source_account"
        ? {
            kind: "source_account",
            owner: {
              tenantId,
              kind: "source_account",
              id: row.message_scope_source_account_id
            }
          }
        : {
            kind: "source_thread_binding",
            owner: {
              tenantId,
              kind: "source_thread_binding",
              id: row.message_scope_source_thread_binding_id
            }
          };
  return inboxV2ExternalMessageKeySchema.parse({
    realm: {
      realmId: row.message_realm_id,
      realmVersion: row.message_realm_version,
      canonicalizationVersion: row.message_canonicalization_version
    },
    scope,
    objectKindId: row.message_object_kind_id,
    externalThread: {
      tenantId,
      kind: "external_thread",
      id: row.external_thread_id
    },
    canonicalExternalSubject: row.canonical_external_subject
  });
}

function mapTimelineRow(
  row: Record<string, unknown>,
  tenantId: InboxV2TenantId
): InboxV2TimelineItem {
  const source = () => ({
    sourceObject: {
      tenantId,
      kind: "source_object",
      id: row.source_object_id
    },
    objectKindId: row.source_object_kind_id,
    objectRevision: parseRevision(
      row.source_object_revision,
      "Timeline source object revision"
    ),
    normalizedSourceEvent:
      row.normalized_source_event_id === null
        ? null
        : {
            tenantId,
            kind: "normalized_inbound_event",
            id: row.normalized_source_event_id
          }
  });
  const actorParticipant =
    row.actor_participant_id === null
      ? null
      : {
          tenantId,
          kind: "conversation_participant",
          id: row.actor_participant_id
        };
  let subject: Record<string, unknown>;
  switch (row.subject_kind) {
    case "message":
      subject = {
        kind: "message",
        message: { tenantId, kind: "message", id: row.subject_id },
        messageRevision: parseRevision(
          row.revision,
          "Timeline Message revision"
        )
      };
      break;
    case "staff_note":
      subject = {
        kind: "staff_note",
        staffNote: { tenantId, kind: "staff_note", id: row.subject_id },
        staffNoteRevision: parseRevision(
          row.revision,
          "Timeline StaffNote revision"
        )
      };
      break;
    case "call":
      subject = { kind: "call", source: source(), actorParticipant };
      break;
    case "review":
      subject = {
        kind: "review",
        source: source(),
        authorParticipant: actorParticipant
      };
      break;
    case "module_event":
      subject = {
        kind: "module_event",
        itemKindId: row.module_item_kind_id,
        source: source(),
        actorParticipant
      };
      break;
    case "participant_change":
      subject = {
        kind: "participant_change",
        transition: {
          tenantId,
          kind: "participant_membership_transition",
          id: row.participant_transition_id
        }
      };
      break;
    case "work_change":
      subject = {
        kind: "work_change",
        transition:
          row.work_transition_kind === "work_item"
            ? {
                tenantId,
                kind: "work_item_transition",
                id: row.work_item_transition_id
              }
            : {
                tenantId,
                kind: "work_item_relation_transition",
                id: row.work_item_relation_transition_id
              }
      };
      break;
    case "system_event":
      subject = {
        kind: "system_event",
        event: { tenantId, kind: "event", id: row.system_event_id },
        systemActorId: row.system_actor_id,
        appActor:
          row.system_app_actor_kind === null
            ? null
            : row.system_app_actor_kind === "employee"
              ? {
                  kind: "employee",
                  employee: {
                    tenantId,
                    kind: "employee",
                    id: row.system_app_actor_employee_id
                  },
                  authorizationEpoch: row.system_app_authorization_epoch
                }
              : {
                  kind: "trusted_service",
                  trustedServiceId: row.system_app_trusted_service_id
                }
      };
      break;
    default:
      throw invariantError("Timeline subject kind is unknown.");
  }
  const activity =
    row.activity_kind === "eligible"
      ? { kind: "eligible" }
      : row.activity_kind === "history_import"
        ? {
            kind: "history_import",
            sourceOccurrence: {
              tenantId,
              kind: "source_occurrence",
              id: row.activity_source_occurrence_id
            },
            importedAt: parseTimestamp(
              row.activity_imported_at,
              "Timeline history importedAt"
            )
          }
        : row.activity_kind === "migration"
          ? {
              kind: "migration",
              provenanceId: row.migration_provenance_id,
              importedAt: parseTimestamp(
                row.activity_imported_at,
                "Timeline migration importedAt"
              )
            }
          : { kind: "non_activity", reasonId: row.activity_reason_id };
  return inboxV2TimelineItemSchema.parse({
    tenantId,
    id: row.id,
    conversation: { tenantId, kind: "conversation", id: row.conversation_id },
    timelineSequence: parseTimelineSequence(
      row.timeline_sequence,
      "Timeline sequence"
    ),
    subject,
    visibility: row.visibility,
    activity,
    occurredAt: parseTimestamp(row.occurred_at, "Timeline occurredAt"),
    receivedAt: parseTimestamp(row.received_at, "Timeline receivedAt"),
    revision: parseRevision(row.revision, "Timeline revision"),
    createdAt: parseTimestamp(row.created_at, "Timeline createdAt"),
    updatedAt: parseTimestamp(row.updated_at, "Timeline updatedAt")
  });
}

function mapMessageRevisionRow(
  row: Record<string, unknown>,
  tenantId: InboxV2TenantId
): InboxV2MessageRevision {
  const contentHead = (
    prefix: "before" | "after"
  ): Record<string, unknown> | null => {
    const id = row[`${prefix}_content_id`];
    return id === null
      ? null
      : {
          content: { tenantId, kind: "timeline_content", id },
          contentRevision: parseRevision(
            row[`${prefix}_content_revision`],
            `Message history ${prefix} content revision`
          ),
          stateKind: row[`${prefix}_content_state`]
        };
  };
  const before = contentHead("before");
  const after = contentHead("after");
  let change: Record<string, unknown>;
  switch (row.change_kind) {
    case "created":
      change = { kind: "created", content: after };
      break;
    case "edited":
      change = {
        kind: "edited",
        beforeContent: before,
        afterContent: after,
        providerOperation:
          row.provider_operation_id === null
            ? null
            : {
                tenantId,
                kind: "message_provider_lifecycle_operation",
                id: row.provider_operation_id
              }
      };
      break;
    case "attachment_materialized":
      change = {
        kind: "attachment_materialized",
        beforeContent: before,
        afterContent: after
      };
      break;
    case "local_delete_tombstone":
      change = { kind: "local_delete_tombstone", reasonId: row.reason_id };
      break;
    case "provider_delete_policy_tombstone":
      change = {
        kind: "provider_delete_policy_tombstone",
        providerOperation: {
          tenantId,
          kind: "message_provider_lifecycle_operation",
          id: row.provider_operation_id
        },
        policyReasonId: row.reason_id
      };
      break;
    case "privacy_erasure_tombstone":
    case "retention_purge_tombstone":
      change = {
        kind: row.change_kind,
        beforeContent: before,
        afterContent: after
      };
      break;
    default:
      throw invariantError("Message revision change kind is unknown.");
  }
  const actionAttribution = {
    actionParticipant:
      row.action_participant_id === null
        ? null
        : {
            tenantId,
            kind: "conversation_participant",
            id: row.action_participant_id
          },
    appActor: mapAppActorRow(
      {
        app_actor_kind: row.app_actor_kind,
        app_actor_employee_id: row.app_actor_employee_id,
        app_authorization_epoch: row.app_authorization_epoch,
        app_trusted_service_id: row.app_trusted_service_id
      },
      tenantId
    ),
    sourceOccurrence:
      row.source_occurrence_id === null
        ? null
        : {
            tenantId,
            kind: "source_occurrence",
            id: row.source_occurrence_id
          },
    automationCausation: mapAutomationRow(
      {
        automation_kind: row.automation_kind,
        automation_cause_event_id: row.automation_cause_event_id,
        automation_correlation_id: row.automation_correlation_id,
        automation_caused_at: row.automation_caused_at,
        automation_initiating_employee_id:
          row.automation_initiating_employee_id,
        automation_initiating_authorization_epoch:
          row.automation_initiating_authorization_epoch
      },
      tenantId
    )
  };
  const recordedAt = parseTimestamp(
    row.recorded_at,
    "Message revision recordedAt"
  );
  return inboxV2MessageRevisionSchema.parse({
    tenantId,
    id: row.id,
    message: { tenantId, kind: "message", id: row.message_id },
    timelineItem: {
      tenantId,
      kind: "timeline_item",
      id: row.timeline_item_id
    },
    expectedPreviousRevision:
      row.expected_previous_revision === null
        ? null
        : parseRevision(
            row.expected_previous_revision,
            "Message history expected revision"
          ),
    messageRevision: parseRevision(
      row.message_revision,
      "Message history resulting revision"
    ),
    change,
    actionAttribution,
    occurredAt: parseTimestamp(row.occurred_at, "Message revision occurredAt"),
    recordedAt,
    recordRevision: parseDatabaseBigint(
      row.record_revision,
      "Message history record revision"
    ),
    createdAt: recordedAt
  });
}

async function inspectMessageRevisionReplay(
  executor: RawSqlExecutor,
  expected: InboxV2MessageRevision
): Promise<
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "conflict" }>
  | Readonly<{
      kind: "exact";
      revision: InboxV2MessageRevision;
      streamPosition: InboxV2BigintCounter;
    }>
> {
  const result = await executor.execute<MessageRevisionReplayRow>(
    buildFindInboxV2MessageRevisionIdentitySql({
      tenantId: expected.tenantId,
      revisionId: expected.id,
      messageId: expected.message.id,
      messageRevision: expected.messageRevision
    })
  );
  if (result.rows.length > 1) return { kind: "conflict" };
  const row = result.rows[0];
  if (row === undefined) return { kind: "absent" };
  const revision = mapMessageRevisionRow(row, expected.tenantId);
  if (!sameValue(revision, expected)) return { kind: "conflict" };
  return {
    kind: "exact",
    revision,
    streamPosition: inboxV2BigintCounterSchema.parse(
      parseDatabaseBigint(
        row.recorded_stream_position,
        "Message revision replay stream position"
      )
    )
  };
}

function messageEnvelope(input: {
  message: InboxV2Message;
  timelineItem: InboxV2TimelineItem;
  streamPosition: InboxV2BigintCounter;
  changeKind: string;
  occurredAt: string;
}): InboxV2SafeGenericEnvelope {
  return buildInboxV2SafeGenericEnvelope({
    tenantId: input.message.tenantId,
    entityKind: "message",
    entityId: input.message.id,
    entityRevision: input.message.revision,
    timelineItemId: input.timelineItem.id,
    timelineSequence: input.timelineItem.timelineSequence,
    streamPosition: input.streamPosition,
    changeKind: input.changeKind,
    occurredAt: input.occurredAt
  });
}

function conversationHeadMatches(
  row: ConversationHeadRow,
  expected: InboxV2MessageCreationCommit["timelineAllocation"]["conversationBefore"]["head"]
): boolean {
  return (
    parseRevision(row.revision, "Conversation head revision") ===
      expected.revision &&
    parseDatabaseBigint(
      row.latest_timeline_sequence,
      "Conversation latest Timeline sequence"
    ) === expected.latestTimelineSequence &&
    nullableString(row.latest_activity_item_id) ===
      expected.latestActivityItemId &&
    (row.latest_activity_timeline_sequence === null
      ? null
      : parseDatabaseBigint(
          row.latest_activity_timeline_sequence,
          "Conversation latest activity sequence"
        )) === expected.latestActivityTimelineSequence &&
    nullableTimestamp(
      row.latest_activity_at,
      "Conversation latest activityAt"
    ) === expected.latestActivityAt &&
    parseTimestamp(row.updated_at, "Conversation head updatedAt") ===
      expected.updatedAt
  );
}

function normalizeTimelineAnchor(
  anchor: ListInboxV2TimelineInput["anchor"]
): Exclude<ListInboxV2TimelineInput["anchor"], undefined> {
  if (anchor === undefined) return { kind: "latest" };
  if (anchor.kind === "latest") return anchor;
  if (anchor.kind === "around") {
    return {
      kind: "around",
      timelineItemId: inboxV2TimelineItemIdSchema.parse(anchor.timelineItemId)
    };
  }
  return {
    kind: anchor.kind,
    sequence: inboxV2TimelineSequenceSchema.parse(anchor.sequence)
  };
}

function parsePageLimit(
  value: number | undefined,
  maximum: number,
  label: string
): number {
  const parsed = value ?? DEFAULT_TIMELINE_PAGE_SIZE;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RangeError(
      `${label} limit must be an integer from 1 to ${maximum}.`
    );
  }
  return parsed;
}

function normalizeBoundedReadControl(input: {
  snapshotToken?: string | null;
  cursor?: string | null;
}): Readonly<{ snapshotToken: string | null; cursor: string | null }> {
  const snapshotToken =
    input.snapshotToken === null || input.snapshotToken === undefined
      ? null
      : inboxV2RoutingTokenSchema.parse(input.snapshotToken);
  const cursor =
    input.cursor === null || input.cursor === undefined
      ? null
      : typeof input.cursor === "string" &&
          input.cursor.length > 0 &&
          input.cursor.length <= 2_048
        ? input.cursor
        : (() => {
            throw invalidAuxiliaryReadToken("cursor");
          })();
  if (cursor !== null && snapshotToken === null) {
    throw invalidAuxiliaryReadToken("cursor");
  }
  return { snapshotToken, cursor };
}

async function expectOneRow(
  executor: RawSqlExecutor,
  statement: SQL,
  operation: string
): Promise<void> {
  await expectRows(executor, statement, 1, operation);
}

async function expectRows(
  executor: RawSqlExecutor,
  statement: SQL,
  expected: number,
  operation: string
): Promise<void> {
  const result = await executor.execute<IdRow>(statement);
  if (result.rows.length !== expected) {
    throw invariantError(
      `${operation} returned ${result.rows.length} rows; expected ${expected}.`
    );
  }
}

function parseRevision(value: unknown, label: string): InboxV2EntityRevision {
  return inboxV2EntityRevisionSchema.parse(parseDatabaseBigint(value, label));
}

function parseTimelineSequence(
  value: unknown,
  label: string
): InboxV2TimelineSequence {
  return inboxV2TimelineSequenceSchema.parse(parseDatabaseBigint(value, label));
}

function parseDatabaseBigint(value: unknown, label: string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint | number | string);
  } catch {
    throw invariantError(`${label} is not a PostgreSQL bigint.`);
  }
  if (parsed < 0n || parsed > POSTGRES_BIGINT_MAX) {
    throw invariantError(`${label} is outside the supported bigint range.`);
  }
  return parsed.toString();
}

function parseTimestamp(value: unknown, label: string): string {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (parsed === null || Number.isNaN(parsed.getTime())) {
    throw invariantError(`${label} is not a finite timestamp.`);
  }
  return inboxV2TimestampSchema.parse(parsed.toISOString());
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null || value === undefined
    ? null
    : parseTimestamp(value, label);
}

function nullableRevision(value: unknown, label: string): string | null {
  return value === null || value === undefined
    ? null
    : parseRevision(value, label);
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw invariantError("Expected nullable PostgreSQL integer.");
  }
  return parsed;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invariantError(`${label} is not non-empty PostgreSQL text.`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw invariantError("Expected nullable PostgreSQL text.");
  }
  return value;
}

function parseEntityId(value: unknown, label: string): string {
  const parsed = requireString(value, label);
  if (!/^[a-z][a-z0-9_]*:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$/u.test(parsed)) {
    throw invariantError(`${label} is not an Inbox V2 entity id.`);
  }
  return parsed;
}

function parseFiniteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw invariantError(`${label} is not finite numeric data.`);
  }
  return parsed;
}

function nullableFiniteNumber(value: unknown, label: string): number | null {
  return value === null || value === undefined
    ? null
    : parseFiniteNumber(value, label);
}

function parseNonNegativeInteger(value: unknown, label: string): number {
  const parsed = parseFiniteNumber(value, label);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw invariantError(`${label} is not a non-negative integer.`);
  }
  return parsed;
}

function messageReference(
  tenantId: InboxV2TenantId,
  messageId: InboxV2MessageId
): Readonly<{
  tenantId: InboxV2TenantId;
  kind: "message";
  id: InboxV2MessageId;
}> {
  return Object.freeze({ tenantId, kind: "message", id: messageId });
}

function requireJsonRecord(
  value: unknown,
  label: string
): Record<string, unknown> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw invariantError(`${label} is not valid PostgreSQL jsonb.`);
    }
  }
  if (!isPlainRecord(parsed)) {
    throw invariantError(`${label} is not a PostgreSQL jsonb object.`);
  }
  return parsed;
}

function parseDigestedJson<TResult>(
  value: unknown,
  digest: unknown,
  schema: Readonly<{ parse(value: unknown): TResult }>,
  label: string
): TResult {
  const document = requireJsonRecord(value, label);
  const persistedDigest = requireSha256Digest(digest, `${label} digest`);
  if (computeInboxV2TimelineMessageCommitDigest(document) !== persistedDigest) {
    throw invariantError(`${label} digest mismatch.`);
  }
  return schema.parse(document);
}

function requireSha256Digest(value: unknown, label: string): string {
  const digest = requireString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw invariantError(`${label} is not a SHA-256 digest.`);
  }
  return digest;
}

function verifyUtf8Digest(value: string, digest: unknown, label: string): void {
  if (
    computeUtf8Digest(value) !== requireSha256Digest(digest, `${label} digest`)
  ) {
    throw invariantError(`${label} digest mismatch.`);
  }
}

function mapAdapterContractRow(
  row: Record<string, unknown>,
  label: string
): ReturnType<typeof inboxV2AdapterContractSnapshotSchema.parse> {
  return inboxV2AdapterContractSnapshotSchema.parse({
    contractId: row.adapter_contract_id,
    contractVersion: row.adapter_contract_version,
    declarationRevision: parseRevision(
      row.adapter_declaration_revision,
      `${label} adapter declaration revision`
    ),
    surfaceId: row.adapter_surface_id,
    loadedByTrustedServiceId: row.adapter_loaded_by_trusted_service_id,
    loadedAt: parseTimestamp(row.adapter_loaded_at, `${label} adapter loadedAt`)
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    stableSerialize(canonicalizePersistenceValue(left)) ===
    stableSerialize(canonicalizePersistenceValue(right))
  );
}

function canonicalizePersistenceValue(value: unknown): unknown {
  if (typeof value === "string") {
    return inboxV2TimestampSchema.safeParse(value).success
      ? new Date(value).toISOString()
      : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalizePersistenceValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      canonicalizePersistenceValue(entry)
    ])
  );
}

function invariantError(
  message: string
): InboxV2TimelineMessagePersistenceInvariantError {
  return new InboxV2TimelineMessagePersistenceInvariantError(message);
}

function assertAtMostOneRow(
  result: RawSqlQueryResult<Record<string, unknown>>,
  operation: string
): void {
  if (result.rows.length > 1) {
    throw invariantError(`${operation} returned more than one row.`);
  }
}

function hasRetryableSqlState(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      (typeof current !== "object" || current === null) &&
      typeof current !== "function"
    ) {
      return false;
    }
    if (seen.has(current)) return false;
    seen.add(current);
    const code = Reflect.get(current, "code");
    if (typeof code === "string" && RETRYABLE_SQLSTATES.has(code)) return true;
    current = Reflect.get(current, "cause");
  }
  return false;
}

async function runTimelineMessageTransaction<TResult>(
  executor: InboxV2TimelineMessageTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>,
  attempts = TRANSACTION_ATTEMPTS
): Promise<TResult> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await executor.transaction(
        work,
        TIMELINE_MESSAGE_TRANSACTION_CONFIG
      );
    } catch (error) {
      if (attempt === attempts || !hasRetryableSqlState(error)) throw error;
    }
  }
  throw invariantError("Timeline/Message transaction retry exhausted.");
}

void TIMELINE_MESSAGE_SNAPSHOT_CONFIG;
void assertAtMostOneRow;
void runTimelineMessageTransaction;
void inboxV2MessageSchema;
void inboxV2TimelineContentSchema;
void inboxV2TimelineItemSchema;
void inboxV2MessageIdSchema;
