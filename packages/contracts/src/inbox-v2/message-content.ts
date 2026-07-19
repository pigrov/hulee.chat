import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2AttachmentMaterializationSchema,
  inboxV2ExtensionPayloadPinSchema,
  isInboxV2AttachmentMaterializationTransition
} from "./file-object";
import {
  inboxV2EventReferenceSchema,
  inboxV2FileReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineContentIdSchema,
  inboxV2TimelineContentReferenceSchema
} from "./ids";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaIdSchema,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";

export const INBOX_V2_TIMELINE_CONTENT_SCHEMA_ID =
  "core:inbox-v2.timeline-content" as const;
export const INBOX_V2_TIMELINE_CONTENT_TRANSITION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.timeline-content-transition-commit" as const;
export const INBOX_V2_MESSAGE_CONTENT_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_CONTENT_REASON_CATALOG = "content-reason" as const;
export const INBOX_V2_CONTENT_KIND_CATALOG = "content-kind" as const;
export const INBOX_V2_CONTENT_RENDERER_CATALOG = "content-renderer" as const;
export const INBOX_V2_RETENTION_POLICY_CATALOG = "retention-policy" as const;

export type InboxV2ContentBlockKey = Brand<string, "InboxV2ContentBlockKey">;
export type InboxV2ContentDigestSha256 = Brand<
  string,
  "InboxV2ContentDigestSha256"
>;
export type InboxV2ContentReasonId = InboxV2CatalogId<
  typeof INBOX_V2_CONTENT_REASON_CATALOG
>;
export type InboxV2ContentKindId = InboxV2CatalogId<
  typeof INBOX_V2_CONTENT_KIND_CATALOG
>;
export type InboxV2ContentRendererId = InboxV2CatalogId<
  typeof INBOX_V2_CONTENT_RENDERER_CATALOG
>;
export type InboxV2RetentionPolicyId = InboxV2CatalogId<
  typeof INBOX_V2_RETENTION_POLICY_CATALOG
>;

export const inboxV2ContentBlockKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/u)
  .transform((value) => value as InboxV2ContentBlockKey);
export const inboxV2ContentDigestSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .transform((value) => value as InboxV2ContentDigestSha256);
export const inboxV2ContentReasonIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2ContentReasonId
);
export const inboxV2ContentKindIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2ContentKindId
);
export const inboxV2ContentRendererIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2ContentRendererId
);
export const inboxV2RetentionPolicyIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2RetentionPolicyId
);

const blockBase = {
  blockKey: inboxV2ContentBlockKeySchema
};

const textBlockSchema = z
  .object({
    ...blockBase,
    kind: z.literal("text"),
    role: z.enum(["body", "caption"]),
    text: z.string().min(1).max(100_000),
    language: z.string().min(2).max(35).nullable()
  })
  .strict();

function attachmentBlockSchema<
  const TKind extends "image" | "file" | "sticker"
>(kind: TKind) {
  return z
    .object({
      ...blockBase,
      kind: z.literal(kind),
      attachment: inboxV2AttachmentMaterializationSchema,
      displayName: z.string().min(1).max(512).nullable()
    })
    .strict();
}

const audioBlockSchema = z
  .object({
    ...blockBase,
    kind: z.literal("audio"),
    semantic: z.enum(["audio", "voice"]),
    attachment: inboxV2AttachmentMaterializationSchema
  })
  .strict();

const videoBlockSchema = z
  .object({
    ...blockBase,
    kind: z.literal("video"),
    semantic: z.enum(["video", "video_note"]),
    attachment: inboxV2AttachmentMaterializationSchema
  })
  .strict();

const locationBlockSchema = z
  .object({
    ...blockBase,
    kind: z.literal("location"),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().nonnegative().nullable(),
    mode: z.enum(["static", "live"]),
    liveUntil: inboxV2TimestampSchema.nullable(),
    headingDegrees: z.number().finite().min(0).max(360).nullable(),
    label: z.string().min(1).max(512).nullable(),
    address: z.string().min(1).max(2_000).nullable()
  })
  .strict()
  .superRefine((block, context) => {
    if ((block.mode === "live") !== (block.liveUntil !== null)) {
      addIssue(
        context,
        ["liveUntil"],
        "Only a live location carries a live-until timestamp."
      );
    }
  });

