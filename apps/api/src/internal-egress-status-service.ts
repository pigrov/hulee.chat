import type {
  EmployeeId,
  InternalEgressProfileStatus,
  InternalEgressStatusResponse,
  TenantId
} from "@hulee/contracts";
import type { DeploymentEgressProfile } from "@hulee/modules";

export type InternalEgressStatusContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

export type InternalEgressStatusService = {
  loadEgressStatus(
    context: InternalEgressStatusContext
  ): Promise<InternalEgressStatusResponse>;
};

export type InternalEgressStatusServiceOptions = {
  profiles?: readonly DeploymentEgressProfile[];
  now?: () => Date;
};

export function createInternalEgressStatusService(
  options: InternalEgressStatusServiceOptions = {}
): InternalEgressStatusService {
  const now = options.now ?? (() => new Date());
  const profiles = options.profiles ?? [];

  return {
    async loadEgressStatus() {
      const checkedAt = now().toISOString();

      return {
        profiles: profiles.map((profile) =>
          toInternalEgressProfileStatus(profile, checkedAt)
        )
      };
    }
  };
}

function toInternalEgressProfileStatus(
  profile: DeploymentEgressProfile,
  checkedAt: string
): InternalEgressProfileStatus {
  return {
    profileId: profile.profileId.trim(),
    profileKind: profile.profileKind,
    status: profile.status,
    source: "deployment_config",
    checkedAt,
    ...(profile.lastErrorCode ? { lastErrorCode: profile.lastErrorCode } : {}),
    ...safeString("operatorHint", profile.operatorHint),
    ...safeStringList("supportedProviders", profile.supportedProviders),
    ...safeStringList("supportedChannelTypes", profile.supportedChannelTypes)
  };
}

function safeString<TKey extends string>(
  key: TKey,
  value: string | undefined
): Partial<Record<TKey, string>> {
  const safeValue = value?.trim();

  return safeValue && safeValue.length > 0
    ? ({ [key]: safeValue } as Partial<Record<TKey, string>>)
    : {};
}

function safeStringList<TKey extends string>(
  key: TKey,
  values: readonly string[] | undefined
): Partial<Record<TKey, string[]>> {
  const safeValues = values
    ?.map((value) => value.trim())
    .filter((value) => value.length > 0);

  return safeValues && safeValues.length > 0
    ? ({ [key]: safeValues } as Partial<Record<TKey, string[]>>)
    : {};
}
