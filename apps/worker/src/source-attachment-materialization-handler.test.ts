import { describe, expect, it, vi } from "vitest";
import {
  createSqlInboxV2SourceAttachmentMaterializationRepository,
  createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer,
  createSqlInboxV2SourceAttachmentReservationCommandPort
} from "@hulee/db/internal/attachment-materialization";

import {
  createInboxV2SourceAttachmentMaterializationHandler,
  createInboxV2SourceAttachmentMaterializationHandlerForTest,
  createInboxV2SourceAttachmentReservationNamespaceAuthority,
  createInboxV2SourceAttachmentReservationPlanner,
  createInboxV2TenantAttachmentStorageAddressResolver,
  type InboxV2SourceAttachmentMaterializationPlan,
  type InboxV2SourceAttachmentReservationInput
} from "./source-attachment-materialization-handler";
import type { InboxV2SourceProcessingRuntimeClaim } from "./source-processing-runtime-coordinator";

const origin = Object.freeze({
  tenantId: "tenant:source-attachment",
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
  retentionAnchorAt: "2026-06-01T00:00:00.000Z",
  causeEventId: "event:attachment",
  causeMutationId: "mutation:attachment",
  causeStreamCommitId: "stream-commit:attachment",
  causeStreamPosition: "1",
  correlationId: "correlation:attachment",
  causedAt: "2026-06-01T00:00:00.000Z"
});

function plan(
  anchors: InboxV2SourceAttachmentMaterializationPlan["anchors"] = [
    {
      ordinal: 0,
      blockKey: "attachment-1",
      attachmentId: "message_attachment:attachment-1",
      attachmentRevision: "1"
    },
    {
      ordinal: 1,
      blockKey: "attachment-2",
      attachmentId: "message_attachment:attachment-2",
      attachmentRevision: "1"
    }
  ]
): InboxV2SourceAttachmentMaterializationPlan {
  return Object.freeze({ origin, anchors: Object.freeze(anchors) });
}

