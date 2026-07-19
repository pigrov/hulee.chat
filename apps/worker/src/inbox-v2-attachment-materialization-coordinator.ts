import { inboxV2MediaTypeSchema } from "@hulee/contracts";
import {
  createCapabilityGatedTenantScopedObjectStorageResolver,
  DEFAULT_VERSION_AWARE_IMMUTABLE_OBJECT_MAXIMUM_BYTES,
  type HuleeSha256,
  type ObjectStorageExactVersionEvidence,
  type ObjectStorageObjectVersionIdentity,
  type ObjectStorageQuarantineEvidence,
  type ObjectStorageWriteBody,
  type TenantScopedVersionAwareObjectStorage,
  type TenantScopedVersionAwareObjectStorageResolver,
  type VersionAwareObjectStorage
} from "@hulee/storage";

export const DEFAULT_INBOX_V2_ATTACHMENT_MATERIALIZATION_MAXIMUM_BYTES =
  DEFAULT_VERSION_AWARE_IMMUTABLE_OBJECT_MAXIMUM_BYTES;

export type InboxV2AttachmentMaterializationClaim = Readonly<{
  tenantId: string;
  jobId: string;
  attemptId: string;
  leaseToken: string;
  expectedJobRevision: string;
  fileId: string;
  expectedFileRevision: string;
  fileVersionId: string;
  objectVersionId: string;
  storageRootId: string;
  storageKey: string;
  claimedAt: string;
  leaseExpiresAt: string;
  sourceLocator: Readonly<{
    kind: "provider" | "upload_staging" | "derivative";
    reference: string;
  }>;
}>;

export type InboxV2AttachmentMaterializationSource = Readonly<{
  body: ObjectStorageWriteBody;
  sizeBytes: number;
  mediaType: string;
  checksumSha256: HuleeSha256;
}>;

export type InboxV2AttachmentMaterializationSourceLoader = Readonly<{
  /**
   * Pure source-authority preflight. Production implementations verify the
   * exact persisted namespace generation and opaque locator here, before an
   * object-storage capability probe or provider callback can perform I/O.
   */
  verify(claim: InboxV2AttachmentMaterializationClaim): void | Promise<void>;
  open(
    claim: InboxV2AttachmentMaterializationClaim,
    options: Readonly<{ signal: AbortSignal; maximumBytes: number }>
  ): Promise<InboxV2AttachmentMaterializationSource>;
}>;

/**
 * Trusted source-loader classification. Arbitrary provider exceptions may
 * contribute a bounded diagnostic code, but cannot mark an unknown failure as
 * terminal and silently suppress a safe retry.
 */
export class InboxV2AttachmentMaterializationSourceError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly disposition: InboxV2AttachmentMaterializationSourceErrorDisposition;

  constructor(
    code: string,
    retryable: boolean,
    disposition: InboxV2AttachmentMaterializationSourceErrorDisposition = "visible_fallback"
  ) {
    if (!/^[a-z0-9_.-]{1,120}$/u.test(code)) {
      throw new TypeError(
        "Attachment source failure code must be a bounded safe identifier."
      );
    }
    if (disposition !== "visible_fallback" && disposition !== "indeterminate") {
      throw new TypeError(
        "Attachment source failure disposition must be fail-closed."
      );
    }
    super(code);
    this.name = "InboxV2AttachmentMaterializationSourceError";
    this.code = code;
    this.retryable = retryable;
    this.disposition = disposition;
  }
}

export type InboxV2AttachmentMaterializationSourceErrorDisposition =
  | "visible_fallback"
  | "indeterminate";

export type InboxV2AttachmentReadyPersistenceInput = Readonly<{
  claim: InboxV2AttachmentMaterializationClaim;
  storage: Readonly<{
    storageKey: string;
    storageVersionId: string;
    checksumSha256: HuleeSha256;
    sizeBytes: number;
    mediaType: string;
    putOutcome: "created" | "already_exists";
  }>;
}>;

