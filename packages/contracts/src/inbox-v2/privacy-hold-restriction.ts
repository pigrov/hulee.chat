import { z } from "zod";

import type { Brand } from "../brand";
import {
  isInboxV2DataLifecycleRegistry,
  type InboxV2DataLifecycleRegistry
} from "./data-lifecycle-catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2EmployeeReferenceSchema, inboxV2TenantIdSchema } from "./ids";
import {
  inboxV2DataClassIdSchema,
  inboxV2DataSensitivitySchema,
  inboxV2LifecycleHandlerIdSchema,
  inboxV2ProcessingPurposeIdSchema,
  inboxV2RetentionEndConditionSchema,
  inboxV2StorageRootKindSchema,
  INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION
} from "./data-lifecycle-primitives";
import {
  dataRootReferenceKey,
  inboxV2DataRootReferenceSchema
} from "./data-subject-discovery";
import { inboxV2NamespacedIdSchema } from "./namespace";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import { createInboxV2SchemaEnvelopeSchema } from "./schema-version";
import {
  inboxV2EntityKeySchema,
  inboxV2Sha256DigestSchema
} from "./sync-primitives";

export type InboxV2PrivacyHoldId = Brand<string, "InboxV2PrivacyHoldId">;
export type InboxV2ProcessingRestrictionId = Brand<
  string,
  "InboxV2ProcessingRestrictionId"
>;
export type InboxV2PrivacyScopeManifestId = Brand<
  string,
  "InboxV2PrivacyScopeManifestId"
>;

export const INBOX_V2_PRIVACY_SCOPE_MANIFEST_SCHEMA_ID =
  "core:inbox-v2.privacy-scope-manifest" as const;
export const INBOX_V2_LEGAL_HOLD_SCHEMA_ID =
  "core:inbox-v2.legal-hold" as const;
export const INBOX_V2_PROCESSING_RESTRICTION_SCHEMA_ID =
  "core:inbox-v2.processing-restriction" as const;

const privacyOpaqueIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export const inboxV2PrivacyHoldIdSchema = privacyOpaqueIdSchema.transform(
  (value) => value as InboxV2PrivacyHoldId
);
export const inboxV2ProcessingRestrictionIdSchema =
  privacyOpaqueIdSchema.transform(
    (value) => value as InboxV2ProcessingRestrictionId
  );
export const inboxV2PrivacyScopeManifestIdSchema =
  privacyOpaqueIdSchema.transform(
    (value) => value as InboxV2PrivacyScopeManifestId
  );

export const inboxV2PrivacyHoldReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    holdId: inboxV2PrivacyHoldIdSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict();

