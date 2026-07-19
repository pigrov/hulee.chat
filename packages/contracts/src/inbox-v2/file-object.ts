import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2DataClassIdSchema,
  inboxV2ProcessingPurposeIdSchema,
  inboxV2StorageRootIdSchema
} from "./data-lifecycle-primitives";
import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2AttachmentMaterializationAttemptIdSchema,
  inboxV2AttachmentMaterializationAttemptReferenceSchema,
  inboxV2AttachmentMaterializationClaimIdSchema,
  inboxV2AttachmentMaterializationClaimReferenceSchema,
  inboxV2AttachmentMaterializationEvidenceIdSchema,
  inboxV2AttachmentMaterializationEvidenceReferenceSchema,
  inboxV2ConversationReferenceSchema,
  inboxV2EventReferenceSchema,
  inboxV2FileLineageEdgeIdSchema,
  inboxV2FileParentLinkIdSchema,
  inboxV2FileParentLinkReferenceSchema,
  inboxV2FileReferenceSchema,
  inboxV2FileVersionIdSchema,
  inboxV2FileVersionReferenceSchema,
  inboxV2MessageAttachmentReferenceSchema,
  inboxV2MessageReferenceSchema,
  inboxV2ObjectOperationEvidenceIdSchema,
  inboxV2ObjectOperationEvidenceReferenceSchema,
  inboxV2ObjectVersionIdSchema,
  inboxV2ObjectVersionReferenceSchema,
  inboxV2OutboundDispatchContentPlanIdSchema,
  inboxV2OutboundDispatchReferenceSchema,
  inboxV2OutboundRouteReferenceSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2StaffNoteReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemReferenceSchema,
  inboxV2TimelineContentReferenceSchema
} from "./ids";
import {
  calculateInboxV2CanonicalSha256,
  encodeInboxV2CanonicalJson
} from "./recipient-sync-hash";
import { inboxV2SchemaVersionTokenSchema } from "./schema-version";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SourceCapabilityIdSchema,
  inboxV2SourceOperationIdSchema
} from "./source-routing-primitives";
import { inboxV2Sha256DigestSchema } from "./sync-primitives";

export const INBOX_V2_FILE_VERSION_SCHEMA_ID =
  "core:inbox-v2.file-version" as const;
export const INBOX_V2_OBJECT_VERSION_SCHEMA_ID =
  "core:inbox-v2.object-version" as const;
export const INBOX_V2_FILE_LINEAGE_EDGE_SCHEMA_ID =
  "core:inbox-v2.file-lineage-edge" as const;
export const INBOX_V2_FILE_PARENT_LINK_SCHEMA_ID =
  "core:inbox-v2.file-parent-link" as const;
export const INBOX_V2_ATTACHMENT_MATERIALIZATION_EVIDENCE_SCHEMA_ID =
  "core:inbox-v2.attachment-materialization-evidence" as const;
export const INBOX_V2_OBJECT_OPERATION_EVIDENCE_SCHEMA_ID =
  "core:inbox-v2.object-operation-evidence" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_CONTENT_PLAN_SCHEMA_ID =
  "core:inbox-v2.outbound-dispatch-content-plan" as const;
export const INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID =
  "core:outbound_dispatch_content_plan" as const;
export const INBOX_V2_FILE_OBJECT_SCHEMA_VERSION = "v1" as const;

const rawSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const hmacSha256Schema = z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/u);
const contentFingerprintKeyGenerationSchema = z
  .string()
  .min(8)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);
const immutableRevisionSchema = z.literal("1");
const boundedOpaqueValueSchema = z
  .string()
  .min(1)
  .max(2_048)
  .superRefine((value, context) => {
    const hasControlCharacter = [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });
    if (!/\S/u.test(value) || hasControlCharacter) {
      addIssue(
        context,
        [],
        "Opaque storage values cannot be blank or contain control characters."
      );
    }
  });
export const inboxV2MediaTypeSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u);
const blockKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/u);

const exactFileObjectPinShape = {
  file: inboxV2FileReferenceSchema,
  fileRevision: inboxV2EntityRevisionSchema,
  fileVersion: inboxV2FileVersionReferenceSchema,
  objectVersion: inboxV2ObjectVersionReferenceSchema
} as const;

/**
 * An authorization/read proof always selects one immutable physical version.
 * Opaque references can prove tenant coherence here; the FileVersion ->
 * ObjectVersion mapping is closed by the repository's composite FK/current
 * head checks rather than inferred from ID spelling.
 */