export type InboxV2AttachmentMaterializationRepository = Readonly<{
  /**
   * Revalidates the exact claimed job against its current Message/content,
   * attachment, visibility and retention fences immediately before any
   * provider or object-storage I/O. A stale claim is terminalized by the
   * repository in the same transaction and must never reach a source loader.
   */
  authorizeMaterializationIo(
    claim: InboxV2AttachmentMaterializationClaim
  ): Promise<
    | "authorized"
    | "cancelled"
    | "already_terminal"
    | "authorization_refresh_required"
    | "lease_lost"
    | "state_conflict"
  >;
  finalizeReady(
    input: InboxV2AttachmentReadyPersistenceInput
  ): Promise<"applied" | "already_applied" | "lease_lost" | "state_conflict">;
  finalizeFailed(
    input: Readonly<{
      claim: InboxV2AttachmentMaterializationClaim;
      code: string;
      retryable: boolean;
    }>
  ): Promise<"applied" | "already_applied" | "lease_lost" | "state_conflict">;
  recordOrphan(
    input: Readonly<{
      claim: InboxV2AttachmentMaterializationClaim;
      identity: ObjectStorageObjectVersionIdentity;
      storageRootId: string;
      checksumSha256: HuleeSha256;
      sizeBytes: number;
      mediaType: string;
      reasonCode: string;
      quarantine: ObjectStorageQuarantineEvidence | null;
    }>
  ): Promise<"adopted" | "recorded" | "already_recorded">;
}>;

export type InboxV2AttachmentMaterializationProcessResult =
  | Readonly<{
      outcome: "cancelled";
      persistence: "cancelled" | "already_terminal";
    }>
  | Readonly<{
      outcome: "ready";
      persistence: "applied" | "already_applied";
      storageVersionId: string;
    }>
  | Readonly<{
      outcome: "visible_fallback";
      code: string;
      retryable: boolean;
      persistence: "applied" | "already_applied";
    }>
  | Readonly<{
      outcome: "ready_reconciled" | "orphan_recorded" | "orphan_unrecorded";
      code: string;
      identity: ObjectStorageObjectVersionIdentity;
    }>
  | Readonly<{
      outcome: "indeterminate";
      code: string;
    }>;

export type InboxV2AttachmentMaterializationCoordinator = Readonly<{
  process(
    claim: InboxV2AttachmentMaterializationClaim
  ): Promise<InboxV2AttachmentMaterializationProcessResult>;
}>;

export type InboxV2AttachmentMaterializationCoordinatorOptions = Readonly<{
  repository: InboxV2AttachmentMaterializationRepository;
  sourceLoader: InboxV2AttachmentMaterializationSourceLoader;
  storageResolver: TenantScopedVersionAwareObjectStorageResolver;
  maximumAttachmentBytes?: number;
  clock?: Readonly<{ now(): string }>;
  timer?: Readonly<{
    set(callback: () => void, delayMs: number): unknown;
    clear(handle: unknown): void;
  }>;
}>;

/**
 * Performs provider/object I/O only after a durable repository claim exists.
 * Storage success is never reported as a ready attachment until the exact
 * application object version and content transition have been fenced by the
 * repository. A DB failure after storage writes records the exact provider
 * version for DB-owned reconciliation. This worker never quarantines an
 * uncertain version because a lost commit acknowledgement or a stale lease may
 * mean that the same version is already canonical.
 */
export function createInboxV2AttachmentMaterializationCoordinator(
  options: InboxV2AttachmentMaterializationCoordinatorOptions
): InboxV2AttachmentMaterializationCoordinator {
  const maximumAttachmentBytes = normalizeMaximumAttachmentBytes(
    options.maximumAttachmentBytes
  );
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  const storageResolver =
    createCapabilityGatedTenantScopedObjectStorageResolver(
      options.storageResolver,
      { now: () => new Date(clock.now()) }
    );
  const timer = options.timer ?? {
    set: (callback: () => void, delayMs: number) =>
      setTimeout(callback, delayMs),
    clear: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout)
  };
  return {
    async process(claim) {
      const nowMs = Date.parse(clock.now());
      const leaseExpiresAtMs = Date.parse(claim.leaseExpiresAt);
      if (!Number.isFinite(nowMs) || !Number.isFinite(leaseExpiresAtMs)) {
        return {
          outcome: "indeterminate",
          code: "materialization_lease_invalid"
        };
      }
      if (leaseExpiresAtMs <= nowMs) {
        return {
          outcome: "indeterminate",
          code: "materialization_lease_expired_before_io"
        };
      }
      const abortController = new AbortController();
      const deadline = timer.set(
        () => abortController.abort("materialization lease expired"),
        leaseExpiresAtMs - nowMs
      );
      try {
        return await processLiveMaterializationClaim(
          { ...options, storageResolver },
          claim,
          abortController.signal,
          maximumAttachmentBytes
        );
      } finally {
        timer.clear(deadline);
      }
    }
  };
}

