import { describe, expect, it } from "vitest";

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
