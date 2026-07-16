import { z } from "zod";

import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2ExternalThreadKeySchema } from "./external-thread";
import { inboxV2ProviderMessageObjectKindIdSchema } from "./external-message-reference";
import {
  inboxV2NormalizedInboundEventIdSchema,
  inboxV2RawInboundEventIdSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  inboxV2ParticipantMembershipRoleSchema,
  inboxV2ProviderRosterAuthoritySchema,
  inboxV2ProviderRosterCompletenessSchema,
  inboxV2ProviderRosterOmissionPolicySchema,
  inboxV2ProviderRosterOrderingSchema,
  inboxV2ProviderRosterMemberStateSchema,
  inboxV2SourceIdentityObjectKindIdSchema,
  inboxV2SourceIdentityRealmIdSchema
} from "./participant-identity";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaIdSchema,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2AdapterIdentityDeclarationSchema,
  inboxV2ExternalMessageRealmIdSchema,
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema,
  inboxV2SourceCapabilityIdSchema,
  type InboxV2AdapterContractSnapshot
} from "./source-routing-primitives";
import {
  inboxV2RawIngressLeaseTokenSchema,
  inboxV2RawIngressWorkerIdSchema
} from "./source-raw-ingress";
import { inboxV2Sha256DigestSchema } from "./sync-primitives";

export const INBOX_V2_SOURCE_NORMALIZER_PROFILE_SCHEMA_ID =
  "core:inbox-v2.source-normalizer-profile" as const;
export const INBOX_V2_SOURCE_NORMALIZER_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_NORMALIZED_EVENT_ENVELOPE_SCHEMA_ID =
  "core:inbox-v2.normalized-event-envelope" as const;
export const INBOX_V2_NORMALIZED_EVENT_PAYLOAD_SCHEMA_ID =
  "core:inbox-v2.normalized-event-payload" as const;
export const INBOX_V2_NORMALIZED_EVENT_PAYLOAD_DATA_CLASS_ID =
  "core:normalized_event_payload" as const;
export const INBOX_V2_SOURCE_NORMALIZATION_MAX_EVENTS_PER_RAW = 32;
export const INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_EVENT = 8;
export const INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_RAW = 64;

export const INBOX_V2_SOURCE_NORMALIZATION_ALLOWED_PURPOSE_IDS = [
  "core:source_replay_and_diagnostics",
  "core:security_and_fraud_prevention",
  "core:legal_claim_or_regulatory_duty"
] as const;

export const inboxV2SourceNormalizedEventKindSchema = z.enum([
  "message_created",
  "message_edited",
  "message_deleted",
  "reaction_changed",
  "delivery_status_changed",
  "read_receipt",
  "roster_observed",
  "membership_changed"
]);

const sourceNormalizationPurposeIdSchema = z.enum(
  INBOX_V2_SOURCE_NORMALIZATION_ALLOWED_PURPOSE_IDS
);
const sourceNormalizationTransportSchema = z.enum([
  "webhook",
  "polling",
  "stream",
  "email",
  "api"
]);
const sourceNormalizationDirectionSchema = z.enum([
  "inbound",
  "outbound",
  "system"
]);
const sourceNormalizationVisibilitySchema = z.enum([
  "private",
  "public",
  "internal"
]);

const rawIngressSanitizerPinSchema = z
  .object({
    profileSchemaId: inboxV2SchemaIdSchema,
    profileSchemaVersion: inboxV2SchemaVersionTokenSchema,
    handlerId: inboxV2NamespacedIdSchema,
    handlerVersion: inboxV2SchemaVersionTokenSchema,
    declarationRevision: inboxV2EntityRevisionSchema,
    restrictedPayloadSchema: z
      .object({
        schemaId: inboxV2SchemaIdSchema,
        schemaVersion: inboxV2SchemaVersionTokenSchema
      })
      .strict()
  })
  .strict();

const sourceNormalizationEvidenceSlotSchema = z
  .object({
    slotId: inboxV2NamespacedIdSchema,
    schemaId: inboxV2SchemaIdSchema,
    schemaVersion: inboxV2SchemaVersionTokenSchema,
    dataClassId: z.literal(INBOX_V2_NORMALIZED_EVENT_PAYLOAD_DATA_CLASS_ID),
    purposeIds: z
      .array(sourceNormalizationPurposeIdSchema)
      .min(1)
      .max(INBOX_V2_SOURCE_NORMALIZATION_ALLOWED_PURPOSE_IDS.length)
  })
  .strict()
  .superRefine((slot, context) => {
    if (!isCanonicalPurposeSet(slot.purposeIds)) {
      context.addIssue({
        code: "custom",
        path: ["purposeIds"],
        message:
          "Normalized evidence purposes must be unique and canonically ordered."
      });
    }
  });

const sourceNormalizerProfilePayloadSchema = z
  .object({
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    handlerId: inboxV2NamespacedIdSchema,
    handlerVersion: inboxV2SchemaVersionTokenSchema,
    declarationRevision: inboxV2EntityRevisionSchema,
    rawIngressSanitizer: rawIngressSanitizerPinSchema,
    eventKinds: z.array(inboxV2SourceNormalizedEventKindSchema).min(1).max(32),
    identityDeclarations: z
      .array(inboxV2AdapterIdentityDeclarationSchema)
      .max(128),
    evidenceSlots: z.array(sourceNormalizationEvidenceSlotSchema).max(32)
  })
  .strict()
  .superRefine((profile, context) => {
    addUniqueCanonicalIssues(context, profile.eventKinds, ["eventKinds"]);
    addUniqueCanonicalIssues(
      context,
      profile.identityDeclarations.map((declaration) =>
        calculateInboxV2CanonicalSha256(declaration)
      ),
      ["identityDeclarations"]
    );
    addUniqueCanonicalIssues(
      context,
      profile.evidenceSlots.map((slot) => slot.slotId),
      ["evidenceSlots"]
    );
    for (const [index, declaration] of profile.identityDeclarations.entries()) {
      if (
        !hasExactAdapterContract(
          declaration.adapterContract,
          profile.adapterContract
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["identityDeclarations", index, "adapterContract"],
          message:
            "Normalizer identity declarations must pin its exact adapter contract."
        });
      }
    }
  });

