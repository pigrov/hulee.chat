import type {
  InternalEgressDiagnostics,
  InternalEgressProfileKind,
  InternalEgressRequirement,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";

export type EgressProfileResolution = {
  profileKind: InternalEgressProfileKind;
  profileId?: string;
  diagnostics: InternalEgressDiagnostics;
};

export type DeploymentEgressProfile = {
  profileId: string;
  profileKind: InternalEgressProfileKind;
  status: InternalEgressDiagnostics["status"];
  lastErrorCode?: PlatformErrorCode;
  operatorHint?: string;
  supportedProviders?: readonly string[];
  supportedChannelTypes?: readonly string[];
};

export type EgressProfileResolveInput = {
  tenantId: TenantId;
  connectorId: string;
  channelType: string;
  provider: string;
  requirement: InternalEgressRequirement;
  checkedAt: string;
};

export type EgressOperationInput = {
  tenantId: TenantId;
  connectorId: string;
  channelType: string;
  provider: string;
  operation: string;
  resolution: EgressProfileResolution;
};

export type EgressRuntime = {
  resolveProfile(
    input: EgressProfileResolveInput
  ): Promise<EgressProfileResolution>;
  execute<T>(
    input: EgressOperationInput,
    operation: () => Promise<T>
  ): Promise<T>;
};

export type EgressRuntimeRegistry = {
  getRuntime(profileKind: InternalEgressProfileKind): EgressRuntime;
};

export const managedMessengerVpnEgressRequirement = {
  required: true,
  defaultProfileKind: "vpn_namespace",
  allowedProfileKinds: [
    "vpn_namespace",
    "http_proxy",
    "socks_proxy",
    "customer_network"
  ],
  enforcementScope: "hulee_managed_saas"
} satisfies InternalEgressRequirement;

export const deploymentPolicyDirectEgressRequirement = {
  required: false,
  defaultProfileKind: "direct",
  allowedProfileKinds: [
    "direct",
    "http_proxy",
    "socks_proxy",
    "customer_network"
  ],
  enforcementScope: "deployment_policy"
} satisfies InternalEgressRequirement;

export class EgressRuntimeError extends Error {
  readonly code: PlatformErrorCode;

  constructor(
    code: PlatformErrorCode = "provider.temporary_failure",
    message: string = code
  ) {
    super(message);
    this.name = "EgressRuntimeError";
    this.code = code;
  }
}

export function createPassthroughEgressRuntime(
  input: {
    profileIdFactory?: (input: EgressProfileResolveInput) => string;
  } = {}
): EgressRuntime {
  return {
    async resolveProfile(resolveInput) {
      const profileKind = resolveInput.requirement.defaultProfileKind;
      const status = passthroughProfileStatus(profileKind);
      const profileId = input.profileIdFactory?.(resolveInput);

      return {
        profileKind,
        profileId,
        diagnostics: {
          required: resolveInput.requirement.required,
          status,
          profileKind,
          ...(profileId ? { profileId } : {}),
          checkedAt: resolveInput.checkedAt
        }
      };
    },

    async execute(executeInput, operation) {
      if (
        executeInput.resolution.profileKind === "disabled" ||
        executeInput.resolution.diagnostics.status === "unavailable"
      ) {
        throw new EgressRuntimeError(
          "provider.temporary_failure",
          "Egress profile is unavailable."
        );
      }

      return operation();
    }
  };
}

export function createDeploymentEgressRuntime(input: {
  profiles: readonly DeploymentEgressProfile[];
}): EgressRuntime {
  return {
    async resolveProfile(resolveInput) {
      const profile = selectDeploymentEgressProfile(
        input.profiles,
        resolveInput
      );

      if (!profile) {
        return {
          profileKind: resolveInput.requirement.defaultProfileKind,
          diagnostics: {
            required: resolveInput.requirement.required,
            status: "misconfigured",
            profileKind: resolveInput.requirement.defaultProfileKind,
            checkedAt: resolveInput.checkedAt,
            lastErrorCode: "validation.failed",
            operatorHint:
              "No deployment egress profile matches the connector requirement."
          }
        };
      }

      return {
        profileKind: profile.profileKind,
        profileId: profile.profileId,
        diagnostics: {
          required: resolveInput.requirement.required,
          status: profile.status,
          profileKind: profile.profileKind,
          profileId: profile.profileId,
          checkedAt: resolveInput.checkedAt,
          ...(profile.lastErrorCode
            ? { lastErrorCode: profile.lastErrorCode }
            : {}),
          ...(profile.operatorHint
            ? { operatorHint: profile.operatorHint }
            : {})
        }
      };
    },

    async execute(executeInput, operation) {
      assertEgressProfileUsable(executeInput.resolution.diagnostics);

      return operation();
    }
  };
}

export function createStaticEgressRuntimeRegistry(
  input: {
    fallbackRuntime?: EgressRuntime;
    runtimes?: Partial<Record<InternalEgressProfileKind, EgressRuntime>>;
  } = {}
): EgressRuntimeRegistry {
  const fallbackRuntime =
    input.fallbackRuntime ?? createPassthroughEgressRuntime();

  return {
    getRuntime(profileKind) {
      return input.runtimes?.[profileKind] ?? fallbackRuntime;
    }
  };
}

function selectDeploymentEgressProfile(
  profiles: readonly DeploymentEgressProfile[],
  input: EgressProfileResolveInput
): DeploymentEgressProfile | null {
  const candidates = profiles.filter(
    (profile) =>
      input.requirement.allowedProfileKinds.includes(profile.profileKind) &&
      profileMatchesProvider(profile, input.provider) &&
      profileMatchesChannelType(profile, input.channelType)
  );
  const defaultProfile = candidates.find(
    (profile) => profile.profileKind === input.requirement.defaultProfileKind
  );

  return defaultProfile ?? candidates[0] ?? null;
}

function profileMatchesProvider(
  profile: DeploymentEgressProfile,
  provider: string
): boolean {
  return (
    !profile.supportedProviders ||
    profile.supportedProviders.length === 0 ||
    profile.supportedProviders.includes(provider)
  );
}

function profileMatchesChannelType(
  profile: DeploymentEgressProfile,
  channelType: string
): boolean {
  return (
    !profile.supportedChannelTypes ||
    profile.supportedChannelTypes.length === 0 ||
    profile.supportedChannelTypes.includes(channelType)
  );
}

function assertEgressProfileUsable(
  diagnostics: InternalEgressDiagnostics
): void {
  if (diagnostics.required && diagnostics.status !== "ready") {
    throw new EgressRuntimeError(
      diagnostics.lastErrorCode ?? "provider.temporary_failure",
      diagnostics.operatorHint ?? "Required egress profile is not ready."
    );
  }

  if (
    diagnostics.status === "unavailable" ||
    diagnostics.status === "misconfigured"
  ) {
    throw new EgressRuntimeError(
      diagnostics.lastErrorCode ?? "provider.temporary_failure",
      diagnostics.operatorHint ?? "Egress profile is not usable."
    );
  }
}

function passthroughProfileStatus(
  profileKind: InternalEgressProfileKind
): InternalEgressDiagnostics["status"] {
  if (profileKind === "direct") {
    return "ready";
  }

  if (profileKind === "disabled") {
    return "unavailable";
  }

  return "unknown";
}
