import { z } from "zod";

import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2NormalizedInboundEventIdSchema,
  inboxV2RawInboundEventIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  calculateInboxV2CanonicalSha256,
  calculateInboxV2BytesSha256
} from "./recipient-sync-hash";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaIdSchema,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema,
  inboxV2SourceDiagnosticIdSchema
} from "./source-routing-primitives";
import { inboxV2Sha256DigestSchema } from "./sync-primitives";

export const INBOX_V2_RAW_INGRESS_SANITIZER_PROFILE_SCHEMA_ID =
  "core:inbox-v2.raw-ingress-sanitizer-profile" as const;
export const INBOX_V2_RAW_INGRESS_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_RAW_PROVIDER_PAYLOAD_DATA_CLASS_ID =
  "core:raw_provider_payload" as const;
export const INBOX_V2_RAW_PROVIDER_ALLOWED_HEADERS_DATA_CLASS_ID =
  "core:raw_provider_allowed_headers" as const;
export const INBOX_V2_RAW_INGRESS_ALLOWED_PURPOSE_IDS = [
  "core:source_replay_and_diagnostics",
  "core:security_and_fraud_prevention",
  "core:legal_claim_or_regulatory_duty"
] as const;
export const INBOX_V2_RAW_ADMISSION_PURPOSE_ID =
  "core:source_replay_and_diagnostics" as const;
export const INBOX_V2_RAW_ADMISSION_MAX_LOOKUP_CANDIDATES = 8;

const rawIngressTransportSchema = z.enum([
  "webhook",
  "polling",
  "stream",
  "email",
  "api"
]);
const rawIngressIdentityKindSchema = z.enum([
  "provider_event_id",
  "provider_signature",
  "client_idempotency_key",
  "stable_fingerprint"
]);
const persistedHeaderNameSchema = z
  .string()
  .min(1)
  .max(127)
  .regex(/^[a-z0-9][a-z0-9-]*$/u)
  .refine((value) => !isSecretHeaderName(value), {
    message:
      "Persisted raw-ingress header allowlist cannot contain credential headers."
  });
const leaseDurationSecondsSchema = z.number().int().min(1).max(300);
const claimBatchSizeSchema = z.number().int().min(1).max(1_000);

const rawIngressPurposeIdSchema = z.enum(
  INBOX_V2_RAW_INGRESS_ALLOWED_PURPOSE_IDS
);

function rawIngressClassificationSchema<const TDataClassId extends string>(
  dataClassId: TDataClassId
) {
  return z
    .object({
      dataClassId: z.literal(dataClassId),
      purposeIds: z.array(rawIngressPurposeIdSchema).min(1).max(3)
    })
    .strict()
    .superRefine((classification, context) => {
      const positions = classification.purposeIds.map((purposeId) =>
        INBOX_V2_RAW_INGRESS_ALLOWED_PURPOSE_IDS.indexOf(purposeId)
      );
      if (
        new Set(classification.purposeIds).size !==
          classification.purposeIds.length ||
        positions.some(
          (position, index) =>
            index > 0 && position <= (positions[index - 1] ?? -1)
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["purposeIds"],
          message:
            "Raw-ingress lifecycle purposes must be unique and in canonical replay/security/legal order."
        });
      }
    });
}

export const inboxV2RawProviderPayloadClassificationSchema =
  rawIngressClassificationSchema(INBOX_V2_RAW_PROVIDER_PAYLOAD_DATA_CLASS_ID);
export const inboxV2RawProviderAllowedHeadersClassificationSchema =
  rawIngressClassificationSchema(
    INBOX_V2_RAW_PROVIDER_ALLOWED_HEADERS_DATA_CLASS_ID
  );

const rawIngressSanitizerProfilePayloadSchema = z
  .object({
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    handlerId: inboxV2NamespacedIdSchema,
    handlerVersion: inboxV2SchemaVersionTokenSchema,
    declarationRevision: inboxV2EntityRevisionSchema,
    restrictedPayloadSchema: z
      .object({
        schemaId: inboxV2SchemaIdSchema,
        schemaVersion: inboxV2SchemaVersionTokenSchema
      })
      .strict(),
    persistedHeaderNames: z.array(persistedHeaderNameSchema).max(64),
    payloadClassification: inboxV2RawProviderPayloadClassificationSchema,
    allowedHeadersClassification:
      inboxV2RawProviderAllowedHeadersClassificationSchema
  })
  .strict()
  .superRefine((profile, context) => {
    if (
      new Set(profile.persistedHeaderNames).size !==
        profile.persistedHeaderNames.length ||
      profile.persistedHeaderNames.some(
        (name, index) =>
          index > 0 && name <= profile.persistedHeaderNames[index - 1]!
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["persistedHeaderNames"],
        message:
          "Persisted raw-ingress header names must be unique and canonically sorted."
      });
    }
  });

export const inboxV2RawIngressSanitizerProfileSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_RAW_INGRESS_SANITIZER_PROFILE_SCHEMA_ID,
    INBOX_V2_RAW_INGRESS_SCHEMA_VERSION,
    rawIngressSanitizerProfilePayloadSchema
  );

export type InboxV2RawIngressSanitizerProfile = Readonly<
  z.infer<typeof inboxV2RawIngressSanitizerProfileSchema>
>;

const authenticSanitizerProfiles = new WeakSet<object>();

export function defineInboxV2RawIngressSanitizerProfile(
  input: z.input<typeof inboxV2RawIngressSanitizerProfileSchema>
): InboxV2RawIngressSanitizerProfile {
  const profile = cloneAndFreeze(
    inboxV2RawIngressSanitizerProfileSchema.parse(input)
  );
  authenticSanitizerProfiles.add(profile as object);
  return profile;
}

export function isInboxV2RawIngressSanitizerProfile(
  value: unknown
): value is InboxV2RawIngressSanitizerProfile {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticSanitizerProfiles.has(value)
  );
}

export const inboxV2RawIngressSanitizerQuarantineReasonSchema = z.enum([
  "source.payload_shape_unknown",
  "source.sanitizer_rejected"
]);

export const inboxV2RawIngressQuarantineReasonSchema = z.enum([
  "source.payload_shape_unknown",
  "source.payload_malformed",
  "source.headers_malformed",
  "source.sanitizer_rejected",
  "source.sanitizer_failed",
  "source.sanitizer_output_invalid",
  "source.idempotency_collision"
]);

export const inboxV2RawIngressSanitizerDecisionSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("accepted"),
        restrictedPayload: z.unknown(),
        validatedAllowedHeaders: z.unknown()
      })
      .strict(),
    z
      .object({
        outcome: z.literal("quarantined"),
        reasonCode: inboxV2RawIngressSanitizerQuarantineReasonSchema
      })
      .strict()
  ]
);

export type InboxV2RawIngressSanitizerDecision = z.infer<
  typeof inboxV2RawIngressSanitizerDecisionSchema
>;

export type InboxV2RawIngressEphemeralHeaders = Record<
  string,
  string | string[]
>;

