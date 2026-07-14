import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import { inboxV2ConversationSchema } from "./conversation";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2BotIdentityReferenceSchema,
  inboxV2ClientContactReferenceSchema,
  inboxV2ConversationParticipantIdSchema,
  inboxV2ConversationParticipantReferenceSchema,
  inboxV2ConversationReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2ParticipantAuthorObservationIdSchema,
  inboxV2ParticipantMembershipEpisodeIdSchema,
  inboxV2ParticipantMembershipEpisodeReferenceSchema,
  inboxV2ParticipantMembershipTransitionIdSchema,
  inboxV2ProviderRosterEvidenceIdSchema,
  inboxV2ProviderRosterEvidenceReferenceSchema,
  inboxV2ProviderRosterMemberEvidenceIdSchema,
  inboxV2ProviderRosterMemberEvidenceReferenceSchema,
  inboxV2RawInboundEventReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceExternalIdentityReferenceSchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceIdentityClaimReferenceSchema,
  inboxV2SourceIdentityClaimTransitionIdSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  inboxV2AdapterIdentityDeclarationSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  type InboxV2AdapterIdentityDeclaration
} from "./source-routing-primitives";

export const INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID =
  "core:inbox-v2.source-external-identity" as const;
export const INBOX_V2_CONVERSATION_PARTICIPANT_SCHEMA_ID =
  "core:inbox-v2.conversation-participant" as const;
export const INBOX_V2_PARTICIPANT_MEMBERSHIP_EPISODE_SCHEMA_ID =
  "core:inbox-v2.participant-membership-episode" as const;
export const INBOX_V2_PARTICIPANT_MEMBERSHIP_TRANSITION_SCHEMA_ID =
  "core:inbox-v2.participant-membership-transition" as const;
export const INBOX_V2_PARTICIPANT_AUTHOR_OBSERVATION_SCHEMA_ID =
  "core:inbox-v2.participant-author-observation" as const;
export const INBOX_V2_PROVIDER_ROSTER_EVIDENCE_SCHEMA_ID =
  "core:inbox-v2.provider-roster-evidence" as const;
export const INBOX_V2_PROVIDER_ROSTER_MEMBER_EVIDENCE_SCHEMA_ID =
  "core:inbox-v2.provider-roster-member-evidence" as const;
export const INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID =
  "core:inbox-v2.source-identity-claim" as const;
export const INBOX_V2_SOURCE_IDENTITY_CLAIM_TRANSITION_SCHEMA_ID =
  "core:inbox-v2.source-identity-claim-transition" as const;
export const INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_SOURCE_IDENTITY_REALM_CATALOG =
  "source-identity-realm" as const;
export const INBOX_V2_SOURCE_IDENTITY_OBJECT_KIND_CATALOG =
  "source-identity-object-kind" as const;
export const INBOX_V2_PARTICIPANT_SYSTEM_ACTOR_CATALOG =
  "participant-system-actor" as const;
export const INBOX_V2_LEGACY_PARTICIPANT_PROVENANCE_CATALOG =
  "legacy-participant-provenance" as const;
export const INBOX_V2_PARTICIPANT_MEMBERSHIP_POLICY_CATALOG =
  "participant-membership-policy" as const;
export const INBOX_V2_PARTICIPANT_MEMBERSHIP_REASON_CATALOG =
  "participant-membership-reason" as const;
export const INBOX_V2_IDENTITY_CLAIM_POLICY_CATALOG =
  "identity-claim-policy" as const;
export const INBOX_V2_IDENTITY_CLAIM_REASON_CATALOG =
  "identity-claim-reason" as const;
export const INBOX_V2_TRUSTED_SERVICE_CATALOG = "trusted-service" as const;

export type InboxV2SourceIdentityRealmId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_IDENTITY_REALM_CATALOG
>;
export type InboxV2SourceIdentityObjectKindId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_IDENTITY_OBJECT_KIND_CATALOG
>;
export type InboxV2ParticipantSystemActorId = InboxV2CatalogId<
  typeof INBOX_V2_PARTICIPANT_SYSTEM_ACTOR_CATALOG
>;
export type InboxV2LegacyParticipantProvenanceId = InboxV2CatalogId<
  typeof INBOX_V2_LEGACY_PARTICIPANT_PROVENANCE_CATALOG
>;
export type InboxV2ParticipantMembershipPolicyId = InboxV2CatalogId<
  typeof INBOX_V2_PARTICIPANT_MEMBERSHIP_POLICY_CATALOG
>;
export type InboxV2ParticipantMembershipReasonId = InboxV2CatalogId<
  typeof INBOX_V2_PARTICIPANT_MEMBERSHIP_REASON_CATALOG
>;
export type InboxV2IdentityClaimPolicyId = InboxV2CatalogId<
  typeof INBOX_V2_IDENTITY_CLAIM_POLICY_CATALOG
>;
export type InboxV2IdentityClaimReasonId = InboxV2CatalogId<
  typeof INBOX_V2_IDENTITY_CLAIM_REASON_CATALOG
>;
export type InboxV2TrustedServiceId = InboxV2CatalogId<
  typeof INBOX_V2_TRUSTED_SERVICE_CATALOG
>;
export type InboxV2SourceIdentityClaimVersion = Brand<
  string,
  "InboxV2SourceIdentityClaimVersion"
>;

export const inboxV2SourceIdentityRealmIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2SourceIdentityRealmId
  );
export const inboxV2SourceIdentityObjectKindIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2SourceIdentityObjectKindId
  );
export const inboxV2ParticipantSystemActorIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ParticipantSystemActorId
  );
export const inboxV2LegacyParticipantProvenanceIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2LegacyParticipantProvenanceId
  );
export const inboxV2ParticipantMembershipPolicyIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ParticipantMembershipPolicyId
  );
export const inboxV2ParticipantMembershipReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ParticipantMembershipReasonId
  );
export const inboxV2IdentityClaimPolicyIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2IdentityClaimPolicyId
  );
export const inboxV2IdentityClaimReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2IdentityClaimReasonId
  );
export const inboxV2TrustedServiceIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2TrustedServiceId
);
export const inboxV2SourceIdentityClaimVersionSchema =
  inboxV2EntityRevisionSchema.transform(
    (value) => value as unknown as InboxV2SourceIdentityClaimVersion
  );

const inboxV2OpaqueExternalIdentityValueSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(hasNoAsciiControlCharacters, {
    message: "Opaque provider value cannot contain ASCII control characters."
  })
  .refine(hasOnlyUnicodeScalarValues, {
    message:
      "Opaque provider value cannot contain an unpaired UTF-16 surrogate."
  });

const inboxV2SourceIdentityScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("provider") }).strict(),
  z
    .object({
      kind: z.literal("source_connection"),
      owner: inboxV2SourceConnectionReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("source_account"),
      owner: inboxV2SourceAccountReferenceSchema
    })
    .strict()
]);

const inboxV2SourceIdentityObservationReferenceSchema = z.union([
  inboxV2RawInboundEventReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema
]);

const inboxV2SourceIdentityStabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stable") }).strict(),
  z
    .object({
      kind: z.literal("observation_ephemeral"),
      observation: inboxV2SourceIdentityObservationReferenceSchema,
      observationKey: inboxV2OpaqueExternalIdentityValueSchema
    })
    .strict()
]);