export const inboxV2ExactFileObjectPinSchema = z
  .object(exactFileObjectPinShape)
  .strict()
  .superRefine((pin, context) => {
    addTenantReferenceIssues(context, pin.file.tenantId, pin, []);
  });

export const inboxV2ExtensionPayloadPinSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("exact"),
      fileRevision: inboxV2EntityRevisionSchema,
      fileVersion: inboxV2FileVersionReferenceSchema,
      objectVersion: inboxV2ObjectVersionReferenceSchema
    })
    .strict()
    .superRefine((pin, context) => {
      addTenantReferenceIssues(context, pin.fileVersion.tenantId, pin, []);
    }),
  z.object({ state: z.literal("legacy_unpinned") }).strict()
]);

export const inboxV2FileVersionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2FileVersionIdSchema,
    file: inboxV2FileReferenceSchema,
    versionNumber: inboxV2EntityRevisionSchema,
    objectVersion: inboxV2ObjectVersionReferenceSchema,
    createdAt: inboxV2TimestampSchema,
    revision: immutableRevisionSchema
  })
  .strict()
  .superRefine((fileVersion, context) => {
    addTenantReferenceIssues(context, fileVersion.tenantId, fileVersion, []);
  });

/**
 * Immutable registry row for one provider-neutral object version. The locator
 * and provider token are classified storage metadata and never appear in safe
 * operation evidence or client-facing read proofs.
 */
export const inboxV2ObjectVersionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ObjectVersionIdSchema,
    storageRootId: inboxV2StorageRootIdSchema,
    storageLocator: boundedOpaqueValueSchema,
    providerVersionToken: boundedOpaqueValueSchema,
    versioningMode: z.enum(["native_version", "immutable_key"]),
    checksumSha256: rawSha256Schema,
    sizeBytes: inboxV2BigintCounterSchema,
    declaredMediaType: inboxV2MediaTypeSchema.nullable(),
    detectedMediaType: inboxV2MediaTypeSchema,
    encryptionKeyRef: boundedOpaqueValueSchema.nullable(),
    dataClassId: inboxV2DataClassIdSchema,
    retentionAnchorAt: inboxV2TimestampSchema,
    createdAt: inboxV2TimestampSchema,
    revision: immutableRevisionSchema
  })
  .strict()
  .superRefine((objectVersion, context) => {
    addTenantReferenceIssues(
      context,
      objectVersion.tenantId,
      objectVersion,
      []
    );
  });

export const inboxV2ObjectVersionHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    objectVersion: inboxV2ObjectVersionReferenceSchema,
    state: z.enum([
      "staging",
      "ready",
      "quarantined",
      "unavailable",
      "delete_pending",
      "deleted",
      "delete_failed"
    ]),
    revision: inboxV2EntityRevisionSchema,
    lastOperationEvidence:
      inboxV2ObjectOperationEvidenceReferenceSchema.nullable(),
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    addTenantReferenceIssues(context, head.tenantId, head, []);
    if (
      head.state === "staging" &&
      (head.revision !== "1" || head.lastOperationEvidence !== null)
    ) {
      addIssue(
        context,
        ["revision"],
        "Only a revision-one object-version head without operation evidence may be staging."
      );
    }
    if (head.state !== "staging" && head.lastOperationEvidence === null) {
      addIssue(
        context,
        ["lastOperationEvidence"],
        "A non-staging object state requires exact immutable operation evidence."
      );
    }
  });

export const inboxV2FileLineageEdgeSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2FileLineageEdgeIdSchema,
    originalFileVersion: inboxV2FileVersionReferenceSchema,
    derivedFileVersion: inboxV2FileVersionReferenceSchema,
    transformKindId: inboxV2CatalogIdSchema,
    transformProfileId: inboxV2CatalogIdSchema,
    transformProfileVersion: inboxV2SchemaVersionTokenSchema,
    createdAt: inboxV2TimestampSchema,
    revision: immutableRevisionSchema
  })
  .strict()
  .superRefine((edge, context) => {
    addTenantReferenceIssues(context, edge.tenantId, edge, []);
    if (edge.originalFileVersion.id === edge.derivedFileVersion.id) {
      addIssue(
        context,
        ["derivedFileVersion"],
        "A lineage edge cannot derive a version from itself."
      );
    }
  });

