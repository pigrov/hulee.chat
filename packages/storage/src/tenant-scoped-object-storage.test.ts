import { describe, expect, it, vi } from "vitest";

import { calculateHuleeSha256 } from "./checksum";
import type { VersionAwareObjectStorage } from "./contracts";
import { createTenantScopedVersionAwareObjectStorage } from "./tenant-scoped-object-storage";

const scope = {
  tenantId: "tenant:one",
  storageRootId: "core:tenant-object-storage",
  keyPrefix: "tenants/one/files/"
} as const;
const insideKey = `${scope.keyPrefix}object-1`;
const outsideKey = "tenants/two/files/object-1";
const identity = { storageKey: insideKey, versionId: "v1" };

function provider(): VersionAwareObjectStorage {
  return {
    capabilities: {
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
    },
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
        recordedAt: "2026-07-18T12:00:00.000Z"
      }
    })),
    getObjectVersion: vi.fn(),
    headObjectVersion: vi.fn(),
    listObjectVersions: vi.fn(async () => ({ items: [], nextCursor: null })),
    deleteObjectVersion: vi.fn(),
    quarantineObjectVersion: vi.fn(),
    probeCapabilities: vi.fn()
  };
}

describe("tenant-scoped version-aware object storage", () => {
  it("carries an immutable tenant/root capability and forwards in-scope writes", async () => {
    const raw = provider();
    const storage = createTenantScopedVersionAwareObjectStorage(raw, scope);
    const checksumSha256 = calculateHuleeSha256(new Uint8Array([1]));

    expect(storage.scope).toEqual(scope);
    await storage.putObjectImmutable({
      storageKey: insideKey,
      body: new Uint8Array([1]),
      sizeBytes: 1,
      mediaType: "application/octet-stream",
      checksumSha256,
      condition: "key_absent"
    });
    expect(raw.putObjectImmutable).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: insideKey, checksumSha256 })
    );
  });

  it.each([
    [
      "put",
      (
        storage: ReturnType<typeof createTenantScopedVersionAwareObjectStorage>
      ) =>
        storage.putObjectImmutable({
          storageKey: outsideKey,
          body: new Uint8Array(),
          sizeBytes: 0,
          mediaType: "application/octet-stream",
          checksumSha256: calculateHuleeSha256(new Uint8Array()),
          condition: "key_absent"
        })
    ],
    [
      "get",
      (
        storage: ReturnType<typeof createTenantScopedVersionAwareObjectStorage>
      ) =>
        storage.getObjectVersion({
          identity: { ...identity, storageKey: outsideKey },
          maximumBytes: 1
        })
    ],
    [
      "head",
      (
        storage: ReturnType<typeof createTenantScopedVersionAwareObjectStorage>
      ) =>
        storage.headObjectVersion({
          identity: { ...identity, storageKey: outsideKey }
        })
    ],
    [
      "list",
      (
        storage: ReturnType<typeof createTenantScopedVersionAwareObjectStorage>
      ) => storage.listObjectVersions({ prefix: "tenants/two/" })
    ],
    [
      "probe",
      (
        storage: ReturnType<typeof createTenantScopedVersionAwareObjectStorage>
      ) => storage.probeCapabilities({ prefix: "tenants/two/__probe__/" })
    ],
    [
      "delete",
      (
        storage: ReturnType<typeof createTenantScopedVersionAwareObjectStorage>
      ) =>
        storage.deleteObjectVersion({
          identity: { ...identity, storageKey: outsideKey }
        })
    ],
    [
      "quarantine",
      (
        storage: ReturnType<typeof createTenantScopedVersionAwareObjectStorage>
      ) =>
        storage.quarantineObjectVersion({
          identity: { ...identity, storageKey: outsideKey },
          reasonCode: "policy.blocked",
          evidenceSha256: calculateHuleeSha256(new Uint8Array([2]))
        })
    ]
  ] as const)(
    "rejects cross-tenant %s before provider I/O",
    async (_name, run) => {
      const raw = provider();
      const storage = createTenantScopedVersionAwareObjectStorage(raw, scope);

      await expect(run(storage)).rejects.toMatchObject({
        code: "object_storage.invalid_argument",
        ...(_name === "put"
          ? { writeDisposition: "definitely_not_written" }
          : {})
      });
      for (const operation of [
        raw.putObjectImmutable,
        raw.getObjectVersion,
        raw.headObjectVersion,
        raw.listObjectVersions,
        raw.probeCapabilities,
        raw.deleteObjectVersion,
        raw.quarantineObjectVersion
      ]) {
        expect(operation).not.toHaveBeenCalled();
      }
    }
  );

  it("places the default active probe below the trusted tenant/root prefix", async () => {
    const raw = provider();
    const storage = createTenantScopedVersionAwareObjectStorage(raw, scope);

    await storage.probeCapabilities();

    expect(raw.probeCapabilities).toHaveBeenCalledWith({
      prefix: `${scope.keyPrefix}__probe__/`
    });
  });
});
