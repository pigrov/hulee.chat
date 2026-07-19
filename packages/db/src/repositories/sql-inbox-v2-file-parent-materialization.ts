import { createHash } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

import {
  calculateInboxV2FileParentIdentityDigest,
  type AttachInboxV2FileParentInput,
  type InboxV2FileParentDescriptor
} from "./sql-inbox-v2-file-object-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const preparedFileParentAttachmentBrand: unique symbol = Symbol(
  "inbox-v2-prepared-file-parent-attachment"
);

export type InboxV2PreparedFileParentAttachmentsCapability = Readonly<{
  [preparedFileParentAttachmentBrand]: true;
}>;

export type InboxV2ReadyFileParentAttachment = Readonly<{
  fileId: string;
  expectedFileRevision: string;
  fileVersionId: string;
  objectVersionId: string;
  parent: InboxV2FileParentDescriptor;
  processingPurposeId: string;
  retentionAnchorAt: string;
}>;

export type PrepareInboxV2FileParentAttachmentsInput = Readonly<{
  tenantId: string;
  attachments: readonly InboxV2ReadyFileParentAttachment[];
}>;

export type PrepareInboxV2FileParentAttachmentsResult =
  | Readonly<{
      kind: "ready";
      capability: InboxV2PreparedFileParentAttachmentsCapability;
    }>
  | Readonly<{
      kind: "conflict";
      code:
        | "file_parent_set_missing"
        | "file_parent_set_incomplete"
        | "file_parent_count_conflict"
        | "file_version_fence_conflict"
        | "file_parent_link_conflict";
    }>;

export type SealInboxV2FileParentAttachmentsResult = Readonly<{
  linkIds: readonly string[];
}>;

type FileParentPreparationLockRow = Readonly<{
  parent_set_revision: unknown;
  completeness: unknown;
  completeness_revision: unknown;
  live_parent_count: unknown;
  actual_live_parent_count: unknown;
  data_class_id: unknown;
  database_now: unknown;
}>;

type PreparedAttachment = Readonly<{
  input: AttachInboxV2FileParentInput;
  linkId: string;
  parentIdentityDigestSha256: string;
  databaseNow: string;
}>;

type PreparedAttachmentGroup = Readonly<{
  tenantId: string;
  fileId: string;
  expectedParentSetRevision: string;
  expectedLiveParentCount: number;
  databaseNow: string;
  attachments: readonly PreparedAttachment[];
}>;

type PreparedCapabilityState = {
  readonly sealExecutor: RawSqlExecutor;
  readonly atomicMaterializationToken: object | null;
  readonly groups: readonly PreparedAttachmentGroup[];
  consumed: boolean;
};

const preparedFileParentAttachments = new WeakMap<
  InboxV2PreparedFileParentAttachmentsCapability,
  PreparedCapabilityState
>();

/**
 * Pre-stream-head phase. Every blocking read and exact file/object/parent-set
 * lock is acquired in deterministic File/block order. The returned opaque
 * capability is bound to one seal executor and atomic token.
 */
