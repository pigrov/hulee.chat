import type { HuleeSha256 } from "./checksum";

export const OBJECT_STORAGE_CONTRACT_VERSION = "1" as const;
export const DEFAULT_OBJECT_STORAGE_LIST_PAGE_SIZE = 100;
export const MAX_OBJECT_STORAGE_LIST_PAGE_SIZE = 1_000;
export const DEFAULT_LEGACY_BUFFERED_READ_MAXIMUM_BYTES = 64 * 1024 * 1024;
export const DEFAULT_VERSION_AWARE_IMMUTABLE_OBJECT_MAXIMUM_BYTES =
  64 * 1_024 * 1_024;

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/** @deprecated V1 compatibility input. Inbox V2 must use putObjectImmutable. */
export type PutObjectInput = {
  storageKey: string;
  body: Uint8Array;
  mediaType: string;
  /** Kept for source compatibility only. It is never copied into object metadata. */
  fileName?: string;
};

/** @deprecated V1 compatibility input. Inbox V2 must use exact versions. */
export type GetObjectInput = {
  storageKey: string;
  maximumBytes?: number;
};

/** @deprecated V1 compatibility output. Inbox V2 must stream exact versions. */
export type GetObjectOutput = {
  body: Uint8Array;
  mediaType?: string;
  sizeBytes?: number;
  versionId?: string;
  checksumSha256?: HuleeSha256;
};

export type ObjectStorageWriteBody = Uint8Array | AsyncIterable<Uint8Array>;

export type ObjectStorageObjectVersionIdentity = {
  storageKey: string;
  versionId: string;
};

export type ObjectStorageByteRange = {
  start: number;
  endInclusive: number;
};

export type PutObjectImmutableInput = {
  storageKey: string;
  body: ObjectStorageWriteBody;
  sizeBytes: number;
  mediaType: string;
  checksumSha256: HuleeSha256;
  condition?: "key_absent";
  signal?: AbortSignal;
};

export type ObjectStorageObjectVersion = ObjectStorageObjectVersionIdentity & {
  checksumSha256: HuleeSha256 | null;
  sizeBytes: number;
  mediaType: string | null;
  lastModified: string | null;
  state: "available" | "quarantined";
  quarantineEvidence: ObjectStorageQuarantineEvidence | null;
};

export type PutObjectImmutableOutput = {
  outcome: "created" | "already_exists";
  object: ObjectStorageObjectVersion;
  providerReceipt: {
    kind: "s3_put_object" | "s3_head_object";
    checksumVerifiedByProvider: boolean;
    recordedAt: string;
  };
};

export type GetObjectVersionInput = {
  identity: ObjectStorageObjectVersionIdentity;
  maximumBytes: number;
  range?: ObjectStorageByteRange;
};

export type GetObjectVersionOutput = {
  identity: ObjectStorageObjectVersionIdentity;
  body: AsyncIterable<Uint8Array>;
  mediaType: string | null;
  checksumSha256: HuleeSha256 | null;
  objectSizeBytes: number | null;
  responseSizeBytes: number | null;
  range: ObjectStorageByteRange | null;
};

export type HeadObjectVersionInput = {
  identity: ObjectStorageObjectVersionIdentity;
};

export type HeadObjectVersionOutput =
  | {
      outcome: "found";
      object: ObjectStorageObjectVersion;
    }
  | {
      outcome: "not_found";
      identity: ObjectStorageObjectVersionIdentity;
    };

export type ObjectStorageListedVersion =
  | {
      kind: "object";
      identity: ObjectStorageObjectVersionIdentity;
      isLatest: boolean;
      sizeBytes: number;
      lastModified: string | null;
      providerChecksumAlgorithms: readonly string[];
    }
  | {
      kind: "delete_marker";
      identity: ObjectStorageObjectVersionIdentity;
      isLatest: boolean;
      lastModified: string | null;
    };

export type ListObjectVersionsInput = {
  prefix: string;
  pageSize?: number;
  cursor?: string;
};

export type ListObjectVersionsOutput = {
  items: readonly ObjectStorageListedVersion[];
  nextCursor: string | null;
};

export type DeleteObjectVersionInput = {
  identity: ObjectStorageObjectVersionIdentity;
};

