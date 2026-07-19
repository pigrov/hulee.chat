import {
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
  calculateInboxV2MessageContentDigest,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2MessageSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2TimelineContentSchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineItemSchema
} from "@hulee/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  fixtureContent,
  fixtureMessage,
  fixtureT2,
  fixtureTenantId,
  fixtureTimelineItem
} from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import type { RawSqlQueryResult } from "./sql-outbox-repository";
import type { InboxV2AttachmentMaterializationClaim } from "./sql-inbox-v2-file-object-repository";
import type {
  InboxV2AuthorizationTransactionExecutor,
  InboxV2AuthorizedAtomicMaterializationCoordinator
} from "./sql-inbox-v2-authorization-repository";
import {
  INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_RESULT_CODE,
  buildInboxV2AttachmentMaterializationTerminalAuthorizedMutationForTest,
  calculateInboxV2AttachmentMaterializationTerminalRequestHash,
  createInboxV2AttachmentMaterializationTerminalCommandService,
  createSqlInboxV2AttachmentMaterializationTerminalCommandPreparer,
  planInboxV2AttachmentMaterializationMessageMutation,
  type InboxV2AttachmentMaterializationTerminalCommandPreparer,
  type InboxV2AttachmentMaterializationTerminalIntent,
  type InboxV2AttachmentMaterializationTerminalOutcome
} from "./sql-inbox-v2-attachment-materialization-command-service";
import { computeInboxV2TimelineMessageCommitDigest } from "./sql-inbox-v2-timeline-message-repository";

const dialect = new PgDialect();
const occurredAt = "2026-07-11T09:03:00.000Z";
const notAfter = "2026-07-12T09:03:00.000Z";
const trustedServiceId = "core:attachment-worker";
const conversationId = "conversation:conversation-1";
const messageId = "message:message-1";
const timelineItemId = "timeline_item:item-1";
const contentId = "timeline_content:content-1";
const grantSourceId = `internal-ref:${"a".repeat(32)}`;

function claim(
  overrides: Partial<InboxV2AttachmentMaterializationClaim> = {}
): InboxV2AttachmentMaterializationClaim {
  return {
    tenantId: fixtureTenantId,
    jobId: "attachment_materialization_job:terminal-job-1",
    attachmentId: "message_attachment:terminal-image-1",
    attemptId: "attachment_materialization_attempt:terminal-attempt-1",
    leaseToken: `attachment-lease:${"b".repeat(64)}`,
    leaseGeneration: "1",
    workerId: trustedServiceId,
    claimedAt: fixtureT2,
    leaseExpiresAt: "2026-07-11T09:10:00.000Z",
    expectedJobRevision: "2",
    fileId: "file:terminal-image-1",
    expectedFileRevision: "1",
    dataClassId: "core:message-content",
    processingPurposeId: "core:message-attachment",
    retentionAnchorAt: fixtureT2,
    fileVersionId: "file_version:terminal-image-1-v1",
    objectVersionId: "file_object_version:terminal-image-1-v1",
    storageRootId: "core:tenant-object-storage",
    storageKey: "tenant/file/terminal-image-1-v1",
    contentOrigin: {
      conversationId,
      timelineItemId,
      parentKind: "message",
      parentEntityId: messageId,
      expectedParentRevision: "1",
      timelineContentId: contentId,
      expectedContentRevision: "1",
      contentBlockKey: "image-1",
      expectedAttachmentRevision: "1",
      visibilityBoundary: "external_work"
    },
    sourceLocator: {
      kind: "provider",
      reference: `src_ref_${"c".repeat(43)}`
    },
    reservationNamespaceGeneration: "attachment-namespace-v1",
    sourceOccurrenceId: "source_occurrence:occurrence-1",
    causeEventId: "event:attachment-upload-1",
    causeMutationId: "authorization-mutation:attachment-upload-1",
    causeStreamCommitId: "commit:attachment-upload-1",
    causeStreamPosition: "1",
    correlationId: "correlation:attachment-terminal-1",
    causedAt: fixtureT2,
    reservationAuthority: {
      commandId: "command:attachment-reservation-1",
      commandTypeId: "core:attachment.materialization.reserve",
      clientMutationId: "client-mutation:attachment-reservation-1",
      mutationId: "authorization-mutation:attachment-reservation-1",
      decisionId: "authorization-decision:file-upload-1",
      epoch: "authorization-epoch:attachment-terminal-1",
      actor: { kind: "trusted_service", trustedServiceId },
      authorizedAt: fixtureT2,
      decisionSetDigestSha256: "d".repeat(64),
      resourceFenceSetDigestSha256: "e".repeat(64),
      tenantRbacRevision: "7",
      sharedAccessRevision: "11",
      resourceHeadId: "authorization-resource:conversation-1",
      resourceAccessRevision: "13",
      structuralRelationRevision: "17",
      collaboratorSetRevision: "19",
      auditGrantSourceIds: [grantSourceId],
      auditPolicyVersion: "policy-v1"
    },
    ...overrides
  };
}