export async function prepareInboxV2FileParentAttachmentsInTransaction(
  executor: RawSqlExecutor,
  sealExecutor: RawSqlExecutor,
  atomicMaterializationToken: object | null,
  rawInput: PrepareInboxV2FileParentAttachmentsInput
): Promise<PrepareInboxV2FileParentAttachmentsResult> {
  const input = normalizePreparationInput(rawInput);
  const byFile = new Map<string, InboxV2ReadyFileParentAttachment[]>();
  for (const attachment of input.attachments) {
    const group = byFile.get(attachment.fileId) ?? [];
    group.push(attachment);
    byFile.set(attachment.fileId, group);
  }

  const groups: PreparedAttachmentGroup[] = [];
  for (const fileId of [...byFile.keys()].sort(compareText)) {
    const attachments = (byFile.get(fileId) ?? []).sort((left, right) =>
      compareText(parentOrderKey(left), parentOrderKey(right))
    );
    const first = attachments[0];
    if (first === undefined) continue;
    if (
      attachments.some(
        (attachment) =>
          attachment.expectedFileRevision !== first.expectedFileRevision ||
          attachment.fileVersionId !== first.fileVersionId ||
          attachment.objectVersionId !== first.objectVersionId
      )
    ) {
      return { kind: "conflict", code: "file_version_fence_conflict" };
    }

    const lock = await executor.execute<FileParentPreparationLockRow>(
      buildPrepareInboxV2FileParentAttachmentLockSql({
        tenantId: input.tenantId,
        fileId,
        expectedFileRevision: first.expectedFileRevision,
        fileVersionId: first.fileVersionId,
        objectVersionId: first.objectVersionId
      })
    );
    if (lock.rows.length > 1) {
      throw new InboxV2FileParentMaterializationError(
        "inbox_v2.file_parent_prepare_cardinality",
        "File-parent preparation returned more than one locked head."
      );
    }
    const row = lock.rows[0];
    if (row === undefined) {
      return { kind: "conflict", code: "file_version_fence_conflict" };
    }
    if (row.completeness !== "complete") {
      return { kind: "conflict", code: "file_parent_set_incomplete" };
    }
    const parentSetRevision = positiveCounter(
      row.parent_set_revision,
      "file parent-set revision"
    );
    if (
      positiveCounter(
        row.completeness_revision,
        "file parent-set completeness revision"
      ) !== parentSetRevision
    ) {
      return { kind: "conflict", code: "file_parent_set_incomplete" };
    }
    const liveParentCount = nonNegativeInteger(
      row.live_parent_count,
      "file live-parent count"
    );
    if (
      nonNegativeInteger(
        row.actual_live_parent_count,
        "actual file live-parent count"
      ) !== liveParentCount
    ) {
      return { kind: "conflict", code: "file_parent_count_conflict" };
    }
    const dataClassId = requiredString(row.data_class_id, "file data class");
    const databaseNow = timestamp(row.database_now, "database clock");
    const preparedAttachments: PreparedAttachment[] = [];
    for (const attachment of attachments) {
      const attachInput: AttachInboxV2FileParentInput = {
        tenantId: input.tenantId,
        fileId,
        fileVersionId: attachment.fileVersionId,
        objectVersionId: attachment.objectVersionId,
        expectedParentSetRevision: parentSetRevision,
        parent: attachment.parent,
        dataClassId,
        processingPurposeId: attachment.processingPurposeId,
        retentionAnchorAt: attachment.retentionAnchorAt
      };
      const parentIdentityDigestSha256 =
        calculateInboxV2FileParentIdentityDigest(attachInput);
      const linkId = deriveFileParentLinkId(
        input.tenantId,
        fileId,
        parentIdentityDigestSha256
      );
      const existing = await executor.execute<{ id: unknown }>(
        buildFindInboxV2PreparedFileParentLinkSql({
          tenantId: input.tenantId,
          fileId,
          parentIdentityDigestSha256
        })
      );
      if (existing.rows.length > 0) {
        return { kind: "conflict", code: "file_parent_link_conflict" };
      }
      preparedAttachments.push({
        input: attachInput,
        linkId,
        parentIdentityDigestSha256,
        databaseNow
      });
    }
    groups.push({
      tenantId: input.tenantId,
      fileId,
      expectedParentSetRevision: parentSetRevision,
      expectedLiveParentCount: liveParentCount,
      databaseNow,
      attachments: Object.freeze(preparedAttachments)
    });
  }

  const capability = Object.freeze({
    [preparedFileParentAttachmentBrand]: true as const
  });
  preparedFileParentAttachments.set(capability, {
    sealExecutor,
    atomicMaterializationToken,
    groups: Object.freeze(groups),
    consumed: false
  });
  return { kind: "ready", capability };
}

/**
 * Post-stream-head phase. It consumes only the prepared values and issues
 * append inserts plus one exact parent-set CAS per File; no SELECT is allowed.
 */
export async function sealInboxV2PreparedFileParentAttachmentsInTransaction(
  executor: RawSqlExecutor,
  atomicMaterializationToken: object | null,
  capability: InboxV2PreparedFileParentAttachmentsCapability
): Promise<SealInboxV2FileParentAttachmentsResult> {
  const prepared = preparedFileParentAttachments.get(capability);
  if (prepared === undefined) {
    throw new InboxV2FileParentMaterializationError(
      "inbox_v2.file_parent_capability_unknown",
      "File-parent capability was not issued by this repository."
    );
  }
  if (prepared.sealExecutor !== executor) {
    throw new InboxV2FileParentMaterializationError(
      "inbox_v2.file_parent_capability_executor_mismatch",
      "File-parent capability belongs to a different seal executor."
    );
  }
  if (prepared.atomicMaterializationToken !== atomicMaterializationToken) {
    throw new InboxV2FileParentMaterializationError(
      "inbox_v2.file_parent_capability_token_mismatch",
      "File-parent capability belongs to a different atomic materialization."
    );
  }
  if (prepared.consumed) {
    throw new InboxV2FileParentMaterializationError(
      "inbox_v2.file_parent_capability_consumed",
      "File-parent capability was already consumed."
    );
  }
  prepared.consumed = true;

  const linkIds: string[] = [];
  for (const group of prepared.groups) {
    for (const attachment of group.attachments) {
      await expectOneRow(
        executor,
        buildInsertInboxV2PreparedFileParentLinkSql(attachment),
        "prepared File parent-link insert"
      );
      await expectOneRow(
        executor,
        buildInsertInboxV2PreparedFileParentLinkHeadSql(attachment),
        "prepared File parent-link head insert"
      );
      linkIds.push(attachment.linkId);
    }
    if (group.attachments.length > 0) {
      await expectOneRow(
        executor,
        buildAdvanceInboxV2PreparedFileParentSetSql(group),
        "prepared File parent-set CAS"
      );
    }
  }
  return { linkIds: Object.freeze(linkIds) };
}