export type DeleteObjectVersionOutput = {
  outcome: "deleted" | "not_found";
  identity: ObjectStorageObjectVersionIdentity;
  /** S3 exact-version deletion is idempotent even if a provider reports no row. */
  providerDeleteMarker: boolean;
  providerResponseVersionId: string | null;
  recordedAt: string;
};

export type ObjectStorageQuarantineEvidence = {
  reasonCode: string;
  evidenceSha256: HuleeSha256;
  physicalKind: "s3_object_version_tags";
};

export type QuarantineObjectVersionInput = {
  identity: ObjectStorageObjectVersionIdentity;
  reasonCode: string;
  evidenceSha256: HuleeSha256;
};

export type QuarantineObjectVersionOutput =
  | {
      outcome: "quarantined" | "already_quarantined";
      identity: ObjectStorageObjectVersionIdentity;
      evidence: ObjectStorageQuarantineEvidence;
      recordedAt: string;
    }
  | {
      outcome: "not_found";
      identity: ObjectStorageObjectVersionIdentity;
      recordedAt: string;
    };

export type ObjectStorageCapabilities = {
  contractVersion: typeof OBJECT_STORAGE_CONTRACT_VERSION;
  exactVersionIdentity: true;
  immutableConditionalPut: true;
  streamingReads: true;
  boundedRangeReads: true;
  paginatedVersionEnumeration: true;
  deleteMarkerEnumeration: true;
  exactVersionDelete: true;
  applicationQuarantineDeny: true;
  physicalQuarantineEvidence: "version_tags";
  checksumAlgorithm: "sha256";
  providerEntityTagIsChecksum: false;
  originalFileNameInObjectMetadata: false;
};

export type ProbeObjectStorageCapabilitiesInput = {
  prefix?: string;
};

export type ObjectStorageCapabilityProbeCheckName =
  | "bucketVersioning"
  | "versionEnumerationApi"
  | "immutableWrite"
  | "exactVersionHead"
  | "streamingReadChecksum"
  | "exactVersionEnumeration"
  | "immutableConditionalPut"
  | "physicalQuarantineEvidence"
  | "exactVersionDelete"
  | "cleanup";

export type ObjectStorageCapabilityProbeCheck = Readonly<{
  state: "passed" | "failed" | "skipped";
  errorCode: ObjectStorageErrorCode | null;
  message: string | null;
}>;

export type ObjectStorageCapabilityProbeFailure = Readonly<{
  check: ObjectStorageCapabilityProbeCheckName;
  errorCode: ObjectStorageErrorCode;
  message: string;
}>;

export type ProbeObjectStorageCapabilitiesOutput = {
  provider: "s3";
  capabilities: ObjectStorageCapabilities;
  bucketVersioning: "enabled" | "suspended" | "disabled" | "unknown";
  versionEnumeration: "supported" | "unsupported";
  observedVersionCount: number;
  observedDeleteMarkerCount: number;
  checks: Readonly<
    Record<
      ObjectStorageCapabilityProbeCheckName,
      ObjectStorageCapabilityProbeCheck
    >
  >;
  failure: ObjectStorageCapabilityProbeFailure | null;
  readyForVersionAwareWrites: boolean;
  probedAt: string;
};

export type VersionAwareObjectStorageOperations = {
  readonly capabilities: ObjectStorageCapabilities;
  putObjectImmutable(
    input: PutObjectImmutableInput
  ): Promise<PutObjectImmutableOutput>;
  getObjectVersion(
    input: GetObjectVersionInput
  ): Promise<GetObjectVersionOutput>;
  headObjectVersion(
    input: HeadObjectVersionInput
  ): Promise<HeadObjectVersionOutput>;
  listObjectVersions(
    input: ListObjectVersionsInput
  ): Promise<ListObjectVersionsOutput>;
  deleteObjectVersion(
    input: DeleteObjectVersionInput
  ): Promise<DeleteObjectVersionOutput>;
  quarantineObjectVersion(
    input: QuarantineObjectVersionInput
  ): Promise<QuarantineObjectVersionOutput>;
  probeCapabilities(
    input?: ProbeObjectStorageCapabilitiesInput
  ): Promise<ProbeObjectStorageCapabilitiesOutput>;
};

