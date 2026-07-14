import {
  inboxV2ExternalThreadAliasDecisionSchema,
  inboxV2ExternalThreadAliasSchema,
  inboxV2ExternalThreadKeySchema,
  inboxV2ExternalThreadResolutionSchema,
  inboxV2ExternalThreadSchema,
  inboxV2ExternalThreadScopeSchema,
  type InboxV2ExternalThread,
  type InboxV2ExternalThreadAlias,
  type InboxV2ExternalThreadAliasDecision,
  type InboxV2ExternalThreadKey,
  type InboxV2ExternalThreadResolution,
  type InboxV2ExternalThreadScope
} from "./external-thread";

const tenantId = "tenant:type-fixture";
const sourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: "source_account:type-fixture"
};
const adapterContract = {
  contractId: "module:synthetic:type-thread-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic:type-thread-surface",
  loadedByTrustedServiceId: "core:routing-resolver",
  loadedAt: "2026-07-11T08:00:00.000Z"
};
const declaration = {
  adapterContract,
  identityKind: "external_thread" as const,
  realmId: "module:synthetic:type-thread-realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "module:synthetic:type-group",
  scopeKind: "source_account" as const,
  decisionStrength: "safe_default" as const
};
const authoritativeDeclaration = {
  ...declaration,
  decisionStrength: "authoritative" as const
};
const scope = inboxV2ExternalThreadScopeSchema.parse({
  kind: "source_account",
  owner: sourceAccount
}) satisfies InboxV2ExternalThreadScope;
const key = inboxV2ExternalThreadKeySchema.parse({
  realm: {
    realmId: "module:synthetic:type-thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1"
  },
  scope,
  objectKindId: "module:synthetic:type-group",
  canonicalExternalSubject: "Group:Type-Fixture"
}) satisfies InboxV2ExternalThreadKey;
const thread = inboxV2ExternalThreadSchema.parse({
  tenantId,
  id: "external_thread:type-fixture",
  key,
  identityDeclaration: declaration,
  conversation: {
    tenantId,
    kind: "conversation",
    id: "conversation:type-fixture"
  },
  conversationTopology: "group",
  revision: "1",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z"
}) satisfies InboxV2ExternalThread;
const aliasDecision = inboxV2ExternalThreadAliasDecisionSchema.parse({
  actor: {
    kind: "trusted_service",
    trustedServiceId: "core:routing-resolver"
  },
  policyId: "core:thread-migration",
  policyVersion: "v1",
  reasonCodeId: "core:provider-upgrade",
  authoritativeEvidenceToken: "evidence.type-alias",
  decidedAt: "2026-07-11T08:05:00.000Z"
}) satisfies InboxV2ExternalThreadAliasDecision;
const alias = inboxV2ExternalThreadAliasSchema.parse({
  tenantId,
  id: "external_thread_alias:type-fixture",
  aliasKey: { ...key, canonicalExternalSubject: "Group:Legacy" },
  aliasIdentityDeclaration: authoritativeDeclaration,
  canonicalThread: {
    tenantId,
    kind: "external_thread",
    id: thread.id
  },
  canonicalConversation: thread.conversation,
  canonicalKeySnapshot: key,
  expectedCanonicalThreadRevision: "1",
  decision: aliasDecision,
  revision: "1",
  createdAt: "2026-07-11T08:05:00.000Z"
}) satisfies InboxV2ExternalThreadAlias;
const resolution = inboxV2ExternalThreadResolutionSchema.parse({
  tenantId,
  requestedKey: alias.aliasKey,
  requestIdentityDeclaration: authoritativeDeclaration,
  mapping: {
    tenantId,
    thread,
    conversation: {
      tenantId,
      id: thread.conversation.id,
      topology: "group",
      transport: "external",
      purposeId: "core:chat",
      lifecycle: "active",
      head: {
        latestTimelineSequence: "0",
        latestActivityItemId: null,
        latestActivityTimelineSequence: null,
        latestActivityAt: null,
        revision: "1",
        createdAt: "2026-07-11T08:00:00.000Z",
        updatedAt: "2026-07-11T08:00:00.000Z"
      },
      revision: "1",
      createdAt: "2026-07-11T08:00:00.000Z",
      updatedAt: "2026-07-11T08:00:00.000Z"
    }
  },
  resolution: "matched_alias",
  matchedAlias: alias,
  resolvedByTrustedServiceId: "core:routing-resolver",
  resolutionToken: "resolution.type-fixture",
  resolvedAt: "2026-07-11T08:05:00.000Z"
}) satisfies InboxV2ExternalThreadResolution;

const invalidScope: InboxV2ExternalThreadScope = {
  // @ts-expect-error A thread key cannot be scoped to a SourceThreadBinding.
  kind: "source_thread_binding"
};
const invalidKey: InboxV2ExternalThreadKey = {
  ...key,
  // @ts-expect-error Sender identity is not part of an exact thread key.
  senderId: "source_external_identity:bad"
};
const invalidThread: InboxV2ExternalThread = {
  ...thread,
  // @ts-expect-error ExternalThread identity does not own a scalar Client.
  clientId: "client:bad"
};
const invalidAlias: InboxV2ExternalThreadAlias = {
  ...alias,
  canonicalThread: {
    ...alias.canonicalThread,
    // @ts-expect-error Alias targets ExternalThread directly, never another alias.
    kind: "external_thread_alias"
  }
};
type MatchedAliasResolution = Extract<
  InboxV2ExternalThreadResolution,
  { resolution: "matched_alias" }
>;
const matchedAliasResolution = resolution as MatchedAliasResolution;
const invalidResolution: MatchedAliasResolution = {
  ...matchedAliasResolution,
  // @ts-expect-error Alias resolution must carry its exact alias row.
  matchedAlias: null
};

void resolution;
void invalidScope;
void invalidKey;
void invalidThread;
void invalidAlias;
void invalidResolution;