export function buildPrepareInboxV2FileParentAttachmentLockSql(input: {
  tenantId: string;
  fileId: string;
  expectedFileRevision: string;
  fileVersionId: string;
  objectVersionId: string;
}): SQL {
  return sql`
    select parent_head.revision as parent_set_revision,
           parent_head.completeness,
           parent_head.completeness_revision,
           parent_head.live_parent_count,
           (
             select count(*)::integer
               from inbox_v2_file_parent_link_heads live_head
              where live_head.tenant_id = parent_head.tenant_id
                and live_head.file_id = parent_head.file_id
                and live_head.state = 'live'
           ) as actual_live_parent_count,
           file_row.data_class_id,
           clock.database_now
      from inbox_v2_file_parent_set_heads parent_head
      join inbox_v2_file_objects file_row
        on file_row.tenant_id = parent_head.tenant_id
       and file_row.id = parent_head.file_id
       and file_row.state = 'ready'
       and file_row.revision = ${input.expectedFileRevision}::bigint
       and file_row.current_file_version_id = ${input.fileVersionId}
       and file_row.current_object_version_id = ${input.objectVersionId}
      join inbox_v2_file_versions version_row
        on version_row.tenant_id = file_row.tenant_id
       and version_row.id = file_row.current_file_version_id
       and version_row.file_id = file_row.id
       and version_row.object_version_id = file_row.current_object_version_id
      join inbox_v2_file_object_versions object_version_row
        on object_version_row.tenant_id = version_row.tenant_id
       and object_version_row.id = version_row.object_version_id
      join inbox_v2_file_object_version_heads object_head_row
        on object_head_row.tenant_id = object_version_row.tenant_id
       and object_head_row.object_version_id = object_version_row.id
       and object_head_row.state = 'ready'
      cross join (select clock_timestamp() as database_now) clock
     where parent_head.tenant_id = ${input.tenantId}
       and parent_head.file_id = ${input.fileId}
     for update of parent_head
     for share of file_row, version_row, object_version_row, object_head_row
  `;
}

export function buildFindInboxV2PreparedFileParentLinkSql(input: {
  tenantId: string;
  fileId: string;
  parentIdentityDigestSha256: string;
}): SQL {
  return sql`
    select link_row.id
      from inbox_v2_file_parent_links link_row
      join inbox_v2_file_parent_link_heads head_row
        on head_row.tenant_id = link_row.tenant_id
       and head_row.link_id = link_row.id
       and head_row.file_id = link_row.file_id
     where link_row.tenant_id = ${input.tenantId}
       and link_row.file_id = ${input.fileId}
       and link_row.parent_identity_digest_sha256 =
         ${input.parentIdentityDigestSha256}
     limit 1
     for share of link_row, head_row
  `;
}

export function buildInsertInboxV2PreparedFileParentLinkSql(
  prepared: PreparedAttachment
): SQL {
  const input = prepared.input;
  const parent = input.parent;
  return sql`
    insert into inbox_v2_file_parent_links (
      tenant_id, id, file_id, file_version_id, object_version_id,
      parent_identity_digest_sha256, parent_kind, parent_purpose,
      visibility_boundary, parent_conversation_visibility,
      parent_entity_id, parent_entity_revision, conversation_id,
      timeline_item_id, content_id, content_revision, block_key,
      data_class_id, processing_purpose_id, retention_anchor_at,
      created_at, revision
    ) values (
      ${input.tenantId}, ${prepared.linkId}, ${input.fileId},
      ${input.fileVersionId}, ${input.objectVersionId},
      ${prepared.parentIdentityDigestSha256}, ${parent.kind},
      ${parent.purpose}, ${parent.visibilityBoundary},
      ${parent.parentConversationVisibility}, ${parent.entityId},
      ${parent.entityRevision}::bigint, ${parent.conversationId},
      ${parent.timelineItemId}, ${parent.contentId},
      ${parent.contentRevision}::bigint, ${parent.blockKey},
      ${input.dataClassId}, ${input.processingPurposeId},
      ${input.retentionAnchorAt}::timestamptz,
      ${prepared.databaseNow}::timestamptz, 1
    )
    returning id
  `;
}