export const inboxV2SourceIdentityMaterializationAuthoritySchema = z
  .object({
    kind: z.literal("trusted_service"),
    tenantId: inboxV2TenantIdSchema,
    trustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    authorizationToken: inboxV2RoutingTokenSchema,
    authorizedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2SourceIdentityResolutionSchema = z.discriminatedUnion(
  "status",
  [
    z.object({ status: z.literal("unresolved") }).strict(),
    z
      .object({
        status: z.literal("claimed"),
        activeClaim: inboxV2SourceIdentityClaimReferenceSchema
      })
      .strict(),
    z.object({ status: z.literal("conflicted") }).strict()
  ]
);

export const inboxV2SourceExternalIdentitySchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2SourceExternalIdentityIdSchema,
    realm: z
      .object({
        realmId: inboxV2SourceIdentityRealmIdSchema,
        version: inboxV2SchemaVersionTokenSchema,
        canonicalizationVersion: inboxV2SchemaVersionTokenSchema
      })
      .strict(),
    objectKindId: inboxV2SourceIdentityObjectKindIdSchema,
    scope: inboxV2SourceIdentityScopeSchema,
    identityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
    materializationAuthority:
      inboxV2SourceIdentityMaterializationAuthoritySchema,
    materializedAt: inboxV2TimestampSchema,
    canonicalExternalSubject: inboxV2OpaqueExternalIdentityValueSchema,
    stability: inboxV2SourceIdentityStabilitySchema,
    resolution: inboxV2SourceIdentityResolutionSchema,
    latestClaimVersion: inboxV2SourceIdentityClaimVersionSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((identity, context) => {
    addSourceIdentityDeclarationIssues(
      context,
      identity.identityDeclaration,
      identity,
      ["identityDeclaration"]
    );

    if (identity.materializationAuthority.tenantId !== identity.tenantId) {
      addSourceIdentityIssue(
        context,
        ["materializationAuthority", "tenantId"],
        "Source identity materialization authority must belong to the same tenant."
      );
    }
    if (
      identity.materializationAuthority.trustedServiceId !==
      identity.identityDeclaration.adapterContract.loadedByTrustedServiceId
    ) {
      addSourceIdentityIssue(
        context,
        ["materializationAuthority", "trustedServiceId"],
        "Source identity materialization must use the trusted service pinned by its adapter declaration."
      );
    }
    if (
      identity.materializationAuthority.authorizedAt !==
        identity.materializedAt ||
      identity.materializedAt !== identity.createdAt
    ) {
      addSourceIdentityIssue(
        context,
        ["materializedAt"],
        "Source identity authorization, materialization and creation must share one commit boundary."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        identity.identityDeclaration.adapterContract.loadedAt,
        identity.materializedAt
      )
    ) {
      addSourceIdentityIssue(
        context,
        ["identityDeclaration", "adapterContract", "loadedAt"],
        "Source identity cannot predate its trusted adapter declaration."
      );
    }

    if ("owner" in identity.scope) {
      addTenantReferenceIssue(
        context,
        identity.tenantId,
        identity.scope.owner,
        ["scope", "owner"]
      );
    }

    if (identity.stability.kind === "observation_ephemeral") {
      addTenantReferenceIssue(
        context,
        identity.tenantId,
        identity.stability.observation,
        ["stability", "observation"]
      );
    }

    if (identity.resolution.status === "claimed") {
      addTenantReferenceIssue(
        context,
        identity.tenantId,
        identity.resolution.activeClaim,
        ["resolution", "activeClaim"]
      );

      if (identity.latestClaimVersion === null) {
        context.addIssue({
          code: "custom",
          path: ["latestClaimVersion"],
          message: "Claimed source identity requires a claim version."
        });
      }
    }

    addTimestampOrderIssue(context, identity.createdAt, identity.updatedAt, [
      "updatedAt"
    ]);
  });

function addSourceIdentityDeclarationIssues(
  context: z.RefinementCtx,
  declaration: InboxV2AdapterIdentityDeclaration,
  identity: {
    realm: {
      realmId: InboxV2SourceIdentityRealmId;
      version: string;
      canonicalizationVersion: string;
    };
    objectKindId: InboxV2SourceIdentityObjectKindId;
    scope: z.infer<typeof inboxV2SourceIdentityScopeSchema>;
  },
  path: (string | number)[]
): void {
  if (declaration.identityKind !== "source_external_identity") {
    addSourceIdentityIssue(
      context,
      [...path, "identityKind"],
      "Source identity requires a source_external_identity adapter declaration."
    );
  }
  if (
    String(declaration.realmId) !== String(identity.realm.realmId) ||
    declaration.realmVersion !== identity.realm.version ||
    declaration.canonicalizationVersion !==
      identity.realm.canonicalizationVersion ||
    String(declaration.objectKindId) !== String(identity.objectKindId) ||
    declaration.scopeKind !== identity.scope.kind
  ) {
    addSourceIdentityIssue(
      context,
      path,
      "Adapter declaration must exactly match source identity realm, object kind, canonicalization and scope."
    );
  }
  if (
    identity.scope.kind === "provider" &&
    declaration.decisionStrength !== "authoritative"
  ) {
    addSourceIdentityIssue(
      context,
      [...path, "decisionStrength"],
      "Provider-wide source identity scope requires authoritative pinned evidence."
    );
  }
  if (
    declaration.decisionStrength === "safe_default" &&
    identity.scope.kind !== "source_account"
  ) {
    addSourceIdentityIssue(
      context,
      [...path, "decisionStrength"],
      "Unknown source identity scope may only use the safe source_account default."
    );
  }
}

function addSourceIdentityIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

export const inboxV2ConversationParticipantSubjectSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("employee"),
        employee: inboxV2EmployeeReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("source_external_identity"),
        sourceExternalIdentity: inboxV2SourceExternalIdentityReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("client_contact"),
        clientContact: inboxV2ClientContactReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("bot"),
        bot: inboxV2BotIdentityReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("system"),
        systemActorId: inboxV2ParticipantSystemActorIdSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("legacy_unknown"),
        provenanceCodeId: inboxV2LegacyParticipantProvenanceIdSchema
      })
      .strict()
  ]
);

export const inboxV2ConversationParticipantSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ConversationParticipantIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    subject: inboxV2ConversationParticipantSubjectSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((participant, context) => {
    addTenantReferenceIssue(
      context,
      participant.tenantId,
      participant.conversation,
      ["conversation"]
    );

    const subjectReference = participantSubjectReference(participant.subject);

    if (subjectReference) {
      addTenantReferenceIssue(context, participant.tenantId, subjectReference, [
        "subject"
      ]);
    }

    addTimestampOrderIssue(
      context,
      participant.createdAt,
      participant.updatedAt,
      ["updatedAt"]
    );
  });

export const inboxV2ConversationParticipantSetSchema = z
  .array(inboxV2ConversationParticipantSchema)
  .max(10_000)
  .superRefine((participants, context) => {
    const first = participants[0];
    const seenSubjects = new Set<string>();

    for (const [index, participant] of participants.entries()) {
      if (
        first &&
        (participant.tenantId !== first.tenantId ||
          participant.conversation.id !== first.conversation.id)
      ) {
        context.addIssue({
          code: "custom",
          path: [index, "conversation"],
          message:
            "Conversation participant set must belong to one tenant and Conversation."
        });
      }

      const key = participantSubjectKey(participant.subject);

      if (seenSubjects.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index, "subject"],
          message:
            "Conversation cannot contain duplicate anchors for one exact typed subject."
        });
      }

      seenSubjects.add(key);
    }
  });

export const inboxV2ParticipantMembershipStateSchema = z.enum([
  "pending",
  "active",
  "left",
  "removed"
]);
export const inboxV2ParticipantMembershipRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "guest",
  "observer",
  "unknown"
]);
export const inboxV2ParticipantMembershipEvidenceSchema = z.enum([
  "confirmed",
  "advisory",
  "imported"
]);

export const inboxV2ParticipantMembershipOriginSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("hulee_internal_command") }).strict(),
    z
      .object({
        kind: z.literal("provider_roster"),
        memberEvidence: inboxV2ProviderRosterMemberEvidenceReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("migration"),
        provenanceId: inboxV2LegacyParticipantProvenanceIdSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("system_policy"),
        policyId: inboxV2ParticipantMembershipPolicyIdSchema
      })
      .strict()
  ]
);

export const inboxV2ParticipantMembershipEpisodeSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ParticipantMembershipEpisodeIdSchema,
    participant: inboxV2ConversationParticipantReferenceSchema,
    origin: inboxV2ParticipantMembershipOriginSchema,
    state: inboxV2ParticipantMembershipStateSchema,
    role: inboxV2ParticipantMembershipRoleSchema,
    evidenceClassification: inboxV2ParticipantMembershipEvidenceSchema,
    validFrom: inboxV2TimestampSchema,
    validTo: inboxV2TimestampSchema.nullable(),
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((episode, context) => {
    addTenantReferenceIssue(context, episode.tenantId, episode.participant, [
      "participant"
    ]);

    if (episode.origin.kind === "provider_roster") {
      addTenantReferenceIssue(
        context,
        episode.tenantId,
        episode.origin.memberEvidence,
        ["origin", "memberEvidence"]
      );

      if (episode.evidenceClassification !== "confirmed") {
        addMembershipEvidenceIssue(context, ["evidenceClassification"]);
      }
    } else if (
      episode.origin.kind === "migration" &&
      episode.evidenceClassification !== "imported"
    ) {
      addMembershipEvidenceIssue(context, ["evidenceClassification"]);
    } else if (
      episode.origin.kind !== "migration" &&
      episode.evidenceClassification !== "confirmed"
    ) {
      addMembershipEvidenceIssue(context, ["evidenceClassification"]);
    }

    const isCurrent = episode.state === "pending" || episode.state === "active";

    if (isCurrent && episode.validTo !== null) {
      context.addIssue({
        code: "custom",
        path: ["validTo"],
        message: "Current membership episode cannot have validTo."
      });
    }

    if (!isCurrent && episode.validTo === null) {
      context.addIssue({
        code: "custom",
        path: ["validTo"],
        message: "Terminal membership episode requires validTo."
      });
    }

    if (episode.validTo !== null) {
      addTimestampOrderIssue(context, episode.validFrom, episode.validTo, [
        "validTo"
      ]);
    }
  });

/**
 * Provider membership changes must first become scoped roster/member evidence.
 * A bare SourceOccurrence is intentionally excluded until CON-005/SRC-003 can
 * prove its binding, actor and typed membership semantics.
 */
export const inboxV2ProviderMembershipTransitionEvidenceSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("provider_roster_member"),
        reference: inboxV2ProviderRosterMemberEvidenceReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_roster"),
        reference: inboxV2ProviderRosterEvidenceReferenceSchema
      })
      .strict()
  ]);

export const inboxV2ParticipantMembershipTransitionCauseSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("hulee_internal_command"),
        actorEmployee: inboxV2EmployeeReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_roster"),
        evidence: inboxV2ProviderMembershipTransitionEvidenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("migration"),
        trustedServiceId: inboxV2TrustedServiceIdSchema,
        provenanceId: inboxV2LegacyParticipantProvenanceIdSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("system_policy"),
        trustedServiceId: inboxV2TrustedServiceIdSchema,
        policyId: inboxV2ParticipantMembershipPolicyIdSchema
      })
      .strict()
  ]);

export const inboxV2ParticipantMembershipTransitionIntentSchema = z.enum([
  "initial_pending",
  "initial_active",
  "activate",
  "change_role",
  "leave",
  "remove"
]);

/**
 * Append-only audit fact for one membership state/role change. The repository
 * must compare expected/current under the same lock that advances the episode;
 * the schema additionally makes skipped or reused revisions unrepresentable.
 */
export const inboxV2ParticipantMembershipTransitionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ParticipantMembershipTransitionIdSchema,
    episode: inboxV2ParticipantMembershipEpisodeReferenceSchema,
    intent: inboxV2ParticipantMembershipTransitionIntentSchema,
    fromState: inboxV2ParticipantMembershipStateSchema.nullable(),
    toState: inboxV2ParticipantMembershipStateSchema,
    fromRole: inboxV2ParticipantMembershipRoleSchema.nullable(),
    toRole: inboxV2ParticipantMembershipRoleSchema,
    cause: inboxV2ParticipantMembershipTransitionCauseSchema,
    reasonCodeId: inboxV2ParticipantMembershipReasonIdSchema,
    expectedRevision: inboxV2EntityRevisionSchema.nullable(),
    currentRevision: inboxV2EntityRevisionSchema.nullable(),
    resultingRevision: inboxV2EntityRevisionSchema,
    occurredAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((transition, context) => {
    addTenantReferenceIssue(context, transition.tenantId, transition.episode, [
      "episode"
    ]);
    addMembershipTransitionCauseTenantIssues(transition, context);

    addMonotonicTransitionIssue(
      context,
      transition.expectedRevision,
      transition.currentRevision,
      transition.resultingRevision,
      ["resultingRevision"],
      "Membership transition"
    );

    if (!isMembershipTransitionShapeValid(transition)) {
      context.addIssue({
        code: "custom",
        path: ["intent"],
        message:
          "Membership transition intent does not match its state and role change."
      });
    }
  });

/**
 * Confirms the structural Employee membership relation for one internal
 * Conversation. It deliberately does not grant RBAC or resource access.
 */
export function isInboxV2ConfirmedInternalEmployeeMembership(input: {
  episode: z.input<typeof inboxV2ParticipantMembershipEpisodeSchema>;
  participant: z.input<typeof inboxV2ConversationParticipantSchema>;
  conversation: z.input<typeof inboxV2ConversationSchema>;
}): boolean {
  const episode = inboxV2ParticipantMembershipEpisodeSchema.parse(
    input.episode
  );
  const participant = inboxV2ConversationParticipantSchema.parse(
    input.participant
  );
  const conversation = inboxV2ConversationSchema.parse(input.conversation);

  return (
    episode.tenantId === participant.tenantId &&
    participant.tenantId === conversation.tenantId &&
    episode.participant.id === participant.id &&
    participant.conversation.id === conversation.id &&
    participant.subject.kind === "employee" &&
    conversation.transport === "internal" &&
    episode.origin.kind === "hulee_internal_command" &&
    episode.state === "active" &&
    episode.evidenceClassification === "confirmed"
  );
}

export const inboxV2ParticipantAuthorEvidenceSchema = z.enum([
  "observed",
  "unknown"
]);

export const inboxV2ParticipantAuthorObservationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ParticipantAuthorObservationIdSchema,
    participant: inboxV2ConversationParticipantReferenceSchema,
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    evidenceClassification: inboxV2ParticipantAuthorEvidenceSchema,
    observedAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((observation, context) => {
    addTenantReferenceIssue(
      context,
      observation.tenantId,
      observation.participant,
      ["participant"]
    );
    addTenantReferenceIssue(
      context,
      observation.tenantId,
      observation.sourceOccurrence,
      ["sourceOccurrence"]
    );
  });

export const inboxV2ProviderRosterObservationReferenceSchema = z.union([
  inboxV2RawInboundEventReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema
]);

export const inboxV2ProviderRosterCompletenessSchema = z.enum([
  "unknown",
  "partial",
  "complete"
]);
export const inboxV2ProviderRosterAuthoritySchema = z.enum([
  "advisory",
  "authoritative"
]);
export const inboxV2ProviderRosterOmissionPolicySchema = z.enum([
  "retain_missing",
  "close_missing"
]);

/**
 * Adapter-declared comparable position for one binding-local roster stream.
 * Provider time and opaque watermarks are deliberately excluded from ordering.
 */
export const inboxV2ProviderRosterOrderingSchema = z
  .object({
    kind: z.literal("adapter_monotonic"),
    scopeToken: inboxV2RoutingTokenSchema,
    comparatorId: inboxV2CatalogIdSchema,
    comparatorRevision: inboxV2EntityRevisionSchema,
    position: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2ProviderRosterEvidenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ProviderRosterEvidenceIdSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    observation: inboxV2ProviderRosterObservationReferenceSchema,
    adapterContractVersion: inboxV2SchemaVersionTokenSchema,
    completeness: inboxV2ProviderRosterCompletenessSchema,
    authority: inboxV2ProviderRosterAuthoritySchema,
    omissionPolicy: inboxV2ProviderRosterOmissionPolicySchema,
    ordering: inboxV2ProviderRosterOrderingSchema,
    observedAt: inboxV2TimestampSchema,
    watermark: inboxV2OpaqueExternalIdentityValueSchema.nullable(),
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((evidence, context) => {
    addTenantReferenceIssue(
      context,
      evidence.tenantId,
      evidence.sourceThreadBinding,
      ["sourceThreadBinding"]
    );
    addTenantReferenceIssue(context, evidence.tenantId, evidence.observation, [
      "observation"
    ]);

    if (
      evidence.omissionPolicy === "close_missing" &&
      (evidence.completeness !== "complete" ||
        evidence.authority !== "authoritative")
    ) {
      context.addIssue({
        code: "custom",
        path: ["omissionPolicy"],
        message:
          "Only complete authoritative roster evidence can close missing provider origins."
      });
    }
  });

export const inboxV2ProviderRosterMemberStateSchema = z.enum([
  "present",
  "left",
  "removed",
  "unknown"
]);

/**
 * One bounded member observation belonging to roster metadata above. Provider
 * state/role codes remain opaque and case-preserving while normalized values
 * stay in the closed core vocabulary.
 */
export const inboxV2ProviderRosterMemberEvidenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ProviderRosterMemberEvidenceIdSchema,
    rosterEvidence: inboxV2ProviderRosterEvidenceReferenceSchema,
    sourceExternalIdentity: inboxV2SourceExternalIdentityReferenceSchema,
    state: inboxV2ProviderRosterMemberStateSchema,
    normalizedRole: inboxV2ParticipantMembershipRoleSchema,
    providerStateCode: inboxV2OpaqueExternalIdentityValueSchema,
    providerRoleCode: inboxV2OpaqueExternalIdentityValueSchema.nullable(),
    observedAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((member, context) => {
    addTenantReferenceIssue(context, member.tenantId, member.rosterEvidence, [
      "rosterEvidence"
    ]);
    addTenantReferenceIssue(
      context,
      member.tenantId,
      member.sourceExternalIdentity,
      ["sourceExternalIdentity"]
    );
  });

/**
 * Cross-entity validator for one participant's membership history. Individual
 * records stay independently insertable; services and persistence constraints
 * must validate this graph before projecting current membership.
 */
export const inboxV2ParticipantMembershipGraphSchema = z
  .object({
    participant: inboxV2ConversationParticipantSchema,
    episodes: z.array(inboxV2ParticipantMembershipEpisodeSchema).max(10_000),
    transitions: z
      .array(inboxV2ParticipantMembershipTransitionSchema)
      .max(50_000),
    rosterEvidence: z.array(inboxV2ProviderRosterEvidenceSchema).max(10_000),
    rosterMemberEvidence: z
      .array(inboxV2ProviderRosterMemberEvidenceSchema)
      .max(50_000)
  })
  .strict()
  .superRefine((graph, context) => {
    addParticipantMembershipGraphIssues(graph, context);
  });

export function canInboxV2RosterEvidenceCloseMissingMembership(
  input: z.input<typeof inboxV2ProviderRosterEvidenceSchema>
): boolean {
  const evidence = inboxV2ProviderRosterEvidenceSchema.parse(input);

  return evidence.omissionPolicy === "close_missing";
}

export const inboxV2SourceIdentityClaimTargetSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("employee"),
        employee: inboxV2EmployeeReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("client_contact"),
        clientContact: inboxV2ClientContactReferenceSchema
      })
      .strict()
  ]
);

export const INBOX_V2_SOURCE_IDENTITY_CLAIM_PERMISSION_REQUIREMENTS =
  Object.freeze({
    sourceIdentity: "identity.source_identity.use",
    employeeTarget: "identity.employee_claim.manage",
    clientContactTarget: "identity.client_contact_claim.manage",
    evidence: "identity.evidence.view",
    automaticResolution: "identity.auto_resolve",
    revoke: "identity.claim.revoke"
  } as const);

export function getInboxV2SourceIdentityClaimTargetPermission(
  target: z.input<typeof inboxV2SourceIdentityClaimTargetSchema>
):
  | typeof INBOX_V2_SOURCE_IDENTITY_CLAIM_PERMISSION_REQUIREMENTS.employeeTarget
  | typeof INBOX_V2_SOURCE_IDENTITY_CLAIM_PERMISSION_REQUIREMENTS.clientContactTarget {
  const parsedTarget = inboxV2SourceIdentityClaimTargetSchema.parse(target);

  return parsedTarget.kind === "employee"
    ? INBOX_V2_SOURCE_IDENTITY_CLAIM_PERMISSION_REQUIREMENTS.employeeTarget
    : INBOX_V2_SOURCE_IDENTITY_CLAIM_PERMISSION_REQUIREMENTS.clientContactTarget;
}

export const inboxV2SourceIdentityClaimConfidenceSchema = z.enum([
  "verified",
  "strong",
  "weak"
]);

/**
 * Immutable authority descriptor captured by an automatic claim decision.
 * The remaining exact authority tuple is deliberately not duplicated here:
 * policyId/policyVersion live on the claim or transition and the approved
 * trusted service is the decision actor itself.
 */
export const inboxV2SourceIdentityClaimPolicyAuthoritySchema = z
  .object({
    family: z.literal("source_identity_claim"),
    definitionContractVersion: inboxV2SchemaVersionTokenSchema,
    definitionDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    activationHeadRevision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2SourceIdentityClaimEvidenceReferenceSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("raw_inbound_event"),
        reference: inboxV2RawInboundEventReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("normalized_inbound_event"),
        reference: inboxV2NormalizedInboundEventReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("source_occurrence"),
        reference: inboxV2SourceOccurrenceReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_roster_evidence"),
        reference: inboxV2ProviderRosterEvidenceReferenceSchema
      })
      .strict()
  ]);

export const inboxV2SourceIdentityClaimDecisionSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("manual"),
        actorEmployee: inboxV2EmployeeReferenceSchema,
        reviewState: z.literal("approved")
      })
      .strict(),
    z
      .object({
        kind: z.literal("automatic_policy"),
        trustedServiceId: inboxV2TrustedServiceIdSchema,
        reviewState: z.literal("not_required"),
        policyAuthority: inboxV2SourceIdentityClaimPolicyAuthoritySchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("migration"),
        trustedServiceId: inboxV2TrustedServiceIdSchema,
        reviewState: z.literal("not_required")
      })
      .strict()
  ]
);

export const inboxV2SourceIdentityClaimRevocationSchema = z
  .object({
    revokedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2SourceIdentityClaimSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2SourceIdentityClaimIdSchema,
    sourceExternalIdentity: inboxV2SourceExternalIdentityReferenceSchema,
    previousClaimVersion: inboxV2SourceIdentityClaimVersionSchema.nullable(),
    claimVersion: inboxV2SourceIdentityClaimVersionSchema,
    target: inboxV2SourceIdentityClaimTargetSchema,
    status: z.enum(["active", "revoked"]),
    confidence: inboxV2SourceIdentityClaimConfidenceSchema,
    evidenceReferences: z
      .array(inboxV2SourceIdentityClaimEvidenceReferenceSchema)
      .min(1)
      .max(50),
    policyId: inboxV2IdentityClaimPolicyIdSchema,
    policyVersion: inboxV2SchemaVersionTokenSchema,
    reasonCodeId: inboxV2IdentityClaimReasonIdSchema,
    decision: inboxV2SourceIdentityClaimDecisionSchema,
    createdAt: inboxV2TimestampSchema,
    revocation: inboxV2SourceIdentityClaimRevocationSchema.nullable(),
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((claim, context) => {
    addTenantReferenceIssue(
      context,
      claim.tenantId,
      claim.sourceExternalIdentity,
      ["sourceExternalIdentity"]
    );
    addTenantReferenceIssue(
      context,
      claim.tenantId,
      claimTargetReference(claim.target),
      ["target"]
    );

    for (const [index, evidence] of claim.evidenceReferences.entries()) {
      addTenantReferenceIssue(context, claim.tenantId, evidence.reference, [
        "evidenceReferences",
        index,
        "reference"
      ]);
    }

    if (claim.decision.kind === "manual") {
      addTenantReferenceIssue(
        context,
        claim.tenantId,
        claim.decision.actorEmployee,
        ["decision", "actorEmployee"]
      );

      if (
        claim.target.kind === "employee" &&
        claim.target.employee.id === claim.decision.actorEmployee.id
      ) {
        context.addIssue({
          code: "custom",
          path: ["decision", "actorEmployee"],
          message: "Manual Employee self-claim is forbidden."
        });
      }
    }

    addMonotonicTransitionIssue(
      context,
      claim.previousClaimVersion,
      claim.previousClaimVersion,
      claim.claimVersion,
      ["claimVersion"],
      "Claim history"
    );

    const expectedEntityRevision = claim.status === "active" ? "1" : "2";

    if (claim.revision !== expectedEntityRevision) {
      context.addIssue({
        code: "custom",
        path: ["revision"],
        message:
          "Immutable claim starts at entity revision 1 and its sole audited revocation advances to revision 2."
      });
    }

    if (claim.status === "active" && claim.revocation !== null) {
      context.addIssue({
        code: "custom",
        path: ["revocation"],
        message: "Active identity claim cannot have revocation metadata."
      });
    }

    if (claim.status === "revoked" && claim.revocation === null) {
      context.addIssue({
        code: "custom",
        path: ["revocation"],
        message: "Revoked identity claim requires audited revocation metadata."
      });
    }

    if (claim.revocation !== null) {
      addTimestampOrderIssue(
        context,
        claim.createdAt,
        claim.revocation.revokedAt,
        ["revocation", "revokedAt"]
      );
    }
  });

const inboxV2SourceIdentityPreviousClaimSchema = z
  .object({
    claim: inboxV2SourceIdentityClaimReferenceSchema,
    target: inboxV2SourceIdentityClaimTargetSchema
  })
  .strict();

/**
 * Claim transition operation is deliberately split by target permission
 * family. It is an append-only server-stamped CAS result, not an authorization
 * decision and not a generic command envelope.
 */
export const inboxV2SourceIdentityClaimTransitionOperationSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("claim_employee"),
        target: z
          .object({
            kind: z.literal("employee"),
            employee: inboxV2EmployeeReferenceSchema
          })
          .strict(),
        previousClaim: inboxV2SourceIdentityPreviousClaimSchema.nullable(),
        resultingClaim: inboxV2SourceIdentityClaimReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("claim_client_contact"),
        target: z
          .object({
            kind: z.literal("client_contact"),
            clientContact: inboxV2ClientContactReferenceSchema
          })
          .strict(),
        previousClaim: inboxV2SourceIdentityPreviousClaimSchema.nullable(),
        resultingClaim: inboxV2SourceIdentityClaimReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("revoke"),
        activeClaim: inboxV2SourceIdentityClaimReferenceSchema,
        target: inboxV2SourceIdentityClaimTargetSchema
      })
      .strict()
  ]);

export const inboxV2SourceIdentityClaimTransitionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2SourceIdentityClaimTransitionIdSchema,
    sourceExternalIdentity: inboxV2SourceExternalIdentityReferenceSchema,
    operation: inboxV2SourceIdentityClaimTransitionOperationSchema,
    decision: inboxV2SourceIdentityClaimDecisionSchema,
    policyId: inboxV2IdentityClaimPolicyIdSchema,
    policyVersion: inboxV2SchemaVersionTokenSchema,
    reasonCodeId: inboxV2IdentityClaimReasonIdSchema,
    expectedVersion: inboxV2SourceIdentityClaimVersionSchema.nullable(),
    currentVersion: inboxV2SourceIdentityClaimVersionSchema.nullable(),
    resultingVersion: inboxV2SourceIdentityClaimVersionSchema,
    occurredAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((transition, context) => {
    addTenantReferenceIssue(
      context,
      transition.tenantId,
      transition.sourceExternalIdentity,
      ["sourceExternalIdentity"]
    );
    addClaimTransitionOperationTenantIssues(transition, context);

    if (transition.decision.kind === "manual") {
      addTenantReferenceIssue(
        context,
        transition.tenantId,
        transition.decision.actorEmployee,
        ["decision", "actorEmployee"]
      );

      if (
        transition.operation.kind === "claim_employee" &&
        transition.operation.target.employee.id ===
          transition.decision.actorEmployee.id
      ) {
        context.addIssue({
          code: "custom",
          path: ["decision", "actorEmployee"],
          message: "Manual Employee self-claim is forbidden."
        });
      }
    }

    addMonotonicTransitionIssue(
      context,
      transition.expectedVersion,
      transition.currentVersion,
      transition.resultingVersion,
      ["resultingVersion"],
      "Source identity claim transition"
    );
  });

export const inboxV2SourceIdentityClaimSetSchema = z
  .array(inboxV2SourceIdentityClaimSchema)
  .max(10_000)
  .superRefine((claims, context) => {
    const activeClaims = new Set<string>();
    const versions = new Set<string>();

    for (const [index, claim] of claims.entries()) {
      const identityKey = `${claim.tenantId}\u0000${claim.sourceExternalIdentity.id}`;
      const versionKey = `${identityKey}\u0000${claim.claimVersion}`;

      if (versions.has(versionKey)) {
        context.addIssue({
          code: "custom",
          path: [index, "claimVersion"],
          message: "Source identity claim version must be unique per identity."
        });
      }

      versions.add(versionKey);

      if (claim.status === "active") {
        if (activeClaims.has(identityKey)) {
          context.addIssue({
            code: "custom",
            path: [index, "status"],
            message: "Source identity can have at most one active claim."
          });
        }

        activeClaims.add(identityKey);
      }
    }
  });

/**
 * Validates the one-way transition ownership graph around a source identity.
 * This is the contract counterpart of the composite FKs/unique constraints
 * required by DB-002; it prevents same-tenant but unrelated references.
 */
export const inboxV2SourceIdentityClaimGraphSchema = z
  .object({
    identity: inboxV2SourceExternalIdentitySchema,
    claims: inboxV2SourceIdentityClaimSetSchema,
    transitions: z.array(inboxV2SourceIdentityClaimTransitionSchema).max(20_000)
  })
  .strict()
  .superRefine((graph, context) => {
    addSourceIdentityClaimGraphIssues(graph, context);
  });

export function isInboxV2SourceIdentityClaimExpectedVersionCurrent(input: {
  currentVersion: string | null;
  expectedVersion: string | null;
}): boolean {
  const currentVersion =
    input.currentVersion === null
      ? null
      : inboxV2SourceIdentityClaimVersionSchema.parse(input.currentVersion);
  const expectedVersion =
    input.expectedVersion === null
      ? null
      : inboxV2SourceIdentityClaimVersionSchema.parse(input.expectedVersion);

  return currentVersion === expectedVersion;
}

export const inboxV2SourceExternalIdentityEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2SourceExternalIdentitySchema
  );
export const inboxV2ConversationParticipantEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CONVERSATION_PARTICIPANT_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2ConversationParticipantSchema
  );
export const inboxV2ParticipantMembershipEpisodeEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PARTICIPANT_MEMBERSHIP_EPISODE_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2ParticipantMembershipEpisodeSchema
  );
export const inboxV2ParticipantMembershipTransitionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PARTICIPANT_MEMBERSHIP_TRANSITION_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2ParticipantMembershipTransitionSchema
  );
export const inboxV2ParticipantAuthorObservationEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PARTICIPANT_AUTHOR_OBSERVATION_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2ParticipantAuthorObservationSchema
  );
export const inboxV2ProviderRosterEvidenceEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROVIDER_ROSTER_EVIDENCE_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2ProviderRosterEvidenceSchema
  );
export const inboxV2ProviderRosterMemberEvidenceEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROVIDER_ROSTER_MEMBER_EVIDENCE_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2ProviderRosterMemberEvidenceSchema
  );
export const inboxV2SourceIdentityClaimEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2SourceIdentityClaimSchema
  );
export const inboxV2SourceIdentityClaimTransitionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_IDENTITY_CLAIM_TRANSITION_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2SourceIdentityClaimTransitionSchema
  );

export type InboxV2SourceIdentityResolution = z.infer<
  typeof inboxV2SourceIdentityResolutionSchema
>;
export type InboxV2SourceExternalIdentity = z.infer<
  typeof inboxV2SourceExternalIdentitySchema
>;
export type InboxV2ConversationParticipantSubject = z.infer<
  typeof inboxV2ConversationParticipantSubjectSchema
>;
export type InboxV2ConversationParticipant = z.infer<
  typeof inboxV2ConversationParticipantSchema
>;
export type InboxV2ParticipantMembershipState = z.infer<
  typeof inboxV2ParticipantMembershipStateSchema
>;
export type InboxV2ParticipantMembershipRole = z.infer<
  typeof inboxV2ParticipantMembershipRoleSchema
>;
export type InboxV2ParticipantMembershipOrigin = z.infer<
  typeof inboxV2ParticipantMembershipOriginSchema
>;
export type InboxV2ParticipantMembershipEpisode = z.infer<
  typeof inboxV2ParticipantMembershipEpisodeSchema
>;
export type InboxV2ParticipantMembershipTransition = z.infer<
  typeof inboxV2ParticipantMembershipTransitionSchema
>;
export type InboxV2ParticipantMembershipGraph = z.infer<
  typeof inboxV2ParticipantMembershipGraphSchema
>;
export type InboxV2ParticipantAuthorObservation = z.infer<
  typeof inboxV2ParticipantAuthorObservationSchema
>;
export type InboxV2ProviderRosterEvidence = z.infer<
  typeof inboxV2ProviderRosterEvidenceSchema
>;
export type InboxV2ProviderRosterOrdering = z.infer<
  typeof inboxV2ProviderRosterOrderingSchema
>;
export type InboxV2ProviderRosterMemberEvidence = z.infer<
  typeof inboxV2ProviderRosterMemberEvidenceSchema
>;
export type InboxV2SourceIdentityClaimTarget = z.infer<
  typeof inboxV2SourceIdentityClaimTargetSchema
>;
export type InboxV2SourceIdentityClaim = z.infer<
  typeof inboxV2SourceIdentityClaimSchema
>;
export type InboxV2SourceIdentityClaimTransition = z.infer<
  typeof inboxV2SourceIdentityClaimTransitionSchema
>;
export type InboxV2SourceIdentityClaimGraph = z.infer<
  typeof inboxV2SourceIdentityClaimGraphSchema
>;

type InboxV2ParticipantMembershipGraphValue = {
  participant: InboxV2ConversationParticipant;
  episodes: InboxV2ParticipantMembershipEpisode[];
  transitions: InboxV2ParticipantMembershipTransition[];
  rosterEvidence: InboxV2ProviderRosterEvidence[];
  rosterMemberEvidence: InboxV2ProviderRosterMemberEvidence[];
};

type InboxV2SourceIdentityClaimGraphValue = {
  identity: InboxV2SourceExternalIdentity;
  claims: InboxV2SourceIdentityClaim[];
  transitions: InboxV2SourceIdentityClaimTransition[];
};

function hasNoAsciiControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit <= 31 || codeUnit === 127) {
      return false;
    }
  }

  return true;
}

function hasOnlyUnicodeScalarValues(value: string): boolean {
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0xd800 || codePoint > 0xdfff;
  });
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    context.addIssue({
      code: "custom",
      path,
      message: "Inbox V2 nested reference must use the entity tenant."
    });
  }
}

function addTimestampOrderIssue(
  context: z.RefinementCtx,
  earlier: string,
  later: string,
  path: PropertyKey[]
): void {
  if (!isInboxV2TimestampOrderValid(earlier, later)) {
    context.addIssue({
      code: "custom",
      path,
      message: "Inbox V2 temporal interval cannot move backwards."
    });
  }
}

function addMembershipEvidenceIssue(
  context: z.RefinementCtx,
  path: PropertyKey[]
): void {
  context.addIssue({
    code: "custom",
    path,
    message: "Membership evidence classification does not match its origin."
  });
}

function addMonotonicTransitionIssue(
  context: z.RefinementCtx,
  expected: string | null,
  current: string | null,
  resulting: string,
  path: PropertyKey[],
  label: string
): void {
  const versionsMatch = expected === current;
  const advancesExactlyOnce =
    current === null
      ? resulting === "1"
      : BigInt(resulting) === BigInt(current) + 1n;

  if (!versionsMatch || !advancesExactlyOnce) {
    context.addIssue({
      code: "custom",
      path,
      message: `${label} requires matching expected/current versions and an exact null-to-1 or n-to-n+1 advance.`
    });
  }
}

function addMembershipTransitionCauseTenantIssues(
  transition: InboxV2ParticipantMembershipTransition,
  context: z.RefinementCtx
): void {
  switch (transition.cause.kind) {
    case "hulee_internal_command":
      addTenantReferenceIssue(
        context,
        transition.tenantId,
        transition.cause.actorEmployee,
        ["cause", "actorEmployee"]
      );
      return;
    case "provider_roster":
      addTenantReferenceIssue(
        context,
        transition.tenantId,
        transition.cause.evidence.reference,
        ["cause", "evidence", "reference"]
      );
      return;
    case "migration":
    case "system_policy":
      return;
  }
}

function isMembershipTransitionShapeValid(
  transition: InboxV2ParticipantMembershipTransition
): boolean {
  const initialRevision =
    transition.expectedRevision === null &&
    transition.currentRevision === null &&
    transition.resultingRevision === "1";
  const existingRevision =
    transition.expectedRevision !== null && transition.currentRevision !== null;

  switch (transition.intent) {
    case "initial_pending":
      return (
        initialRevision &&
        transition.fromState === null &&
        transition.toState === "pending" &&
        transition.fromRole === null
      );
    case "initial_active":
      return (
        initialRevision &&
        transition.fromState === null &&
        transition.toState === "active" &&
        transition.fromRole === null
      );
    case "activate":
      return (
        existingRevision &&
        transition.fromState === "pending" &&
        transition.toState === "active" &&
        transition.fromRole !== null &&
        transition.fromRole === transition.toRole
      );
    case "change_role":
      return (
        existingRevision &&
        (transition.fromState === "pending" ||
          transition.fromState === "active") &&
        transition.toState === transition.fromState &&
        transition.fromRole !== null &&
        transition.fromRole !== transition.toRole
      );
    case "leave":
      return (
        existingRevision &&
        transition.fromState === "active" &&
        transition.toState === "left" &&
        transition.fromRole !== null &&
        transition.fromRole === transition.toRole
      );
    case "remove":
      return (
        existingRevision &&
        (transition.fromState === "pending" ||
          transition.fromState === "active") &&
        transition.toState === "removed" &&
        transition.fromRole !== null &&
        transition.fromRole === transition.toRole
      );
  }
}

function addClaimTransitionOperationTenantIssues(
  transition: InboxV2SourceIdentityClaimTransition,
  context: z.RefinementCtx
): void {
  addTenantReferenceIssue(
    context,
    transition.tenantId,
    claimTargetReference(transition.operation.target),
    ["operation", "target"]
  );

  if (transition.operation.kind === "revoke") {
    addTenantReferenceIssue(
      context,
      transition.tenantId,
      transition.operation.activeClaim,
      ["operation", "activeClaim"]
    );
    return;
  }

  addTenantReferenceIssue(
    context,
    transition.tenantId,
    transition.operation.resultingClaim,
    ["operation", "resultingClaim"]
  );

  if (transition.operation.previousClaim !== null) {
    addTenantReferenceIssue(
      context,
      transition.tenantId,
      transition.operation.previousClaim.claim,
      ["operation", "previousClaim", "claim"]
    );
    addTenantReferenceIssue(
      context,
      transition.tenantId,
      claimTargetReference(transition.operation.previousClaim.target),
      ["operation", "previousClaim", "target"]
    );
  }
}