export const inboxV2SourceNormalizerProfileSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_NORMALIZER_PROFILE_SCHEMA_ID,
    INBOX_V2_SOURCE_NORMALIZER_SCHEMA_VERSION,
    sourceNormalizerProfilePayloadSchema
  );

export type InboxV2SourceNormalizerProfile = Readonly<
  z.infer<typeof inboxV2SourceNormalizerProfileSchema>
>;

const authenticSourceNormalizerProfiles = new WeakSet<object>();

export function defineInboxV2SourceNormalizerProfile(
  input: z.input<typeof inboxV2SourceNormalizerProfileSchema>
): InboxV2SourceNormalizerProfile {
  const profile = cloneAndFreeze(
    inboxV2SourceNormalizerProfileSchema.parse(assertSafeJsonLike(input))
  );
  authenticSourceNormalizerProfiles.add(profile as object);
  return profile;
}

export function isInboxV2SourceNormalizerProfile(
  value: unknown
): value is InboxV2SourceNormalizerProfile {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticSourceNormalizerProfiles.has(value)
  );
}

const normalizedThreadDescriptorSchema = z
  .object({
    identityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
    key: inboxV2ExternalThreadKeySchema,
    observedExternalSubject: inboxV2OpaqueProviderSubjectSchema
  })
  .strict()
  .superRefine((thread, context) => {
    const declaration = thread.identityDeclaration;
    if (
      declaration.identityKind !== "external_thread" ||
      String(declaration.realmId) !== String(thread.key.realm.realmId) ||
      declaration.realmVersion !== thread.key.realm.realmVersion ||
      declaration.canonicalizationVersion !==
        thread.key.realm.canonicalizationVersion ||
      String(declaration.objectKindId) !== String(thread.key.objectKindId) ||
      declaration.scopeKind !== thread.key.scope.kind
    ) {
      context.addIssue({
        code: "custom",
        path: ["identityDeclaration"],
        message:
          "Thread descriptor and identity declaration must match exactly."
      });
    }
    if (
      thread.observedExternalSubject !== thread.key.canonicalExternalSubject
    ) {
      context.addIssue({
        code: "custom",
        path: ["key", "canonicalExternalSubject"],
        message:
          "Opaque thread subjects must be preserved exactly; implicit trim, case-fold or Unicode normalization is forbidden."
      });
    }
  });

const normalizedMessageScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("provider_thread") }).strict(),
  z
    .object({
      kind: z.literal("source_account"),
      owner: inboxV2SourceAccountReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("source_thread_binding"),
      sourceAccount: inboxV2SourceAccountReferenceSchema
    })
    .strict()
]);

const normalizedMessageDescriptorSchema = z
  .object({
    identityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
    realm: z
      .object({
        realmId: inboxV2ExternalMessageRealmIdSchema,
        realmVersion: inboxV2SchemaVersionTokenSchema,
        canonicalizationVersion: inboxV2SchemaVersionTokenSchema
      })
      .strict(),
    scope: normalizedMessageScopeSchema,
    objectKindId: inboxV2ProviderMessageObjectKindIdSchema,
    observedExternalSubject: inboxV2OpaqueProviderSubjectSchema,
    canonicalExternalSubject: inboxV2OpaqueProviderSubjectSchema
  })
  .strict()
  .superRefine((message, context) => {
    const declaration = message.identityDeclaration;
    if (
      declaration.identityKind !== "message" ||
      String(declaration.realmId) !== String(message.realm.realmId) ||
      declaration.realmVersion !== message.realm.realmVersion ||
      declaration.canonicalizationVersion !==
        message.realm.canonicalizationVersion ||
      String(declaration.objectKindId) !== String(message.objectKindId) ||
      declaration.scopeKind !== message.scope.kind
    ) {
      context.addIssue({
        code: "custom",
        path: ["identityDeclaration"],
        message:
          "Message descriptor and identity declaration must match exactly."
      });
    }
    if (message.observedExternalSubject !== message.canonicalExternalSubject) {
      context.addIssue({
        code: "custom",
        path: ["canonicalExternalSubject"],
        message:
          "Opaque message subjects must be preserved exactly; implicit canonicalization is forbidden."
      });
    }
  });

