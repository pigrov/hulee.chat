import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  computeInboxV2LeafHashDigest,
  type InboxV2AuthorizationTransactionExecutor
} from "./sql-inbox-v2-authorization-repository";
import type { ReserveInboxV2AttachmentMaterializationInput } from "./sql-inbox-v2-file-object-repository";
import {
  createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer,
  createSqlInboxV2SourceAttachmentReservationCommandPort,
  executeInboxV2PendingAttachmentAuthorizationRefreshForTest
} from "./sql-inbox-v2-source-attachment-reservation-command";
import type { RawSqlQueryResult } from "./sql-outbox-repository";

const dialect = new PgDialect();

describe("SQL Inbox V2 source attachment reservation authorization", () => {
  it("rejects structural preparers and unregistered trusted-service identities", () => {
    const executor = new ReservationAuthorityExecutor(authorityRow());
    expect(() =>
      createSqlInboxV2SourceAttachmentReservationCommandPort(executor, {
        prepareAuthorizedReservation: vi.fn(),
        preparePendingAuthorizationRefresh: vi.fn()
      })
    ).toThrow(/authentic SQL current-authorization preparer/u);
    expect(() =>
      createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer(
        executor,
        { trustedServiceId: "core:guessed-service" }
      )
    ).toThrow(/closed to the registered source runtime/u);
    const authentic =
      createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer(
        executor,
        { trustedServiceId: "core:source-runtime" }
      );
    expect(() =>
      createSqlInboxV2SourceAttachmentReservationCommandPort(
        new ReservationAuthorityExecutor(authorityRow()),
        authentic
      )
    ).toThrow(/same executor/u);
  });

  it("loads exact current source/content/RBAC fences and emits two closed decisions", async () => {
    const executor = new ReservationAuthorityExecutor(authorityRow());
    const preparer =
      createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer(
        executor,
        { trustedServiceId: "core:source-runtime" }
      );
    const prepared = await preparer.prepareAuthorizedReservation(reservation());

    expect(prepared).not.toBeNull();
    expect(prepared).toMatchObject({
      tenantId: "tenant:attachment",
      command: {
        commandTypeId: "core:attachment.materialization.reserve",
        actor: {
          kind: "trusted_service",
          trustedServiceId: "core:source-runtime"
        },
        resultReference: {
          recordId: "attachment_materialization_job:attachment"
        }
      },
      revisions: {
        expectedTenantRbacRevision: "7",
        expectedSharedAccessRevision: "11",
        resources: [
          {
            resourceKind: "conversation",
            resourceId: "conversation:attachment",
            expectedResourceAccessRevision: "13",
            expectedStructuralRelationRevision: "17",
            expectedCollaboratorSetRevision: "19"
          }
        ]
      }
    });
    expect(
      prepared!.records.audit.authorizationDecisionRefs.map(
        ({ permissionId }) => permissionId
      )
    ).toEqual(["core:conversation.read", "core:file.upload"]);
    expect(prepared!.records.audit.target.entityId).toMatch(
      /^internal-ref:[a-f0-9]{64}$/u
    );
    expect(prepared!.records.audit.policyVersion).toBe("v1");
    expect(prepared!.records.audit.revisionDeltaHash).toBe(
      computeInboxV2LeafHashDigest([])
    );
    expect(prepared!.records.audit.grantSourceIds).toEqual(
      [...prepared!.records.audit.grantSourceIds].sort()
    );
    expect(executor.statement).toContain("message.revision >=");
    expect(executor.statement).toContain(
      "current_payload.content_revision = content.revision"
    );
    expect(executor.statement).toContain(
      "occurrence.materialized_by_trusted_service_id ="
    );
    expect(executor.statement).toContain(
      "occurrence.materialization_authorization_token"
    );
    expect(executor.statement).toContain(
      "occurrence.revision as source_occurrence_revision"
    );
  });

  it("binds refresh identity to current source grant, revisions and decision time", async () => {
    const firstExecutor = new ReservationAuthorityExecutor(authorityRow());
    const first =
      createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer(
        firstExecutor,
        { trustedServiceId: "core:source-runtime" }
      );
    const target = {
      tenantId: "tenant:attachment",
      jobId: "attachment_materialization_job:attachment",
      expectedJobRevision: "4"
    } as const;
    const prepared = await first.preparePendingAuthorizationRefresh(target);

    expect(prepared).toMatchObject({
      tenantId: "tenant:attachment",
      command: {
        commandTypeId: "core:attachment.materialization.reauthorize",
        resultReference: {
          recordId: "attachment_materialization_job:attachment"
        }
      },
      records: {
        events: [
          {
            typeId: "core:attachment-materialization.changed"
          }
        ],
        changes: [
          {
            resultingRevision: "5"
          }
        ]
      }
    });
    expect(firstExecutor.statement).not.toContain("job.lease_generation = 0");
    expect(firstExecutor.statement).toContain(
      "job.reservation_namespace_generation"
    );

    const changedExecutor = new ReservationAuthorityExecutor(
      authorityRow({
        tenant_rbac_revision: "8",
        materialization_authorization_token: "source-materialization-grant:v2",
        source_occurrence_revision: "4",
        database_now: new Date("2026-07-19T00:00:01.000Z")
      })
    );
    const changed =
      createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer(
        changedExecutor,
        { trustedServiceId: "core:source-runtime" }
      );
    const changedPrepared =
      await changed.preparePendingAuthorizationRefresh(target);
    expect(changedPrepared!.command.requestHash).not.toBe(
      prepared!.command.requestHash
    );
    expect(changedPrepared!.command.id).not.toBe(prepared!.command.id);
  });

  it("fails closed when the SQL authority row crosses service or visibility scope", async () => {
    const executor = new ReservationAuthorityExecutor(
      authorityRow({ materialized_by_trusted_service_id: "core:other" })
    );
    const preparer =
      createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer(
        executor,
        { trustedServiceId: "core:source-runtime" }
      );
    await expect(
      preparer.prepareAuthorizedReservation(reservation())
    ).rejects.toThrow(/outside its trusted service or visibility scope/u);
  });

  it("does not touch the job when authority is revoked after preparation", async () => {
    const preparePendingAuthorizationRefresh = vi.fn(async () =>
      preparedRefreshMutation()
    );
    const reauthorizePendingMaterialization = vi.fn();
    const sourceAuthorityRevalidator = vi.fn(async () => false);
    const withAuthorizedCommandMutation = vi.fn(
      async (_prepared, persistDomainMutation) => ({
        kind: "applied" as const,
        ...(await persistDomainMutation({}))
      })
    );

    await expect(
      executeInboxV2PendingAttachmentAuthorizationRefreshForTest(
        {
          authorization: {
            prepareAuthorizedReservation: vi.fn(),
            preparePendingAuthorizationRefresh
          },
          coordinator: { withAuthorizedCommandMutation } as never,
          files: { reauthorizePendingMaterialization } as never,
          sourceAuthorityRevalidator
        },
        refreshTarget()
      )
    ).resolves.toEqual({ kind: "authorization_conflict" });
    expect(preparePendingAuthorizationRefresh).toHaveBeenCalledOnce();
    expect(withAuthorizedCommandMutation).toHaveBeenCalledOnce();
    expect(sourceAuthorityRevalidator).toHaveBeenCalledOnce();
    expect(reauthorizePendingMaterialization).not.toHaveBeenCalled();
  });

  it("lets one concurrent refresh win and returns the losing CAS conflict", async () => {
    const reauthorizePendingMaterialization = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "refreshed",
        resultingJobRevision: "5"
      })
      .mockResolvedValueOnce({ kind: "state_conflict" });
    const withAuthorizedCommandMutation = vi.fn(
      async (_prepared, persistDomainMutation) => ({
        kind: "applied" as const,
        ...(await persistDomainMutation({}))
      })
    );
    const dependencies = {
      authorization: {
        prepareAuthorizedReservation: vi.fn(),
        preparePendingAuthorizationRefresh: vi.fn(async () =>
          preparedRefreshMutation()
        )
      },
      coordinator: { withAuthorizedCommandMutation } as never,
      files: { reauthorizePendingMaterialization } as never,
      sourceAuthorityRevalidator: vi.fn(async () => true)
    };

    await expect(
      executeInboxV2PendingAttachmentAuthorizationRefreshForTest(
        dependencies,
        refreshTarget()
      )
    ).resolves.toEqual({ kind: "refreshed", resultingJobRevision: "5" });
    await expect(
      executeInboxV2PendingAttachmentAuthorizationRefreshForTest(
        dependencies,
        refreshTarget()
      )
    ).resolves.toEqual({ kind: "state_conflict" });
    expect(reauthorizePendingMaterialization).toHaveBeenCalledTimes(2);
  });
});

