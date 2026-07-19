import {
  calculateHuleeSha256,
  createTenantScopedVersionAwareObjectStorage,
  type ObjectStorageObjectVersion,
  type VersionAwareObjectStorage
} from "@hulee/storage";
import { describe, expect, it, vi } from "vitest";

import {
  createInboxV2AttachmentMaterializationCoordinator,
  InboxV2AttachmentMaterializationSourceError,
  type InboxV2AttachmentMaterializationClaim,
  type InboxV2AttachmentMaterializationRepository
} from "./inbox-v2-attachment-materialization-coordinator";

const body = new Uint8Array([1, 2, 3]);
const checksum = calculateHuleeSha256(body);
const claim: InboxV2AttachmentMaterializationClaim = {
  tenantId: "tenant:one",
  jobId: "attachment_materialization_job:one",
  attemptId: "attachment_materialization_attempt:one",
  leaseToken: "lease-token-that-is-long-enough",
  expectedJobRevision: "2",
  fileId: "file:one",
  expectedFileRevision: "1",
  fileVersionId: "file_version:one",
  objectVersionId: "file_object_version:one",
  storageRootId: "core:tenant-object-storage",
  storageKey: "tenants/opaque/object-one",
  claimedAt: "2026-07-18T12:00:00.000Z",
  leaseExpiresAt: "2026-07-18T12:05:00.000Z",
  sourceLocator: { kind: "provider", reference: `src_ref_${"a".repeat(43)}` }
};

function storedObject(
  overrides: Partial<ObjectStorageObjectVersion> = {}
): ObjectStorageObjectVersion {
  return {
    storageKey: claim.storageKey,
    versionId: "provider-version-1",
    checksumSha256: checksum,
    sizeBytes: body.byteLength,
    mediaType: "image/jpeg",
    lastModified: "2026-07-18T12:00:00.000Z",
    state: "available",
    quarantineEvidence: null,
    ...overrides
  };
}

