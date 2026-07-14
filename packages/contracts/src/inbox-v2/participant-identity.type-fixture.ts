import type { z } from "zod";

import type { InboxV2EntityRevision } from "./entity-metadata";
import type {
  InboxV2AuthExternalIdentityLinkId,
  InboxV2AuthExternalIdentityLinkReference,
  InboxV2ClientReference,
  InboxV2ConversationParticipantId,
  InboxV2EmployeeReference,
  InboxV2ParticipantMembershipEpisodeId,
  InboxV2ParticipantMembershipTransitionId,
  InboxV2SourceExternalIdentityId,
  InboxV2SourceExternalIdentityReference,
  InboxV2SourceIdentityClaimId,
  InboxV2SourceIdentityClaimReference,
  InboxV2SourceIdentityClaimTransitionId
} from "./ids";
import type {
  InboxV2ConversationParticipantSubject,
  InboxV2ParticipantMembershipRole,
  InboxV2ParticipantMembershipState,
  InboxV2SourceIdentityClaimTarget,
  InboxV2SourceIdentityClaimVersion,
  InboxV2SourceIdentityResolution
} from "./participant-identity";
import {
  inboxV2ConversationParticipantSchema,
  inboxV2ParticipantAuthorObservationSchema,
  inboxV2ParticipantMembershipTransitionSchema,
  inboxV2ProviderRosterMemberEvidenceSchema,
  inboxV2SourceExternalIdentitySchema,
  inboxV2SourceIdentityClaimSchema,
  inboxV2SourceIdentityClaimTransitionSchema
} from "./participant-identity";

declare const authExternalIdentityLinkId: InboxV2AuthExternalIdentityLinkId;
declare const authExternalIdentityLinkReference: InboxV2AuthExternalIdentityLinkReference;
declare const sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
declare const sourceExternalIdentityReference: InboxV2SourceExternalIdentityReference;
declare const sourceIdentityClaimId: InboxV2SourceIdentityClaimId;
declare const sourceIdentityClaimReference: InboxV2SourceIdentityClaimReference;
declare const participantId: InboxV2ConversationParticipantId;
declare const membershipEpisodeId: InboxV2ParticipantMembershipEpisodeId;
declare const membershipTransitionId: InboxV2ParticipantMembershipTransitionId;
declare const claimTransitionId: InboxV2SourceIdentityClaimTransitionId;
declare const employeeReference: InboxV2EmployeeReference;
declare const clientReference: InboxV2ClientReference;
declare const entityRevision: InboxV2EntityRevision;
declare const claimVersion: InboxV2SourceIdentityClaimVersion;

const _employeeSubject: InboxV2ConversationParticipantSubject = {
  kind: "employee",
  employee: employeeReference
};
const _sourceSubject: InboxV2ConversationParticipantSubject = {
  kind: "source_external_identity",
  sourceExternalIdentity: sourceExternalIdentityReference
};
const _unresolvedResolution: InboxV2SourceIdentityResolution = {
  status: "unresolved"
};
const _claimedResolution: InboxV2SourceIdentityResolution = {
  status: "claimed",
  activeClaim: sourceIdentityClaimReference
};

const _validSourceIdentityInput: z.input<
  typeof inboxV2SourceExternalIdentitySchema