const contactValueSchema = z
  .object({
    kind: z.enum(["phone", "email", "url", "other"]),
    value: z.string().min(1).max(2_000),
    label: z.string().min(1).max(120).nullable()
  })
  .strict();

const contactBlockSchema = z
  .object({
    ...blockBase,
    kind: z.literal("contact"),
    displayName: z.string().min(1).max(512),
    organization: z.string().min(1).max(512).nullable(),
    values: z.array(contactValueSchema).min(1).max(64)
  })
  .strict();

const unsupportedSourceContentBlockSchema = z
  .object({
    ...blockBase,
    kind: z.literal("unsupported_source_content"),
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    providerContentKindId: inboxV2ContentKindIdSchema,
    safeFallbackReasonId: inboxV2ContentReasonIdSchema
  })
  .strict();

const extensionBlockSchema = z
  .object({
    ...blockBase,
    kind: z.literal("extension"),
    blockKindId: inboxV2ContentKindIdSchema,
    payloadSchemaId: inboxV2SchemaIdSchema,
    payloadSchemaVersion: inboxV2SchemaVersionTokenSchema,
    payloadFile: inboxV2FileReferenceSchema,
    payloadPin: inboxV2ExtensionPayloadPinSchema,
    payloadDigestSha256: inboxV2ContentDigestSha256Schema,
    rendererId: inboxV2ContentRendererIdSchema
  })
  .strict();

export const inboxV2MessageContentBlockSchema = z.discriminatedUnion("kind", [
  textBlockSchema,
  attachmentBlockSchema("image"),
  audioBlockSchema,
  videoBlockSchema,
  attachmentBlockSchema("file"),
  attachmentBlockSchema("sticker"),
  locationBlockSchema,
  contactBlockSchema,
  unsupportedSourceContentBlockSchema,
  extensionBlockSchema
]);

/** Digest of ordered provider-neutral content, separated from every other hash domain. */
export function calculateInboxV2MessageContentDigest(
  blocks: readonly z.input<typeof inboxV2MessageContentBlockSchema>[]
): InboxV2ContentDigestSha256 {
  const digest = calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.timeline-content-blocks",
    hashVersion: INBOX_V2_MESSAGE_CONTENT_SCHEMA_VERSION,
    blocks
  });
  return inboxV2ContentDigestSha256Schema.parse(digest.slice("sha256:".length));
}

export function verifyInboxV2MessageContentDigest(
  blocks: readonly z.input<typeof inboxV2MessageContentBlockSchema>[],
  digest: string
): boolean {
  return calculateInboxV2MessageContentDigest(blocks) === digest;
}

export const inboxV2TimelineContentStateKindSchema = z.enum([
  "available",
  "privacy_erased",
  "retention_purged"
]);

export const inboxV2TimelineContentDraftSchema = z
  .object({
    blocks: z.array(inboxV2MessageContentBlockSchema).min(1).max(64)
  })
  .strict()
  .superRefine((draft, context) => {
    addDuplicateBlockKeyIssues(context, draft.blocks, ["blocks"]);
    addDuplicateAttachmentIdIssues(context, draft.blocks, ["blocks"]);
    addLegacyUnpinnedIssues(context, draft.blocks, ["blocks"]);
  });

export const inboxV2TimelineContentStateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("available"),
      blocks: z.array(inboxV2MessageContentBlockSchema).min(1).max(64),
      contentDigestSha256: inboxV2ContentDigestSha256Schema
    })
    .strict()
    .superRefine((state, context) => {
      addDuplicateBlockKeyIssues(context, state.blocks, ["blocks"]);
      addDuplicateAttachmentIdIssues(context, state.blocks, ["blocks"]);
      if (
        !verifyInboxV2MessageContentDigest(
          state.blocks,
          state.contentDigestSha256
        )
      ) {
        addIssue(
          context,
          ["contentDigestSha256"],
          "Content digest must match the domain-separated canonical ordered blocks."
        );
      }
    }),
  z
    .object({
      kind: z.literal("privacy_erased"),
      tombstoneEvent: inboxV2EventReferenceSchema,
      reasonId: inboxV2ContentReasonIdSchema,
      erasedAt: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("retention_purged"),
      tombstoneEvent: inboxV2EventReferenceSchema,
      policyId: inboxV2RetentionPolicyIdSchema,
      policyVersion: inboxV2SchemaVersionTokenSchema,
      policyRevision: inboxV2EntityRevisionSchema,
      purgedAt: inboxV2TimestampSchema
    })
    .strict()
]);