function readyOutcome(
  putOutcome: "created" | "already_exists" = "created"
): Extract<InboxV2AttachmentMaterializationTerminalOutcome, { kind: "ready" }> {
  return {
    kind: "ready",
    storage: {
      storageKey: "tenant/file/terminal-image-1-v1",
      storageVersionId: "provider-version-1",
      checksumSha256: "f".repeat(64),
      sizeBytes: 123,
      mediaType: "image/png",
      putOutcome
    }
  };
}

function intent(
  inputClaim = claim(),
  outcome: InboxV2AttachmentMaterializationTerminalOutcome = readyOutcome()
): InboxV2AttachmentMaterializationTerminalIntent {
  const requestHash =
    calculateInboxV2AttachmentMaterializationTerminalRequestHash(
      inputClaim,
      outcome
    );
  const suffix = requestHash.slice("sha256:".length);
  return {
    claim: inputClaim,
    outcome,
    requestHash,
    commandId: `attachment-materialization-command:${suffix}`,
    requestId: `attachment-materialization-request:${suffix}`,
    clientMutationId: `attachment-materialization:${suffix}`
  };
}

function currentWithTwoPendingAttachments() {
  const blocks = [
    {
      blockKey: "image-1",
      kind: "image" as const,
      attachment: {
        state: "pending" as const,
        attachment: {
          tenantId: fixtureTenantId,
          kind: "message_attachment" as const,
          id: "message_attachment:terminal-image-1"
        }
      },
      displayName: "photo.png"
    },
    {
      blockKey: "file-2",
      kind: "file" as const,
      attachment: {
        state: "pending" as const,
        attachment: {
          tenantId: fixtureTenantId,
          kind: "message_attachment" as const,
          id: "message_attachment:terminal-file-2"
        }
      },
      displayName: "document.pdf"
    }
  ];
  const content = inboxV2TimelineContentSchema.parse(
    fixtureContent({
      state: {
        kind: "available",
        blocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
      }
    })
  );
  return {
    message: inboxV2MessageSchema.parse({
      ...fixtureMessage("source"),
      content: inboxV2TimelineContentHeadOf(content)
    }),
    timelineItem: inboxV2TimelineItemSchema.parse(fixtureTimelineItem()),
    content,
    databaseNow: occurredAt
  };
}

function decisions() {
  return ["core:file.upload", "core:conversation.read"].map(
    (permissionId, index) =>
      inboxV2AuthorizationDecisionReferenceSchema.parse({
        tenantId: fixtureTenantId,
        id:
          index === 0
            ? "authorization-decision:file-upload-1"
            : "authorization-decision:conversation-read-1",
        authorizationEpoch: "authorization-epoch:attachment-terminal-1",
        principal: { kind: "trusted_service", trustedServiceId },
        permissionId,
        resourceScopeId: "core:conversation",
        resource: {
          tenantId: fixtureTenantId,
          entityTypeId: "core:conversation",
          entityId: conversationId
        },
        resourceAccessRevision: "13",
        decisionRevision: "1",
        decisionHash: `sha256:${(index === 0 ? "1" : "2").repeat(64)}`,
        outcome: "allowed",
        decidedAt: fixtureT2,
        notAfter
      })
  );
}

function authorityRow(overrides: Record<string, unknown> = {}) {
  return {
    authorization_decision_id: "authorization-decision:file-upload-1",
    authorization_epoch: "authorization-epoch:attachment-terminal-1",
    authorization_decision_refs: decisions(),
    actor_trusted_service_id: trustedServiceId,
    tenant_rbac_revision: "7",
    shared_access_revision: "11",
    resource_head_id: "authorization-resource:conversation-1",
    resource_access_revision: "13",
    structural_relation_revision: "17",
    collaborator_set_revision: "19",
    audit_grant_source_ids: [grantSourceId],
    audit_policy_version: "policy-v1",
    stream_epoch: "stream:epoch-1",
    database_now: occurredAt,
    ...overrides
  };
}

class TerminalAuthorityExecutor implements InboxV2AuthorizationTransactionExecutor {
  readonly statements: string[] = [];