> = {
  tenantId: "tenant:tenant-1",
  id: "source_external_identity:identity-1",
  realm: {
    realmId: "module:telegram-user-session:mtproto-user",
    version: "v1",
    canonicalizationVersion: "v1"
  },
  objectKindId: "module:telegram-user-session:provider-user",
  scope: {
    kind: "source_account",
    owner: {
      tenantId: "tenant:tenant-1",
      kind: "source_account",
      id: "source_account:account-1"
    }
  },
  identityDeclaration: {
    adapterContract: {
      contractId: "module:telegram-user-session:identity-contract",
      contractVersion: "v1",
      declarationRevision: "1",
      surfaceId: "module:telegram-user-session:mtproto",
      loadedByTrustedServiceId: "core:inbox-worker",
      loadedAt: "2026-07-11T09:00:00.000Z"
    },
    identityKind: "source_external_identity",
    realmId: "module:telegram-user-session:mtproto-user",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:telegram-user-session:provider-user",
    scopeKind: "source_account",
    decisionStrength: "safe_default"
  },
  materializationAuthority: {
    kind: "trusted_service",
    tenantId: "tenant:tenant-1",
    trustedServiceId: "core:inbox-worker",
    authorizationToken: "identity-create-1",
    authorizedAt: "2026-07-11T09:00:00.000Z"
  },
  materializedAt: "2026-07-11T09:00:00.000Z",
  canonicalExternalSubject: "ProviderUserABC",
  stability: { kind: "stable" },
  resolution: { status: "unresolved" },
  latestClaimVersion: null,
  revision: "1",
  createdAt: "2026-07-11T09:00:00.000Z",
  updatedAt: "2026-07-11T09:00:00.000Z"
};

const _validParticipantInput: z.input<
  typeof inboxV2ConversationParticipantSchema
> = {
  tenantId: "tenant:tenant-1",
  id: "conversation_participant:participant-1",
  conversation: {
    tenantId: "tenant:tenant-1",
    kind: "conversation",
    id: "conversation:conversation-1"
  },
  subject: {
    kind: "source_external_identity",
    sourceExternalIdentity: {
      tenantId: "tenant:tenant-1",
      kind: "source_external_identity",
      id: "source_external_identity:identity-1"
    }
  },
  revision: "1",
  createdAt: "2026-07-11T09:00:00.000Z",
  updatedAt: "2026-07-11T09:00:00.000Z"
};

const _validMembershipTransitionInput: z.input<
  typeof inboxV2ParticipantMembershipTransitionSchema
> = {
  tenantId: "tenant:tenant-1",
  id: "participant_membership_transition:transition-1",
  episode: {
    tenantId: "tenant:tenant-1",
    kind: "participant_membership_episode",
    id: "participant_membership_episode:episode-1"
  },
  intent: "initial_active",
  fromState: null,
  toState: "active",
  fromRole: null,
  toRole: "member",
  cause: {
    kind: "hulee_internal_command",
    actorEmployee: {
      tenantId: "tenant:tenant-1",
      kind: "employee",
      id: "employee:employee-1"
    }
  },
  reasonCodeId: "core:conversation-created",
  expectedRevision: null,
  currentRevision: null,
  resultingRevision: "1",
  occurredAt: "2026-07-11T09:00:00.000Z"
};

const _validRosterMemberEvidenceInput: z.input<
  typeof inboxV2ProviderRosterMemberEvidenceSchema
> = {
  tenantId: "tenant:tenant-1",
  id: "provider_roster_member_evidence:member-1",
  rosterEvidence: {
    tenantId: "tenant:tenant-1",
    kind: "provider_roster_evidence",
    id: "provider_roster_evidence:evidence-1"
  },
  sourceExternalIdentity: {
    tenantId: "tenant:tenant-1",
    kind: "source_external_identity",
    id: "source_external_identity:identity-1"
  },
  state: "present",
  normalizedRole: "admin",
  providerStateCode: "ParticipantActive",
  providerRoleCode: "GroupAdministrator",
  observedAt: "2026-07-11T09:00:00.000Z",
  revision: "1"
};

const _validClaimTransitionInput: z.input<
  typeof inboxV2SourceIdentityClaimTransitionSchema
