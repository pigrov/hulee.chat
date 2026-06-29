import type { TenantId } from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createDeploymentEgressRuntime,
  createPassthroughEgressRuntime,
  createStaticEgressRuntimeRegistry,
  EgressRuntimeError,
  managedMessengerVpnEgressRequirement
} from "./egress";

describe("egress runtime", () => {
  it("resolves managed messenger VPN requirements without hardcoding a provider", async () => {
    const runtime = createPassthroughEgressRuntime({
      profileIdFactory: ({ provider, channelType }) =>
        `${provider}:${channelType}:default`
    });

    await expect(
      runtime.resolveProfile({
        tenantId: "tenant-1" as TenantId,
        connectorId: "telegram_bot:tenant-1",
        channelType: "telegram_bot",
        provider: "telegram",
        requirement: managedMessengerVpnEgressRequirement,
        checkedAt: "2026-06-22T10:00:00.000Z"
      })
    ).resolves.toEqual({
      profileKind: "vpn_namespace",
      profileId: "telegram:telegram_bot:default",
      diagnostics: {
        required: true,
        status: "unknown",
        profileKind: "vpn_namespace",
        profileId: "telegram:telegram_bot:default",
        checkedAt: "2026-06-22T10:00:00.000Z"
      }
    });
  });

  it("executes operations through the passthrough runtime boundary", async () => {
    const runtime = createPassthroughEgressRuntime();
    const resolution = await runtime.resolveProfile({
      tenantId: "tenant-1" as TenantId,
      connectorId: "telegram_bot:tenant-1",
      channelType: "telegram_bot",
      provider: "telegram",
      requirement: managedMessengerVpnEgressRequirement,
      checkedAt: "2026-06-22T10:00:00.000Z"
    });
    const operation = vi.fn(async () => "ok");

    await expect(
      runtime.execute(
        {
          tenantId: "tenant-1" as TenantId,
          connectorId: "telegram_bot:tenant-1",
          channelType: "telegram_bot",
          provider: "telegram",
          operation: "telegram.bot_api.getMe",
          resolution
        },
        operation
      )
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("uses a registered runtime before falling back to passthrough", () => {
    const directRuntime = createPassthroughEgressRuntime();
    const vpnRuntime = createPassthroughEgressRuntime();
    const registry = createStaticEgressRuntimeRegistry({
      fallbackRuntime: directRuntime,
      runtimes: {
        vpn_namespace: vpnRuntime
      }
    });

    expect(registry.getRuntime("vpn_namespace")).toBe(vpnRuntime);
    expect(registry.getRuntime("direct")).toBe(directRuntime);
  });

  it("resolves deployment profiles with diagnostics and provider filters", async () => {
    const runtime = createDeploymentEgressRuntime({
      profiles: [
        {
          profileId: "deployment:direct",
          profileKind: "direct",
          status: "ready",
          supportedProviders: ["vk"]
        },
        {
          profileId: "deployment:telegram-whatsapp:vpn",
          profileKind: "vpn_namespace",
          status: "ready",
          supportedProviders: ["telegram", "whatsapp"]
        }
      ]
    });

    await expect(
      runtime.resolveProfile({
        tenantId: "tenant-1" as TenantId,
        connectorId: "telegram_bot:tenant-1",
        channelType: "telegram_bot",
        provider: "telegram",
        requirement: managedMessengerVpnEgressRequirement,
        checkedAt: "2026-06-22T10:00:00.000Z"
      })
    ).resolves.toEqual({
      profileKind: "vpn_namespace",
      profileId: "deployment:telegram-whatsapp:vpn",
      diagnostics: {
        required: true,
        status: "ready",
        profileKind: "vpn_namespace",
        profileId: "deployment:telegram-whatsapp:vpn",
        checkedAt: "2026-06-22T10:00:00.000Z"
      }
    });
  });

  it("fails required deployment egress when the selected profile is not ready", async () => {
    const runtime = createDeploymentEgressRuntime({
      profiles: [
        {
          profileId: "deployment:telegram-whatsapp:vpn",
          profileKind: "vpn_namespace",
          status: "misconfigured",
          lastErrorCode: "validation.failed",
          operatorHint: "VPN gateway is not configured."
        }
      ]
    });
    const resolution = await runtime.resolveProfile({
      tenantId: "tenant-1" as TenantId,
      connectorId: "telegram_bot:tenant-1",
      channelType: "telegram_bot",
      provider: "telegram",
      requirement: managedMessengerVpnEgressRequirement,
      checkedAt: "2026-06-22T10:00:00.000Z"
    });
    const operation = vi.fn(async () => "not-called");

    await expect(
      runtime.execute(
        {
          tenantId: "tenant-1" as TenantId,
          connectorId: "telegram_bot:tenant-1",
          channelType: "telegram_bot",
          provider: "telegram",
          operation: "telegram.bot_api.getMe",
          resolution
        },
        operation
      )
    ).rejects.toMatchObject({
      code: "validation.failed",
      name: "EgressRuntimeError"
    } satisfies Pick<EgressRuntimeError, "code" | "name">);
    expect(operation).not.toHaveBeenCalled();
  });

  it("reports a misconfigured profile when no deployment profile matches", async () => {
    const runtime = createDeploymentEgressRuntime({
      profiles: []
    });

    await expect(
      runtime.resolveProfile({
        tenantId: "tenant-1" as TenantId,
        connectorId: "telegram_bot:tenant-1",
        channelType: "telegram_bot",
        provider: "telegram",
        requirement: managedMessengerVpnEgressRequirement,
        checkedAt: "2026-06-22T10:00:00.000Z"
      })
    ).resolves.toMatchObject({
      profileKind: "vpn_namespace",
      diagnostics: {
        required: true,
        status: "misconfigured",
        lastErrorCode: "validation.failed"
      }
    });
  });

  it("fails disabled egress profiles before provider calls", async () => {
    const runtime = createPassthroughEgressRuntime();
    const resolution = await runtime.resolveProfile({
      tenantId: "tenant-1" as TenantId,
      connectorId: "telegram_bot:tenant-1",
      channelType: "telegram_bot",
      provider: "telegram",
      requirement: {
        required: true,
        defaultProfileKind: "disabled",
        allowedProfileKinds: ["disabled"],
        enforcementScope: "deployment_policy"
      },
      checkedAt: "2026-06-22T10:00:00.000Z"
    });
    const operation = vi.fn(async () => "not-called");

    await expect(
      runtime.execute(
        {
          tenantId: "tenant-1" as TenantId,
          connectorId: "telegram_bot:tenant-1",
          channelType: "telegram_bot",
          provider: "telegram",
          operation: "telegram.bot_api.getMe",
          resolution
        },
        operation
      )
    ).rejects.toMatchObject({
      code: "provider.temporary_failure",
      name: "EgressRuntimeError"
    } satisfies Pick<EgressRuntimeError, "code" | "name">);
    expect(operation).not.toHaveBeenCalled();
  });
});