/**
 * The two V1 methods remain required while old call sites migrate. Version-aware
 * methods are optional here so existing dependency-injected V1 fakes remain valid.
 * New Inbox V2 composition must require VersionAwareObjectStorage instead.
 */
export type ObjectStorage = {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(input: GetObjectInput): Promise<GetObjectOutput>;
} & Partial<VersionAwareObjectStorageOperations>;

export type VersionAwareObjectStorage = ObjectStorage &
  VersionAwareObjectStorageOperations;

export type ObjectStorageTenantScope = Readonly<{
  tenantId: string;
  storageRootId: string;
  keyPrefix: string;
}>;

/**
 * Non-forgeable capability handed to tenant data-plane code. The wrapper owns
 * the trusted key prefix; callers can no longer address arbitrary bucket keys.
 */
export type TenantScopedVersionAwareObjectStorage = VersionAwareObjectStorage &
  Readonly<{ scope: ObjectStorageTenantScope }>;

export type TenantScopedVersionAwareObjectStorageResolver = Readonly<{
  resolve(
    input: Readonly<{
      tenantId: string;
      storageRootId: string;
    }>
  ): Promise<TenantScopedVersionAwareObjectStorage | null>;
}>;

export type ObjectStorageErrorCode =
  | "object_storage.invalid_argument"
  | "object_storage.not_found"
  | "object_storage.quarantined"
  | "object_storage.immutable_conflict"
  | "object_storage.integrity_mismatch"
  | "object_storage.read_bound_exceeded"
  | "object_storage.range_contract_violation"
  | "object_storage.provider_capability_missing"
  | "object_storage.write_rejected"
  | "object_storage.write_outcome_unknown"
  | "object_storage.provider_failure";

export type ObjectStorageExactVersionEvidence = Readonly<{
  identity: ObjectStorageObjectVersionIdentity;
  checksumSha256: HuleeSha256;
  sizeBytes: number;
  mediaType: string;
}>;

export type ObjectStorageWriteDisposition =
  | "definitely_not_written"
  | "exact_version_observed"
  | "unknown";

export type ObjectStorageErrorOptions = ErrorOptions &
  Readonly<{
    writeDisposition?: ObjectStorageWriteDisposition;
    exactVersionEvidence?: ObjectStorageExactVersionEvidence;
    quarantineEvidence?: ObjectStorageQuarantineEvidence;
  }>;

export class ObjectStorageError extends Error {
  readonly code: ObjectStorageErrorCode;
  readonly writeDisposition: ObjectStorageWriteDisposition | null;
  readonly exactVersionEvidence: ObjectStorageExactVersionEvidence | null;
  readonly quarantineEvidence: ObjectStorageQuarantineEvidence | null;

  constructor(
    code: ObjectStorageErrorCode,
    message: string,
    options?: ObjectStorageErrorOptions
  ) {
    super(message, options);
    this.name = "ObjectStorageError";
    this.code = code;
    this.writeDisposition = options?.writeDisposition ?? null;
    this.exactVersionEvidence = options?.exactVersionEvidence ?? null;
    this.quarantineEvidence = options?.quarantineEvidence ?? null;
  }
}

export function isVersionAwareObjectStorage(
  storage: ObjectStorage
): storage is VersionAwareObjectStorage {
  return (
    storage.capabilities !== undefined &&
    typeof storage.putObjectImmutable === "function" &&
    typeof storage.getObjectVersion === "function" &&
    typeof storage.headObjectVersion === "function" &&
    typeof storage.listObjectVersions === "function" &&
    typeof storage.deleteObjectVersion === "function" &&
    typeof storage.quarantineObjectVersion === "function" &&
    typeof storage.probeCapabilities === "function"
  );
}

export function requireVersionAwareObjectStorage(
  storage: ObjectStorage
): VersionAwareObjectStorage {
  if (!isVersionAwareObjectStorage(storage)) {
    throw new ObjectStorageError(
      "object_storage.provider_capability_missing",
      "Object storage does not implement the Inbox V2 version-aware contract."
    );
  }

  return storage;
}