> = {
  tenantId: "tenant:tenant-1",
  id: "source_identity_claim_transition:transition-1",
  sourceExternalIdentity: {
    tenantId: "tenant:tenant-1",
    kind: "source_external_identity",
    id: "source_external_identity:identity-1"
  },
  operation: {
    kind: "claim_employee",
    target: {
      kind: "employee",
      employee: {
        tenantId: "tenant:tenant-1",
        kind: "employee",
        id: "employee:employee-1"
      }
    },
    previousClaim: null,
    resultingClaim: {
      tenantId: "tenant:tenant-1",
      kind: "source_identity_claim",
      id: "source_identity_claim:claim-1"
    }
  },
  decision: {
    kind: "manual",
    actorEmployee: {
      tenantId: "tenant:tenant-1",
      kind: "employee",
      id: "employee:employee-2"
    },
    reviewState: "approved"
  },
  policyId: "core:verified-source-identity",
  policyVersion: "v1",
  reasonCodeId: "core:operator-reviewed",
  expectedVersion: null,
  currentVersion: null,
  resultingVersion: "1",
  occurredAt: "2026-07-11T09:00:00.000Z"
};

// @ts-expect-error Authentication identity-link IDs cannot substitute for source identity IDs.
const _sourceIdFromAuthId: InboxV2SourceExternalIdentityId =
  authExternalIdentityLinkId;

// @ts-expect-error Source identity IDs cannot substitute for authentication identity-link IDs.
const _authIdFromSourceId: InboxV2AuthExternalIdentityLinkId =
  sourceExternalIdentityId;

// @ts-expect-error Membership episode IDs cannot substitute for transition IDs.
const _membershipTransitionFromEpisode: InboxV2ParticipantMembershipTransitionId =
  membershipEpisodeId;

// @ts-expect-error Membership transition IDs cannot substitute for episode IDs.
const _membershipEpisodeFromTransition: InboxV2ParticipantMembershipEpisodeId =
  membershipTransitionId;

// @ts-expect-error Claim IDs cannot substitute for append-only claim-transition IDs.
const _claimTransitionFromClaim: InboxV2SourceIdentityClaimTransitionId =
  sourceIdentityClaimId;

// @ts-expect-error Claim-transition IDs cannot substitute for claim IDs.
const _claimFromTransition: InboxV2SourceIdentityClaimId = claimTransitionId;

// @ts-expect-error Authentication identity links cannot be participant subjects.
const _subjectFromAuthLink: InboxV2ConversationParticipantSubject =
  authExternalIdentityLinkReference;

// @ts-expect-error CRM Client records cannot be participant subjects.
const _subjectFromClient: InboxV2ConversationParticipantSubject =
  clientReference;

// @ts-expect-error CRM Client records cannot be source identity claim targets.
const _claimTargetFromClient: InboxV2SourceIdentityClaimTarget =
  clientReference;

// @ts-expect-error Claimed resolution requires the exact active claim reference.
const _claimedWithoutClaim: InboxV2SourceIdentityResolution = {
  status: "claimed"
};

// @ts-expect-error Participant membership does not use observation evidence as a lifecycle state.
const _observedMembershipState: InboxV2ParticipantMembershipState = "observed";

// @ts-expect-error Provider-specific roles are not normalized core membership roles.
const _providerRole: InboxV2ParticipantMembershipRole = "provider_owner";

// @ts-expect-error Entity revisions and identity-claim versions are distinct brands.
const _claimVersionFromEntityRevision: InboxV2SourceIdentityClaimVersion =
  entityRevision;

// @ts-expect-error Identity-claim versions cannot substitute for entity revisions.
const _entityRevisionFromClaimVersion: InboxV2EntityRevision = claimVersion;

const _invalidProviderScope: z.input<
  typeof inboxV2SourceExternalIdentitySchema
> = {
  ..._validSourceIdentityInput,
  scope: {
    kind: "provider",
    // @ts-expect-error Provider-scoped identity keys have no account/connection owner.
    owner: {
      tenantId: "tenant:tenant-1",
      kind: "source_account",
      id: "source_account:account-1"
    }
  }
};

