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
  type InboxV2FileParentSourceAuthorityFence,
  type InboxV2ReadyFileParentAttachment
} from "./sql-inbox-v2-file-parent-materialization";

const dialect = new PgDialect();
const tenantId = "tenant:msg003-parent-unit";
const now = "2026-07-19T09:00:00.000Z";

class QueueExecutor implements RawSqlExecutor {
  readonly statements: string[] = [];
  readonly parameters: unknown[][] = [];

  constructor(
    private readonly rowQueue: readonly (readonly Record<string, unknown>[])[]
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const rendered = dialect.sqlToQuery(query);
    this.statements.push(
      rendered.sql.replaceAll('"', "").replace(/\s+/gu, " ").trim()
    );
    this.parameters.push([...rendered.params]);
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

function sourceAuthorityFence(
  target: InboxV2ReadyFileParentAttachment,
  sourceParent: InboxV2FileParentSourceAuthorityFence["sourceParent"] = {
    kind: "message",
    messageId: "message:msg003-source-message",
    expectedMessageRevision: "2",
    conversationId: "conversation:msg003-source-conversation",
    visibilityBoundary: "external_work"
  }
): InboxV2FileParentSourceAuthorityFence {
  if (
    target.parent.kind === "upload_staging" ||
    target.parent.blockKey === null
  ) {
    throw new Error("Source-authority fixture requires a timeline target.");
  }
  return {
    fileId: target.fileId,
    expectedFileRevision: target.expectedFileRevision,
    fileVersionId: target.fileVersionId,
    objectVersionId: target.objectVersionId,
    targetParentKind: target.parent.kind,
    targetParentEntityId: target.parent.entityId,
    targetParentEntityRevision: target.parent.entityRevision,
    targetBlockKey: target.parent.blockKey,
    purpose: target.parent.purpose,
    sourceParent
  };
}

function staffNoteTarget(): InboxV2ReadyFileParentAttachment {
  return attachment({
    parent: {
      kind: "staff_note",
      purpose: "attachment",
      visibilityBoundary: "staff_note",
      parentConversationVisibility: "internal",
      entityId: "staff_note:msg003-target-note",
      entityRevision: "4",
      conversationId: "conversation:msg003-parent-conversation",
      timelineItemId: "timeline_item:msg003-parent-item",
      contentId: "timeline_content:msg003-parent-content",
      contentRevision: "4",
      blockKey: "attachment-1"
    }
  });
}

function extensionTarget(): InboxV2ReadyFileParentAttachment {
  const target = attachment();
  return attachment({
    parent: {
      ...target.parent,
      purpose: "extension_payload",
      blockKey: "extension-1"
    }
  });
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
    expect(sealExecutor.parameters[0]).toContain("attachment");
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

  it("binds the other validated parent purpose in the exact purpose position", async () => {
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
      { tenantId, attachments: [extensionTarget()] }
    );
    if (prepared.kind !== "ready") throw new Error("fixture did not prepare");

    await sealInboxV2PreparedFileParentAttachmentsInTransaction(
      sealExecutor,
      token,
      prepared.capability
    );

    expect(sealExecutor.parameters[0]).toContain("extension_payload");
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

  it("locks exact Message, StaffNote and upload-staging source authority before issuing a capability", async () => {
    const messageTarget = attachment();
    const noteTarget = staffNoteTarget();
    const uploadTarget = attachment();
    const uploadedExtensionTarget = extensionTarget();
    const scenarios: readonly Readonly<{
      label: string;
      target: InboxV2ReadyFileParentAttachment;
      fence: InboxV2FileParentSourceAuthorityFence;
      authorityRows: readonly Record<string, unknown>[];
      expectedSql: readonly string[];
      expectedParameters: readonly string[];
      forbidsSourcePurpose?: boolean;
    }>[] = [
      {
        label: "message",
        target: messageTarget,
        fence: sourceAuthorityFence(messageTarget),
        authorityRows: [{ link_id: "file_parent_link:source-message" }],
        expectedSql: [
          "parent_kind = 'message'",
          "join inbox_v2_messages message_row",
          "message_row.lifecycle = 'active'",
          "message_row.content_state = 'available'",
          "message_row.timeline_item_id = link_row.timeline_item_id",
          "message_row.content_id = link_row.content_id",
          "join inbox_v2_timeline_items item_row",
          "item_row.revision = message_row.revision",
          "head_row.state = 'live'",
          "for share of link_row, head_row, message_row, item_row"
        ],
        expectedParameters: [
          "message:msg003-source-message",
          "conversation:msg003-source-conversation"
        ],
        forbidsSourcePurpose: true
      },
      {
        label: "staff_note",
        target: noteTarget,
        fence: sourceAuthorityFence(noteTarget, {
          kind: "staff_note",
          staffNoteId: "staff_note:msg003-source-note",
          expectedStaffNoteRevision: "6",
          conversationId: "conversation:msg003-source-conversation",
          visibilityBoundary: "staff_note",
          parentConversationVisibility: "internal"
        }),
        authorityRows: [{ link_id: "file_parent_link:source-note" }],
        expectedSql: [
          "parent_kind = 'staff_note'",
          "join inbox_v2_staff_notes note_row",
          "note_row.content_state = 'available'",
          "note_row.timeline_item_id = link_row.timeline_item_id",
          "note_row.content_id = link_row.content_id",
          "join inbox_v2_timeline_items item_row",
          "item_row.revision = note_row.revision",
          "item_row.visibility = 'staff_only'",
          "parent_conversation_visibility =",
          "head_row.state = 'live'",
          "for share of link_row, head_row, note_row, item_row"
        ],
        expectedParameters: [
          "staff_note:msg003-source-note",
          "conversation:msg003-source-conversation"
        ],
        forbidsSourcePurpose: true
      },
      {
        label: "employee upload staging",
        target: uploadTarget,
        fence: sourceAuthorityFence(uploadTarget, {
          kind: "upload_staging",
          attachmentId: "message_attachment:msg003-source-upload",
          uploadRevision: "2",
          actor: {
            kind: "employee",
            employeeId: "employee:msg003-uploader",
            authorizationEpoch: "authorization:msg003-upload-epoch"
          }
        }),
        authorityRows: [
          {
            link_id: "file_parent_link:source-upload",
            job_id: "attachment_materialization_job:source-upload"
          }
        ],
        expectedSql: [
          "parent_kind = 'upload_staging'",
          "parent_purpose = 'attachment'",
          "job_row.state = 'ready'",
          "job_row.source_locator_kind = 'upload_staging'",
          "job_row.authorization_actor_kind = 'employee'",
          "for share of link_row, head_row, job_row"
        ],
        expectedParameters: [
          "message_attachment:msg003-source-upload",
          "employee:msg003-uploader",
          "authorization:msg003-upload-epoch"
        ]
      },
      {
        label: "trusted-service upload staging for an extension",
        target: uploadedExtensionTarget,
        fence: sourceAuthorityFence(uploadedExtensionTarget, {
          kind: "upload_staging",
          attachmentId: null,
          uploadRevision: "2",
          actor: {
            kind: "trusted_service",
            trustedServiceId: "core:attachment-worker"
          }
        }),
        authorityRows: [
          {
            link_id: "file_parent_link:extension-source-a",
            job_id: "attachment_materialization_job:extension-source-a"
          },
          {
            link_id: "file_parent_link:extension-source-b",
            job_id: "attachment_materialization_job:extension-source-b"
          }
        ],
        expectedSql: [
          "parent_kind = 'upload_staging'",
          "parent_purpose = 'attachment'",
          "job_row.source_locator_kind = 'upload_staging'",
          "job_row.authorization_actor_kind = 'trusted_service'",
          "order by link_row.id, job_row.id",
          "for share of link_row, head_row, job_row"
        ],
        expectedParameters: ["core:attachment-worker"]
      }
    ];

    for (const scenario of scenarios) {
      const prepareExecutor = new QueueExecutor([
        [lockRow()],
        scenario.authorityRows,
        []
      ]);
      const sealExecutor = new QueueExecutor([]);
      await expect(
        prepareInboxV2FileParentAttachmentsInTransaction(
          prepareExecutor,
          sealExecutor,
          null,
          {
            tenantId,
            attachments: [scenario.target],
            sourceAuthorityFences: [scenario.fence]
          }
        ),
        scenario.label
      ).resolves.toMatchObject({ kind: "ready" });
      expect(prepareExecutor.statements).toHaveLength(3);
      const authoritySql = prepareExecutor.statements[1] ?? "";
      for (const expected of scenario.expectedSql) {
        expect(authoritySql, scenario.label).toContain(expected);
      }
      if (scenario.forbidsSourcePurpose === true) {
        expect(authoritySql, scenario.label).not.toContain("parent_purpose");
      }
      for (const expected of scenario.expectedParameters) {
        expect(prepareExecutor.parameters[1], scenario.label).toContain(
          expected
        );
      }
      expect(prepareExecutor.parameters[1], scenario.label).toEqual(
        expect.arrayContaining([
          scenario.target.fileId,
          scenario.target.fileVersionId,
          scenario.target.objectVersionId
        ])
      );
      expect(sealExecutor.statements, scenario.label).toEqual([]);
    }
  });

  it("canonicalizes source checks by destination pin instead of caller order", async () => {
    const base = attachment();
    const first = attachment({
      parent: { ...base.parent, blockKey: "attachment-a" }
    });
    const second = attachment({
      parent: { ...base.parent, blockKey: "attachment-z" }
    });
    const firstFence = sourceAuthorityFence(first, {
      kind: "message",
      messageId: "message:msg003-source-a",
      expectedMessageRevision: "2",
      conversationId: "conversation:msg003-source-conversation",
      visibilityBoundary: "external_work"
    });
    const secondFence = sourceAuthorityFence(second, {
      kind: "message",
      messageId: "message:msg003-source-z",
      expectedMessageRevision: "2",
      conversationId: "conversation:msg003-source-conversation",
      visibilityBoundary: "external_work"
    });
    const prepareExecutor = new QueueExecutor([
      [lockRow()],
      [{ link_id: "file_parent_link:source-a" }],
      [],
      [{ link_id: "file_parent_link:source-z" }],
      []
    ]);

    await expect(
      prepareInboxV2FileParentAttachmentsInTransaction(
        prepareExecutor,
        new QueueExecutor([]),
        null,
        {
          tenantId,
          attachments: [second, first],
          sourceAuthorityFences: [secondFence, firstFence]
        }
      )
    ).resolves.toMatchObject({ kind: "ready" });
    expect(prepareExecutor.parameters[1]).toContain("message:msg003-source-a");
    expect(prepareExecutor.parameters[3]).toContain("message:msg003-source-z");
  });

  it("returns a source-authority conflict for missing, detached, stale or wrong reservation evidence without writes", async () => {
    const target = attachment();
    const uploadSource = (
      actor: Extract<
        InboxV2FileParentSourceAuthorityFence["sourceParent"],
        { kind: "upload_staging" }
      >["actor"]
    ): InboxV2FileParentSourceAuthorityFence =>
      sourceAuthorityFence(target, {
        kind: "upload_staging",
        attachmentId: "message_attachment:msg003-source-upload",
        uploadRevision: "2",
        actor
      });
    const scenarios: readonly Readonly<{
      label: string;
      fence: InboxV2FileParentSourceAuthorityFence;
    }>[] = [
      {
        label: "missing relation",
        fence: sourceAuthorityFence(target, {
          kind: "message",
          messageId: "message:msg003-missing-source",
          expectedMessageRevision: "2",
          conversationId: "conversation:msg003-source-conversation",
          visibilityBoundary: "external_work"
        })
      },
      {
        label: "detached relation",
        fence: sourceAuthorityFence(target)
      },
      {
        label: "stale relation revision",
        fence: sourceAuthorityFence(target, {
          kind: "message",
          messageId: "message:msg003-source-message",
          expectedMessageRevision: "99",
          conversationId: "conversation:msg003-source-conversation",
          visibilityBoundary: "external_work"
        })
      },
      {
        label: "wrong uploader",
        fence: uploadSource({
          kind: "employee",
          employeeId: "employee:msg003-wrong-uploader",
          authorizationEpoch: "authorization:msg003-upload-epoch"
        })
      },
      {
        label: "wrong uploader epoch",
        fence: uploadSource({
          kind: "employee",
          employeeId: "employee:msg003-uploader",
          authorizationEpoch: "authorization:msg003-wrong-epoch"
        })
      },
      {
        label: "missing ready upload job",
        fence: uploadSource({
          kind: "trusted_service",
          trustedServiceId: "core:attachment-worker"
        })
      }
    ];

    for (const scenario of scenarios) {
      const prepareExecutor = new QueueExecutor([[lockRow()], []]);
      const sealExecutor = new QueueExecutor([]);
      await expect(
        prepareInboxV2FileParentAttachmentsInTransaction(
          prepareExecutor,
          sealExecutor,
          null,
          {
            tenantId,
            attachments: [target],
            sourceAuthorityFences: [scenario.fence]
          }
        ),
        scenario.label
      ).resolves.toEqual({
        kind: "conflict",
        code: "file_parent_source_authority_conflict"
      });
      expect(prepareExecutor.statements, scenario.label).toHaveLength(2);
      expect(prepareExecutor.statements[0], scenario.label).toContain(
        "for update of parent_head"
      );
      expect(prepareExecutor.statements[1], scenario.label).toContain(
        "for share of link_row, head_row"
      );
      expect(
        prepareExecutor.statements.some((statement) =>
          /^(?:insert|update|delete)\b/iu.test(statement)
        ),
        scenario.label
      ).toBe(false);
      expect(sealExecutor.statements, scenario.label).toEqual([]);
    }
  });

  it("rejects cross-file/version, duplicate, extra and forged source fences before any query", async () => {
    const target = attachment();
    const valid = sourceAuthorityFence(target);
    const invalidPlans: readonly Readonly<{
      label: string;
      attachments: readonly InboxV2ReadyFileParentAttachment[];
      fences: readonly InboxV2FileParentSourceAuthorityFence[];
    }>[] = [
      {
        label: "cross-file",
        attachments: [target],
        fences: [{ ...valid, fileId: "file:msg003-other-file" }]
      },
      {
        label: "cross-file-version",
        attachments: [target],
        fences: [
          { ...valid, fileVersionId: "file_version:msg003-other-version" }
        ]
      },
      {
        label: "cross-object-version",
        attachments: [target],
        fences: [
          {
            ...valid,
            objectVersionId: "file_object_version:msg003-other-object"
          }
        ]
      },
      {
        label: "cross-file-revision",
        attachments: [target],
        fences: [{ ...valid, expectedFileRevision: "4" }]
      },
      {
        label: "exact duplicate destination key",
        attachments: [target],
        fences: [valid, valid]
      },
      {
        label: "duplicate destination key with another source",
        attachments: [target],
        fences: [
          valid,
          sourceAuthorityFence(target, {
            kind: "message",
            messageId: "message:msg003-other-source",
            expectedMessageRevision: "2",
            conversationId: "conversation:msg003-source-conversation",
            visibilityBoundary: "external_work"
          })
        ]
      },
      {
        label: "explicit empty coverage",
        attachments: [target],
        fences: []
      },
      {
        label: "fence without destination",
        attachments: [],
        fences: [valid]
      },
      {
        label: "forged extra field",
        attachments: [target],
        fences: [
          {
            ...valid,
            forged: true
          } as unknown as InboxV2FileParentSourceAuthorityFence
        ]
      }
    ];

    for (const plan of invalidPlans) {
      const prepareExecutor = new QueueExecutor([]);
      const sealExecutor = new QueueExecutor([]);
      await expect(
        prepareInboxV2FileParentAttachmentsInTransaction(
          prepareExecutor,
          sealExecutor,
          null,
          {
            tenantId,
            attachments: plan.attachments,
            sourceAuthorityFences: plan.fences
          }
        ),
        plan.label
      ).rejects.toBeInstanceOf(TypeError);
      expect(prepareExecutor.statements, plan.label).toEqual([]);
      expect(sealExecutor.statements, plan.label).toEqual([]);
    }
  });

  it("rejects forged upload-staging attachment shapes and accepts explicit empty coverage for no pins", async () => {
    const attachmentTarget = attachment();
    const extension = extensionTarget();
    const invalid = [
      sourceAuthorityFence(attachmentTarget, {
        kind: "upload_staging",
        attachmentId: null,
        uploadRevision: "2",
        actor: {
          kind: "trusted_service",
          trustedServiceId: "core:attachment-worker"
        }
      }),
      sourceAuthorityFence(extension, {
        kind: "upload_staging",
        attachmentId: "message_attachment:msg003-forged-extension-source",
        uploadRevision: "2",
        actor: {
          kind: "trusted_service",
          trustedServiceId: "core:attachment-worker"
        }
      })
    ] as const;

    for (const [index, fence] of invalid.entries()) {
      const target = index === 0 ? attachmentTarget : extension;
      const prepareExecutor = new QueueExecutor([]);
      await expect(
        prepareInboxV2FileParentAttachmentsInTransaction(
          prepareExecutor,
          new QueueExecutor([]),
          null,
          {
            tenantId,
            attachments: [target],
            sourceAuthorityFences: [fence]
          }
        )
      ).rejects.toBeInstanceOf(TypeError);
      expect(prepareExecutor.statements).toEqual([]);
    }

    const empty = await prepareInboxV2FileParentAttachmentsInTransaction(
      new QueueExecutor([]),
      new QueueExecutor([]),
      null,
      { tenantId, attachments: [], sourceAuthorityFences: [] }
    );
    expect(empty.kind).toBe("ready");
  });
});