export type InboxV2RawIngressSanitizerHandlerInput = Readonly<{
  transport: z.infer<typeof rawIngressTransportSchema>;
  body: Uint8Array;
  headers: Readonly<Record<string, readonly string[]>>;
}>;

export type InboxV2RawIngressSanitizerHandler = (
  input: InboxV2RawIngressSanitizerHandlerInput
) =>
  | InboxV2RawIngressSanitizerDecision
  | Promise<InboxV2RawIngressSanitizerDecision>;

export type InboxV2RawIngressRestrictedPayloadParser = (
  value: unknown
) => unknown;

/**
 * Process-local adapter capability. The handler is intentionally absent from
 * the serializable profile and can only be installed by trusted composition.
 */
export type InboxV2RawIngressSanitizer = Readonly<{
  profile: InboxV2RawIngressSanitizerProfile;
}>;

const authenticSanitizers = new WeakSet<object>();
const sanitizerHandlers = new WeakMap<
  object,
  InboxV2RawIngressSanitizerHandler
>();
const sanitizerRestrictedPayloadParsers = new WeakMap<
  object,
  InboxV2RawIngressRestrictedPayloadParser
>();

export function defineInboxV2RawIngressSanitizer(input: {
  profile: InboxV2RawIngressSanitizerProfile;
  handler: InboxV2RawIngressSanitizerHandler;
  parseRestrictedPayload: InboxV2RawIngressRestrictedPayloadParser;
}): InboxV2RawIngressSanitizer {
  if (!isInboxV2RawIngressSanitizerProfile(input.profile)) {
    throw new TypeError(
      "Raw-ingress sanitizer requires an authentic adapter-declared profile."
    );
  }
  if (typeof input.handler !== "function") {
    throw new TypeError("Raw-ingress sanitizer handler must be callable.");
  }
  if (typeof input.parseRestrictedPayload !== "function") {
    throw new TypeError(
      "Raw-ingress sanitizer requires its declared restricted-payload parser."
    );
  }
  const sanitizer = Object.freeze({ profile: input.profile });
  authenticSanitizers.add(sanitizer);
  sanitizerHandlers.set(sanitizer, input.handler);
  sanitizerRestrictedPayloadParsers.set(
    sanitizer,
    input.parseRestrictedPayload
  );
  return sanitizer;
}

export function isInboxV2RawIngressSanitizer(
  value: unknown
): value is InboxV2RawIngressSanitizer {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticSanitizers.has(value)
  );
}

const rawIngressCandidateMetadataSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    sourceConnectionId: inboxV2SourceConnectionIdSchema,
    sourceAccountId: inboxV2SourceAccountIdSchema.nullable(),
    transport: rawIngressTransportSchema,
    eventIdentity: z
      .object({
        kind: rawIngressIdentityKindSchema,
        value: inboxV2OpaqueProviderSubjectSchema
      })
      .strict(),
    providerOccurredAt: inboxV2TimestampSchema.nullable(),
    receivedAt: inboxV2TimestampSchema,
    sanitizedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((metadata, context) => {
    if (
      !isInboxV2TimestampOrderValid(metadata.receivedAt, metadata.sanitizedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sanitizedAt"],
        message: "Raw-ingress sanitization cannot precede receipt."
      });
    }
  });

export type InboxV2RawIngressInput = z.input<
  typeof rawIngressCandidateMetadataSchema
> &
  Readonly<{
    body: Uint8Array;
    headers: InboxV2RawIngressEphemeralHeaders;
  }>;

export type InboxV2RawIngressLifecycleClassification = Readonly<{
  dataClassId:
    | typeof INBOX_V2_RAW_PROVIDER_PAYLOAD_DATA_CLASS_ID
    | typeof INBOX_V2_RAW_PROVIDER_ALLOWED_HEADERS_DATA_CLASS_ID;
  purposeIds: readonly (typeof INBOX_V2_RAW_INGRESS_ALLOWED_PURPOSE_IDS)[number][];
}>;

export type InboxV2RawIngressAllowedHeader = Readonly<{
  name: string;
  values: readonly string[];
}>;

const rawIngressValidatedAllowedHeadersSchema = z
  .array(
    z
      .object({
        name: persistedHeaderNameSchema,
        values: z
          .array(
            z
              .string()
              .min(1)
              .max(8_192)
              .refine(
                (value) =>
                  !hasForbiddenControlCharacter(value, true) &&
                  !hasInvalidUnicode(value),
                { message: "Persisted raw-ingress header value is invalid." }
              )
          )
          .min(1)
          .max(32)
      })
      .strict()
  )
  .max(64)
  .superRefine((headers, context) => {
    const names = headers.map(({ name }) => name);
    if (
      new Set(names).size !== names.length ||
      names.some((name, index) => index > 0 && name <= names[index - 1]!)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Validated raw-ingress headers must be unique and canonically sorted."
      });
    }
    const valueCount = headers.reduce(
      (count, header) => count + header.values.length,
      0
    );
    const totalBytes = headers.reduce(
      (count, header) =>
        count +
        header.values.reduce(
          (headerBytes, value) =>
            headerBytes +
            new TextEncoder().encode(header.name).byteLength +
            new TextEncoder().encode(value).byteLength,
          0
        ),
      0
    );
    if (valueCount > 256 || totalBytes > 64 * 1024) {
      context.addIssue({
        code: "custom",
        message: "Validated raw-ingress headers exceed their evidence budget."
      });
    }
  });

export type InboxV2SanitizedRawIngressCandidate = Readonly<{
  tenantId: z.infer<typeof inboxV2TenantIdSchema>;
  sourceConnectionId: z.infer<typeof inboxV2SourceConnectionIdSchema>;
  sourceAccountId: z.infer<typeof inboxV2SourceAccountIdSchema> | null;
  transport: z.infer<typeof rawIngressTransportSchema>;
  /** Transient identity capability; repositories must never persist this raw value. */
  eventIdentity: Readonly<{
    kind: z.infer<typeof rawIngressIdentityKindSchema>;
    value: string;
  }>;
  providerOccurredAt: string | null;
  receivedAt: string;
  sanitizedAt: string;
  sanitizer: Readonly<{
    profileSchemaId: typeof INBOX_V2_RAW_INGRESS_SANITIZER_PROFILE_SCHEMA_ID;
    profileSchemaVersion: typeof INBOX_V2_RAW_INGRESS_SCHEMA_VERSION;
    handlerId: z.infer<typeof inboxV2NamespacedIdSchema>;
    handlerVersion: z.infer<typeof inboxV2SchemaVersionTokenSchema>;
    declarationRevision: z.infer<typeof inboxV2EntityRevisionSchema>;
    restrictedPayloadSchema: Readonly<{
      schemaId: z.infer<typeof inboxV2SchemaIdSchema>;
      schemaVersion: z.infer<typeof inboxV2SchemaVersionTokenSchema>;
    }>;
    adapterContract: z.infer<typeof inboxV2AdapterContractSnapshotSchema>;
  }>;
  disposition:
    | Readonly<{
        outcome: "accepted";
        restrictedPayload: Readonly<{
          classification: InboxV2RawIngressLifecycleClassification;
          value: JsonObject;
        }>;
        allowedHeaders: Readonly<{
          classification: InboxV2RawIngressLifecycleClassification;
          values: readonly InboxV2RawIngressAllowedHeader[];
        }>;
      }>
    | Readonly<{
        outcome: "quarantined";
        reasonCode: z.infer<typeof inboxV2RawIngressQuarantineReasonSchema>;
      }>;
  safeEnvelopeDigest: z.infer<typeof inboxV2Sha256DigestSchema>;
}>;