function addParticipantMembershipGraphIssues(
  graph: InboxV2ParticipantMembershipGraphValue,
  context: z.RefinementCtx
): void {
  const tenantId = graph.participant.tenantId;
  const episodes = indexGraphEntities(
    graph.episodes,
    context,
    ["episodes"],
    "membership episode"
  );
  const transitions = indexGraphEntities(
    graph.transitions,
    context,
    ["transitions"],
    "membership transition"
  );
  const rosterEvidence = indexGraphEntities(
    graph.rosterEvidence,
    context,
    ["rosterEvidence"],
    "roster evidence"
  );
  const rosterMembers = indexGraphEntities(
    graph.rosterMemberEvidence,
    context,
    ["rosterMemberEvidence"],
    "roster member evidence"
  );

  for (const [index, item] of graph.rosterEvidence.entries()) {
    addGraphTenantIssue(context, tenantId, item.tenantId, [
      "rosterEvidence",
      index,
      "tenantId"
    ]);
  }
  for (const [index, item] of graph.rosterMemberEvidence.entries()) {
    addGraphTenantIssue(context, tenantId, item.tenantId, [
      "rosterMemberEvidence",
      index,
      "tenantId"
    ]);
  }

  const transitionsByEpisode = new Map<
    string,
    InboxV2ParticipantMembershipTransition[]
  >();
  const episodesByOrigin = new Map<
    string,
    Array<{
      episode: InboxV2ParticipantMembershipEpisode;
      index: number;
    }>
  >();
  const usedProviderTransitionEvidence = new Set<string>();

  for (const [index, transition] of graph.transitions.entries()) {
    addGraphTenantIssue(context, tenantId, transition.tenantId, [
      "transitions",
      index,
      "tenantId"
    ]);
    const episode = episodes.get(String(transition.episode.id));

    if (!episode) {
      addGraphIssue(
        context,
        ["transitions", index, "episode"],
        "Membership transition must reference an episode in the same graph."
      );
      continue;
    }

    const grouped = transitionsByEpisode.get(String(episode.id)) ?? [];
    grouped.push(transition);
    transitionsByEpisode.set(String(episode.id), grouped);

    if (!doesMembershipTransitionCauseMatchOrigin(transition, episode)) {
      addGraphIssue(
        context,
        ["transitions", index, "cause"],
        "Membership transition cause must exactly match its episode origin."
      );
    }

    if (
      episode.origin.kind === "provider_roster" &&
      transition.cause.kind === "provider_roster"
    ) {
      const providerEvidenceKey =
        transition.cause.evidence.kind === "provider_roster_member"
          ? `member\u0000${transition.cause.evidence.reference.tenantId}\u0000${transition.cause.evidence.reference.id}`
          : `roster_omission\u0000${transition.cause.evidence.reference.tenantId}\u0000${transition.cause.evidence.reference.id}\u0000${
              graph.participant.subject.kind === "source_external_identity"
                ? graph.participant.subject.sourceExternalIdentity.id
                : ""
            }`;
      if (usedProviderTransitionEvidence.has(providerEvidenceKey)) {
        addGraphIssue(
          context,
          ["transitions", index, "cause", "evidence"],
          "Provider transition evidence cannot be reused."
        );
      }
      usedProviderTransitionEvidence.add(providerEvidenceKey);

      addProviderMembershipTransitionGraphIssues({
        context,
        transition,
        transitionIndex: index,
        episode,
        rosterEvidence,
        rosterMembers
      });
    }
  }

  for (const [index, episode] of graph.episodes.entries()) {
    addGraphTenantIssue(context, tenantId, episode.tenantId, [
      "episodes",
      index,
      "tenantId"
    ]);

    if (
      episode.participant.id !== graph.participant.id ||
      episode.participant.tenantId !== graph.participant.tenantId
    ) {
      addGraphIssue(
        context,
        ["episodes", index, "participant"],
        "Membership episode must belong to the graph participant."
      );
    }

    const originHistoryKey = membershipOriginHistoryKey(
      episode.origin,
      rosterMembers,
      rosterEvidence
    );
    if (originHistoryKey !== null) {
      const originHistory = episodesByOrigin.get(originHistoryKey) ?? [];
      originHistory.push({ episode, index });
      episodesByOrigin.set(originHistoryKey, originHistory);
    }

    if (
      episode.origin.kind === "hulee_internal_command" &&
      graph.participant.subject.kind !== "employee"
    ) {
      addGraphIssue(
        context,
        ["episodes", index, "origin"],
        "Hulee internal membership requires an Employee participant subject."
      );
    }

    if (episode.origin.kind === "provider_roster") {
      const member = rosterMembers.get(
        String(episode.origin.memberEvidence.id)
      );

      if (!member) {
        addGraphIssue(
          context,
          ["episodes", index, "origin", "memberEvidence"],
          "Provider membership origin requires member evidence in the graph."
        );
      } else {
        const roster = rosterEvidence.get(String(member.rosterEvidence.id));

        if (!roster) {
          addGraphIssue(
            context,
            ["episodes", index, "origin", "memberEvidence"],
            "Provider member evidence requires its roster evidence in the graph."
          );
        }

        if (
          graph.participant.subject.kind !== "source_external_identity" ||
          graph.participant.subject.sourceExternalIdentity.id !==
            member.sourceExternalIdentity.id
        ) {
          addGraphIssue(
            context,
            ["episodes", index, "origin", "memberEvidence"],
            "Provider membership must resolve to the participant source identity."
          );
        }
        if (member.state !== "present") {
          addGraphIssue(
            context,
            ["episodes", index, "origin", "memberEvidence"],
            "Provider membership origin requires a present member observation."
          );
        }
        if (
          episode.role !== member.normalizedRole ||
          episode.validFrom !== member.observedAt
        ) {
          addGraphIssue(
            context,
            ["episodes", index, "origin", "memberEvidence"],
            "Provider membership origin must exactly match the present member role and observation time."
          );
        }
        if (
          roster &&
          (roster.authority !== "authoritative" ||
            episode.evidenceClassification !== "confirmed")
        ) {
          addGraphIssue(
            context,
            ["episodes", index, "evidenceClassification"],
            "Provider membership mutation requires authoritative roster evidence and confirmed classification."
          );
        }
      }
    }

    const history = [
      ...(transitionsByEpisode.get(String(episode.id)) ?? [])
    ].sort((left, right) =>
      comparePositiveDecimal(left.resultingRevision, right.resultingRevision)
    );

    if (history.length === 0) {
      addGraphIssue(
        context,
        ["episodes", index],
        "Membership episode requires append-only transition history."
      );
      continue;
    }

    for (const [historyIndex, transition] of history.entries()) {
      const expectedResult = String(historyIndex + 1);
      const expectedPrevious = historyIndex === 0 ? null : String(historyIndex);

      if (
        transition.resultingRevision !== expectedResult ||
        transition.currentRevision !== expectedPrevious ||
        transition.expectedRevision !== expectedPrevious
      ) {
        addGraphIssue(
          context,
          ["episodes", index],
          "Membership transition history must be contiguous from revision 1."
        );
        break;
      }

      const previous = history[historyIndex - 1];

      if (
        previous &&
        (transition.fromState !== previous.toState ||
          transition.fromRole !== previous.toRole)
      ) {
        addGraphIssue(
          context,
          ["episodes", index],
          "Membership transition history must preserve state and role continuity."
        );
        break;
      }

      if (
        previous &&
        !isInboxV2TimestampOrderValid(
          previous.occurredAt,
          transition.occurredAt
        )
      ) {
        addGraphIssue(
          context,
          ["episodes", index],
          "Membership transition time cannot move backwards."
        );
        break;
      }
    }

    if (episode.origin.kind === "provider_roster") {
      const originMember = rosterMembers.get(
        String(episode.origin.memberEvidence.id)
      );
      const originRoster = originMember
        ? rosterEvidence.get(String(originMember.rosterEvidence.id))
        : undefined;
      let previousOrdering = originRoster?.ordering;

      for (const [historyIndex, transition] of history.entries()) {
        if (transition.cause.kind !== "provider_roster") continue;
        const transitionEvidence = resolveProviderTransitionEvidence(
          transition.cause.evidence,
          rosterEvidence,
          rosterMembers
        );
        if (!transitionEvidence || !originRoster || !previousOrdering) continue;

        if (
          historyIndex === 0 &&
          (transition.cause.evidence.kind !== "provider_roster_member" ||
            transition.cause.evidence.reference.tenantId !==
              episode.origin.memberEvidence.tenantId ||
            transition.cause.evidence.reference.id !==
              episode.origin.memberEvidence.id)
        ) {
          addGraphIssue(
            context,
            ["episodes", index],
            "Initial provider transition must use the exact origin member evidence."
          );
        }

        if (
          !hasSameProviderOrderingScale(
            originRoster.ordering,
            transitionEvidence.roster.ordering
          ) ||
          (historyIndex === 0
            ? comparePositiveDecimal(
                transitionEvidence.roster.ordering.position,
                originRoster.ordering.position
              ) !== 0
            : comparePositiveDecimal(
                transitionEvidence.roster.ordering.position,
                previousOrdering.position
              ) <= 0)
        ) {
          addGraphIssue(
            context,
            ["episodes", index],
            "Provider membership evidence must use one comparator scale and strictly increasing positions after the origin."
          );
        }

        previousOrdering = transitionEvidence.roster.ordering;
      }
    }

    const first = history[0];
    const latest = history.at(-1);

    if (first && first.occurredAt !== episode.validFrom) {
      addGraphIssue(
        context,
        ["episodes", index, "validFrom"],
        "Episode validFrom must equal its initial transition time."
      );
    }
    if (
      latest &&
      (latest.resultingRevision !== episode.revision ||
        latest.toState !== episode.state ||
        latest.toRole !== episode.role)
    ) {
      addGraphIssue(
        context,
        ["episodes", index, "revision"],
        "Episode projection must match its latest transition."
      );
    }
    if (
      latest &&
      (episode.state === "left" || episode.state === "removed") &&
      episode.validTo !== latest.occurredAt
    ) {
      addGraphIssue(
        context,
        ["episodes", index, "validTo"],
        "Terminal episode validTo must equal its terminal transition time."
      );
    }
  }

  for (const originHistory of episodesByOrigin.values()) {
    const ordered = [...originHistory].sort((left, right) => {
      const boundary =
        Date.parse(left.episode.validFrom) -
        Date.parse(right.episode.validFrom);
      if (boundary !== 0) return boundary;
      if (left.episode.validTo !== null && right.episode.validTo === null)
        return -1;
      if (left.episode.validTo === null && right.episode.validTo !== null)
        return 1;
      return String(left.episode.id).localeCompare(String(right.episode.id));
    });
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous === undefined || current === undefined) continue;
      if (
        previous.episode.validTo === null ||
        !isInboxV2TimestampOrderValid(
          previous.episode.validTo,
          current.episode.validFrom
        )
      ) {
        addGraphIssue(
          context,
          ["episodes", current.index, "validFrom"],
          "Membership episodes for one origin cannot overlap or move backwards."
        );
        continue;
      }

      if (
        previous.episode.origin.kind === "provider_roster" &&
        current.episode.origin.kind === "provider_roster"
      ) {
        const previousHistory = [
          ...(transitionsByEpisode.get(String(previous.episode.id)) ?? [])
        ].sort((left, right) =>
          comparePositiveDecimal(
            left.resultingRevision,
            right.resultingRevision
          )
        );
        const previousLatest = previousHistory.at(-1);
        const previousEvidence =
          previousLatest?.cause.kind === "provider_roster"
            ? resolveProviderTransitionEvidence(
                previousLatest.cause.evidence,
                rosterEvidence,
                rosterMembers
              )
            : undefined;
        const currentOriginMember = rosterMembers.get(
          String(current.episode.origin.memberEvidence.id)
        );
        const currentOriginRoster = currentOriginMember
          ? rosterEvidence.get(String(currentOriginMember.rosterEvidence.id))
          : undefined;

        if (
          previousEvidence &&
          currentOriginRoster &&
          (!hasSameProviderOrderingScale(
            previousEvidence.roster.ordering,
            currentOriginRoster.ordering
          ) ||
            comparePositiveDecimal(
              currentOriginRoster.ordering.position,
              previousEvidence.roster.ordering.position
            ) <= 0)
        ) {
          addGraphIssue(
            context,
            ["episodes", current.index, "origin", "memberEvidence"],
            "Provider membership rejoin must advance the durable ordering scale beyond the preceding episode."
          );
        }
      }
    }
  }

  void transitions;
}