/** Exact active-hold fence captured by a decision or destructive operation. */
export const inboxV2PrivacyHoldDecisionReferenceSchema = z
  .object({
    hold: inboxV2PrivacyHoldReferenceSchema,
    reviewAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2ProcessingRestrictionReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    restrictionId: inboxV2ProcessingRestrictionIdSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2PrivacyScopeManifestSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2PrivacyScopeManifestIdSchema,
    revision: inboxV2EntityRevisionSchema,
    frozenAt: inboxV2TimestampSchema,
    roots: z
      .array(
        z
          .object({
            root: inboxV2DataRootReferenceSchema,
            entity: inboxV2EntityKeySchema,
            expectedEntityRevision: inboxV2EntityRevisionSchema,
            expectedLineageRevision: inboxV2EntityRevisionSchema,
            rootKind: inboxV2StorageRootKindSchema,
            boundary: z.enum([
              "operated_data_plane",
              "outside_operated_data_plane"
            ]),
            copyRole: z.enum(["primary", "derived", "backup", "external"])
          })
          .strict()
          .superRefine((entry, context) => {
            if (
              entry.root.tenantId !== entry.entity.tenantId ||
              (entry.rootKind === "external_route") !==
                (entry.boundary === "outside_operated_data_plane") ||
              (entry.copyRole === "backup") !== (entry.rootKind === "backup") ||
              (entry.copyRole === "external") !==
                (entry.rootKind === "external_route")
            ) {
              addIssue(
                context,
                [],
                "Scope-manifest root must bind one tenant and its exact operated/external copy role."
              );
            }
          })
      )
      .max(100_000),
    manifestHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((manifest, context) => {
    addCanonicalUniqueIssue(
      context,
      manifest.roots.map(({ root }) => dataRootReferenceKey(root)),
      "Privacy scope roots"
    );
    if (
      manifest.roots.some(
        ({ root, entity }) =>
          root.tenantId !== manifest.tenantId ||
          entity.tenantId !== manifest.tenantId
      )
    ) {
      addIssue(context, ["roots"], "Privacy scope roots cannot cross tenants.");
    }
    if (
      manifest.manifestHash !==
      calculateInboxV2PrivacyScopeManifestHash(manifest)
    ) {
      addIssue(
        context,
        ["manifestHash"],
        "Privacy scope manifest hash must match its canonical frozen roots."
      );
    }
  });

export const inboxV2PrivacyScopeManifestEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PRIVACY_SCOPE_MANIFEST_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2PrivacyScopeManifestSchema
  );

const definedInboxV2PrivacyScopeManifests = new WeakSet<object>();
const definedInboxV2LegalHolds = new WeakSet<object>();
const definedInboxV2ProcessingRestrictions = new WeakSet<object>();
const inboxV2LegalHoldRegistryComposition = new WeakMap<object, string>();
const inboxV2RestrictionRegistryComposition = new WeakMap<object, string>();

export function isInboxV2PrivacyScopeManifest(
  value: unknown
): value is z.infer<typeof inboxV2PrivacyScopeManifestSchema> {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2PrivacyScopeManifests.has(value)
  );
}

export function isInboxV2LegalHold(
  value: unknown
): value is z.infer<typeof inboxV2LegalHoldSchema> {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2LegalHolds.has(value)
  );
}

export function isInboxV2ProcessingRestriction(
  value: unknown
): value is z.infer<typeof inboxV2ProcessingRestrictionSchema> {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2ProcessingRestrictions.has(value)
  );
}

export function calculateInboxV2PrivacyScopeManifestHash(input: {
  manifestHash?: unknown;
  [key: string]: unknown;
}) {
  const { manifestHash: _ignored, ...manifest } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.privacy-scope-manifest",
    hashVersion: "v1",
    manifest
  });
}

export function defineInboxV2PrivacyScopeManifest(
  input: Omit<
    z.input<typeof inboxV2PrivacyScopeManifestSchema>,
    "manifestHash"
  > & {
    manifestHash?: unknown;
  }
): z.infer<typeof inboxV2PrivacyScopeManifestSchema> {
  const { manifestHash: _ignored, ...manifest } = input;
  const defined = deepFreezePrivacyControlValue(
    inboxV2PrivacyScopeManifestSchema.parse({
      ...manifest,
      manifestHash: calculateInboxV2PrivacyScopeManifestHash(manifest)
    })
  );
  definedInboxV2PrivacyScopeManifests.add(defined);
  return defined;
}

const exactPrivacyScopeSchema = z
  .object({
    kind: z.literal("exact"),
    targets: z
      .array(inboxV2EntityKeySchema)
      .min(1)
      .max(4_096)
      .superRefine((targets, context) => {
        addCanonicalUniqueIssue(
          context,
          targets.map(entityKey),
          "Exact privacy targets"
        );
      }),
    manifest: inboxV2PrivacyScopeManifestSchema,
    futureMatch: z.literal("none")
  })
  .strict()
  .superRefine((scope, context) => {
    const targetKeys = new Set(scope.targets.map(entityKey));
    const manifestEntityKeys = new Set(
      scope.manifest.roots.map(({ entity }) => entityKey(entity))
    );
    if (
      targetKeys.size !== manifestEntityKeys.size ||
      [...targetKeys].some((key) => !manifestEntityKeys.has(key))
    ) {
      addIssue(
        context,
        ["targets"],
        "Exact privacy scope targets and frozen manifest entities must match exactly."
      );
    }
  });