/**
 * Tenant/purpose-keyed admission is the production authority for raw-event
 * identity. `identityMaterial` is consumed transiently by the authority; only
 * the returned HMAC candidates may cross the persistence boundary.
 */
export const inboxV2RawAdmissionSourceScopeSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    sourceConnectionId: inboxV2SourceConnectionIdSchema,
    sourceAccountId: inboxV2SourceAccountIdSchema.nullable()
  })
  .strict();

export const inboxV2RawAdmissionKeyGenerationSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export const inboxV2RawAdmissionTenantSecretRefSchema = z
  .string()
  .min(8)
  .max(512)
  .regex(/^secret:[A-Za-z0-9][A-Za-z0-9._~:/-]*$/u);

export const inboxV2RawAdmissionIdentityHmacSha256Schema = z
  .string()
  .regex(/^hmac-sha256:[0-9a-f]{64}$/u);
export const inboxV2RawPersistedSafeEnvelopeDigestSchema = z.union([
  inboxV2Sha256DigestSchema,
  inboxV2RawAdmissionIdentityHmacSha256Schema
]);

export const inboxV2RawAdmissionIdentityCandidateSchema = z
  .object({
    generation: inboxV2RawAdmissionKeyGenerationSchema,
    hmacKeySecretRef: inboxV2RawAdmissionTenantSecretRefSchema,
    identityHmacSha256: inboxV2RawAdmissionIdentityHmacSha256Schema,
    safeEnvelopeHmacSha256: inboxV2RawAdmissionIdentityHmacSha256Schema
  })
  .strict();

export const inboxV2AuthorizeRawAdmissionInputSchema = z
  .object({
    source: inboxV2RawAdmissionSourceScopeSchema,
    identityKind: rawIngressIdentityKindSchema,
    purposeId: z.literal(INBOX_V2_RAW_ADMISSION_PURPOSE_ID),
    /** Ephemeral clear identity; implementations must not retain or log it. */
    identityMaterial: inboxV2OpaqueProviderSubjectSchema,
    /** Ephemeral unkeyed sanitizer digest; only its tenant-keyed HMAC persists. */
    safeEnvelopeMaterialDigest: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2RawAdmissionAuthorizationDecisionSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("authorized"),
        source: inboxV2RawAdmissionSourceScopeSchema,
        identityKind: rawIngressIdentityKindSchema,
        purposeId: z.literal(INBOX_V2_RAW_ADMISSION_PURPOSE_ID),
        writeCandidate: inboxV2RawAdmissionIdentityCandidateSchema,
        candidates: z
          .array(inboxV2RawAdmissionIdentityCandidateSchema)
          .min(1)
          .max(INBOX_V2_RAW_ADMISSION_MAX_LOOKUP_CANDIDATES)
          .readonly(),
        guaranteeUntil: inboxV2TimestampSchema
      })
      .strict()
      .superRefine((decision, context) => {
        const generations = decision.candidates.map(
          (candidate) => candidate.generation
        );
        const hmacs = decision.candidates.map(
          (candidate) => candidate.identityHmacSha256
        );
        const envelopeHmacs = decision.candidates.map(
          (candidate) => candidate.safeEnvelopeHmacSha256
        );
        if (
          new Set(generations).size !== generations.length ||
          new Set(hmacs).size !== hmacs.length ||
          new Set(envelopeHmacs).size !== envelopeHmacs.length
        ) {
          context.addIssue({
            code: "custom",
            path: ["candidates"],
            message:
              "Raw admission candidates require unique generations and HMACs."
          });
        }
        if (
          !decision.candidates.some(
            (candidate) =>
              candidate.generation === decision.writeCandidate.generation &&
              candidate.hmacKeySecretRef ===
                decision.writeCandidate.hmacKeySecretRef &&
              candidate.identityHmacSha256 ===
                decision.writeCandidate.identityHmacSha256 &&
              candidate.safeEnvelopeHmacSha256 ===
                decision.writeCandidate.safeEnvelopeHmacSha256
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["writeCandidate"],
            message:
              "Raw admission write candidate must be present in the lookup set."
          });
        }
        for (const [index, candidate] of decision.candidates.entries()) {
          if (
            !candidate.hmacKeySecretRef.startsWith(
              `secret:${decision.source.tenantId}/`
            )
          ) {
            context.addIssue({
              code: "custom",
              path: ["candidates", index, "hmacKeySecretRef"],
              message:
                "Raw admission key reference must belong to the exact tenant."
            });
          }
        }
      }),
    z
      .object({
        outcome: z.literal("rejected"),
        reason: z.enum(["key_unavailable", "scope_mismatch"])
      })
      .strict()
  ]);

export type InboxV2AuthorizeRawAdmissionInput = z.infer<
  typeof inboxV2AuthorizeRawAdmissionInputSchema
>;
export type InboxV2RawAdmissionAuthorizationDecision = z.infer<
  typeof inboxV2RawAdmissionAuthorizationDecisionSchema
>;
export type InboxV2RawAdmissionIdentityCandidate = z.infer<
  typeof inboxV2RawAdmissionIdentityCandidateSchema
>;

export interface InboxV2RawAdmissionAuthorityPort {
  authorizeRawAdmission(
    input: Readonly<InboxV2AuthorizeRawAdmissionInput>
  ): Promise<InboxV2RawAdmissionAuthorizationDecision>;
}

export const inboxV2RawAdmissionSkeletonHandoffInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rawEventId: inboxV2RawInboundEventIdSchema,
    expectedAdmissionRevision: inboxV2EntityRevisionSchema,
    handedOffAt: inboxV2TimestampSchema,
    terminalSkeletonId: inboxV2RoutingTokenSchema,
    terminalOutcomeHmacSha256: inboxV2RawAdmissionIdentityHmacSha256Schema
  })
  .strict();

export const inboxV2LoadPendingRawAdmissionInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rawEventId: inboxV2RawInboundEventIdSchema
  })
  .strict();

