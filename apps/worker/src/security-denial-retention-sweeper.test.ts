import {
  inboxV2BigintCounterSchema,
  inboxV2TenantIdSchema,
  type InboxV2TenantId
} from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createSecurityDenialRetentionBackgroundRunner,
  createSecurityDenialRetentionSweeper,
  type SecurityDenialRetentionRepository
} from "./security-denial-retention-sweeper";

const tenantA = tenant("tenant:security-retention-a");
const tenantB = tenant("tenant:security-retention-b");
const tenantC = tenant("tenant:security-retention-c");
const deploymentBucket = tenant(
  "tenant:system.security-denial.worker-deployment"
);
const now = new Date("2026-08-15T00:00:00.000Z");

describe("security-denial retention sweeper", () => {
  it("keyset-sweeps ordinary tenants and reserved deployment buckets with exact metrics", async () => {
    const pages: readonly (readonly InboxV2TenantId[])[] = [
      [tenantA, tenantB],
      [deploymentBucket],
      []
    ];
    let pageIndex = 0;
    const listInputs: unknown[] = [];
    const pruneInputs: unknown[] = [];
    const repository: SecurityDenialRetentionRepository = {
      async listRetentionTenants(input) {
        listInputs.push(input);
        return pages[pageIndex++] ?? [];
      },
      async prune(input) {
        pruneInputs.push(input);
        return {
          deletedWindowCount: inboxV2BigintCounterSchema.parse(
            input.tenantId === tenantA ? "64" : "2"
          )
        };
      }
    };
    const sweeper = createSecurityDenialRetentionSweeper({
      repository,
      now: () => now,
      tenantPageSize: 2,
      pruneBatchSize: 64,
      concurrency: 2,
      minimumIntervalMilliseconds: 0
    });

    await expect(sweeper.sweep()).resolves.toEqual({
      scannedTenants: 2,
      prunedTenants: 2,
      failedTenants: 0,
      saturatedPruneTenants: 1,
      deletedWindowCount: "66",
      checkpointTenantId: tenantB,
      cycleCompleted: false,
      throttled: false
    });
    await expect(sweeper.sweep()).resolves.toEqual({
      scannedTenants: 1,
      prunedTenants: 1,
      failedTenants: 0,
      saturatedPruneTenants: 0,
      deletedWindowCount: "2",
      checkpointTenantId: null,
      cycleCompleted: true,
      throttled: false
    });
    await expect(sweeper.sweep()).resolves.toEqual({
      scannedTenants: 0,
      prunedTenants: 0,
      failedTenants: 0,
      saturatedPruneTenants: 0,
      deletedWindowCount: "0",
      checkpointTenantId: null,
      cycleCompleted: true,
      throttled: false
    });

    expect(listInputs).toEqual([
      { afterTenantId: null, limit: 2 },
      { afterTenantId: tenantB, limit: 2 },
      { afterTenantId: null, limit: 2 }
    ]);
    expect(pruneInputs).toEqual([
      { tenantId: tenantA, batchSize: 64 },
      { tenantId: tenantB, batchSize: 64 },
      { tenantId: deploymentBucket, batchSize: 64 }
    ]);
  });

  it("isolates tenant failures, advances the checkpoint, and retries after wrap", async () => {
    const onTenantFailure = vi.fn(() => {
      throw new Error("telemetry unavailable");
    });
    const listInputs: Array<{ afterTenantId: InboxV2TenantId | null }> = [];
    let listCall = 0;
    let failedOnce = false;
    const repository: SecurityDenialRetentionRepository = {
      async listRetentionTenants(input) {
        listInputs.push({ afterTenantId: input.afterTenantId });
        listCall += 1;
        if (listCall === 1) return [tenantA, tenantB];
        if (listCall === 2) return [tenantC];
        return [tenantA];
      },
      async prune(input) {
        if (input.tenantId === tenantA && !failedOnce) {
          failedOnce = true;
          throw new Error("transient prune failure");
        }
        return { deletedWindowCount: inboxV2BigintCounterSchema.parse("1") };
      }
    };
    const sweeper = createSecurityDenialRetentionSweeper({
      repository,
      now: () => now,
      tenantPageSize: 2,
      concurrency: 1,
      minimumIntervalMilliseconds: 0,
      onTenantFailure
    });

    await expect(sweeper.sweep()).resolves.toMatchObject({
      scannedTenants: 2,
      prunedTenants: 1,
      failedTenants: 1,
      checkpointTenantId: tenantB,
      cycleCompleted: false
    });
    await expect(sweeper.sweep()).resolves.toMatchObject({
      scannedTenants: 1,
      prunedTenants: 1,
      failedTenants: 0,
      checkpointTenantId: null,
      cycleCompleted: true
    });
    await expect(sweeper.sweep()).resolves.toMatchObject({
      scannedTenants: 1,
      prunedTenants: 1,
      failedTenants: 0
    });

    expect(listInputs).toEqual([
      { afterTenantId: null },
      { afterTenantId: tenantB },
      { afterTenantId: null }
    ]);
    expect(onTenantFailure).toHaveBeenCalledOnce();
    expect(onTenantFailure).toHaveBeenCalledWith({
      tenantId: tenantA,
      error: expect.any(Error)
    });
  });

  it("fails one tenant closed when a repository reports more than its prune batch", async () => {
    const onTenantFailure = vi.fn();
    const sweeper = createSecurityDenialRetentionSweeper({
      repository: {
        async listRetentionTenants() {
          return [tenantA];
        },
        async prune() {
          return {
            deletedWindowCount: inboxV2BigintCounterSchema.parse("2")
          };
        }
      },
      now: () => now,
      pruneBatchSize: 1,
      onTenantFailure
    });

    await expect(sweeper.sweep()).resolves.toMatchObject({
      scannedTenants: 1,
      prunedTenants: 0,
      failedTenants: 1,
      saturatedPruneTenants: 0,
      deletedWindowCount: "0"
    });
    expect(onTenantFailure).toHaveBeenCalledWith({
      tenantId: tenantA,
      error: expect.objectContaining({
        message: "Security-denial retention prune exceeded its batch bound."
      })
    });
  });

  it("throttles completed scans without touching the repository", async () => {
    const listRetentionTenants = vi.fn(async () => []);
    const repository: SecurityDenialRetentionRepository = {
      listRetentionTenants,
      async prune() {
        return { deletedWindowCount: inboxV2BigintCounterSchema.parse("0") };
      }
    };
    const sweeper = createSecurityDenialRetentionSweeper({
      repository,
      now: () => now,
      minimumIntervalMilliseconds: 60_000
    });

    await expect(sweeper.sweep()).resolves.toMatchObject({
      throttled: false,
      cycleCompleted: true
    });
    await expect(sweeper.sweep()).resolves.toMatchObject({
      throttled: true,
      scannedTenants: 0
    });
    expect(listRetentionTenants).toHaveBeenCalledOnce();
  });

  it("rejects invalid bounds, clocks and malformed keyset pages", async () => {
    const repository: SecurityDenialRetentionRepository = {
      async listRetentionTenants() {
        return [tenantB, tenantB];
      },
      async prune() {
        return { deletedWindowCount: inboxV2BigintCounterSchema.parse("0") };
      }
    };

    expect(() =>
      createSecurityDenialRetentionSweeper({
        repository,
        tenantPageSize: 65
      })
    ).toThrow(/between 1 and 64/u);
    await expect(
      createSecurityDenialRetentionSweeper({
        repository,
        now: () => new Date(Number.NaN)
      }).sweep()
    ).rejects.toThrow(/clock is invalid/u);
    await expect(
      createSecurityDenialRetentionSweeper({
        repository,
        now: () => now
      }).sweep()
    ).rejects.toThrow(/repeats a keyset identity/u);
  });

  it("runs maintenance in one tracked background slot and drains on shutdown", async () => {
    let release: (() => void) | undefined;
    const sweep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const onResult = vi.fn(async () => {
      throw new Error("metrics unavailable");
    });
    const runner = createSecurityDenialRetentionBackgroundRunner({
      sweeper: {
        async sweep() {
          await sweep();
          return {
            scannedTenants: 0,
            prunedTenants: 0,
            failedTenants: 0,
            saturatedPruneTenants: 0,
            deletedWindowCount: inboxV2BigintCounterSchema.parse("0"),
            checkpointTenantId: null,
            cycleCompleted: true,
            throttled: false
          };
        }
      },
      onResult
    });

    runner.schedule();
    runner.schedule();
    expect(sweep).toHaveBeenCalledOnce();
    const stopping = runner.stop();
    release?.();
    await expect(stopping).resolves.toBeUndefined();
    expect(onResult).toHaveBeenCalledOnce();
  });

  it("reports a background failure and retries without the provider poll", async () => {
    const failure = new Error("retention repository unavailable");
    const sweep = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({
        scannedTenants: 0,
        prunedTenants: 0,
        failedTenants: 0,
        saturatedPruneTenants: 0,
        deletedWindowCount: inboxV2BigintCounterSchema.parse("0"),
        checkpointTenantId: null,
        cycleCompleted: true,
        throttled: false
      });
    const onFailure = vi.fn();
    const runner = createSecurityDenialRetentionBackgroundRunner({
      sweeper: { sweep },
      onFailure,
      failureRetryDelayMilliseconds: 0,
      idleDelayMilliseconds: 60_000
    });

    runner.schedule();
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(2));
    await runner.stop();

    expect(sweep).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(failure);
  });

  it("continues incomplete catalog pages independently of the provider poll", async () => {
    const complete = {
      scannedTenants: 1,
      prunedTenants: 1,
      failedTenants: 0,
      saturatedPruneTenants: 0,
      deletedWindowCount: inboxV2BigintCounterSchema.parse("0"),
      checkpointTenantId: null,
      cycleCompleted: true,
      throttled: false
    };
    const sweep = vi
      .fn()
      .mockResolvedValueOnce({
        ...complete,
        checkpointTenantId: tenantA,
        cycleCompleted: false
      })
      .mockResolvedValueOnce(complete);
    const runner = createSecurityDenialRetentionBackgroundRunner({
      sweeper: { sweep },
      continuationDelayMilliseconds: 0,
      idleDelayMilliseconds: 60_000
    });

    runner.schedule();
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(2));
    await runner.stop();
  });

  it("cancels a pending continuation before shutdown closes the database", async () => {
    const sweep = vi.fn(async () => ({
      scannedTenants: 1,
      prunedTenants: 1,
      failedTenants: 0,
      saturatedPruneTenants: 0,
      deletedWindowCount: inboxV2BigintCounterSchema.parse("0"),
      checkpointTenantId: tenantA,
      cycleCompleted: false,
      throttled: false
    }));
    const runner = createSecurityDenialRetentionBackgroundRunner({
      sweeper: { sweep },
      continuationDelayMilliseconds: 1_000,
      idleDelayMilliseconds: 60_000
    });

    runner.schedule();
    await runner.drain();
    await runner.stop();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sweep).toHaveBeenCalledOnce();
  });

  it("starts a new idle cycle without depending on provider work", async () => {
    const sweep = vi.fn(async () => ({
      scannedTenants: 0,
      prunedTenants: 0,
      failedTenants: 0,
      saturatedPruneTenants: 0,
      deletedWindowCount: inboxV2BigintCounterSchema.parse("0"),
      checkpointTenantId: null,
      cycleCompleted: true,
      throttled: false
    }));
    const runner = createSecurityDenialRetentionBackgroundRunner({
      sweeper: { sweep },
      idleDelayMilliseconds: 0
    });

    runner.schedule();
    await vi.waitFor(() => expect(sweep.mock.calls.length).toBeGreaterThan(1));
    await runner.stop();
  });
});

function tenant(value: string): InboxV2TenantId {
  return inboxV2TenantIdSchema.parse(value);
}