async function processLiveMaterializationClaim(
  options: InboxV2AttachmentMaterializationCoordinatorOptions,
  claim: InboxV2AttachmentMaterializationClaim,
  signal: AbortSignal,
  maximumAttachmentBytes: number
): Promise<InboxV2AttachmentMaterializationProcessResult> {
  let ioAuthorization: Awaited<
    ReturnType<
      InboxV2AttachmentMaterializationRepository["authorizeMaterializationIo"]
    >
  >;
  try {
    ioAuthorization =
      await options.repository.authorizeMaterializationIo(claim);
  } catch (error) {
    return {
      outcome: "indeterminate",
      code: diagnosticCode(error, "materialization_io_authorization_failed")
    };
  }
  if (
    ioAuthorization === "cancelled" ||
    ioAuthorization === "already_terminal"
  ) {
    return {
      outcome: "cancelled",
      persistence: ioAuthorization
    };
  }
  if (ioAuthorization !== "authorized") {
    return {
      outcome: "indeterminate",
      code: `materialization_io_authorization_${ioAuthorization}`
    };
  }
  if (signal.aborted) {
    return { outcome: "indeterminate", code: "materialization_lease_expired" };
  }

  try {
    await options.sourceLoader.verify(claim);
  } catch (error) {
    if (signal.aborted) {
      return {
        outcome: "indeterminate",
        code: "materialization_lease_expired"
      };
    }
    const failure = classifySourceFailure(error);
    if (failure.disposition === "indeterminate") {
      return { outcome: "indeterminate", code: failure.code };
    }
    return persistVisibleFallback(
      options.repository,
      claim,
      failure.code,
      failure.retryable
    );
  }
  if (signal.aborted) {
    return { outcome: "indeterminate", code: "materialization_lease_expired" };
  }

  let storage: TenantScopedVersionAwareObjectStorage | null;
  try {
    storage = await options.storageResolver.resolve({
      tenantId: claim.tenantId,
      storageRootId: claim.storageRootId
    });
  } catch (error) {
    if (signal.aborted) {
      return {
        outcome: "indeterminate",
        code: "materialization_lease_expired"
      };
    }
    return persistVisibleFallback(
      options.repository,
      claim,
      diagnosticCode(error, "object_storage.scope_resolution_failed"),
      true
    );
  }
  if (storage === null) {
    return persistVisibleFallback(
      options.repository,
      claim,
      "object_storage.scope_unavailable",
      false
    );
  }
  if (
    storage.scope.tenantId !== claim.tenantId ||
    storage.scope.storageRootId !== claim.storageRootId
  ) {
    return persistVisibleFallback(
      options.repository,
      claim,
      "object_storage.scope_mismatch",
      false
    );
  }
  if (signal.aborted) {
    return { outcome: "indeterminate", code: "materialization_lease_expired" };
  }

  let source: InboxV2AttachmentMaterializationSource;
  try {
    source = await options.sourceLoader.open(claim, {
      signal,
      maximumBytes: maximumAttachmentBytes
    });
  } catch (error) {
    if (signal.aborted) {
      return {
        outcome: "indeterminate",
        code: "materialization_lease_expired"
      };
    }
    const failure = classifySourceFailure(error);
    if (failure.disposition === "indeterminate") {
      return { outcome: "indeterminate", code: failure.code };
    }
    return persistVisibleFallback(
      options.repository,
      claim,
      failure.code,
      failure.retryable
    );
  }
  if (signal.aborted) {
    return { outcome: "indeterminate", code: "materialization_lease_expired" };
  }
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 0) {
    return persistVisibleFallback(
      options.repository,
      claim,
      "source_size_invalid",
      false
    );
  }
  if (source.sizeBytes > maximumAttachmentBytes) {
    return persistVisibleFallback(
      options.repository,
      claim,
      "attachment_size_limit_exceeded",
      false
    );
  }
  if (!inboxV2MediaTypeSchema.safeParse(source.mediaType).success) {
    return persistVisibleFallback(
      options.repository,
      claim,
      "source_media_type_invalid",
      false
    );
  }

  let stored: Awaited<
    ReturnType<VersionAwareObjectStorage["putObjectImmutable"]>
  >;
  try {
    stored = await storage.putObjectImmutable({
      storageKey: claim.storageKey,
      body: source.body,
      sizeBytes: source.sizeBytes,
      mediaType: source.mediaType,
      checksumSha256: source.checksumSha256,
      condition: "key_absent",
      signal
    });
  } catch (error) {
    const code = diagnosticCode(error, "object_write_outcome_unknown");
    const observedVersion = exactVersionEvidence(error);
    if (observedVersion !== null) {
      if (observedVersion.identity.storageKey !== claim.storageKey) {
        return {
          outcome: "indeterminate",
          code: "object_write_evidence_scope_mismatch"
        };
      }
      return recordStorageUncertainty(options, {
        claim,
        identity: observedVersion.identity,
        storageRootId: claim.storageRootId,
        checksumSha256: observedVersion.checksumSha256,
        sizeBytes: observedVersion.sizeBytes,
        mediaType: observedVersion.mediaType,
        code,
        quarantine: quarantineEvidence(error)
      });
    }
    if (signal.aborted) {
      return {
        outcome: "indeterminate",
        code: "materialization_lease_expired"
      };
    }
    if (!isDefiniteObjectWriteRejection(error)) {
      // A timed-out or failed provider acknowledgement can arrive after S3
      // committed the immutable version. Keep the durable job reconcilable;
      // the next claim repeats the deterministic conditional put and adopts
      // the exact existing version instead of leaking bytes or duplicating it.
      return { outcome: "indeterminate", code };
    }
    return persistVisibleFallback(options.repository, claim, code, false);
  }

  const identity = {
    storageKey: stored.object.storageKey,
    versionId: stored.object.versionId
  };
  if (signal.aborted) {
    return recordStorageUncertainty(options, {
      claim,
      identity,
      storageRootId: claim.storageRootId,
      checksumSha256: source.checksumSha256,
      sizeBytes: source.sizeBytes,
      mediaType: source.mediaType,
      code: "materialization_lease_expired_after_write"
    });
  }
  if (
    stored.object.state !== "available" ||
    stored.object.quarantineEvidence !== null ||
    stored.object.storageKey !== claim.storageKey ||
    stored.object.checksumSha256 !== source.checksumSha256 ||
    stored.object.sizeBytes !== source.sizeBytes ||
    stored.object.mediaType !== source.mediaType
  ) {
    if (stored.object.storageKey !== claim.storageKey) {
      return {
        outcome: "indeterminate",
        code: "object_write_evidence_scope_mismatch"
      };
    }
    if (
      stored.object.checksumSha256 === null ||
      stored.object.mediaType === null
    ) {
      return {
        outcome: "indeterminate",
        code: "object_integrity_evidence_incomplete"
      };
    }
    return recordStorageUncertainty(options, {
      claim,
      identity,
      storageRootId: claim.storageRootId,
      checksumSha256: stored.object.checksumSha256,
      sizeBytes: stored.object.sizeBytes,
      mediaType: stored.object.mediaType,
      code: "object_integrity_mismatch",
      quarantine: stored.object.quarantineEvidence
    });
  }

  try {
    const persistence = await options.repository.finalizeReady({
      claim,
      storage: {
        storageKey: stored.object.storageKey,
        storageVersionId: stored.object.versionId,
        checksumSha256: source.checksumSha256,
        sizeBytes: source.sizeBytes,
        mediaType: source.mediaType,
        putOutcome: stored.outcome
      }
    });
    if (persistence === "applied" || persistence === "already_applied") {
      return {
        outcome: "ready",
        persistence,
        storageVersionId: stored.object.versionId
      };
    }
    return recordStorageUncertainty(options, {
      claim,
      identity,
      storageRootId: claim.storageRootId,
      checksumSha256: source.checksumSha256,
      sizeBytes: source.sizeBytes,
      mediaType: source.mediaType,
      code: `ready_finalize_${persistence}`
    });
  } catch (error) {
    return recordStorageUncertainty(options, {
      claim,
      identity,
      storageRootId: claim.storageRootId,
      checksumSha256: source.checksumSha256,
      sizeBytes: source.sizeBytes,
      mediaType: source.mediaType,
      code: diagnosticCode(error, "ready_finalize_failed")
    });
  }
}