export const inboxV2RawAdmissionSealedSkeletonInputSchema = z
  .object({
    source: inboxV2RawAdmissionSourceScopeSchema,
    rawEventId: inboxV2RawInboundEventIdSchema,
    identityKind: rawIngressIdentityKindSchema,
    purposeId: z.literal(INBOX_V2_RAW_ADMISSION_PURPOSE_ID),
    keyGeneration: inboxV2RawAdmissionKeyGenerationSchema,
    hmacKeySecretRef: inboxV2RawAdmissionTenantSecretRefSchema,
    identityHmacSha256: inboxV2RawAdmissionIdentityHmacSha256Schema,
    safeEnvelopeDigest: inboxV2RawAdmissionIdentityHmacSha256Schema,
    guaranteeUntil: inboxV2TimestampSchema,
    admissionRevision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((sealed, context) => {
    if (
      sealed.source.tenantId !==
      sealed.hmacKeySecretRef.slice("secret:".length).split("/", 1)[0]
    ) {
      context.addIssue({
        code: "custom",
        path: ["hmacKeySecretRef"],
        message: "Sealed raw skeleton key must belong to the exact tenant."
      });
    }
  });

export const inboxV2RawAdmissionSafeTerminalMaterialSchema = z
  .object({
    target: z.discriminatedUnion("phase", [
      z
        .object({
          phase: z.literal("raw"),
          rawEventId: inboxV2RawInboundEventIdSchema,
          normalizedEventId: z.null()
        })
        .strict(),
      z
        .object({
          phase: z.literal("normalized"),
          rawEventId: inboxV2RawInboundEventIdSchema,
          normalizedEventId: inboxV2NormalizedInboundEventIdSchema
        })
        .strict()
    ]),
    terminalOutcome: z
      .object({
        kind: z.enum(["processed", "ignored", "duplicate", "dead_lettered"]),
        diagnosticCodeId: inboxV2SourceDiagnosticIdSchema.nullable()
      })
      .strict()
      .superRefine((outcome, context) => {
        const requiresDiagnostic =
          outcome.kind === "ignored" || outcome.kind === "dead_lettered";
        if (requiresDiagnostic !== (outcome.diagnosticCodeId !== null)) {
          context.addIssue({
            code: "custom",
            path: ["diagnosticCodeId"],
            message:
              "Only ignored and dead-lettered raw outcomes retain a safe diagnostic code."
          });
        }
      }),
    terminalAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2SealRawAdmissionTerminalOutcomeInputSchema = z
  .object({
    admission: inboxV2RawAdmissionSealedSkeletonInputSchema,
    material: inboxV2RawAdmissionSafeTerminalMaterialSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (input.material.target.rawEventId !== input.admission.rawEventId) {
      context.addIssue({
        code: "custom",
        path: ["material", "target", "rawEventId"],
        message: "Terminal material must target the admitted raw event."
      });
    }
    if (
      Date.parse(input.material.terminalAt) >=
      Date.parse(input.admission.guaranteeUntil)
    ) {
      context.addIssue({
        code: "custom",
        path: ["material", "terminalAt"],
        message: "Terminal outcome must be sealed before the finite guarantee."
      });
    }
  });

export const inboxV2SealRawAdmissionTerminalOutcomeResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("sealed"),
        source: inboxV2RawAdmissionSourceScopeSchema,
        rawEventId: inboxV2RawInboundEventIdSchema,
        purposeId: z.literal(INBOX_V2_RAW_ADMISSION_PURPOSE_ID),
        admissionRevision: inboxV2EntityRevisionSchema,
        keyGeneration: inboxV2RawAdmissionKeyGenerationSchema,
        hmacKeySecretRef: inboxV2RawAdmissionTenantSecretRefSchema,
        identityHmacSha256: inboxV2RawAdmissionIdentityHmacSha256Schema,
        material: inboxV2RawAdmissionSafeTerminalMaterialSchema,
        outcomeHmacSha256: inboxV2RawAdmissionIdentityHmacSha256Schema
      })
      .strict()
      .superRefine((seal, context) => {
        if (
          !seal.hmacKeySecretRef.startsWith(`secret:${seal.source.tenantId}/`)
        ) {
          context.addIssue({
            code: "custom",
            path: ["hmacKeySecretRef"],
            message: "Terminal outcome key must belong to the exact tenant."
          });
        }
        if (seal.material.target.rawEventId !== seal.rawEventId) {
          context.addIssue({
            code: "custom",
            path: ["material", "target", "rawEventId"],
            message: "Terminal outcome seal must target its admitted raw event."
          });
        }
      }),
    z
      .object({
        outcome: z.literal("rejected"),
        reason: z.enum([
          "key_unavailable",
          "scope_mismatch",
          "key_mismatch",
          "material_mismatch"
        ])
      })
      .strict()
  ]);

export type InboxV2SealRawAdmissionTerminalOutcomeInput = z.infer<
  typeof inboxV2SealRawAdmissionTerminalOutcomeInputSchema
>;
export type InboxV2SealRawAdmissionTerminalOutcomeResult = z.infer<
  typeof inboxV2SealRawAdmissionTerminalOutcomeResultSchema
>;

export function isInboxV2RawAdmissionTerminalOutcomeSealForInput(
  input: InboxV2SealRawAdmissionTerminalOutcomeInput,
  result: InboxV2SealRawAdmissionTerminalOutcomeResult
): result is Extract<
  InboxV2SealRawAdmissionTerminalOutcomeResult,
  Readonly<{ outcome: "sealed" }>
> {
  return (
    result.outcome === "sealed" &&
    JSON.stringify(result.source) === JSON.stringify(input.admission.source) &&
    result.rawEventId === input.admission.rawEventId &&
    result.purposeId === input.admission.purposeId &&
    result.admissionRevision === input.admission.admissionRevision &&
    result.keyGeneration === input.admission.keyGeneration &&
    result.hmacKeySecretRef === input.admission.hmacKeySecretRef &&
    result.identityHmacSha256 === input.admission.identityHmacSha256 &&
    JSON.stringify(result.material) === JSON.stringify(input.material)
  );
}

export interface InboxV2RawAdmissionTerminalOutcomeSealingPort {
  sealTerminalDedupeOutcome(
    input: Readonly<InboxV2SealRawAdmissionTerminalOutcomeInput>
  ): Promise<InboxV2SealRawAdmissionTerminalOutcomeResult>;
}

export const inboxV2RawAdmissionSkeletonHandoffResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.enum(["handed_off", "already_handed_off"]),
        handedOffAt: inboxV2TimestampSchema,
        terminalSkeletonId: inboxV2RoutingTokenSchema,
        terminalOutcomeHmacSha256: inboxV2RawAdmissionIdentityHmacSha256Schema,
        sealedSkeleton: inboxV2RawAdmissionSealedSkeletonInputSchema
      })
      .strict(),
    z
      .object({
        outcome: z.enum([
          "not_found",
          "revision_conflict",
          "guarantee_expired",
          "integrity_failure"
        ])
      })
      .strict()
  ]);

export const inboxV2LoadPendingRawAdmissionResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("pending"),
        snapshot: inboxV2RawAdmissionSealedSkeletonInputSchema
      })
      .strict(),
    z
      .object({
        outcome: z.enum([
          "not_found",
          "not_pending",
          "guarantee_expired",
          "integrity_failure"
        ])
      })
      .strict()
  ]
);

export type InboxV2RawAdmissionSkeletonHandoffInput = z.infer<
  typeof inboxV2RawAdmissionSkeletonHandoffInputSchema
>;
export type InboxV2LoadPendingRawAdmissionInput = z.infer<
  typeof inboxV2LoadPendingRawAdmissionInputSchema
