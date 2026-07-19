import { describe, expect, it, vi } from "vitest";

import { calculateHuleeSha256 } from "./checksum";
import {
  type ObjectStorageCapabilityProbeCheckName,
  type ProbeObjectStorageCapabilitiesOutput,
  type VersionAwareObjectStorage
} from "./contracts";
import { createCapabilityGatedTenantScopedObjectStorageResolver } from "./capability-gated-object-storage";
import { createTenantScopedVersionAwareObjectStorage } from "./tenant-scoped-object-storage";

const scope = {
  tenantId: "tenant:capability-gate",
  storageRootId: "core:tenant-object-storage",
  keyPrefix: "tenants/capability-gate/files/"
} as const;
const storageKey = `${scope.keyPrefix}object-1`;
const t0 = "2026-07-18T12:00:00.000Z";

describe("capability-gated tenant object storage", () => {
  it("activates once, caches a fresh proof and re-probes before a later write", async () => {
    let now = new Date(t0);
    const raw = provider([
      probeReport(t0),
      probeReport("2026-07-18T12:00:02.000Z", "exactVersionDelete")
    ]);
    const resolver = createCapabilityGatedTenantScopedObjectStorageResolver(
      staticResolver(raw),
      {
        maximumProbeAgeMs: 1_000,
        now: () => now
      }
    );

    const first = await resolver.resolve(scope);
    expect(first).not.toBeNull();
    const checksumSha256 = calculateHuleeSha256(new Uint8Array([1]));
    await first!.putObjectImmutable({
      storageKey,
      body: new Uint8Array([1]),
      sizeBytes: 1,
      mediaType: "application/octet-stream",
      checksumSha256,
      condition: "key_absent"
    });
    await expect(resolver.resolve(scope)).resolves.toBe(first);
    expect(raw.probeCapabilities).toHaveBeenCalledTimes(1);
    expect(raw.putObjectImmutable).toHaveBeenCalledTimes(1);

    now = new Date("2026-07-18T12:00:02.000Z");
    await expect(
      first!.putObjectImmutable({
        storageKey,
        body: new Uint8Array([1]),
        sizeBytes: 1,
        mediaType: "application/octet-stream",
        checksumSha256,
        condition: "key_absent"
      })
    ).rejects.toMatchObject({
      code: "object_storage.provider_capability_missing"
    });
    expect(raw.probeCapabilities).toHaveBeenCalledTimes(2);
    expect(raw.putObjectImmutable).toHaveBeenCalledTimes(1);
  });

  it("fails resolver activation closed for a failed or stale proof", async () => {
    const failed = provider([probeReport(t0, "bucketVersioning")]);
    const failedResolver =
      createCapabilityGatedTenantScopedObjectStorageResolver(
        staticResolver(failed),
        { now: () => new Date(t0) }
      );
    await expect(failedResolver.resolve(scope)).rejects.toMatchObject({
      code: "object_storage.provider_capability_missing"
    });
    expect(failed.putObjectImmutable).not.toHaveBeenCalled();

    const stale = provider([probeReport("2026-07-18T11:50:00.000Z")]);
    const staleResolver =
      createCapabilityGatedTenantScopedObjectStorageResolver(
        staticResolver(stale),
        {
          maximumProbeAgeMs: 60_000,
          now: () => new Date(t0)
        }
      );
    await expect(staleResolver.resolve(scope)).rejects.toMatchObject({
      code: "object_storage.provider_capability_missing"
    });
    expect(stale.putObjectImmutable).not.toHaveBeenCalled();

    const future = provider([probeReport("2026-07-18T12:02:00.000Z")]);
    const futureResolver =
      createCapabilityGatedTenantScopedObjectStorageResolver(
        staticResolver(future),
        {
          maximumFutureClockSkewMs: 5_000,
          now: () => new Date(t0)
        }
      );
    await expect(futureResolver.resolve(scope)).rejects.toMatchObject({
      code: "object_storage.provider_capability_missing"
    });
    expect(future.putObjectImmutable).not.toHaveBeenCalled();

    const cleanupIncomplete = provider([probeReport(t0, "cleanup")]);
    const cleanupResolver =
      createCapabilityGatedTenantScopedObjectStorageResolver(
        staticResolver(cleanupIncomplete),
        { now: () => new Date(t0) }
      );
    await expect(cleanupResolver.resolve(scope)).rejects.toMatchObject({
      code: "object_storage.provider_capability_missing"
    });
    expect(cleanupIncomplete.putObjectImmutable).not.toHaveBeenCalled();
  });

  it("collapses concurrent activation onto one active provider probe", async () => {
    const pending = deferred<ProbeObjectStorageCapabilitiesOutput>();
    const raw = provider([]);
    vi.mocked(raw.probeCapabilities).mockImplementationOnce(
      async () => pending.promise
    );
    const resolver = createCapabilityGatedTenantScopedObjectStorageResolver(
      staticResolver(raw),
      { now: () => new Date(t0) }
    );

    const first = resolver.resolve(scope);
    const second = resolver.resolve(scope);
    await vi.waitFor(() => {
      expect(raw.probeCapabilities).toHaveBeenCalledTimes(1);
    });
    pending.resolve(probeReport(t0));
    const [firstStorage, secondStorage] = await Promise.all([first, second]);
    expect(firstStorage).toBe(secondStorage);
  });

  it("shares one refresh probe across concurrent puts and invalidates proof on source rotation", async () => {
    let now = new Date(t0);
    const refresh = deferred<ProbeObjectStorageCapabilitiesOutput>();
    const firstRaw = provider([probeReport(t0)]);
    const firstScoped = createTenantScopedVersionAwareObjectStorage(
      firstRaw,
      scope
    );
    const secondRaw = provider([probeReport("2026-07-18T12:00:02.000Z")]);
    const secondScoped = createTenantScopedVersionAwareObjectStorage(
      secondRaw,
      scope
    );
    const sourceResolver = {
      resolve: vi
        .fn()
        .mockResolvedValueOnce(firstScoped)
        .mockResolvedValueOnce(firstScoped)
        .mockResolvedValueOnce(secondScoped)
    };
    const resolver = createCapabilityGatedTenantScopedObjectStorageResolver(
      sourceResolver,
      {
        maximumProbeAgeMs: 1_000,
        now: () => now
      }
    );
    const activated = await resolver.resolve(scope);
    expect(activated).not.toBeNull();
    now = new Date("2026-07-18T12:00:02.000Z");
    vi.mocked(firstRaw.probeCapabilities).mockImplementationOnce(
      async () => refresh.promise
    );
    const input = {
      storageKey,
      body: new Uint8Array([1]),
      sizeBytes: 1,
      mediaType: "application/octet-stream",
      checksumSha256: calculateHuleeSha256(new Uint8Array([1])),
      condition: "key_absent" as const
    };
    const firstPut = activated!.putObjectImmutable(input);
    const secondPut = activated!.putObjectImmutable(input);
    await vi.waitFor(() => {
      expect(firstRaw.probeCapabilities).toHaveBeenCalledTimes(2);
    });
    refresh.resolve(probeReport("2026-07-18T12:00:02.000Z"));
    await Promise.all([firstPut, secondPut]);
    expect(firstRaw.putObjectImmutable).toHaveBeenCalledTimes(2);

    await expect(resolver.resolve(scope)).resolves.toBe(activated);
    const rotated = await resolver.resolve(scope);
    expect(rotated).not.toBe(activated);
    expect(secondRaw.probeCapabilities).toHaveBeenCalledTimes(1);
  });
});

