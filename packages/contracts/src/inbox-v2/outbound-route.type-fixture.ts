import type { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import { inboxV2SourceThreadBindingReferenceSchema } from "./ids";
import type {
  InboxV2OutboundRouteReference,
  InboxV2SourceOccurrenceReference,
  InboxV2SourceThreadBindingReference
} from "./ids";
import {
  inboxV2ConversationRouteAuthorizationDecisionSchema,
  inboxV2OutboundRouteSchema,
  inboxV2SourceAccountRouteAuthorizationDecisionSchema,
  inboxV2ThreadRoutePolicySchema,
  type InboxV2OutboundRoute,
  type InboxV2OutboundRouteError,
  type InboxV2OutboundRouteIntent,
  type InboxV2OutboundRouteReferenceContext,
  type InboxV2OutboundRouteResolutionInput,
  type InboxV2ThreadRoutePolicy
} from "./outbound-route";
import type { InboxV2SourceThreadBindingFence } from "./source-thread-binding";

const tenantId = "tenant:tenant-1";
const timestamp = "2026-07-11T10:00:00.000Z";
const conversation = {
  tenantId,
  kind: "conversation" as const,
  id: "conversation:conversation-1"
};
const externalThread = {
  tenantId,
  kind: "external_thread" as const,
  id: "external_thread:thread-1"
};
const binding = {
  tenantId,
  kind: "source_thread_binding" as const,
  id: "source_thread_binding:binding-1"
};
const typedBinding = inboxV2SourceThreadBindingReferenceSchema.parse(binding);
const sourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: "source_account:account-1"
};
const sourceConnection = {
  tenantId,
  kind: "source_connection" as const,
  id: "source_connection:connection-1"
};
const principal = {
  kind: "employee" as const,
  employee: {
    tenantId,
    kind: "employee" as const,
    id: "employee:employee-1"
  }
};
const fence = {
  accountGeneration: "1",
  bindingGeneration: "1",
  remoteAccessRevision: "1",
  administrativeRevision: "1",
  capabilityRevision: "1",
  routeDescriptorRevision: "1"
};
const authorizationTarget = {
  conversation,
  externalThread,
  sourceThreadBinding: binding,
  sourceAccount,
  sourceConnection,
  operationId: "core:reply",
  contentKindId: "core:text",
  authorizationEpoch: "authorization:epoch-0001",
  bindingFence: fence,
  referenceTarget: { kind: "none" as const }
};

const _policyInput: z.input<typeof inboxV2ThreadRoutePolicySchema> = {
  tenantId,
  id: "thread_route_policy:policy-1",
  conversation,
  externalThread,
  operationId: "core:reply",
  contentKindId: "core:text",
  policyId: "core:explicit-policy",
  requiredConversationPermissionId: "core:message.reply_external",
  preferredBinding: binding,
  fallback: { kind: "none" },
  revision: "1",
  createdAt: timestamp,
  updatedAt: timestamp
};

const _conversationDecisionInput: z.input<
  typeof inboxV2ConversationRouteAuthorizationDecisionSchema
> = {
  decisionKind: "conversation_action",
  requiredPermissionId: "core:message.reply_external",
  tenantId,
  principal,
  target: authorizationTarget,
  effect: "allow",
  matchedPermissionIds: ["core:message.reply_external"],
  decisionToken: "decision:conversation-0001",
  decisionRevision: "1",
  loadedByTrustedServiceId: "core:authorization-service",
  decidedAt: timestamp,
  notAfter: "2026-07-11T11:00:00.000Z"
};

const _accountDecisionInput: z.input<
  typeof inboxV2SourceAccountRouteAuthorizationDecisionSchema
> = {
  decisionKind: "source_account_use",
  requiredPermissionId: "core:source_account.use",
  tenantId,
  principal,
  target: authorizationTarget,
  effect: "allow",
  matchedPermissionIds: ["core:source_account.use"],
  decisionToken: "decision:source-account-0001",
  decisionRevision: "1",
  loadedByTrustedServiceId: "core:authorization-service",
  decidedAt: timestamp,
  notAfter: "2026-07-11T11:00:00.000Z"
};

const _automaticIntent: InboxV2OutboundRouteIntent = { kind: "automatic" };
const _explicitBindingIntent: InboxV2OutboundRouteIntent = {
  kind: "explicit_binding",
  binding: typedBinding
};

const _legacyFallbackIntent: InboxV2OutboundRouteIntent = {
  kind: "automatic",
  // @ts-expect-error Fallback is a distinct policy/reroute intent, never a caller boolean.
  allowFallback: true
};

const _wrongAccountPurpose: z.input<
  typeof inboxV2SourceAccountRouteAuthorizationDecisionSchema
> = {
  ..._accountDecisionInput,
  // @ts-expect-error SourceAccount-use authority has one canonical typed purpose.
  requiredPermissionId: "core:message.reply_external"
};

const _runtimeInFence: InboxV2SourceThreadBindingFence = {
  ...fence,
  // @ts-expect-error Runtime health is advisory and excluded from the structural route fence.
  runtimeHealthRevision: "1"
};

declare const occurrenceReference: InboxV2SourceOccurrenceReference;
declare const bindingReference: InboxV2SourceThreadBindingReference;
declare const routeReference: InboxV2OutboundRouteReference;
declare const policy: InboxV2ThreadRoutePolicy;
declare const route: InboxV2OutboundRoute;
declare const resolutionInput: InboxV2OutboundRouteResolutionInput;
declare const referenceContext: InboxV2OutboundRouteReferenceContext;

const _occurrenceIntent: InboxV2OutboundRouteIntent = {
  kind: "explicit_occurrence",
  occurrence: occurrenceReference
};
const _rerouteIntent: InboxV2OutboundRouteIntent = {
  kind: "explicit_reroute",
  originalRoute: routeReference,
  replacementBinding: bindingReference,
  reasonId: inboxV2CatalogIdSchema.parse("core:operator-reroute")
};
const _replyWindowError: InboxV2OutboundRouteError = {
  code: "route.reply_window_expired",
  retryability: "terminal",
  diagnostic: null
};

// @ts-expect-error SourceOccurrence references cannot substitute for binding references.
const _bindingFromOccurrence: InboxV2SourceThreadBindingReference =
  occurrenceReference;

// @ts-expect-error An immutable route is not a route policy.
const _policyFromRoute: InboxV2ThreadRoutePolicy = route;

// @ts-expect-error A policy cannot substitute for the immutable selected route.
const _routeFromPolicy: InboxV2OutboundRoute = policy;

// @ts-expect-error Route reference context is not a complete resolution input.
const _inputFromReference: InboxV2OutboundRouteResolutionInput =
  referenceContext;

const _legacyRecipientRouteInput: z.input<typeof inboxV2OutboundRouteSchema> = {
  ...route,
  // @ts-expect-error Client/sender-derived recipient fields are forbidden on immutable routes.
  clientExternalId: "legacy-recipient"
};

void resolutionInput;