>;
export type InboxV2LoadPendingRawAdmissionResult = z.infer<
  typeof inboxV2LoadPendingRawAdmissionResultSchema
>;
export type InboxV2RawAdmissionSealedSkeletonInput = z.infer<
  typeof inboxV2RawAdmissionSealedSkeletonInputSchema
>;
export type InboxV2RawAdmissionSkeletonHandoffResult = z.infer<
  typeof inboxV2RawAdmissionSkeletonHandoffResultSchema
>;

/** Implement this inside the caller's terminal database transaction. */
export interface InboxV2RawAdmissionSkeletonHandoffPort {
  handoffRawAdmissionSkeleton(
    input: Readonly<InboxV2RawAdmissionSkeletonHandoffInput>
  ): Promise<InboxV2RawAdmissionSkeletonHandoffResult>;
}

export interface InboxV2RawAdmissionPreflightPort {
  loadPendingDedupeAdmission(
    input: Readonly<InboxV2LoadPendingRawAdmissionInput>
  ): Promise<InboxV2LoadPendingRawAdmissionResult>;
}

export type InboxV2SanitizeRawIngressResult =
  | Readonly<{
      outcome: "accepted";
      candidate: InboxV2SanitizedRawIngressCandidate;
    }>
  | Readonly<{
      outcome: "quarantined";
      candidate: InboxV2SanitizedRawIngressCandidate;
    }>;

const authenticSanitizedCandidates = new WeakSet<object>();

export function isInboxV2SanitizedRawIngressCandidate(
  value: unknown
): value is InboxV2SanitizedRawIngressCandidate {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticSanitizedCandidates.has(value)
  );
}

export function assertInboxV2SanitizedRawIngressCandidate(
  value: unknown
): InboxV2SanitizedRawIngressCandidate {
  if (!isInboxV2SanitizedRawIngressCandidate(value)) {
    throw new TypeError(
      "Raw-ingress persistence requires an authentic sanitized candidate."
    );
  }
  return value;
}

/**
 * Consumes one raw request. Caller-owned byte/header containers are scrubbed,
 * the handler receives isolated working copies, and those copies are scrubbed
 * again before the promise settles. The adapter returns only its explicitly
 * validated header subset and its declared payload parser must accept the
 * projected payload before either can become durable evidence.
 */
export async function sanitizeInboxV2RawIngress(input: {
  sanitizer: InboxV2RawIngressSanitizer;
  request: InboxV2RawIngressInput;
}): Promise<InboxV2SanitizeRawIngressResult> {
  if (!isInboxV2RawIngressSanitizer(input.sanitizer)) {
    zeroEphemeralRequest(input.request);
    throw new TypeError(
      "Raw-ingress sanitization requires an authentic sanitizer capability."
    );
  }

  const metadataResult = rawIngressCandidateMetadataSchema.safeParse({
    tenantId: input.request.tenantId,
    sourceConnectionId: input.request.sourceConnectionId,
    sourceAccountId: input.request.sourceAccountId,
    transport: input.request.transport,
    eventIdentity: input.request.eventIdentity,
    providerOccurredAt: input.request.providerOccurredAt,
    receivedAt: input.request.receivedAt,
    sanitizedAt: input.request.sanitizedAt
  });
  const body =
    input.request.body instanceof Uint8Array
      ? new Uint8Array(input.request.body)
      : null;
  const headersResult = cloneEphemeralHeaders(input.request.headers);
  zeroEphemeralRequest(input.request);

  if (!metadataResult.success) {
    zeroBytes(body);
    scrubHeaders(headersResult.headers);
    throw new TypeError("Raw-ingress scope metadata is invalid.");
  }

  const metadata = metadataResult.data;
  const profile = input.sanitizer.profile;
  const handler = sanitizerHandlers.get(input.sanitizer as object);
  const parseRestrictedPayload = sanitizerRestrictedPayloadParsers.get(
    input.sanitizer as object
  );
  if (handler === undefined || parseRestrictedPayload === undefined) {
    zeroBytes(body);
    scrubHeaders(headersResult.headers);
    throw new TypeError("Raw-ingress sanitizer capability is not installed.");
  }

  if (body === null || body.byteLength > 8 * 1024 * 1024) {
    zeroBytes(body);
    scrubHeaders(headersResult.headers);
    return buildQuarantineCandidate(
      metadata,
      profile,
      "source.payload_malformed"
    );
  }
  if (!headersResult.valid) {
    zeroBytes(body);
    scrubHeaders(headersResult.headers);
    return buildQuarantineCandidate(
      metadata,
      profile,
      "source.headers_malformed"
    );
  }

  let rawDecision: unknown;
  try {
    rawDecision = await handler({
      transport: metadata.transport,
      body,
      headers: headersResult.headers
    });
  } catch {
    return buildQuarantineCandidate(
      metadata,
      profile,
      "source.sanitizer_failed"
    );
  } finally {
    zeroBytes(body);
    scrubHeaders(headersResult.headers);
  }

  const decision =
    inboxV2RawIngressSanitizerDecisionSchema.safeParse(rawDecision);
  if (!decision.success) {
    return buildQuarantineCandidate(
      metadata,
      profile,
      "source.sanitizer_output_invalid"
    );
  }
  if (decision.data.outcome === "quarantined") {
    return buildQuarantineCandidate(
      metadata,
      profile,
      decision.data.reasonCode
    );
  }

  let parsedRestrictedPayload: unknown;
  try {
    parsedRestrictedPayload = parseRestrictedPayload(
      decision.data.restrictedPayload
    );
  } catch {
    return buildQuarantineCandidate(
      metadata,
      profile,
      "source.payload_shape_unknown"
    );
  }
  const payload = cloneSafeJson(parsedRestrictedPayload);
  if (!payload.success) {
    return buildQuarantineCandidate(
      metadata,
      profile,
      "source.payload_shape_unknown"
    );
  }
  const allowedHeaders = cloneValidatedAllowedHeaders(
    decision.data.validatedAllowedHeaders,
    profile.payload.persistedHeaderNames
  );
  if (!allowedHeaders.success) {
    return buildQuarantineCandidate(
      metadata,
      profile,
      "source.sanitizer_output_invalid"
    );
  }

  const disposition = {
    outcome: "accepted" as const,
    restrictedPayload: {
      classification: profile.payload.payloadClassification,
      value: payload.value
    },
    allowedHeaders: {
      classification: profile.payload.allowedHeadersClassification,
      values: allowedHeaders.value
    }
  };
  const candidate = authenticateCandidate(
    metadata,
    profile,
    disposition,
    calculateSafeEnvelopeDigest(metadata, profile, disposition)
  );
  return Object.freeze({ outcome: "accepted" as const, candidate });
}

function buildQuarantineCandidate(
  metadata: z.infer<typeof rawIngressCandidateMetadataSchema>,
  profile: InboxV2RawIngressSanitizerProfile,
  reasonCode: z.infer<typeof inboxV2RawIngressQuarantineReasonSchema>
): InboxV2SanitizeRawIngressResult {
  const disposition = { outcome: "quarantined" as const, reasonCode };
  const candidate = authenticateCandidate(
    metadata,
    profile,
    disposition,
    calculateSafeEnvelopeDigest(metadata, profile, disposition)
  );
  return Object.freeze({ outcome: "quarantined" as const, candidate });
}

