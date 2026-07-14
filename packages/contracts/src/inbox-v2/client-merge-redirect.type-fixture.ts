import type { z } from "zod";

import {
  inboxV2CanonicalConversationClientLinkPageSchema,
  deriveInboxV2ClientMergeCommit,
  inboxV2ClientMergeCommitSchema,
  inboxV2ClientMergeNodeStateSchema,
  inboxV2ClientMergeRedirectSchema,
  inboxV2ClientMergeResolutionBatchSchema,
  inboxV2ClientMergeResolutionPathSchema,
  resolveInboxV2CanonicalClientReference,
  resolveInboxV2CanonicalConversationClientLinkGroups,
  type InboxV2CanonicalConversationClientLinkPage,
  type InboxV2ClientMergeCommit,
  type InboxV2ClientMergeNodeState,
  type InboxV2ClientMergeRedirect,
  type InboxV2ClientMergeResolutionBatch,
  type InboxV2ClientMergeResolutionPath
} from "./client-merge-redirect";
import { inboxV2ConversationClientCurrentLinkPageSchema } from "./conversation-client-link";
import {
  inboxV2ClientReferenceSchema,
  type InboxV2ClientId,
  type InboxV2ClientMergeRedirectId,
  type InboxV2ClientMergeRedirectReference,
  type InboxV2ClientReference,
  type InboxV2ConversationClientLinkId,
  type InboxV2ConversationClientLinkReference,
  type InboxV2TenantId
} from "./ids";

type ClientMergeNodeStateInput = z.input<
  typeof inboxV2ClientMergeNodeStateSchema
>;
type CanonicalClientMergeNodeStateInput = Extract<
  ClientMergeNodeStateInput,
  { state: "canonical_root" }
>;
type RedirectedClientMergeNodeStateInput = Extract<
  ClientMergeNodeStateInput,
  { state: "redirected" }
>;

const _sourceClientInput: z.input<typeof inboxV2ClientReferenceSchema> = {
  tenantId: "tenant:tenant-1",
  kind: "client",
  id: "client:source"
};
const _targetClientInput: z.input<typeof inboxV2ClientReferenceSchema> = {
  tenantId: "tenant:tenant-1",
  kind: "client",
  id: "client:target"
};
const _resolutionStampInput = {
  kind: "trusted_service",
  trustedServiceId: "core:client-merge-resolver",
  resolvedAt: "2026-07-11T09:00:00.000Z"
} as const;

const _canonicalSourceNodeInput: CanonicalClientMergeNodeStateInput = {
  tenantId: "tenant:tenant-1",
  client: _sourceClientInput,
  state: "canonical_root",
  nextClient: null,
  redirect: null,
  maximumInboundDepth: 0,
  lastGraphRevision: null,
  revision: "1",
  updatedAt: "2026-07-11T09:00:00.000Z"
};
const _canonicalTargetNodeInput: CanonicalClientMergeNodeStateInput = {
  ..._canonicalSourceNodeInput,
  client: _targetClientInput
};
const _redirectedNodeInput: RedirectedClientMergeNodeStateInput = {
  tenantId: "tenant:tenant-1",
  client: _sourceClientInput,
  state: "redirected",
  nextClient: _targetClientInput,
  redirect: {
    tenantId: "tenant:tenant-1",
    kind: "client_merge_redirect",
    id: "client_merge_redirect:redirect-1"
  },
  maximumInboundDepth: 0,
  lastGraphRevision: "1",
  revision: "2",
  updatedAt: "2026-07-11T09:01:00.000Z"
};

const _sourceResolutionInput: z.input<
  typeof inboxV2ClientMergeResolutionPathSchema
> = {
  tenantId: "tenant:tenant-1",
  graphHead: null,
  requestedClient: _sourceClientInput,
  nodes: [_canonicalSourceNodeInput],
  canonicalClient: _sourceClientInput,
  resolutionStamp: _resolutionStampInput
};
const _targetResolutionInput: z.input<
  typeof inboxV2ClientMergeResolutionPathSchema