const _invalidNumericClaimVersion: z.input<
  typeof inboxV2SourceIdentityClaimSchema
> = {
  tenantId: "tenant:tenant-1",
  id: "source_identity_claim:claim-1",
  sourceExternalIdentity: {
    tenantId: "tenant:tenant-1",
    kind: "source_external_identity",
    id: "source_external_identity:identity-1"
  },
  previousClaimVersion: null,
  // @ts-expect-error Claim versions are decimal strings, never JS numbers.
  claimVersion: 1,
  target: {
    kind: "employee",
    employee: {
      tenantId: "tenant:tenant-1",
      kind: "employee",
      id: "employee:employee-1"
    }
  },
  status: "active",
  confidence: "verified",
  evidenceReferences: [
    {
      kind: "raw_inbound_event",
      reference: {
        tenantId: "tenant:tenant-1",
        kind: "raw_inbound_event",
        id: "raw_inbound_event:event-1"
      }
    }
  ],
  policyId: "core:verified-source-identity",
  policyVersion: "v1",
  reasonCodeId: "core:operator-reviewed",
  decision: {
    kind: "manual",
    actorEmployee: {
      tenantId: "tenant:tenant-1",
      kind: "employee",
      id: "employee:employee-2"
    },
    reviewState: "approved"
  },
  createdAt: "2026-07-11T09:00:00.000Z",
  revocation: null,
  revision: "1"
};

const _invalidParticipantAuthorityField: z.input<
  typeof inboxV2ConversationParticipantSchema
> = {
  ..._validParticipantInput,
  // @ts-expect-error A participant is not an authorization principal.
  permissions: ["conversation.internal.read"]
};

const _invalidMembershipTransitionIntent: z.input<
  typeof inboxV2ParticipantMembershipTransitionSchema
> = {
  ..._validMembershipTransitionInput,
  // @ts-expect-error Observation evidence is not a membership transition intent.
  intent: "observed"
};

const _invalidProviderNormalizedRole: z.input<
  typeof inboxV2ProviderRosterMemberEvidenceSchema
> = {
  ..._validRosterMemberEvidenceInput,
  // @ts-expect-error Provider-specific roles stay opaque and cannot enter the normalized role enum.
  normalizedRole: "provider_owner"
};

const _invalidClaimOperationTarget: z.input<
  typeof inboxV2SourceIdentityClaimTransitionSchema
> = {
  ..._validClaimTransitionInput,
  operation: {
    kind: "claim_employee",
    target: {
      kind: "client_contact",
      // @ts-expect-error Employee-claim operations cannot carry ClientContact targets.
      clientContact: {
        tenantId: "tenant:tenant-1",
        kind: "client_contact",
        id: "client_contact:contact-1"
      }
    } as const,
    previousClaim: null,
    resultingClaim: {
      tenantId: "tenant:tenant-1",
      kind: "source_identity_claim",
      id: "source_identity_claim:claim-1"
    }
  }
};

const _invalidNumericClaimTransitionVersion: z.input<
  typeof inboxV2SourceIdentityClaimTransitionSchema
> = {
  ..._validClaimTransitionInput,
  // @ts-expect-error CAS versions are decimal strings, never JS numbers.
  resultingVersion: 1
};

const _invalidObservationMembershipField: z.input<
  typeof inboxV2ParticipantAuthorObservationSchema
> = {
  tenantId: "tenant:tenant-1",
  id: "participant_author_observation:observation-1",
  participant: {
    tenantId: "tenant:tenant-1",
    kind: "conversation_participant",
    id: participantId
  },
  sourceOccurrence: {
    tenantId: "tenant:tenant-1",
    kind: "source_occurrence",
    id: "source_occurrence:occurrence-1"
  },
  evidenceClassification: "observed",
  observedAt: "2026-07-11T09:00:00.000Z",
  revision: "1",
  // @ts-expect-error Authorship observation is not a membership episode.
  state: "active"
};