const normalizedSourceIdentityScopeSchema = z.discriminatedUnion("kind", [
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

const normalizedIdentityObservationSchema = z
  .object({
    observationKey: inboxV2RoutingTokenSchema,
    purpose: z.enum([
      "message_author",
      "action_actor",
      "membership_subject",
      "roster_member"
    ]),
    identityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
    realm: z
      .object({
        realmId: inboxV2SourceIdentityRealmIdSchema,
        realmVersion: inboxV2SchemaVersionTokenSchema,
        canonicalizationVersion: inboxV2SchemaVersionTokenSchema
      })
      .strict(),
    scope: normalizedSourceIdentityScopeSchema,
    objectKindId: inboxV2SourceIdentityObjectKindIdSchema,
    observedExternalSubject: inboxV2OpaqueProviderSubjectSchema,
    canonicalExternalSubject: inboxV2OpaqueProviderSubjectSchema,
    stability: z.enum(["stable", "observation_ephemeral"]),
    observedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((identity, context) => {
    const declaration = identity.identityDeclaration;
    if (
      declaration.identityKind !== "source_external_identity" ||
      String(declaration.realmId) !== String(identity.realm.realmId) ||
      declaration.realmVersion !== identity.realm.realmVersion ||
      declaration.canonicalizationVersion !==
        identity.realm.canonicalizationVersion ||
      String(declaration.objectKindId) !== String(identity.objectKindId) ||
      declaration.scopeKind !== identity.scope.kind
    ) {
      context.addIssue({
        code: "custom",
        path: ["identityDeclaration"],
        message:
          "Identity observation and identity declaration must match exactly."
      });
    }
    if (
      identity.observedExternalSubject !== identity.canonicalExternalSubject
    ) {
      context.addIssue({
        code: "custom",
        path: ["canonicalExternalSubject"],
        message:
          "Opaque identity subjects must be preserved exactly; implicit canonicalization is forbidden."
      });
    }
  });

const normalizedRosterObservationSchema = z
  .object({
    completeness: inboxV2ProviderRosterCompletenessSchema,
    authority: inboxV2ProviderRosterAuthoritySchema,
    omissionPolicy: inboxV2ProviderRosterOmissionPolicySchema,
    ordering: inboxV2ProviderRosterOrderingSchema,
    members: z
      .array(
        z
          .object({
            identityObservationKey: inboxV2RoutingTokenSchema,
            state: inboxV2ProviderRosterMemberStateSchema,
            normalizedRole: inboxV2ParticipantMembershipRoleSchema
          })
          .strict()
      )
      .max(10_000),
    observedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((roster, context) => {
    if (
      roster.omissionPolicy === "close_missing" &&
      (roster.completeness !== "complete" ||
        roster.authority !== "authoritative")
    ) {
      context.addIssue({
        code: "custom",
        path: ["omissionPolicy"],
        message:
          "Only complete authoritative roster evidence may close missing members."
      });
    }
    addUniqueCanonicalIssues(
      context,
      roster.members.map((member) => member.identityObservationKey),
      ["members"]
    );
  });

const normalizedCapabilityObservationSchema = z
  .object({
    schemaId: inboxV2SchemaIdSchema,
    schemaVersion: inboxV2SchemaVersionTokenSchema,
    capabilities: z
      .array(
        z
          .object({
            capabilityId: inboxV2SourceCapabilityIdSchema,
            availability: z.enum(["supported", "unsupported", "unknown"])
          })
          .strict()
      )
      .max(256)
  })
  .strict()
  .superRefine((observation, context) => {
    addUniqueCanonicalIssues(
      context,
      observation.capabilities.map((entry) => String(entry.capabilityId)),
      ["capabilities"]
    );
  });

const normalizedEvidenceDraftSchema = z
  .object({
    slotId: inboxV2NamespacedIdSchema,
    value: z.unknown()
  })
  .strict();

const normalizedSemanticSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("message_created"),
      originKind: z.enum([
        "webhook",
        "polling",
        "stream",
        "history",
        "provider_echo"
      ]),
      authorObservationKey: inboxV2RoutingTokenSchema.nullable()
    })
    .strict(),
  z
    .object({
      kind: z.literal("message_edited"),
      actorObservationKey: inboxV2RoutingTokenSchema.nullable()
    })
    .strict(),
  z
    .object({
      kind: z.literal("message_deleted"),
      actorObservationKey: inboxV2RoutingTokenSchema.nullable()
    })
    .strict(),
  z
    .object({
      kind: z.literal("reaction_changed"),
      actorObservationKey: inboxV2RoutingTokenSchema,
      operation: z.enum(["set", "replace", "clear"])
    })
    .strict(),
  z
    .object({
      kind: z.literal("delivery_status_changed"),
      status: z.enum(["accepted", "sent", "delivered", "failed"])
    })
    .strict(),
  z.object({ kind: z.literal("read_receipt") }).strict(),
  z.object({ kind: z.literal("roster_observed") }).strict(),
  z
    .object({
      kind: z.literal("membership_changed"),
      identityObservationKey: inboxV2RoutingTokenSchema,
      state: z.enum(["pending", "active", "left", "removed"]),
      normalizedRole: inboxV2ParticipantMembershipRoleSchema
    })
    .strict()
]);

const normalizedEventDraftSchema = z
  .object({
    direction: sourceNormalizationDirectionSchema,
    visibility: sourceNormalizationVisibilitySchema,
    payloadVersion: inboxV2SchemaVersionTokenSchema,
    providerOccurredAt: inboxV2TimestampSchema.nullable(),
    semantic: normalizedSemanticSchema,
    thread: normalizedThreadDescriptorSchema,
    message: normalizedMessageDescriptorSchema.nullable(),
    identityObservations: z
      .array(normalizedIdentityObservationSchema)
      .max(10_000),
    rosterObservation: normalizedRosterObservationSchema.nullable(),
    capabilityObservation: normalizedCapabilityObservationSchema,
    evidence: z
      .array(normalizedEvidenceDraftSchema)
      .max(INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_EVENT)
  })
  .strict()
  .superRefine((event, context) => {
    const kind = event.semantic.kind;
    const needsMessage = !["roster_observed", "membership_changed"].includes(
      kind
    );
    if (needsMessage !== (event.message !== null)) {
      context.addIssue({
        code: "custom",
        path: ["message"],
        message:
          "Message and lifecycle events require one exact message descriptor; roster/membership observations do not."
      });
    }
    if ((kind === "roster_observed") !== (event.rosterObservation !== null)) {
      context.addIssue({
        code: "custom",
        path: ["rosterObservation"],
        message:
          "Roster metadata belongs only to an explicit roster_observed event."
      });
    }
    const keys = event.identityObservations.map(
      (observation) => observation.observationKey
    );
    addUniqueCanonicalIssues(context, keys, ["identityObservations"]);
    const keySet = new Set(keys);
    for (const [path, reference] of semanticObservationReferences(
      event.semantic
    )) {
      if (reference !== null && !keySet.has(reference)) {
        context.addIssue({
          code: "custom",
          path: [...path],
          message:
            "Semantic identity references must resolve inside the same normalized event."
        });
      }
    }
    for (const [index, member] of (
      event.rosterObservation?.members ?? []
    ).entries()) {
      if (!keySet.has(member.identityObservationKey)) {
        context.addIssue({
          code: "custom",
          path: ["rosterObservation", "members", index],
          message:
            "Roster members must reference an identity observation from the same event."
        });
      }
    }
    addUniqueCanonicalIssues(
      context,
      event.evidence.map((evidence) => evidence.slotId),
      ["evidence"]
    );
  });

export type InboxV2SourceNormalizedEventDraft = z.input<
  typeof normalizedEventDraftSchema
>;

export const inboxV2SourceNormalizerIgnoredReasonSchema = z.enum([
  "source.event_not_actionable",
  "source.event_duplicate_observation",
  "source.event_kind_unsupported"
]);

export const inboxV2SourceNormalizerDecisionSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("emitted"),
        events: z
          .array(normalizedEventDraftSchema)
          .min(1)
          .max(INBOX_V2_SOURCE_NORMALIZATION_MAX_EVENTS_PER_RAW)
      })
      .strict(),
    z
      .object({
        outcome: z.literal("ignored"),
        reasonCode: inboxV2SourceNormalizerIgnoredReasonSchema
      })
      .strict()
  ]
);

export type InboxV2SourceNormalizerDecision = z.input<
  typeof inboxV2SourceNormalizerDecisionSchema
>;