export const inboxV2FileParentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("upload_staging"),
      attachment: inboxV2MessageAttachmentReferenceSchema,
      uploadRevision: inboxV2EntityRevisionSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("message"),
      conversation: inboxV2ConversationReferenceSchema,
      message: inboxV2MessageReferenceSchema,
      timelineContent: inboxV2TimelineContentReferenceSchema,
      contentRevision: inboxV2EntityRevisionSchema,
      blockKey: blockKeySchema,
      visibilityBoundary: z.enum(["external_work", "internal"])
    })
    .strict(),
  z
    .object({
      kind: z.literal("staff_note"),
      conversation: inboxV2ConversationReferenceSchema,
      staffNote: inboxV2StaffNoteReferenceSchema,
      timelineContent: inboxV2TimelineContentReferenceSchema,
      contentRevision: inboxV2EntityRevisionSchema,
      blockKey: blockKeySchema,
      parentConversationVisibility: z.enum(["external_work", "internal"]),
      visibilityBoundary: z.literal("staff_note")
    })
    .strict()
]);

/** Immutable exact parent edge; liveness is stored in the separately CASed head. */
export const inboxV2FileParentLinkSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2FileParentLinkIdSchema,
    fileVersion: inboxV2FileVersionReferenceSchema,
    objectVersion: inboxV2ObjectVersionReferenceSchema,
    parent: inboxV2FileParentSchema,
    dataClassId: inboxV2DataClassIdSchema,
    purposeId: inboxV2ProcessingPurposeIdSchema,
    retentionAnchorAt: inboxV2TimestampSchema,
    createdAt: inboxV2TimestampSchema,
    revision: immutableRevisionSchema
  })
  .strict()
  .superRefine((link, context) => {
    addTenantReferenceIssues(context, link.tenantId, link, []);
  });

export const inboxV2FileParentLinkHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    link: inboxV2FileParentLinkReferenceSchema,
    state: z.enum(["live", "detached"]),
    revision: inboxV2EntityRevisionSchema,
    detachedByEvent: inboxV2EventReferenceSchema.nullable(),
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    addTenantReferenceIssues(context, head.tenantId, head, []);
    if (
      (head.state === "live") !== (head.detachedByEvent === null) ||
      (head.revision === "1" && head.state !== "live")
    ) {
      addIssue(
        context,
        ["detachedByEvent"],
        "A parent link starts live and only a retained event may detach it."
      );
    }
  });

/** Lockable authority that proves the enumerated live-parent set is complete. */
export const inboxV2FileParentSetHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    file: inboxV2FileReferenceSchema,
    revision: inboxV2EntityRevisionSchema,
    completeness: z.enum(["unknown", "reconciling", "complete"]),
    completenessRevision: inboxV2BigintCounterSchema,
    liveParentCount: z.number().int().min(0).max(1_000_000_000),
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    addTenantReferenceIssues(context, head.tenantId, head, []);
    if (
      BigInt(head.completenessRevision) > BigInt(head.revision) ||
      (head.completeness === "complete" &&
        BigInt(head.completenessRevision) !== BigInt(head.revision))
    ) {
      addIssue(
        context,
        ["completenessRevision"],
        "A complete parent-set head must cover its exact current revision."
      );
    }
  });

const pendingAttachmentMaterializationSchema = z
  .object({
    state: z.literal("pending"),
    attachment: inboxV2MessageAttachmentReferenceSchema
  })
  .strict();

const readyAttachmentMaterializationSchema = z
  .object({
    state: z.literal("ready"),
    attachment: inboxV2MessageAttachmentReferenceSchema,
    ...exactFileObjectPinShape
  })
  .strict()
  .superRefine((state, context) => {
    addTenantReferenceIssues(context, state.attachment.tenantId, state, []);
  });

const failedAttachmentMaterializationSchema = z
  .object({
    state: z.literal("failed"),
    attachment: inboxV2MessageAttachmentReferenceSchema,
    reasonId: inboxV2CatalogIdSchema
  })
  .strict();

const quarantinedAttachmentMaterializationSchema = z
  .object({
    state: z.literal("quarantined"),
    attachment: inboxV2MessageAttachmentReferenceSchema,
    reasonId: inboxV2CatalogIdSchema
  })
  .strict();