async function persistVisibleFallback(
  repository: InboxV2AttachmentMaterializationRepository,
  claim: InboxV2AttachmentMaterializationClaim,
  code: string,
  retryable: boolean
): Promise<InboxV2AttachmentMaterializationProcessResult> {
  try {
    const persistence = await repository.finalizeFailed({
      claim,
      code,
      retryable
    });
    if (persistence === "applied" || persistence === "already_applied") {
      return { outcome: "visible_fallback", code, retryable, persistence };
    }
    return { outcome: "indeterminate", code: `failed_finalize_${persistence}` };
  } catch (error) {
    return {
      outcome: "indeterminate",
      code: diagnosticCode(error, "failed_finalize_failed")
    };
  }
}

async function recordStorageUncertainty(
  options: InboxV2AttachmentMaterializationCoordinatorOptions,
  input: Readonly<{
    claim: InboxV2AttachmentMaterializationClaim;
    identity: ObjectStorageObjectVersionIdentity;
    storageRootId: string;
    checksumSha256: HuleeSha256;
    sizeBytes: number;
    mediaType: string;
    code: string;
    quarantine?: ObjectStorageQuarantineEvidence | null;
  }>
): Promise<InboxV2AttachmentMaterializationProcessResult> {
  try {
    const persistence = await options.repository.recordOrphan({
      claim: input.claim,
      identity: input.identity,
      storageRootId: input.storageRootId,
      checksumSha256: input.checksumSha256,
      sizeBytes: input.sizeBytes,
      mediaType: input.mediaType,
      reasonCode: input.code,
      quarantine: input.quarantine ?? null
    });
    return {
      outcome:
        persistence === "adopted" ? "ready_reconciled" : "orphan_recorded",
      code: input.code,
      identity: input.identity
    };
  } catch {
    return {
      outcome: "orphan_unrecorded",
      code: input.code,
      identity: input.identity
    };
  }
}