export type InboxV2SourceNormalizationHandlerInput = Readonly<{
  transport: z.infer<typeof sourceNormalizationTransportSchema>;
  sourceConnection: z.infer<typeof inboxV2SourceConnectionReferenceSchema>;
  sourceAccount: z.infer<typeof inboxV2SourceAccountReferenceSchema> | null;
  providerOccurredAt: string | null;
  restrictedPayload: Readonly<Record<string, unknown>>;
}>;

export type InboxV2SourceNormalizerHandler = (
  input: InboxV2SourceNormalizationHandlerInput
) => InboxV2SourceNormalizerDecision | Promise<InboxV2SourceNormalizerDecision>;

export type InboxV2SourceNormalizerEvidenceParser = (value: unknown) => unknown;

export type InboxV2SourceNormalizer = Readonly<{
  profile: InboxV2SourceNormalizerProfile;
}>;

const authenticSourceNormalizers = new WeakSet<object>();
const sourceNormalizerHandlers = new WeakMap<
  object,
  InboxV2SourceNormalizerHandler
>();
const sourceNormalizerRawParsers = new WeakMap<
  object,
  (value: unknown) => unknown
>();
const sourceNormalizerEvidenceParsers = new WeakMap<
  object,
  ReadonlyMap<string, InboxV2SourceNormalizerEvidenceParser>
>();

export function defineInboxV2SourceNormalizer(input: {
  profile: InboxV2SourceNormalizerProfile;
  parseRestrictedPayload: (value: unknown) => unknown;
  evidenceParsers: Readonly<
    Record<string, InboxV2SourceNormalizerEvidenceParser>
  >;
  handler: InboxV2SourceNormalizerHandler;
}): InboxV2SourceNormalizer {
  if (!isInboxV2SourceNormalizerProfile(input.profile)) {
    throw new TypeError(
      "Source normalizer requires an authentic adapter-declared profile."
    );
  }
  if (
    typeof input.handler !== "function" ||
    typeof input.parseRestrictedPayload !== "function"
  ) {
    throw new TypeError("Source normalizer handlers must be callable.");
  }
  const expectedSlots = input.profile.payload.evidenceSlots.map(
    (slot) => slot.slotId
  );
  const parserEntries = ownDataEntries(input.evidenceParsers);
  const providedSlots = parserEntries.map(([slotId]) => slotId).sort();
  if (
    expectedSlots.length !== providedSlots.length ||
    expectedSlots.some((slotId, index) => slotId !== providedSlots[index]) ||
    parserEntries.some(([, parser]) => typeof parser !== "function")
  ) {
    throw new TypeError(
      "Source normalizer must install exactly one parser for every declared evidence slot."
    );
  }
  const normalizer = Object.freeze({ profile: input.profile });
  authenticSourceNormalizers.add(normalizer);
  sourceNormalizerHandlers.set(normalizer, input.handler);
  sourceNormalizerRawParsers.set(normalizer, input.parseRestrictedPayload);
  sourceNormalizerEvidenceParsers.set(
    normalizer,
    new Map(parserEntries as [string, InboxV2SourceNormalizerEvidenceParser][])
  );
  return normalizer;
}

export function isInboxV2SourceNormalizer(
  value: unknown
): value is InboxV2SourceNormalizer {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticSourceNormalizers.has(value)
  );
}

const sourceNormalizationRawInputMetadataSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rawEventId: inboxV2RawInboundEventIdSchema,
    sourceConnectionId: inboxV2SourceConnectionReferenceSchema.shape.id,
    sourceAccountId: inboxV2SourceAccountReferenceSchema.shape.id.nullable(),
    transport: sourceNormalizationTransportSchema,
    providerOccurredAt: inboxV2TimestampSchema.nullable(),
    rawIngressSanitizer: rawIngressSanitizerPinSchema
  })
  .strict();

export type InboxV2SourceNormalizationInput = z.input<
  typeof sourceNormalizationRawInputMetadataSchema
> &
  Readonly<{ restrictedPayload: unknown }>;

export type InboxV2NormalizedEventCandidate = Readonly<
  z.output<typeof normalizedEventDraftSchema> & {
    ordinal: number;
    eventType: z.infer<typeof inboxV2SourceNormalizedEventKindSchema>;
    payloadSchema: Readonly<{
      schemaId: typeof INBOX_V2_NORMALIZED_EVENT_PAYLOAD_SCHEMA_ID;
      schemaVersion: string;
    }>;
    /**
     * Content-free structural diagnostic only. Persistence must calculate a
     * tenant-keyed HMAC over the complete provider-neutral envelope before it
     * can compare idempotency or retain a post-purge fingerprint.
     */
    structuralEnvelopeDigest: z.infer<typeof inboxV2Sha256DigestSchema>;
  }
>;

export type InboxV2SourceNormalizationCandidateBatch = Readonly<{
  tenantId: z.infer<typeof inboxV2TenantIdSchema>;
  rawEventId: z.infer<typeof inboxV2RawInboundEventIdSchema>;
  sourceConnectionId: z.infer<
    typeof inboxV2SourceConnectionReferenceSchema
  >["id"];
  sourceAccountId:
    | z.infer<typeof inboxV2SourceAccountReferenceSchema>["id"]
    | null;
  transport: z.infer<typeof sourceNormalizationTransportSchema>;
  /**
   * Ephemeral binding to the persisted SRC-002 provider-payload evidence.
   * Persistence verifies it and never copies this unkeyed digest into a
   * normalized envelope, result, diagnostic or audit record.
   */
  restrictedPayloadDigestSha256: z.infer<typeof inboxV2Sha256DigestSchema>;
  adapterContract: InboxV2AdapterContractSnapshot;
  rawIngressSanitizer: z.infer<typeof rawIngressSanitizerPinSchema>;
  normalizer: Readonly<{
    profileSchemaId: typeof INBOX_V2_SOURCE_NORMALIZER_PROFILE_SCHEMA_ID;
    profileSchemaVersion: typeof INBOX_V2_SOURCE_NORMALIZER_SCHEMA_VERSION;
    handlerId: string;
    handlerVersion: string;
    declarationRevision: string;
  }>;
  evidenceSlots: readonly z.output<
    typeof sourceNormalizationEvidenceSlotSchema
  >[];
  outcome: "emitted" | "ignored";
  ignoredReasonCode: z.infer<
    typeof inboxV2SourceNormalizerIgnoredReasonSchema
  > | null;
  events: readonly InboxV2NormalizedEventCandidate[];
}>;