function storage(): VersionAwareObjectStorage {
  const capabilities = {
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
  return {
    capabilities,
    putObject: vi.fn(async () => undefined),
    getObject: vi.fn(async () => ({ body })),
    putObjectImmutable: vi.fn(async () => ({
      outcome: "created" as const,
      object: storedObject(),
      providerReceipt: {
        kind: "s3_put_object" as const,
        checksumVerifiedByProvider: true,
        recordedAt: "2026-07-18T12:00:00.000Z"
      }
    })),
    getObjectVersion: vi.fn(),
    headObjectVersion: vi.fn(),
    listObjectVersions: vi.fn(),
    deleteObjectVersion: vi.fn(),
    quarantineObjectVersion: vi.fn(async (input) => ({
      outcome: "quarantined" as const,
      identity: input.identity,
      evidence: {
        reasonCode: input.reasonCode,
        evidenceSha256: input.evidenceSha256,
        physicalKind: "s3_object_version_tags" as const
      },
      recordedAt: "2026-07-18T12:00:01.000Z"
    })),
    probeCapabilities: vi.fn(async () => ({
      provider: "s3" as const,
      capabilities,
      bucketVersioning: "enabled" as const,
      versionEnumeration: "supported" as const,
      observedVersionCount: 1,
      observedDeleteMarkerCount: 1,
      checks: Object.fromEntries(
        [
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
        ].map((name) => [
          name,
          { state: "passed" as const, errorCode: null, message: null }
        ])
      ) as never,
      failure: null,
      readyForVersionAwareWrites: true,
      probedAt: "2026-07-18T12:01:00.000Z"
    }))
  };
}

function repository(): InboxV2AttachmentMaterializationRepository {
  return {
    authorizeMaterializationIo: vi.fn(async () => "authorized" as const),
    finalizeReady: vi.fn(async () => "applied" as const),
    finalizeFailed: vi.fn(async () => "applied" as const),
    recordOrphan: vi.fn(async () => "recorded" as const)
  };
}

function coordinator(
  repo: InboxV2AttachmentMaterializationRepository,
  objectStorage: VersionAwareObjectStorage
) {
  return createInboxV2AttachmentMaterializationCoordinator({
    repository: repo,
    storageResolver: resolver(objectStorage),
    sourceLoader: {
      verify: vi.fn(),
      open: vi.fn(async (_claim, _signal) => ({
        body,
        sizeBytes: body.byteLength,
        mediaType: "image/jpeg",
        checksumSha256: checksum
      }))
    },
    clock: { now: () => "2026-07-18T12:01:00.000Z" }
  });
}

function resolver(
  objectStorage: VersionAwareObjectStorage,
  overrides: Partial<{
    tenantId: string;
    storageRootId: string;
    keyPrefix: string;
  }> = {}
) {
  const scoped = createTenantScopedVersionAwareObjectStorage(objectStorage, {
    tenantId: claim.tenantId,
    storageRootId: claim.storageRootId,
    keyPrefix: "tenants/opaque/",
    ...overrides
  });
  return { resolve: vi.fn(async () => scoped) };
}

describe("Inbox V2 attachment materialization coordinator", () => {
  it("publishes ready only after exact-version storage and DB finalization", async () => {
    const repo = repository();
    const objectStorage = storage();
    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toEqual({
      outcome: "ready",
      persistence: "applied",
      storageVersionId: "provider-version-1"
    });
    expect(objectStorage.putObjectImmutable).toHaveBeenCalledWith({
      storageKey: claim.storageKey,
      body,
      sizeBytes: 3,
      mediaType: "image/jpeg",
      checksumSha256: checksum,
      condition: "key_absent",
      signal: expect.any(AbortSignal)
    });
    expect(repo.finalizeReady).toHaveBeenCalledOnce();
    expect(repo.recordOrphan).not.toHaveBeenCalled();
  });

  it.each([
    [
      "typed unsupported media",
      new InboxV2AttachmentMaterializationSourceError(
        "provider_media_unsupported",
        false
      ),
      false,
      "provider_media_unsupported"
    ],
    [
      "typed transient source failure",
      new InboxV2AttachmentMaterializationSourceError(
        "provider_source_temporarily_unavailable",
        true
      ),
      true,
      "provider_source_temporarily_unavailable"
    ]
  ])(
    "persists %s with trusted retryability",
    async (_label, error, expectedRetryable, expectedCode) => {
      const repo = repository();
      const objectStorage = storage();
      const service = createInboxV2AttachmentMaterializationCoordinator({
        repository: repo,
        storageResolver: resolver(objectStorage),
        sourceLoader: {
          verify: vi.fn(),
          open: vi.fn(async () => Promise.reject(error))
        },
        clock: { now: () => "2026-07-18T12:01:00.000Z" }
      });

      await expect(service.process(claim)).resolves.toEqual({
        outcome: "visible_fallback",
        code: expectedCode,
        retryable: expectedRetryable,
        persistence: "applied"
      });
      expect(repo.finalizeFailed).toHaveBeenCalledOnce();
      expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
    }
  );

  it("keeps an untrusted source exception nonterminal", async () => {
    const repo = repository();
    const objectStorage = storage();
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: resolver(objectStorage),
      sourceLoader: {
        verify: vi.fn(),
        open: vi.fn(async () =>
          Promise.reject(
            Object.assign(new Error("untrusted"), {
              code: "provider_media_unsupported",
              retryable: false
            })
          )
        )
      },
      clock: { now: () => "2026-07-18T12:01:00.000Z" }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "indeterminate",
      code: "provider_media_unsupported"
    });
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
    expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
  });

  it("keeps a trusted namespace/configuration gap nonterminal", async () => {
    const repo = repository();
    const objectStorage = storage();
    const storageResolver = resolver(objectStorage);
    const open = vi.fn();
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver,
      sourceLoader: {
        verify: vi.fn(async () =>
          Promise.reject(
            new InboxV2AttachmentMaterializationSourceError(
              "source_locator_namespace_unavailable",
              true,
              "indeterminate"
            )
          )
        ),
        open
      },
      clock: { now: () => "2026-07-18T12:01:00.000Z" }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "indeterminate",
      code: "source_locator_namespace_unavailable"
    });
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
    expect(repo.finalizeReady).not.toHaveBeenCalled();
    expect(repo.recordOrphan).not.toHaveBeenCalled();
    expect(storageResolver.resolve).not.toHaveBeenCalled();
    expect(objectStorage.probeCapabilities).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
  });

  it("rejects an oversized source before immutable storage I/O", async () => {
    const repo = repository();
    const objectStorage = storage();
    const open = vi.fn(async () => ({
      body,
      sizeBytes: body.byteLength,
      mediaType: "image/jpeg",
      checksumSha256: checksum
    }));
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: resolver(objectStorage),
      sourceLoader: { verify: vi.fn(), open },
      maximumAttachmentBytes: 2,
      clock: { now: () => "2026-07-18T12:01:00.000Z" }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "visible_fallback",
      code: "attachment_size_limit_exceeded",
      retryable: false,
      persistence: "applied"
    });
    expect(open).toHaveBeenCalledWith(claim, {
      signal: expect.any(AbortSignal),
      maximumBytes: 2
    });
    expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
    expect(repo.finalizeFailed).toHaveBeenCalledOnce();
  });

  it("rejects a non-canonical source media type before immutable storage I/O", async () => {
    const repo = repository();
    const objectStorage = storage();
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: resolver(objectStorage),
      sourceLoader: {
        verify: vi.fn(),
        open: vi.fn(async () => ({
          body,
          sizeBytes: body.byteLength,
          mediaType: "image/jpeg; charset=binary",
          checksumSha256: checksum
        }))
      },
      clock: { now: () => "2026-07-18T12:01:00.000Z" }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "visible_fallback",
      code: "source_media_type_invalid",
      retryable: false,
      persistence: "applied"
    });
    expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
    expect(repo.finalizeFailed).toHaveBeenCalledOnce();
    expect(repo.recordOrphan).not.toHaveBeenCalled();
  });

  it("rejects an invalid attachment byte policy at composition time", () => {
    expect(() =>
      createInboxV2AttachmentMaterializationCoordinator({
        repository: repository(),
        storageResolver: resolver(storage()),
        sourceLoader: { verify: vi.fn(), open: vi.fn() },
        maximumAttachmentBytes: 0
      })
    ).toThrow("maximumAttachmentBytes must be a positive safe integer");
  });

  it("keeps a lost PUT acknowledgement reconcilable and adopts the deterministic retry", async () => {
    const repo = repository();
    const objectStorage = storage();
    vi.mocked(objectStorage.putObjectImmutable).mockRejectedValueOnce(
      Object.assign(new Error("down"), {
        code: "object_storage.provider_failure"
      })
    );

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toEqual({
      outcome: "indeterminate",
      code: "object_storage.provider_failure"
    });
    expect(repo.finalizeReady).not.toHaveBeenCalled();
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
    expect(repo.recordOrphan).not.toHaveBeenCalled();

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toEqual({
      outcome: "ready",
      persistence: "applied",
      storageVersionId: "provider-version-1"
    });
    expect(objectStorage.putObjectImmutable).toHaveBeenCalledTimes(2);
    expect(repo.finalizeReady).toHaveBeenCalledOnce();
  });

  it("persists a visible fallback only for a definite provider write rejection", async () => {
    const repo = repository();
    const objectStorage = storage();
    vi.mocked(objectStorage.putObjectImmutable).mockRejectedValueOnce(
      Object.assign(new Error("access denied"), {
        code: "object_storage.write_rejected",
        writeDisposition: "definitely_not_written"
      })
    );

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toEqual({
      outcome: "visible_fallback",
      code: "object_storage.write_rejected",
      retryable: false,
      persistence: "applied"
    });
    expect(repo.finalizeReady).not.toHaveBeenCalled();
    expect(repo.finalizeFailed).toHaveBeenCalledOnce();
  });

  it("terminalizes invalid source write input only when storage proves no write occurred", async () => {
    const repo = repository();
    const objectStorage = storage();
    vi.mocked(objectStorage.putObjectImmutable).mockRejectedValueOnce(
      Object.assign(new Error("invalid checksum"), {
        code: "object_storage.invalid_argument",
        writeDisposition: "definitely_not_written"
      })
    );

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toEqual({
      outcome: "visible_fallback",
      code: "object_storage.invalid_argument",
      retryable: false,
      persistence: "applied"
    });
    expect(repo.finalizeFailed).toHaveBeenCalledOnce();
    expect(repo.recordOrphan).not.toHaveBeenCalled();
  });

  it("does not trust a terminal-looking adapter code without an explicit no-write disposition", async () => {
    const repo = repository();
    const objectStorage = storage();
    vi.mocked(objectStorage.putObjectImmutable).mockRejectedValueOnce(
      Object.assign(new Error("untrusted rejection"), {
        code: "object_storage.write_rejected"
      })
    );

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toEqual({
      outcome: "indeterminate",
      code: "object_storage.write_rejected"
    });
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
    expect(repo.recordOrphan).not.toHaveBeenCalled();
  });

  it("records exact existing-version evidence instead of terminalizing a write conflict", async () => {
    const repo = repository();
    const objectStorage = storage();
    const observedChecksum = calculateHuleeSha256(new Uint8Array([9, 8, 7]));
    vi.mocked(objectStorage.putObjectImmutable).mockRejectedValueOnce(
      Object.assign(new Error("existing version differs"), {
        code: "object_storage.immutable_conflict",
        writeDisposition: "exact_version_observed",
        exactVersionEvidence: {
          identity: {
            storageKey: claim.storageKey,
            versionId: "provider-version-conflict"
          },
          checksumSha256: observedChecksum,
          sizeBytes: 3,
          mediaType: "application/octet-stream"
        }
      })
    );

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toMatchObject({
      outcome: "orphan_recorded",
      code: "object_storage.immutable_conflict",
      identity: {
        storageKey: claim.storageKey,
        versionId: "provider-version-conflict"
      }
    });
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
    expect(repo.recordOrphan).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: {
          storageKey: claim.storageKey,
          versionId: "provider-version-conflict"
        },
        checksumSha256: observedChecksum,
        sizeBytes: 3,
        mediaType: "application/octet-stream",
        reasonCode: "object_storage.immutable_conflict"
      })
    );
  });

  it("retains physical quarantine evidence from an exact-version write error", async () => {
    const repo = repository();
    const objectStorage = storage();
    const observedChecksum = calculateHuleeSha256(new Uint8Array([9, 8, 7]));
    const quarantine = {
      reasonCode: "integrity.conditional_replay_mismatch",
      evidenceSha256: calculateHuleeSha256(new Uint8Array([7, 7, 7])),
      physicalKind: "s3_object_version_tags" as const
    };
    vi.mocked(objectStorage.putObjectImmutable).mockRejectedValueOnce(
      Object.assign(new Error("corrupt conditional replay"), {
        code: "object_storage.immutable_conflict",
        writeDisposition: "exact_version_observed",
        exactVersionEvidence: {
          identity: {
            storageKey: claim.storageKey,
            versionId: "provider-version-quarantined"
          },
          checksumSha256: observedChecksum,
          sizeBytes: 3,
          mediaType: "application/octet-stream"
        },
        quarantineEvidence: quarantine
      })
    );

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toMatchObject({
      outcome: "orphan_recorded",
      code: "object_storage.immutable_conflict",
      identity: {
        storageKey: claim.storageKey,
        versionId: "provider-version-quarantined"
      }
    });
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
    expect(repo.recordOrphan).toHaveBeenCalledWith(
      expect.objectContaining({
        checksumSha256: observedChecksum,
        sizeBytes: 3,
        mediaType: "application/octet-stream",
        quarantine
      })
    );
  });

  it("never finalizes an adapter result carrying physical quarantine evidence as ready", async () => {
    const repo = repository();
    const objectStorage = storage();
    const quarantine = {
      reasonCode: "integrity.provider_checksum_mismatch",
      evidenceSha256: calculateHuleeSha256(new Uint8Array([7, 7, 7])),
      physicalKind: "s3_object_version_tags" as const
    };
    vi.mocked(objectStorage.putObjectImmutable).mockResolvedValueOnce({
      outcome: "created",
      object: storedObject({ quarantineEvidence: quarantine }),
      providerReceipt: {
        kind: "s3_put_object",
        checksumVerifiedByProvider: true,
        recordedAt: "2026-07-18T12:00:00.000Z"
      }
    });

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toMatchObject({
      outcome: "orphan_recorded",
      code: "object_integrity_mismatch"
    });
    expect(repo.finalizeReady).not.toHaveBeenCalled();
    expect(repo.recordOrphan).toHaveBeenCalledWith(
      expect.objectContaining({ quarantine })
    );
  });

  it("records storage uncertainty without quarantining after a DB failure", async () => {
    const repo = repository();
    vi.mocked(repo.finalizeReady).mockRejectedValueOnce(
      new Error("db unavailable")
    );
    const objectStorage = storage();

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toMatchObject({
      outcome: "orphan_recorded",
      code: "ready_finalize_failed",
      identity: {
        storageKey: claim.storageKey,
        versionId: "provider-version-1"
      }
    });
    expect(objectStorage.quarantineObjectVersion).not.toHaveBeenCalled();
    expect(repo.recordOrphan).toHaveBeenCalledWith(
      expect.objectContaining({
        claim,
        reasonCode: "ready_finalize_failed",
        quarantine: null
      })
    );
  });

  it("fails closed and records a checksum or size substitution", async () => {
    const repo = repository();
    const objectStorage = storage();
    vi.mocked(objectStorage.putObjectImmutable).mockResolvedValueOnce({
      outcome: "created",
      object: storedObject({
        checksumSha256: calculateHuleeSha256(new Uint8Array([9]))
      }),
      providerReceipt: {
        kind: "s3_put_object",
        checksumVerifiedByProvider: false,
        recordedAt: "2026-07-18T12:00:00.000Z"
      }
    });

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toMatchObject({
      outcome: "orphan_recorded",
      code: "object_integrity_mismatch"
    });
    expect(repo.finalizeReady).not.toHaveBeenCalled();
    expect(objectStorage.quarantineObjectVersion).not.toHaveBeenCalled();
  });

  it("fails closed when stored object media type differs from the verified source", async () => {
    const repo = repository();
    const objectStorage = storage();
    vi.mocked(objectStorage.putObjectImmutable).mockResolvedValueOnce({
      outcome: "already_exists",
      object: storedObject({ mediaType: "application/octet-stream" }),
      providerReceipt: {
        kind: "s3_head_object",
        checksumVerifiedByProvider: true,
        recordedAt: "2026-07-18T12:00:00.000Z"
      }
    });

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toMatchObject({
      outcome: "orphan_recorded",
      code: "object_integrity_mismatch"
    });
    expect(repo.finalizeReady).not.toHaveBeenCalled();
    expect(repo.recordOrphan).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: "application/octet-stream",
        reasonCode: "object_integrity_mismatch"
      })
    );
  });

  it("does not invent exact orphan facts when provider evidence is incomplete", async () => {
    const repo = repository();
    const objectStorage = storage();
    vi.mocked(objectStorage.putObjectImmutable).mockResolvedValueOnce({
      outcome: "already_exists",
      object: storedObject({ checksumSha256: null }),
      providerReceipt: {
        kind: "s3_head_object",
        checksumVerifiedByProvider: false,
        recordedAt: "2026-07-18T12:00:00.000Z"
      }
    });

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toEqual({
      outcome: "indeterminate",
      code: "object_integrity_evidence_incomplete"
    });
    expect(repo.finalizeReady).not.toHaveBeenCalled();
    expect(repo.recordOrphan).not.toHaveBeenCalled();
  });

  it("retains physical quarantine evidence for an exact corrupt version", async () => {
    const repo = repository();
    const objectStorage = storage();
    const quarantine = {
      reasonCode: "integrity.conditional_replay_mismatch",
      evidenceSha256: calculateHuleeSha256(new Uint8Array([7, 7, 7])),
      physicalKind: "s3_object_version_tags" as const
    };
    vi.mocked(objectStorage.putObjectImmutable).mockResolvedValueOnce({
      outcome: "already_exists",
      object: storedObject({
        state: "quarantined",
        quarantineEvidence: quarantine
      }),
      providerReceipt: {
        kind: "s3_head_object",
        checksumVerifiedByProvider: true,
        recordedAt: "2026-07-18T12:00:00.000Z"
      }
    });

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toMatchObject({
      outcome: "orphan_recorded",
      code: "object_integrity_mismatch"
    });
    expect(repo.recordOrphan).toHaveBeenCalledWith(
      expect.objectContaining({ quarantine })
    );
  });

  it("rejects returned object evidence outside the claimed storage key", async () => {
    const repo = repository();
    const objectStorage = storage();
    vi.mocked(objectStorage.putObjectImmutable).mockResolvedValueOnce({
      outcome: "created",
      object: storedObject({ storageKey: "tenants/opaque/substituted" }),
      providerReceipt: {
        kind: "s3_put_object",
        checksumVerifiedByProvider: true,
        recordedAt: "2026-07-18T12:00:00.000Z"
      }
    });

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toEqual({
      outcome: "indeterminate",
      code: "object_write_evidence_scope_mismatch"
    });
    expect(repo.finalizeReady).not.toHaveBeenCalled();
    expect(repo.recordOrphan).not.toHaveBeenCalled();
  });

  it("leaves an unrecorded exact version discoverable when orphan evidence DB write fails", async () => {
    const repo = repository();
    vi.mocked(repo.finalizeReady).mockResolvedValueOnce("lease_lost");
    vi.mocked(repo.recordOrphan).mockRejectedValueOnce(
      new Error("db unavailable")
    );
    const objectStorage = storage();

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toMatchObject({
      outcome: "orphan_unrecorded",
      code: "ready_finalize_lease_lost"
    });
    expect(objectStorage.quarantineObjectVersion).not.toHaveBeenCalled();
  });

  it("treats a lost DB acknowledgement as adopted without quarantining", async () => {
    const repo = repository();
    vi.mocked(repo.finalizeReady).mockRejectedValueOnce(
      new Error("commit acknowledgement lost")
    );
    vi.mocked(repo.recordOrphan).mockResolvedValueOnce("adopted");
    const objectStorage = storage();

    await expect(
      coordinator(repo, objectStorage).process(claim)
    ).resolves.toMatchObject({
      outcome: "ready_reconciled",
      code: "ready_finalize_failed",
      identity: {
        storageKey: claim.storageKey,
        versionId: "provider-version-1"
      }
    });
    expect(objectStorage.quarantineObjectVersion).not.toHaveBeenCalled();
  });

  it("accepts an idempotent durable replay without another state transition", async () => {
    const repo = repository();
    vi.mocked(repo.finalizeReady).mockResolvedValueOnce("already_applied");

    await expect(
      coordinator(repo, storage()).process(claim)
    ).resolves.toMatchObject({
      outcome: "ready",
      persistence: "already_applied"
    });
  });

  it("performs zero source or storage I/O for an already expired lease", async () => {
    const repo = repository();
    const objectStorage = storage();
    const open = vi.fn();
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: resolver(objectStorage),
      sourceLoader: { verify: vi.fn(), open },
      clock: { now: () => "2026-07-18T12:05:00.000Z" }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "indeterminate",
      code: "materialization_lease_expired_before_io"
    });
    expect(open).not.toHaveBeenCalled();
    expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
    expect(repo.finalizeReady).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "already_terminal"] as const)(
    "performs zero provider or storage I/O when the current fence is %s",
    async (persistence) => {
      const repo = repository();
      vi.mocked(repo.authorizeMaterializationIo).mockResolvedValueOnce(
        persistence
      );
      const objectStorage = storage();
      const storageResolver = resolver(objectStorage);
      const open = vi.fn();
      const service = createInboxV2AttachmentMaterializationCoordinator({
        repository: repo,
        storageResolver,
        sourceLoader: { verify: vi.fn(), open },
        clock: { now: () => "2026-07-18T12:01:00.000Z" }
      });

      await expect(service.process(claim)).resolves.toEqual({
        outcome: "cancelled",
        persistence
      });
      expect(repo.authorizeMaterializationIo).toHaveBeenCalledWith(claim);
      expect(storageResolver.resolve).not.toHaveBeenCalled();
      expect(objectStorage.probeCapabilities).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
      expect(repo.finalizeReady).not.toHaveBeenCalled();
      expect(repo.finalizeFailed).not.toHaveBeenCalled();
      expect(repo.recordOrphan).not.toHaveBeenCalled();
    }
  );

  it.each([
    "authorization_refresh_required",
    "lease_lost",
    "state_conflict"
  ] as const)(
    "fails closed before I/O when current-fence authorization returns %s",
    async (authorization) => {
      const repo = repository();
      vi.mocked(repo.authorizeMaterializationIo).mockResolvedValueOnce(
        authorization
      );
      const objectStorage = storage();
      const storageResolver = resolver(objectStorage);
      const open = vi.fn();
      const service = createInboxV2AttachmentMaterializationCoordinator({
        repository: repo,
        storageResolver,
        sourceLoader: { verify: vi.fn(), open },
        clock: { now: () => "2026-07-18T12:01:00.000Z" }
      });

      await expect(service.process(claim)).resolves.toEqual({
        outcome: "indeterminate",
        code: `materialization_io_authorization_${authorization}`
      });
      expect(storageResolver.resolve).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
    }
  );

  it("does not open the provider when the lease expires during storage activation", async () => {
    const repo = repository();
    const objectStorage = storage();
    const scopedResolver = resolver(objectStorage);
    const open = vi.fn();
    let expireLease: () => void = () => {
      throw new Error("deadline was not installed");
    };
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: {
        resolve: vi.fn(async () => {
          expireLease();
          return scopedResolver.resolve();
        })
      },
      sourceLoader: { verify: vi.fn(), open },
      clock: { now: () => "2026-07-18T12:01:00.000Z" },
      timer: {
        set(callback) {
          expireLease = callback;
          return "lease-deadline";
        },
        clear: vi.fn()
      }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "indeterminate",
      code: "materialization_lease_expired"
    });
    expect(open).not.toHaveBeenCalled();
    expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
  });

  it("does not terminalize a storage-activation error after the lease deadline", async () => {
    const repo = repository();
    const open = vi.fn();
    let expireLease: () => void = () => {
      throw new Error("deadline was not installed");
    };
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: {
        resolve: vi.fn(async () => {
          expireLease();
          throw new Error("storage activation failed");
        })
      },
      sourceLoader: { verify: vi.fn(), open },
      clock: { now: () => "2026-07-18T12:01:00.000Z" },
      timer: {
        set(callback) {
          expireLease = callback;
          return "lease-deadline";
        },
        clear: vi.fn()
      }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "indeterminate",
      code: "materialization_lease_expired"
    });
    expect(open).not.toHaveBeenCalled();
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
  });

  it("fails visibly with zero byte I/O for an unknown storage root", async () => {
    const repo = repository();
    const objectStorage = storage();
    const open = vi.fn();
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: { resolve: vi.fn(async () => null) },
      sourceLoader: { verify: vi.fn(), open },
      clock: { now: () => "2026-07-18T12:01:00.000Z" }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "visible_fallback",
      code: "object_storage.scope_unavailable",
      retryable: false,
      persistence: "applied"
    });
    expect(open).not.toHaveBeenCalled();
    expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
  });

  it("fails visibly before source or byte I/O when active storage capabilities are unavailable", async () => {
    const repo = repository();
    const objectStorage = storage();
    const open = vi.fn();
    vi.mocked(objectStorage.probeCapabilities).mockResolvedValueOnce({
      ...(await objectStorage.probeCapabilities()),
      readyForVersionAwareWrites: false,
      failure: {
        check: "cleanup",
        errorCode: "object_storage.provider_capability_missing",
        message: "probe cleanup did not verify"
      },
      checks: {
        ...(await objectStorage.probeCapabilities()).checks,
        cleanup: {
          state: "failed",
          errorCode: "object_storage.provider_capability_missing",
          message: "probe cleanup did not verify"
        }
      }
    });
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: resolver(objectStorage),
      sourceLoader: { verify: vi.fn(), open },
      clock: { now: () => "2026-07-18T12:01:00.000Z" }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "visible_fallback",
      code: "object_storage.provider_capability_missing",
      retryable: true,
      persistence: "applied"
    });
    expect(open).not.toHaveBeenCalled();
    expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
  });

  it("rejects a substituted tenant/root capability before source I/O", async () => {
    const repo = repository();
    const objectStorage = storage();
    const open = vi.fn();
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: resolver(objectStorage, { tenantId: "tenant:other" }),
      sourceLoader: { verify: vi.fn(), open },
      clock: { now: () => "2026-07-18T12:01:00.000Z" }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "visible_fallback",
      code: "object_storage.provider_capability_missing",
      retryable: true,
      persistence: "applied"
    });
    expect(open).not.toHaveBeenCalled();
    expect(objectStorage.putObjectImmutable).not.toHaveBeenCalled();
  });

  it("records exact write evidence even when the lease aborts with the provider call", async () => {
    const repo = repository();
    const objectStorage = storage();
    let expireLease: () => void = () => {
      throw new Error("deadline was not installed");
    };
    const identity = {
      storageKey: claim.storageKey,
      versionId: "provider-version-after-abort"
    };
    vi.mocked(objectStorage.putObjectImmutable).mockImplementationOnce(
      async () => {
        expireLease();
        throw Object.assign(new Error("acknowledgement lost on abort"), {
          code: "object_storage.provider_failure",
          writeDisposition: "exact_version_observed",
          exactVersionEvidence: {
            identity,
            checksumSha256: checksum,
            sizeBytes: body.byteLength,
            mediaType: "image/jpeg"
          }
        });
      }
    );
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: resolver(objectStorage),
      sourceLoader: {
        verify: vi.fn(),
        open: vi.fn(async () => ({
          body,
          sizeBytes: body.byteLength,
          mediaType: "image/jpeg",
          checksumSha256: checksum
        }))
      },
      clock: { now: () => "2026-07-18T12:01:00.000Z" },
      timer: {
        set(callback) {
          expireLease = callback;
          return "lease-deadline";
        },
        clear: vi.fn()
      }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "orphan_recorded",
      code: "object_storage.provider_failure",
      identity
    });
    expect(repo.recordOrphan).toHaveBeenCalledWith(
      expect.objectContaining({ identity })
    );
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
  });

  it("aborts an in-flight object write at the lease deadline", async () => {
    const repo = repository();
    const objectStorage = storage();
    let expireLease: () => void = () => {
      throw new Error("deadline was not installed");
    };
    vi.mocked(objectStorage.putObjectImmutable).mockImplementationOnce(
      async (input) => {
        expireLease();
        expect(input.signal?.aborted).toBe(true);
        throw new Error("aborted");
      }
    );
    const service = createInboxV2AttachmentMaterializationCoordinator({
      repository: repo,
      storageResolver: resolver(objectStorage),
      sourceLoader: {
        verify: vi.fn(),
        open: vi.fn(async () => ({
          body,
          sizeBytes: body.byteLength,
          mediaType: "image/jpeg",
          checksumSha256: checksum
        }))
      },
      clock: { now: () => "2026-07-18T12:01:00.000Z" },
      timer: {
        set(callback) {
          expireLease = callback;
          return "lease-deadline";
        },
        clear: vi.fn()
      }
    });

    await expect(service.process(claim)).resolves.toEqual({
      outcome: "indeterminate",
      code: "materialization_lease_expired"
    });
    expect(objectStorage.putObjectImmutable).toHaveBeenCalledOnce();
    expect(repo.finalizeReady).not.toHaveBeenCalled();
    expect(repo.recordOrphan).not.toHaveBeenCalled();
  });
});
