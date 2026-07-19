import type { HuleeDatabase } from "@hulee/db";
import {
  createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer,
  createSqlInboxV2SourceAttachmentReservationCommandPort,
  type InboxV2AttachmentMaterializationClaim as SqlInboxV2AttachmentMaterializationClaim
} from "@hulee/db/internal/attachment-materialization";
import { calculateHuleeSha256 } from "@hulee/storage";
import { describe, expect, it, vi } from "vitest";

import * as publicWorker from "./index";
import type { InboxV2AttachmentMaterializationClaim } from "./inbox-v2-attachment-materialization-coordinator";
import {
  createInboxV2AttachmentMaterializationSweeperForTest,
  createInboxV2AttachmentMaterializationProductionServices,
  createInboxV2TrustedAttachmentMaterializationProviderSourceLoader,
  createWorkerInboxV2AttachmentMaterializationSweeper,
  resolveInboxV2TrustedAttachmentMaterializationSourceLoaderForTest,
  type InboxV2TrustedAttachmentMaterializationProviderSourceLoader,
  type InboxV2TrustedAttachmentMaterializationStorageResolver,
  type InboxV2AttachmentMaterializationProductionServices
} from "./inbox-v2-attachment-materialization-sweeper";
import {
  createInboxV2SourceAttachmentReservationNamespaceAuthority,
  createInboxV2SourceAttachmentReservationPlanner,
  createInboxV2TenantAttachmentStorageAddressResolver
} from "./source-attachment-materialization-handler";

