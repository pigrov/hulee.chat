import type { WebConfig } from "@hulee/config";
import type {
  InternalChannelType,
  InternalEgressProfileKind,
  InternalEgressProfileStatus,
  InternalEgressProvider,
  InternalEgressProviderPolicy,
  InternalEgressStatusResponse
} from "@hulee/contracts";
import type { I18nMessageKey } from "@hulee/i18n";
import type {
  DeploymentEgressProviderPolicyRecord,
  DeploymentEgressProviderPolicyRepository
} from "@hulee/db";

export type PlatformEgressPolicyApplyState =
  | "current"
  | "pending_runtime_apply";

export type PlatformEgressProviderDefinition = {
  provider: InternalEgressProvider;
  titleKey: I18nMessageKey;
  supportedChannelTypes: readonly InternalChannelType[];
  defaultManagedSaasRoutingMode: InternalEgressProfileKind;
  defaultOnPremRoutingMode: InternalEgressProfileKind;
};

export type PlatformEgressProviderPolicyView = InternalEgressProviderPolicy & {
  titleKey: I18nMessageKey;
  applyState: PlatformEgressPolicyApplyState;
  runtimeProfile?: InternalEgressProfileStatus;
  directRouteWarning: boolean;
};

export const platformEgressProviderDefinitions = [
  {
    provider: "telegram",
    titleKey: "platform.egressProvider.telegram",
    supportedChannelTypes: ["telegram_bot", "telegram_qr_bridge"],
    defaultManagedSaasRoutingMode: "vpn_namespace",
    defaultOnPremRoutingMode: "customer_network"
  },
  {
    provider: "whatsapp",
    titleKey: "platform.egressProvider.whatsapp",
    supportedChannelTypes: ["whatsapp_qr_bridge"],
    defaultManagedSaasRoutingMode: "vpn_namespace",
    defaultOnPremRoutingMode: "customer_network"
  },
  {
    provider: "max",
    titleKey: "platform.egressProvider.max",
    supportedChannelTypes: ["max_bot", "max_qr_bridge"],
    defaultManagedSaasRoutingMode: "direct",
    defaultOnPremRoutingMode: "customer_network"
  },
  {
    provider: "vk",
    titleKey: "platform.egressProvider.vk",
    supportedChannelTypes: ["vk_community"],
    defaultManagedSaasRoutingMode: "direct",
    defaultOnPremRoutingMode: "customer_network"
  }
] as const satisfies readonly PlatformEgressProviderDefinition[];

export const platformEgressProviderRoutingModes = [
  "vpn_namespace",
  "direct",
  "http_proxy",
  "socks_proxy",
  "customer_network",
  "disabled"
] as const satisfies readonly InternalEgressProfileKind[];

export async function loadPlatformEgressProviderPolicies(input: {
  config: Pick<WebConfig, "deploymentType" | "egressProfile">;
  egressStatus: InternalEgressStatusResponse;
  repository: DeploymentEgressProviderPolicyRepository;
}): Promise<PlatformEgressProviderPolicyView[]> {
  const storedPolicies = await input.repository.listPolicies();
  const storedByProvider = new Map(
    storedPolicies.map((policy) => [policy.provider, policy])
  );

  return platformEgressProviderDefinitions.map((definition) => {
    const fallback = defaultProviderPolicy({
      config: input.config,
      definition
    });
    const stored = storedByProvider.get(definition.provider);
    const policy = stored
      ? policyFromStoredRecord({
          definition,
          stored
        })
      : fallback;
    const runtimeProfile = input.egressStatus.profiles.find(
      (profile) => profile.profileId === policy.profileId
    );

    return {
      ...policy,
      titleKey: definition.titleKey,
      applyState: isRuntimePolicyApplied({
        fallback,
        policy,
        runtimeProfile
      })
        ? "current"
        : "pending_runtime_apply",
      ...(runtimeProfile ? { runtimeProfile } : {}),
      directRouteWarning: shouldWarnOnDirectRoute({
        deploymentType: input.config.deploymentType,
        policy
      })
    };
  });
}