function authenticateCandidate(
  metadata: z.infer<typeof rawIngressCandidateMetadataSchema>,
  profile: InboxV2RawIngressSanitizerProfile,
  disposition: InboxV2SanitizedRawIngressCandidate["disposition"],
  safeEnvelopeDigest: z.infer<typeof inboxV2Sha256DigestSchema>
): InboxV2SanitizedRawIngressCandidate {
  const candidate = cloneAndFreeze({
    ...metadata,
    sanitizer: sanitizerMetadata(profile),
    disposition,
    safeEnvelopeDigest
  }) as InboxV2SanitizedRawIngressCandidate;
  authenticSanitizedCandidates.add(candidate as object);
  return candidate;
}

function sanitizerMetadata(profile: InboxV2RawIngressSanitizerProfile) {
  return {
    profileSchemaId: profile.schemaId,
    profileSchemaVersion: profile.schemaVersion,
    handlerId: profile.payload.handlerId,
    handlerVersion: profile.payload.handlerVersion,
    declarationRevision: profile.payload.declarationRevision,
    restrictedPayloadSchema: profile.payload.restrictedPayloadSchema,
    adapterContract: profile.payload.adapterContract
  } as const;
}

function calculateSafeEnvelopeDigest(
  metadata: z.infer<typeof rawIngressCandidateMetadataSchema>,
  profile: InboxV2RawIngressSanitizerProfile,
  disposition: InboxV2SanitizedRawIngressCandidate["disposition"]
) {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.raw-ingress-safe-envelope",
    hashVersion: "v1",
    scope: {
      tenantId: metadata.tenantId,
      sourceConnectionId: metadata.sourceConnectionId,
      sourceAccountId: metadata.sourceAccountId,
      transport: metadata.transport,
      eventIdentityKind: metadata.eventIdentity.kind
    },
    providerOccurredAt: metadata.providerOccurredAt,
    sanitizer: sanitizerMetadata(profile),
    disposition
  });
}

type JsonPrimitive = null | boolean | number | string;
type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;
type JsonObject = Readonly<{ [key: string]: JsonValue }>;

type SafeJsonCloneResult =
  | Readonly<{ success: true; value: JsonObject }>
  | Readonly<{ success: false }>;

function cloneSafeJson(value: unknown): SafeJsonCloneResult {
  const state = {
    depth: 0,
    nodes: 0,
    ancestors: new Set<object>()
  };
  try {
    const cloned = cloneSafeJsonValue(value, state, 0);
    if (
      cloned === null ||
      typeof cloned !== "object" ||
      Array.isArray(cloned) ||
      new TextEncoder().encode(JSON.stringify(cloned)).byteLength >
        4 * 1024 * 1024
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
  state: { depth: number; nodes: number; ancestors: Set<object> },
  depth: number
): JsonValue {
  state.nodes += 1;
  state.depth = Math.max(state.depth, depth);
  if (state.nodes > 100_000 || state.depth > 64) {
    throw new TypeError("Unsafe raw payload shape.");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (
      typeof value === "string" &&
      (value.length > 4 * 1024 * 1024 ||
        hasInvalidUnicode(value) ||
        value.includes("\u0000"))
    ) {
      throw new TypeError("Unsafe raw payload string.");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Unsafe raw payload number.");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Unsafe raw payload value.");
  }
  if (state.ancestors.has(value)) {
    throw new TypeError("Cyclic raw payload.");
  }
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError("Unsafe raw payload array prototype.");
      }
      const keys = Reflect.ownKeys(value);
      if (
        keys.length !== value.length + 1 ||
        keys.some(
          (key) =>
            key !== "length" &&
            (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key))
        )
      ) {
        throw new TypeError("Unsafe raw payload array.");
      }
      const clone: JsonValue[] = [];
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
          throw new TypeError("Unsafe raw payload array descriptor.");
        }
        clone.push(cloneSafeJsonValue(descriptor.value, state, depth + 1));
      }
      return clone;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Unsafe raw payload object prototype.");
    }
    const clone = Object.create(null) as Record<string, JsonValue>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new TypeError("Unsafe raw payload symbol key.");
      }
      if (
        key.length === 0 ||
        key.length > 256 ||
        hasInvalidUnicode(key) ||
        hasForbiddenControlCharacter(key, false) ||
        isSecretPayloadKey(key)
      ) {
        throw new TypeError("Unsafe raw payload key.");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new TypeError("Unsafe raw payload descriptor.");
      }
      Object.defineProperty(clone, key, {
        value: cloneSafeJsonValue(descriptor.value, state, depth + 1),
        enumerable: true,
        configurable: false,
        writable: false
      });
    }
    return clone;
  } finally {
    state.ancestors.delete(value);
  }
}

function cloneEphemeralHeaders(headers: unknown): {
  valid: boolean;
  headers: Record<string, string[]>;
} {
  const normalized: Record<string, string[]> = {};
  if (
    headers === null ||
    typeof headers !== "object" ||
    (Object.getPrototypeOf(headers) !== Object.prototype &&
      Object.getPrototypeOf(headers) !== null)
  ) {
    return { valid: false, headers: normalized };
  }
  let totalBytes = 0;
  let valueCount = 0;
  try {
    for (const key of Reflect.ownKeys(headers)) {
      if (typeof key !== "string") {
        return { valid: false, headers: normalized };
      }
      const descriptor = Object.getOwnPropertyDescriptor(headers, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,127}$/u.test(key)
      ) {
        return { valid: false, headers: normalized };
      }
      const rawValues = Array.isArray(descriptor.value)
        ? descriptor.value
        : [descriptor.value];
      if (
        rawValues.length === 0 ||
        rawValues.some(
          (value) =>
            typeof value !== "string" ||
            value.length > 8_192 ||
            hasForbiddenControlCharacter(value, true) ||
            hasInvalidUnicode(value)
        )
      ) {
        return { valid: false, headers: normalized };
      }
      const name = key.toLowerCase();
      const values = (normalized[name] ??= []);
      for (const value of rawValues as string[]) {
        values.push(value);
        totalBytes += new TextEncoder().encode(name).byteLength;
        totalBytes += new TextEncoder().encode(value).byteLength;
        valueCount += 1;
      }
      if (
        Object.keys(normalized).length > 128 ||
        valueCount > 256 ||
        totalBytes > 64 * 1024
      ) {
        return { valid: false, headers: normalized };
      }
    }
    return { valid: true, headers: normalized };
  } catch {
    return { valid: false, headers: normalized };
  }
}

type ValidatedAllowedHeadersCloneResult =
  | Readonly<{
      success: true;
      value: readonly InboxV2RawIngressAllowedHeader[];
    }>
  | Readonly<{ success: false }>;

