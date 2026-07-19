import { inboxV2SourceBackpressurePolicySchema } from "@hulee/contracts";
import type { HuleeDatabase } from "@hulee/db";
import {
  createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer,
  createSqlInboxV2SourceAttachmentMaterializationRepository,
  createSqlInboxV2SourceAttachmentReservationCommandPort
} from "@hulee/db/internal/attachment-materialization";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  createInboxV2SourceNormalizationDurabilityCapability,
  createInboxV2SourceProcessingCompositeDurabilityCapabilitySet,
  createInboxV2SourceProcessingProductionActivation,
  createInboxV2TrustedSourceProcessingCompositeTransaction,
  createWorkerInboxV2SourceProcessingDatabaseClock,
  createWorkerInboxV2SourceProcessingRuntimeCoordinator,
  type WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions
} from "./index";
import type { InboxV2SourceProcessingProductionActivation } from "./source-processing-production-activation";
import {
  createInboxV2SourceAttachmentMaterializationHandler,
  createInboxV2SourceAttachmentReservationNamespaceAuthority,
  createInboxV2SourceAttachmentReservationPlanner,
  createInboxV2TenantAttachmentStorageAddressResolver
} from "./source-attachment-materialization-handler";
import { createInboxV2SourceAttachmentMaterializationDurabilityCapability } from "./source-processing-production-activation";

const policy = inboxV2SourceBackpressurePolicySchema.parse({
  maxClaimBatch: 4,
  maxInFlightPerTenant: 4,
  maxInFlightPerConnection: 3,
  maxInFlightPerAccount: 2,
  maxQueuedPerTenant: 100,
  maxQueuedPerConnection: 50,
  maxQueuedPerAccount: 20,
  maxAttempts: 3,
  baseRetryDelaySeconds: 10,
  maxRetryDelaySeconds: 300,
  jitterBasisPoints: 0
});

describe("worker Inbox V2 source-processing runtime factory", () => {
  it("excludes a caller-controlled host clock from production options", () => {
    expectTypeOf<
      "clock" extends keyof WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions
        ? true
        : false
    >().toEqualTypeOf<false>();
  });

  it("excludes structural handler maps and requires an opaque activation token", () => {
    expectTypeOf<
      "handlers" extends keyof WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions
        ? true
        : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "activation" extends keyof WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions
        ? true
        : false
    >().toEqualTypeOf<true>();
  });

  it("reads and canonicalizes the PostgreSQL authoritative clock", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ db_now: new Date("2026-07-17T10:00:01.987Z") }]
    });
    const clock = createWorkerInboxV2SourceProcessingDatabaseClock({
      $client: { query }
    } as unknown as HuleeDatabase);

    await expect(clock.now()).resolves.toBe("2026-07-17T10:00:01.987Z");
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith("select clock_timestamp() as db_now");
    expect(Object.isFrozen(clock)).toBe(true);
  });

  it.each([
    ["missing row", []],
    ["null timestamp", [{ db_now: null }]],
    ["invalid timestamp", [{ db_now: "not-a-timestamp" }]],
    ["invalid Date", [{ db_now: new Date(Number.NaN) }]]
  ])("fails closed for a %s from PostgreSQL", async (_label, rows) => {
    const clock = createWorkerInboxV2SourceProcessingDatabaseClock({
      $client: { query: vi.fn().mockResolvedValue({ rows }) }
    } as unknown as HuleeDatabase);

    await expect(clock.now()).rejects.toThrow(
      /PostgreSQL source-processing clock returned an invalid timestamp/u
    );
  });

  it("keeps production blocked when durable stage activation is untrusted", () => {
    expect(() =>
      createWorkerInboxV2SourceProcessingRuntimeCoordinator(options())
    ).toThrow(/trusted durable activation capability/u);
  });

  it("constructs the production worker from one complete process-authentic stage composition", () => {
    const complete = options();
    const normalizationCapability =
      createInboxV2SourceNormalizationDurabilityCapability({
        process: vi.fn()
      });
    const compositeCapabilitySet =
      createInboxV2SourceProcessingCompositeDurabilityCapabilitySet(
        createInboxV2TrustedSourceProcessingCompositeTransaction({
          processTransactionLocally: vi.fn(async () => ({
            kind: "processed" as const
          }))
        })
      );
    const activation = createInboxV2SourceProcessingProductionActivation({
      normalizationCapability,
      materializationCapability: createMaterializationCapability(),
      compositeCapabilitySet
    });

    const coordinator = createWorkerInboxV2SourceProcessingRuntimeCoordinator({
      ...complete,
      activation
    });

    expect(coordinator.runOnce).toBeTypeOf("function");
    expect(coordinator.requestReplay).toBeTypeOf("function");
    expect(Object.isFrozen(coordinator)).toBe(true);
  });

  it.each([
    "database",
    "replayAuthorization",
    "cryptographicAuthority",
    "deadLetterLifecycleResolver",
    "rawAdmissionPreflight",
    "terminalOutcomeSealer",
    "terminalLifecycleResolver",
    "leaseTokenSource",
    "attemptIdSource",
    "replayEpisodeIdSource"
  ] as const)("fails closed when %s is absent", (capability) => {
    const incomplete = {
      ...options(),
      [capability]: undefined
    } as unknown as WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions;

    expect(() =>
      createWorkerInboxV2SourceProcessingRuntimeCoordinator(incomplete)
    ).toThrow(/requires database.*terminal dedupe.*lease identity/u);
  });

  it("fails closed when the PostgreSQL clock query capability is absent", () => {
    const complete = options();
    const incomplete = {
      ...complete,
      database: {
        execute: complete.database.execute,
        transaction: complete.database.transaction,
        $client: {}
      }
    } as unknown as WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions;

    expect(() =>
      createWorkerInboxV2SourceProcessingRuntimeCoordinator(incomplete)
    ).toThrow(/requires database.*terminal dedupe.*lease identity/u);
  });

  it("fails closed when the cryptographic authority is only partially implemented", () => {
    const complete = options();
    const incomplete = {
      ...complete,
      cryptographicAuthority: {
        ...complete.cryptographicAuthority,
        deriveDedupeIdentityCandidates: undefined
      }
    } as unknown as WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions;

    expect(() =>
      createWorkerInboxV2SourceProcessingRuntimeCoordinator(incomplete)
    ).toThrow(/cryptographic/u);
  });

  it("rejects invalid retention and diagnostic capabilities during composition", () => {
    expect(() =>
      createWorkerInboxV2SourceProcessingRuntimeCoordinator({
        ...options(),
        retentionPolicy: {
          attemptRetentionSeconds: 0,
          replayRequestRetentionSeconds: 86_400
        }
      })
    ).toThrow();

    expect(() =>
      createWorkerInboxV2SourceProcessingRuntimeCoordinator({
        ...options(),
        retentionPolicy: {
          attemptRetentionSeconds: 86_400,
          replayRequestRetentionSeconds: 0
        }
      })
    ).toThrow();

    expect(() =>
      createWorkerInboxV2SourceProcessingRuntimeCoordinator({
        ...options(),
        diagnosticClassifier: undefined
      } as unknown as WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions)
    ).toThrow(/key-safe diagnostics/u);
  });
});