export function buildInsertInboxV2PreparedFileParentLinkHeadSql(
  prepared: PreparedAttachment
): SQL {
  return sql`
    insert into inbox_v2_file_parent_link_heads (
      tenant_id, link_id, file_id, state, detached_by_event_id,
      revision, updated_at
    ) values (
      ${prepared.input.tenantId}, ${prepared.linkId},
      ${prepared.input.fileId}, 'live', null, 1,
      ${prepared.databaseNow}::timestamptz
    )
    returning link_id as id
  `;
}

export function buildAdvanceInboxV2PreparedFileParentSetSql(
  group: PreparedAttachmentGroup
): SQL {
  const nextRevision = incrementCounter(group.expectedParentSetRevision);
  const nextCount = group.expectedLiveParentCount + group.attachments.length;
  return sql`
    update inbox_v2_file_parent_set_heads
       set revision = ${nextRevision}::bigint,
           completeness_revision = ${nextRevision}::bigint,
           live_parent_count = ${nextCount}::integer,
           updated_at = ${group.databaseNow}::timestamptz
     where tenant_id = ${group.tenantId}
       and file_id = ${group.fileId}
       and revision = ${group.expectedParentSetRevision}::bigint
       and completeness = 'complete'
       and completeness_revision = revision
       and live_parent_count = ${group.expectedLiveParentCount}::integer
    returning file_id as id
  `;
}

function normalizePreparationInput(
  input: PrepareInboxV2FileParentAttachmentsInput
): PrepareInboxV2FileParentAttachmentsInput {
  requiredString(input.tenantId, "tenant id");
  if (!Array.isArray(input.attachments) || input.attachments.length > 64) {
    throw new TypeError("File-parent preparation accepts at most 64 pins.");
  }
  const identities = new Set<string>();
  for (const attachment of input.attachments) {
    for (const [label, value] of [
      ["file id", attachment.fileId],
      ["file revision", attachment.expectedFileRevision],
      ["file-version id", attachment.fileVersionId],
      ["object-version id", attachment.objectVersionId],
      ["processing purpose", attachment.processingPurposeId],
      ["parent entity id", attachment.parent.entityId],
      ["parent block key", attachment.parent.blockKey ?? "-"]
    ] as const) {
      requiredString(value, label);
    }
    positiveCounter(attachment.expectedFileRevision, "file revision");
    timestamp(attachment.retentionAnchorAt, "retention anchor");
    const identity = parentOrderKey(attachment);
    if (identities.has(identity)) {
      throw new TypeError("File-parent preparation contains a duplicate pin.");
    }
    identities.add(identity);
  }
  return input;
}

function parentOrderKey(input: InboxV2ReadyFileParentAttachment): string {
  return [
    input.fileId,
    input.parent.kind,
    input.parent.purpose,
    input.parent.entityId,
    input.parent.contentId ?? "",
    input.parent.blockKey ?? ""
  ].join("\u0000");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deriveFileParentLinkId(
  tenantId: string,
  fileId: string,
  parentIdentityDigestSha256: string
): string {
  const hash = createHash("sha256");
  hash.update("core:inbox-v2.file_parent_link-id@v1", "utf8");
  for (const part of [tenantId, fileId, parentIdentityDigestSha256]) {
    hash.update("\u0000", "utf8");
    hash.update(part, "utf8");
  }
  return `file_parent_link:${hash.digest("hex")}`;
}

async function expectOneRow(
  executor: RawSqlExecutor,
  statement: SQL,
  operation: string
): Promise<void> {
  const result = await executor.execute<{ id: unknown }>(statement);
  if (result.rows.length !== 1) {
    throw new InboxV2FileParentMaterializationError(
      "inbox_v2.file_parent_seal_cas_conflict",
      `${operation} expected one row and received ${result.rows.length}.`
    );
  }
}

function incrementCounter(value: string): string {
  return (BigInt(value) + 1n).toString();
}

function positiveCounter(value: unknown, label: string): string {
  const normalized =
    typeof value === "bigint" ? value.toString() : String(value);
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new InboxV2FileParentMaterializationError(
      "inbox_v2.file_parent_row_invalid",
      `Expected ${label} to be a positive counter.`
    );
  }
  return normalized;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new InboxV2FileParentMaterializationError(
      "inbox_v2.file_parent_row_invalid",
      `Expected ${label} to be a non-negative integer.`
    );
  }
  return normalized;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Expected ${label} to be a non-empty string.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const normalized = value instanceof Date ? value.toISOString() : value;
  if (
    typeof normalized !== "string" ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    throw new InboxV2FileParentMaterializationError(
      "inbox_v2.file_parent_row_invalid",
      `Expected ${label} to be a timestamp.`
    );
  }
  return new Date(normalized).toISOString();
}

export class InboxV2FileParentMaterializationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "InboxV2FileParentMaterializationError";
  }
}
