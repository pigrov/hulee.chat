import type { z } from "zod";

import type {
  InboxV2EmployeeReference,
  InboxV2SourceAccountReference,
  InboxV2SourceThreadBindingReference
} from "./ids";
import type { InboxV2ProviderRoleId } from "./source-routing-primitives";
import {
  deriveInboxV2SourceThreadBindingCurrentHead,
  inboxV2SourceThreadBindingCurrentHeadSchema,
  inboxV2SourceThreadBindingFenceSchema,
  inboxV2SourceThreadBindingSchema,
  inboxV2SourceThreadBindingTransitionSchema,
  type InboxV2SourceBindingCapabilityState,
  type InboxV2SourceReferencePortability,
  type InboxV2SourceThreadBindingAdministrativeState,
  type InboxV2SourceThreadBindingCurrentHead,
  type InboxV2SourceThreadBindingFence,
  type InboxV2SourceThreadBindingHistorySyncState,
  type InboxV2SourceThreadBindingRemoteAccessState,
  type InboxV2SourceThreadBindingRuntimeHealthState
} from "./source-thread-binding";

const tenantId = "tenant:tenant-1";
const timestamp = "2026-07-11T09:00:00.000Z";

const evidence = {
  tenantId,
  kind: "raw_inbound_event" as const,
  id: "raw_inbound_event:raw-1"
};

const adapterContract = {
  contractId: "module:synthetic-source:direct-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:group-surface",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: timestamp
};

const accountIdentity = {
  status: "verified" as const,
  sourceConnection: {
    tenantId,
    kind: "source_connection" as const,
    id: "source_connection:connection-1"
  },
  sourceAccount: {
    tenantId,
    kind: "source_account" as const,
    id: "source_account:account-1"
  },
  declaration: {
    adapterContract,
    identityKind: "source_account" as const,
    realmId: "module:synthetic-source:account-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:user-account",
    scopeKind: "source_connection" as const,
    decisionStrength: "authoritative" as const
  },
  realmId: "module:synthetic-source:account-realm",
  canonicalExternalSubject: "AccountABC",
  accountGeneration: "1",
  verificationEvidence: [evidence],
  verifiedAt: timestamp
};

const capabilityEntry = {
  capabilityId: "core:message-text-send",
  operationId: "core:send",
  contentKindId: "core:text",
  state: "supported" as const,
  referencePortability: "external_thread" as const,
  requiredProviderRoleIds: ["module:synthetic-source:provider-member"],
  validUntil: null,
  diagnostic: null,
  evidence: [evidence]
};

