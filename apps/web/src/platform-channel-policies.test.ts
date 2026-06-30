import type { WebConfig } from "@hulee/config";
import type {
  DeploymentChannelProviderPolicyRecord,
  DeploymentChannelProviderPolicyRepository,
  UpsertDeploymentChannelProviderPolicyInput
} from "@hulee/db";
import { describe, expect, it } from "vitest";

import {
  buildChannelProviderPolicyPersistenceInput,
  loadPlatformChannelProviderPolicies,
  loadTelegramBotChannelProviderPolicy
} from "./platform-channel-policies";

describe("platform channel provider policies", () => {
  it("uses polling and outbound defaults for managed SaaS Telegram Bot", async () => {
    const telegram = await loadTelegramBotChannelProviderPolicy({
      config: managedSaasConfig,
      repository: fakePolicyRepository([])
    });

    expect(telegram).toMatchObject({
      provider: "telegram",
      channelType: "telegram_bot",
      inboundMode: "polling",
      outboundEnabled: true,
      source: "deployment_default",
      supportedInboundModes: ["polling", "webhook"]
    });
  });

  it("uses webhook defaults for on-prem Telegram Bot", async () => {
    const telegram = await loadTelegramBotChannelProviderPolicy({
      config: {
        deploymentType: "on_prem"
      },
      repository: fakePolicyRepository([])
    });

    expect(telegram).toMatchObject({
      inboundMode: "webhook",
      outboundEnabled: true
    });
  });

  it("maps stored platform policy overrides", async () => {
    const policies = await loadPlatformChannelProviderPolicies({
      config: managedSaasConfig,
      repository: fakePolicyRepository([
        {
          provider: "telegram",
          channelType: "telegram_bot",
          inboundMode: "webhook",
          outboundEnabled: false,
          updatedAt: new Date("2026-06-30T12:00:00.000Z"),
          updatedByPlatformAdminAccountId: "platform-admin-1"
        }
      ])
    });

    expect(policies).toEqual([
      expect.objectContaining({
        provider: "telegram",
        channelType: "telegram_bot",
        inboundMode: "webhook",
        outboundEnabled: false,
        source: "platform_policy",
        updatedAt: "2026-06-30T12:00:00.000Z",
        updatedByPlatformAdminAccountId: "platform-admin-1"
      })
    ]);
  });

  it("persists desired channel behavior without provider secrets", () => {
    const policy = buildChannelProviderPolicyPersistenceInput({
      provider: "telegram",
      channelType: "telegram_bot",
      inboundMode: "polling",
      outboundEnabled: true,
      updatedAt: new Date("2026-06-30T12:00:00.000Z"),
      updatedByPlatformAdminAccountId: "platform-admin-1"
    });

    expect(policy).toEqual({
      provider: "telegram",
      channelType: "telegram_bot",
      inboundMode: "polling",
      outboundEnabled: true,
      updatedAt: new Date("2026-06-30T12:00:00.000Z"),
      updatedByPlatformAdminAccountId: "platform-admin-1"
    });
    expect(JSON.stringify(policy)).not.toContain("NORDVPN_TOKEN");
    expect(JSON.stringify(policy)).not.toContain("bot-token");
  });
});

const managedSaasConfig: Pick<WebConfig, "deploymentType"> = {
  deploymentType: "saas_shared"
};

function fakePolicyRepository(
  policies: readonly DeploymentChannelProviderPolicyRecord[]
): DeploymentChannelProviderPolicyRepository {
  return {
    async listPolicies() {
      return [...policies];
    },
    async findPolicy(input) {
      return (
        policies.find(
          (policy) =>
            policy.provider === input.provider &&
            policy.channelType === input.channelType
        ) ?? null
      );
    },
    async upsertPolicy(_input: UpsertDeploymentChannelProviderPolicyInput) {
      return undefined;
    }
  };
}