const authenticNormalizationCandidateBatches = new WeakSet<object>();

export function isInboxV2SourceNormalizationCandidateBatch(
  value: unknown
): value is InboxV2SourceNormalizationCandidateBatch {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticNormalizationCandidateBatches.has(value)
  );
}

export function assertInboxV2SourceNormalizationCandidateBatch(
  value: unknown
): InboxV2SourceNormalizationCandidateBatch {
  if (!isInboxV2SourceNormalizationCandidateBatch(value)) {
    throw new TypeError(
      "Source-normalization persistence requires an authentic candidate batch."
    );
  }
  return value;
}

/**
 * Tenant-keyed persistence fingerprint. The key and its generation remain in
 * the trusted data-plane; provider/contact/message values are never exposed as
 * a public SHA-256 oracle.
 */
export const inboxV2SourceNormalizationHmacSha256Schema = z
  .string()
  .regex(/^hmac-sha256:[a-f0-9]{64}$/u);

export const inboxV2SourceNormalizationCompletionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rawEventId: inboxV2RawInboundEventIdSchema,
    outcome: z.enum(["normalized", "ignored", "quarantined"]),
    normalizedEventIds: z.array(inboxV2NormalizedInboundEventIdSchema).max(256),
    quarantineId: inboxV2NamespacedIdSchema.nullable(),
    orderedEventHmacSha256: inboxV2SourceNormalizationHmacSha256Schema,
    candidateCompletionHmacSha256: inboxV2SourceNormalizationHmacSha256Schema,
    resultHmacSha256: inboxV2SourceNormalizationHmacSha256Schema,
    completedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((completion, context) => {
    if (
      (completion.outcome === "normalized") !==
        completion.normalizedEventIds.length > 0 ||
      (completion.outcome === "quarantined") !==
        (completion.quarantineId !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Normalization completion outcome, event IDs and quarantine reference are incoherent."
      });
    }
  });

const sourceNormalizationCompletionFailureSchemas = [
  z
    .object({
      outcome: z.literal("not_found"),
      tenantId: inboxV2TenantIdSchema,
      rawEventId: inboxV2RawInboundEventIdSchema
    })
    .strict(),
  z
    .object({
      outcome: z.literal("not_leased"),
      tenantId: inboxV2TenantIdSchema,
      rawEventId: inboxV2RawInboundEventIdSchema
    })
    .strict(),
  z
    .object({
      outcome: z.literal("stale_token"),
      tenantId: inboxV2TenantIdSchema,
      rawEventId: inboxV2RawInboundEventIdSchema,
      currentLeaseRevision: inboxV2EntityRevisionSchema
    })
    .strict(),
  z
    .object({
      outcome: z.literal("lease_expired"),
      tenantId: inboxV2TenantIdSchema,
      rawEventId: inboxV2RawInboundEventIdSchema,
      currentLeaseRevision: inboxV2EntityRevisionSchema,
      expiredAt: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      outcome: z.literal("lease_revision_conflict"),
      tenantId: inboxV2TenantIdSchema,
      rawEventId: inboxV2RawInboundEventIdSchema,
      currentLeaseRevision: inboxV2EntityRevisionSchema
    })
    .strict()
] as const;

export const inboxV2CompleteSourceNormalizationResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("completed"),
        completion: inboxV2SourceNormalizationCompletionSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_completed"),
        completion: inboxV2SourceNormalizationCompletionSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("quarantined"),
        quarantineId: inboxV2NamespacedIdSchema,
        reasonCode: z.literal("source.idempotency_collision")
      })
      .strict(),
    ...sourceNormalizationCompletionFailureSchemas
  ]);

export type InboxV2CompleteSourceNormalizationInput = Readonly<{
  candidate: InboxV2SourceNormalizationCandidateBatch;
  workerId: z.infer<typeof inboxV2RawIngressWorkerIdSchema>;
  leaseToken: z.infer<typeof inboxV2RawIngressLeaseTokenSchema>;
  expectedLeaseRevision: z.infer<typeof inboxV2EntityRevisionSchema>;
}>;

export type InboxV2CompleteSourceNormalizationResult = z.infer<
  typeof inboxV2CompleteSourceNormalizationResultSchema
>;

export type InboxV2LoadClaimedSourceNormalizationInput = Readonly<{
  tenantId: z.infer<typeof inboxV2TenantIdSchema>;
  rawEventId: z.infer<typeof inboxV2RawInboundEventIdSchema>;
  workerId: z.infer<typeof inboxV2RawIngressWorkerIdSchema>;
  leaseToken: z.infer<typeof inboxV2RawIngressLeaseTokenSchema>;
  expectedLeaseRevision: z.infer<typeof inboxV2EntityRevisionSchema>;
}>;

type InboxV2SourceNormalizationLeaseFailure = Extract<
  InboxV2CompleteSourceNormalizationResult,
  {
    outcome:
      | "not_found"
      | "not_leased"
      | "stale_token"
      | "lease_expired"
      | "lease_revision_conflict";
  }
>;

export type InboxV2LoadClaimedSourceNormalizationResult =
  | Readonly<{
      outcome: "loaded";
      sourceTypeId: string;
      sourceName: string;
      raw: InboxV2SourceNormalizationInput;
    }>
  | InboxV2SourceNormalizationLeaseFailure
  | Readonly<{
      outcome: "evidence_unavailable";
      tenantId: z.infer<typeof inboxV2TenantIdSchema>;
      rawEventId: z.infer<typeof inboxV2RawInboundEventIdSchema>;
      reasonCode: "source.evidence_unavailable";
    }>;

export interface InboxV2SourceNormalizationRepositoryPort {
  loadClaimedInput(
    input: InboxV2LoadClaimedSourceNormalizationInput
  ): Promise<InboxV2LoadClaimedSourceNormalizationResult>;
  complete(
    input: InboxV2CompleteSourceNormalizationInput
  ): Promise<InboxV2CompleteSourceNormalizationResult>;
}

export type InboxV2SourceNormalizationErrorCode =
  | "source.normalizer_missing"
  | "source.normalizer_mismatch"
  | "source.normalizer_failed"
  | "source.normalizer_output_invalid"
  | "source.normalized_scope_missing"
  | "source.canonicalization_unsafe"
  | "source.normalized_payload_unsafe"
  | "source.roster_contract_invalid"
  | "source.lifecycle_gap"
  | "source.evidence_unavailable"
  | "source.evidence_classification_invalid"
  | "source.idempotency_collision";

