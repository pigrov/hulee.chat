import type { z } from "zod";

import type {
  InboxV2ExternalMessageIdentityDeclaration,
  InboxV2ExternalMessageKey,
  InboxV2ExternalMessageReference,
  InboxV2ExternalMessageScope,
  InboxV2ExternalMessageScopeKind,
  InboxV2ExternalReferencePortabilityKind,
  InboxV2SourceOccurrence,
  InboxV2SourceOccurrenceOrigin,
  InboxV2SourceOccurrenceProviderActor,
  InboxV2SourceOccurrenceResolutionCommit,
  InboxV2SourceOccurrenceResolution
} from "./external-message-reference";
import {
  inboxV2ExternalMessageKeySchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2SourceOccurrenceSchema
} from "./external-message-reference";
import type {
  InboxV2ExternalThreadReference,
  InboxV2MessageReference,
  InboxV2SourceAccountReference,
  InboxV2SourceThreadBindingReference,
  InboxV2TimelineItemReference
} from "./ids";

declare const messageKey: InboxV2ExternalMessageKey;
declare const externalMessageReference: InboxV2ExternalMessageReference;
declare const sourceOccurrence: InboxV2SourceOccurrence;
declare const resolutionCommit: InboxV2SourceOccurrenceResolutionCommit;
declare const sourceAccountReference: InboxV2SourceAccountReference;
declare const sourceThreadBindingReference: InboxV2SourceThreadBindingReference;
declare const externalThreadReference: InboxV2ExternalThreadReference;

const _scopeKind: InboxV2ExternalMessageScopeKind =
  externalMessageReference.identityDeclaration.scopeKind;
const _messageReference: InboxV2MessageReference =
  externalMessageReference.message;
const _timelineItemReference: InboxV2TimelineItemReference =
  externalMessageReference.timelineItem;
const _externalThreadReference: InboxV2ExternalThreadReference =
  externalMessageReference.externalThread;
const _occurrenceOrigin: InboxV2SourceOccurrenceOrigin =
  sourceOccurrence.origin;
const _occurrenceActor: InboxV2SourceOccurrenceProviderActor =
  sourceOccurrence.providerActor;
const _resolvedOccurrenceAfter: InboxV2SourceOccurrence =
  resolutionCommit.after;

// @ts-expect-error A resolution commit is not itself an immutable provider reference.
const _referenceFromResolutionCommit: InboxV2ExternalMessageReference =
  resolutionCommit;
const _occurrenceResolution: InboxV2SourceOccurrenceResolution =
  sourceOccurrence.resolution;
const _portabilityKind: InboxV2ExternalReferencePortabilityKind =
  sourceOccurrence.referencePortability.kind;

if (messageKey.scope.kind === "source_account") {
  const _account: InboxV2SourceAccountReference = messageKey.scope.owner;

  // @ts-expect-error Account-scoped owner cannot substitute for a binding.
  const _binding: InboxV2SourceThreadBindingReference = messageKey.scope.owner;
}

if (messageKey.scope.kind === "source_thread_binding") {
  const _binding: InboxV2SourceThreadBindingReference = messageKey.scope.owner;

  // @ts-expect-error Binding-scoped owner cannot substitute for an account.
  const _account: InboxV2SourceAccountReference = messageKey.scope.owner;
}

if (sourceOccurrence.origin.kind === "provider_response") {
  const _attemptKind: "outbound_dispatch_attempt" =
    sourceOccurrence.origin.outboundDispatchAttempt.kind;

  // @ts-expect-error Provider-response origin has no inbound raw event.
  const _rawEventOnProviderResponse = sourceOccurrence.origin.rawInboundEvent;
} else {
  const eventOrigin = sourceOccurrence.origin;
  const _rawKind: "raw_inbound_event" = eventOrigin.rawInboundEvent.kind;
  const _normalizedKind: "normalized_inbound_event" =
    eventOrigin.normalizedInboundEvent.kind;

  // @ts-expect-error Event origin has no outbound dispatch attempt.
  const _attemptOnInboundEvent = eventOrigin.outboundDispatchAttempt;
}