function membershipOriginHistoryKey(
  origin: InboxV2ParticipantMembershipOrigin,
  rosterMembers: ReadonlyMap<string, InboxV2ProviderRosterMemberEvidence>,
  rosterEvidence: ReadonlyMap<string, InboxV2ProviderRosterEvidence>
): string | null {
  switch (origin.kind) {
    case "hulee_internal_command":
      return origin.kind;
    case "provider_roster": {
      const member = rosterMembers.get(String(origin.memberEvidence.id));
      const roster = member
        ? rosterEvidence.get(String(member.rosterEvidence.id))
        : undefined;

      return roster
        ? `${origin.kind}\u0000${roster.sourceThreadBinding.tenantId}\u0000${roster.sourceThreadBinding.id}`
        : null;
    }
    case "migration":
      return `${origin.kind}\u0000${origin.provenanceId}`;
    case "system_policy":
      return `${origin.kind}\u0000${origin.policyId}`;
  }
}

function doesMembershipTransitionCauseMatchOrigin(
  transition: InboxV2ParticipantMembershipTransition,
  episode: InboxV2ParticipantMembershipEpisode
): boolean {
  if (transition.cause.kind !== episode.origin.kind) return false;
  if (
    transition.cause.kind === "migration" &&
    episode.origin.kind === "migration"
  ) {
    return transition.cause.provenanceId === episode.origin.provenanceId;
  }
  if (
    transition.cause.kind === "system_policy" &&
    episode.origin.kind === "system_policy"
  ) {
    return transition.cause.policyId === episode.origin.policyId;
  }
  return true;
}

function resolveProviderTransitionEvidence(
  evidence: Extract<
    InboxV2ParticipantMembershipTransition["cause"],
    { kind: "provider_roster" }
  >["evidence"],
  rosterEvidence: ReadonlyMap<string, InboxV2ProviderRosterEvidence>,
  rosterMembers: ReadonlyMap<string, InboxV2ProviderRosterMemberEvidence>
):
  | Readonly<{
      roster: InboxV2ProviderRosterEvidence;
      member: InboxV2ProviderRosterMemberEvidence | undefined;
    }>
  | undefined {
  if (evidence.kind === "provider_roster") {
    const roster = rosterEvidence.get(String(evidence.reference.id));
    return roster ? { roster, member: undefined } : undefined;
  }

  const member = rosterMembers.get(String(evidence.reference.id));
  if (!member) return undefined;
  const roster = rosterEvidence.get(String(member.rosterEvidence.id));
  return roster ? { roster, member } : undefined;
}

function hasSameProviderOrderingScale(
  left: InboxV2ProviderRosterOrdering,
  right: InboxV2ProviderRosterOrdering
): boolean {
  return (
    left.kind === right.kind &&
    left.scopeToken === right.scopeToken &&
    left.comparatorId === right.comparatorId &&
    left.comparatorRevision === right.comparatorRevision
  );
}

function addProviderMembershipTransitionGraphIssues(input: {
  context: z.RefinementCtx;
  transition: InboxV2ParticipantMembershipTransition;
  transitionIndex: number;
  episode: InboxV2ParticipantMembershipEpisode;
  rosterEvidence: Map<string, InboxV2ProviderRosterEvidence>;
  rosterMembers: Map<string, InboxV2ProviderRosterMemberEvidence>;
}): void {
  const originMember = input.rosterMembers.get(
    String(
      input.episode.origin.kind === "provider_roster"
        ? input.episode.origin.memberEvidence.id
        : ""
    )
  );
  const originRoster = originMember
    ? input.rosterEvidence.get(String(originMember.rosterEvidence.id))
    : undefined;
  const evidence =
    input.transition.cause.kind === "provider_roster"
      ? input.transition.cause.evidence
      : null;

  if (!evidence) {
    return;
  }

  const resolvedTransitionEvidence = resolveProviderTransitionEvidence(
    evidence,
    input.rosterEvidence,
    input.rosterMembers
  );
  const transitionRoster = resolvedTransitionEvidence?.roster;
  const transitionMember = resolvedTransitionEvidence?.member;

  if (!transitionRoster) {
    addGraphIssue(
      input.context,
      ["transitions", input.transitionIndex, "cause", "evidence"],
      "Provider transition evidence must be present in the membership graph."
    );
    return;
  }

  const evidenceObservedAt = transitionMember
    ? transitionMember.observedAt
    : transitionRoster.observedAt;

  if (input.transition.occurredAt !== evidenceObservedAt) {
    addGraphIssue(
      input.context,
      ["transitions", input.transitionIndex, "occurredAt"],
      "Provider transition time must equal its persisted roster observation time."
    );
  }

  if (transitionRoster.authority !== "authoritative") {
    addGraphIssue(
      input.context,
      ["transitions", input.transitionIndex, "cause", "evidence"],
      "Provider membership mutation requires authoritative roster evidence."
    );
  }

  if (
    evidence.kind === "provider_roster" &&
    input.transition.toState !== "left" &&
    input.transition.toState !== "removed"
  ) {
    addGraphIssue(
      input.context,
      ["transitions", input.transitionIndex, "cause", "evidence"],
      "Roster-only evidence can represent only an omission-based terminal transition."
    );
  }

  if (
    evidence.kind === "provider_roster" &&
    (transitionRoster.omissionPolicy !== "close_missing" ||
      transitionRoster.completeness !== "complete" ||
      transitionRoster.authority !== "authoritative")
  ) {
    addGraphIssue(
      input.context,
      ["transitions", input.transitionIndex, "cause", "evidence"],
      "Roster omission can terminate membership only with complete authoritative close_missing evidence."
    );
  }

  if (
    evidence.kind === "provider_roster" &&
    originMember &&
    [...input.rosterMembers.values()].some(
      (member) =>
        member.rosterEvidence.tenantId === transitionRoster.tenantId &&
        member.rosterEvidence.id === transitionRoster.id &&
        member.sourceExternalIdentity.tenantId ===
          originMember.sourceExternalIdentity.tenantId &&
        member.sourceExternalIdentity.id ===
          originMember.sourceExternalIdentity.id
    )
  ) {
    addGraphIssue(
      input.context,
      ["transitions", input.transitionIndex, "cause", "evidence"],
      "Roster omission requires the participant identity to be absent from that roster."
    );
  }

  if (transitionMember) {
    const expectedMemberState =
      input.transition.toState === "left"
        ? "left"
        : input.transition.toState === "removed"
          ? "removed"
          : "present";

    if (
      transitionMember.state !== expectedMemberState ||
      transitionMember.normalizedRole !== input.transition.toRole ||
      (originMember &&
        (transitionMember.sourceExternalIdentity.tenantId !==
          originMember.sourceExternalIdentity.tenantId ||
          transitionMember.sourceExternalIdentity.id !==
            originMember.sourceExternalIdentity.id))
    ) {
      addGraphIssue(
        input.context,
        ["transitions", input.transitionIndex, "cause", "evidence"],
        "Provider member evidence must match the participant and transition state."
      );
    }
  }

  if (
    originRoster &&
    (transitionRoster.sourceThreadBinding.tenantId !==
      originRoster.sourceThreadBinding.tenantId ||
      transitionRoster.sourceThreadBinding.id !==
        originRoster.sourceThreadBinding.id)
  ) {
    addGraphIssue(
      input.context,
      ["transitions", input.transitionIndex, "cause", "evidence"],
      "Provider transition evidence must belong to the episode binding."
    );
  }

  if (
    originRoster &&
    !hasSameProviderOrderingScale(
      originRoster.ordering,
      transitionRoster.ordering
    )
  ) {
    addGraphIssue(
      input.context,
      ["transitions", input.transitionIndex, "cause", "evidence"],
      "Provider transition evidence must use the episode ordering comparator."
    );
  }
}

