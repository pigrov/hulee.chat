import type { z } from "zod";

import type { InboxV2ExternalThreadMapping } from "./external-thread";
import type { InboxV2SourceThreadBindingCurrentProjection } from "./source-thread-binding";
import {
  inboxV2SourceConversationAtomicResolutionResultSchema,
  inboxV2SourceConversationMaterializationPlanSchema,
  inboxV2SourceConversationResolutionSourceProjectionSchema,
  type InboxV2SourceConversationAtomicResolutionResult,
  type InboxV2SourceConversationBindingResolution,
  type InboxV2SourceConversationInitialHistorySyncState,
  type InboxV2SourceConversationResolutionConflictCode,
  type InboxV2SourceConversationThreadResolution,
  type InboxV2SourceConversationTopology
} from "./source-conversation-resolution";

const tenantId = "tenant:tenant-1";
const timestamp = "2026-07-11T09:00:00.000Z";
const sourceConnection = {
  tenantId,
  kind: "source_connection" as const,
  id: "source_connection:connection-1"
};
const sourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: "source_account:account-1"
};
const adapterContract = {
  contractId: "module:synthetic-source:contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:surface",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: timestamp
};
const key = {
  realm: {
    realmId: "module:synthetic-source:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1"
  },
  scope: { kind: "source_account" as const, owner: sourceAccount },
  objectKindId: "module:synthetic-source:chat",
  canonicalExternalSubject: "CaseSensitiveThread"
};
const source: z.input<
  typeof inboxV2SourceConversationResolutionSourceProjectionSchema
> = {
  tenantId,
  rawInboundEvent: {
    tenantId,
    kind: "raw_inbound_event",
    id: "raw_inbound_event:raw-1"
  },
  normalizedInboundEvent: {
    tenantId,
    kind: "normalized_inbound_event",
    id: "normalized_inbound_event:normalized-1"
  },
  sourceConnection,
  sourceAccount,
  domain: "core:inbox-v2.normalized-event-safe-envelope",
  schemaId: "core:inbox-v2.normalized-event-envelope",
  schemaVersion: "v1",
  safeEnvelopeHmacSha256: `hmac-sha256:${"a".repeat(64)}`,
  adapterContract,
  thread: {
    sourceConnection,
    sourceAccount,
    identityDeclaration: {
      adapterContract,
      identityKind: "external_thread",
      realmId: key.realm.realmId,
      realmVersion: key.realm.realmVersion,
      canonicalizationVersion: key.realm.canonicalizationVersion,
      objectKindId: key.objectKindId,
      scopeKind: "source_account",
      decisionStrength: "safe_default"
    },
    key,
    observedExternalSubject: key.canonicalExternalSubject
  },
  recordedAt: timestamp
};

const validPlan: z.input<
  typeof inboxV2SourceConversationMaterializationPlanSchema
> = {
  source,
  topology: "direct",
  purposeId: "core:chat",
  routeDescriptor: {
    adapterContract,
    descriptorSchemaId: "module:synthetic-source:route",
    descriptorVersion: "v1",
    descriptorRevision: "1",
    destinationKindId: "module:synthetic-source:peer",
    destinationSubject: "OpaqueRoute",
    attributes: [],
    descriptorDigestSha256:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  candidateConversationId: "conversation:conversation-1",
  candidateExternalThreadId: "external_thread:thread-1",
  candidateSourceThreadBindingId: "source_thread_binding:binding-1",
  candidateRemoteAccessEpisodeId:
    "source_thread_binding_remote_access_episode:episode-1",
  capabilityEntries: [],
  historySyncState: "unsupported",
  namespaceGeneration: "namespace-generation-v1",
  materializedByTrustedServiceId: "core:source-runtime",
  materializationToken: "materialization-token-1",
  materializedAt: timestamp
};

const _sourceWithClient: z.input<
  typeof inboxV2SourceConversationResolutionSourceProjectionSchema
> = {
  ...source,
  // @ts-expect-error Client identity is not part of exact thread resolution.
  clientId: "client:client-1"
};
const _sourceWithSender: z.input<
  typeof inboxV2SourceConversationResolutionSourceProjectionSchema
> = {
  ...source,
  // @ts-expect-error Sender identity cannot choose a Conversation or route.
  senderId: "source_external_identity:sender-1"
};
const _planWithTitle: z.input<
  typeof inboxV2SourceConversationMaterializationPlanSchema
> = {
  ...validPlan,
  // @ts-expect-error Display title cannot participate in canonical resolution.
  title: "Forbidden title"
};
const _planWithExistingConversation: z.input<
  typeof inboxV2SourceConversationMaterializationPlanSchema
> = {
  ...validPlan,
  // @ts-expect-error Caller-selected existing Conversation is forbidden.
  existingConversationId: "conversation:existing"
};
const _planWithNonChatTopology: z.input<
  typeof inboxV2SourceConversationMaterializationPlanSchema
> = {
  ...validPlan,
  // @ts-expect-error Source conversation materialization is direct/group only.
  topology: "case"
};

declare const mapping: InboxV2ExternalThreadMapping;
declare const binding: InboxV2SourceThreadBindingCurrentProjection;

const _resolvedInput: z.input<
  typeof inboxV2SourceConversationAtomicResolutionResultSchema
> = {
  outcome: "resolved",
  plan: validPlan,
  threadResolution: "matched_canonical",
  bindingResolution: "already_exists",
  matchedAlias: null,
  externalThreadMapping: mapping,
  sourceThreadBinding: binding,
  resolvedAt: timestamp
};

const _conflictInput: z.input<
  typeof inboxV2SourceConversationAtomicResolutionResultSchema
> = {
  outcome: "conflict",
  request: {
    tenantId,
    rawInboundEvent: source.rawInboundEvent,
    normalizedInboundEvent: source.normalizedInboundEvent,
    sourceConnection,
    sourceAccount
  },
  plan: validPlan,
  conflictCode: "source.conversation_resolution.source_projection_conflict",
  retryable: false,
  diagnostic: null,
  conflictedByTrustedServiceId: "core:source-runtime",
  conflictToken: "conflict-token-1",
  conflictedAt: timestamp
};

declare const result: InboxV2SourceConversationAtomicResolutionResult;
const _typedResult: InboxV2SourceConversationAtomicResolutionResult = result;
const _topology: InboxV2SourceConversationTopology = "group";
const _history: InboxV2SourceConversationInitialHistorySyncState =
  "not_started";
const _threadResolution: InboxV2SourceConversationThreadResolution =
  "matched_alias";
const _bindingResolution: InboxV2SourceConversationBindingResolution =
  "created";
const _conflictCode: InboxV2SourceConversationResolutionConflictCode =
  "source.conversation_resolution.binding_conflict";