/** Legacy state is parseable only for the explicit N-1 compatibility path. */
export const inboxV2LegacyUnpinnedAttachmentMaterializationSchema = z
  .object({
    state: z.literal("legacy_unpinned"),
    attachment: inboxV2MessageAttachmentReferenceSchema,
    file: inboxV2FileReferenceSchema
  })
  .strict()
  .superRefine((state, context) => {
    addTenantReferenceIssues(context, state.attachment.tenantId, state, []);
  });

export const inboxV2CurrentAttachmentMaterializationSchema =
  z.discriminatedUnion("state", [
    pendingAttachmentMaterializationSchema,
    readyAttachmentMaterializationSchema,
    failedAttachmentMaterializationSchema,
    quarantinedAttachmentMaterializationSchema
  ]);

export const inboxV2AttachmentMaterializationSchema = z.discriminatedUnion(
  "state",
  [
    pendingAttachmentMaterializationSchema,
    readyAttachmentMaterializationSchema,
    failedAttachmentMaterializationSchema,
    quarantinedAttachmentMaterializationSchema,
    inboxV2LegacyUnpinnedAttachmentMaterializationSchema
  ]
);

export const inboxV2AttachmentMaterializationClaimSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2AttachmentMaterializationClaimIdSchema,
    attachment: inboxV2MessageAttachmentReferenceSchema,
    expectedAttachmentRevision: inboxV2EntityRevisionSchema,
    claimedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    leaseTokenHash: inboxV2Sha256DigestSchema,
    claimedAt: inboxV2TimestampSchema,
    leaseExpiresAt: inboxV2TimestampSchema,
    revision: immutableRevisionSchema
  })
  .strict()
  .superRefine((claim, context) => {
    addTenantReferenceIssues(context, claim.tenantId, claim, []);
    if (
      !isInboxV2TimestampOrderValid(claim.claimedAt, claim.leaseExpiresAt) ||
      claim.claimedAt === claim.leaseExpiresAt
    ) {
      addIssue(
        context,
        ["leaseExpiresAt"],
        "A materialization claim requires a positive bounded lease window."
      );
    }
  });

export const inboxV2AttachmentMaterializationAttemptSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2AttachmentMaterializationAttemptIdSchema,
    claim: inboxV2AttachmentMaterializationClaimReferenceSchema,
    attachment: inboxV2MessageAttachmentReferenceSchema,
    attemptOrdinal: z.number().int().positive().max(1_000_000),
    expectedAttachmentRevision: inboxV2EntityRevisionSchema,
    openedAt: inboxV2TimestampSchema,
    revision: immutableRevisionSchema
  })
  .strict()
  .superRefine((attempt, context) => {
    addTenantReferenceIssues(context, attempt.tenantId, attempt, []);
  });

export const inboxV2AttachmentMaterializationOutcomeSchema =
  z.discriminatedUnion("state", [
    z
      .object({
        state: z.literal("ready"),
        pin: inboxV2ExactFileObjectPinSchema,
        objectOperationEvidence: inboxV2ObjectOperationEvidenceReferenceSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("failed"),
        reasonId: inboxV2CatalogIdSchema,
        retryable: z.boolean()
      })
      .strict(),
    z
      .object({
        state: z.literal("quarantined"),
        reasonId: inboxV2CatalogIdSchema,
        objectOperationEvidence: inboxV2ObjectOperationEvidenceReferenceSchema
      })
      .strict()
  ]);

export const inboxV2AttachmentMaterializationEvidenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2AttachmentMaterializationEvidenceIdSchema,
    claim: inboxV2AttachmentMaterializationClaimReferenceSchema,
    attempt: inboxV2AttachmentMaterializationAttemptReferenceSchema,
    attachment: inboxV2MessageAttachmentReferenceSchema,
    expectedAttachmentRevision: inboxV2EntityRevisionSchema,
    resultingAttachmentRevision: inboxV2EntityRevisionSchema,
    outcome: inboxV2AttachmentMaterializationOutcomeSchema,
    completedAt: inboxV2TimestampSchema,
    evidenceHash: inboxV2Sha256DigestSchema,
    revision: immutableRevisionSchema
  })
  .strict()
  .superRefine((evidence, context) => {
    addTenantReferenceIssues(context, evidence.tenantId, evidence, []);
    if (
      BigInt(evidence.resultingAttachmentRevision) !==
      BigInt(evidence.expectedAttachmentRevision) + 1n
    ) {
      addIssue(
        context,
        ["resultingAttachmentRevision"],
        "Materialization evidence advances the attachment head exactly once."
      );
    }
  });

