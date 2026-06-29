import {
  internalChannelTypeSchema,
  internalEgressProviderSchema,
  type InternalEgressProvider
} from "@hulee/contracts";
import type {
  DeploymentEgressProviderPolicyRecord,
  DeploymentEgressProviderPolicyRepository
} from "@hulee/db";
import {
  createDeploymentEgressRuntime,
  type DeploymentEgressProfile,
  type EgressProfileResolution,
  type EgressProfileResolveInput,
  type EgressRuntime
} from "@hulee/modules";

export type PolicyAwareDeploymentEgressRuntimeOptions = {
  deploymentProfile: DeploymentEgressProfile;
  policyRepository: DeploymentEgressProviderPolicyRepository;
};

export function createPolicyAwareDeploymentEgressRuntime(
  options: PolicyAwareDeploymentEgressRuntimeOptions
): EgressRuntime {
  const deploymentRuntime = createDeploymentEgressRuntime({
    profiles: [options.deploymentProfile]
  });

  return {
    async resolveProfile(resolveInput) {
      const policy = await findProviderPolicy({
        policyRepository: options.policyRepository,
        resolveInput
      });

      if (policy === null) {
        return deploymentRuntime.resolveProfile(resolveInput);
      }

      return resolvePolicyProfile({
        deploymentProfile: options.deploymentProfile,
        policy,
        resolveInput
      });
    },

    async execute(executeInput, operation) {
      return deploymentRuntime.execute(executeInput, operation);
    }
  };
}

async function findProviderPolicy(input: {
  policyRepository: DeploymentEgressProviderPolicyRepository;
  resolveInput: EgressProfileResolveInput;
}): Promise<DeploymentEgressProviderPolicyRecord | null> {
  const provider = parseProvider(input.resolveInput.provider);

  if (provider === null) {
    return null;
  }

  const policy = await input.policyRepository.findPolicy(provider);

  if (
    policy === null ||
    !policyAppliesToChannelType(policy, input.resolveInput)
  ) {
    return null;
  }

  return policy;
}

function resolvePolicyProfile(input: {
  deploymentProfile: DeploymentEgressProfile;
  policy: DeploymentEgressProviderPolicyRecord;
  resolveInput: EgressProfileResolveInput;
}): EgressProfileResolution {
  if (input.policy.routingMode === "disabled") {
    return {
      profileKind: "disabled",
      profileId: input.policy.profileId,
      diagnostics: {
        required: input.policy.required,
        status: "unavailable",
        profileKind: "disabled",
        profileId: input.policy.profileId,
        checkedAt: input.resolveInput.checkedAt,
        lastErrorCode: "module.disabled",
        operatorHint: `${input.policy.provider} provider calls are disabled by the platform egress policy.`
      }
    };
  }

  if (!isDeploymentProfileApplied(input.deploymentProfile, input.policy)) {
    return {
      profileKind: input.policy.routingMode,
      profileId: input.policy.profileId,
      diagnostics: {
        required: input.policy.required,
        status: "misconfigured",
        profileKind: input.policy.routingMode,
        profileId: input.policy.profileId,
        checkedAt: input.resolveInput.checkedAt,
        lastErrorCode: "validation.failed",
        operatorHint: buildPendingRuntimeApplyHint(input)
      }
    };
  }

  return {
    profileKind: input.policy.routingMode,
    profileId: input.policy.profileId,
    diagnostics: {
      required: input.policy.required,
      status: input.deploymentProfile.status,
      profileKind: input.policy.routingMode,
      profileId: input.policy.profileId,
      checkedAt: input.resolveInput.checkedAt,
      ...(input.deploymentProfile.lastErrorCode
        ? { lastErrorCode: input.deploymentProfile.lastErrorCode }
        : {}),
      ...(input.deploymentProfile.operatorHint
        ? { operatorHint: input.deploymentProfile.operatorHint }
        : {})
    }
  };
}

function parseProvider(provider: string): InternalEgressProvider | null {
  const parsed = internalEgressProviderSchema.safeParse(provider);

  return parsed.success ? parsed.data : null;
}

function policyAppliesToChannelType(
  policy: DeploymentEgressProviderPolicyRecord,
  input: EgressProfileResolveInput
): boolean {
  const parsed = internalChannelTypeSchema.safeParse(input.channelType);

  if (!parsed.success || policy.supportedChannelTypes.length === 0) {
    return true;
  }

  return policy.supportedChannelTypes.includes(parsed.data);
}

function isDeploymentProfileApplied(
  deploymentProfile: DeploymentEgressProfile,
  policy: DeploymentEgressProviderPolicyRecord
): boolean {
  return (
    deploymentProfile.profileKind === policy.routingMode &&
    deploymentProfile.profileId === policy.profileId
  );
}

function buildPendingRuntimeApplyHint(input: {
  deploymentProfile: DeploymentEgressProfile;
  policy: DeploymentEgressProviderPolicyRecord;
  resolveInput: EgressProfileResolveInput;
}): string {
  return [
    `${input.policy.provider} provider policy requires ${input.policy.routingMode} profile ${input.policy.profileId}.`,
    `Current worker profile is ${input.deploymentProfile.profileKind} profile ${input.deploymentProfile.profileId}.`,
    "Restart or redeploy the provider worker with the desired profile before provider calls can run."
  ].join(" ");
}
