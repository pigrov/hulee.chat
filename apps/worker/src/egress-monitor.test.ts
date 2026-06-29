import { describe, expect, it, vi } from "vitest";
import type { WorkerConfig } from "@hulee/config";
import type {
  DeploymentEgressStatusRepository,
  DeploymentEgressStatusSnapshot
} from "@hulee/db";

import {
  createWorkerEgressMonitor,
  shouldRunEgressMonitor
} from "./egress-monitor";

const baseConfig = {
  workerFeatures: ["telegram_bot"],
  egressProbesEnabled: true,
  egressProbeIntervalMs: 30_000,
  egressProbeTimeoutMs: 1_000,
  egressProfile: {
    profileId: "hulee_chat_vpn_gateway",
    profileKind: "vpn_namespace",
    status: "ready"
  }
} satisfies Pick<
  WorkerConfig,
  | "workerFeatures"
  | "egressProbesEnabled"
  | "egressProbeIntervalMs"
  | "egressProbeTimeoutMs"
  | "egressProfile"
>;

describe("worker egress monitor", () => {
  it("writes ready runtime snapshots when all probes pass", async () => {
    const repository = new RecordingEgressStatusRepository();
    const monitor = createWorkerEgressMonitor({
      config: baseConfig,
      repository,
      now: () => new Date("2026-06-29T10:00:00.000Z"),
      workerId: "worker-1",
      lookupImpl: vi.fn(async () => ({ address: "149.154.167.99", family: 4 })),
      fetchImpl: vi.fn(async (target) => {
        const url = String(target);
        const status = url.includes("generate_204") ? 204 : 200;

        return new Response(
          status === 204 || !url.includes("ipify") ? null : "178.212.32.166",
          { status }
        );
      })
    });

    await expect(monitor.runOnce()).resolves.toMatchObject({
      profileId: "hulee_chat_vpn_gateway",
      status: "ready",
      alertSeverity: "none",
      consecutiveFailures: 0,
      publicIp: "178.212.32.166"
    });
    expect(repository.snapshots).toHaveLength(1);
    expect(repository.snapshots[0]?.probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "dns.telegram",
          status: "success"
        }),
        expect.objectContaining({
          name: "public_ip",
          status: "success"
        })
      ])
    );
  });

  it("marks snapshots degraded and emits alerts when a probe fails", async () => {
    const repository = new RecordingEgressStatusRepository();
    const monitor = createWorkerEgressMonitor({
      config: baseConfig,
      repository,
      now: () => new Date("2026-06-29T10:00:00.000Z"),
      workerId: "worker-1",
      lookupImpl: vi.fn(async () => ({ address: "149.154.167.99", family: 4 })),
      fetchImpl: vi.fn(async (target) => {
        const url = String(target);

        if (url.includes("web.whatsapp.com")) {
          throw new Error("Network unreachable");
        }

        const status = url.includes("generate_204") ? 204 : 200;

        return new Response(
          status === 204 || !url.includes("ipify") ? null : "178.212.32.166",
          { status }
        );
      })
    });

    await expect(monitor.runOnce()).resolves.toMatchObject({
      status: "degraded",
      alertSeverity: "warning",
      consecutiveFailures: 1,
      lastErrorCode: "provider.temporary_failure",
      alerts: [
        expect.objectContaining({
          code: "egress.probe_failed",
          severity: "warning"
        })
      ]
    });
  });

  it("does not run on a regular core-only worker", () => {
    expect(
      shouldRunEgressMonitor({
        ...baseConfig,
        workerFeatures: ["core"]
      })
    ).toBe(false);
  });
});

class RecordingEgressStatusRepository implements DeploymentEgressStatusRepository {
  readonly snapshots: DeploymentEgressStatusSnapshot[] = [];

  async listLatestSnapshots(): Promise<DeploymentEgressStatusSnapshot[]> {
    return this.snapshots;
  }

  async upsertSnapshot(input: DeploymentEgressStatusSnapshot): Promise<void> {
    this.snapshots.push(input);
  }
}