export const inboxV2TimelineContentHeadSchema = z
  .object({
    content: inboxV2TimelineContentReferenceSchema,
    contentRevision: inboxV2EntityRevisionSchema,
    stateKind: inboxV2TimelineContentStateKindSchema
  })
  .strict();

export const inboxV2TimelineContentSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2TimelineContentIdSchema,
    state: inboxV2TimelineContentStateSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((content, context) => {
    addContentStateTenantIssues(context, content.tenantId, content.state);
    if (!isInboxV2TimestampOrderValid(content.createdAt, content.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "Timeline content update cannot precede creation."
      );
    }
    if (
      content.revision === "1" &&
      (content.state.kind !== "available" ||
        content.createdAt !== content.updatedAt)
    ) {
      addIssue(
        context,
        ["revision"],
        "Timeline content starts as one available revision."
      );
    }
    if (
      content.state.kind === "privacy_erased" &&
      content.state.erasedAt !== content.updatedAt
    ) {
      addIssue(
        context,
        ["state", "erasedAt"],
        "Privacy tombstone time is the content revision time."
      );
    }
    if (
      content.state.kind === "retention_purged" &&
      content.state.purgedAt !== content.updatedAt
    ) {
      addIssue(
        context,
        ["state", "purgedAt"],
        "Retention tombstone time is the content revision time."
      );
    }
  });

export const inboxV2TimelineContentTransitionSchema = z
  .object({
    kind: z.enum([
      "edit",
      "attachment_materialization",
      "privacy_erasure",
      "retention_purge"
    ]),
    expectedRevision: inboxV2EntityRevisionSchema,
    resultingRevision: inboxV2EntityRevisionSchema,
    event: inboxV2EventReferenceSchema,
    occurredAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((transition, context) => {
    if (
      BigInt(transition.resultingRevision) !==
      BigInt(transition.expectedRevision) + 1n
    ) {
      addIssue(
        context,
        ["resultingRevision"],
        "Content transition must advance exactly one revision."
      );
    }
  });

export const inboxV2TimelineContentTransitionCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    before: inboxV2TimelineContentSchema,
    transition: inboxV2TimelineContentTransitionSchema,
    after: inboxV2TimelineContentSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const { before, transition, after } = commit;
    if (
      commit.tenantId !== before.tenantId ||
      commit.tenantId !== after.tenantId ||
      transition.event.tenantId !== commit.tenantId ||
      before.id !== after.id ||
      before.revision !== transition.expectedRevision ||
      after.revision !== transition.resultingRevision ||
      before.createdAt !== after.createdAt ||
      after.updatedAt !== transition.occurredAt ||
      Date.parse(transition.occurredAt) < Date.parse(before.updatedAt)
    ) {
      addIssue(
        context,
        ["after"],
        "Content transition must bind one exact tenant-owned CAS row."
      );
    }
    const expectedAfterKind =
      transition.kind === "edit" ||
      transition.kind === "attachment_materialization"
        ? "available"
        : transition.kind === "privacy_erasure"
          ? "privacy_erased"
          : "retention_purged";
    if (
      before.state.kind !== "available" ||
      after.state.kind !== expectedAfterKind
    ) {
      addIssue(
        context,
        ["after", "state"],
        "Content mutation starts from available content and has one explicit outcome family."
      );
    }
    if (
      after.state.kind !== "available" &&
      after.state.tombstoneEvent.id !== transition.event.id
    ) {
      addIssue(
        context,
        ["after", "state", "tombstoneEvent"],
        "Content tombstone must retain the exact transition event."
      );
    }
    if (
      transition.kind === "edit" &&
      before.state.kind === "available" &&
      after.state.kind === "available" &&
      (before.state.contentDigestSha256 === after.state.contentDigestSha256 ||
        isAttachmentMaterializationOnly(before.state, after.state))
    ) {
      addIssue(
        context,
        ["after", "state", "contentDigestSha256"],
        "Content edit cannot be a semantic no-op or attachment-only materialization."
      );
    }
    if (
      transition.kind === "edit" &&
      before.state.kind === "available" &&
      after.state.kind === "available"
    ) {
      addAttachmentOwnerContinuityIssues(
        context,
        before.state.blocks,
        after.state.blocks
      );
    }
    if (
      transition.kind === "attachment_materialization" &&
      (before.state.kind !== "available" ||
        after.state.kind !== "available" ||
        before.state.contentDigestSha256 === after.state.contentDigestSha256 ||
        !isAttachmentMaterializationOnly(before.state, after.state))
    ) {
      addIssue(
        context,
        ["after", "state", "blocks"],
        "Attachment materialization changes only state for the same attachment blocks."
      );
    }
  });