function addSourceIdentityClaimGraphIssues(
  graph: InboxV2SourceIdentityClaimGraphValue,
  context: z.RefinementCtx
): void {
  const tenantId = graph.identity.tenantId;
  const claims = indexGraphEntities(
    graph.claims,
    context,
    ["claims"],
    "source identity claim"
  );
  indexGraphEntities(
    graph.transitions,
    context,
    ["transitions"],
    "source identity claim transition"
  );

  const orderedTransitions = [...graph.transitions].sort((left, right) =>
    comparePositiveDecimal(left.resultingVersion, right.resultingVersion)
  );
  const creationTransitionsByClaim = new Map<
    string,
    InboxV2SourceIdentityClaimTransition[]
  >();
  const terminatingTransitionsByClaim = new Map<
    string,
    InboxV2SourceIdentityClaimTransition[]
  >();

  for (const [index, transition] of orderedTransitions.entries()) {
    const expectedResult = String(index + 1);
    const expectedPrevious = index === 0 ? null : String(index);

    if (
      transition.tenantId !== tenantId ||
      transition.sourceExternalIdentity.id !== graph.identity.id
    ) {
      addGraphIssue(
        context,
        ["transitions", index, "sourceExternalIdentity"],
        "Claim transition must belong to the graph source identity."
      );
    }

    if (
      transition.resultingVersion !== expectedResult ||
      transition.currentVersion !== expectedPrevious ||
      transition.expectedVersion !== expectedPrevious
    ) {
      addGraphIssue(
        context,
        ["transitions", index, "resultingVersion"],
        "Claim transition history must be contiguous from version 1."
      );
    }

    const previousTransition = orderedTransitions[index - 1];

    if (
      previousTransition &&
      !isInboxV2TimestampOrderValid(
        previousTransition.occurredAt,
        transition.occurredAt
      )
    ) {
      addGraphIssue(
        context,
        ["transitions", index, "occurredAt"],
        "Claim transition time cannot move backwards."
      );
    }

    addClaimTransitionGraphLinkIssues({
      graph,
      context,
      transition,
      transitionIndex: index,
      claims
    });

    if (transition.operation.kind === "revoke") {
      appendGraphIndex(
        terminatingTransitionsByClaim,
        String(transition.operation.activeClaim.id),
        transition
      );
    } else {
      appendGraphIndex(
        creationTransitionsByClaim,
        String(transition.operation.resultingClaim.id),
        transition
      );
      if (transition.operation.previousClaim !== null) {
        appendGraphIndex(
          terminatingTransitionsByClaim,
          String(transition.operation.previousClaim.claim.id),
          transition
        );
      }
    }
  }

  for (const [index, claim] of graph.claims.entries()) {
    if (
      claim.tenantId !== tenantId ||
      claim.sourceExternalIdentity.id !== graph.identity.id
    ) {
      addGraphIssue(
        context,
        ["claims", index, "sourceExternalIdentity"],
        "Claim must belong to the graph source identity."
      );
    }

    const creationTransitions =
      creationTransitionsByClaim.get(String(claim.id)) ?? [];
    const terminatingTransitions =
      terminatingTransitionsByClaim.get(String(claim.id)) ?? [];

    if (creationTransitions.length !== 1) {
      addGraphIssue(
        context,
        ["claims", index],
        "Each claim requires exactly one creation transition."
      );
    }
    if (claim.status === "active" && terminatingTransitions.length !== 0) {
      addGraphIssue(
        context,
        ["claims", index, "status"],
        "Active claim cannot have a terminating transition."
      );
    }
    if (claim.status === "revoked") {
      if (terminatingTransitions.length !== 1) {
        addGraphIssue(
          context,
          ["claims", index, "status"],
          "Revoked claim requires exactly one audited terminating transition."
        );
      } else if (
        claim.revocation?.revokedAt !== terminatingTransitions[0]?.occurredAt
      ) {
        addGraphIssue(
          context,
          ["claims", index, "revocation"],
          "Claim revocation time must match its terminating transition."
        );
      }
    }
  }

  const latestTransition = orderedTransitions.at(-1);
  const expectedHead = latestTransition?.resultingVersion ?? null;

  if (graph.identity.latestClaimVersion !== expectedHead) {
    addGraphIssue(
      context,
      ["identity", "latestClaimVersion"],
      "Source identity claim head must match the latest transition."
    );
  }

  const activeClaims = graph.claims.filter(
    (claim) => claim.status === "active"
  );

  if (graph.identity.resolution.status === "claimed") {
    const activeClaim = claims.get(
      String(graph.identity.resolution.activeClaim.id)
    );

    if (
      !activeClaim ||
      activeClaim.status !== "active" ||
      activeClaim.claimVersion !== graph.identity.latestClaimVersion ||
      activeClaims.length !== 1
    ) {
      addGraphIssue(
        context,
        ["identity", "resolution"],
        "Claimed resolution must point to the sole active claim at the current head."
      );
    }
  } else if (activeClaims.length !== 0) {
    addGraphIssue(
      context,
      ["identity", "resolution"],
      "Unresolved or conflicted identity cannot retain an active canonical claim."
    );
  }
}

function addClaimTransitionGraphLinkIssues(input: {
  graph: InboxV2SourceIdentityClaimGraphValue;
  context: z.RefinementCtx;
  transition: InboxV2SourceIdentityClaimTransition;
  transitionIndex: number;
  claims: Map<string, InboxV2SourceIdentityClaim>;
}): void {
  const operation = input.transition.operation;

  if (operation.kind === "revoke") {
    const claim = input.claims.get(String(operation.activeClaim.id));

    if (
      !claim ||
      !sameClaimTarget(claim.target, operation.target) ||
      BigInt(claim.claimVersion) >= BigInt(input.transition.resultingVersion)
    ) {
      addGraphIssue(
        input.context,
        ["transitions", input.transitionIndex, "operation"],
        "Revoke transition must identify the exact active claim and target."
      );
    }
    return;
  }

  const claim = input.claims.get(String(operation.resultingClaim.id));

  if (
    !claim ||
    !sameClaimTarget(claim.target, operation.target) ||
    claim.claimVersion !== input.transition.resultingVersion ||
    claim.previousClaimVersion !== input.transition.expectedVersion ||
    claim.createdAt !== input.transition.occurredAt ||
    claim.policyId !== input.transition.policyId ||
    claim.policyVersion !== input.transition.policyVersion ||
    claim.reasonCodeId !== input.transition.reasonCodeId ||
    !sameClaimDecision(claim.decision, input.transition.decision)
  ) {
    addGraphIssue(
      input.context,
      ["transitions", input.transitionIndex, "operation"],
      "Claim creation transition must match its resulting claim exactly."
    );
  }

  if (operation.previousClaim !== null) {
    const previous = input.claims.get(String(operation.previousClaim.claim.id));

    if (
      !previous ||
      !sameClaimTarget(previous.target, operation.previousClaim.target) ||
      BigInt(previous.claimVersion) >= BigInt(input.transition.resultingVersion)
    ) {
      addGraphIssue(
        input.context,
        ["transitions", input.transitionIndex, "operation", "previousClaim"],
        "Reassignment must identify the exact previous claim and target."
      );
    }
  }
}

function indexGraphEntities<TItem extends { id: string }>(
  items: readonly TItem[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string
): Map<string, TItem> {
  const result = new Map<string, TItem>();

  for (const [index, item] of items.entries()) {
    const id = String(item.id);

    if (result.has(id)) {
      addGraphIssue(
        context,
        [...path, index, "id"],
        `Duplicate ${label} ID in graph.`
      );
    }
    result.set(id, item);
  }

  return result;
}

function appendGraphIndex<TItem>(
  index: Map<string, TItem[]>,
  key: string,
  item: TItem
): void {
  const values = index.get(key) ?? [];
  values.push(item);
  index.set(key, values);
}

function addGraphTenantIssue(
  context: z.RefinementCtx,
  expectedTenantId: string,
  actualTenantId: string,
  path: PropertyKey[]
): void {
  if (expectedTenantId !== actualTenantId) {
    addGraphIssue(
      context,
      path,
      "Membership graph entities must use the participant tenant."
    );
  }
}

function addGraphIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function comparePositiveDecimal(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function sameClaimTarget(
  left: InboxV2SourceIdentityClaimTarget,
  right: InboxV2SourceIdentityClaimTarget
): boolean {
  return claimTargetKey(left) === claimTargetKey(right);
}

function sameClaimDecision(
  left: InboxV2SourceIdentityClaim["decision"],
  right: InboxV2SourceIdentityClaimTransition["decision"]
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "manual" && right.kind === "manual") {
    return (
      left.actorEmployee.tenantId === right.actorEmployee.tenantId &&
      left.actorEmployee.id === right.actorEmployee.id &&
      left.reviewState === right.reviewState
    );
  }

  if (left.kind === "automatic_policy" && right.kind === "automatic_policy") {
    return (
      left.trustedServiceId === right.trustedServiceId &&
      left.reviewState === right.reviewState &&
      left.policyAuthority.family === right.policyAuthority.family &&
      left.policyAuthority.definitionContractVersion ===
        right.policyAuthority.definitionContractVersion &&
      left.policyAuthority.definitionDigestSha256 ===
        right.policyAuthority.definitionDigestSha256 &&
      left.policyAuthority.activationHeadRevision ===
        right.policyAuthority.activationHeadRevision
    );
  }

  if (left.kind === "migration" && right.kind === "migration") {
    return (
      left.trustedServiceId === right.trustedServiceId &&
      left.reviewState === right.reviewState
    );
  }

  return false;
}

function participantSubjectReference(
  subject: InboxV2ConversationParticipantSubject
): { tenantId: string } | null {
  switch (subject.kind) {
    case "employee":
      return subject.employee;
    case "source_external_identity":
      return subject.sourceExternalIdentity;
    case "client_contact":
      return subject.clientContact;
    case "bot":
      return subject.bot;
    case "system":
    case "legacy_unknown":
      return null;
  }
}

function participantSubjectKey(
  subject: InboxV2ConversationParticipantSubject
): string {
  switch (subject.kind) {
    case "employee":
      return `employee\u0000${subject.employee.id}`;
    case "source_external_identity":
      return `source_external_identity\u0000${subject.sourceExternalIdentity.id}`;
    case "client_contact":
      return `client_contact\u0000${subject.clientContact.id}`;
    case "bot":
      return `bot\u0000${subject.bot.id}`;
    case "system":
      return `system\u0000${subject.systemActorId}`;
    case "legacy_unknown":
      return `legacy_unknown\u0000${subject.provenanceCodeId}`;
  }
}

function claimTargetReference(target: InboxV2SourceIdentityClaimTarget): {
  tenantId: string;
} {
  return target.kind === "employee" ? target.employee : target.clientContact;
}

function claimTargetKey(target: InboxV2SourceIdentityClaimTarget): string {
  return target.kind === "employee"
    ? `employee\u0000${target.employee.id}`
    : `client_contact\u0000${target.clientContact.id}`;
}
