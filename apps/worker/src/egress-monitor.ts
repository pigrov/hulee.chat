import type {
  DeploymentEgressAlert,
  DeploymentEgressProbeResult,
  DeploymentEgressStatusRepository,
  DeploymentEgressStatusSnapshot
} from "@hulee/db";
import type { WorkerConfig } from "@hulee/config";
import type {
  InternalEgressAlertSeverity,
  InternalEgressStatus
} from "@hulee/contracts";
import type { Logger } from "@hulee/observability";
import { lookup as defaultLookup } from "node:dns/promises";
import { hostname } from "node:os";

export type EgressProbeKind = "dns" | "http" | "public_ip";

export type EgressProbeDefinition = {
  name: string;
  kind: EgressProbeKind;
  target: string;
  expectedStatuses?: readonly number[];
};

export type EgressLookup = (hostname: string) => Promise<unknown>;

export type EgressMonitorOptions = {
  config: Pick<
    WorkerConfig,
    | "egressProfile"
    | "egressProbeIntervalMs"
    | "egressProbeTimeoutMs"
    | "egressProbesEnabled"
    | "workerFeatures"
  >;
  repository: DeploymentEgressStatusRepository;
  logger?: Logger;
  probes?: readonly EgressProbeDefinition[];
  now?: () => Date;
  fetchImpl?: typeof fetch;
  lookupImpl?: EgressLookup;
  workerId?: string;
};

export type WorkerEgressMonitor = {
  start(): void;
  stop(): void;
  runOnce(): Promise<DeploymentEgressStatusSnapshot | null>;
};

type ProbeRunResult = DeploymentEgressProbeResult & {
  publicIp?: string;
};

export const defaultEgressProbes = [
  {
    name: "dns.telegram",
    kind: "dns",
    target: "telegram.org"
  },
  {
    name: "https.connectivity",
    kind: "http",
    target: "https://www.gstatic.com/generate_204",
    expectedStatuses: [204]
  },
  {
    name: "https.telegram",
    kind: "http",
    target: "https://api.telegram.org"
  },
  {
    name: "https.whatsapp",
    kind: "http",
    target: "https://web.whatsapp.com"
  },
  {
    name: "public_ip",
    kind: "public_ip",
    target: "https://api.ipify.org"
  }
] as const satisfies readonly EgressProbeDefinition[];

export function createWorkerEgressMonitor(
  options: EgressMonitorOptions
): WorkerEgressMonitor {
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupImpl = options.lookupImpl ?? defaultLookup;
  const probes = options.probes ?? defaultEgressProbes;
  const workerId =
    options.workerId ?? `${hostname()}:${process.pid}:provider-egress`;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let stopped = false;
  let latestSnapshot: DeploymentEgressStatusSnapshot | undefined;

  async function runOnce(): Promise<DeploymentEgressStatusSnapshot | null> {
    if (!shouldRunEgressMonitor(options.config)) {
      return null;
    }

    const checkedAt = now();
    const results: ProbeRunResult[] = await Promise.all(
      probes.map((probe) =>
        runProbe({
          checkedAt,
          fetchImpl,
          lookupImpl,
          probe,
          timeoutMs: options.config.egressProbeTimeoutMs
        })
      )
    );
    const snapshot = buildSnapshot({
      checkedAt,
      profile: options.config.egressProfile,
      previous: latestSnapshot,
      probes: results,
      workerId
    });

    await options.repository.upsertSnapshot(snapshot);
    latestSnapshot = snapshot;

    if (snapshot.alertSeverity !== "none") {
      options.logger?.warn("worker.egress_probe_degraded", {
        profileId: snapshot.profileId,
        status: snapshot.status,
        alertSeverity: snapshot.alertSeverity,
        consecutiveFailures: snapshot.consecutiveFailures,
        failedProbes: snapshot.probes
          .filter((probe) => probe.status === "failed")
          .map((probe) => probe.name)
      });
    }

    return snapshot;
  }

  async function runLoop(): Promise<void> {
    if (running || stopped) {
      return;
    }

    running = true;

    try {
      await runOnce();
    } catch (error) {
      options.logger?.error("worker.egress_probe_failed", undefined, error);
    } finally {
      running = false;
    }

    if (!stopped) {
      timer = setTimeout(runLoop, options.config.egressProbeIntervalMs);
    }
  }

  return {
    start() {
      if (!shouldRunEgressMonitor(options.config) || timer !== undefined) {
        return;
      }

      stopped = false;
      void runLoop();
    },

    stop() {
      stopped = true;

      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },

    runOnce
  };
}

export function shouldRunEgressMonitor(
  config: Pick<
    WorkerConfig,
    "egressProbesEnabled" | "egressProfile" | "workerFeatures"
  >
): boolean {
  if (!config.egressProbesEnabled) {
    return false;
  }

  if (config.egressProfile.profileKind === "disabled") {
    return false;
  }

  return config.workerFeatures.some((feature) => {
    return providerEgressWorkerFeatures.some(
      (candidate) => candidate === feature
    );
  });
}