const prospectivePrivacyScopeSchema = z
  .object({
    kind: z.literal("prospective"),
    matcherHandlerId: inboxV2LifecycleHandlerIdSchema,
    matcherVersion: inboxV2EntityRevisionSchema,
    predicateHash: inboxV2Sha256DigestSchema,
    manifest: inboxV2PrivacyScopeManifestSchema,
    futureMatch: z.literal("match_until_release")
  })
  .strict();

export const inboxV2PrivacyScopeSchema = z.discriminatedUnion("kind", [
  exactPrivacyScopeSchema,
  prospectivePrivacyScopeSchema
]);

const holdBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  id: inboxV2PrivacyHoldIdSchema,
  revision: inboxV2EntityRevisionSchema,
  caseId: privacyOpaqueIdSchema,
  dataClassIds: z
    .array(inboxV2DataClassIdSchema)
    .min(1)
    .max(256)
    .superRefine((ids, context) =>
      addCanonicalUniqueIssue(context, ids, "Legal-hold data classes")
    ),
  scope: inboxV2PrivacyScopeSchema,
  anchorFrom: inboxV2TimestampSchema.nullable(),
  anchorThrough: inboxV2TimestampSchema.nullable(),
  owner: inboxV2EmployeeReferenceSchema,
  approver: inboxV2EmployeeReferenceSchema,
  reasonCode: inboxV2NamespacedIdSchema,
  legalReferenceCode: inboxV2NamespacedIdSchema,
  endCondition: inboxV2RetentionEndConditionSchema,
  effectiveAt: inboxV2TimestampSchema,
  reviewAt: inboxV2TimestampSchema
} as const;

const activeLegalHoldSchema = z
  .object({
    ...holdBaseShape,
    state: z.literal("active")
  })
  .strict();

const releasedLegalHoldSchema = z
  .object({
    ...holdBaseShape,
    state: z.literal("released"),
    releasedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2LegalHoldSchema = z
  .discriminatedUnion("state", [activeLegalHoldSchema, releasedLegalHoldSchema])
  .superRefine((hold, context) => {
    if (
      hold.owner.tenantId !== hold.tenantId ||
      hold.approver.tenantId !== hold.tenantId ||
      hold.scope.manifest.tenantId !== hold.tenantId ||
      hold.owner.id === hold.approver.id
    ) {
      addIssue(
        context,
        ["approver"],
        "Legal hold requires different same-tenant owner and approver."
      );
    }
    if (
      Date.parse(hold.reviewAt) <= Date.parse(hold.effectiveAt) ||
      (hold.anchorFrom !== null &&
        hold.anchorThrough !== null &&
        !isInboxV2TimestampOrderValid(hold.anchorFrom, hold.anchorThrough)) ||
      (hold.state === "released" &&
        !isInboxV2TimestampOrderValid(hold.effectiveAt, hold.releasedAt))
    ) {
      addIssue(
        context,
        ["reviewAt"],
        "Legal-hold effective, anchor, review and release timestamps must be ordered."
      );
    }
    const exactScope = hold.scope.kind === "exact" ? hold.scope : null;
    if (
      exactScope !== null &&
      (exactScope.targets.some((target) => target.tenantId !== hold.tenantId) ||
        exactScope.manifest.roots.some(
          ({ entity }) =>
            !exactScope.targets.some(
              (target) => entityKey(target) === entityKey(entity)
            )
        ))
    ) {
      addIssue(
        context,
        ["scope", "targets"],
        "Legal-hold targets must belong to the hold tenant."
      );
    }
  });

export const inboxV2LegalHoldEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
  INBOX_V2_LEGAL_HOLD_SCHEMA_ID,
  INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
  inboxV2LegalHoldSchema
);

export const inboxV2RestrictedProcessingUseSchema = z.enum([
  "storage",
  "legal_claim",
  "data_subject_request",
  "correction",
  "security",
  "ordinary_operation",
  "manager_reporting",
  "ai_or_transcription",
  "export",
  "notification",
  "external_transmission"
]);

const restrictionBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  id: inboxV2ProcessingRestrictionIdSchema,
  revision: inboxV2EntityRevisionSchema,
  scope: inboxV2PrivacyScopeSchema,
  dataClassIds: z
    .array(inboxV2DataClassIdSchema)
    .min(1)
    .max(256)
    .superRefine((ids, context) =>
      addCanonicalUniqueIssue(context, ids, "Restriction data classes")
    ),
  continuingPurposeIds: z
    .array(inboxV2ProcessingPurposeIdSchema)
    .min(1)
    .max(256)
    .superRefine((ids, context) =>
      addCanonicalUniqueIssue(context, ids, "Restriction purposes")
    ),
  allowedUses: z
    .array(inboxV2RestrictedProcessingUseSchema)
    .min(1)
    .max(11)
    .superRefine((uses, context) =>
      addCanonicalUniqueIssue(context, uses, "Restriction allowed uses")
    ),
  owner: inboxV2EmployeeReferenceSchema,
  reasonCode: inboxV2NamespacedIdSchema,
  endCondition: inboxV2RetentionEndConditionSchema,
  effectiveAt: inboxV2TimestampSchema,
  reviewAt: inboxV2TimestampSchema
} as const;