if (sourceOccurrence.resolution.state === "resolved") {
  const resolution = sourceOccurrence.resolution;
  const _referenceKind: "external_message_reference" =
    resolution.externalMessageReference.kind;

  // @ts-expect-error Resolved occurrence has no conflict candidate collection.
  const _candidatesOnResolved = resolution.candidateExternalMessageReferences;
}

const adapterContractInput = {
  contractId: "module:synthetic:direct-account-adapter",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic:direct-account",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: "2026-07-11T09:00:00.000Z"
} as const;

const validMessageKeyInput: z.input<typeof inboxV2ExternalMessageKeySchema> = {
  realm: {
    realmId: "module:synthetic:message-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1"
  },
  scope: { kind: "provider_thread" },
  objectKindId: "module:synthetic:chat-message",
  externalThread: {
    tenantId: "tenant:tenant-1",
    kind: "external_thread",
    id: "external_thread:thread-1"
  },
  canonicalExternalSubject: "Opaque-Message-ID:42"
};

const validMessageIdentityDeclarationInput = {
  adapterContract: adapterContractInput,
  identityKind: "message" as const,
  realmId: validMessageKeyInput.realm.realmId,
  realmVersion: validMessageKeyInput.realm.realmVersion,
  canonicalizationVersion: validMessageKeyInput.realm.canonicalizationVersion,
  objectKindId: validMessageKeyInput.objectKindId,
  scopeKind: validMessageKeyInput.scope.kind,
  decisionStrength: "authoritative" as const
};

const validExternalMessageReferenceInput: z.input<
  typeof inboxV2ExternalMessageReferenceSchema
> = {
  tenantId: "tenant:tenant-1",
  id: "external_message_reference:reference-1",
  key: validMessageKeyInput,
  identityDeclaration: validMessageIdentityDeclarationInput,
  externalThread: validMessageKeyInput.externalThread,
  timelineItem: {
    tenantId: "tenant:tenant-1",
    kind: "timeline_item",
    id: "timeline_item:item-1"
  },
  message: {
    tenantId: "tenant:tenant-1",
    kind: "message",
    id: "message:message-1"
  },
  revision: "1",
  createdAt: "2026-07-11T09:00:03.000Z"
};

const validSourceOccurrenceInput: z.input<
  typeof inboxV2SourceOccurrenceSchema
