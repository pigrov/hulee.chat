import {
  ObjectStorageError,
  type ObjectStorageCapabilityProbeCheckName,
  type ProbeObjectStorageCapabilitiesOutput,
  type TenantScopedVersionAwareObjectStorage,
  type TenantScopedVersionAwareObjectStorageResolver
} from "./contracts";

const DEFAULT_CAPABILITY_PROBE_MAXIMUM_AGE_MS = 5 * 60 * 1_000;
const DEFAULT_CAPABILITY_PROBE_FUTURE_SKEW_MS = 30_000;

export type ObjectStorageCapabilityGateOptions = Readonly<{
  maximumProbeAgeMs?: number;
  maximumFutureClockSkewMs?: number;
  now?: () => Date;
}>;

type CapabilityGate = Readonly<{
  storage: TenantScopedVersionAwareObjectStorage;
  ensureReady(): Promise<void>;
}>;

/**
 * Activates tenant-scoped immutable writes only after a recent active provider
 * probe has verified every required exact-version capability. This resolver is
 * intentionally a write-path capability: read/download and remediation paths
 * must keep their separately injected tenant-scoped resolver. No immutable
 * provider write can run without a fresh ready proof.
 */
export function createCapabilityGatedTenantScopedObjectStorageResolver(
  resolver: TenantScopedVersionAwareObjectStorageResolver,
  options: ObjectStorageCapabilityGateOptions = {}
): TenantScopedVersionAwareObjectStorageResolver {
  const normalized = normalizeOptions(options);
  const gates = new Map<
    string,
    Readonly<{
      source: TenantScopedVersionAwareObjectStorage;
      gate: CapabilityGate;
    }>
  >();
  return {
    async resolve(input) {
      const source = await resolver.resolve(input);
      if (source === null) return null;
      if (
        source.scope.tenantId !== input.tenantId ||
        source.scope.storageRootId !== input.storageRootId
      ) {
        throw new ObjectStorageError(
          "object_storage.provider_capability_missing",
          "Object-storage activation resolved a capability outside the requested tenant/root scope."
        );
      }
      const cacheKey = `${input.tenantId}\u0000${input.storageRootId}`;
      let cached = gates.get(cacheKey);
      if (cached === undefined || cached.source !== source) {
        cached = {
          source,
          gate: createCapabilityGate(source, normalized)
        };
        gates.set(cacheKey, cached);
      }
      await cached.gate.ensureReady();
      return cached.gate.storage;
    }
  };
}

function createCapabilityGate(
  source: TenantScopedVersionAwareObjectStorage,
  options: Required<ObjectStorageCapabilityGateOptions>
): CapabilityGate {
  let readyUntilMs = Number.NEGATIVE_INFINITY;
  let probeInFlight: Promise<void> | null = null;

  const currentTimeMs = () => {
    const value = options.now().getTime();
    if (!Number.isFinite(value)) {
      throw activationError("Capability-gate clock is not finite.");
    }
    return value;
  };

  const recordReadyReport = (
    report: ProbeObjectStorageCapabilitiesOutput,
    evaluatedAtMs: number
  ) => {
    const probedAtMs = Date.parse(report.probedAt);
    const failedCheck = requiredProbeChecks().find(
      (check) => report.checks[check].state !== "passed"
    );
    if (
      !report.readyForVersionAwareWrites ||
      report.failure !== null ||
      failedCheck !== undefined ||
      !Number.isFinite(probedAtMs) ||
      probedAtMs > evaluatedAtMs + options.maximumFutureClockSkewMs ||
      evaluatedAtMs - probedAtMs > options.maximumProbeAgeMs
    ) {
      readyUntilMs = Number.NEGATIVE_INFINITY;
      const failure = report.failure;
      throw activationError(
        failure === null
          ? "Active object-storage capability proof is incomplete or stale."
          : `Active object-storage capability proof failed at ${failure.check}: ${failure.errorCode}.`
      );
    }
    readyUntilMs = Math.min(
      probedAtMs + options.maximumProbeAgeMs,
      evaluatedAtMs + options.maximumProbeAgeMs
    );
  };

  const ensureReady = async () => {
    const evaluatedAtMs = currentTimeMs();
    if (evaluatedAtMs < readyUntilMs) return;
    if (probeInFlight !== null) return probeInFlight;
    probeInFlight = (async () => {
      try {
        const report = await source.probeCapabilities();
        recordReadyReport(report, currentTimeMs());
      } catch (error) {
        readyUntilMs = Number.NEGATIVE_INFINITY;
        if (
          error instanceof ObjectStorageError &&
          error.code === "object_storage.provider_capability_missing"
        ) {
          throw error;
        }
        throw activationError(
          "Active object-storage capability proof could not be completed.",
          error
        );
      } finally {
        probeInFlight = null;
      }
    })();
    return probeInFlight;
  };

  const storage: TenantScopedVersionAwareObjectStorage = {
    scope: source.scope,
    capabilities: source.capabilities,
    putObject: (input) => source.putObject(input),
    getObject: (input) => source.getObject(input),
    async putObjectImmutable(input) {
      await ensureReady();
      return source.putObjectImmutable(input);
    },
    getObjectVersion: (input) => source.getObjectVersion(input),
    headObjectVersion: (input) => source.headObjectVersion(input),
    listObjectVersions: (input) => source.listObjectVersions(input),
    deleteObjectVersion: (input) => source.deleteObjectVersion(input),
    quarantineObjectVersion: (input) => source.quarantineObjectVersion(input),
    async probeCapabilities(input) {
      const report = await source.probeCapabilities(input);
      try {
        recordReadyReport(report, currentTimeMs());
      } catch {
        // Diagnostic probes still return their structured failure. The next
        // immutable write remains deactivated and will fail closed.
      }
      return report;
    }
  };
  return { storage, ensureReady };
}

function normalizeOptions(
  options: ObjectStorageCapabilityGateOptions
): Required<ObjectStorageCapabilityGateOptions> {
  const maximumProbeAgeMs =
    options.maximumProbeAgeMs ?? DEFAULT_CAPABILITY_PROBE_MAXIMUM_AGE_MS;
  const maximumFutureClockSkewMs =
    options.maximumFutureClockSkewMs ?? DEFAULT_CAPABILITY_PROBE_FUTURE_SKEW_MS;
  if (
    !Number.isSafeInteger(maximumProbeAgeMs) ||
    maximumProbeAgeMs < 1_000 ||
    maximumProbeAgeMs > 86_400_000 ||
    !Number.isSafeInteger(maximumFutureClockSkewMs) ||
    maximumFutureClockSkewMs < 0 ||
    maximumFutureClockSkewMs > 300_000
  ) {
    throw new TypeError("Object-storage capability-gate bounds are invalid.");
  }
  return {
    maximumProbeAgeMs,
    maximumFutureClockSkewMs,
    now: options.now ?? (() => new Date())
  };
}

function requiredProbeChecks(): readonly ObjectStorageCapabilityProbeCheckName[] {
  return [
    "bucketVersioning",
    "versionEnumerationApi",
    "immutableWrite",
    "exactVersionHead",
    "streamingReadChecksum",
    "exactVersionEnumeration",
    "immutableConditionalPut",
    "physicalQuarantineEvidence",
    "exactVersionDelete",
    "cleanup"
  ];
}

function activationError(message: string, cause?: unknown): ObjectStorageError {
  return new ObjectStorageError(
    "object_storage.provider_capability_missing",
    message,
    cause === undefined ? undefined : { cause }
  );
}