/** Current writers may only complete a pending attachment once. */
export const inboxV2AttachmentMaterializationTransitionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    before: pendingAttachmentMaterializationSchema,
    after: z.discriminatedUnion("state", [
      readyAttachmentMaterializationSchema,
      failedAttachmentMaterializationSchema,
      quarantinedAttachmentMaterializationSchema
    ]),
    expectedAttachmentRevision: inboxV2EntityRevisionSchema,
    resultingAttachmentRevision: inboxV2EntityRevisionSchema,
    attempt: inboxV2AttachmentMaterializationAttemptReferenceSchema,
    evidence: inboxV2AttachmentMaterializationEvidenceReferenceSchema,
    occurredAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((transition, context) => {
    addTenantReferenceIssues(context, transition.tenantId, transition, []);
    if (
      transition.before.attachment.id !== transition.after.attachment.id ||
      transition.before.attachment.tenantId !==
        transition.after.attachment.tenantId
    ) {
      addIssue(
        context,
        ["after", "attachment"],
        "Materialization cannot replace the attachment identity."
      );
    }
    if (
      BigInt(transition.resultingAttachmentRevision) !==
      BigInt(transition.expectedAttachmentRevision) + 1n
    ) {
      addIssue(
        context,
        ["resultingAttachmentRevision"],
        "Materialization must advance the attachment head exactly once."
      );
    }
  });

export function isInboxV2AttachmentMaterializationTransition(
  before: z.input<typeof inboxV2AttachmentMaterializationSchema>,
  after: z.input<typeof inboxV2AttachmentMaterializationSchema>
): boolean {
  return (
    before.state === "pending" &&
    (after.state === "ready" ||
      after.state === "failed" ||
      after.state === "quarantined") &&
    before.attachment.tenantId === after.attachment.tenantId &&
    before.attachment.id === after.attachment.id
  );
}

export const inboxV2ObjectDeletionAuthorizationSchema = z
  .object({
    expectedObjectHeadRevision: inboxV2EntityRevisionSchema,
    liveParentCount: inboxV2BigintCounterSchema,
    activePurposeCount: inboxV2BigintCounterSchema,
    activeHoldCount: inboxV2BigintCounterSchema,
    evaluatedAt: inboxV2TimestampSchema,
    decisionDigestSha256: rawSha256Schema
  })
  .strict();

/**
 * Safe evidence intentionally excludes storage locators, provider version
 * tokens, filenames and raw provider responses.
 */