const activeProcessingRestrictionSchema = z
  .object({
    ...restrictionBaseShape,
    state: z.literal("active")
  })
  .strict();

const releasedProcessingRestrictionSchema = z
  .object({
    ...restrictionBaseShape,
    state: z.literal("released"),
    releasedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2ProcessingRestrictionSchema = z
  .discriminatedUnion("state", [
    activeProcessingRestrictionSchema,
    releasedProcessingRestrictionSchema
  ])
  .superRefine((restriction, context) => {
    if (
      restriction.owner.tenantId !== restriction.tenantId ||
      restriction.scope.manifest.tenantId !== restriction.tenantId
    ) {
      addIssue(
        context,
        ["owner"],
        "Processing-restriction owner must belong to its tenant."
      );
    }
    if (
      Date.parse(restriction.reviewAt) <= Date.parse(restriction.effectiveAt) ||
      (restriction.state === "released" &&
        !isInboxV2TimestampOrderValid(
          restriction.effectiveAt,
          restriction.releasedAt
        ))
    ) {
      addIssue(
        context,
        ["reviewAt"],
        "Restriction effective, review and release timestamps must be ordered."
      );
    }
    const exactScope =
      restriction.scope.kind === "exact" ? restriction.scope : null;
    if (
      exactScope !== null &&
      (exactScope.targets.some(
        (target) => target.tenantId !== restriction.tenantId
      ) ||
        exactScope.manifest.roots.some(
          ({ entity }) =>
            !exactScope.targets.some(
              (target) => entityKey(target) === entityKey(entity)
            )
        ))
    ) {
      addIssue(
        context,
        ["scope", "targets"],
        "Restriction targets must belong to its tenant."
      );
    }
  });

export const inboxV2ProcessingRestrictionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROCESSING_RESTRICTION_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2ProcessingRestrictionSchema
  );

/** Validates a legal hold against the exact executable registry composition. */
export function defineInboxV2LegalHold(input: {
  hold: z.input<typeof inboxV2LegalHoldSchema>;
  registry: InboxV2DataLifecycleRegistry;
}): z.infer<typeof inboxV2LegalHoldSchema> {
  if (!isInboxV2PrivacyScopeManifest(input.hold.scope.manifest)) {
    throw new Error(
      "Legal hold requires an authentic frozen privacy scope manifest."
    );
  }
  const parsed = inboxV2LegalHoldSchema.parse(input.hold);
  const hold = {
    ...parsed,
    scope: {
      ...parsed.scope,
      manifest: input.hold.scope.manifest
    }
  } as z.infer<typeof inboxV2LegalHoldSchema>;
  assertPrivacyControlRegistryBinding({
    registry: input.registry,
    controlKind: "legal_hold",
    tenantId: hold.tenantId,
    dataClassIds: hold.dataClassIds,
    continuingPurposeIds: [],
    scope: hold.scope,
    endConditionResolverHandlerId: hold.endCondition.resolverHandlerId
  });
  const defined = deepFreezePrivacyControlValue(hold);
  definedInboxV2LegalHolds.add(defined);
  inboxV2LegalHoldRegistryComposition.set(
    defined,
    String(input.registry.compositionHash)
  );
  return defined;
}

/** Validates a processing restriction against the same closed registry. */
export function defineInboxV2ProcessingRestriction(input: {
  restriction: z.input<typeof inboxV2ProcessingRestrictionSchema>;
  registry: InboxV2DataLifecycleRegistry;
}): z.infer<typeof inboxV2ProcessingRestrictionSchema> {
  if (!isInboxV2PrivacyScopeManifest(input.restriction.scope.manifest)) {
    throw new Error(
      "Processing restriction requires an authentic frozen privacy scope manifest."
    );
  }
  const parsed = inboxV2ProcessingRestrictionSchema.parse(input.restriction);
  const restriction = {
    ...parsed,
    scope: {
      ...parsed.scope,
      manifest: input.restriction.scope.manifest
    }
  } as z.infer<typeof inboxV2ProcessingRestrictionSchema>;
  assertPrivacyControlRegistryBinding({
    registry: input.registry,
    controlKind: "processing_restriction",
    tenantId: restriction.tenantId,
    dataClassIds: restriction.dataClassIds,
    continuingPurposeIds: restriction.continuingPurposeIds,
    scope: restriction.scope,
    endConditionResolverHandlerId: restriction.endCondition.resolverHandlerId
  });
  const defined = deepFreezePrivacyControlValue(restriction);
  definedInboxV2ProcessingRestrictions.add(defined);
  inboxV2RestrictionRegistryComposition.set(
    defined,
    String(input.registry.compositionHash)
  );
  return defined;
}

export const inboxV2PrivacyControlTargetSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    root: inboxV2DataRootReferenceSchema,
    entity: inboxV2EntityKeySchema,
    entityRevision: inboxV2EntityRevisionSchema,
    lineageRevision: inboxV2EntityRevisionSchema,
    dataClassId: inboxV2DataClassIdSchema,
    sensitivity: inboxV2DataSensitivitySchema,
    holdEligible: z.boolean(),
    anchorAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((target, context) => {
    if (
      target.entity.tenantId !== target.tenantId ||
      target.root.tenantId !== target.tenantId ||
      target.root.dataClassId !== target.dataClassId
    ) {
      addIssue(
        context,
        ["root"],
        "Privacy-control target must bind one tenant, root and data class."
      );
    }
  });

export const inboxV2PrivacyScopeMatchDecisionSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("does_not_match") }).strict(),
    z
      .object({
        kind: z.literal("matches"),
        reviewOverdue: z.boolean()
      })
      .strict(),
    z
      .object({
        kind: z.literal("rejected"),
        errorCode: z.enum([
          "privacy.policy_missing",
          "privacy.data_class_not_hold_eligible",
          "privacy.scope_ambiguous"
        ])
      })
      .strict()
  ]
);

