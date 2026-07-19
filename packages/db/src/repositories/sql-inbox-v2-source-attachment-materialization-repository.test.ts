import {
  calculateInboxV2SourceProcessingLeaseTokenHash,
  inboxV2SourceProcessingRuntimeClaimSchema,
  type InboxV2SourceProcessingRuntimeClaim
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  buildObserveInboxV2SourceAttachmentNamespaceRetirementDrainSql,
  buildClassifyInboxV2SourceAttachmentMaterializationAbsenceSql,
  buildLoadInboxV2SourceAttachmentMaterializationPlanSql,
  buildVerifyInboxV2SourceAttachmentMaterializationReservationsSql,
  createSqlInboxV2SourceAttachmentMaterializationRepository,
  type InboxV2SourceAttachmentMaterializationOrigin
} from "./sql-inbox-v2-source-attachment-materialization-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const dialect = new PgDialect();
const leaseToken = `source-materialization-${"x".repeat(40)}`;

describe("SQL Inbox V2 source attachment materialization repository", () => {
  it("resolves stable source origin against the retained current content head", () => {
    const statement = render(
      buildLoadInboxV2SourceAttachmentMaterializationPlanSql(claim())
    );
    expect(statement).toContain(
      "message.revision >= revision.message_revision"
    );
    expect(statement).toContain(
      "message.content_revision >= revision.after_content_revision"
    );
    expect(statement).toContain("retained_pending as materialized");
    expect(statement).toContain(
      "current_payload.content_revision = current_message.content_revision"
    );
    expect(statement).toContain(
      "current_payload.attachment_id = origin_payload.attachment_id"
    );
    expect(statement).not.toContain(
      "message.revision = revision.message_revision"
    );
  });

  it("classifies privacy/retention tombstones as a terminal no-op", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            live_lease: true,
            has_message_reconciliation: true,
            has_terminal_content_tombstone: true,
            terminal_deferred_action: false
          }
        ]
      });
    const repository =
      createSqlInboxV2SourceAttachmentMaterializationRepository({
        execute
      } as unknown as RawSqlExecutor);

    await expect(repository.loadPlan(claim())).resolves.toEqual({
      kind: "no_materializable_message"
    });
    expect(
      render(
        buildClassifyInboxV2SourceAttachmentMaterializationAbsenceSql(claim())
      )
    ).toContain(
      "message.content_state in ('privacy_erased', 'retention_purged')"
    );
  });

  it("maps one bounded current intersection and rejects hidden pending rows", async () => {
    const row = planRow();
    const selected = createSqlInboxV2SourceAttachmentMaterializationRepository({
      execute: vi.fn(async () => ({ rows: [row] }))
    } as unknown as RawSqlExecutor);
    await expect(selected.loadPlan(claim())).resolves.toMatchObject({
      kind: "selected",
      plan: {
        origin: {
          messageRevision: "1",
          contentRevision: "1",
          sourceOccurrenceId: "source_occurrence:attachment"
        },
        anchors: [
          {
            ordinal: 2,
            blockKey: "attachment-1",
            attachmentId: "message_attachment:attachment-1",
            attachmentRevision: "1"
          }
        ]
      }
    });

    const inconsistent =
      createSqlInboxV2SourceAttachmentMaterializationRepository({
        execute: vi.fn(async () => ({
          rows: [{ ...row, raw_pending_count: 2 }]
        }))
      } as unknown as RawSqlExecutor);
    await expect(inconsistent.loadPlan(claim())).rejects.toThrow(
      /exceeds or duplicates/u
    );
  });

  it("accepts every nonterminal job state in the current exact-set proof", () => {
    const currentPlan = {
      origin: {
        tenantId: "tenant:attachment",
        workId: "source-work:attachment",
        normalizedEventId: "normalized_inbound_event:attachment",
        sourceOccurrenceId: "source_occurrence:attachment",
        conversationId: "conversation:attachment",
        timelineItemId: "timeline_item:attachment",
        messageId: "message:attachment",
        messageRevision: "1",
        timelineContentId: "timeline_content:attachment",
        contentRevision: "1",
        visibilityBoundary: "external_work" as const,
        dataClassId: "core:message-content",
        processingPurposeId: "core:message-attachment",
        retentionAnchorAt: "2026-07-19T00:00:00.000Z",
        causeEventId: "event:attachment",
        causeMutationId: "mutation:attachment",
        causeStreamCommitId: "stream-commit:attachment",
        causeStreamPosition: "1",
        correlationId: "correlation:attachment",
        causedAt: "2026-07-19T00:00:00.000Z"
      },
      anchors: [
        {
          ordinal: 0,
          blockKey: "attachment-1",
          attachmentId: "message_attachment:attachment-1",
          attachmentRevision: "1"
        }
      ]
    };
    const reservation = reservationInput(currentPlan.origin);
    const statement = render(
      buildVerifyInboxV2SourceAttachmentMaterializationReservationsSql({
        claim: claim(),
        plan: currentPlan,
        reservations: [reservation]
      })
    );
    expect(statement).toContain(
      "job.state in ('pending', 'claimed', 'transferring', 'verifying')"
    );
    expect(statement).toContain(
      "job.reservation_namespace_generation = expected.reservation_namespace_generation"
    );
    expect(statement).not.toContain("origin_job_count");
  });

  it("blocks namespace retirement across both reserved jobs and pre-reservation work", async () => {
    const statement = render(
      buildObserveInboxV2SourceAttachmentNamespaceRetirementDrainSql({
        tenantId: "tenant:attachment",
        reservationNamespaceGeneration: "attachment-namespace-v1"
      })
    );
    expect(statement).toContain("job.reservation_namespace_generation = $2");
    expect(statement).toContain(
      "job.state in ('pending', 'claimed', 'transferring', 'verifying')"
    );
    expect(statement).toContain("work.stage = 'materialization'");
    expect(statement).toContain(
      "work.state in ('pending', 'leased', 'retry_scheduled')"
    );

    const blocked = createSqlInboxV2SourceAttachmentMaterializationRepository({
      execute: vi.fn(async () => ({
        rows: [
          {
            nonterminal_job_count: "0",
            unfinished_materialization_work_count: "1"
          }
        ]
      }))
    } as unknown as RawSqlExecutor);
    await expect(
      blocked.observeReservationNamespaceRetirementDrain({
        tenantId: "tenant:attachment",
        reservationNamespaceGeneration: "attachment-namespace-v1"
      })
    ).resolves.toMatchObject({
      kind: "blocked_observed",
      nonterminalJobCount: "0",
      unfinishedMaterializationWorkCount: "1"
    });

    const drained = createSqlInboxV2SourceAttachmentMaterializationRepository({
      execute: vi.fn(async () => ({
        rows: [
          {
            nonterminal_job_count: "0",
            unfinished_materialization_work_count: "0"
          }
        ]
      }))
    } as unknown as RawSqlExecutor);
    await expect(
      drained.observeReservationNamespaceRetirementDrain({
        tenantId: "tenant:attachment",
        reservationNamespaceGeneration: "attachment-namespace-v1"
      })
    ).resolves.toMatchObject({ kind: "drained_observed" });
  });
});

