import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  InboxV2FileParentMaterializationError,
  prepareInboxV2FileParentAttachmentsInTransaction,
  sealInboxV2PreparedFileParentAttachmentsInTransaction,
  type InboxV2ReadyFileParentAttachment
} from "./sql-inbox-v2-file-parent-materialization";

const dialect = new PgDialect();
const tenantId = "tenant:msg003-parent-unit";
const now = "2026-07-19T09:00:00.000Z";

class QueueExecutor implements RawSqlExecutor {
  readonly statements: string[] = [];

  constructor(
    private readonly rowQueue: readonly (readonly Record<string, unknown>[])[]
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.statements.push(
      dialect
        .sqlToQuery(query)
        .sql.replaceAll('"', "")
        .replace(/\s+/gu, " ")
        .trim()
    );
    const rows = this.rowQueue[this.statements.length - 1] ?? [];
    return { rows: rows as readonly Row[] };
  }
}

function attachment(
  overrides: Partial<InboxV2ReadyFileParentAttachment> = {}
): InboxV2ReadyFileParentAttachment {
  return {
    fileId: "file:msg003-parent-file",
    expectedFileRevision: "3",
    fileVersionId: "file_version:msg003-parent-version",
    objectVersionId: "file_object_version:msg003-parent-object-version",
    parent: {
      kind: "message",
      purpose: "attachment",
      visibilityBoundary: "external_work",
      parentConversationVisibility: null,
      entityId: "message:msg003-parent-message",
      entityRevision: "1",
      conversationId: "conversation:msg003-parent-conversation",
      timelineItemId: "timeline_item:msg003-parent-item",
      contentId: "timeline_content:msg003-parent-content",
      contentRevision: "1",
      blockKey: "attachment-1"
    },
    processingPurposeId: "core:chat",
    retentionAnchorAt: now,
    ...overrides
  };
}

function lockRow(overrides: Record<string, unknown> = {}) {
  return {
    parent_set_revision: "4",
    completeness: "complete",
    completeness_revision: "4",
    live_parent_count: 1,
    actual_live_parent_count: 1,
    data_class_id: "core:message_attachment",
    database_now: now,
    ...overrides
  };
}

describe("SQL Inbox V2 prepared File-parent materialization", () => {
  it("takes every blocking lock before sealing append-only links and one exact parent-set CAS", async () => {
    const prepareExecutor = new QueueExecutor([[lockRow()], []]);
    const sealExecutor = new QueueExecutor([
      [{ id: "file_parent_link:link-1" }],
      [{ id: "file_parent_link:link-1" }],
      [{ id: "file:msg003-parent-file" }]
    ]);
    const token = Object.freeze({ token: "unit" });

    const prepared = await prepareInboxV2FileParentAttachmentsInTransaction(
      prepareExecutor,
      sealExecutor,
      token,
      { tenantId, attachments: [attachment()] }
    );
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;

    expect(prepareExecutor.statements).toHaveLength(2);
    expect(prepareExecutor.statements[0]).toContain(
      "for update of parent_head"
    );
    expect(prepareExecutor.statements[0]).toContain(
      "for share of file_row, version_row, object_version_row, object_head_row"
    );
    expect(prepareExecutor.statements[1]).toContain(
      "for share of link_row, head_row"
    );

    await expect(
      sealInboxV2PreparedFileParentAttachmentsInTransaction(
        sealExecutor,
        token,
        prepared.capability
      )
    ).resolves.toMatchObject({
      linkIds: [expect.stringMatching(/^file_parent_link:/u)]
    });

    expect(sealExecutor.statements).toHaveLength(3);
    expect(sealExecutor.statements[0]).toMatch(
      /^insert into inbox_v2_file_parent_links/u
    );
    expect(sealExecutor.statements[1]).toMatch(
      /^insert into inbox_v2_file_parent_link_heads/u
    );
    expect(sealExecutor.statements[2]).toMatch(
      /^update inbox_v2_file_parent_set_heads/u
    );
    for (const statement of sealExecutor.statements) {
      expect(statement).not.toMatch(
        /\b(?:select|from|join)\b|\bfor\s+(?:update|share)\b/iu
      );
    }
  });

  it("binds the opaque capability to the seal executor and token and consumes it once", async () => {
    const prepareExecutor = new QueueExecutor([[lockRow()], []]);
    const sealExecutor = new QueueExecutor([
      [{ id: "file_parent_link:link-1" }],
      [{ id: "file_parent_link:link-1" }],
      [{ id: "file:msg003-parent-file" }]
    ]);
    const otherExecutor = new QueueExecutor([]);
    const token = Object.freeze({ token: "unit" });
    const prepared = await prepareInboxV2FileParentAttachmentsInTransaction(
      prepareExecutor,
      sealExecutor,
      token,
      { tenantId, attachments: [attachment()] }
    );
    if (prepared.kind !== "ready") throw new Error("fixture did not prepare");

    await expect(
      sealInboxV2PreparedFileParentAttachmentsInTransaction(
        otherExecutor,
        token,
        prepared.capability
      )
    ).rejects.toMatchObject({
      code: "inbox_v2.file_parent_capability_executor_mismatch"
    });
    await expect(
      sealInboxV2PreparedFileParentAttachmentsInTransaction(
        sealExecutor,
        Object.freeze({ token: "forged" }),
        prepared.capability
      )
    ).rejects.toMatchObject({
      code: "inbox_v2.file_parent_capability_token_mismatch"
    });
    await sealInboxV2PreparedFileParentAttachmentsInTransaction(
      sealExecutor,
      token,
      prepared.capability
    );
    await expect(
      sealInboxV2PreparedFileParentAttachmentsInTransaction(
        sealExecutor,
        token,
        prepared.capability
      )
    ).rejects.toMatchObject({
      code: "inbox_v2.file_parent_capability_consumed"
    });
  });

  it("fails closed on an exact parent-set CAS miss", async () => {
    const prepareExecutor = new QueueExecutor([[lockRow()], []]);
    const sealExecutor = new QueueExecutor([
      [{ id: "file_parent_link:link-1" }],
      [{ id: "file_parent_link:link-1" }],
      []
    ]);
    const prepared = await prepareInboxV2FileParentAttachmentsInTransaction(
      prepareExecutor,
      sealExecutor,
      null,
      { tenantId, attachments: [attachment()] }
    );
    if (prepared.kind !== "ready") throw new Error("fixture did not prepare");

    await expect(
      sealInboxV2PreparedFileParentAttachmentsInTransaction(
        sealExecutor,
        null,
        prepared.capability
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<InboxV2FileParentMaterializationError>>({
        code: "inbox_v2.file_parent_seal_cas_conflict"
      })
    );
  });

  it("rejects a stale exact File pin before issuing any post-head write", async () => {
    const prepareExecutor = new QueueExecutor([[]]);
    const sealExecutor = new QueueExecutor([]);

    await expect(
      prepareInboxV2FileParentAttachmentsInTransaction(
        prepareExecutor,
        sealExecutor,
        null,
        { tenantId, attachments: [attachment()] }
      )
    ).resolves.toEqual({
      kind: "conflict",
      code: "file_version_fence_conflict"
    });
    expect(sealExecutor.statements).toEqual([]);
  });
});