export const inboxV2ObjectOperationEvidenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ObjectOperationEvidenceIdSchema,
    operation: z.enum([
      "put",
      "head",
      "list_versions",
      "quarantine",
      "delete_current",
      "delete_version",
      "orphan_reconcile"
    ]),
    objectVersion: inboxV2ObjectVersionReferenceSchema,
    materializationClaim:
      inboxV2AttachmentMaterializationClaimReferenceSchema.nullable(),
    storageRootId: inboxV2StorageRootIdSchema,
    attemptToken: inboxV2RoutingTokenSchema,
    outcome: z.enum([
      "succeeded",
      "already_absent_verified",
      "retryable_failure",
      "terminal_failure",
      "unsupported"
    ]),
    observedVersionCount: z.number().int().min(0).max(1_000_000).nullable(),
    affectedBytes: inboxV2BigintCounterSchema.nullable(),
    reasonId: inboxV2CatalogIdSchema.nullable(),
    deletionEvidenceDigestSha256: rawSha256Schema.nullable(),
    deletionAuthorization: inboxV2ObjectDeletionAuthorizationSchema.nullable(),
    requestedAt: inboxV2TimestampSchema,
    completedAt: inboxV2TimestampSchema,
    revision: immutableRevisionSchema
  })
  .strict()
  .superRefine((evidence, context) => {
    addTenantReferenceIssues(context, evidence.tenantId, evidence, []);
    const isFailure =
      evidence.outcome === "retryable_failure" ||
      evidence.outcome === "terminal_failure" ||
      evidence.outcome === "unsupported";
    if (isFailure !== (evidence.reasonId !== null)) {
      addIssue(
        context,
        ["reasonId"],
        "Only failed object operations require a safe diagnostic reason."
      );
    }
    const isDelete =
      evidence.operation === "delete_current" ||
      evidence.operation === "delete_version";
    if (
      isDelete !== (evidence.deletionAuthorization !== null) ||
      isDelete !== (evidence.deletionEvidenceDigestSha256 !== null)
    ) {
      addIssue(
        context,
        ["deletionAuthorization"],
        "Exact-version deletion requires a current parent/purpose/hold decision."
      );
    }
    if (
      isDelete &&
      evidence.deletionAuthorization !== null &&
      (evidence.deletionAuthorization.liveParentCount !== "0" ||
        evidence.deletionAuthorization.activePurposeCount !== "0" ||
        evidence.deletionAuthorization.activeHoldCount !== "0")
    ) {
      addIssue(
        context,
        ["deletionAuthorization"],
        "Object deletion is forbidden while any live parent, purpose or hold remains."
      );
    }
    if (
      isDelete &&
      evidence.deletionAuthorization !== null &&
      evidence.deletionEvidenceDigestSha256 !==
        evidence.deletionAuthorization.decisionDigestSha256
    ) {
      addIssue(
        context,
        ["deletionEvidenceDigestSha256"],
        "Deletion evidence must pin the exact current parent/purpose/hold decision."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(evidence.requestedAt, evidence.completedAt)
    ) {
      addIssue(
        context,
        ["completedAt"],
        "Object operation completion cannot precede its request."
      );
    }
  });

export const inboxV2OutboundDispatchContentFingerprintSchema = z
  .object({
    purposeId: z.literal(
      INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID
    ),
    keyGeneration: contentFingerprintKeyGenerationSchema,
    validUntil: inboxV2TimestampSchema,
    hmacSha256: hmacSha256Schema
  })
  .strict();

export type InboxV2OutboundDispatchContentFingerprintProtection = Readonly<{
  tenantId: string;
  purposeId: typeof INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID;
  keyGeneration: string;
  validUntil: string;
  key: Uint8Array;
}>;

export type InboxV2OutboundDispatchContentFingerprintInput = Readonly<{
  tenantId: string;
  timelineContent: z.input<typeof inboxV2TimelineContentReferenceSchema>;
  contentRevision: string;
  /** Transient purgeable digest input. It is never part of the persisted plan. */
  contentDigestSha256: string;
}>;

export function calculateInboxV2OutboundDispatchContentFingerprint(
  rawInput: InboxV2OutboundDispatchContentFingerprintInput,
  rawProtection: InboxV2OutboundDispatchContentFingerprintProtection
) {
  const input = {
    tenantId: inboxV2TenantIdSchema.parse(rawInput.tenantId),
    timelineContent: inboxV2TimelineContentReferenceSchema.parse(
      rawInput.timelineContent
    ),
    contentRevision: inboxV2EntityRevisionSchema.parse(
      rawInput.contentRevision
    ),
    contentDigestSha256: rawSha256Schema.parse(rawInput.contentDigestSha256)
  };
  const protection = {
    tenantId: inboxV2TenantIdSchema.parse(rawProtection.tenantId),
    purposeId: z
      .literal(INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID)
      .parse(rawProtection.purposeId),
    keyGeneration: contentFingerprintKeyGenerationSchema.parse(
      rawProtection.keyGeneration
    ),
    validUntil: inboxV2TimestampSchema.parse(rawProtection.validUntil)
  };
  if (
    input.tenantId !== protection.tenantId ||
    input.timelineContent.tenantId !== input.tenantId
  ) {
    throw new TypeError(
      "Outbound content fingerprints require one exact tenant scope."
    );
  }
  if (
    !(rawProtection.key instanceof Uint8Array) ||
    rawProtection.key.byteLength < 32 ||
    rawProtection.key.byteLength > 128
  ) {
    throw new TypeError(
      "Outbound content fingerprint keys must contain 32-128 secret bytes."
    );
  }
  const digest = bytesToHex(
    hmac(
      sha256,
      rawProtection.key,
      encodeInboxV2CanonicalJson({
        domain: "core:inbox-v2.outbound-dispatch-content-fingerprint",
        hashVersion: INBOX_V2_FILE_OBJECT_SCHEMA_VERSION,
        protection: {
          tenantId: protection.tenantId,
          purposeId: protection.purposeId,
          keyGeneration: protection.keyGeneration,
          validUntil: protection.validUntil
        },
        timelineContent: input.timelineContent,
        contentRevision: input.contentRevision,
        contentDigestSha256: input.contentDigestSha256
      })
    )
  );
  return inboxV2OutboundDispatchContentFingerprintSchema.parse({
    purposeId: protection.purposeId,
    keyGeneration: protection.keyGeneration,
    validUntil: protection.validUntil,
    hmacSha256: `hmac-sha256:${digest}`
  });
}

const outboundDispatchContentPlanBaseSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboundDispatchContentPlanIdSchema,
    dispatch: inboxV2OutboundDispatchReferenceSchema,
    message: inboxV2MessageReferenceSchema,
    messageRevision: inboxV2EntityRevisionSchema,
    conversation: inboxV2ConversationReferenceSchema,
    timelineItem: inboxV2TimelineItemReferenceSchema,
    route: inboxV2OutboundRouteReferenceSchema,
    timelineContent: inboxV2TimelineContentReferenceSchema,
    contentRevision: inboxV2EntityRevisionSchema,
    contentFingerprint: inboxV2OutboundDispatchContentFingerprintSchema,
    binding: inboxV2SourceThreadBindingReferenceSchema,
    bindingRevision: inboxV2EntityRevisionSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    blocks: z
      .array(
        z
          .object({
            blockKey: blockKeySchema,
            blockKind: z.enum([
              "text",
              "image",
              "audio",
              "video",
              "file",
              "sticker",
              "location",
              "contact",
              "extension"
            ]),
            exactFileObjectPin: inboxV2ExactFileObjectPinSchema.nullable(),
            artifactOrdinal: z.number().int().positive().max(64)
          })
          .strict()
      )
      .min(1)
      .max(64),
    artifacts: z
      .array(
        z
          .object({
            ordinal: z.number().int().positive().max(64),
            grouping: z.enum(["single", "album", "split"]),
            capabilityId: inboxV2SourceCapabilityIdSchema,
            operationId: inboxV2SourceOperationIdSchema,
            blockKeys: z.array(blockKeySchema).min(1).max(64)
          })
          .strict()
      )
      .min(1)
      .max(64),
    createdAt: inboxV2TimestampSchema,
    revision: immutableRevisionSchema
  })
  .strict();

