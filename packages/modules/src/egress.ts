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