export class InboxV2SourceNormalizationError extends Error {
  constructor(
    readonly code: InboxV2SourceNormalizationErrorCode,
    readonly retryable: boolean
  ) {
    super(code);
    this.name = "InboxV2SourceNormalizationError";
  }
}

export async function executeInboxV2SourceNormalizer(input: {
  normalizer: InboxV2SourceNormalizer;
  raw: InboxV2SourceNormalizationInput;
}): Promise<InboxV2SourceNormalizationCandidateBatch> {
  if (!isInboxV2SourceNormalizer(input.normalizer)) {
    throw normalizationError("source.normalizer_missing", false);
  }
  const metadataResult = sourceNormalizationRawInputMetadataSchema.safeParse({
    tenantId: input.raw.tenantId,
    rawEventId: input.raw.rawEventId,
    sourceConnectionId: input.raw.sourceConnectionId,
    sourceAccountId: input.raw.sourceAccountId,
    transport: input.raw.transport,
    providerOccurredAt: input.raw.providerOccurredAt,
    rawIngressSanitizer: input.raw.rawIngressSanitizer
  });
  if (!metadataResult.success) {
    throw normalizationError("source.normalized_scope_missing", false);
  }
  const metadata = metadataResult.data;
  const profile = input.normalizer.profile;
  if (
    calculateInboxV2CanonicalSha256(metadata.rawIngressSanitizer) !==
    calculateInboxV2CanonicalSha256(profile.payload.rawIngressSanitizer)
  ) {
    throw normalizationError("source.normalizer_mismatch", false);
  }

  const parseRestrictedPayload = sourceNormalizerRawParsers.get(
    input.normalizer
  );
  const handler = sourceNormalizerHandlers.get(input.normalizer);
  const evidenceParsers = sourceNormalizerEvidenceParsers.get(input.normalizer);
  if (
    parseRestrictedPayload === undefined ||
    handler === undefined ||
    evidenceParsers === undefined
  ) {
    throw normalizationError("source.normalizer_missing", false);
  }

  let restrictedPayload: Readonly<Record<string, unknown>>;
  try {
    const parsed = parseRestrictedPayload(input.raw.restrictedPayload);
    const cloned = cloneSafeJsonObject(parsed);
    if (!cloned.success) {
      throw new TypeError("unsafe");
    }
    restrictedPayload = cloned.value;
  } catch {
    throw normalizationError("source.normalized_payload_unsafe", false);
  }

  const handlerInput = cloneAndFreeze({
    transport: metadata.transport,
    sourceConnection: {
      tenantId: metadata.tenantId,
      kind: "source_connection" as const,
      id: metadata.sourceConnectionId
    },
    sourceAccount:
      metadata.sourceAccountId === null
        ? null
        : {
            tenantId: metadata.tenantId,
            kind: "source_account" as const,
            id: metadata.sourceAccountId
          },
    providerOccurredAt: metadata.providerOccurredAt,
    restrictedPayload
  });
  const restrictedPayloadDigestSha256 =
    calculateInboxV2CanonicalSha256(restrictedPayload);

  const output = await callNormalizer(handler, handlerInput);
  const decisionResult =
    inboxV2SourceNormalizerDecisionSchema.safeParse(output);
  if (!decisionResult.success) {
    throw normalizationError("source.normalizer_output_invalid", false);
  }
  const decision = decisionResult.data;
  if (
    decision.outcome === "emitted" &&
    decision.events.reduce((count, event) => count + event.evidence.length, 0) >
      INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_RAW
  ) {
    throw normalizationError("source.normalizer_output_invalid", false);
  }
  if (decision.outcome === "ignored") {
    return authenticateBatch({
      ...batchMetadata(metadata, profile, restrictedPayloadDigestSha256),
      outcome: "ignored",
      ignoredReasonCode: decision.reasonCode,
      events: []
    });
  }

  const events: InboxV2NormalizedEventCandidate[] = [];
  for (const [ordinal, draft] of decision.events.entries()) {
    validateEventAgainstBoundary(draft, metadata, profile, evidenceParsers);
    const safeEnvelope = {
      domain: "core:inbox-v2.normalized-event-safe-envelope",
      ordinal,
      eventType: draft.semantic.kind,
      direction: draft.direction,
      visibility: draft.visibility,
      payloadVersion: draft.payloadVersion,
      providerOccurredAt: draft.providerOccurredAt,
      identityObservationCount: draft.identityObservations.length,
      roster:
        draft.rosterObservation === null
          ? null
          : {
              completeness: draft.rosterObservation.completeness,
              authority: draft.rosterObservation.authority,
              omissionPolicy: draft.rosterObservation.omissionPolicy,
              memberCount: draft.rosterObservation.members.length
            },
      capabilitySchema: {
        schemaId: draft.capabilityObservation.schemaId,
        schemaVersion: draft.capabilityObservation.schemaVersion,
        count: draft.capabilityObservation.capabilities.length
      },
      evidenceSlots: draft.evidence.map((evidence) => evidence.slotId),
      normalizer: normalizerMetadata(profile)
    };
    events.push(
      cloneAndFreeze({
        ...draft,
        ordinal,
        eventType: draft.semantic.kind,
        payloadSchema: {
          schemaId: INBOX_V2_NORMALIZED_EVENT_PAYLOAD_SCHEMA_ID,
          schemaVersion: draft.payloadVersion
        },
        structuralEnvelopeDigest: calculateInboxV2CanonicalSha256(safeEnvelope)
      }) as InboxV2NormalizedEventCandidate
    );
  }
  return authenticateBatch({
    ...batchMetadata(metadata, profile, restrictedPayloadDigestSha256),
    outcome: "emitted",
    ignoredReasonCode: null,
    events
  });
}

/**
 * Contract-test harness for adapter certification. Production processing must
 * call `executeInboxV2SourceNormalizer` directly so a normalizer is evaluated
 * exactly once for each raw event.
 */
export async function assertInboxV2SourceNormalizerDeterministic(input: {
  normalizer: InboxV2SourceNormalizer;
  raw: InboxV2SourceNormalizationInput;
}): Promise<InboxV2SourceNormalizationCandidateBatch> {
  const first = await executeInboxV2SourceNormalizer(input);
  const second = await executeInboxV2SourceNormalizer(input);
  if (
    calculateInboxV2CanonicalSha256(first) !==
    calculateInboxV2CanonicalSha256(second)
  ) {
    throw normalizationError("source.normalizer_output_invalid", false);
  }
  return first;
}