function refreshTarget() {
  return {
    tenantId: "tenant:attachment",
    jobId: "attachment_materialization_job:attachment",
    expectedJobRevision: "4"
  } as const;
}

function preparedRefreshMutation() {
  return {
    tenantId: "tenant:attachment",
    command: {
      commandTypeId: "core:attachment.materialization.reauthorize"
    }
  } as never;
}

class ReservationAuthorityExecutor implements InboxV2AuthorizationTransactionExecutor {
  statement = "";

  constructor(private readonly row: Record<string, unknown>) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.statement = dialect.sqlToQuery(query).sql.replace(/\s+/gu, " ");
    return { rows: [this.row as Row] };
  }

  async transaction<TResult>(
    work: (transaction: this) => Promise<TResult>,
    _config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    return work(this);
  }
}

function authorityRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant_rbac_revision: "7",
    shared_access_revision: "11",
    resource_head_id: "authorization-resource-head:attachment",
    resource_access_revision: "13",
    structural_relation_revision: "17",
    collaborator_set_revision: "19",
    stream_epoch: "stream:attachment",
    timeline_visibility: "conversation_external",
    materialized_by_trusted_service_id: "core:source-runtime",
    materialization_authorization_token: "source-materialization-grant:v1",
    source_occurrence_revision: "3",
    job_id: "attachment_materialization_job:attachment",
    job_revision: "4",
    attachment_id: "message_attachment:attachment",
    file_id: "file:attachment",
    expected_attachment_revision: "1",
    conversation_id: "conversation:attachment",
    timeline_item_id: "timeline_item:attachment",
    parent_message_id: "message:attachment",
    expected_parent_revision: "1",
    visibility_boundary: "external_work",
    timeline_content_id: "timeline_content:attachment",
    expected_content_revision: "1",
    content_block_key: "attachment-1",
    source_occurrence_id: "source_occurrence:attachment",
    reservation_namespace_generation: "attachment-namespace-v1",
    idempotency_token: "attachment-reservation:v2:attachment-namespace-v1:test",
    reserved_file_version_id: "file_version:attachment",
    reserved_object_version_id: "file_object_version:attachment",
    correlation_id: "correlation:attachment",
    database_now: new Date("2026-07-19T00:00:00.000Z"),
    ...overrides
  };
}

