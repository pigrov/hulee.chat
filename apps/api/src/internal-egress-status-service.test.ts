import { describe, expect, it } from "vitest";
import type {
  DeploymentEgressStatusRepository,
  DeploymentEgressStatusSnapshot
} from "@hulee/db";

import { createInternalEgressStatusService } from "./internal-egress-status-service";

describe("internal egress status service", () => {
  it("returns safe deployment egress profile status", async () => {
    const service = createInternalEgressStatusService({
      now: () => new Date("2026-06-29T10:00:00.000Z"),
      profiles: [
        {
          profileId: " managed-messenger-vpn ",
          profileKind: "vpn_namespace",
          status: "degraded",
          lastErrorCode: "provider.temporary_failure",
          operatorHint: "WireGuard tunnel is not ready.",
          supportedProviders: ["telegram", " whatsapp ", ""],
          supportedChannelTypes: ["telegram_bot", "whatsapp_qr_bridge"]
        }
      ]
    });

    await expect(
      service.loadEgressStatus({
        requestId: "request-1",
        tenantId: "tenant-1" as never,
        employeeId: "employee-1" as never
      })
    ).resolves.toEqual({
      profiles: [
        {
          profileId: "managed-messenger-vpn",
          profileKind: "vpn_namespace",
          status: "degraded",
          source: "deployment_config",
          checkedAt: "2026-06-29T10:00:00.000Z",
          lastErrorCode: "provider.temporary_failure",
          operatorHint: "WireGuard tunnel is not ready.",
          supportedProviders: ["telegram", "whatsapp"],
          supportedChannelTypes: ["telegram_bot", "whatsapp_qr_bridge"]
        }
      ]
    });
  });

  it("returns fresh runtime probe snapshots over deployment config", async () => {
    const service = createInternalEgressStatusService({
      now: () => new Date("2026-06-29T10:00:20.000Z"),
      profiles: [
        {
          profileId: "managed-messenger-vpn",
          profileKind: "vpn_namespace",
          status: "ready",
          supportedProviders: ["telegram"],
          supportedChannelTypes: ["telegram_bot"]
        }
      ],
      snapshotRepository: new StaticSnapshotRepository([
        {
          profileId: "managed-messenger-vpn",
          profileKind: "vpn_namespace",
          status: "degraded",
          checkedAt: new Date("2026-06-29T10:00:00.000Z"),
          lastReadyAt: new Date("2026-06-29T09:59:00.000Z"),
          lastFailureAt: new Date("2026-06-29T10:00:00.000Z"),
          consecutiveFailures: 2,
          alertSeverity: "warning",
          lastErrorCode: "provider.temporary_failure",
          operatorHint: "One or more provider egress probes failed.",
          publicIp: "178.212.32.166",
          probes: [
            {
              name: "https.whatsapp",
              target: "https://web.whatsapp.com",
              status: "failed",
              checkedAt: "2026-06-29T10:00:00.000Z",
              latencyMs: 100,
              errorCode: "egress.Error",
              errorMessage: "Network unreachable"
            }
          ],
          alerts: [
            {
              severity: "warning",
              code: "egress.probe_failed",
              message: "Failed probes: https.whatsapp."
            }
          ],
          workerId: "worker-1"
        }
      ])
    });

    await expect(
      service.loadEgressStatus({
        requestId: "request-1",
        tenantId: "tenant-1" as never,
        employeeId: "employee-1" as never
      })
    ).resolves.toEqual({
      profiles: [
        expect.objectContaining({
          profileId: "managed-messenger-vpn",
          source: "runtime_probe",
          status: "degraded",
          alertSeverity: "warning",
          consecutiveFailures: 2,
          publicIp: "178.212.32.166",
          supportedProviders: ["telegram"],
          supportedChannelTypes: ["telegram_bot"],
          probes: [
            expect.objectContaining({
              name: "https.whatsapp",
              status: "failed"
            })
          ],
          alerts: [
            expect.objectContaining({
              code: "egress.probe_failed"
            })
          ]
        })
      ]
    });
  });

  it("marks stale runtime snapshots degraded", async () => {
    const service = createInternalEgressStatusService({
      now: () => new Date("2026-06-29T10:03:00.000Z"),
      snapshotStaleAfterMs: 60_000,
      profiles: [
        {
          profileId: "managed-messenger-vpn",
          profileKind: "vpn_namespace",
          status: "ready"
        }
      ],
      snapshotRepository: new StaticSnapshotRepository([
        {
          profileId: "managed-messenger-vpn",
          profileKind: "vpn_namespace",
          status: "ready",
          checkedAt: new Date("2026-06-29T10:00:00.000Z"),
          lastReadyAt: new Date("2026-06-29T10:00:00.000Z"),
          consecutiveFailures: 0,
          alertSeverity: "none",
          probes: [],
          alerts: []
        }
      ])
    });

    await expect(
      service.loadEgressStatus({
        requestId: "request-1",
        tenantId: "tenant-1" as never,
        employeeId: "employee-1" as never
      })
    ).resolves.toEqual({
      profiles: [
        expect.objectContaining({
          status: "degraded",
          alertSeverity: "warning",
          alerts: [
            expect.objectContaining({
              code: "egress.probe_stale"
            })
          ],
          operatorHint:
            "Provider egress probes are stale; provider worker may be stopped."
        })
      ]
    });
  });

  it("returns an empty profile list when egress is not configured", async () => {
    const service = createInternalEgressStatusService();

    await expect(
      service.loadEgressStatus({
        requestId: "request-1",
        tenantId: "tenant-1" as never,
        employeeId: "employee-1" as never
      })
    ).resolves.toEqual({
      profiles: []
    });
  });
});

class StaticSnapshotRepository implements DeploymentEgressStatusRepository {
  constructor(private readonly snapshots: DeploymentEgressStatusSnapshot[]) {}

  async listLatestSnapshots(): Promise<DeploymentEgressStatusSnapshot[]> {
    return this.snapshots;
  }

  async upsertSnapshot(): Promise<void> {
    throw new Error("Not implemented in this test.");
  }
}