> = {
  ..._sourceResolutionInput,
  requestedClient: _targetClientInput,
  nodes: [_canonicalTargetNodeInput],
  canonicalClient: _targetClientInput
};
const _resolutionBatchInput: z.input<
  typeof inboxV2ClientMergeResolutionBatchSchema
> = {
  tenantId: "tenant:tenant-1",
  graphHead: null,
  resolutionStamp: _resolutionStampInput,
  resolutions: [_sourceResolutionInput, _targetResolutionInput]
};

const _validRedirectInput: z.input<typeof inboxV2ClientMergeRedirectSchema> = {
  tenantId: "tenant:tenant-1",
  id: "client_merge_redirect:redirect-1",
  sourceRoot: _sourceClientInput,
  targetRoot: _targetClientInput,
  sourceRootVerification: _sourceResolutionInput,
  targetRootVerification: _targetResolutionInput,
  sourceMaximumInboundDepth: 0,
  targetMaximumInboundDepth: 0,
  resultingMaximumInboundDepth: 1,
  decision: {
    actor: {
      kind: "employee",
      employee: {
        tenantId: "tenant:tenant-1",
        kind: "employee",
        id: "employee:employee-1"
      }
    },
    policyId: "core:manual-client-merge",
    policyVersion: "v1",
    reasonCodeId: "core:duplicate-client"
  },
  expectedGraphRevision: null,
  currentGraphRevision: null,
  resultingGraphRevision: "1",
  createdAt: "2026-07-11T09:01:00.000Z",
  revision: "1"
};

type ClientMergeCommitDerivationInput = Parameters<
  typeof deriveInboxV2ClientMergeCommit
>[0];
const _validClientMergeCommitDerivationInput: ClientMergeCommitDerivationInput =
  {
    redirect: _validRedirectInput
  };
const _invalidGraphCommitDerivationInput: ClientMergeCommitDerivationInput = {
  redirect: _validRedirectInput,
  // @ts-expect-error Atomic commit derivation accepts one verified redirect, not a loaded graph.
  graph: []
};
const _derivedCommit: InboxV2ClientMergeCommit = deriveInboxV2ClientMergeCommit(
  _validClientMergeCommitDerivationInput
);
const _derivedCommitSchemaOutput: z.output<
  typeof inboxV2ClientMergeCommitSchema
> = _derivedCommit;

const _invalidCanonicalNode: CanonicalClientMergeNodeStateInput = {
  ..._canonicalSourceNodeInput,
  // @ts-expect-error A canonical-root node has no next Client.
  nextClient: _targetClientInput
};
const _invalidRedirectedNode: RedirectedClientMergeNodeStateInput = {
  ..._redirectedNodeInput,
  // @ts-expect-error A redirected node must carry its exact redirect reference.
  redirect: null
};
const _invalidNodeDiscriminant: ClientMergeNodeStateInput = {
  ..._canonicalSourceNodeInput,
  // @ts-expect-error Client merge nodes expose only canonical_root or redirected states.
  state: "active"
};

const _invalidSourceRootInput: z.input<
  typeof inboxV2ClientMergeRedirectSchema
> = {
  ..._validRedirectInput,
  sourceRoot: {
    tenantId: "tenant:tenant-1",
    // @ts-expect-error sourceRoot must be an exact Client reference.
    kind: "conversation_client_link",
    id: "conversation_client_link:link-1"
  }
};
const _invalidTargetRootInput: z.input<
  typeof inboxV2ClientMergeRedirectSchema
> = {
  ..._validRedirectInput,
  // @ts-expect-error targetRoot is tenant-scoped reference data, never a scalar Client ID.
  targetRoot: "client:target"
};

type CanonicalClientResolverInput = Parameters<
  typeof resolveInboxV2CanonicalClientReference
>[0];
type CanonicalLinkCoalescerInput = Parameters<
  typeof resolveInboxV2CanonicalConversationClientLinkGroups