async function callNormalizer(
  handler: InboxV2SourceNormalizerHandler,
  input: InboxV2SourceNormalizationHandlerInput
): Promise<unknown> {
  let output: unknown;
  try {
    output = await handler(cloneAndFreeze(input));
  } catch {
    throw normalizationError("source.normalizer_failed", true);
  }
  try {
    return assertSafeJsonLike(output);
  } catch {
    throw normalizationError("source.normalizer_output_invalid", false);
  }
}

function validateEventAgainstBoundary(
  event: z.output<typeof normalizedEventDraftSchema>,
  metadata: z.output<typeof sourceNormalizationRawInputMetadataSchema>,
  profile: InboxV2SourceNormalizerProfile,
  evidenceParsers: ReadonlyMap<string, InboxV2SourceNormalizerEvidenceParser>
): void {
  if (!profile.payload.eventKinds.includes(event.semantic.kind)) {
    throw normalizationError("source.normalizer_output_invalid", false);
  }
  const declarations = [
    event.thread.identityDeclaration,
    ...(event.message === null ? [] : [event.message.identityDeclaration]),
    ...event.identityObservations.map(
      (observation) => observation.identityDeclaration
    )
  ];
  const declared = new Set(
    profile.payload.identityDeclarations.map((declaration) =>
      calculateInboxV2CanonicalSha256(declaration)
    )
  );
  if (
    declarations.some(
      (declaration) =>
        !declared.has(calculateInboxV2CanonicalSha256(declaration))
    )
  ) {
    throw normalizationError("source.normalizer_mismatch", false);
  }
  validateThreadScope(event.thread, metadata);
  if (event.message !== null) validateMessageScope(event.message, metadata);
  for (const observation of event.identityObservations) {
    validateIdentityScope(observation, metadata);
  }
  if (
    event.providerOccurredAt !== null &&
    metadata.providerOccurredAt !== null &&
    event.providerOccurredAt !== metadata.providerOccurredAt
  ) {
    throw normalizationError("source.normalizer_output_invalid", false);
  }
  for (const evidence of event.evidence) {
    const parser = evidenceParsers.get(evidence.slotId);
    if (parser === undefined) {
      throw normalizationError("source.evidence_classification_invalid", false);
    }
    try {
      const parsed = parser(evidence.value);
      const cloned = cloneSafeJsonObject(parsed);
      if (!cloned.success) throw new TypeError("unsafe");
      (evidence as { value: unknown }).value = cloned.value;
    } catch {
      throw normalizationError("source.normalized_payload_unsafe", false);
    }
  }
}

function validateThreadScope(
  thread: z.output<typeof normalizedThreadDescriptorSchema>,
  metadata: z.output<typeof sourceNormalizationRawInputMetadataSchema>
): void {
  const { scope } = thread.key;
  if (
    (scope.kind === "source_connection" &&
      !sameOwner(
        scope.owner,
        metadata.tenantId,
        metadata.sourceConnectionId
      )) ||
    (scope.kind === "source_account" &&
      (metadata.sourceAccountId === null ||
        !sameOwner(scope.owner, metadata.tenantId, metadata.sourceAccountId)))
  ) {
    throw normalizationError("source.normalized_scope_missing", false);
  }
}

function validateMessageScope(
  message: z.output<typeof normalizedMessageDescriptorSchema>,
  metadata: z.output<typeof sourceNormalizationRawInputMetadataSchema>
): void {
  if (message.scope.kind === "provider_thread") return;
  const owner =
    message.scope.kind === "source_account"
      ? message.scope.owner
      : message.scope.sourceAccount;
  if (
    metadata.sourceAccountId === null ||
    !sameOwner(owner, metadata.tenantId, metadata.sourceAccountId)
  ) {
    throw normalizationError("source.normalized_scope_missing", false);
  }
}

function validateIdentityScope(
  identity: z.output<typeof normalizedIdentityObservationSchema>,
  metadata: z.output<typeof sourceNormalizationRawInputMetadataSchema>
): void {
  const { scope } = identity;
  if (scope.kind === "provider") return;
  const expectedId =
    scope.kind === "source_connection"
      ? metadata.sourceConnectionId
      : metadata.sourceAccountId;
  if (
    expectedId === null ||
    !sameOwner(scope.owner, metadata.tenantId, expectedId)
  ) {
    throw normalizationError("source.normalized_scope_missing", false);
  }
}

function sameOwner(
  owner: Readonly<{ tenantId: string; id: string }>,
  tenantId: string,
  id: string
): boolean {
  return owner.tenantId === tenantId && owner.id === id;
}

function batchMetadata(
  metadata: z.output<typeof sourceNormalizationRawInputMetadataSchema>,
  profile: InboxV2SourceNormalizerProfile,
  restrictedPayloadDigestSha256: z.infer<typeof inboxV2Sha256DigestSchema>
) {
  return {
    tenantId: metadata.tenantId,
    rawEventId: metadata.rawEventId,
    sourceConnectionId: metadata.sourceConnectionId,
    sourceAccountId: metadata.sourceAccountId,
    transport: metadata.transport,
    restrictedPayloadDigestSha256,
    adapterContract: profile.payload.adapterContract,
    rawIngressSanitizer: metadata.rawIngressSanitizer,
    normalizer: normalizerMetadata(profile),
    evidenceSlots: profile.payload.evidenceSlots
  } as const;
}

function normalizerMetadata(profile: InboxV2SourceNormalizerProfile) {
  return {
    profileSchemaId: profile.schemaId,
    profileSchemaVersion: profile.schemaVersion,
    handlerId: profile.payload.handlerId,
    handlerVersion: profile.payload.handlerVersion,
    declarationRevision: profile.payload.declarationRevision
  } as const;
}

function authenticateBatch(
  batch: InboxV2SourceNormalizationCandidateBatch
): InboxV2SourceNormalizationCandidateBatch {
  const frozen = cloneAndFreeze(batch);
  authenticNormalizationCandidateBatches.add(frozen as object);
  return frozen;
}