function cloneValidatedAllowedHeaders(
  value: unknown,
  allowlist: readonly string[]
): ValidatedAllowedHeadersCloneResult {
  const safeClone = cloneSafeJson({ headers: value });
  if (!safeClone.success) return { success: false };
  const parsed = rawIngressValidatedAllowedHeadersSchema.safeParse(
    safeClone.value.headers
  );
  if (
    !parsed.success ||
    parsed.data.some((header) => !allowlist.includes(header.name))
  ) {
    return { success: false };
  }
  return {
    success: true,
    value: parsed.data.map((header) => ({
      name: header.name,
      values: [...header.values]
    }))
  };
}

function zeroEphemeralRequest(request: {
  body?: unknown;
  headers?: unknown;
}): void {
  if (request.body instanceof Uint8Array) {
    request.body.fill(0);
  }
  scrubHeaders(request.headers);
}

function zeroBytes(value: Uint8Array | null): void {
  value?.fill(0);
}

function scrubHeaders(value: unknown): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const key of Reflect.ownKeys(value)) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor !== undefined && "value" in descriptor) {
        if (Array.isArray(descriptor.value)) {
          descriptor.value.fill("");
        }
        Reflect.set(value, key, Array.isArray(descriptor.value) ? [] : "");
      }
      Reflect.deleteProperty(value, key);
    } catch {
      // Best-effort release for a malformed/frozen caller container.
    }
  }
}

function isSecretHeaderName(name: string): boolean {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/gu, "");
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
  ].some((secret) => compact.includes(secret));
}

function isSecretPayloadKey(name: string): boolean {
  return isSecretHeaderName(name);
}

function hasInvalidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasForbiddenControlCharacter(
  value: string,
  allowHorizontalTab: boolean
): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint === 127 ||
      (codePoint <= 31 && !(allowHorizontalTab && codePoint === 9))
    ) {
      return true;
    }
  }
  return false;
}

function cloneAndFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
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

export const inboxV2RawIngressWorkerIdSchema = inboxV2NamespacedIdSchema;
export const inboxV2RawIngressLeaseTokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export function calculateInboxV2RawIngressLeaseTokenHash(leaseToken: string) {
  return calculateInboxV2BytesSha256(
    new TextEncoder().encode(
      `core:inbox-v2.raw-ingress-lease-token\u0000${inboxV2RawIngressLeaseTokenSchema.parse(
        leaseToken
      )}`
    )
  );
}

export const inboxV2RawIngressPersistedLeaseSchema = z
  .object({
    workerId: inboxV2RawIngressWorkerIdSchema,
    leaseTokenHash: inboxV2Sha256DigestSchema,
    leaseRevision: inboxV2EntityRevisionSchema,
    claimedAt: inboxV2TimestampSchema,
    expiresAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((lease, context) => {
    if (!isInboxV2TimestampOrderValid(lease.claimedAt, lease.expiresAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Raw-ingress lease expiry cannot precede its claim."
      });
    }
  });

export const inboxV2RawIngressWorkStateSchema = z.enum(["pending", "leased"]);

export const inboxV2RawIngressWorkItemSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rawEventId: inboxV2RawInboundEventIdSchema,
    state: inboxV2RawIngressWorkStateSchema,
    attemptCount: inboxV2BigintCounterSchema,
    lease: inboxV2RawIngressPersistedLeaseSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((work, context) => {
    if ((work.state === "leased") !== (work.lease !== null)) {
      context.addIssue({
        code: "custom",
        path: ["lease"],
        message: "Only leased raw-ingress work may retain a lease."
      });
    }
    if (work.state === "leased" && BigInt(work.attemptCount) === 0n) {
      context.addIssue({
        code: "custom",
        path: ["attemptCount"],
        message: "Leased raw-ingress work must have an attempt."
      });
    }
    if (
      work.lease !== null &&
      !isInboxV2TimestampOrderValid(work.lease.claimedAt, work.updatedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Raw-ingress work cannot predate its current lease."
      });
    }
  });

export const inboxV2ClaimRawIngressInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    workerId: inboxV2RawIngressWorkerIdSchema,
    leaseDurationSeconds: leaseDurationSecondsSchema,
    batchSize: claimBatchSizeSchema,
    /**
     * Optional account-partition cap used by the production scheduler. It is
     * absent for the SRC-002 compatibility path, which preserves the original
     * tenant-wide batch behaviour during an additive N-1 rollout.
     */
    maxClaimsPerAccount: claimBatchSizeSchema.optional()
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.maxClaimsPerAccount !== undefined &&
      input.maxClaimsPerAccount > input.batchSize
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxClaimsPerAccount"],
        message:
          "Per-account raw-ingress claim cap cannot exceed the tenant batch size."
      });
    }
  });

const expiredRawIngressLeaseEvidenceSchema = z
  .object({
    workerId: inboxV2RawIngressWorkerIdSchema,
    leaseRevision: inboxV2EntityRevisionSchema,
    claimedAt: inboxV2TimestampSchema,
    expiredAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((lease, context) => {
    if (!isInboxV2TimestampOrderValid(lease.claimedAt, lease.expiredAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiredAt"],
        message: "Expired raw-ingress lease evidence is temporally invalid."
      });
    }
  });

export const inboxV2RawIngressClaimSchema = z
  .object({
    claimKind: z.enum(["pending", "reclaimed"]),
    work: inboxV2RawIngressWorkItemSchema,
    leaseToken: inboxV2RawIngressLeaseTokenSchema,
    expiredLease: expiredRawIngressLeaseEvidenceSchema.nullable()
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      claim.work.state !== "leased" ||
      claim.work.lease === null ||
      claim.work.lease.leaseTokenHash !==
        calculateInboxV2RawIngressLeaseTokenHash(claim.leaseToken)
    ) {
      context.addIssue({
        code: "custom",
        path: ["leaseToken"],
        message:
          "Raw-ingress claim token must match its persisted lease digest."
      });
    }
    if ((claim.claimKind === "reclaimed") !== (claim.expiredLease !== null)) {
      context.addIssue({
        code: "custom",
        path: ["expiredLease"],
        message:
          "Only reclaimed raw-ingress claims carry expired lease evidence."
      });
    }
    if (
      claim.expiredLease !== null &&
      claim.work.lease !== null &&
      (!isInboxV2TimestampOrderValid(
        claim.expiredLease.expiredAt,
        claim.work.lease.claimedAt
      ) ||
        BigInt(claim.work.lease.leaseRevision) <=
          BigInt(claim.expiredLease.leaseRevision))
    ) {
      context.addIssue({
        code: "custom",
        path: ["expiredLease"],
        message:
          "Reclaimed raw-ingress work must fence a strictly older expired lease."
      });
    }
  });