export type InboxV2ProspectivePrivacyScopeMatcher = Readonly<{
  registryCompositionHash: z.infer<typeof inboxV2Sha256DigestSchema>;
  matcherHandlerId: z.infer<typeof inboxV2LifecycleHandlerIdSchema>;
  matcherVersion: z.infer<typeof inboxV2EntityRevisionSchema>;
  predicateHash: z.infer<typeof inboxV2Sha256DigestSchema>;
  matches: (input: {
    scope: z.infer<typeof prospectivePrivacyScopeSchema>;
    target: z.infer<typeof inboxV2PrivacyControlTargetSchema>;
  }) => boolean;
}>;

const definedInboxV2ProspectivePrivacyScopeMatchers = new WeakSet<object>();

/**
 * Registers a server-owned prospective matcher capability against one exact
 * registry composition and immutable predicate identity. A plain callback or
 * a shape-compatible object is never negative-match authority.
 */
export function defineInboxV2ProspectivePrivacyScopeMatcher(input: {
  registry: InboxV2DataLifecycleRegistry;
  matcherHandlerId: z.input<typeof inboxV2LifecycleHandlerIdSchema>;
  matcherVersion: z.input<typeof inboxV2EntityRevisionSchema>;
  predicateHash: z.input<typeof inboxV2Sha256DigestSchema>;
  matches: InboxV2ProspectivePrivacyScopeMatcher["matches"];
}): InboxV2ProspectivePrivacyScopeMatcher {
  if (!isInboxV2DataLifecycleRegistry(input.registry)) {
    throw new Error(
      "Prospective privacy matcher requires an authentic lifecycle registry."
    );
  }
  const matcherHandlerId = inboxV2LifecycleHandlerIdSchema.parse(
    input.matcherHandlerId
  );
  assertRegistryHandlerKind(input.registry, matcherHandlerId, "scope_matcher");
  const matcher = Object.freeze({
    registryCompositionHash: inboxV2Sha256DigestSchema.parse(
      input.registry.compositionHash
    ),
    matcherHandlerId,
    matcherVersion: inboxV2EntityRevisionSchema.parse(input.matcherVersion),
    predicateHash: inboxV2Sha256DigestSchema.parse(input.predicateHash),
    matches: input.matches
  });
  definedInboxV2ProspectivePrivacyScopeMatchers.add(matcher);
  return matcher;
}