export function buildProviderPolicyPersistenceInput(input: {
  config: Pick<WebConfig, "deploymentType" | "egressProfile">;
  provider: InternalEgressProvider;
  routingMode: InternalEgressProfileKind;
  updatedAt: Date;
  updatedByPlatformAdminAccountId?: string;
}): DeploymentEgressProviderPolicyRecord {
  const definition = findProviderDefinition(input.provider);
  const defaultPolicy = defaultProviderPolicy({
    config: input.config,
    definition
  });

  if (!defaultPolicy.allowedProfileKinds.includes(input.routingMode)) {
    throw new Error(`Unsupported egress routing mode: ${input.routingMode}`);
  }

  return {
    provider: input.provider,
    routingMode: input.routingMode,
    profileId: defaultProfileIdForRoutingMode({
      config: input.config,
      routingMode: input.routingMode
    }),
    required: input.routingMode !== "disabled",
    supportedChannelTypes: definition.supportedChannelTypes,
    allowedProfileKinds: defaultPolicy.allowedProfileKinds,
    updatedAt: input.updatedAt,
    ...(input.updatedByPlatformAdminAccountId
      ? {
          updatedByPlatformAdminAccountId: input.updatedByPlatformAdminAccountId
        }
      : {})
  };
}

export function findProviderDefinition(
  provider: InternalEgressProvider
): PlatformEgressProviderDefinition {
  const definition = platformEgressProviderDefinitions.find(
    (item) => item.provider === provider
  );

  if (!definition) {
    throw new Error(`Unsupported egress provider: ${provider}`);
  }

  return definition;
}

function defaultProviderPolicy(input: {
  config: Pick<WebConfig, "deploymentType" | "egressProfile">;
  definition: PlatformEgressProviderDefinition;
}): InternalEgressProviderPolicy {
  const routingMode =
    input.config.deploymentType === "on_prem"
      ? input.definition.defaultOnPremRoutingMode
      : input.definition.defaultManagedSaasRoutingMode;

  return {
    provider: input.definition.provider,
    routingMode,
    profileId: defaultProfileIdForRoutingMode({
      config: input.config,
      routingMode
    }),
    required: routingMode !== "disabled",
    source: "deployment_default",
    supportedChannelTypes: [...input.definition.supportedChannelTypes],
    allowedProfileKinds: [...platformEgressProviderRoutingModes]
  };
}

function policyFromStoredRecord(input: {
  definition: PlatformEgressProviderDefinition;
  stored: DeploymentEgressProviderPolicyRecord;
}): InternalEgressProviderPolicy {
  return {
    provider: input.stored.provider,
    routingMode: input.stored.routingMode,
    profileId: input.stored.profileId,
    required: input.stored.required,
    source: "platform_policy",
    supportedChannelTypes:
      input.stored.supportedChannelTypes.length > 0
        ? [...input.stored.supportedChannelTypes]
        : [...input.definition.supportedChannelTypes],
    allowedProfileKinds:
      input.stored.allowedProfileKinds.length > 0
        ? [...input.stored.allowedProfileKinds]
        : [...platformEgressProviderRoutingModes],
    updatedAt: input.stored.updatedAt.toISOString(),
    ...(input.stored.updatedByPlatformAdminAccountId
      ? {
          updatedByPlatformAdminAccountId:
            input.stored.updatedByPlatformAdminAccountId
        }
      : {})
  };
}

function defaultProfileIdForRoutingMode(input: {
  config: Pick<WebConfig, "egressProfile">;
  routingMode: InternalEgressProfileKind;
}): string {
  if (input.routingMode === input.config.egressProfile.profileKind) {
    return input.config.egressProfile.profileId;
  }

  if (input.routingMode === "vpn_namespace") {
    return "hulee_chat_vpn_gateway";
  }

  return `deployment:${input.routingMode}`;
}

function isRuntimePolicyApplied(input: {
  policy: InternalEgressProviderPolicy;
  fallback: InternalEgressProviderPolicy;
  runtimeProfile?: InternalEgressProfileStatus;
}): boolean {
  if (input.runtimeProfile) {
    return (
      input.runtimeProfile.profileKind === input.policy.routingMode &&
      input.runtimeProfile.profileId === input.policy.profileId
    );
  }

  return (
    input.policy.routingMode === input.fallback.routingMode &&
    input.policy.profileId === input.fallback.profileId
  );
}

function shouldWarnOnDirectRoute(input: {
  deploymentType: WebConfig["deploymentType"];
  policy: InternalEgressProviderPolicy;
}): boolean {
  return (
    input.policy.routingMode === "direct" &&
    input.deploymentType !== "on_prem" &&
    (input.policy.provider === "telegram" ||
      input.policy.provider === "whatsapp")
  );
}