describe("Inbox V2 attachment materialization production sweep", () => {
  it("exposes only the high-level sweep from the worker root", () => {
    expect(publicWorker).toHaveProperty(
      "createWorkerInboxV2AttachmentMaterializationSweeper"
    );
    expect(publicWorker).not.toHaveProperty(
      "createInboxV2AttachmentMaterializationSweeperForTest"
    );
    expect(publicWorker).not.toHaveProperty(
      "createInboxV2TrustedAttachmentMaterializationProviderSourceLoader"
    );
    expect(publicWorker).not.toHaveProperty(
      "createInboxV2TrustedAttachmentMaterializationStorageResolver"
    );
    expect(publicWorker).not.toHaveProperty(
      "createInboxV2AttachmentMaterializationProductionServices"
    );
    expect(publicWorker).not.toHaveProperty(
      "resolveInboxV2TrustedAttachmentMaterializationSourceLoaderForTest"
    );
  });

  it("rejects structural production substitutes", () => {
    const structuralSource = Object.freeze({
      kind: "trusted_attachment_materialization_provider_source_loader" as const
    }) as InboxV2TrustedAttachmentMaterializationProviderSourceLoader;
    const structuralStorage = Object.freeze({
      kind: "trusted_attachment_materialization_storage_resolver" as const
    }) as InboxV2TrustedAttachmentMaterializationStorageResolver;
    const structuralServices =
      databaseShape() as unknown as InboxV2AttachmentMaterializationProductionServices;

    expect(() =>
      createWorkerInboxV2AttachmentMaterializationSweeper({
        services: structuralServices,
        tenantId: "tenant:one",
        workerId: "core:attachment-materialization-worker",
        sourceLoader: structuralSource,
        storageResolver: structuralStorage
      })
    ).toThrow(/authentic SQL, provider-source and tenant-storage/u);

    expect(() =>
      createInboxV2AttachmentMaterializationProductionServices({
        database: databaseShape(),
        reservationCommands: {
          reserve: vi.fn(),
          refreshPendingAuthorization: vi.fn()
        }
      })
    ).toThrow(/authentic SQL reservation command port/u);

    const firstDatabase = databaseShape();
    const secondDatabase = databaseShape();
    const firstDatabaseCommands =
      createSqlInboxV2SourceAttachmentReservationCommandPort(
        firstDatabase,
        createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer(
          firstDatabase,
          { trustedServiceId: "core:source-runtime" }
        )
      );
    expect(() =>
      createInboxV2AttachmentMaterializationProductionServices({
        database: secondDatabase,
        reservationCommands: firstDatabaseCommands
      })
    ).toThrow(/same database/u);
  });

  it("requires an authentic HMAC planner and verifies the locator before provider I/O", async () => {
    const providerOpen = vi.fn(async () => ({
      body: new Uint8Array([1]),
      sizeBytes: 1,
      mediaType: "image/jpeg",
      checksumSha256: calculateHuleeSha256(new Uint8Array([1]))
    }));
    expect(() =>
      createInboxV2TrustedAttachmentMaterializationProviderSourceLoader({
        reservationPlanner: {
          plan: vi.fn(),
          verifyProviderSourceLocator: vi.fn(() => ({
            kind: "verified" as const
          }))
        },
        open: providerOpen
      })
    ).toThrow(/authentic HMAC locator planner/u);

    const capability =
      createInboxV2TrustedAttachmentMaterializationProviderSourceLoader({
        reservationPlanner: authenticPlanner(),
        open: providerOpen
      });
    const sourceLoader =
      resolveInboxV2TrustedAttachmentMaterializationSourceLoaderForTest(
        capability
      );

    await expect(
      sourceLoader.open(sqlClaimWithInvalidLocator(), {
        signal: new AbortController().signal,
        maximumBytes: 1_024
      })
    ).rejects.toMatchObject({
      code: "source_locator_reference_mismatch",
      retryable: false,
      disposition: "visible_fallback"
    });
    expect(providerOpen).not.toHaveBeenCalled();
  });

  it("keeps an unavailable exact namespace nonterminal before provider I/O", async () => {
    let now = Date.parse("2026-07-19T10:00:00.000Z");
    const providerOpen = vi.fn();
    const planner = createInboxV2SourceAttachmentReservationPlanner({
      namespaceAuthority:
        createInboxV2SourceAttachmentReservationNamespaceAuthority({
          activeGeneration: "attachment-namespace-v2",
          keys: [
            {
              generation: "attachment-namespace-v1",
              key: new Uint8Array(32).fill(7),
              activatedAt: "2026-01-01T00:00:00.000Z",
              verifyUntil: "2026-08-01T00:00:00.000Z"
            },
            {
              generation: "attachment-namespace-v2",
              key: new Uint8Array(32).fill(8),
              activatedAt: "2026-07-01T00:00:00.000Z",
              verifyUntil: null
            }
          ],
          now: () => now
        }),
      storageAddressResolver:
        createInboxV2TenantAttachmentStorageAddressResolver({
          resolve: (tenantId) => ({
            tenantId,
            storageRootId: "core:tenant-object-storage",
            keyPrefix: `tenants/${tenantId}/files/`
          })
        })
    });
    const capability =
      createInboxV2TrustedAttachmentMaterializationProviderSourceLoader({
        reservationPlanner: planner,
        open: providerOpen
      });
    const sourceLoader =
      resolveInboxV2TrustedAttachmentMaterializationSourceLoaderForTest(
        capability
      );
    now = Date.parse("2026-08-02T00:00:00.000Z");

    await expect(
      sourceLoader.open(sqlClaimWithInvalidLocator(), {
        signal: new AbortController().signal,
        maximumBytes: 1_024
      })
    ).rejects.toMatchObject({
      code: "source_locator_namespace_unavailable",
      retryable: true,
      disposition: "indeterminate"
    });
    expect(providerOpen).not.toHaveBeenCalled();
  });

  it("continues after one claim throws and returns only bounded aggregate counts", async () => {
    const claims = [claim(1), claim(2), claim(3), claim(4), claim(5)];
    const processedIds: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const sweeper = createInboxV2AttachmentMaterializationSweeperForTest({
      tenantId: "tenant:one",
      workerId: "core:attachment-materialization-worker",
      batchSize: 5,
      concurrency: 2,
      claimBatch: vi.fn(async () => claims),
      async processClaim(candidate) {
        processedIds.push(candidate.jobId);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        active -= 1;
        switch (candidate.jobId) {
          case "attachment_materialization_job:1":
            return {
              outcome: "ready",
              persistence: "applied",
              storageVersionId: "provider-secret-version"
            };
          case "attachment_materialization_job:2":
            throw new Error("isolated claim failure");
          case "attachment_materialization_job:3":
            return { outcome: "cancelled", persistence: "cancelled" };
          case "attachment_materialization_job:4":
            return {
              outcome: "orphan_recorded",
              code: "provider_ack_unknown",
              identity: {
                storageKey: "tenants/secret/key",
                versionId: "provider-secret-version"
              }
            };
          default:
            return {
              outcome: "indeterminate",
              code: "provider_internal_detail"
            };
        }
      }
    });

    const result = await sweeper.sweep();

    expect(result).toEqual({
      authorizationRefreshSelectedCount: 0,
      authorizationRefreshRefreshedCount: 0,
      authorizationRefreshAlreadyCurrentCount: 0,
      authorizationRefreshConflictCount: 0,
      authorizationRefreshFailureCount: 0,
      claimFailureCount: 0,
      claimedCount: 5,
      attemptedCount: 5,
      cancelledCount: 1,
      readyCount: 1,
      visibleFallbackCount: 0,
      readyReconciledCount: 0,
      orphanRecordedCount: 1,
      orphanUnrecordedCount: 0,
      indeterminateCount: 1,
      unhandledFailureCount: 1
    });
    expect(new Set(processedIds)).toEqual(
      new Set(claims.map((candidate) => candidate.jobId))
    );
    expect(maximumActive).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(
      /lease|source|storage|version|jobId|provider-secret/u
    );
  });

  it("refreshes stale authorization before claim and isolates refresh conflicts", async () => {
    const order: string[] = [];
    const candidates = [1, 2, 3].map((ordinal) => ({
      tenantId: "tenant:one",
      jobId: `attachment_materialization_job:${ordinal}`,
      expectedJobRevision: "1"
    }));
    const sweeper = createInboxV2AttachmentMaterializationSweeperForTest({
      tenantId: "tenant:one",
      workerId: "core:attachment-materialization-worker",
      batchSize: 3,
      concurrency: 2,
      listAuthorizationRefreshCandidates: vi.fn(async () => {
        order.push("selected");
        return candidates;
      }),
      async refreshAuthorization(candidate) {
        order.push(`refresh:${candidate.jobId}`);
        if (candidate.jobId.endsWith(":1")) {
          return { kind: "refreshed", resultingJobRevision: "2" };
        }
        if (candidate.jobId.endsWith(":2")) {
          return { kind: "state_conflict" };
        }
        throw new Error("isolated refresh failure");
      },
      claimBatch: vi.fn(async () => {
        order.push("claimed");
        return [claim(1)];
      }),
      processClaim: vi.fn(async () => {
        order.push("processed");
        return {
          outcome: "ready" as const,
          persistence: "applied" as const,
          storageVersionId: "hidden"
        };
      })
    });

    await expect(sweeper.sweep()).resolves.toEqual({
      authorizationRefreshSelectedCount: 3,
      authorizationRefreshRefreshedCount: 1,
      authorizationRefreshAlreadyCurrentCount: 0,
      authorizationRefreshConflictCount: 1,
      authorizationRefreshFailureCount: 1,
      claimFailureCount: 0,
      claimedCount: 1,
      attemptedCount: 1,
      cancelledCount: 0,
      readyCount: 1,
      visibleFallbackCount: 0,
      readyReconciledCount: 0,
      orphanRecordedCount: 0,
      orphanUnrecordedCount: 0,
      indeterminateCount: 0,
      unhandledFailureCount: 0
    });
    expect(order.at(0)).toBe("selected");
    expect(order.indexOf("claimed")).toBeGreaterThan(
      order.findLastIndex((entry) => entry.startsWith("refresh:"))
    );
    expect(order.at(-1)).toBe("processed");
  });

  it("reclaims an access-stale claim after it returns to pending and refreshes authorization", async () => {
    let sweepNumber = 0;
    const outcomes: string[] = [];
    const sweeper = createInboxV2AttachmentMaterializationSweeperForTest({
      tenantId: "tenant:one",
      workerId: "core:attachment-materialization-worker",
      batchSize: 1,
      listAuthorizationRefreshCandidates: vi.fn(async () =>
        sweepNumber === 0
          ? []
          : [
              {
                tenantId: "tenant:one",
                jobId: "attachment_materialization_job:1",
                expectedJobRevision: "3"
              }
            ]
      ),
      refreshAuthorization: vi.fn(async () => ({
        kind: "refreshed" as const,
        resultingJobRevision: "4"
      })),
      claimBatch: vi.fn(async () => [claim(1)]),
      processClaim: vi.fn(async () => {
        if (sweepNumber === 0) {
          outcomes.push("access-stale-no-io");
          return {
            outcome: "indeterminate" as const,
            code: "materialization_io_authorization_authorization_refresh_required"
          };
        }
        outcomes.push("reclaimed-ready");
        return {
          outcome: "ready" as const,
          persistence: "applied" as const,
          storageVersionId: "hidden"
        };
      })
    });

    const first = await sweeper.sweep();
    sweepNumber = 1;
    const second = await sweeper.sweep();

    expect(first.indeterminateCount).toBe(1);
    expect(first.cancelledCount).toBe(0);
    expect(second).toMatchObject({
      authorizationRefreshSelectedCount: 1,
      authorizationRefreshRefreshedCount: 1,
      claimedCount: 1,
      readyCount: 1,
      cancelledCount: 0
    });
    expect(outcomes).toEqual(["access-stale-no-io", "reclaimed-ready"]);
  });

  it("clamps default concurrency to a one-item batch", () => {
    expect(() =>
      createInboxV2AttachmentMaterializationSweeperForTest({
        tenantId: "tenant:one",
        workerId: "core:attachment-materialization-worker",
        batchSize: 1,
        claimBatch: vi.fn(async () => []),
        processClaim: vi.fn()
      })
    ).not.toThrow();
  });

  it("fails closed when a claim source exceeds the configured bound", async () => {
    const processClaim = vi.fn();
    const sweeper = createInboxV2AttachmentMaterializationSweeperForTest({
      tenantId: "tenant:one",
      workerId: "core:attachment-materialization-worker",
      batchSize: 2,
      concurrency: 2,
      claimBatch: vi.fn(async () => [claim(1), claim(2), claim(3)]),
      processClaim
    });

    await expect(sweeper.sweep()).resolves.toEqual({
      authorizationRefreshSelectedCount: 0,
      authorizationRefreshRefreshedCount: 0,
      authorizationRefreshAlreadyCurrentCount: 0,
      authorizationRefreshConflictCount: 0,
      authorizationRefreshFailureCount: 0,
      claimFailureCount: 1,
      claimedCount: 0,
      attemptedCount: 0,
      cancelledCount: 0,
      readyCount: 0,
      visibleFallbackCount: 0,
      readyReconciledCount: 0,
      orphanRecordedCount: 0,
      orphanUnrecordedCount: 0,
      indeterminateCount: 0,
      unhandledFailureCount: 0
    });
    expect(processClaim).not.toHaveBeenCalled();
  });
});

