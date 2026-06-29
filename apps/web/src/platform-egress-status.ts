import type { WebConfig } from "@hulee/config";
import type {
  DeploymentEgressStatusRepository,
  DeploymentEgressStatusSnapshot
} from "@hulee/db";
import type {
  InternalEgressAlertSeverity,
  InternalEgressProfileStatus,
  InternalEgressStatus,
  InternalEgressStatusResponse
} from "@hulee/contracts";

export type PlatformEgressStatusOptions = {
  config: Pick<WebConfig, "egressProfile">;
  repository: DeploymentEgressStatusRepository;
  now?: () => Date;
  staleAfterMs?: number;
};

export async function loadPlatformEgressStatus(
  options: PlatformEgressStatusOptions
): Promise<InternalEgressStatusResponse> {
  const now = options.now?.() ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? 120_000;
  const snapshots = await options.repository.listLatestSnapshots({
    profileIds: [options.config.egressProfile.profileId],
    limit: 1
  });
  const snapshot = snapshots[0];

  if (snapshot) {
    return {
      profiles: [
        toRuntimeProfileStatus({
          snapshot,
          now,
          staleAfterMs
        })
      ]
    };
  }

  return {
    profiles: [
      {
        profileId: options.config.egressProfile.profileId,
        profileKind: options.config.egressProfile.profileKind,
        status: options.config.egressProfile.status,
        source: "deployment_config",
        checkedAt: now.toISOString(),
        ...(options.config.egressProfile.lastErrorCode
          ? { lastErrorCode: options.config.egressProfile.lastErrorCode }
          : {}),
        ...(options.config.egressProfile.operatorHint
          ? { operatorHint: options.config.egressProfile.operatorHint }
          : {})
      }
    ]
  };
}

function toRuntimeProfileStatus(input: {
  snapshot: DeploymentEgressStatusSnapshot;
  now: Date;
  staleAfterMs: number;
}): InternalEgressProfileStatus {
  const stale =
    input.now.getTime() - input.snapshot.checkedAt.getTime() >
    input.staleAfterMs;
  const status = stale
    ? staleStatus(input.snapshot.status)
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
    ...(input.snapshot.operatorHint
      ? { operatorHint: input.snapshot.operatorHint }
      : stale
        ? {
            operatorHint:
              "Provider egress probes are stale; provider worker may be stopped."
          }
        : {}),
    probes: [...input.snapshot.probes],
    ...(alerts.length > 0 ? { alerts: [...alerts] } : {})
  };
}

function staleStatus(status: InternalEgressStatus): InternalEgressStatus {
  return status === "ready" || status === "unknown" ? "degraded" : status;
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