describe("Inbox V2 source attachment materialization handler", () => {
  it("uses tenant-scoped storage and rejects forged authorities or cross-tenant addresses", () => {
    const namespaceAuthority = authorityV1();
    expect(() =>
      createInboxV2SourceAttachmentReservationNamespaceAuthority({
        activeGeneration: "attachment-namespace-v2",
        keys: [
          {
            generation: "attachment-namespace-v1",
            key: new Uint8Array(32).fill(1),
            activatedAt: "2026-01-01T00:00:00.000Z",
            verifyUntil: "2026-08-01T00:00:00.000Z"
          },
          {
            generation: "attachment-namespace-v2",
            key: new Uint8Array(32).fill(2),
            activatedAt: "2026-01-01T00:00:00.000Z",
            verifyUntil: null
          }
        ],
        now: () => Date.parse("2026-07-19T00:00:00.000Z")
      })
    ).toThrow(/unique activation times/u);
    expect(() =>
      createInboxV2SourceAttachmentReservationPlanner({
        namespaceAuthority: Object.freeze({
          kind: "source_attachment_reservation_namespace_authority"
        }),
        storageAddressResolver: storageResolver()
      })
    ).toThrow(/authentic HMAC/u);

    const planner = createInboxV2SourceAttachmentReservationPlanner({
      namespaceAuthority,
      storageAddressResolver: storageResolver()
    });
    const reservation = planner.plan({
      plan: plan(),
      anchor: plan().anchors[0]!
    });
    expect(reservation.reservation).toMatchObject({
      storageRootId: "core:tenant-object-storage"
    });
    expect(reservation.reservation.storageKey).toMatch(
      /^tenants\/tenant:source-attachment\/files\/attachments\//u
    );

    const crossTenant = createInboxV2SourceAttachmentReservationPlanner({
      namespaceAuthority,
      storageAddressResolver:
        createInboxV2TenantAttachmentStorageAddressResolver({
          resolve: () => ({
            tenantId: "tenant:other",
            storageRootId: "core:tenant-object-storage",
            keyPrefix: "tenants/other/files/"
          })
        })
    });
    expect(() =>
      crossTenant.plan({ plan: plan(), anchor: plan().anchors[0]! })
    ).toThrow(/cross-tenant/u);
  });

  it("keeps source-bound reservation identities stable across key rotation", async () => {
    const first = planner(authorityV1());
    const reserved = first.plan({ plan: plan(), anchor: plan().anchors[0]! });
    let now = Date.parse("2026-07-19T00:00:00.000Z");
    const rotated = planner(
      createInboxV2SourceAttachmentReservationNamespaceAuthority({
        activeGeneration: "attachment-namespace-v2",
        keys: [
          {
            generation: "attachment-namespace-v1",
            key: new Uint8Array(32).fill(1),
            activatedAt: "2026-01-01T00:00:00.000Z",
            verifyUntil: "2026-08-01T00:00:00.000Z"
          },
          {
            generation: "attachment-namespace-v2",
            key: new Uint8Array(32).fill(2),
            activatedAt: "2026-07-01T00:00:00.000Z",
            verifyUntil: null
          }
        ],
        now: () => now
      })
    );
    const replay = rotated.plan({ plan: plan(), anchor: plan().anchors[0]! });
    expect(replay).toEqual(reserved);
    expect(rotated.verifyProviderSourceLocator(locatorFacts(reserved))).toEqual(
      { kind: "verified" }
    );
    expect(
      rotated.verifyProviderSourceLocator({
        ...locatorFacts(reserved),
        reference: `src_ref_${"a".repeat(43)}`
      })
    ).toEqual({ kind: "reference_mismatch" });
    expect(
      rotated.verifyProviderSourceLocator({
        ...locatorFacts(reserved),
        reservationNamespaceGeneration: "attachment-namespace-v2"
      })
    ).toEqual({ kind: "reference_mismatch" });

    const newSourcePlan = {
      ...plan(),
      origin: { ...origin, causedAt: "2026-07-10T00:00:00.000Z" }
    };
    expect(
      rotated.plan({
        plan: newSourcePlan,
        anchor: newSourcePlan.anchors[0]!
      }).jobId
    ).not.toBe(reserved.jobId);

    now = Date.parse("2026-08-02T00:00:00.000Z");
    expect(rotated.verifyProviderSourceLocator(locatorFacts(reserved))).toEqual(
      { kind: "namespace_unavailable" }
    );
    expect(() =>
      rotated.plan({ plan: plan(), anchor: plan().anchors[0]! })
    ).toThrow(/retirement window/u);
    const reserve = vi.fn();
    const failStopHandler =
      createInboxV2SourceAttachmentMaterializationHandlerForTest({
        repository: {
          loadPlan: vi.fn(async () => ({
            kind: "selected" as const,
            plan: plan()
          })),
          verifyExactReservationSet: vi.fn()
        },
        reservationCommands: { reserve },
        reservationPlanner: rotated
      });
    await expect(
      failStopHandler.process(runtimeClaim())
    ).resolves.toMatchObject({
      kind: "failed",
      diagnostic: {
        codeId: "core:source-materialization-namespace-unavailable",
        retryable: true
      }
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("replays N/2 reservations after an edit and proves the exact current set", async () => {
    const originalPlan = plan();
    const editedPlan = plan([
      { ...originalPlan.anchors[0]!, ordinal: 1 },
      { ...originalPlan.anchors[1]!, ordinal: 2 }
    ]);
    const plans = [originalPlan, editedPlan];
    const repository = {
      loadPlan: vi.fn(async () => ({
        kind: "selected" as const,
        plan: plans.shift()!
      })),
      verifyExactReservationSet: vi.fn(async ({ reservations }) => ({
        kind: "complete" as const,
        attachmentCount: reservations.length
      }))
    };
    const calls: InboxV2SourceAttachmentReservationInput[] = [];
    let firstAttempt = true;
    const reserved = new Set<string>();
    const reservationCommands = {
      reserve: vi.fn(async (input: InboxV2SourceAttachmentReservationInput) => {
        calls.push(input);
        if (firstAttempt && input.attachmentId.endsWith("attachment-2")) {
          firstAttempt = false;
          throw new Error("simulated crash after N/2");
        }
        const replay = reserved.has(input.jobId);
        reserved.add(input.jobId);
        return success(replay ? "already_reserved" : "reserved", input);
      })
    };
    const firstHandler =
      createInboxV2SourceAttachmentMaterializationHandlerForTest({
        repository,
        reservationCommands,
        reservationPlanner: planner(authorityV1())
      });

    await expect(firstHandler.process(runtimeClaim())).resolves.toMatchObject({
      kind: "failed",
      diagnostic: { codeId: "core:source-materialization-reservation-failed" }
    });
    const rotatedHandler =
      createInboxV2SourceAttachmentMaterializationHandlerForTest({
        repository,
        reservationCommands,
        reservationPlanner: planner(rotatedAuthority())
      });
    await expect(rotatedHandler.process(runtimeClaim())).resolves.toEqual({
      kind: "processed"
    });
    expect(calls[0]).toEqual(calls[2]);
    expect(repository.verifyExactReservationSet).toHaveBeenCalledOnce();
  });

  it("does not mint a production handler from structural repository ports", () => {
    expect(() =>
      createInboxV2SourceAttachmentMaterializationHandler({
        repository: {
          loadPlan: vi.fn(),
          verifyExactReservationSet: vi.fn()
        },
        reservationCommands: { reserve: vi.fn() },
        reservationPlanner: planner(authorityV1())
      })
    ).toThrow(/SQL plan\/exact-set repository/u);
  });

  it("rejects authentic repository and command capabilities from different databases", () => {
    const databaseA = fakeDatabase();
    const databaseB = fakeDatabase();
    const repository =
      createSqlInboxV2SourceAttachmentMaterializationRepository(
        databaseA as never
      );
    const reservationCommands =
      createSqlInboxV2SourceAttachmentReservationCommandPort(
        databaseB as never,
        createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer(
          databaseB as never,
          { trustedServiceId: "core:source-runtime" }
        )
      );

    expect(() =>
      createInboxV2SourceAttachmentMaterializationHandler({
        repository,
        reservationCommands,
        reservationPlanner: planner(authorityV1())
      })
    ).toThrow(/same-database SQL plan\/exact-set repository/u);
  });
});

function fakeDatabase() {
  const database = {
    execute: vi.fn(),
    transaction: vi.fn(async (work: (transaction: unknown) => unknown) =>
      work(database)
    )
  };
  return database;
}

function authorityV1() {
  return createInboxV2SourceAttachmentReservationNamespaceAuthority({
    activeGeneration: "attachment-namespace-v1",
    keys: [
      {
        generation: "attachment-namespace-v1",
        key: new Uint8Array(32).fill(1),
        activatedAt: "2026-01-01T00:00:00.000Z",
        verifyUntil: null
      }
    ],
    now: () => Date.parse("2026-06-02T00:00:00.000Z")
  });
}

function rotatedAuthority() {
  return createInboxV2SourceAttachmentReservationNamespaceAuthority({
    activeGeneration: "attachment-namespace-v2",
    keys: [
      {
        generation: "attachment-namespace-v1",
        key: new Uint8Array(32).fill(1),
        activatedAt: "2026-01-01T00:00:00.000Z",
        verifyUntil: "2026-08-01T00:00:00.000Z"
      },
      {
        generation: "attachment-namespace-v2",
        key: new Uint8Array(32).fill(2),
        activatedAt: "2026-07-01T00:00:00.000Z",
        verifyUntil: null
      }
    ],
    now: () => Date.parse("2026-07-19T00:00:00.000Z")
  });
}

function storageResolver() {
  return createInboxV2TenantAttachmentStorageAddressResolver({
    resolve: (tenantId) => ({
      tenantId,
      storageRootId: "core:tenant-object-storage",
      keyPrefix: `tenants/${tenantId}/files/`
    })
  });
}

function planner(
  namespaceAuthority: ReturnType<
    typeof createInboxV2SourceAttachmentReservationNamespaceAuthority
  >
) {
  return createInboxV2SourceAttachmentReservationPlanner({
    namespaceAuthority,
    storageAddressResolver: storageResolver()
  });
}

function locatorFacts(input: InboxV2SourceAttachmentReservationInput) {
  return {
    tenantId: input.tenantId,
    reservationNamespaceGeneration: input.reservationNamespaceGeneration,
    sourceOccurrenceId: input.sourceOccurrenceId,
    parentMessageId: input.content.parentMessageId,
    timelineContentId: input.content.id,
    expectedContentRevision: input.content.expectedRevision,
    blockKey: input.content.blockKey,
    attachmentId: input.attachmentId,
    expectedAttachmentRevision: input.expectedAttachmentRevision,
    reference: input.sourceLocator.reference
  };
}

function success(
  kind: "reserved" | "already_reserved",
  input: InboxV2SourceAttachmentReservationInput
) {
  return {
    kind,
    jobId: input.jobId,
    fileId: input.file.id,
    fileVersionId: input.reservation.fileVersionId,
    objectVersionId: input.reservation.objectVersionId,
    storageRootId: input.reservation.storageRootId,
    storageKey: input.reservation.storageKey
  } as const;
}

function runtimeClaim(): InboxV2SourceProcessingRuntimeClaim {
  return {
    attempt: {
      attemptId: "source-attempt:attachment",
      scope: {
        stage: "materialization",
        normalizedEventId: origin.normalizedEventId
      }
    },
    leaseToken: `attachment-${"x".repeat(32)}`,
    rawIngressClaim: null
  } as unknown as InboxV2SourceProcessingRuntimeClaim;
}
