import type { WebConfig } from "@hulee/config";
import type {
  InternalEgressStatusResponse,
  InternalEgressProvider
} from "@hulee/contracts";
import type {
  DeploymentEgressProviderPolicyRecord,
  DeploymentEgressProviderPolicyRepository,
  UpsertDeploymentEgressProviderPolicyInput
} from "@hulee/db";
import { describe, expect, it } from "vitest";

import {
  buildProviderPolicyPersistenceInput,
  loadPlatformEgressProviderPolicies
} from "./platform-egress-policies";

describe("platform egress provider policies", () => {
  it("builds managed SaaS defaults for provider families", async () => {
    const policies = await loadPlatformEgressProviderPolicies({
      config: managedSaasConfig,
      egressStatus: readyVpnStatus,
      repository: fakePolicyRepository([])
    });

    expect(policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "telegram",
          routingMode: "vpn_namespace",
          profileId: "hulee_chat_vpn_gateway",
          source: "deployment_default",
          applyState: "current",
          directRouteWarning: false,
          supportedChannelTypes: ["telegram_bot", "telegram_qr_bridge"],
          runtimeProfile: expect.objectContaining({
            status: "ready"
          })
        }),
        expect.objectContaining({
          provider: "whatsapp",
          routingMode: "vpn_namespace",
          profileId: "hulee_chat_vpn_gateway",
          source: "deployment_default",
          applyState: "current"
        }),
        expect.objectContaining({
          provider: "max",
          routingMode: "direct",
          source: "deployment_default",
          applyState: "current"
        })
      ])
    );
  });

  it("marks stored provider overrides as pending runtime apply", async () => {
    const policies = await loadPlatformEgressProviderPolicies({
      config: managedSaasConfig,
      egressStatus: readyVpnStatus,
      repository: fakePolicyRepository([
        {
          provider: "telegram",
          routingMode: "direct",
          profileId: "deployment:direct",
          required: true,
          supportedChannelTypes: ["telegram_bot"],
          allowedProfileKinds: ["direct", "vpn_namespace"],
          updatedAt: new Date("2026-06-29T16:00:00.000Z"),
          updatedByPlatformAdminAccountId: "platform-admin-1"
        }
      ])
    });
    const telegram = policies.find((policy) => policy.provider === "telegram");

    expect(telegram).toMatchObject({
      routingMode: "direct",
      profileId: "deployment:direct",
      source: "platform_policy",
      applyState: "pending_runtime_apply",
      directRouteWarning: true,
      supportedChannelTypes: ["telegram_bot"],
      updatedAt: "2026-06-29T16:00:00.000Z",
      updatedByPlatformAdminAccountId: "platform-admin-1"
    });
  });

  it("marks stored provider overrides as current when runtime profile matches", async () => {
    const policies = await loadPlatformEgressProviderPolicies({
      config: managedSaasConfig,
      egressStatus: {
        profiles: [
          {
            profileId: "deployment:direct",
            profileKind: "direct",
            status: "ready",
            source: "runtime_probe",
            checkedAt: "2026-06-29T16:00:00.000Z"
          }
        ]
      },
      repository: fakePolicyRepository([
        {
          provider: "telegram",
          routingMode: "direct",
          profileId: "deployment:direct",
          required: true,
          supportedChannelTypes: ["telegram_bot"],
          allowedProfileKinds: ["direct", "vpn_namespace"],
          updatedAt: new Date("2026-06-29T16:00:00.000Z")
        }
      ])
    });
    const telegram = policies.find((policy) => policy.provider === "telegram");

    expect(telegram).toMatchObject({
      routingMode: "direct",
      applyState: "current",
      runtimeProfile: expect.objectContaining({
        profileKind: "direct",
        status: "ready"
      })
    });
  });

  it("persists desired provider route without provider secrets", () => {
    expect(
      buildProviderPolicyPersistenceInput({
        config: managedSaasConfig,
        provider: "whatsapp",
        routingMode: "vpn_namespace",
        updatedAt: new Date("2026-06-29T16:00:00.000Z"),
        updatedByPlatformAdminAccountId: "platform-admin-1"
      })
    ).toEqual({
      provider: "whatsapp",
      routingMode: "vpn_namespace",
      profileId: "hulee_chat_vpn_gateway",
      required: true,
      supportedChannelTypes: ["whatsapp_qr_bridge"],
      allowedProfileKinds: [
        "vpn_namespace",
        "direct",
        "http_proxy",
        "socks_proxy",
        "customer_network",
        "disabled"
      ],
      updatedAt: new Date("2026-06-29T16:00:00.000Z"),
      updatedByPlatformAdminAccountId: "platform-admin-1"
    });

    const disabled = buildProviderPolicyPersistenceInput({
      config: managedSaasConfig,
      provider: "telegram",
      routingMode: "disabled",
      updatedAt: new Date("2026-06-29T16:00:00.000Z")
    });

    expect(disabled).toMatchObject({
      profileId: "deployment:disabled",
      required: false
    });
    expect(JSON.stringify(disabled)).not.toContain("NORDVPN_TOKEN");
    expect(JSON.stringify(disabled)).not.toContain("bot-token");
  });

  it("uses customer network defaults for on-prem deployments", async () => {
    const policies = await loadPlatformEgressProviderPolicies({
      config: {
        ...managedSaasConfig,
        deploymentType: "on_prem",
        egressProfile: {
          profileId: "customer-network",
          profileKind: "customer_network",
          status: "ready"
        }
      },
      egressStatus: {
        profiles: [
          {
            profileId: "customer-network",
            profileKind: "customer_network",
            status: "ready",
            source: "deployment_config",
            checkedAt: "2026-06-29T16:00:00.000Z"
          }
        ]
      },
      repository: fakePolicyRepository([])
    });

    expect(policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "telegram",
          routingMode: "customer_network",
          profileId: "customer-network",
          directRouteWarning: false
        })
      ])
    );
  });
});

const managedSaasConfig: Pick<WebConfig, "deploymentType" | "egressProfile"> = {
  deploymentType: "saas_shared",
  egressProfile: {
    profileId: "hulee_chat_vpn_gateway",
    profileKind: "vpn_namespace",
    status: "ready"
  }
};

const readyVpnStatus: InternalEgressStatusResponse = {
  profiles: [
    {
      profileId: "hulee_chat_vpn_gateway",
      profileKind: "vpn_namespace",
      status: "ready",
      source: "runtime_probe",
      checkedAt: "2026-06-29T16:00:00.000Z"
    }
  ]
};

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
