import type {
  EmployeeId,
  InternalEgressAlertSeverity,
  InternalEgressStatus,
  InternalEgressProfileStatus,
  InternalEgressStatusResponse,
  TenantId
} from "@hulee/contracts";
import type {
  DeploymentEgressStatusRepository,
  DeploymentEgressStatusSnapshot
} from "@hulee/db";
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
  snapshotRepository?: DeploymentEgressStatusRepository;
  snapshotStaleAfterMs?: number;
  now?: () => Date;
};

export function createInternalEgressStatusService(
  options: InternalEgressStatusServiceOptions = {}
): InternalEgressStatusService {
  const now = options.now ?? (() => new Date());
  const profiles = options.profiles ?? [];
  const snapshotStaleAfterMs = options.snapshotStaleAfterMs ?? 120_000;

  return {
    async loadEgressStatus() {
      const checkedAt = now();
      const snapshots = await loadSnapshots({
        profiles,
        repository: options.snapshotRepository
      });

      return {
        profiles: mergeEgressProfiles({
          checkedAt,
          profiles,
          snapshots,
          snapshotStaleAfterMs
        })
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

async function loadSnapshots(input: {
  profiles: readonly DeploymentEgressProfile[];
  repository: DeploymentEgressStatusRepository | undefined;
}): Promise<DeploymentEgressStatusSnapshot[]> {
  if (!input.repository) {
    return [];
  }

  return input.repository.listLatestSnapshots({
    profileIds:
      input.profiles.length > 0
        ? input.profiles.map((profile) => profile.profileId)
        : undefined
  });
}

function mergeEgressProfiles(input: {
  checkedAt: Date;
  profiles: readonly DeploymentEgressProfile[];
  snapshots: readonly DeploymentEgressStatusSnapshot[];
  snapshotStaleAfterMs: number;
}): InternalEgressProfileStatus[] {
  const checkedAt = input.checkedAt.toISOString();
  const snapshotsByProfileId = new Map(
    input.snapshots.map((snapshot) => [snapshot.profileId, snapshot])
  );
  const mergedProfiles = input.profiles.map((profile) => {
    const snapshot = snapshotsByProfileId.get(profile.profileId);

    if (!snapshot) {
      return toInternalEgressProfileStatus(profile, checkedAt);
    }

    return toInternalEgressRuntimeStatus({
      profile,
      snapshot,
      now: input.checkedAt,
      staleAfterMs: input.snapshotStaleAfterMs
    });
  });
  const configuredProfileIds = new Set(
    input.profiles.map((profile) => profile.profileId)
  );
  const unconfiguredSnapshots = input.snapshots.filter(
    (snapshot) => !configuredProfileIds.has(snapshot.profileId)
  );

  return [
    ...mergedProfiles,
    ...unconfiguredSnapshots.map((snapshot) =>
      toInternalEgressRuntimeStatus({
        snapshot,
        now: input.checkedAt,
        staleAfterMs: input.snapshotStaleAfterMs
      })
    )
  ];
}

function toInternalEgressRuntimeStatus(input: {
  profile?: DeploymentEgressProfile;
  snapshot: DeploymentEgressStatusSnapshot;
  now: Date;
  staleAfterMs: number;
}): InternalEgressProfileStatus {
  const stale = isSnapshotStale({
    checkedAt: input.snapshot.checkedAt,
    now: input.now,
    staleAfterMs: input.staleAfterMs
  });
  const status = stale
    ? staleRuntimeStatus(input.snapshot.status)
    : input.snapshot.status;
  const alerts = stale
    ? [
        ...input.snapshot.alerts,
        {
          severity: "warning" as const,
          code: "egress.probe_stale",
          message: "Provider egress probes are stale."
        }
      ]
    : input.snapshot.alerts;
  const alertSeverity = maxAlertSeverity(
    stale ? "warning" : input.snapshot.alertSeverity,
    alerts.map((alert) => alert.severity)
  );
  const operatorHint =
    stale && !input.snapshot.operatorHint
      ? "Provider egress probes are stale; provider worker may be stopped."
      : input.snapshot.operatorHint;

  return {
    profileId: input.snapshot.profileId,
    profileKind: input.snapshot.profileKind,
    status,
    source: "runtime_probe",
    checkedAt: input.snapshot.checkedAt.toISOString(),
    alertSeverity,
    consecutiveFailures: input.snapshot.consecutiveFailures,
    ...(input.snapshot.lastReadyAt
      ? { lastReadyAt: input.snapshot.lastReadyAt.toISOString() }
      : {}),
    ...(input.snapshot.lastFailureAt
      ? { lastFailureAt: input.snapshot.lastFailureAt.toISOString() }
      : {}),
    ...(input.snapshot.publicIp ? { publicIp: input.snapshot.publicIp } : {}),
    ...(input.snapshot.lastErrorCode
      ? { lastErrorCode: input.snapshot.lastErrorCode }
      : {}),
    ...(operatorHint ? { operatorHint } : {}),
    probes: [...input.snapshot.probes],
    ...(alerts.length > 0 ? { alerts: [...alerts] } : {}),
    ...safeStringList("supportedProviders", input.profile?.supportedProviders),
    ...safeStringList(
      "supportedChannelTypes",
      input.profile?.supportedChannelTypes
    )
  };
}

function isSnapshotStale(input: {
  checkedAt: Date;
  now: Date;
  staleAfterMs: number;
}): boolean {
  return input.now.getTime() - input.checkedAt.getTime() > input.staleAfterMs;
}

function staleRuntimeStatus(
  status: InternalEgressStatus
): InternalEgressStatus {
  if (status === "ready" || status === "unknown") {
    return "degraded";
  }

  return status;
}

function maxAlertSeverity(
  fallback: InternalEgressAlertSeverity,
  severities: readonly Exclude<InternalEgressAlertSeverity, "none">[]
): InternalEgressAlertSeverity {
  const severityOrder = ["none", "info", "warning", "critical"] as const;

  return [fallback, ...severities].reduce((max, severity) => {
    return severityOrder.indexOf(severity) > severityOrder.indexOf(max)
      ? severity
      : max;
  }, "none" as InternalEgressAlertSeverity);
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