export function matchInboxV2LegalHold(input: {
  hold: z.input<typeof inboxV2LegalHoldSchema>;
  target: z.input<typeof inboxV2PrivacyControlTargetSchema>;
  now: string;
  prospectiveMatcher?: InboxV2ProspectivePrivacyScopeMatcher;
}): z.infer<typeof inboxV2PrivacyScopeMatchDecisionSchema> {
  const targetResult = inboxV2PrivacyControlTargetSchema.safeParse(
    input.target
  );
  const nowResult = inboxV2TimestampSchema.safeParse(input.now);
  if (
    !isInboxV2LegalHold(input.hold) ||
    !targetResult.success ||
    !nowResult.success
  ) {
    return { kind: "rejected", errorCode: "privacy.policy_missing" };
  }
  const hold = input.hold;
  const target = targetResult.data;
  const now = nowResult.data;
  if (hold.tenantId !== target.tenantId) {
    return { kind: "rejected", errorCode: "privacy.policy_missing" };
  }
  if (target.sensitivity === "secret" || !target.holdEligible) {
    return {
      kind: "rejected",
      errorCode: "privacy.data_class_not_hold_eligible"
    };
  }
  if (
    (hold.state === "released" &&
      Date.parse(now) >= Date.parse(hold.releasedAt)) ||
    Date.parse(now) < Date.parse(hold.effectiveAt) ||
    !hold.dataClassIds.includes(target.dataClassId) ||
    (hold.anchorFrom !== null &&
      Date.parse(target.anchorAt) < Date.parse(hold.anchorFrom)) ||
    (hold.anchorThrough !== null &&
      Date.parse(target.anchorAt) > Date.parse(hold.anchorThrough))
  ) {
    return { kind: "does_not_match" };
  }
  const matches = matchPrivacyScope(
    hold.scope,
    target,
    input.prospectiveMatcher,
    inboxV2LegalHoldRegistryComposition.get(hold)
  );
  if (matches === undefined) {
    return { kind: "rejected", errorCode: "privacy.scope_ambiguous" };
  }
  return matches
    ? {
        kind: "matches",
        reviewOverdue: Date.parse(now) > Date.parse(hold.reviewAt)
      }
    : { kind: "does_not_match" };
}

