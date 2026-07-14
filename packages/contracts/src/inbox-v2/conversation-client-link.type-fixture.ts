import type { z } from "zod";

import type { InboxV2EntityRevision } from "./entity-metadata";
import type {
  InboxV2AccountReference,
  InboxV2ClientContactReference,
  InboxV2ClientId,
  InboxV2ClientReference,
  InboxV2ConversationClientLinkId,
  InboxV2ConversationClientLinkReference,
  InboxV2ConversationClientLinkTransitionId,
  InboxV2ConversationId,
  InboxV2ConversationReference,
  InboxV2EmployeeReference,
  InboxV2SourceIdentityClaimReference
} from "./ids";
import type {
  InboxV2ConversationClientAssociationConfidence,
  InboxV2ConversationClientLinkActor,
  InboxV2ConversationClientLinkMigrationProvenanceId,
  InboxV2ConversationClientLinkPolicyId,
  InboxV2ConversationClientLinkProvenance,
  InboxV2ConversationClientLinkReasonId,
  InboxV2ConversationClientRoleId
} from "./conversation-client-link";
import {
  INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
  INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
  inboxV2ConversationClientCurrentLinkPageSchema,
  inboxV2ConversationClientLinkEnvelopeSchema,
  inboxV2ConversationClientLinkHistoryFixtureSchema,
  inboxV2ConversationClientLinkSchema,
  inboxV2ConversationClientLinkSetHeadSchema,
  inboxV2ConversationClientLinkTransitionSchema,
  inboxV2ConversationClientVerifiedEvidenceSchema
} from "./conversation-client-link";

declare const accountReference: InboxV2AccountReference;
declare const clientContactReference: InboxV2ClientContactReference;
declare const clientId: InboxV2ClientId;
declare const clientReference: InboxV2ClientReference;
declare const conversationId: InboxV2ConversationId;
declare const conversationReference: InboxV2ConversationReference;
declare const employeeReference: InboxV2EmployeeReference;
declare const entityRevision: InboxV2EntityRevision;
declare const linkId: InboxV2ConversationClientLinkId;
declare const linkReference: InboxV2ConversationClientLinkReference;
declare const linkTransitionId: InboxV2ConversationClientLinkTransitionId;
declare const migrationProvenanceId: InboxV2ConversationClientLinkMigrationProvenanceId;
declare const policyId: InboxV2ConversationClientLinkPolicyId;
declare const reasonId: InboxV2ConversationClientLinkReasonId;
declare const roleId: InboxV2ConversationClientRoleId;
declare const sourceIdentityClaimReference: InboxV2SourceIdentityClaimReference;
declare const verifiedEvidence: z.output<
  typeof inboxV2ConversationClientVerifiedEvidenceSchema
>;

const _validLinkInput: z.input<typeof inboxV2ConversationClientLinkSchema> = {
  tenantId: "tenant:tenant-1",
  id: "conversation_client_link:link-1",
  conversation: {
    tenantId: "tenant:tenant-1",
    kind: "conversation",
    id: "conversation:conversation-1"
  },
  client: {
    tenantId: "tenant:tenant-1",
    kind: "client",
    id: "client:client-1"
  },
  roleIds: ["core:subject"],
  associationConfidence: "confirmed",
  provenance: { kind: "manual" },
  auditEvidenceReferences: [],
  linkedBy: {
    actor: {
      kind: "employee",
      employee: {
        tenantId: "tenant:tenant-1",
        kind: "employee",
        id: "employee:employee-1"
      }
    },
    policyId: "core:manual-client-link",
    policyVersion: "v1",
    reasonCodeId: "core:operator-linked-client",
    policyAuthority: null
  },
  validFrom: "2026-07-11T09:00:00.000Z",
  validFromBasis: "known_effective",
  state: "active",
  termination: null,
  revision: "1"
};

const _validVerifiedEvidenceInput: z.input<
  typeof inboxV2ConversationClientVerifiedEvidenceSchema
> = {
  tenantId: "tenant:tenant-1",
  conversation: _validLinkInput.conversation,
  client: _validLinkInput.client,
  policyId: "core:verified-client-resolution",
  policyVersion: "v1",
  verifiedByTrustedServiceId: "core:client-link-resolver",
  verifiedAt: "2026-07-11T09:00:00.000Z",
  policyAuthority: {
    family: "conversation_client_link",
    definitionContractVersion: "v1",
    definitionDigestSha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    activationHeadRevision: "1"
  },
  evidenceReferences: [
    {
      kind: "normalized_inbound_event",
      reference: {
        tenantId: "tenant:tenant-1",
        kind: "normalized_inbound_event",
        id: "normalized_inbound_event:event-1"
      }
    }
  ]
};

const _validTrustedPolicyLinkInput: z.input<
  typeof inboxV2ConversationClientLinkSchema