>[0];

const _validCanonicalClientResolverInput: CanonicalClientResolverInput = {
  resolution: _sourceResolutionInput
};
const _invalidLegacyCanonicalClientResolverInput: CanonicalClientResolverInput =
  {
    resolution: _sourceResolutionInput,
    // @ts-expect-error Runtime resolution accepts one bounded path, not a loaded redirect graph.
    graph: []
  };

declare const currentLinkPageInput: z.input<
  typeof inboxV2ConversationClientCurrentLinkPageSchema
>;
const _validCanonicalLinkCoalescerInput: CanonicalLinkCoalescerInput = {
  linkPage: currentLinkPageInput,
  resolutionBatch: _resolutionBatchInput
};
const _invalidLegacyCanonicalLinkCoalescerInput: CanonicalLinkCoalescerInput = {
  ..._validCanonicalLinkCoalescerInput,
  // @ts-expect-error Coalescing accepts a bounded current page, not full link history.
  linkGraph: []
};
const _invalidUnboundedCanonicalLinkCoalescerInput: CanonicalLinkCoalescerInput =
  {
    linkPage: currentLinkPageInput,
    // @ts-expect-error Resolution arrays must pass through the bounded ResolutionBatch contract.
    resolutionBatch: [_sourceResolutionInput]
  };

const _resolvedClient: InboxV2ClientReference =
  resolveInboxV2CanonicalClientReference(_validCanonicalClientResolverInput);
const _canonicalPage: InboxV2CanonicalConversationClientLinkPage =
  resolveInboxV2CanonicalConversationClientLinkGroups(
    _validCanonicalLinkCoalescerInput
  );

declare const tenantId: InboxV2TenantId;
declare const clientId: InboxV2ClientId;
declare const redirectId: InboxV2ClientMergeRedirectId;
declare const linkId: InboxV2ConversationClientLinkId;
declare const clientReference: InboxV2ClientReference;
declare const redirectReference: InboxV2ClientMergeRedirectReference;
declare const linkReference: InboxV2ConversationClientLinkReference;
declare const redirect: InboxV2ClientMergeRedirect;
declare const node: InboxV2ClientMergeNodeState;
declare const resolution: InboxV2ClientMergeResolutionPath;
declare const batch: InboxV2ClientMergeResolutionBatch;

const _redirectSourceRoot: InboxV2ClientReference = redirect.sourceRoot;
const _nodeTenant: InboxV2TenantId = node.tenantId;
const _resolutionCanonicalClient: InboxV2ClientReference =
  resolution.canonicalClient;
const _batchTenant: InboxV2TenantId = batch.tenantId;

// @ts-expect-error Conversation-Client link IDs cannot substitute for merge redirect IDs.
const _redirectIdFromLinkId: InboxV2ClientMergeRedirectId = linkId;

// @ts-expect-error Merge redirect IDs cannot substitute for Client IDs.
const _clientIdFromRedirectId: InboxV2ClientId = redirectId;

// @ts-expect-error Link references cannot substitute for merge redirect references.
const _redirectReferenceFromLinkReference: InboxV2ClientMergeRedirectReference =
  linkReference;

// @ts-expect-error Merge redirect references cannot substitute for Client references.
const _clientReferenceFromRedirectReference: InboxV2ClientReference =
  redirectReference;

// @ts-expect-error Scalar Client IDs cannot substitute for tenant-scoped Client references.
const _clientReferenceFromClientId: InboxV2ClientReference = clientId;

// @ts-expect-error The unbounded RedirectGraph output type was removed.
import type { InboxV2ClientMergeRedirectGraph as _RemovedRedirectGraph } from "./client-merge-redirect";

// @ts-expect-error The unbounded RedirectGraph schema is not a public runtime API.
import { inboxV2ClientMergeRedirectGraphSchema as _removedRedirectGraphSchema } from "./client-merge-redirect";

void tenantId;
void clientReference;
void inboxV2CanonicalConversationClientLinkPageSchema;