function createMaterializationCapability() {
  const database = {
    execute: vi.fn(),
    transaction: vi.fn(async (work: (transaction: unknown) => unknown) =>
      work(database)
    )
  };
  const namespaceAuthority =
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
      now: () => Date.parse("2026-07-19T00:00:00.000Z")
    });
  return createInboxV2SourceAttachmentMaterializationDurabilityCapability(
    createInboxV2SourceAttachmentMaterializationHandler({
      repository: createSqlInboxV2SourceAttachmentMaterializationRepository(
        database as never
      ),
      reservationCommands:
        createSqlInboxV2SourceAttachmentReservationCommandPort(
          database as never,
          createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer(
            database as never,
            { trustedServiceId: "core:source-runtime" }
          )
        ),
      reservationPlanner: createInboxV2SourceAttachmentReservationPlanner({
        namespaceAuthority,
        storageAddressResolver:
          createInboxV2TenantAttachmentStorageAddressResolver({
            resolve: (tenantId) => ({
              tenantId,
              storageRootId: "core:tenant-object-storage",
              keyPrefix: `tenants/${tenantId}/files/`
            })
          })
      })
    })
  );
}

function options(): WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions {
  return {
    database: {
      execute: vi.fn(),
      transaction: vi.fn(),
      $client: { query: vi.fn() }
    } as unknown as HuleeDatabase,
    activation: {} as InboxV2SourceProcessingProductionActivation,
    replayAuthorization: {
      authorizeReplay: vi.fn()
    },
    cryptographicAuthority: {
      protectCursor: vi.fn(),
      resolveCursor: vi.fn(),
      verifyDedupeSkeleton: vi.fn(),
      deriveDedupeIdentityCandidates: vi.fn()
    },
    retentionPolicy: {
      attemptRetentionSeconds: 86_400,
      replayRequestRetentionSeconds: 86_400
    },
    deadLetterLifecycleResolver: vi.fn(),
    rawAdmissionPreflight: {
      loadPendingDedupeAdmission: vi.fn()
    },
    terminalOutcomeSealer: {
      sealTerminalDedupeOutcome: vi.fn()
    },
    terminalLifecycleResolver: {
      resolveTerminalDedupeLifecycle: vi.fn()
    },
    leaseTokenSource: (count) =>
      Array.from(
        { length: count },
        (_, index) => `source-processing-${index}-${"a".repeat(32)}`
      ),
    attemptIdSource: (count) =>
      Array.from(
        { length: count },
        (_, index) => `source-attempt:factory-${index}`
      ),
    replayEpisodeIdSource: () => "replay-episode:factory-test",
    diagnosticClassifier: { classify: vi.fn() },
    policy,
    workerId: "core:source-processing-worker",
    leaseDurationSeconds: 30,
    deadLetterIdSource: () => "source-dlq:factory-test"
  };
}
