import type { WebConfig } from "@hulee/config";
import type {
  InternalChannelType,
  InternalEgressProvider,
  InternalTelegramIntegrationConfig
} from "@hulee/contracts";
import type { I18nMessageKey } from "@hulee/i18n";
import type {
  DeploymentChannelProviderPolicyRecord,
  DeploymentChannelProviderPolicyRepository
} from "@hulee/db";

export type PlatformChannelProviderPolicySource =
  | "deployment_default"
  | "platform_policy";

export type PlatformChannelProviderDefinition = {
  provider: InternalEgressProvider;
  channelType: InternalChannelType;
  titleKey: I18nMessageKey;
  defaultManagedSaasInboundMode: InternalTelegramIntegrationConfig["mode"];
  defaultOnPremInboundMode: InternalTelegramIntegrationConfig["mode"];
  defaultOutboundEnabled: boolean;
  supportedInboundModes: readonly InternalTelegramIntegrationConfig["mode"][];
};

export type PlatformChannelProviderPolicyView = {
  provider: InternalEgressProvider;
  channelType: InternalChannelType;
  titleKey: I18nMessageKey;
  inboundMode: InternalTelegramIntegrationConfig["mode"];
  outboundEnabled: boolean;
  source: PlatformChannelProviderPolicySource;
  supportedInboundModes: readonly InternalTelegramIntegrationConfig["mode"][];
  updatedAt?: string;
  updatedByPlatformAdminAccountId?: string;
};

export const platformChannelProviderDefinitions = [
  {
    provider: "telegram",
    channelType: "telegram_bot",
    titleKey: "platform.channelPolicy.telegramBot",
    defaultManagedSaasInboundMode: "polling",
    defaultOnPremInboundMode: "webhook",
    defaultOutboundEnabled: true,
    supportedInboundModes: ["polling", "webhook"]
  }
] as const satisfies readonly PlatformChannelProviderDefinition[];

export async function loadPlatformChannelProviderPolicies(input: {
  config: Pick<WebConfig, "deploymentType">;
  repository: DeploymentChannelProviderPolicyRepository;
}): Promise<PlatformChannelProviderPolicyView[]> {
  const storedPolicies = await input.repository.listPolicies();
  const storedByKey = new Map(
    storedPolicies.map((policy) => [policyKey(policy), policy])
  );

  return platformChannelProviderDefinitions.map((definition) => {
    const fallback = defaultChannelProviderPolicy({
      config: input.config,
      definition
    });
    const stored = storedByKey.get(policyKey(definition));

    return stored
      ? policyFromStoredRecord({
          definition,
          stored
        })
      : fallback;
  });
}

export async function loadTelegramBotChannelProviderPolicy(input: {
  config: Pick<WebConfig, "deploymentType">;
  repository: DeploymentChannelProviderPolicyRepository;
}): Promise<PlatformChannelProviderPolicyView> {
  const policies = await loadPlatformChannelProviderPolicies(input);
  const telegram = policies.find(
    (policy) =>
      policy.provider === "telegram" && policy.channelType === "telegram_bot"
  );

  if (!telegram) {
    throw new Error("Telegram Bot channel provider policy is not registered.");
  }

  return telegram;
}

export function buildChannelProviderPolicyPersistenceInput(input: {
  provider: InternalEgressProvider;
  channelType: InternalChannelType;
  inboundMode: InternalTelegramIntegrationConfig["mode"];
  outboundEnabled: boolean;
  updatedAt: Date;
  updatedByPlatformAdminAccountId?: string;
}): DeploymentChannelProviderPolicyRecord {
  const definition = findChannelProviderDefinition({
    provider: input.provider,
    channelType: input.channelType
  });

  if (!definition.supportedInboundModes.includes(input.inboundMode)) {
    throw new Error(`Unsupported inbound mode: ${input.inboundMode}`);
  }

  return {
    provider: input.provider,
    channelType: input.channelType,
    inboundMode: input.inboundMode,
    outboundEnabled: input.outboundEnabled,
    updatedAt: input.updatedAt,
    ...(input.updatedByPlatformAdminAccountId
      ? {
          updatedByPlatformAdminAccountId: input.updatedByPlatformAdminAccountId
        }
      : {})
  };
}

export function findChannelProviderDefinition(input: {
  provider: InternalEgressProvider;
  channelType: InternalChannelType;
}): PlatformChannelProviderDefinition {
  const definition = platformChannelProviderDefinitions.find(
    (item) =>
      item.provider === input.provider && item.channelType === input.channelType
  );

  if (!definition) {
    throw new Error(
      `Unsupported channel provider policy: ${input.provider}/${input.channelType}`
    );
  }

  return definition;
}

function defaultChannelProviderPolicy(input: {
  config: Pick<WebConfig, "deploymentType">;
  definition: PlatformChannelProviderDefinition;
}): PlatformChannelProviderPolicyView {
  return {
    provider: input.definition.provider,
    channelType: input.definition.channelType,
    titleKey: input.definition.titleKey,
    inboundMode:
      input.config.deploymentType === "on_prem"
        ? input.definition.defaultOnPremInboundMode
        : input.definition.defaultManagedSaasInboundMode,
    outboundEnabled: input.definition.defaultOutboundEnabled,
    source: "deployment_default",
    supportedInboundModes: [...input.definition.supportedInboundModes]
  };
}

function policyFromStoredRecord(input: {
  definition: PlatformChannelProviderDefinition;
  stored: DeploymentChannelProviderPolicyRecord;
}): PlatformChannelProviderPolicyView {
  return {
    provider: input.stored.provider,
    channelType: input.stored.channelType,
    titleKey: input.definition.titleKey,
    inboundMode: input.stored.inboundMode,
    outboundEnabled: input.stored.outboundEnabled,
    source: "platform_policy",
    supportedInboundModes: [...input.definition.supportedInboundModes],
    updatedAt: input.stored.updatedAt.toISOString(),
    ...(input.stored.updatedByPlatformAdminAccountId
      ? {
          updatedByPlatformAdminAccountId:
            input.stored.updatedByPlatformAdminAccountId
        }
      : {})
  };
}

function policyKey(input: {
  provider: InternalEgressProvider;
  channelType: InternalChannelType;
}): string {
  return `${input.provider}:${input.channelType}`;
}