const validBindingInput: z.input<typeof inboxV2SourceThreadBindingSchema> = {
  tenantId,
  id: "source_thread_binding:binding-1",
  externalThread: {
    tenantId,
    kind: "external_thread",
    id: "external_thread:thread-1"
  },
  sourceConnection: accountIdentity.sourceConnection,
  sourceAccount: accountIdentity.sourceAccount,
  accountIdentitySnapshot: accountIdentity,
  bindingGeneration: "1",
  remoteAccess: {
    state: "active",
    evidenceAuthority: "direct_observation",
    revision: "1",
    since: timestamp,
    evidence: [evidence]
  },
  administrative: {
    state: "enabled",
    revision: "1",
    changedAt: timestamp
  },
  runtimeHealth: {
    state: "ready",
    revision: "1",
    checkedAt: timestamp,
    diagnostic: null
  },
  historySync: {
    state: "live",
    revision: "1",
    receiveCursor: "receive-cursor-1",
    historyCursor: "history-cursor-1",
    providerWatermark: "watermark-1",
    lastDurableRawEvent: evidence,
    updatedAt: timestamp,
    diagnostic: null
  },
  providerAccess: {
    revision: "1",
    roleIds: ["module:synthetic-source:provider-member"],
    evidence: [evidence],
    observedAt: timestamp
  },
  capabilities: {
    adapterContract,
    revision: "1",
    capturedAt: timestamp,
    entries: [capabilityEntry]
  },
  routeDescriptor: {
    adapterContract,
    descriptorSchemaId: "module:synthetic-source:group-route",
    descriptorVersion: "v1",
    descriptorRevision: "1",
    destinationKindId: "module:synthetic-source:group-peer",
    destinationSubject: "GroupABC",
    attributes: [],
    descriptorDigestSha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  revision: "1",
  createdAt: timestamp,
  updatedAt: timestamp
};

const _validFenceInput: z.input<typeof inboxV2SourceThreadBindingFenceSchema> =
  {
    accountGeneration: "1",
    bindingGeneration: "1",
    remoteAccessRevision: "1",
    administrativeRevision: "1",
    capabilityRevision: "1",
    routeDescriptorRevision: "1"
  };

const _typedCurrentHead: InboxV2SourceThreadBindingCurrentHead =
  deriveInboxV2SourceThreadBindingCurrentHead(validBindingInput);
const _validCurrentHeadInput: z.input<
  typeof inboxV2SourceThreadBindingCurrentHeadSchema
> = _typedCurrentHead;

const _currentHeadWithRouteDetail: z.input<
  typeof inboxV2SourceThreadBindingCurrentHeadSchema
> = {
  ..._validCurrentHeadInput,
  // @ts-expect-error Compact current heads cannot carry the opaque route descriptor.
  routeDescriptor: validBindingInput.routeDescriptor
};

declare const fence: InboxV2SourceThreadBindingFence;
declare const accountReference: InboxV2SourceAccountReference;
declare const bindingReference: InboxV2SourceThreadBindingReference;
declare const employeeReference: InboxV2EmployeeReference;
declare const providerRoleId: InboxV2ProviderRoleId;

const _remoteState: InboxV2SourceThreadBindingRemoteAccessState = "active";
const _administrativeState: InboxV2SourceThreadBindingAdministrativeState =
  "disabled";
const _runtimeHealth: InboxV2SourceThreadBindingRuntimeHealthState = "degraded";
const _historyState: InboxV2SourceThreadBindingHistorySyncState = "live";
const _capabilityState: InboxV2SourceBindingCapabilityState = "supported";
const _portability: InboxV2SourceReferencePortability = "binding_only";

const _validRemoteTransitionInput: z.input<
  typeof inboxV2SourceThreadBindingTransitionSchema
> = {
  tenantId,
  id: "source_thread_binding_transition:transition-1",
  binding: {
    tenantId,
    kind: "source_thread_binding",
    id: "source_thread_binding:binding-1"
  },
  actor: {
    kind: "trusted_service",
    trustedServiceId: "core:source-runtime"
  },
  reasonId: "core:provider-observation",
  expectedBindingRevision: "1",
  resultingBindingRevision: "2",
  occurredAt: "2026-07-11T09:01:00.000Z",
  kind: "remote_access",
  fromState: "active",
  toState: "left",
  expectedRemoteAccessRevision: "1",
  resultingRemoteAccess: {
    state: "left",
    evidenceAuthority: "authoritative_snapshot",
    revision: "2",
    since: "2026-07-11T09:01:00.000Z",
    evidence: [evidence]
  },
  closedEpisode: {
    tenantId,
    kind: "source_thread_binding_remote_access_episode",
    id: "source_thread_binding_remote_access_episode:episode-1"
  },
  openedEpisode: {
    tenantId,
    kind: "source_thread_binding_remote_access_episode",
    id: "source_thread_binding_remote_access_episode:episode-2"
  },
  evidence: [evidence]
};

const _validAdministrativeTransitionInput: z.input<
  typeof inboxV2SourceThreadBindingTransitionSchema
> = {
  tenantId,
  id: "source_thread_binding_transition:transition-admin-1",
  binding: {
    tenantId,
    kind: "source_thread_binding",
    id: "source_thread_binding:binding-1"
  },
  actor: {
    kind: "employee",
    employee: {
      tenantId,
      kind: "employee",
      id: "employee:employee-1"
    },
    authorizationEpoch: "authorization-epoch-1"
  },
  reasonId: "core:administrative-disable",
  expectedBindingRevision: "1",
  resultingBindingRevision: "2",
  occurredAt: "2026-07-11T09:01:00.000Z",
  kind: "administrative",
  fromState: "enabled",
  toState: "disabled",
  expectedAdministrativeRevision: "1",
  resultingAdministrative: {
    state: "disabled",
    revision: "2",
    changedAt: "2026-07-11T09:01:00.000Z"
  },
  authorizationDecision: {
    decisionKind: "source_thread_binding_administrative",
    tenantId,
    principal: {
      kind: "employee",
      employee: {
        tenantId,
        kind: "employee",
        id: "employee:employee-1"
      }
    },
    target: {
      binding: {
        tenantId,
        kind: "source_thread_binding",
        id: "source_thread_binding:binding-1"
      },
      externalThread: validBindingInput.externalThread,
      sourceAccount: validBindingInput.sourceAccount,
      sourceConnection: validBindingInput.sourceConnection
    },
    effect: "allow",
    requiredPermissionId: "core:source_thread_binding.administrative.update",
    matchedPermissionIds: ["core:source_thread_binding.administrative.update"],
    authorizationEpoch: "authorization-epoch-1",
    decisionRevision: "1",
    decisionToken: "authorization-decision-token-1",
    loadedByTrustedServiceId: "core:authorization",
    decidedAt: timestamp,
    notAfter: "2026-07-11T10:00:00.000Z"
  }
};

const _administrativeTransitionWithBooleanAuthority: z.input<
  typeof inboxV2SourceThreadBindingTransitionSchema
> = {
  ..._validAdministrativeTransitionInput,
  // @ts-expect-error Administrative authority is a server-loaded decision, never a caller boolean.
  authorizationDecision: true
};

// @ts-expect-error Administrative state cannot substitute for remote access.
const _remoteFromAdministrative: InboxV2SourceThreadBindingRemoteAccessState =
  "enabled";

// @ts-expect-error Remote access cannot substitute for administrative state.
const _administrativeFromRemote: InboxV2SourceThreadBindingAdministrativeState =
  "active";

// @ts-expect-error Membership state cannot substitute for runtime health.
const _healthFromRemote: InboxV2SourceThreadBindingRuntimeHealthState = "left";

// @ts-expect-error History synchronization has a closed provider-neutral vocabulary.
const _legacyHistoryState: InboxV2SourceThreadBindingHistorySyncState =
  "syncing";

// @ts-expect-error Coarse V1 capability names are not V2 capability states.
const _legacyCapabilityState: InboxV2SourceBindingCapabilityState = "canReply";

// @ts-expect-error Reference portability is explicit and does not accept vague thread scope.
const _legacyPortability: InboxV2SourceReferencePortability = "thread";

// @ts-expect-error SourceAccount references cannot substitute for binding references.
const _bindingFromAccount: InboxV2SourceThreadBindingReference =
  accountReference;

// @ts-expect-error Binding references cannot substitute for SourceAccount references.
const _accountFromBinding: InboxV2SourceAccountReference = bindingReference;

// @ts-expect-error Provider roles are source evidence, not Employee references.
const _employeeFromProviderRole: InboxV2EmployeeReference = providerRoleId;

// @ts-expect-error Employee references are not provider role catalog IDs.
const _providerRoleFromEmployee: InboxV2ProviderRoleId = employeeReference;

const _numericFenceInput: z.input<
  typeof inboxV2SourceThreadBindingFenceSchema
> = {
  ..._validFenceInput,
  // @ts-expect-error Wire generations/revisions are bigint strings, never numbers.
  accountGeneration: 1
};

const _runtimeHealthInFence: InboxV2SourceThreadBindingFence = {
  ...fence,
  // @ts-expect-error Runtime health is intentionally excluded from the structural route fence.
  runtimeHealthRevision: "1"
};

const _legacyRecipientBindingInput: z.input<
  typeof inboxV2SourceThreadBindingSchema
> = {
  ...validBindingInput,
  // @ts-expect-error V1 sender/client identity is not an outbound binding destination.
  clientExternalId: "legacy-client"
};

const _provisionalBindingInput: z.input<
  typeof inboxV2SourceThreadBindingSchema
> = {
  ...validBindingInput,
  accountIdentitySnapshot: {
    ...accountIdentity,
    // @ts-expect-error A stable SourceThreadBinding requires verified account identity.
    status: "provisional"
  }
};

const _wrongAccountReferenceInput: z.input<
  typeof inboxV2SourceThreadBindingSchema
> = {
  ...validBindingInput,
  // @ts-expect-error A binding reference cannot occupy the SourceAccount field.
  sourceAccount: bindingReference
};

const _remoteTransitionWithAdminPayload: z.input<
  typeof inboxV2SourceThreadBindingTransitionSchema
> = {
  ..._validRemoteTransitionInput,
  // @ts-expect-error Remote provider observations cannot carry an administrative mutation.
  resultingAdministrative: {
    state: "disabled",
    revision: "2",
    changedAt: "2026-07-11T09:01:00.000Z"
  }
};
