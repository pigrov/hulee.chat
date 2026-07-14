import type { z } from "zod";

import type { InboxV2ClientStageId } from "./ids";
import type {
  InboxV2Conversation,
  InboxV2ConversationLifecycle,
  InboxV2ConversationPurposeId,
  InboxV2ConversationSequenceHead,
  InboxV2ConversationTopology,
  InboxV2ConversationTransport
} from "./conversation";
import { inboxV2ConversationSchema } from "./conversation";
import type { InboxV2EntityRevision } from "./entity-metadata";

declare const conversation: InboxV2Conversation;
declare const clientStageId: InboxV2ClientStageId;
declare const purposeId: InboxV2ConversationPurposeId;
declare const sequenceHead: InboxV2ConversationSequenceHead;
declare const revision: InboxV2EntityRevision;

const _topology: InboxV2ConversationTopology = conversation.topology;
const _transport: InboxV2ConversationTransport = conversation.transport;
const _lifecycle: InboxV2ConversationLifecycle = conversation.lifecycle;
const _sequenceHead: InboxV2ConversationSequenceHead =
  conversation.head.latestTimelineSequence;
const _revision: InboxV2EntityRevision = conversation.revision;
const _headRevision: InboxV2EntityRevision = conversation.head.revision;
const _purposeId: InboxV2ConversationPurposeId = conversation.purposeId;

const _validInput: z.input<typeof inboxV2ConversationSchema> = {
  tenantId: "tenant:tenant-1",
  id: "conversation:conversation-1",
  topology: "direct",
  transport: "external",
  purposeId: "core:chat",
  lifecycle: "active",
  head: {
    latestTimelineSequence: "0",
    latestActivityItemId: null,
    latestActivityTimelineSequence: null,
    latestActivityAt: null,
    revision: "1",
    createdAt: "2026-07-11T09:00:00.000Z",
    updatedAt: "2026-07-11T09:00:00.000Z"
  },
  revision: "1",
  createdAt: "2026-07-11T09:00:00.000Z",
  updatedAt: "2026-07-11T09:00:00.000Z"
};

// @ts-expect-error Entity revisions cannot substitute for sequence heads.
const _sequenceFromRevision: InboxV2ConversationSequenceHead = revision;

// @ts-expect-error Sequence heads cannot substitute for entity revisions.
const _revisionFromSequence: InboxV2EntityRevision = sequenceHead;

// @ts-expect-error CRM Client-stage IDs cannot substitute for Conversation purposes.
const _purposeFromClientStage: InboxV2ConversationPurposeId = clientStageId;

// @ts-expect-error Conversation purpose IDs cannot substitute for CRM Client stages.
const _clientStageFromPurpose: InboxV2ClientStageId = purposeId;

// @ts-expect-error Conversation lifecycle is closed and excludes personal archive.
const _archivedLifecycle: InboxV2ConversationLifecycle = "archived";

// @ts-expect-error Legacy overloaded Conversation types are not V2 topologies.
const _legacyTopology: InboxV2ConversationTopology = "client_direct";

const _invalidNumericRevision: z.input<typeof inboxV2ConversationSchema> = {
  ..._validInput,
  // @ts-expect-error Wire counters must be decimal strings, never JS numbers.
  revision: 1
};

const _invalidNumericSequenceHead: z.input<typeof inboxV2ConversationSchema> = {
  ..._validInput,
  head: {
    ..._validInput.head,
    // @ts-expect-error Wire counters must be decimal strings, never JS numbers.
    latestTimelineSequence: 0
  }
};

const _invalidForeignField: z.input<typeof inboxV2ConversationSchema> = {
  ..._validInput,
  // @ts-expect-error Client ownership is not part of the Conversation contract.
  clientId: "client:client-1"
};