> = {
  ..._validLinkInput,
  provenance: {
    kind: "trusted_policy",
    verification: _validVerifiedEvidenceInput
  },
  auditEvidenceReferences: [
    {
      kind: "normalized_inbound_event",
      reference: {
        tenantId: "tenant:tenant-1",
        kind: "normalized_inbound_event",
        id: "normalized_inbound_event:event-1"
      }
    }
  ],
  linkedBy: {
    actor: {
      kind: "trusted_service",
      trustedServiceId: "core:client-link-resolver"
    },
    policyId: "core:verified-client-resolution",
    policyVersion: "v1",
    reasonCodeId: "core:verified-source-evidence",
    policyAuthority: _validVerifiedEvidenceInput.policyAuthority
  }
};

const _validHeadInput: z.input<
  typeof inboxV2ConversationClientLinkSetHeadSchema
> = {
  tenantId: "tenant:tenant-1",
  conversation: {
    tenantId: "tenant:tenant-1",
    kind: "conversation",
    id: "conversation:conversation-1"
  },
  primaryLink: {
    tenantId: "tenant:tenant-1",
    kind: "conversation_client_link",
    id: "conversation_client_link:link-1"
  },
  revision: "1",
  updatedAt: "2026-07-11T09:00:00.000Z"
};

const _validTransitionInput: z.input<
  typeof inboxV2ConversationClientLinkTransitionSchema
> = {
  tenantId: "tenant:tenant-1",
  id: "conversation_client_link_transition:transition-1",
  conversation: {
    tenantId: "tenant:tenant-1",
    kind: "conversation",
    id: "conversation:conversation-1"
  },
  operations: [
    {
      kind: "create_link",
      link: {
        tenantId: "tenant:tenant-1",
        kind: "conversation_client_link",
        id: "conversation_client_link:link-1"
      }
    }
  ],
  previousPrimaryLink: null,
  resultingPrimaryLink: {
    tenantId: "tenant:tenant-1",
    kind: "conversation_client_link",
    id: "conversation_client_link:link-1"
  },
  decision: _validLinkInput.linkedBy,
  expectedRevision: null,
  currentRevision: null,
  resultingRevision: "1",
  occurredAt: "2026-07-11T09:00:00.000Z"
};

const _validHistoryFixtureInput: z.input<
  typeof inboxV2ConversationClientLinkHistoryFixtureSchema
> = {
  conversation: _validLinkInput.conversation,
  head: _validHeadInput,
  links: [_validLinkInput],
  transitions: [_validTransitionInput]
};

const _validCurrentLinkPageInput: z.input<
  typeof inboxV2ConversationClientCurrentLinkPageSchema
> = {
  conversation: _validLinkInput.conversation,
  linkSetHead: _validHeadInput,
  linkSetRevision: "1",
  links: [_validLinkInput]
};

const _validEnvelopeInput: z.input<
  typeof inboxV2ConversationClientLinkEnvelopeSchema
> = {
  schemaId: INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
  schemaVersion: INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
  payload: _validLinkInput
};

const _employeeActor: InboxV2ConversationClientLinkActor = {
  kind: "employee",
  employee: employeeReference
};
const _manualProvenance: InboxV2ConversationClientLinkProvenance = {
  kind: "manual"
};
const _claimProvenance: InboxV2ConversationClientLinkProvenance = {
  kind: "source_identity_claim",
  claim: sourceIdentityClaimReference,
  verification: verifiedEvidence
};
const _confidence: InboxV2ConversationClientAssociationConfidence = "confirmed";

// @ts-expect-error Link IDs cannot substitute for link-transition IDs.
const _transitionIdFromLinkId: InboxV2ConversationClientLinkTransitionId =
  linkId;

// @ts-expect-error Link-transition IDs cannot substitute for link IDs.
const _linkIdFromTransitionId: InboxV2ConversationClientLinkId =
  linkTransitionId;

// @ts-expect-error Conversation IDs cannot substitute for link IDs.
const _linkIdFromConversationId: InboxV2ConversationClientLinkId =
  conversationId;

// @ts-expect-error Client IDs cannot substitute for Conversation IDs.
const _conversationIdFromClientId: InboxV2ConversationId = clientId;

// @ts-expect-error Role and policy catalogs remain distinct brands.
const _policyFromRole: InboxV2ConversationClientLinkPolicyId = roleId;

// @ts-expect-error Policy and reason catalogs remain distinct brands.
const _reasonFromPolicy: InboxV2ConversationClientLinkReasonId = policyId;

// @ts-expect-error Migration provenance and role catalogs remain distinct brands.
const _roleFromMigration: InboxV2ConversationClientRoleId =
  migrationProvenanceId;

// @ts-expect-error Entity revisions cannot substitute for link role IDs.
const _roleFromRevision: InboxV2ConversationClientRoleId = entityRevision;

// @ts-expect-error Confidence is a closed provider-neutral vocabulary.
const _providerConfidence: InboxV2ConversationClientAssociationConfidence =
  "provider_verified";

const _invalidEmployeeActor: InboxV2ConversationClientLinkActor = {
  kind: "employee",
  // @ts-expect-error A Client is not a server-stamped Employee actor.
  employee: clientReference
};

const _invalidAccountActor: InboxV2ConversationClientLinkActor = {
  kind: "employee",
  // @ts-expect-error An Account reference is not an Employee actor reference.
  employee: accountReference
};