> = {
  tenantId: "tenant:tenant-1",
  id: "source_occurrence:occurrence-1",
  messageKey: validMessageKeyInput,
  messageIdentityDeclaration: validMessageIdentityDeclarationInput,
  bindingContext: {
    externalThread: validMessageKeyInput.externalThread,
    sourceAccount: {
      tenantId: "tenant:tenant-1",
      kind: "source_account",
      id: "source_account:account-1"
    },
    sourceThreadBinding: {
      tenantId: "tenant:tenant-1",
      kind: "source_thread_binding",
      id: "source_thread_binding:binding-1"
    },
    bindingGeneration: "1"
  },
  origin: {
    kind: "webhook",
    sourceAccount: {
      tenantId: "tenant:tenant-1",
      kind: "source_account",
      id: "source_account:account-1"
    },
    rawInboundEvent: {
      tenantId: "tenant:tenant-1",
      kind: "raw_inbound_event",
      id: "raw_inbound_event:raw-1"
    },
    normalizedInboundEvent: {
      tenantId: "tenant:tenant-1",
      kind: "normalized_inbound_event",
      id: "normalized_inbound_event:normalized-1"
    }
  },
  descriptor: {
    adapterContract: adapterContractInput,
    descriptorSchemaId: "module:synthetic:normalized-message-observation",
    descriptorVersion: "v1",
    capabilityRevision: "1",
    providerReferences: [
      {
        kindId: "module:synthetic:external-message-id",
        subject: "Opaque-Message-ID:42"
      }
    ],
    descriptorDigestSha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  providerActor: {
    kind: "source_external_identity",
    sourceExternalIdentity: {
      tenantId: "tenant:tenant-1",
      kind: "source_external_identity",
      id: "source_external_identity:actor-1"
    }
  },
  direction: "inbound",
  providerTimestamps: [
    {
      kindId: "module:synthetic:sent-at",
      timestamp: "2026-07-11T09:00:01.000Z"
    }
  ],
  referencePortability: {
    kind: "binding_only",
    adapterContract: adapterContractInput,
    decisionStrength: "safe_default"
  },
  resolution: {
    state: "resolved",
    externalMessageReference: {
      tenantId: "tenant:tenant-1",
      kind: "external_message_reference",
      id: "external_message_reference:reference-1"
    }
  },
  observedAt: "2026-07-11T09:00:02.000Z",
  recordedAt: "2026-07-11T09:00:03.000Z",
  revision: "1",
  createdAt: "2026-07-11T09:00:03.000Z",
  updatedAt: "2026-07-11T09:00:03.000Z"
};

const _invalidConnectionScope: InboxV2ExternalMessageScope = {
  // @ts-expect-error Source connection is not an exact message-key scope.
  kind: "source_connection"
};

const _invalidProviderThreadOwner: InboxV2ExternalMessageScope = {
  kind: "provider_thread",
  // @ts-expect-error Provider-thread scope does not carry an account owner.
  owner: sourceAccountReference
};

const _invalidDeclarationKind: InboxV2ExternalMessageIdentityDeclaration = {
  ...externalMessageReference.identityDeclaration,
  // @ts-expect-error External message declarations are message declarations only.
  identityKind: "external_thread"
};

const _invalidDeclarationScope: InboxV2ExternalMessageIdentityDeclaration = {
  ...externalMessageReference.identityDeclaration,
  // @ts-expect-error External message declaration output excludes connection scope.
  scopeKind: "source_connection"
};

// @ts-expect-error Timeline items cannot substitute for Message references.
const _messageFromTimeline: InboxV2MessageReference =
  externalMessageReference.timelineItem;

// @ts-expect-error Message references cannot substitute for ExternalThread refs.
const _threadFromMessage: InboxV2ExternalThreadReference =
  externalMessageReference.message;

// @ts-expect-error Internal direction is not a provider occurrence direction.
const _invalidOccurrenceDirection: InboxV2SourceOccurrence["direction"] =
  "internal";

// @ts-expect-error Cross-account is not a declared reference portability scope.
const _invalidPortability: InboxV2ExternalReferencePortabilityKind =
  "cross_account";

const _invalidTransportAccountActor: NonNullable<InboxV2SourceOccurrenceProviderActor> =
  {
    // @ts-expect-error SourceAccount is transport context, never a provider actor.
    kind: "source_account",
    sourceAccount: sourceAccountReference
  };

const _invalidResolution: InboxV2SourceOccurrenceResolution = {
  // @ts-expect-error Deduplicated is an outcome, not an occurrence resolution state.
  state: "deduplicated"
};

const _invalidNumericReferenceRevision: z.input<
  typeof inboxV2ExternalMessageReferenceSchema
> = {
  ...validExternalMessageReferenceInput,
  // @ts-expect-error Wire revisions are decimal strings, never numbers.
  revision: 1
};

const _invalidNumericOccurrenceRevision: z.input<
  typeof inboxV2SourceOccurrenceSchema
> = {
  ...validSourceOccurrenceInput,
  // @ts-expect-error Wire revisions are decimal strings, never numbers.
  revision: 1
};

const _invalidWeakMessageIdentity: z.input<
  typeof inboxV2ExternalMessageKeySchema
> = {
  ...validMessageKeyInput,
  // @ts-expect-error Message body is not part of exact external identity.
  body: "same body"
};

// @ts-expect-error SourceOccurrence deliberately exposes no lifetime aggregate.
const _lifetimeAggregate = sourceOccurrence.allOccurrences;

// @ts-expect-error Exact message key deliberately exposes no display sender.
const _displaySenderIdentity = messageKey.senderDisplayName;

// Keep declared references live in this compile-only fixture.
void sourceAccountReference;
void sourceThreadBindingReference;
void externalThreadReference;