function semanticObservationReferences(
  semantic: z.output<typeof normalizedSemanticSchema>
): readonly [readonly (string | number)[], string | null][] {
  switch (semantic.kind) {
    case "message_created":
      return [
        [["semantic", "authorObservationKey"], semantic.authorObservationKey]
      ];
    case "message_edited":
    case "message_deleted":
      return [
        [["semantic", "actorObservationKey"], semantic.actorObservationKey]
      ];
    case "reaction_changed":
      return [
        [["semantic", "actorObservationKey"], semantic.actorObservationKey]
      ];
    case "membership_changed":
      return [
        [
          ["semantic", "identityObservationKey"],
          semantic.identityObservationKey
        ]
      ];
    default:
      return [];
  }
}

function hasExactAdapterContract(
  left: InboxV2AdapterContractSnapshot,
  right: InboxV2AdapterContractSnapshot
): boolean {
  return (
    calculateInboxV2CanonicalSha256(left) ===
    calculateInboxV2CanonicalSha256(right)
  );
}

function isCanonicalPurposeSet(values: readonly string[]): boolean {
  const positions = values.map((value) =>
    INBOX_V2_SOURCE_NORMALIZATION_ALLOWED_PURPOSE_IDS.indexOf(
      value as (typeof INBOX_V2_SOURCE_NORMALIZATION_ALLOWED_PURPOSE_IDS)[number]
    )
  );
  return (
    new Set(values).size === values.length &&
    positions.every(
      (position, index) =>
        position >= 0 && (index === 0 || position > positions[index - 1]!)
    )
  );
}

function addUniqueCanonicalIssues(
  context: z.RefinementCtx,
  values: readonly string[],
  path: (string | number)[]
): void {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => index > 0 && value <= values[index - 1]!)
  ) {
    context.addIssue({
      code: "custom",
      path,
      message: "Values must be unique and canonically sorted."
    });
  }
}

function normalizationError(
  code: InboxV2SourceNormalizationErrorCode,
  retryable: boolean
): InboxV2SourceNormalizationError {
  return new InboxV2SourceNormalizationError(code, retryable);
}

type JsonPrimitive = null | boolean | number | string;
type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;
type JsonObject = Readonly<{ [key: string]: JsonValue }>;

function assertSafeJsonLike(value: unknown): JsonValue {
  const cloned = cloneSafeJsonValue(value, new Set<object>(), 0, { nodes: 0 });
  if (
    new TextEncoder().encode(JSON.stringify(cloned)).byteLength >
    4 * 1024 * 1024
  ) {
    throw new TypeError("Source normalizer value exceeds its byte budget.");
  }
  return cloned;
}

function cloneSafeJsonObject(
  value: unknown
):
  | Readonly<{ success: true; value: JsonObject }>
  | Readonly<{ success: false }> {
  try {
    const cloned = assertSafeJsonLike(value);
    if (
      cloned === null ||
      typeof cloned !== "object" ||
      Array.isArray(cloned)
    ) {
      return { success: false };
    }
    return { success: true, value: cloned as JsonObject };
  } catch {
    return { success: false };
  }
}

function cloneSafeJsonValue(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  state: { nodes: number }
): JsonValue {
  state.nodes += 1;
  if (depth > 64 || state.nodes > 100_000) throw new TypeError("unsafe");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("unsafe");
    return value;
  }
  if (typeof value === "string") {
    if (
      value.length > 4 * 1024 * 1024 ||
      hasInvalidUnicode(value) ||
      value.includes("\u0000")
    ) {
      throw new TypeError("unsafe");
    }
    return value;
  }
  if (typeof value !== "object" || value === null)
    throw new TypeError("unsafe");
  const prototype = Object.getPrototypeOf(value);
  if (
    (Array.isArray(value) && prototype !== Array.prototype) ||
    (!Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null)
  ) {
    throw new TypeError("unsafe");
  }
  if (ancestors.has(value)) throw new TypeError("unsafe");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 10_000) throw new TypeError("unsafe");
      const keys = Reflect.ownKeys(value);
      if (
        keys.length !== value.length + 1 ||
        keys.some(
          (key) =>
            key !== "length" &&
            (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key))
        )
      ) {
        throw new TypeError("unsafe");
      }
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index)
        );
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          throw new TypeError("unsafe");
        }
        output.push(
          cloneSafeJsonValue(descriptor.value, ancestors, depth + 1, state)
        );
      }
      return output;
    }
    const output = Object.create(null) as Record<string, JsonValue>;
    const keys = Reflect.ownKeys(value);
    if (keys.length > 10_000) throw new TypeError("unsafe");
    for (const key of keys) {
      if (
        typeof key !== "string" ||
        key.length === 0 ||
        key.length > 256 ||
        hasInvalidUnicode(key) ||
        hasForbiddenControlCharacter(key) ||
        isSecretLikeKey(key)
      ) {
        throw new TypeError("unsafe");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new TypeError("unsafe");
      }
      Object.defineProperty(output, key, {
        value: cloneSafeJsonValue(
          descriptor.value,
          ancestors,
          depth + 1,
          state
        ),
        enumerable: true,
        configurable: false,
        writable: false
      });
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function ownDataEntries(value: unknown): [string, unknown][] {
  if (
    value === null ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError("Expected a plain parser map.");
  }
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError("Invalid parser key.");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError("Invalid parser descriptor.");
    }
    entries.push([key, descriptor.value]);
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

function cloneAndFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError("Unsafe array prototype.");
    }
    const clone: unknown[] = [];
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key))
      )
    ) {
      throw new TypeError("Unsafe array descriptor.");
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new TypeError("Unsafe array descriptor.");
      }
      clone.push(cloneAndFreeze(descriptor.value));
    }
    return Object.freeze(clone) as TValue;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Unsafe object prototype.");
  }
  const clone = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError("Unsafe symbol key.");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError("Unsafe object descriptor.");
    }
    Object.defineProperty(clone, key, {
      value: cloneAndFreeze(descriptor.value),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  return Object.freeze(clone) as TValue;
}

function isSecretLikeKey(value: string): boolean {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/gu, "");
  if (compact === "scopetoken") return false;
  return [
    "authorization",
    "cookie",
    "password",
    "passwd",
    "passphrase",
    "token",
    "session",
    "secret",
    "apikey",
    "privatekey",
    "credential"
  ].some((fragment) => compact.includes(fragment));
}

function hasInvalidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasForbiddenControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}