const _invalidClaimProvenance: InboxV2ConversationClientLinkProvenance = {
  kind: "source_identity_claim",
  // @ts-expect-error Claim provenance requires an exact claim reference.
  claim: clientContactReference,
  verification: verifiedEvidence
};

const _invalidVerifiedClientInput: z.input<
  typeof inboxV2ConversationClientVerifiedEvidenceSchema
> = {
  ..._validVerifiedEvidenceInput,
  client: {
    tenantId: "tenant:tenant-1",
    // @ts-expect-error Verified link evidence targets Client, not ClientContact.
    kind: "client_contact",
    id: "client_contact:contact-1"
  }
};

const _invalidClientInput: z.input<typeof inboxV2ConversationClientLinkSchema> =
  {
    ..._validLinkInput,
    client: {
      tenantId: "tenant:tenant-1",
      // @ts-expect-error Conversation-Client links target Client, not ClientContact.
      kind: "client_contact",
      id: "client_contact:contact-1"
    }
  };

const _invalidNumericRevisionInput: z.input<
  typeof inboxV2ConversationClientLinkSchema
> = {
  ..._validLinkInput,
  // @ts-expect-error Entity revisions are canonical decimal strings.
  revision: 1
};

const _invalidDateInput: z.input<typeof inboxV2ConversationClientLinkSchema> = {
  ..._validLinkInput,
  // @ts-expect-error Contract timestamps are RFC3339 strings, not Date objects.
  validFrom: new Date()
};

const _invalidScalarClientInput: z.input<
  typeof inboxV2ConversationClientLinkSchema
> = {
  ..._validLinkInput,
  // @ts-expect-error Scalar Client fields do not belong to link episodes.
  clientId: "client:client-1"
};

const _invalidPrimaryFlagInput: z.input<
  typeof inboxV2ConversationClientLinkSchema
> = {
  ..._validLinkInput,
  // @ts-expect-error Primary selection belongs to the set head.
  isPrimary: true
};

const _invalidAuthorityInput: z.input<
  typeof inboxV2ConversationClientLinkSchema
> = {
  ..._validLinkInput,
  // @ts-expect-error Link facts do not embed authorization grants.
  permissions: ["client.link.manage"]
};

const _invalidRouteInput: z.input<typeof inboxV2ConversationClientLinkSchema> =
  {
    ..._validLinkInput,
    // @ts-expect-error Conversation-Client links do not own transport routes.
    outboundRouteId: "outbound_route:route-1"
  };

const _invalidHeadReferenceInput: z.input<
  typeof inboxV2ConversationClientLinkSetHeadSchema
> = {
  ..._validHeadInput,
  // @ts-expect-error Primary pointer requires a link reference, not Client.
  primaryLink: clientReference
};

const _invalidTransitionOperationInput: z.input<
  typeof inboxV2ConversationClientLinkTransitionSchema
> = {
  ..._validTransitionInput,
  operations: [
    {
      kind: "create_link",
      // @ts-expect-error Link-set operations require a link reference.
      link: clientReference
    }
  ]
};

const _invalidTransitionRevisionInput: z.input<
  typeof inboxV2ConversationClientLinkTransitionSchema
> = {
  ..._validTransitionInput,
  // @ts-expect-error CAS revisions are decimal strings, never JS numbers.
  resultingRevision: 1
};

const _invalidHistoryFixtureScalarInput: z.input<
  typeof inboxV2ConversationClientLinkHistoryFixtureSchema
> = {
  ..._validHistoryFixtureInput,
  // @ts-expect-error History fixture serializes zero-to-many links, not one Client scalar.
  clientId: "client:client-1"
};

const _invalidCurrentLinkPageHistoryInput: z.input<
  typeof inboxV2ConversationClientCurrentLinkPageSchema
> = {
  ..._validCurrentLinkPageInput,
  // @ts-expect-error Runtime current pages never carry unbounded transition history.
  transitions: [_validTransitionInput]
};

const _invalidEnvelopeVersion: z.input<
  typeof inboxV2ConversationClientLinkEnvelopeSchema
> = {
  ..._validEnvelopeInput,
  // @ts-expect-error Envelope supports only its exact schema-version literal.
  schemaVersion: "v2"
};

const _invalidEnvelopeId: z.input<
  typeof inboxV2ConversationClientLinkEnvelopeSchema
> = {
  ..._validEnvelopeInput,
  // @ts-expect-error Envelope binds one exact schema ID.
  schemaId: "core:inbox-v2.conversation-client-link-set-head"
};

// @ts-expect-error Conversation references cannot substitute for link references.
const _linkReferenceFromConversation: InboxV2ConversationClientLinkReference =
  conversationReference;

// @ts-expect-error The unbounded LinkGraph runtime surface was removed.
import type { InboxV2ConversationClientLinkGraph as _RemovedLinkGraph } from "./conversation-client-link";

// @ts-expect-error The unbounded LinkGraph schema was replaced by CurrentLinkPage and HistoryFixture schemas.
import { inboxV2ConversationClientLinkGraphSchema as _removedLinkGraphSchema } from "./conversation-client-link";

void reasonId;
void linkReference;