export type InboxV2OutboundDispatchContentPlanDigestInput = z.input<
  typeof outboundDispatchContentPlanBaseSchema
>;

export function calculateInboxV2OutboundDispatchContentPlanDigest(
  input: InboxV2OutboundDispatchContentPlanDigestInput
) {
  const digest = calculateInboxV2CanonicalSha256({
    domain: INBOX_V2_OUTBOUND_DISPATCH_CONTENT_PLAN_SCHEMA_ID,
    hashVersion: INBOX_V2_FILE_OBJECT_SCHEMA_VERSION,
    plan: input
  });
  return rawSha256Schema.parse(digest.slice("sha256:".length));
}

export const inboxV2OutboundDispatchContentPlanSchema =
  outboundDispatchContentPlanBaseSchema
    .extend({ planDigestSha256: rawSha256Schema })
    .strict()
    .superRefine((plan, context) => {
      addTenantReferenceIssues(context, plan.tenantId, plan, []);
      const blockKeys = plan.blocks.map((block) => block.blockKey);
      const artifactOrdinals = plan.artifacts.map(
        (artifact) => artifact.ordinal
      );
      const plannedBlockKeys = plan.artifacts.flatMap(
        (artifact) => artifact.blockKeys
      );
      const sortedOrdinals = [...artifactOrdinals].sort(
        (left, right) => left - right
      );
      if (
        new Set(blockKeys).size !== blockKeys.length ||
        new Set(artifactOrdinals).size !== artifactOrdinals.length ||
        new Set(plannedBlockKeys).size !== plannedBlockKeys.length ||
        plannedBlockKeys.length !== blockKeys.length ||
        blockKeys.some((blockKey) => !plannedBlockKeys.includes(blockKey)) ||
        sortedOrdinals.some((ordinal, index) => ordinal !== index + 1) ||
        plan.blocks.some(
          (block) =>
            !plan.artifacts.some(
              (artifact) =>
                artifact.ordinal === block.artifactOrdinal &&
                artifact.blockKeys.includes(block.blockKey)
            )
        )
      ) {
        addIssue(
          context,
          ["artifacts"],
          "Artifact ordinals are contiguous and partition every block exactly once."
        );
      }
      for (const [index, block] of plan.blocks.entries()) {
        const requiresPin =
          block.blockKind === "image" ||
          block.blockKind === "audio" ||
          block.blockKind === "video" ||
          block.blockKind === "file" ||
          block.blockKind === "sticker" ||
          block.blockKind === "extension";
        const forbidsPin =
          block.blockKind === "text" ||
          block.blockKind === "location" ||
          block.blockKind === "contact";
        if (
          (requiresPin && block.exactFileObjectPin === null) ||
          (forbidsPin && block.exactFileObjectPin !== null)
        ) {
          addIssue(
            context,
            ["blocks", index, "exactFileObjectPin"],
            "File-backed dispatch blocks, including extension payloads, require one exact file/object pin; inline blocks forbid it."
          );
        }
      }
      if (
        !isInboxV2TimestampOrderValid(
          plan.createdAt,
          plan.contentFingerprint.validUntil
        ) ||
        plan.createdAt === plan.contentFingerprint.validUntil
      ) {
        addIssue(
          context,
          ["contentFingerprint", "validUntil"],
          "Outbound content fingerprint key validity must end strictly after plan creation."
        );
      }
      const { planDigestSha256: _planDigest, ...digestInput } = plan;
      if (
        plan.planDigestSha256 !==
        calculateInboxV2OutboundDispatchContentPlanDigest(digestInput)
      ) {
        addIssue(
          context,
          ["planDigestSha256"],
          "Dispatch content plan digest must match the domain-separated canonical plan."
        );
      }
    });