  constructor(private readonly authority: Record<string, unknown>) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const statement = dialect.sqlToQuery(query).sql.replace(/\s+/gu, " ");
    this.statements.push(statement);
    if (statement.includes("left join inbox_v2_tenant_stream_commits")) {
      return { rows: [] };
    }
    if (statement.includes("reservation_audit.grant_source_ids")) {
      return { rows: [this.authority as Row] };
    }
    throw new Error(`Unexpected terminal preparer SQL: ${statement}`);
  }

  async transaction<TResult>(
    work: (transaction: this) => Promise<TResult>,
    _config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    return work(this);
  }
}

describe("Inbox V2 attachment materialization terminal command", () => {
  it("keeps lost-ack created/already-exists retries in one idempotency scope", () => {
    const inputClaim = claim();
    const created =
      calculateInboxV2AttachmentMaterializationTerminalRequestHash(
        inputClaim,
        readyOutcome("created")
      );
    const alreadyExists =
      calculateInboxV2AttachmentMaterializationTerminalRequestHash(
        inputClaim,
        readyOutcome("already_exists")
      );
    expect(created).toBe(alreadyExists);
    expect(
      calculateInboxV2AttachmentMaterializationTerminalRequestHash(inputClaim, {
        ...readyOutcome(),
        storage: {
          ...readyOutcome().storage,
          checksumSha256: "0".repeat(64)
        }
      })
    ).not.toBe(created);
  });

  it("returns durable lost-ack replay before mutable Message discovery", async () => {
    const prepareNew = vi.fn();
    const coordinate = vi.fn();
    const preparer: InboxV2AttachmentMaterializationTerminalCommandPreparer = {
      lookupIdempotency: vi.fn(
        async (
          terminalIntent: InboxV2AttachmentMaterializationTerminalIntent
        ) => ({
          kind: "committed_replay" as const,
          tenantId: terminalIntent.claim.tenantId,
          commandTypeId: "core:attachment.materialization.complete" as const,
          clientMutationId: terminalIntent.clientMutationId,
          requestHash: terminalIntent.requestHash,
          status: {
            commandId: terminalIntent.commandId,
            mutationId: "authorization-mutation:terminal-1",
            publicResultCode:
              INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_RESULT_CODE,
            resultReference: inboxV2PayloadReferenceSchema.parse({
              tenantId: terminalIntent.claim.tenantId,
              recordId: terminalIntent.claim.contentOrigin.parentEntityId,
              schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
              schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
              digest: `sha256:${"3".repeat(64)}`
            }),
            streamCommitId: "stream-commit:terminal-1",
            streamEpoch: "stream:epoch-1",
            streamPosition: "41",
            committedAt: occurredAt
          }
        })
      ),
      prepareNew
    };
    const service =
      createInboxV2AttachmentMaterializationTerminalCommandService({
        preparer,
        coordinator: {
          withAuthorizedCommandMutation: coordinate,
          withAuthorizedAtomicMaterialization: coordinate
        } as unknown as InboxV2AuthorizedAtomicMaterializationCoordinator
      });

    await expect(
      service.ready({ claim: claim(), storage: readyOutcome().storage })
    ).resolves.toMatchObject({
      kind: "already_applied",
      status: { streamPosition: "41" }
    });
    expect(preparer.lookupIdempotency).toHaveBeenCalledOnce();
    expect(prepareNew).not.toHaveBeenCalled();
    expect(coordinate).not.toHaveBeenCalled();
  });

  it("rebases a second attachment without overwriting the first terminal block", () => {
    const firstClaim = claim();
    const first = planInboxV2AttachmentMaterializationMessageMutation({
      current: currentWithTwoPendingAttachments(),
      intent: intent(firstClaim),
      occurredAt,
      trustedServiceId
    });
    const firstContent = first.commit.contentTransition?.after;
    expect(firstContent?.state.kind).toBe("available");
    if (firstContent?.state.kind !== "available") {
      throw new Error("first terminal content is unavailable");
    }
    const secondClaim = claim({
      jobId: "attachment_materialization_job:terminal-job-2",
      attachmentId: "message_attachment:terminal-file-2",
      attemptId: "attachment_materialization_attempt:terminal-attempt-2",
      fileId: "file:terminal-file-2",
      fileVersionId: "file_version:terminal-file-2-v1",
      objectVersionId: "file_object_version:terminal-file-2-v1",
      storageKey: "tenant/file/terminal-file-2-v1",
      contentOrigin: {
        ...firstClaim.contentOrigin,
        contentBlockKey: "file-2",
        expectedAttachmentRevision: "1"
      }
    });
    const second = planInboxV2AttachmentMaterializationMessageMutation({
      current: {
        message: first.commit.afterMessage,
        timelineItem: first.commit.afterTimelineItem,
        content: firstContent,
        databaseNow: occurredAt
      },
      intent: intent(secondClaim),
      occurredAt,
      trustedServiceId
    });
    const secondContent = second.commit.contentTransition?.after;
    expect(secondContent?.revision).toBe("3");
    expect(second.commit.afterMessage.revision).toBe("3");
    if (secondContent?.state.kind !== "available") {
      throw new Error("second terminal content is unavailable");
    }
    expect(
      secondContent.state.blocks.map((block) =>
        "attachment" in block ? block.attachment.state : null
      )
    ).toEqual(["ready", "ready"]);
  });

  it("persists only the purge-safe MessageRevision reference in event and audit", () => {
    const terminalIntent = intent();
    const plan = planInboxV2AttachmentMaterializationMessageMutation({
      current: currentWithTwoPendingAttachments(),
      intent: terminalIntent,
      occurredAt,
      trustedServiceId
    });
    const mutation =
      buildInboxV2AttachmentMaterializationTerminalAuthorizedMutationForTest({
        intent: terminalIntent,
        plan,
        authority: authorityRow(),
        decisions: decisions(),
        occurredAt,
        trustedServiceId
      });
    const domainReference = mutation.records.events[0]?.payloadReference;
    expect(domainReference?.schemaId).toBe(INBOX_V2_MESSAGE_REVISION_SCHEMA_ID);
    expect(mutation.records.audit.evidenceReference).toEqual(domainReference);
    expect(mutation.records.changes[0]?.state).toMatchObject({
      kind: "upsert",
      domainCommitReference: domainReference
    });
    for (const internalId of [
      mutation.records.mutationId,
      mutation.records.streamCommitId,
      mutation.records.changes[0]?.id,
      mutation.records.outboxIntents[0]?.id,
      mutation.records.audit.id
    ]) {
      expect(internalId).toMatch(/^[a-z][a-z0-9_-]{1,63}:[^:]+$/u);
    }
    expect(domainReference?.digest).toBe(
      `sha256:${computeInboxV2TimelineMessageCommitDigest(plan.commit.revision)}`
    );
    expect(domainReference?.digest).not.toBe(
      `sha256:${computeInboxV2TimelineMessageCommitDigest(plan.commit)}`
    );
    const retainedRevision = JSON.stringify(plan.commit.revision);
    expect(retainedRevision).not.toContain("blocks");
    expect(retainedRevision).not.toContain("photo.png");
    expect(retainedRevision).not.toContain("contentDigestSha256");
  });

  it("builds the same closed MessageRevision envelope for visible failed media", () => {
    const terminalIntent = intent(claim(), {
      kind: "failed",
      code: "provider.media_unsupported",
      retryable: false
    });
    const plan = planInboxV2AttachmentMaterializationMessageMutation({
      current: currentWithTwoPendingAttachments(),
      intent: terminalIntent,
      occurredAt,
      trustedServiceId
    });
    const mutation =
      buildInboxV2AttachmentMaterializationTerminalAuthorizedMutationForTest({
        intent: terminalIntent,
        plan,
        authority: authorityRow(),
        decisions: decisions(),
        occurredAt,
        trustedServiceId
      });
    const after = plan.commit.contentTransition?.after;
    expect(after?.state.kind).toBe("available");
    if (after?.state.kind !== "available") {
      throw new Error("failed attachment fallback content is unavailable");
    }
    expect(
      after.state.blocks.find((block) => block.blockKey === "image-1")
    ).toMatchObject({
      attachment: {
        state: "failed",
        reasonId:
          "core:attachment_materialization_failure.provider.media_unsupported"
      }
    });
    expect(mutation.records.events[0]?.payloadSchemaId).toBe(
      INBOX_V2_MESSAGE_REVISION_SCHEMA_ID
    );
  });

  it("rejects a stale tenant RBAC vector before reading Message content", async () => {
    const executor = new TerminalAuthorityExecutor(
      authorityRow({
        tenant_rbac_revision: "8",
        database_now: "2026-07-11 09:03:00.123456+00"
      })
    );
    const preparer =
      createSqlInboxV2AttachmentMaterializationTerminalCommandPreparer(
        executor
      );

    await expect(preparer.prepareNew(intent())).rejects.toThrow(
      "state_conflict"
    );
    expect(executor.statements).toHaveLength(2);
    expect(
      executor.statements.some((statement) =>
        statement.includes("from inbox_v2_messages")
      )
    ).toBe(false);
  });

  it("rejects a fabricated command ID as an audit grant source", async () => {
    const executor = new TerminalAuthorityExecutor(
      authorityRow({
        audit_grant_source_ids: ["command:attachment-reservation-1"]
      })
    );
    const preparer =
      createSqlInboxV2AttachmentMaterializationTerminalCommandPreparer(
        executor
      );

    await expect(preparer.prepareNew(intent())).rejects.toThrow();
    expect(executor.statements).toHaveLength(2);
  });
});
