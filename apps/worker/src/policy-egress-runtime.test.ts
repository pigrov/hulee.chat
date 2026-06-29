import type { InternalEgressProvider, TenantId } from "@hulee/contracts";
import type {
  DeploymentEgressProviderPolicyRecord,
  DeploymentEgressProviderPolicyRepository,
  UpsertDeploymentEgressProviderPolicyInput
} from "@hulee/db";
import {
  EgressRuntimeError,
  managedMessengerVpnEgressRequirement,
  type DeploymentEgressProfile,
  type EgressProfileResolution,
  type EgressRuntime
} from "@hulee/modules";
import { describe, expect, it, vi } from "vitest";

import { createPolicyAwareDeploymentEgressRuntime } from "./policy-egress-runtime";

const tenantId = "tenant-policy-egress" as TenantId;
const checkedAt = "2026-06-29T16:00:00.000Z";
const vpnProfile: DeploymentEgressProfile = {
  profileId: "hulee_chat_vpn_gateway",
  profileKind: "vpn_namespace",
  status: "ready",
  supportedProviders: ["telegram", "whatsapp"],
  supportedChannelTypes: ["telegram_bot", "whatsapp_qr_bridge"]
};

describe("policy-aware deployment egress runtime", () => {
  it("falls back to deployment profile resolution when provider has no stored policy", async () => {
    const runtime = createRuntime([]);

    await expect(resolveTelegram(runtime)).resolves.toEqual({
      profileKind: "vpn_namespace",
      profileId: "hulee_chat_vpn_gateway",
      diagnostics: {
        required: true,
        status: "ready",
        profileKind: "vpn_namespace",
        profileId: "hulee_chat_vpn_gateway",
        checkedAt
      }
    });
  });

  it("uses a stored provider policy when it matches the applied worker profile", async () => {
    const runtime = createRuntime([
      createPolicy({
        provider: "telegram",
        routingMode: "vpn_namespace",
        profileId: "hulee_chat_vpn_gateway"
      })
    ]);
    const resolution = await resolveTelegram(runtime);
    const operation = vi.fn(async () => "ok");

    await expect(
      runtime.execute(createOperationInput(resolution), operation)
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledOnce();
    expect(resolution).toMatchObject({
      profileKind: "vpn_namespace",
      profileId: "hulee_chat_vpn_gateway",
      diagnostics: {
        status: "ready"
      }
    });
  });

  it("blocks provider calls when policy requires a profile that is not applied to this worker", async () => {
    const runtime = createRuntime([
      createPolicy({
        provider: "telegram",
        routingMode: "direct",
        profileId: "deployment:direct"
      })
    ]);
    const resolution = await resolveTelegram(runtime);
    const operation = vi.fn(async () => "not-called");

    expect(resolution).toMatchObject({
      profileKind: "direct",
      profileId: "deployment:direct",
      diagnostics: {
        required: true,
        status: "misconfigured",
        lastErrorCode: "validation.failed"
      }
    });
    expect(resolution.diagnostics.operatorHint).toContain(
      "Restart or redeploy the provider worker"
    );

    await expect(
      runtime.execute(createOperationInput(resolution), operation)
    ).rejects.toMatchObject({
      code: "validation.failed",
      name: "EgressRuntimeError"
    } satisfies Pick<EgressRuntimeError, "code" | "name">);
    expect(operation).not.toHaveBeenCalled();
  });

  it("blocks provider calls when provider policy disables the route", async () => {
    const runtime = createRuntime([
      createPolicy({
        provider: "telegram",
        routingMode: "disabled",
        profileId: "deployment:disabled",
        required: false
      })
    ]);
    const resolution = await resolveTelegram(runtime);
    const operation = vi.fn(async () => "not-called");

    expect(resolution).toMatchObject({
      profileKind: "disabled",
      profileId: "deployment:disabled",
      diagnostics: {
        required: false,
        status: "unavailable",
        lastErrorCode: "module.disabled"
      }
    });

    await expect(
      runtime.execute(createOperationInput(resolution), operation)
    ).rejects.toMatchObject({
      code: "module.disabled",
      name: "EgressRuntimeError"
    } satisfies Pick<EgressRuntimeError, "code" | "name">);
    expect(operation).not.toHaveBeenCalled();
  });

  it("ignores a provider policy that does not target the connector channel type", async () => {
    const runtime = createRuntime([
      createPolicy({
        provider: "telegram",
        routingMode: "direct",
        profileId: "deployment:direct",
        supportedChannelTypes: ["telegram_qr_bridge"]
      })
    ]);

    await expect(resolveTelegram(runtime)).resolves.toMatchObject({
      profileKind: "vpn_namespace",
      profileId: "hulee_chat_vpn_gateway",
      diagnostics: {
        status: "ready"
      }
    });
  });
});

function createRuntime(
  policies: readonly DeploymentEgressProviderPolicyRecord[],
  deploymentProfile: DeploymentEgressProfile = vpnProfile
): EgressRuntime {
  return createPolicyAwareDeploymentEgressRuntime({
    deploymentProfile,
    policyRepository: fakePolicyRepository(policies)
  });
}

function resolveTelegram(runtime: EgressRuntime) {
  return runtime.resolveProfile({
    tenantId,
    connectorId: "telegram_bot:policy-egress",
    channelType: "telegram_bot",
    provider: "telegram",
    requirement: managedMessengerVpnEgressRequirement,
    checkedAt
  });
}

function createOperationInput(resolution: EgressProfileResolution) {
  return {
    tenantId,
    connectorId: "telegram_bot:policy-egress",
    channelType: "telegram_bot",
    provider: "telegram",
    operation: "telegram.bot_api.getMe",
    resolution
  };
}

function createPolicy(
  override: Partial<DeploymentEgressProviderPolicyRecord> & {
    provider: InternalEgressProvider;
  }
): DeploymentEgressProviderPolicyRecord {
  return {
    provider: override.provider,
    routingMode: override.routingMode ?? "vpn_namespace",
    profileId: override.profileId ?? "hulee_chat_vpn_gateway",
    required: override.required ?? true,
    supportedChannelTypes: override.supportedChannelTypes ?? ["telegram_bot"],
    allowedProfileKinds: override.allowedProfileKinds ?? [
      "vpn_namespace",
      "direct",
      "http_proxy",
      "socks_proxy",
      "customer_network",
      "disabled"
    ],
    updatedAt: override.updatedAt ?? new Date("2026-06-29T16:00:00.000Z"),
    ...(override.updatedByPlatformAdminAccountId
      ? {
          updatedByPlatformAdminAccountId:
            override.updatedByPlatformAdminAccountId
        }
      : {})
  };
}

function fakePolicyRepository(
  policies: readonly DeploymentEgressProviderPolicyRecord[]
): DeploymentEgressProviderPolicyRepository {
  return {
    async listPolicies() {
      return [...policies];
    },
    async findPolicy(provider: InternalEgressProvider) {
      return policies.find((policy) => policy.provider === provider) ?? null;
    },
    async upsertPolicy(_input: UpsertDeploymentEgressProviderPolicyInput) {
      return undefined;
    }
  };
}