function claim(): InboxV2SourceProcessingRuntimeClaim {
  return inboxV2SourceProcessingRuntimeClaimSchema.parse({
    attempt: {
      attemptId: "source-attempt:attachment",
      workId: "source-work:attachment",
      scope: {
        tenantId: "tenant:attachment",
        sourceConnectionId: "source_connection:attachment",
        sourceAccountId: null,
        rawEventId: "raw_inbound_event:attachment",
        normalizedEventId: "normalized_inbound_event:attachment",
        stage: "materialization"
      },
      origin: "retry",
      replayRequestId: null,
      attemptNumber: 2,
      maxAttempts: 5,
      workRevision: "2",
      workerId: "core:source-runtime",
      leaseTokenHash:
        calculateInboxV2SourceProcessingLeaseTokenHash(leaseToken),
      leaseRevision: "1",
      leaseClaimedAt: "2026-07-19T00:00:00.000Z",
      startedAt: "2026-07-19T00:00:00.000Z",
      leaseExpiresAt: "2099-07-19T00:05:00.000Z"
    },
    leaseToken,
    rawIngressClaim: null
  });
}

function planRow() {
  return {
    work_id: "source-work:attachment",
    normalized_event_id: "normalized_inbound_event:attachment",
    source_occurrence_id: "source_occurrence:attachment",
    conversation_id: "conversation:attachment",
    timeline_item_id: "timeline_item:attachment",
    message_id: "message:attachment",
    message_revision: "1",
    timeline_content_id: "timeline_content:attachment",
    content_revision: "1",
    timeline_visibility: "conversation_external",
    data_class_id: "core:message-content",
    processing_purpose_id: "core:message-attachment",
    retention_anchor_at: new Date("2026-07-19T00:00:00.000Z"),
    cause_event_id: "event:attachment",
    cause_mutation_id: "mutation:attachment",
    cause_stream_commit_id: "stream-commit:attachment",
    cause_stream_position: "1",
    correlation_id: "correlation:attachment",
    caused_at: new Date("2026-07-19T00:00:00.000Z"),
    reconciled_count: 1,
    raw_pending_count: 1,
    anchor_ordinal: 2,
    block_key: "attachment-1",
    attachment_id: "message_attachment:attachment-1",
    attachment_revision: "1"
  };
}

function reservationInput(
  origin: InboxV2SourceAttachmentMaterializationOrigin
) {
  return {
    tenantId: origin.tenantId,
    jobId: "attachment_materialization_job:attachment-1",
    attachmentId: "message_attachment:attachment-1",
    file: {
      id: "file:attachment-1",
      expectedRevision: "1",
      dataClassId: origin.dataClassId,
      processingPurposeId: origin.processingPurposeId,
      retentionAnchorAt: origin.retentionAnchorAt
    },
    content: {
      conversationId: origin.conversationId,
      timelineItemId: origin.timelineItemId,
      parentMessageId: origin.messageId,
      expectedParentRevision: origin.messageRevision,
      visibilityBoundary: origin.visibilityBoundary,
      id: origin.timelineContentId,
      expectedRevision: origin.contentRevision,
      blockKey: "attachment-1",
      mutationFenceSha256: "a".repeat(64)
    },
    sourceOccurrenceId: origin.sourceOccurrenceId,
    sourceLocator: {
      kind: "provider" as const,
      reference: `src_ref_${"a".repeat(43)}`
    },
    reservationNamespaceGeneration: "attachment-namespace-v1",
    causeEventId: origin.causeEventId,
    causeMutationId: origin.causeMutationId,
    causeStreamCommitId: origin.causeStreamCommitId,
    causeStreamPosition: origin.causeStreamPosition,
    correlationId: origin.correlationId,
    causedAt: origin.causedAt,
    idempotencyToken: "attachment-reservation:v1:test",
    expectedAttachmentRevision: "1",
    reservation: {
      fileVersionId: "file_version:attachment-1",
      objectVersionId: "file_object_version:attachment-1",
      storageRootId: "core:tenant-object-storage",
      storageKey: "tenants/attachment/files/attachment-1"
    }
  };
}

function render(query: SQL): string {
  return dialect.sqlToQuery(query).sql.replace(/\s+/gu, " ").trim();
}