export const inboxV2ClaimRawIngressResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("claimed"),
        tenantId: inboxV2TenantIdSchema,
        workerId: inboxV2RawIngressWorkerIdSchema,
        batchSize: claimBatchSizeSchema,
        claims: z.array(inboxV2RawIngressClaimSchema).min(1).max(1_000)
      })
      .strict()
      .superRefine((result, context) => {
        const rawEventIds = new Set<string>();
        if (result.claims.length > result.batchSize) {
          context.addIssue({
            code: "custom",
            path: ["claims"],
            message:
              "Raw-ingress claim result exceeds the requested batch size."
          });
        }
        for (const [index, claim] of result.claims.entries()) {
          if (
            claim.work.tenantId !== result.tenantId ||
            claim.work.lease?.workerId !== result.workerId ||
            rawEventIds.has(String(claim.work.rawEventId))
          ) {
            context.addIssue({
              code: "custom",
              path: ["claims", index],
              message:
                "Raw-ingress claim batch must contain unique tenant-local work leased by its worker."
            });
          }
          rawEventIds.add(String(claim.work.rawEventId));
        }
      }),
    z
      .object({
        outcome: z.literal("empty"),
        tenantId: inboxV2TenantIdSchema,
        workerId: inboxV2RawIngressWorkerIdSchema,
        batchSize: claimBatchSizeSchema
      })
      .strict()
  ]
);

export const inboxV2RenewRawIngressLeaseInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rawEventId: inboxV2RawInboundEventIdSchema,
    workerId: inboxV2RawIngressWorkerIdSchema,
    leaseToken: inboxV2RawIngressLeaseTokenSchema,
    expectedLeaseRevision: inboxV2EntityRevisionSchema,
    leaseDurationSeconds: leaseDurationSecondsSchema
  })
  .strict();

export const inboxV2ReleaseRawIngressLeaseInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rawEventId: inboxV2RawInboundEventIdSchema,
    workerId: inboxV2RawIngressWorkerIdSchema,
    leaseToken: inboxV2RawIngressLeaseTokenSchema,
    expectedLeaseRevision: inboxV2EntityRevisionSchema
  })
  .strict();

const rawIngressLeaseFailureSchemas = [
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
      rawEventId: inboxV2RawInboundEventIdSchema,
      currentState: z.literal("pending")
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

export const inboxV2RenewRawIngressLeaseResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("renewed"),
        work: inboxV2RawIngressWorkItemSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (result.work.state !== "leased") {
          context.addIssue({
            code: "custom",
            path: ["work", "state"],
            message: "Renewed raw-ingress work must remain leased."
          });
        }
      }),
    ...rawIngressLeaseFailureSchemas
  ]
);

export const inboxV2ReleaseRawIngressLeaseResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("released"),
        work: inboxV2RawIngressWorkItemSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (result.work.state !== "pending") {
          context.addIssue({
            code: "custom",
            path: ["work", "state"],
            message: "Released raw-ingress work must return to pending."
          });
        }
      }),
    ...rawIngressLeaseFailureSchemas
  ]
);

export const inboxV2RecordRawIngressResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("recorded"),
        source: inboxV2RawAdmissionSourceScopeSchema,
        rawEventId: inboxV2RawInboundEventIdSchema,
        safeEnvelopeDigest: inboxV2RawPersistedSafeEnvelopeDigestSchema,
        work: inboxV2RawIngressWorkItemSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (
          result.work.rawEventId !== result.rawEventId ||
          result.work.tenantId !== result.source.tenantId ||
          result.work.state !== "pending"
        ) {
          context.addIssue({
            code: "custom",
            path: ["work"],
            message:
              "Recorded raw ingress must create matching pending work exactly once."
          });
        }
      }),
    z
      .object({
        outcome: z.literal("already_recorded"),
        source: inboxV2RawAdmissionSourceScopeSchema,
        rawEventId: inboxV2RawInboundEventIdSchema,
        safeEnvelopeDigest: inboxV2RawPersistedSafeEnvelopeDigestSchema
      })
      .strict(),
    z
      .object({
        outcome: z.literal("duplicate"),
        source: inboxV2RawAdmissionSourceScopeSchema,
        rawEventId: inboxV2RawInboundEventIdSchema,
        safeEnvelopeDigest: inboxV2RawPersistedSafeEnvelopeDigestSchema,
        matchedKeyGenerations: z
          .array(inboxV2RawAdmissionKeyGenerationSchema)
          .min(1)
          .max(INBOX_V2_RAW_ADMISSION_MAX_LOOKUP_CANDIDATES)
          .readonly()
      })
      .strict()
      .superRefine((result, context) => {
        if (
          new Set(result.matchedKeyGenerations).size !==
          result.matchedKeyGenerations.length
        ) {
          context.addIssue({
            code: "custom",
            path: ["matchedKeyGenerations"],
            message: "Matched raw-admission key generations must be unique."
          });
        }
      }),
    z.object({ outcome: z.literal("key_unavailable") }).strict(),
    z
      .object({
        outcome: z.literal("quarantined"),
        source: inboxV2RawAdmissionSourceScopeSchema,
        quarantineId: inboxV2NamespacedIdSchema,
        existingRawEventId: inboxV2RawInboundEventIdSchema.nullable(),
        safeEnvelopeDigest: inboxV2RawPersistedSafeEnvelopeDigestSchema,
        reasonCode: inboxV2RawIngressQuarantineReasonSchema
      })
      .strict()
      .superRefine((result, context) => {
        if (
          (result.reasonCode === "source.idempotency_collision") !==
          (result.existingRawEventId !== null)
        ) {
          context.addIssue({
            code: "custom",
            path: ["existingRawEventId"],
            message:
              "Only idempotency-collision quarantine may identify an existing raw event."
          });
        }
      })
  ]
);

export type InboxV2RawIngressWorkItem = z.infer<
  typeof inboxV2RawIngressWorkItemSchema
>;
export type InboxV2ClaimRawIngressInput = z.infer<
  typeof inboxV2ClaimRawIngressInputSchema
>;
export type InboxV2ClaimRawIngressResult = z.infer<
  typeof inboxV2ClaimRawIngressResultSchema
>;
export type InboxV2RenewRawIngressLeaseInput = z.infer<
  typeof inboxV2RenewRawIngressLeaseInputSchema
>;
export type InboxV2RenewRawIngressLeaseResult = z.infer<
  typeof inboxV2RenewRawIngressLeaseResultSchema
>;
export type InboxV2ReleaseRawIngressLeaseInput = z.infer<
  typeof inboxV2ReleaseRawIngressLeaseInputSchema
>;
export type InboxV2ReleaseRawIngressLeaseResult = z.infer<
  typeof inboxV2ReleaseRawIngressLeaseResultSchema
>;
export type InboxV2RecordRawIngressResult = z.infer<
  typeof inboxV2RecordRawIngressResultSchema
>;

export interface InboxV2RawIngressRepositoryPort {
  record(
    candidate: Readonly<InboxV2SanitizedRawIngressCandidate>
  ): Promise<InboxV2RecordRawIngressResult>;
  claim(
    input: Readonly<InboxV2ClaimRawIngressInput>
  ): Promise<InboxV2ClaimRawIngressResult>;
  renewLease(
    input: Readonly<InboxV2RenewRawIngressLeaseInput>
  ): Promise<InboxV2RenewRawIngressLeaseResult>;
  releaseLease(
    input: Readonly<InboxV2ReleaseRawIngressLeaseInput>
  ): Promise<InboxV2ReleaseRawIngressLeaseResult>;
}