export type InboxV2ExactFileObjectPin = z.infer<
  typeof inboxV2ExactFileObjectPinSchema
>;
export type InboxV2FileVersion = z.infer<typeof inboxV2FileVersionSchema>;
export type InboxV2ObjectVersion = z.infer<typeof inboxV2ObjectVersionSchema>;
export type InboxV2ObjectVersionHead = z.infer<
  typeof inboxV2ObjectVersionHeadSchema
>;
export type InboxV2FileLineageEdge = z.infer<
  typeof inboxV2FileLineageEdgeSchema
>;
export type InboxV2FileParentLink = z.infer<typeof inboxV2FileParentLinkSchema>;
export type InboxV2FileParentLinkHead = z.infer<
  typeof inboxV2FileParentLinkHeadSchema
>;
export type InboxV2FileParentSetHead = z.infer<
  typeof inboxV2FileParentSetHeadSchema
>;
export type InboxV2AttachmentMaterialization = z.infer<
  typeof inboxV2AttachmentMaterializationSchema
>;
export type InboxV2CurrentAttachmentMaterialization = z.infer<
  typeof inboxV2CurrentAttachmentMaterializationSchema
>;
export type InboxV2ExtensionPayloadPin = z.infer<
  typeof inboxV2ExtensionPayloadPinSchema
>;
export type InboxV2AttachmentMaterializationClaim = z.infer<
  typeof inboxV2AttachmentMaterializationClaimSchema
>;
export type InboxV2AttachmentMaterializationAttempt = z.infer<
  typeof inboxV2AttachmentMaterializationAttemptSchema
>;
export type InboxV2AttachmentMaterializationOutcome = z.infer<
  typeof inboxV2AttachmentMaterializationOutcomeSchema
>;
export type InboxV2AttachmentMaterializationEvidence = z.infer<
  typeof inboxV2AttachmentMaterializationEvidenceSchema
>;
export type InboxV2ObjectOperationEvidence = z.infer<
  typeof inboxV2ObjectOperationEvidenceSchema
>;
export type InboxV2OutboundDispatchContentFingerprint = z.infer<
  typeof inboxV2OutboundDispatchContentFingerprintSchema
>;
export type InboxV2OutboundDispatchContentPlan = z.infer<
  typeof inboxV2OutboundDispatchContentPlanSchema
>;

function addTenantReferenceIssues(
  context: z.RefinementCtx,
  tenantId: string,
  value: unknown,
  path: PropertyKey[]
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      addTenantReferenceIssues(context, tenantId, item, [...path, index])
    );
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.tenantId === "string" && record.tenantId !== tenantId) {
    addIssue(
      context,
      path,
      "File/object contract references must share one tenant."
    );
  }
  for (const [key, nested] of Object.entries(record)) {
    addTenantReferenceIssues(context, tenantId, nested, [...path, key]);
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