export const inboxV2TimelineContentEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_TIMELINE_CONTENT_SCHEMA_ID,
    INBOX_V2_MESSAGE_CONTENT_SCHEMA_VERSION,
    inboxV2TimelineContentSchema
  );
export const inboxV2TimelineContentTransitionCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_TIMELINE_CONTENT_TRANSITION_COMMIT_SCHEMA_ID,
    INBOX_V2_MESSAGE_CONTENT_SCHEMA_VERSION,
    inboxV2TimelineContentTransitionCommitSchema
  );

export type InboxV2MessageContentBlock = z.infer<
  typeof inboxV2MessageContentBlockSchema
>;
export type InboxV2TimelineContent = z.infer<
  typeof inboxV2TimelineContentSchema
>;
export type InboxV2TimelineContentHead = z.infer<
  typeof inboxV2TimelineContentHeadSchema
>;

export function inboxV2TimelineContentHeadOf(
  content: InboxV2TimelineContent
): InboxV2TimelineContentHead {
  return inboxV2TimelineContentHeadSchema.parse({
    content: {
      tenantId: content.tenantId,
      kind: "timeline_content",
      id: content.id
    },
    contentRevision: content.revision,
    stateKind: content.state.kind
  });
}

function addContentStateTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  state: z.infer<typeof inboxV2TimelineContentStateSchema>
): void {
  if (state.kind === "available") {
    for (const [index, block] of state.blocks.entries()) {
      if ("attachment" in block) {
        addTenantReferenceIssue(
          context,
          tenantId,
          block.attachment.attachment,
          ["state", "blocks", index, "attachment", "attachment"]
        );
        if (
          block.attachment.state === "ready" ||
          block.attachment.state === "legacy_unpinned"
        ) {
          addTenantReferenceIssue(context, tenantId, block.attachment.file, [
            "state",
            "blocks",
            index,
            "attachment",
            "file"
          ]);
        }
        if (block.attachment.state === "ready") {
          addTenantReferenceIssue(
            context,
            tenantId,
            block.attachment.fileVersion,
            ["state", "blocks", index, "attachment", "fileVersion"]
          );
          addTenantReferenceIssue(
            context,
            tenantId,
            block.attachment.objectVersion,
            ["state", "blocks", index, "attachment", "objectVersion"]
          );
        }
      } else if (block.kind === "unsupported_source_content") {
        addTenantReferenceIssue(context, tenantId, block.sourceOccurrence, [
          "state",
          "blocks",
          index,
          "sourceOccurrence"
        ]);
      } else if (block.kind === "extension") {
        addTenantReferenceIssue(context, tenantId, block.payloadFile, [
          "state",
          "blocks",
          index,
          "payloadFile"
        ]);
        if (block.payloadPin.state === "exact") {
          addTenantReferenceIssue(
            context,
            tenantId,
            block.payloadPin.fileVersion,
            ["state", "blocks", index, "payloadPin", "fileVersion"]
          );
          addTenantReferenceIssue(
            context,
            tenantId,
            block.payloadPin.objectVersion,
            ["state", "blocks", index, "payloadPin", "objectVersion"]
          );
        }
      }
    }
  } else {
    addTenantReferenceIssue(context, tenantId, state.tombstoneEvent, [
      "state",
      "tombstoneEvent"
    ]);
  }
}