function reservation(): ReserveInboxV2AttachmentMaterializationInput {
  return {
    tenantId: "tenant:attachment",
    reservationNamespaceGeneration: "attachment-namespace-v1",
    jobId: "attachment_materialization_job:attachment",
    attachmentId: "message_attachment:attachment",
    file: {
      id: "file:attachment",
      expectedRevision: "1",
      dataClassId: "core:message-content",
      processingPurposeId: "core:message-attachment",
      retentionAnchorAt: "2026-07-19T00:00:00.000Z"
    },
    content: {
      conversationId: "conversation:attachment",
      timelineItemId: "timeline_item:attachment",
      parentMessageId: "message:attachment",
      expectedParentRevision: "1",
      visibilityBoundary: "external_work",
      id: "timeline_content:attachment",
      expectedRevision: "1",
      blockKey: "attachment-1",
      mutationFenceSha256: "a".repeat(64)
    },
    sourceOccurrenceId: "source_occurrence:attachment",
    sourceLocator: {
      kind: "provider",
      reference: `src_ref_${"a".repeat(43)}`
    },
    causeEventId: "event:attachment",
    causeMutationId: "mutation:attachment",
    causeStreamCommitId: "stream-commit:attachment",
    causeStreamPosition: "1",
    correlationId: "correlation:attachment",
    causedAt: "2026-07-19T00:00:00.000Z",
    idempotencyToken: "attachment-reservation:v2:attachment-namespace-v1:test",
    expectedAttachmentRevision: "1",
    reservation: {
      fileVersionId: "file_version:attachment",
      objectVersionId: "file_object_version:attachment",
      storageRootId: "core:tenant-object-storage",
      storageKey: "tenants/attachment/files/attachment"
    }
  };
}