function claim(ordinal: number): InboxV2AttachmentMaterializationClaim {
  return {
    tenantId: "tenant:one",
    jobId: `attachment_materialization_job:${ordinal}`,
    attemptId: `attachment_materialization_attempt:${ordinal}`,
    leaseToken: `opaque-lease-token-${ordinal}`,
    expectedJobRevision: "2",
    fileId: `file:${ordinal}`,
    expectedFileRevision: "1",
    fileVersionId: `file_version:${ordinal}`,
    objectVersionId: `file_object_version:${ordinal}`,
    storageRootId: "core:tenant-object-storage",
    storageKey: `tenants/one/files/${ordinal}`,
    claimedAt: "2026-07-19T10:00:00.000Z",
    leaseExpiresAt: "2026-07-19T10:05:00.000Z",
    sourceLocator: {
      kind: "provider",
      reference: `src_ref_${"a".repeat(43)}`
    }
  };
}

function sqlClaimWithInvalidLocator(): SqlInboxV2AttachmentMaterializationClaim {
  return {
    ...claim(1),
    attachmentId: "message_attachment:one",
    leaseGeneration: "1",
    workerId: "core:attachment-materialization-worker",
    dataClassId: "core:customer-communication",
    processingPurposeId: "core:customer-support",
    retentionAnchorAt: "2026-07-19T10:00:00.000Z",
    contentOrigin: {
      conversationId: "conversation:one",
      timelineItemId: "timeline_item:one",
      parentKind: "message",
      parentEntityId: "message:one",
      expectedParentRevision: "1",
      timelineContentId: "timeline_content:one",
      expectedContentRevision: "1",
      contentBlockKey: "attachment-1",
      expectedAttachmentRevision: "1",
      visibilityBoundary: "external_work"
    },
    sourceOccurrenceId: "source_occurrence:one",
    reservationNamespaceGeneration: "attachment-namespace-v1",
    causeEventId: "event:one",
    causeMutationId: "mutation:one",
    causeStreamCommitId: "stream_commit:one",
    causeStreamPosition: "1",
    correlationId: "correlation:one",
    causedAt: "2026-07-19T10:00:00.000Z",
    reservationAuthority: {
      commandId: "command:one",
      commandTypeId: "core:attachment.materialization.reserve",
      clientMutationId: "client-mutation-one",
      mutationId: "mutation:one",
      decisionId: "authorization_decision:one",
      epoch: "authorization-epoch-one",
      actor: {
        kind: "trusted_service",
        trustedServiceId: "trusted_service:attachment-materialization"
      },
      authorizedAt: "2026-07-19T10:00:00.000Z",
      decisionSetDigestSha256: `sha256:${"1".repeat(64)}`,
      resourceFenceSetDigestSha256: `sha256:${"2".repeat(64)}`,
      tenantRbacRevision: "1",
      sharedAccessRevision: "1",
      resourceHeadId: "authorization_resource_head:one",
      resourceAccessRevision: "1",
      structuralRelationRevision: "1",
      collaboratorSetRevision: "1",
      auditGrantSourceIds: ["authorization_decision:one"],
      auditPolicyVersion: null
    },
    sourceLocator: {
      kind: "provider",
      reference: `src_ref_${"x".repeat(43)}`
    }
  };
}

function authenticPlanner() {
  return createInboxV2SourceAttachmentReservationPlanner({
    namespaceAuthority:
      createInboxV2SourceAttachmentReservationNamespaceAuthority({
        activeGeneration: "attachment-namespace-v1",
        keys: [
          {
            generation: "attachment-namespace-v1",
            key: new Uint8Array(32).fill(7),
            activatedAt: "2026-01-01T00:00:00.000Z",
            verifyUntil: null
          }
        ],
        now: () => Date.parse("2026-07-19T10:00:00.000Z")
      }),
    storageAddressResolver: createInboxV2TenantAttachmentStorageAddressResolver(
      {
        resolve: (tenantId) => ({
          tenantId,
          storageRootId: "core:tenant-object-storage",
          keyPrefix: `tenants/${tenantId}/files/`
        })
      }
    )
  });
}

function databaseShape(): HuleeDatabase {
  return {
    execute: vi.fn(),
    transaction: vi.fn(),
    $client: {
      query: vi.fn(),
      connect: vi.fn()
    }
  } as unknown as HuleeDatabase;
}