function staticResolver(raw: VersionAwareObjectStorage) {
  const scoped = createTenantScopedVersionAwareObjectStorage(raw, scope);
  return {
    resolve: vi.fn(async () => scoped)
  };
}

function provider(
  reports: ProbeObjectStorageCapabilitiesOutput[]
): VersionAwareObjectStorage {
  return {
    capabilities: capabilities(),
    putObject: vi.fn(async () => undefined),
    getObject: vi.fn(async () => ({ body: new Uint8Array() })),
    putObjectImmutable: vi.fn(async (input) => ({
      outcome: "created" as const,
      object: {
        storageKey: input.storageKey,
        versionId: "v1",
        checksumSha256: input.checksumSha256,
        sizeBytes: input.sizeBytes,
        mediaType: input.mediaType,
        lastModified: null,
        state: "available" as const,
        quarantineEvidence: null
      },
      providerReceipt: {
        kind: "s3_put_object" as const,
        checksumVerifiedByProvider: true,
        recordedAt: t0
      }
    })),
    getObjectVersion: vi.fn(),
    headObjectVersion: vi.fn(),
    listObjectVersions: vi.fn(),
    deleteObjectVersion: vi.fn(),
    quarantineObjectVersion: vi.fn(),
    probeCapabilities: vi.fn(async () => {
      const report = reports.shift();
      if (report === undefined) throw new Error("Unexpected capability probe.");
      return report;
    })
  };
}

function probeReport(
  probedAt: string,
  failedCheck?: ObjectStorageCapabilityProbeCheckName
): ProbeObjectStorageCapabilitiesOutput {
  const checks = Object.fromEntries(
    checkNames().map((name) => [
      name,
      name === failedCheck
        ? {
            state: "failed" as const,
            errorCode: "object_storage.provider_capability_missing" as const,
            message: "required capability unavailable"
          }
        : { state: "passed" as const, errorCode: null, message: null }
    ])
  ) as ProbeObjectStorageCapabilitiesOutput["checks"];
  return {
    provider: "s3",
    capabilities: capabilities(),
    bucketVersioning:
      failedCheck === "bucketVersioning" ? "disabled" : "enabled",
    versionEnumeration: "supported",
    observedVersionCount: 1,
    observedDeleteMarkerCount: 1,
    checks,
    failure:
      failedCheck === undefined
        ? null
        : {
            check: failedCheck,
            errorCode: "object_storage.provider_capability_missing",
            message: "required capability unavailable"
          },
    readyForVersionAwareWrites: failedCheck === undefined,
    probedAt
  };
}

function capabilities() {
  return {
    contractVersion: "1",
    exactVersionIdentity: true,
    immutableConditionalPut: true,
    streamingReads: true,
    boundedRangeReads: true,
    paginatedVersionEnumeration: true,
    deleteMarkerEnumeration: true,
    exactVersionDelete: true,
    applicationQuarantineDeny: true,
    physicalQuarantineEvidence: "version_tags",
    checksumAlgorithm: "sha256",
    providerEntityTagIsChecksum: false,
    originalFileNameInObjectMetadata: false
  } as const;
}

function checkNames(): readonly ObjectStorageCapabilityProbeCheckName[] {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