export function matchInboxV2ProcessingRestriction(input: {
  restriction: z.input<typeof inboxV2ProcessingRestrictionSchema>;
  target: z.input<typeof inboxV2PrivacyControlTargetSchema>;
  now: string;
  prospectiveMatcher?: InboxV2ProspectivePrivacyScopeMatcher;
}): z.infer<typeof inboxV2PrivacyScopeMatchDecisionSchema> {
  const targetResult = inboxV2PrivacyControlTargetSchema.safeParse(
    input.target
  );
  const nowResult = inboxV2TimestampSchema.safeParse(input.now);
  if (
    !isInboxV2ProcessingRestriction(input.restriction) ||
    !targetResult.success ||
    !nowResult.success
  ) {
    return { kind: "rejected", errorCode: "privacy.policy_missing" };
  }
  const restriction = input.restriction;
  const target = targetResult.data;
  const now = nowResult.data;
  if (restriction.tenantId !== target.tenantId) {
    return { kind: "rejected", errorCode: "privacy.policy_missing" };
  }
  if (target.sensitivity === "secret") {
    return {
      kind: "rejected",
      errorCode: "privacy.data_class_not_hold_eligible"
    };
  }
  if (
    (restriction.state === "released" &&
      Date.parse(now) >= Date.parse(restriction.releasedAt)) ||
    Date.parse(now) < Date.parse(restriction.effectiveAt) ||
    !restriction.dataClassIds.includes(target.dataClassId)
  ) {
    return { kind: "does_not_match" };
  }
  const matches = matchPrivacyScope(
    restriction.scope,
    target,
    input.prospectiveMatcher,
    inboxV2RestrictionRegistryComposition.get(restriction)
  );
  if (matches === undefined) {
    return { kind: "rejected", errorCode: "privacy.scope_ambiguous" };
  }
  return matches
    ? {
        kind: "matches",
        reviewOverdue: Date.parse(now) > Date.parse(restriction.reviewAt)
      }
    : { kind: "does_not_match" };
}

export type InboxV2PrivacyHoldReference = z.infer<
  typeof inboxV2PrivacyHoldReferenceSchema
>;
export type InboxV2PrivacyHoldDecisionReference = z.infer<
  typeof inboxV2PrivacyHoldDecisionReferenceSchema
>;
export type InboxV2ProcessingRestrictionReference = z.infer<
  typeof inboxV2ProcessingRestrictionReferenceSchema
>;
export type InboxV2PrivacyScope = z.infer<typeof inboxV2PrivacyScopeSchema>;
export type InboxV2LegalHold = z.infer<typeof inboxV2LegalHoldSchema>;
export type InboxV2ProcessingRestriction = z.infer<
  typeof inboxV2ProcessingRestrictionSchema
>;
export type InboxV2PrivacyControlTarget = z.infer<
  typeof inboxV2PrivacyControlTargetSchema
>;
export type InboxV2RestrictedProcessingUse = z.infer<
  typeof inboxV2RestrictedProcessingUseSchema
>;

function matchPrivacyScope(
  scope: z.infer<typeof inboxV2PrivacyScopeSchema>,
  target: z.infer<typeof inboxV2PrivacyControlTargetSchema>,
  prospectiveMatcher: InboxV2ProspectivePrivacyScopeMatcher | undefined,
  registryCompositionHash: string | undefined
): boolean | undefined {
  if (scope.kind === "exact") {
    return scope.manifest.roots.some(
      (candidate) =>
        dataRootReferenceKey(candidate.root) ===
          dataRootReferenceKey(target.root) &&
        entityKey(candidate.entity) === entityKey(target.entity) &&
        candidate.expectedEntityRevision === target.entityRevision &&
        candidate.expectedLineageRevision === target.lineageRevision
    );
  }
  if (
    prospectiveMatcher === undefined ||
    !definedInboxV2ProspectivePrivacyScopeMatchers.has(prospectiveMatcher) ||
    registryCompositionHash === undefined ||
    prospectiveMatcher.registryCompositionHash !== registryCompositionHash ||
    prospectiveMatcher.matcherHandlerId !== scope.matcherHandlerId ||
    prospectiveMatcher.matcherVersion !== scope.matcherVersion ||
    prospectiveMatcher.predicateHash !== scope.predicateHash
  ) {
    return undefined;
  }
  try {
    return prospectiveMatcher.matches({ scope, target });
  } catch {
    return undefined;
  }
}

function entityKey(entity: z.infer<typeof inboxV2EntityKeySchema>): string {
  return `${entity.tenantId}\u0000${entity.entityTypeId}\u0000${entity.entityId}`;
}