function isAttachmentMaterializationOnly(
  before: Extract<
    z.infer<typeof inboxV2TimelineContentStateSchema>,
    { kind: "available" }
  >,
  after: Extract<
    z.infer<typeof inboxV2TimelineContentStateSchema>,
    { kind: "available" }
  >
): boolean {
  if (before.blocks.length !== after.blocks.length) {
    return false;
  }

  let changedCount = 0;
  for (const [index, beforeBlock] of before.blocks.entries()) {
    const afterBlock = after.blocks[index];
    if (
      afterBlock === undefined ||
      beforeBlock.blockKey !== afterBlock.blockKey ||
      beforeBlock.kind !== afterBlock.kind
    ) {
      return false;
    }

    if (!("attachment" in beforeBlock) || !("attachment" in afterBlock)) {
      if (!sameValue(beforeBlock, afterBlock)) {
        return false;
      }
      continue;
    }

    const beforeAttachment = beforeBlock.attachment;
    const afterAttachment = afterBlock.attachment;
    const { attachment: _beforeMaterialization, ...beforeFacts } = beforeBlock;
    const { attachment: _afterMaterialization, ...afterFacts } = afterBlock;
    if (
      !sameValue(beforeFacts, afterFacts) ||
      !sameValue(beforeAttachment.attachment, afterAttachment.attachment)
    ) {
      return false;
    }
    if (sameValue(beforeAttachment, afterAttachment)) {
      continue;
    }
    if (
      !isInboxV2AttachmentMaterializationTransition(
        beforeAttachment,
        afterAttachment
      )
    ) {
      return false;
    }
    changedCount += 1;
  }
  return changedCount === 1;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addDuplicateBlockKeyIssues(
  context: z.RefinementCtx,
  blocks: readonly { blockKey: string }[],
  path: PropertyKey[]
): void {
  const seen = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    if (seen.has(block.blockKey)) {
      addIssue(
        context,
        [...path, index, "blockKey"],
        "Content block keys are unique within one ordered snapshot."
      );
    }
    seen.add(block.blockKey);
  }
}

function addDuplicateAttachmentIdIssues(
  context: z.RefinementCtx,
  blocks: readonly z.infer<typeof inboxV2MessageContentBlockSchema>[],
  path: PropertyKey[]
): void {
  const seen = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    if (!("attachment" in block)) continue;
    const attachmentId = block.attachment.attachment.id;
    if (seen.has(attachmentId)) {
      addIssue(
        context,
        [...path, index, "attachment", "attachment", "id"],
        "Attachment ids are unique within one ordered content snapshot."
      );
    }
    seen.add(attachmentId);
  }
}

function addAttachmentOwnerContinuityIssues(
  context: z.RefinementCtx,
  beforeBlocks: readonly z.infer<typeof inboxV2MessageContentBlockSchema>[],
  afterBlocks: readonly z.infer<typeof inboxV2MessageContentBlockSchema>[]
): void {
  const afterAttachmentIds = new Set(
    afterBlocks.flatMap((block) =>
      "attachment" in block ? [block.attachment.attachment.id] : []
    )
  );
  for (const block of beforeBlocks) {
    if (
      "attachment" in block &&
      !afterAttachmentIds.has(block.attachment.attachment.id)
    ) {
      addIssue(
        context,
        ["after", "state", "blocks"],
        "A semantic edit cannot remove or replace an attachment identity before a detach lifecycle exists."
      );
    }
  }
  const beforeByAttachmentId = new Map(
    beforeBlocks.flatMap((block) =>
      "attachment" in block
        ? [[block.attachment.attachment.id, block] as const]
        : []
    )
  );
  for (const [index, block] of afterBlocks.entries()) {
    if (!("attachment" in block)) continue;
    const before = beforeByAttachmentId.get(block.attachment.attachment.id);
    if (before === undefined) continue;
    if (
      before.blockKey !== block.blockKey ||
      before.attachment.state !== block.attachment.state
    ) {
      addIssue(
        context,
        ["after", "state", "blocks", index, "attachment"],
        "A semantic edit cannot move an attachment identity or change its materialization state."
      );
    }
  }
}

function addLegacyUnpinnedIssues(
  context: z.RefinementCtx,
  blocks: readonly z.infer<typeof inboxV2MessageContentBlockSchema>[],
  path: PropertyKey[]
): void {
  for (const [index, block] of blocks.entries()) {
    const legacyAttachment =
      "attachment" in block && block.attachment.state === "legacy_unpinned";
    const legacyExtension =
      block.kind === "extension" &&
      block.payloadPin.state === "legacy_unpinned";
    if (legacyAttachment || legacyExtension) {
      addIssue(
        context,
        [...path, index],
        "Legacy unpinned file state is accepted only while reading the N-1 snapshot, never in a new content draft."
      );
    }
  }
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(context, path, "Content references must share one tenant.");
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