function diagnosticCode(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9_.-]{1,120}$/u.test(error.code)
  ) {
    return error.code;
  }
  return fallback;
}

function classifySourceFailure(error: unknown): Readonly<{
  code: string;
  retryable: boolean;
  disposition: InboxV2AttachmentMaterializationSourceErrorDisposition;
}> {
  return {
    code: diagnosticCode(error, "source_load_failed"),
    retryable:
      error instanceof InboxV2AttachmentMaterializationSourceError
        ? error.retryable
        : true,
    disposition:
      error instanceof InboxV2AttachmentMaterializationSourceError
        ? error.disposition
        : "indeterminate"
  };
}

function normalizeMaximumAttachmentBytes(value: number | undefined): number {
  const normalized =
    value ?? DEFAULT_INBOX_V2_ATTACHMENT_MATERIALIZATION_MAXIMUM_BYTES;
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(
      "maximumAttachmentBytes must be a positive safe integer."
    );
  }
  return normalized;
}

function isDefiniteObjectWriteRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "writeDisposition" in error &&
    error.writeDisposition === "definitely_not_written"
  );
}

function exactVersionEvidence(
  error: unknown
): ObjectStorageExactVersionEvidence | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("exactVersionEvidence" in error) ||
    typeof error.exactVersionEvidence !== "object" ||
    error.exactVersionEvidence === null
  ) {
    return null;
  }
  const evidence = error.exactVersionEvidence as Record<string, unknown>;
  const identity = evidence.identity;
  if (
    typeof identity !== "object" ||
    identity === null ||
    !("storageKey" in identity) ||
    !("versionId" in identity) ||
    typeof identity.storageKey !== "string" ||
    identity.storageKey.length < 1 ||
    typeof identity.versionId !== "string" ||
    identity.versionId.length < 1 ||
    typeof evidence.checksumSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(evidence.checksumSha256) ||
    typeof evidence.sizeBytes !== "number" ||
    !Number.isSafeInteger(evidence.sizeBytes) ||
    evidence.sizeBytes < 0 ||
    typeof evidence.mediaType !== "string" ||
    evidence.mediaType.length < 1
  ) {
    return null;
  }
  return evidence as ObjectStorageExactVersionEvidence;
}

function quarantineEvidence(
  error: unknown
): ObjectStorageQuarantineEvidence | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("quarantineEvidence" in error) ||
    typeof error.quarantineEvidence !== "object" ||
    error.quarantineEvidence === null
  ) {
    return null;
  }
  const evidence = error.quarantineEvidence as Record<string, unknown>;
  if (
    typeof evidence.reasonCode !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(evidence.reasonCode) ||
    typeof evidence.evidenceSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(evidence.evidenceSha256) ||
    evidence.physicalKind !== "s3_object_version_tags"
  ) {
    return null;
  }
  return evidence as ObjectStorageQuarantineEvidence;
}