function assertPrivacyControlRegistryBinding(input: {
  registry: InboxV2DataLifecycleRegistry;
  controlKind: "legal_hold" | "processing_restriction";
  tenantId: string;
  dataClassIds: readonly string[];
  continuingPurposeIds: readonly string[];
  scope: z.infer<typeof inboxV2PrivacyScopeSchema>;
  endConditionResolverHandlerId: string;
}): void {
  if (!isInboxV2DataLifecycleRegistry(input.registry)) {
    throw new Error(
      "Privacy control requires an authentic lifecycle registry."
    );
  }
  if (!isInboxV2PrivacyScopeManifest(input.scope.manifest)) {
    throw new Error(
      "Privacy control requires an authentic frozen scope manifest."
    );
  }

  const classById = new Map(
    input.registry.dataClasses.map((entry) => [String(entry.id), entry])
  );
  const selectedClasses = input.dataClassIds.map((dataClassId) => {
    const dataClass = classById.get(dataClassId);
    if (
      dataClass === undefined ||
      dataClass.definition.sensitivity === "secret" ||
      (input.controlKind === "legal_hold" && !dataClass.definition.holdEligible)
    ) {
      throw new Error(
        `Privacy control class ${dataClassId} is unknown, secret${
          input.controlKind === "legal_hold" ? " or not hold eligible" : ""
        }.`
      );
    }
    return dataClass;
  });

  for (const purposeId of input.continuingPurposeIds) {
    if (
      !input.registry.processingPurposes.some(
        (entry) => String(entry.id) === purposeId
      ) ||
      !selectedClasses.every((entry) =>
        entry.definition.allowedPurposeIds.some(
          (candidate) => String(candidate) === purposeId
        )
      )
    ) {
      throw new Error(
        `Processing restriction purpose ${purposeId} is not registered for its classes.`
      );
    }
  }

  assertRegistryHandlerKind(
    input.registry,
    input.endConditionResolverHandlerId,
    "condition_resolution"
  );
  if (input.scope.kind === "prospective") {
    assertRegistryHandlerKind(
      input.registry,
      input.scope.matcherHandlerId,
      "scope_matcher"
    );
  }

  const rootById = new Map(
    input.registry.storageRoots.map((entry) => [String(entry.id), entry])
  );
  for (const entry of input.scope.manifest.roots) {
    if (
      entry.root.tenantId !== input.tenantId ||
      entry.entity.tenantId !== input.tenantId ||
      !input.dataClassIds.includes(String(entry.root.dataClassId))
    ) {
      throw new Error(
        "Privacy control manifest root is outside its exact tenant/class scope."
      );
    }
    const root = rootById.get(String(entry.root.storageRootId));
    const uses = input.registry.dataUses.filter(
      (use) =>
        String(use.dataClassId) === String(entry.root.dataClassId) &&
        String(use.storageRootId) === String(entry.root.storageRootId)
    );
    if (
      root === undefined ||
      uses.length !== 1 ||
      root.definition.kind !== entry.rootKind ||
      root.definition.boundary !== entry.boundary
    ) {
      throw new Error(
        `Privacy control manifest root ${entry.root.storageRootId} is not an exact registered data use.`
      );
    }
  }
}

function deepFreezePrivacyControlValue<T>(
  value: T,
  seen = new WeakSet<object>()
): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    deepFreezePrivacyControlValue(child, seen);
  }
  return Object.freeze(value);
}

function assertRegistryHandlerKind(
  registry: InboxV2DataLifecycleRegistry,
  handlerId: string,
  kind: "condition_resolution" | "scope_matcher"
): void {
  const matches = registry.handlers.filter(
    (entry) => String(entry.id) === handlerId && entry.definition.kind === kind
  );
  if (matches.length !== 1) {
    throw new Error(
      `Privacy control handler ${handlerId} must be registered as ${kind}.`
    );
  }
}

function addCanonicalUniqueIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  label: string
): void {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => index > 0 && value <= values[index - 1]!)
  ) {
    addIssue(context, [], `${label} must be unique and canonically sorted.`);
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