async function runProbe(input: {
  checkedAt: Date;
  fetchImpl: typeof fetch;
  lookupImpl: EgressLookup;
  probe: EgressProbeDefinition;
  timeoutMs: number;
}): Promise<ProbeRunResult> {
  const startedAt = Date.now();

  try {
    if (input.probe.kind === "dns") {
      await input.lookupImpl(input.probe.target);

      return successfulProbe(input, startedAt);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await input.fetchImpl(input.probe.target, {
        signal: controller.signal
      });
      const httpStatus = response.status;
      const success = input.probe.expectedStatuses
        ? input.probe.expectedStatuses.includes(httpStatus)
        : httpStatus >= 200 && httpStatus < 500;

      if (!success) {
        return failedProbe(input, startedAt, {
          errorCode: "egress.http_status",
          errorMessage: `HTTP ${httpStatus}`,
          httpStatus
        });
      }

      const probeResult = {
        ...successfulProbe(input, startedAt),
        httpStatus
      };

      if (input.probe.kind === "public_ip") {
        return {
          ...probeResult,
          publicIp: sanitizePublicIp(await response.text())
        };
      }

      return probeResult;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return failedProbe(input, startedAt, {
      errorCode: errorName(error),
      errorMessage: safeErrorMessage(error)
    });
  }
}

function buildSnapshot(input: {
  checkedAt: Date;
  profile: WorkerConfig["egressProfile"];
  previous?: DeploymentEgressStatusSnapshot;
  probes: readonly ProbeRunResult[];
  workerId: string;
}): DeploymentEgressStatusSnapshot {
  const failedProbes = input.probes.filter(
    (probe) => probe.status === "failed"
  );
  const successfulProbes = input.probes.filter(
    (probe) => probe.status === "success"
  );
  const status = resolveProbeStatus({
    failedProbeCount: failedProbes.length,
    successfulProbeCount: successfulProbes.length,
    totalProbeCount: input.probes.length
  });
  const alertSeverity = resolveAlertSeverity(status);
  const consecutiveFailures =
    status === "ready" ? 0 : (input.previous?.consecutiveFailures ?? 0) + 1;
  const checkedAt = input.checkedAt.toISOString();
  const alerts = buildAlerts({ failedProbes, status });
  const publicIpProbe = input.probes.find(
    (probe) => probe.name === "public_ip"
  );
  const probes = input.probes.map(({ publicIp: _publicIp, ...probe }) => ({
    ...probe,
    checkedAt
  }));

  return {
    profileId: input.profile.profileId,
    profileKind: input.profile.profileKind,
    status,
    checkedAt: input.checkedAt,
    lastReadyAt:
      status === "ready" ? input.checkedAt : input.previous?.lastReadyAt,
    lastFailureAt:
      status === "ready" ? input.previous?.lastFailureAt : input.checkedAt,
    consecutiveFailures,
    alertSeverity,
    ...(status === "ready"
      ? {}
      : {
          lastErrorCode: "provider.temporary_failure" as const,
          operatorHint: "One or more provider egress probes failed."
        }),
    ...(publicIpProbe?.status === "success" && publicIpProbe.publicIp
      ? { publicIp: publicIpProbe.publicIp }
      : input.previous?.publicIp
        ? { publicIp: input.previous.publicIp }
        : {}),
    probes,
    alerts,
    workerId: input.workerId
  };
}

function resolveProbeStatus(input: {
  failedProbeCount: number;
  successfulProbeCount: number;
  totalProbeCount: number;
}): InternalEgressStatus {
  if (input.totalProbeCount === 0) {
    return "unknown";
  }

  if (input.failedProbeCount === 0) {
    return "ready";
  }

  if (input.successfulProbeCount === 0) {
    return "unavailable";
  }

  return "degraded";
}

function buildAlerts(input: {
  failedProbes: readonly DeploymentEgressProbeResult[];
  status: InternalEgressStatus;
}): DeploymentEgressAlert[] {
  if (input.status === "ready") {
    return [];
  }

  return [
    {
      severity: resolveAlertSeverity(input.status) as Exclude<
        InternalEgressAlertSeverity,
        "none"
      >,
      code: "egress.probe_failed",
      message:
        input.failedProbes.length === 0
          ? "Provider egress status is unknown."
          : `Failed probes: ${input.failedProbes
              .map((probe) => probe.name)
              .join(", ")}.`
    }
  ];
}

function resolveAlertSeverity(
  status: InternalEgressStatus
): InternalEgressAlertSeverity {
  switch (status) {
    case "ready":
      return "none";
    case "unknown":
    case "degraded":
      return "warning";
    case "unavailable":
    case "misconfigured":
      return "critical";
  }
}

function successfulProbe(
  input: {
    checkedAt: Date;
    probe: EgressProbeDefinition;
  },
  startedAt: number
): DeploymentEgressProbeResult {
  return {
    name: input.probe.name,
    target: input.probe.target,
    status: "success",
    checkedAt: input.checkedAt.toISOString(),
    latencyMs: Date.now() - startedAt
  };
}

function failedProbe(
  input: {
    checkedAt: Date;
    probe: EgressProbeDefinition;
  },
  startedAt: number,
  error: {
    errorCode: string;
    errorMessage: string;
    httpStatus?: number;
  }
): DeploymentEgressProbeResult {
  return {
    name: input.probe.name,
    target: input.probe.target,
    status: "failed",
    checkedAt: input.checkedAt.toISOString(),
    latencyMs: Date.now() - startedAt,
    ...error
  };
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name
    ? `egress.${error.name}`
    : "egress.probe_error";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.slice(0, 500);
  }

  return "Probe failed.";
}

function sanitizePublicIp(value: string): string | undefined {
  const trimmed = value.trim();

  if (/^[0-9a-fA-F:.]{3,80}$/.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

const providerEgressWorkerFeatures = [
  "telegram_bot",
  "telegram_user",
  "whatsapp_user",
  "whatsapp_official",
  "max_user"
] as const satisfies readonly WorkerConfig["workerFeatures"][number][];
