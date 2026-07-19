import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client
} from "@aws-sdk/client-s3";

import {
  calculateHuleeSha256,
  huleeSha256ToS3Checksum,
  parseHuleeSha256,
  s3ChecksumToHuleeSha256,
  type HuleeSha256
} from "./checksum";
import {
  DEFAULT_LEGACY_BUFFERED_READ_MAXIMUM_BYTES,
  DEFAULT_OBJECT_STORAGE_LIST_PAGE_SIZE,
  DEFAULT_VERSION_AWARE_IMMUTABLE_OBJECT_MAXIMUM_BYTES,
  MAX_OBJECT_STORAGE_LIST_PAGE_SIZE,
  OBJECT_STORAGE_CONTRACT_VERSION,
  ObjectStorageError,
  type DeleteObjectVersionOutput,
  type GetObjectVersionOutput,
  type HeadObjectVersionOutput,
  type ListObjectVersionsInput,
  type ListObjectVersionsOutput,
  type ObjectStorageByteRange,
  type ObjectStorageCapabilityProbeCheck,
  type ObjectStorageCapabilityProbeCheckName,
  type ObjectStorageCapabilities,
  type ObjectStorageConfig,
  type ObjectStorageErrorCode,
  type ObjectStorageExactVersionEvidence,
  type ObjectStorageObjectVersion,
  type ObjectStorageObjectVersionIdentity,
  type ObjectStorageQuarantineEvidence,
  type ObjectStorageWriteBody,
  type ProbeObjectStorageCapabilitiesOutput,
  type PutObjectImmutableInput,
  type PutObjectImmutableOutput,
  type QuarantineObjectVersionOutput,
  type VersionAwareObjectStorage
} from "./contracts";

const HULEE_CHECKSUM_METADATA_KEY = "hulee-sha256";
const HULEE_STATE_TAG_KEY = "hulee-state";
const HULEE_QUARANTINE_REASON_TAG_KEY = "hulee-quarantine-reason";
const HULEE_QUARANTINE_EVIDENCE_TAG_KEY = "hulee-quarantine-evidence";
const HULEE_QUARANTINED_TAG_VALUE = "quarantined";
const MAX_S3_OBJECT_TAGS = 10;
const RESERVED_QUARANTINE_TAG_COUNT = 3;
const QUARANTINE_REASON_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_STORAGE_KEY_LENGTH = 2_048;
const MAX_STORAGE_VERSION_IDENTITY_LENGTH = 1_024;
const MAX_MEDIA_TYPE_LENGTH = 255;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

export const S3_OBJECT_STORAGE_CAPABILITIES: ObjectStorageCapabilities = {
  contractVersion: OBJECT_STORAGE_CONTRACT_VERSION,
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
};

/** Minimal injectable surface used by contract tests and alternative S3 clients. */
export type S3ObjectStorageClient = {
  send(
    command: unknown,
    options?: Readonly<{ abortSignal?: AbortSignal }>
  ): Promise<unknown>;
};

export type CreateS3ObjectStorageOptions = {
  client?: S3ObjectStorageClient;
  now?: () => Date;
  /** Injectable only to make the isolated active capability probe deterministic. */
  probeToken?: () => string;
  /** Hard ceiling for immutable writes and unauthenticated exact-byte replay verification. */
  maximumImmutableObjectBytes?: number;
};

type S3Tag = { Key: string; Value: string };

type S3HeadOutput = {
  VersionId?: string;
  ContentLength?: number;
  ContentType?: string;
  LastModified?: Date;
  ChecksumSHA256?: string;
  Metadata?: Record<string, string>;
  DeleteMarker?: boolean;
};

type S3GetOutput = S3HeadOutput & {
  Body?: unknown;
  ContentRange?: string;
};

type S3TaggingOutput = {
  VersionId?: string;
  TagSet?: S3Tag[];
};

type S3PutOutput = {
  VersionId?: string;
  ChecksumSHA256?: string;
};

type S3DeleteOutput = {
  VersionId?: string;
  DeleteMarker?: boolean;
};

type S3ListVersionsOutput = {
  IsTruncated?: boolean;
  NextKeyMarker?: string;
  NextVersionIdMarker?: string;
  Versions?: Array<{
    Key?: string;
    VersionId?: string;
    IsLatest?: boolean;
    Size?: number;
    LastModified?: Date;
    ChecksumAlgorithm?: string[];
  }>;
  DeleteMarkers?: Array<{
    Key?: string;
    VersionId?: string;
    IsLatest?: boolean;
    LastModified?: Date;
  }>;
};

type S3ListCursor = {
  v: 1;
  prefix: string;
  keyMarker: string;
  versionIdMarker: string | null;
};

export function createS3ObjectStorage(
  config: ObjectStorageConfig,
  options: CreateS3ObjectStorageOptions = {}
): VersionAwareObjectStorage {
  const client =
    options.client ??
    (new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    }) as unknown as S3ObjectStorageClient);
  const now = options.now ?? (() => new Date());
  const probeToken = options.probeToken ?? randomUUID;
  const maximumImmutableObjectBytes = normalizeMaximumImmutableObjectBytes(
    options.maximumImmutableObjectBytes
  );

  async function readTags(
    identity: ObjectStorageObjectVersionIdentity | { storageKey: string }
  ): Promise<
    | { outcome: "found"; tags: S3Tag[]; versionId: string | null }
    | { outcome: "not_found" }
  > {
    try {
      const output = (await client.send(
        new GetObjectTaggingCommand({
          Bucket: config.bucket,
          Key: identity.storageKey,
          VersionId: "versionId" in identity ? identity.versionId : undefined
        })
      )) as S3TaggingOutput;

      if (
        "versionId" in identity &&
        output.VersionId !== undefined &&
        output.VersionId !== identity.versionId
      ) {
        throw capabilityError(
          `S3 returned version ${output.VersionId} while ${identity.versionId} was requested.`
        );
      }

      return {
        outcome: "found",
        tags: output.TagSet ?? [],
        versionId: output.VersionId ?? null
      };
    } catch (error) {
      if (isS3NotFound(error)) {
        return { outcome: "not_found" };
      }
      throw providerError("Unable to read S3 object-version tags.", error);
    }
  }

  async function head(
    storageKey: string,
    versionId?: string
  ): Promise<
    | {
        outcome: "found";
        object: ObjectStorageObjectVersion;
        checksumVerifiedByProvider: boolean;
      }
    | { outcome: "not_found" }
  > {
    let output: S3HeadOutput;
    try {
      output = (await client.send(
        new HeadObjectCommand({
          Bucket: config.bucket,
          Key: storageKey,
          VersionId: versionId,
          ChecksumMode: "ENABLED"
        })
      )) as S3HeadOutput;
    } catch (error) {
      if (isS3NotFound(error)) {
        return { outcome: "not_found" };
      }
      throw providerError("Unable to head S3 object version.", error);
    }

    if (output.DeleteMarker === true) {
      return { outcome: "not_found" };
    }

    const resolvedVersionId = requireProviderVersionId(
      output.VersionId,
      versionId
    );
    const identity = { storageKey, versionId: resolvedVersionId };
    const sizeBytes = requireNonNegativeProviderInteger(
      output.ContentLength,
      "S3 HeadObject ContentLength"
    );
    const mediaType = output.ContentType ?? null;
    const checksumSha256 = readProviderChecksum(output, {
      identity,
      sizeBytes,
      mediaType
    });
    const observedVersion = exactVersionEvidence({
      identity,
      checksumSha256,
      sizeBytes,
      mediaType
    });
    let tags: Awaited<ReturnType<typeof readTags>>;
    try {
      tags = await readTags(identity);
    } catch (error) {
      if (observedVersion !== null) {
        throw withExactVersionEvidence(
          error,
          observedVersion,
          "Unable to read tags for an observed exact S3 object version."
        );
      }
      throw error;
    }
    if (tags.outcome === "not_found") {
      return { outcome: "not_found" };
    }
    const quarantineEvidence = quarantineEvidenceFromTags(tags.tags);

    return {
      outcome: "found",
      checksumVerifiedByProvider: output.ChecksumSHA256 !== undefined,
      object: {
        storageKey,
        versionId: resolvedVersionId,
        checksumSha256,
        sizeBytes,
        mediaType,
        lastModified: output.LastModified?.toISOString() ?? null,
        state: quarantineEvidence === null ? "available" : "quarantined",
        quarantineEvidence
      }
    };
  }

  async function putObjectImmutable(
    input: PutObjectImmutableInput
  ): Promise<PutObjectImmutableOutput> {
    let expectedChecksum: HuleeSha256;
    let preparedBody: Uint8Array | Readable;
    try {
      validateStorageKey(input.storageKey);
      validateMediaType(input.mediaType);
      validateNonNegativeSafeInteger(input.sizeBytes, "sizeBytes");
      if (input.sizeBytes > maximumImmutableObjectBytes) {
        throw invalidArgument(
          `Immutable object size exceeds the configured ${maximumImmutableObjectBytes}-byte ceiling.`
        );
      }
      expectedChecksum = parseHuleeSha256(input.checksumSha256);
      preparedBody = prepareWriteBody(
        input.body,
        input.sizeBytes,
        expectedChecksum
      );
    } catch (error) {
      if (
        error instanceof ObjectStorageError &&
        error.writeDisposition === "definitely_not_written"
      ) {
        throw error;
      }
      throw new ObjectStorageError(
        error instanceof ObjectStorageError
          ? error.code
          : "object_storage.invalid_argument",
        error instanceof Error
          ? error.message
          : "Immutable object write input is invalid.",
        {
          cause: error,
          writeDisposition: "definitely_not_written"
        }
      );
    }

    let output: S3PutOutput;
    try {
      output = (await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.storageKey,
          Body: preparedBody,
          ContentLength: input.sizeBytes,
          ContentType: input.mediaType,
          ChecksumSHA256: huleeSha256ToS3Checksum(expectedChecksum),
          IfNoneMatch: "*",
          Metadata: {
            [HULEE_CHECKSUM_METADATA_KEY]: expectedChecksum
          }
        }),
        { abortSignal: input.signal }
      )) as S3PutOutput;
    } catch (error) {
      if (isS3PreconditionFailed(error)) {
        const existing = await head(input.storageKey);
        if (existing.outcome === "found") {
          if (!existing.checksumVerifiedByProvider) {
            if (existing.object.sizeBytes > maximumImmutableObjectBytes) {
              throw new ObjectStorageError(
                "object_storage.read_bound_exceeded",
                "Unauthenticated existing object exceeds the exact-byte verification ceiling.",
                { writeDisposition: "unknown" }
              );
            }
            const observed = await verifyExactVersionBytes(
              existing.object,
              Math.max(input.sizeBytes, existing.object.sizeBytes),
              input.mediaType
            );
            if (
              observed.sizeBytes === input.sizeBytes &&
              observed.checksumSha256 === expectedChecksum
            ) {
              return {
                outcome: "already_exists",
                object: {
                  ...existing.object,
                  checksumSha256: observed.checksumSha256,
                  sizeBytes: observed.sizeBytes,
                  mediaType: observed.mediaType
                },
                providerReceipt: {
                  kind: "s3_head_object",
                  checksumVerifiedByProvider: false,
                  recordedAt: now().toISOString()
                }
              };
            }
            const reasonCode =
              existing.object.checksumSha256 === expectedChecksum &&
              existing.object.sizeBytes === input.sizeBytes
                ? "integrity.conditional_replay_mismatch"
                : "integrity.immutable_key_collision";
            const quarantineEvidence = await quarantineExactIntegrityMismatch(
              observed,
              reasonCode
            );
            throw new ObjectStorageError(
              "object_storage.immutable_conflict",
              `Storage key ${input.storageKey} contains exact bytes that disagree with the conditional immutable write.`,
              {
                writeDisposition: "exact_version_observed",
                exactVersionEvidence: observed,
                quarantineEvidence
              }
            );
          }
          if (
            existing.object.checksumSha256 === expectedChecksum &&
            existing.object.sizeBytes === input.sizeBytes
          ) {
            return {
              outcome: "already_exists",
              object: existing.object,
              providerReceipt: {
                kind: "s3_head_object",
                checksumVerifiedByProvider: true,
                recordedAt: now().toISOString()
              }
            };
          }
        }

        const observedVersion =
          existing.outcome === "found"
            ? exactVersionEvidenceFromObject(existing.object)
            : null;
        if (observedVersion === null) {
          throw new ObjectStorageError(
            "object_storage.immutable_conflict",
            `Storage key ${input.storageKey} rejected the conditional write without exact-version evidence.`,
            { cause: error, writeDisposition: "unknown" }
          );
        }
        const quarantineEvidence = await quarantineExactIntegrityMismatch(
          observedVersion,
          "integrity.immutable_key_collision"
        );
        throw new ObjectStorageError(
          "object_storage.immutable_conflict",
          `Storage key ${input.storageKey} already contains different bytes.`,
          {
            cause: error,
            writeDisposition: "exact_version_observed",
            exactVersionEvidence: observedVersion,
            quarantineEvidence
          }
        );
      }
      if (isChecksumFailure(error)) {
        throw new ObjectStorageError(
          "object_storage.integrity_mismatch",
          "S3 rejected the object because its SHA-256 did not match.",
          { cause: error, writeDisposition: "definitely_not_written" }
        );
      }
      if (error instanceof ObjectStorageError) {
        if (
          error.writeDisposition !== null ||
          error.exactVersionEvidence !== null
        ) {
          throw error;
        }
        throw writeOutcomeUnknownError(
          "The immutable S3 stream failed after provider I/O started; a version may exist.",
          error
        );
      }
      if (isDefiniteS3WriteRejection(error)) {
        throw new ObjectStorageError(
          "object_storage.write_rejected",
          "S3 rejected the immutable write before creating a version.",
          { cause: error, writeDisposition: "definitely_not_written" }
        );
      }
      throw writeOutcomeUnknownError(
        "The immutable S3 write may have committed, but its acknowledgement was not received.",
        error
      );
    }

    let versionId: string;
    try {
      versionId = requireProviderVersionId(output.VersionId);
    } catch (error) {
      throw writeOutcomeUnknownError(
        "S3 acknowledged the immutable write without a usable exact version identity.",
        error
      );
    }
    let checksumVerifiedByProvider = false;
    let exactReadRequired = output.ChecksumSHA256 === undefined;
    if (output.ChecksumSHA256 !== undefined) {
      let providerChecksum: HuleeSha256;
      try {
        providerChecksum = s3ChecksumToHuleeSha256(output.ChecksumSHA256);
      } catch {
        // Some S3-compatible providers acknowledge the exact VersionId but
        // omit or malform the optional checksum echo. Never trust the caller
        // checksum in that case: verify the stored exact version below.
        exactReadRequired = true;
        providerChecksum = expectedChecksum;
      }
      if (providerChecksum !== expectedChecksum) {
        const observed: ObjectStorageExactVersionEvidence = {
          identity: { storageKey: input.storageKey, versionId },
          checksumSha256: providerChecksum,
          sizeBytes: input.sizeBytes,
          mediaType: input.mediaType
        };
        const quarantineEvidence = await quarantineExactIntegrityMismatch(
          observed,
          "integrity.provider_checksum_mismatch"
        );
        throw new ObjectStorageError(
          "object_storage.integrity_mismatch",
          "S3 acknowledged the immutable write with a different response checksum.",
          {
            writeDisposition: "exact_version_observed",
            exactVersionEvidence: observed,
            quarantineEvidence
          }
        );
      }
      checksumVerifiedByProvider = !exactReadRequired;
    }

    if (exactReadRequired) {
      let observed: ObjectStorageExactVersionEvidence;
      try {
        observed = await verifyExactVersionBytes(
          {
            storageKey: input.storageKey,
            versionId,
            checksumSha256: expectedChecksum,
            sizeBytes: input.sizeBytes,
            mediaType: input.mediaType,
            lastModified: null,
            state: "available",
            quarantineEvidence: null
          },
          input.sizeBytes,
          input.mediaType
        );
      } catch (error) {
        throw writeOutcomeUnknownError(
          "S3 acknowledged an exact object version without a usable checksum, and its stored bytes could not be verified.",
          error
        );
      }
      if (
        observed.checksumSha256 !== expectedChecksum ||
        observed.sizeBytes !== input.sizeBytes ||
        observed.mediaType !== input.mediaType
      ) {
        const quarantineEvidence = await quarantineExactIntegrityMismatch(
          observed,
          "integrity.post_write_verification_mismatch"
        );
        throw new ObjectStorageError(
          "object_storage.integrity_mismatch",
          "S3 stored bytes or metadata that differ from the acknowledged immutable write.",
          {
            writeDisposition: "exact_version_observed",
            exactVersionEvidence: observed,
            quarantineEvidence
          }
        );
      }
    }

    return {
      outcome: "created",
      object: {
        storageKey: input.storageKey,
        versionId,
        checksumSha256: expectedChecksum,
        sizeBytes: input.sizeBytes,
        mediaType: input.mediaType,
        lastModified: null,
        state: "available",
        quarantineEvidence: null
      },
      providerReceipt: {
        kind: "s3_put_object",
        checksumVerifiedByProvider,
        recordedAt: now().toISOString()
      }
    };
  }

  async function getObjectVersion(
    input: {
      identity: ObjectStorageObjectVersionIdentity;
      maximumBytes: number;
      range?: ObjectStorageByteRange;
    },
    verifyReturnedChecksum = true
  ): Promise<GetObjectVersionOutput> {
    validateIdentity(input.identity);
    const identity = {
      storageKey: input.identity.storageKey,
      versionId: input.identity.versionId
    };
    validatePositiveSafeInteger(input.maximumBytes, "maximumBytes");
    const requestedRange = validateRange(input.range, input.maximumBytes);
    const tags = await readTags(identity);
    if (tags.outcome === "not_found") {
      throw notFoundError(identity);
    }
    const quarantineEvidence = quarantineEvidenceFromTags(tags.tags);
    if (quarantineEvidence !== null) {
      throw new ObjectStorageError(
        "object_storage.quarantined",
        `Object version ${input.identity.versionId} is quarantined and cannot be read.`
      );
    }

    let output: S3GetOutput;
    try {
      output = (await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: identity.storageKey,
          VersionId: identity.versionId,
          Range:
            requestedRange === null
              ? undefined
              : `bytes=${requestedRange.start}-${requestedRange.endInclusive}`,
          ChecksumMode: "ENABLED"
        })
      )) as S3GetOutput;
    } catch (error) {
      if (isS3NotFound(error)) {
        throw notFoundError(identity, error);
      }
      if (isS3RangeNotSatisfiable(error)) {
        throw new ObjectStorageError(
          "object_storage.range_contract_violation",
          "Requested S3 byte range is not satisfiable.",
          { cause: error }
        );
      }
      throw providerError("Unable to stream S3 object version.", error);
    }

    if (output.DeleteMarker === true) {
      throw notFoundError(input.identity);
    }
    requireProviderVersionId(output.VersionId, identity.versionId);

    const rangeFacts = validateProviderRange(
      requestedRange,
      output.ContentRange,
      output.ContentLength,
      input.maximumBytes
    );

    const checksumSha256 = readProviderChecksum(output);
    return {
      identity,
      body: boundedBodyChunks(
        output.Body,
        input.maximumBytes,
        rangeFacts.responseSizeBytes,
        requestedRange === null
          ? "object_storage.integrity_mismatch"
          : "object_storage.range_contract_violation",
        requestedRange === null && verifyReturnedChecksum
          ? checksumSha256
          : null
      ),
      mediaType: output.ContentType ?? null,
      checksumSha256,
      objectSizeBytes: rangeFacts.objectSizeBytes,
      responseSizeBytes: rangeFacts.responseSizeBytes,
      range: rangeFacts.range
    };
  }

  async function verifyExactVersionBytes(
    object: ObjectStorageObjectVersion,
    maximumBytes: number,
    fallbackMediaType: string
  ): Promise<ObjectStorageExactVersionEvidence> {
    const read = await getObjectVersion(
      {
        identity: object,
        maximumBytes: Math.max(1, maximumBytes)
      },
      false
    );
    const hash = createHash("sha256");
    let observedBytes = 0;
    for await (const chunk of read.body) {
      observedBytes += chunk.byteLength;
      hash.update(chunk);
    }
    return {
      identity: read.identity,
      checksumSha256: parseHuleeSha256(`sha256:${hash.digest("hex")}`),
      sizeBytes: observedBytes,
      mediaType: read.mediaType ?? object.mediaType ?? fallbackMediaType
    };
  }

  async function quarantineExactIntegrityMismatch(
    observed: ObjectStorageExactVersionEvidence,
    reasonCode: string
  ): Promise<ObjectStorageQuarantineEvidence> {
    try {
      const outcome = await storage.quarantineObjectVersion({
        identity: observed.identity,
        reasonCode,
        evidenceSha256: calculateExactVersionIntegrityEvidence(
          observed,
          reasonCode
        )
      });
      if (outcome.outcome === "not_found") {
        throw new ObjectStorageError(
          "object_storage.not_found",
          "Integrity-mismatching exact object version disappeared before quarantine."
        );
      }
      return outcome.evidence;
    } catch (quarantineError) {
      throw new ObjectStorageError(
        "object_storage.immutable_conflict",
        "Exact-version integrity mismatch was observed but physical quarantine did not complete.",
        {
          cause: quarantineError,
          writeDisposition: "exact_version_observed",
          exactVersionEvidence: observed
        }
      );
    }
  }

  function calculateExactVersionIntegrityEvidence(
    observed: ObjectStorageExactVersionEvidence,
    reasonCode: string
  ): HuleeSha256 {
    return calculateHuleeSha256(
      Buffer.from(
        JSON.stringify({
          schemaId: "core:object-storage.exact-version-integrity-evidence",
          schemaVersion: "v1",
          reasonCode,
          identity: observed.identity,
          checksumSha256: observed.checksumSha256,
          sizeBytes: observed.sizeBytes,
          mediaType: observed.mediaType
        }),
        "utf8"
      )
    );
  }

  async function listObjectVersions(
    input: ListObjectVersionsInput
  ): Promise<ListObjectVersionsOutput> {
    const pageSize = input.pageSize ?? DEFAULT_OBJECT_STORAGE_LIST_PAGE_SIZE;
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_OBJECT_STORAGE_LIST_PAGE_SIZE
    ) {
      throw invalidArgument(
        `pageSize must be between 1 and ${MAX_OBJECT_STORAGE_LIST_PAGE_SIZE}.`
      );
    }
    if (
      typeof input.prefix !== "string" ||
      input.prefix.length > MAX_STORAGE_KEY_LENGTH ||
      CONTROL_CHARACTER_PATTERN.test(input.prefix)
    ) {
      throw invalidArgument(
        `prefix must contain at most ${MAX_STORAGE_KEY_LENGTH} characters and no control characters.`
      );
    }
    const cursor =
      input.cursor === undefined
        ? null
        : decodeListCursor(input.cursor, input.prefix);

    let output: S3ListVersionsOutput;
    try {
      output = (await client.send(
        new ListObjectVersionsCommand({
          Bucket: config.bucket,
          Prefix: input.prefix,
          MaxKeys: pageSize,
          KeyMarker: cursor?.keyMarker,
          VersionIdMarker: cursor?.versionIdMarker ?? undefined
        })
      )) as S3ListVersionsOutput;
    } catch (error) {
      throw providerError("Unable to list S3 object versions.", error);
    }

    const objects = (output.Versions ?? []).map((version) => ({
      kind: "object" as const,
      identity: {
        storageKey: requireProviderString(version.Key, "object version key"),
        versionId: requireProviderString(version.VersionId, "object version id")
      },
      isLatest: version.IsLatest === true,
      sizeBytes: requireNonNegativeProviderInteger(
        version.Size,
        "object version size"
      ),
      lastModified: version.LastModified?.toISOString() ?? null,
      providerChecksumAlgorithms: Object.freeze([
        ...(version.ChecksumAlgorithm ?? [])
      ])
    }));
    const deleteMarkers = (output.DeleteMarkers ?? []).map((marker) => ({
      kind: "delete_marker" as const,
      identity: {
        storageKey: requireProviderString(marker.Key, "delete marker key"),
        versionId: requireProviderString(
          marker.VersionId,
          "delete marker version id"
        )
      },
      isLatest: marker.IsLatest === true,
      lastModified: marker.LastModified?.toISOString() ?? null
    }));

    let nextCursor: string | null = null;
    if (output.IsTruncated === true) {
      const nextKeyMarker = requireProviderString(
        output.NextKeyMarker,
        "next key marker"
      );
      nextCursor = encodeListCursor({
        v: 1,
        prefix: input.prefix,
        keyMarker: nextKeyMarker,
        versionIdMarker: output.NextVersionIdMarker ?? null
      });
    }

    return {
      items: [...objects, ...deleteMarkers],
      nextCursor
    };
  }

  const storage: VersionAwareObjectStorage = {
    capabilities: S3_OBJECT_STORAGE_CAPABILITIES,

    async putObject(input) {
      validateStorageKey(input.storageKey);
      validateMediaType(input.mediaType);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: input.storageKey,
            Body: input.body,
            ContentLength: input.body.byteLength,
            ContentType: input.mediaType
            // Intentionally no original filename metadata. Filenames are
            // purgeable domain metadata and do not belong on physical objects.
          })
        );
      } catch (error) {
        throw providerError("Unable to put legacy S3 object.", error);
      }
    },

    async getObject(input) {
      validateStorageKey(input.storageKey);
      const maximumBytes =
        input.maximumBytes ?? DEFAULT_LEGACY_BUFFERED_READ_MAXIMUM_BYTES;
      validatePositiveSafeInteger(maximumBytes, "maximumBytes");

      const tags = await readTags({ storageKey: input.storageKey });
      if (tags.outcome === "not_found") {
        throw new ObjectStorageError(
          "object_storage.not_found",
          `Object ${input.storageKey} was not found.`
        );
      }
      if (quarantineEvidenceFromTags(tags.tags) !== null) {
        throw new ObjectStorageError(
          "object_storage.quarantined",
          `Object ${input.storageKey} is quarantined and cannot be read.`
        );
      }

      let output: S3GetOutput;
      try {
        output = (await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: input.storageKey,
            ChecksumMode: "ENABLED"
          })
        )) as S3GetOutput;
      } catch (error) {
        if (isS3NotFound(error)) {
          throw new ObjectStorageError(
            "object_storage.not_found",
            `Object ${input.storageKey} was not found.`,
            { cause: error }
          );
        }
        throw providerError("Unable to get legacy S3 object.", error);
      }

      if (
        output.ContentLength !== undefined &&
        output.ContentLength > maximumBytes
      ) {
        throw readBoundExceeded(maximumBytes);
      }
      const checksumSha256 = readProviderChecksum(output);
      const body = await collectBoundedBody(
        output.Body,
        maximumBytes,
        output.ContentLength ?? null,
        checksumSha256
      );
      return {
        body,
        mediaType: output.ContentType,
        sizeBytes: output.ContentLength ?? body.byteLength,
        versionId: output.VersionId,
        checksumSha256: checksumSha256 ?? undefined
      };
    },

    putObjectImmutable,
    getObjectVersion,

    async headObjectVersion(input): Promise<HeadObjectVersionOutput> {
      validateIdentity(input.identity);
      const result = await head(
        input.identity.storageKey,
        input.identity.versionId
      );
      return result.outcome === "found"
        ? { outcome: "found", object: result.object }
        : { outcome: "not_found", identity: input.identity };
    },

    listObjectVersions,

    async deleteObjectVersion(input): Promise<DeleteObjectVersionOutput> {
      validateIdentity(input.identity);
      try {
        const output = (await client.send(
          new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: input.identity.storageKey,
            VersionId: input.identity.versionId
          })
        )) as S3DeleteOutput;
        return {
          outcome: "deleted",
          identity: input.identity,
          providerDeleteMarker: output.DeleteMarker === true,
          providerResponseVersionId: output.VersionId ?? null,
          recordedAt: now().toISOString()
        };
      } catch (error) {
        if (isS3NotFound(error)) {
          return {
            outcome: "not_found",
            identity: input.identity,
            providerDeleteMarker: false,
            providerResponseVersionId: null,
            recordedAt: now().toISOString()
          };
        }
        throw providerError("Unable to delete exact S3 object version.", error);
      }
    },

    async quarantineObjectVersion(
      input
    ): Promise<QuarantineObjectVersionOutput> {
      validateIdentity(input.identity);
      if (!QUARANTINE_REASON_PATTERN.test(input.reasonCode)) {
        throw invalidArgument(
          "quarantine reasonCode must be a safe lowercase catalog token."
        );
      }
      const evidenceSha256 = parseHuleeSha256(input.evidenceSha256);
      const existing = await readTags(input.identity);
      if (existing.outcome === "not_found") {
        return {
          outcome: "not_found",
          identity: input.identity,
          recordedAt: now().toISOString()
        };
      }
      const existingEvidence = quarantineEvidenceFromTags(existing.tags);
      if (existingEvidence !== null) {
        if (
          existingEvidence.reasonCode !== input.reasonCode ||
          existingEvidence.evidenceSha256 !== evidenceSha256
        ) {
          throw new ObjectStorageError(
            "object_storage.immutable_conflict",
            "The object version is already quarantined under different immutable evidence."
          );
        }
        return {
          outcome: "already_quarantined",
          identity: input.identity,
          evidence: existingEvidence,
          recordedAt: now().toISOString()
        };
      }

      const retainedTags = existing.tags.filter(
        (tag) => !isReservedQuarantineTag(tag.Key)
      );
      if (
        retainedTags.length + RESERVED_QUARANTINE_TAG_COUNT >
        MAX_S3_OBJECT_TAGS
      ) {
        throw capabilityError(
          "S3 object version has too many tags to record quarantine evidence without destroying existing metadata."
        );
      }
      const evidence: ObjectStorageQuarantineEvidence = {
        reasonCode: input.reasonCode,
        evidenceSha256,
        physicalKind: "s3_object_version_tags"
      };
      const quarantineTags: S3Tag[] = [
        ...retainedTags,
        { Key: HULEE_STATE_TAG_KEY, Value: HULEE_QUARANTINED_TAG_VALUE },
        { Key: HULEE_QUARANTINE_REASON_TAG_KEY, Value: input.reasonCode },
        {
          Key: HULEE_QUARANTINE_EVIDENCE_TAG_KEY,
          Value: evidenceSha256.slice("sha256:".length)
        }
      ];

      try {
        await client.send(
          new PutObjectTaggingCommand({
            Bucket: config.bucket,
            Key: input.identity.storageKey,
            VersionId: input.identity.versionId,
            Tagging: { TagSet: quarantineTags }
          })
        );
      } catch (error) {
        if (isS3NotFound(error)) {
          return {
            outcome: "not_found",
            identity: input.identity,
            recordedAt: now().toISOString()
          };
        }
        throw providerError(
          "Unable to quarantine exact S3 object version.",
          error
        );
      }

      const verified = await readTags(input.identity);
      if (verified.outcome === "not_found") {
        return {
          outcome: "not_found",
          identity: input.identity,
          recordedAt: now().toISOString()
        };
      }
      const verifiedEvidence = quarantineEvidenceFromTags(verified.tags);
      if (
        verifiedEvidence === null ||
        verifiedEvidence.reasonCode !== input.reasonCode ||
        verifiedEvidence.evidenceSha256 !== evidenceSha256
      ) {
        throw new ObjectStorageError(
          "object_storage.integrity_mismatch",
          "S3 quarantine evidence did not verify after write."
        );
      }

      return {
        outcome: "quarantined",
        identity: input.identity,
        evidence,
        recordedAt: now().toISOString()
      };
    },

    async probeCapabilities(input = {}) {
      const checks = createCapabilityProbeChecks();
      let failure: ProbeObjectStorageCapabilitiesOutput["failure"] = null;
      let bucketVersioning: ProbeObjectStorageCapabilitiesOutput["bucketVersioning"] =
        "unknown";
      let versionEnumeration: ProbeObjectStorageCapabilitiesOutput["versionEnumeration"] =
        "unsupported";
      let observedVersionCount = 0;
      let observedDeleteMarkerCount = 0;
      const pendingCleanup = new Map<
        string,
        ObjectStorageObjectVersionIdentity
      >();

      const fail = (
        check: ObjectStorageCapabilityProbeCheckName,
        error: unknown
      ): false => {
        const detail = capabilityProbeFailure(error);
        checks[check] = {
          state: "failed",
          errorCode: detail.errorCode,
          message: detail.message
        };
        failure ??= { check, ...detail };
        return false;
      };
      const pass = (check: ObjectStorageCapabilityProbeCheckName): true => {
        checks[check] = {
          state: "passed",
          errorCode: null,
          message: null
        };
        return true;
      };

      try {
        try {
          const output = (await client.send(
            new GetBucketVersioningCommand({ Bucket: config.bucket })
          )) as { Status?: string };
          bucketVersioning =
            output.Status === "Enabled"
              ? "enabled"
              : output.Status === "Suspended"
                ? "suspended"
                : output.Status === undefined
                  ? "disabled"
                  : "unknown";
          if (bucketVersioning === "enabled") {
            pass("bucketVersioning");
          } else {
            fail(
              "bucketVersioning",
              capabilityError(
                `S3 bucket versioning is ${bucketVersioning}; Enabled is required.`
              )
            );
          }
        } catch (error) {
          fail(
            "bucketVersioning",
            providerError("Unable to probe S3 bucket versioning.", error)
          );
        }

        let probePrefix: string | null = null;
        try {
          probePrefix = capabilityProbePrefix(input.prefix);
          const baselinePage = await listObjectVersions({
            prefix: probePrefix,
            pageSize: 1
          });
          versionEnumeration = "supported";
          observedVersionCount = baselinePage.items.filter(
            (item) => item.kind === "object"
          ).length;
          observedDeleteMarkerCount = baselinePage.items.filter(
            (item) => item.kind === "delete_marker"
          ).length;
          pass("versionEnumerationApi");
        } catch (error) {
          fail("versionEnumerationApi", error);
        }

        if (
          checks.bucketVersioning.state === "passed" &&
          checks.versionEnumerationApi.state === "passed" &&
          probePrefix !== null
        ) {
          let storageKey: string | null = null;
          try {
            storageKey = capabilityProbeStorageKey(probePrefix, probeToken());
          } catch (error) {
            fail("immutableWrite", error);
          }

          if (storageKey !== null) {
            const body = Buffer.from(
              "hulee-object-storage-capability-probe-v1"
            );
            const checksumSha256 = calculateHuleeSha256(body);
            let identity: ObjectStorageObjectVersionIdentity | null = null;

            try {
              const written = await storage.putObjectImmutable({
                storageKey,
                body,
                sizeBytes: body.byteLength,
                mediaType: "application/octet-stream",
                checksumSha256,
                condition: "key_absent"
              });
              if (written.outcome !== "created") {
                throw capabilityError(
                  "The unique capability-probe key already existed; no provider object was adopted or deleted."
                );
              }
              identity = written.object;
              pendingCleanup.set(versionIdentityKey(identity), identity);
              pass("immutableWrite");
            } catch (error) {
              fail("immutableWrite", error);
            }

            if (identity !== null && checks.immutableWrite.state === "passed") {
              try {
                const headed = await storage.headObjectVersion({ identity });
                if (
                  headed.outcome !== "found" ||
                  headed.object.checksumSha256 !== checksumSha256 ||
                  headed.object.sizeBytes !== body.byteLength ||
                  headed.object.state !== "available"
                ) {
                  throw capabilityError(
                    "Exact-version HeadObject did not return the written object identity and integrity facts."
                  );
                }
                pass("exactVersionHead");
              } catch (error) {
                fail("exactVersionHead", error);
              }
            }

            if (
              identity !== null &&
              checks.exactVersionHead.state === "passed"
            ) {
              try {
                const read = await storage.getObjectVersion({
                  identity,
                  maximumBytes: body.byteLength
                });
                const readBody = await collectCapabilityProbeBody(read.body);
                if (
                  read.checksumSha256 !== checksumSha256 ||
                  read.objectSizeBytes !== body.byteLength ||
                  calculateHuleeSha256(readBody) !== checksumSha256
                ) {
                  throw new ObjectStorageError(
                    "object_storage.integrity_mismatch",
                    "Exact-version streamed bytes or checksum evidence did not match the probe write."
                  );
                }
                pass("streamingReadChecksum");
              } catch (error) {
                fail("streamingReadChecksum", error);
              }
            }

            if (
              identity !== null &&
              checks.streamingReadChecksum.state === "passed"
            ) {
              try {
                const exactPage = await listObjectVersions({
                  prefix: storageKey,
                  pageSize: 10
                });
                observedVersionCount = exactPage.items.filter(
                  (item) => item.kind === "object"
                ).length;
                observedDeleteMarkerCount = exactPage.items.filter(
                  (item) => item.kind === "delete_marker"
                ).length;
                if (
                  !exactPage.items.some(
                    (item) =>
                      item.kind === "object" &&
                      item.identity.storageKey === identity?.storageKey &&
                      item.identity.versionId === identity?.versionId
                  )
                ) {
                  throw capabilityError(
                    "Version enumeration did not return the exact probe object version."
                  );
                }
                pass("exactVersionEnumeration");
              } catch (error) {
                fail("exactVersionEnumeration", error);
              }
            }

            if (
              identity !== null &&
              checks.exactVersionEnumeration.state === "passed"
            ) {
              try {
                const conditionalReplay = await storage.putObjectImmutable({
                  storageKey,
                  body,
                  sizeBytes: body.byteLength,
                  mediaType: "application/octet-stream",
                  checksumSha256,
                  condition: "key_absent"
                });
                if (conditionalReplay.outcome === "created") {
                  pendingCleanup.set(
                    versionIdentityKey(conditionalReplay.object),
                    conditionalReplay.object
                  );
                  throw capabilityError(
                    "S3 created another version instead of rejecting the same-key conditional replay."
                  );
                }
                if (
                  conditionalReplay.object.versionId !== identity.versionId ||
                  conditionalReplay.object.checksumSha256 !== checksumSha256
                ) {
                  throw capabilityError(
                    "Conditional replay did not resolve to the exact original probe version."
                  );
                }
                pass("immutableConditionalPut");
              } catch (error) {
                fail("immutableConditionalPut", error);
              }
            }

            if (
              identity !== null &&
              checks.immutableConditionalPut.state === "passed"
            ) {
              try {
                const evidenceSha256 = calculateHuleeSha256(
                  Buffer.from(`quarantine:${checksumSha256}`)
                );
                const quarantined = await storage.quarantineObjectVersion({
                  identity,
                  reasonCode: "capability.probe",
                  evidenceSha256
                });
                if (
                  quarantined.outcome !== "quarantined" ||
                  quarantined.evidence.evidenceSha256 !== evidenceSha256 ||
                  quarantined.evidence.reasonCode !== "capability.probe"
                ) {
                  throw capabilityError(
                    "Exact-version quarantine tags were not written and verified."
                  );
                }
                try {
                  await storage.getObjectVersion({
                    identity,
                    maximumBytes: body.byteLength
                  });
                  throw capabilityError(
                    "A quarantined exact object version remained readable."
                  );
                } catch (error) {
                  if (
                    !(
                      error instanceof ObjectStorageError &&
                      error.code === "object_storage.quarantined"
                    )
                  ) {
                    throw error;
                  }
                }
                pass("physicalQuarantineEvidence");
              } catch (error) {
                fail("physicalQuarantineEvidence", error);
              }
            }

            if (
              identity !== null &&
              checks.physicalQuarantineEvidence.state === "passed"
            ) {
              try {
                const deleted = await storage.deleteObjectVersion({ identity });
                if (deleted.outcome !== "deleted") {
                  throw capabilityError(
                    "Exact-version deletion did not acknowledge the probe version."
                  );
                }
                const afterDelete = await storage.headObjectVersion({
                  identity
                });
                if (afterDelete.outcome !== "not_found") {
                  throw capabilityError(
                    "Exact probe object version remained addressable after deletion."
                  );
                }
                pendingCleanup.delete(versionIdentityKey(identity));
                pass("exactVersionDelete");
              } catch (error) {
                fail("exactVersionDelete", error);
              }
            }
          }
        }
      } finally {
        const cleanupErrors: string[] = [];
        for (const [key, identity] of pendingCleanup) {
          try {
            await storage.deleteObjectVersion({ identity });
            const afterCleanup = await storage.headObjectVersion({ identity });
            if (afterCleanup.outcome !== "not_found") {
              cleanupErrors.push(
                `Probe version ${identity.versionId} remained addressable after cleanup.`
              );
              continue;
            }
            pendingCleanup.delete(key);
          } catch (error) {
            cleanupErrors.push(capabilityProbeFailure(error).message);
          }
        }
        if (cleanupErrors.length === 0 && pendingCleanup.size === 0) {
          pass("cleanup");
        } else {
          fail(
            "cleanup",
            new ObjectStorageError(
              "object_storage.provider_failure",
              `Capability probe cleanup failed: ${cleanupErrors.join("; ")}`
            )
          );
        }
      }

      return capabilityProbeOutput({
        checks,
        failure,
        bucketVersioning,
        versionEnumeration,
        observedVersionCount,
        observedDeleteMarkerCount,
        now
      });
    }
  };

  return storage;
}

type MutableCapabilityProbeChecks = Record<
  ObjectStorageCapabilityProbeCheckName,
  ObjectStorageCapabilityProbeCheck
>;

function createCapabilityProbeChecks(): MutableCapabilityProbeChecks {
  const skipped = (): ObjectStorageCapabilityProbeCheck => ({
    state: "skipped",
    errorCode: null,
    message:
      "Not attempted because an earlier required capability did not verify."
  });
  return {
    bucketVersioning: skipped(),
    versionEnumerationApi: skipped(),
    immutableWrite: skipped(),
    exactVersionHead: skipped(),
    streamingReadChecksum: skipped(),
    exactVersionEnumeration: skipped(),
    immutableConditionalPut: skipped(),
    physicalQuarantineEvidence: skipped(),
    exactVersionDelete: skipped(),
    cleanup: skipped()
  };
}

function capabilityProbeFailure(error: unknown): {
  errorCode: ObjectStorageErrorCode;
  message: string;
} {
  if (error instanceof ObjectStorageError) {
    return { errorCode: error.code, message: error.message };
  }
  return {
    errorCode: "object_storage.provider_failure",
    message:
      error instanceof Error
        ? error.message
        : "Object storage capability probe failed with an unknown provider error."
  };
}

function capabilityProbeOutput(input: {
  checks: MutableCapabilityProbeChecks;
  failure: ProbeObjectStorageCapabilitiesOutput["failure"];
  bucketVersioning: ProbeObjectStorageCapabilitiesOutput["bucketVersioning"];
  versionEnumeration: ProbeObjectStorageCapabilitiesOutput["versionEnumeration"];
  observedVersionCount: number;
  observedDeleteMarkerCount: number;
  now: () => Date;
}): ProbeObjectStorageCapabilitiesOutput {
  return {
    provider: "s3",
    capabilities: S3_OBJECT_STORAGE_CAPABILITIES,
    bucketVersioning: input.bucketVersioning,
    versionEnumeration: input.versionEnumeration,
    observedVersionCount: input.observedVersionCount,
    observedDeleteMarkerCount: input.observedDeleteMarkerCount,
    checks: input.checks,
    failure: input.failure,
    readyForVersionAwareWrites:
      input.failure === null &&
      Object.values(input.checks).every((check) => check.state === "passed"),
    probedAt: input.now().toISOString()
  };
}

function capabilityProbePrefix(prefix: string | undefined): string {
  const resolved = prefix ?? "__hulee_capability_probe__/";
  if (resolved.length === 0) {
    throw invalidArgument(
      "Capability probes require a non-empty dedicated storage prefix."
    );
  }
  if (
    resolved.length > MAX_STORAGE_KEY_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(resolved)
  ) {
    throw invalidArgument(
      `Capability-probe prefix must contain at most ${MAX_STORAGE_KEY_LENGTH} characters and no control characters.`
    );
  }
  return resolved;
}

function capabilityProbeStorageKey(prefix: string, token: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(token)) {
    throw invalidArgument(
      "Capability-probe token must be a bounded URL-safe random identifier."
    );
  }
  const separator = prefix.endsWith("/") ? "" : "/";
  const storageKey = `${prefix}${separator}object-${token}`;
  validateStorageKey(storageKey);
  return storageKey;
}

function versionIdentityKey(
  identity: ObjectStorageObjectVersionIdentity
): string {
  return `${identity.storageKey}\u0000${identity.versionId}`;
}

async function collectCapabilityProbeBody(
  body: AsyncIterable<Uint8Array>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function prepareWriteBody(
  body: ObjectStorageWriteBody,
  sizeBytes: number,
  checksumSha256: HuleeSha256
): Uint8Array | Readable {
  if (body instanceof Uint8Array) {
    if (body.byteLength !== sizeBytes) {
      throw new ObjectStorageError(
        "object_storage.integrity_mismatch",
        `Body has ${body.byteLength} bytes but ${sizeBytes} were declared.`,
        { writeDisposition: "definitely_not_written" }
      );
    }
    if (calculateHuleeSha256(body) !== checksumSha256) {
      throw new ObjectStorageError(
        "object_storage.integrity_mismatch",
        "Body SHA-256 does not match the declared Hulee checksum.",
        { writeDisposition: "definitely_not_written" }
      );
    }
    return body;
  }

  if (!isAsyncIterable(body)) {
    throw invalidArgument(
      "body must be Uint8Array or AsyncIterable<Uint8Array>."
    );
  }

  return Readable.from(verifyWriteChunks(body, sizeBytes, checksumSha256), {
    objectMode: false
  });
}

async function* verifyWriteChunks(
  body: AsyncIterable<Uint8Array>,
  sizeBytes: number,
  checksumSha256: HuleeSha256
): AsyncGenerator<Uint8Array> {
  const hash = createHash("sha256");
  let observedBytes = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) {
      throw invalidArgument("Object write stream yielded a non-binary chunk.");
    }
    observedBytes += chunk.byteLength;
    if (observedBytes > sizeBytes) {
      throw new ObjectStorageError(
        "object_storage.integrity_mismatch",
        "Object write stream exceeded its declared size."
      );
    }
    hash.update(chunk);
    yield chunk;
  }

  if (observedBytes !== sizeBytes) {
    throw new ObjectStorageError(
      "object_storage.integrity_mismatch",
      `Object write stream produced ${observedBytes} bytes instead of ${sizeBytes}.`
    );
  }
  const observedChecksum = `sha256:${hash.digest("hex")}`;
  if (observedChecksum !== checksumSha256) {
    throw new ObjectStorageError(
      "object_storage.integrity_mismatch",
      "Object write stream SHA-256 did not match its declaration."
    );
  }
}

async function* boundedBodyChunks(
  body: unknown,
  maximumBytes: number,
  expectedBytes: number | null = null,
  mismatchCode:
    | "object_storage.integrity_mismatch"
    | "object_storage.range_contract_violation" = "object_storage.integrity_mismatch",
  expectedChecksumSha256: HuleeSha256 | null = null
): AsyncGenerator<Uint8Array> {
  let observedBytes = 0;
  const hash = expectedChecksumSha256 === null ? null : createHash("sha256");
  for await (const chunk of objectBodyChunks(
    body,
    maximumBytes,
    expectedBytes
  )) {
    observedBytes += chunk.byteLength;
    if (observedBytes > maximumBytes) {
      throw readBoundExceeded(maximumBytes);
    }
    hash?.update(chunk);
    yield chunk;
  }
  if (expectedBytes !== null && observedBytes !== expectedBytes) {
    throw new ObjectStorageError(
      mismatchCode,
      `Object body produced ${observedBytes} bytes while the provider declared ${expectedBytes}.`
    );
  }
  if (
    hash !== null &&
    `sha256:${hash.digest("hex")}` !== expectedChecksumSha256
  ) {
    throw new ObjectStorageError(
      "object_storage.integrity_mismatch",
      "Streamed object bytes do not match the provider SHA-256 evidence."
    );
  }
}

async function collectBoundedBody(
  body: unknown,
  maximumBytes: number,
  expectedBytes: number | null = null,
  expectedChecksumSha256: HuleeSha256 | null = null
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of boundedBodyChunks(
    body,
    maximumBytes,
    expectedBytes,
    "object_storage.integrity_mismatch",
    expectedChecksumSha256
  )) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function* objectBodyChunks(
  body: unknown,
  maximumBytes: number,
  expectedBytes: number | null
): AsyncGenerator<Uint8Array> {
  if (body === undefined || body === null) {
    return;
  }
  if (body instanceof Uint8Array) {
    yield body;
    return;
  }
  if (isAsyncIterable(body)) {
    for await (const chunk of body) {
      yield toUint8ArrayChunk(chunk);
    }
    return;
  }
  if (
    typeof body === "object" &&
    "transformToWebStream" in body &&
    typeof body.transformToWebStream === "function"
  ) {
    const stream = body.transformToWebStream() as ReadableStream<unknown>;
    const reader = stream.getReader();
    let completed = false;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          completed = true;
          break;
        }
        yield toUint8ArrayChunk(result.value);
      }
    } finally {
      if (!completed) {
        await reader.cancel("Hulee object read stopped before completion.");
      }
      reader.releaseLock();
    }
    return;
  }
  if (
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    if (expectedBytes === null || expectedBytes > maximumBytes) {
      throw capabilityError(
        "S3 transformToByteArray fallback requires a declared ContentLength within the caller read bound."
      );
    }
    yield toUint8ArrayChunk(await body.transformToByteArray());
    return;
  }

  throw capabilityError("S3 returned an unsupported object body type.");
}

function toUint8ArrayChunk(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }
  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }
  if (typeof chunk === "string") {
    return Buffer.from(chunk);
  }
  throw capabilityError("S3 object body yielded a non-binary chunk.");
}

function validateProviderRange(
  requestedRange: ObjectStorageByteRange | null,
  contentRange: string | undefined,
  contentLength: number | undefined,
  maximumBytes: number
): {
  range: ObjectStorageByteRange | null;
  responseSizeBytes: number | null;
  objectSizeBytes: number | null;
} {
  const responseSizeBytes =
    contentLength === undefined
      ? null
      : requireNonNegativeProviderInteger(contentLength, "ContentLength");
  if (responseSizeBytes !== null && responseSizeBytes > maximumBytes) {
    throw readBoundExceeded(maximumBytes);
  }

  if (requestedRange === null) {
    return {
      range: null,
      responseSizeBytes,
      objectSizeBytes: responseSizeBytes
    };
  }
  if (contentRange === undefined) {
    throw new ObjectStorageError(
      "object_storage.range_contract_violation",
      "S3 did not confirm the requested byte range."
    );
  }
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(contentRange);
  if (match === null) {
    throw new ObjectStorageError(
      "object_storage.range_contract_violation",
      "S3 returned an invalid Content-Range."
    );
  }
  const start = Number(match[1]);
  const endInclusive = Number(match[2]);
  const objectSizeBytes =
    match[3] === "*"
      ? null
      : requireNonNegativeProviderInteger(
          Number(match[3]),
          "Content-Range object size"
        );
  if (
    start !== requestedRange.start ||
    endInclusive > requestedRange.endInclusive ||
    endInclusive < start ||
    (responseSizeBytes !== null &&
      responseSizeBytes !== endInclusive - start + 1)
  ) {
    throw new ObjectStorageError(
      "object_storage.range_contract_violation",
      "S3 returned bytes outside the requested range."
    );
  }

  return {
    range: { start, endInclusive },
    responseSizeBytes,
    objectSizeBytes
  };
}

function validateRange(
  range: ObjectStorageByteRange | undefined,
  maximumBytes: number
): ObjectStorageByteRange | null {
  if (range === undefined) {
    return null;
  }
  validateNonNegativeSafeInteger(range.start, "range.start");
  validateNonNegativeSafeInteger(range.endInclusive, "range.endInclusive");
  if (range.endInclusive < range.start) {
    throw invalidArgument("range.endInclusive must be at least range.start.");
  }
  if (range.endInclusive - range.start + 1 > maximumBytes) {
    throw readBoundExceeded(maximumBytes);
  }
  return range;
}

function readProviderChecksum(
  output: {
    Metadata?: Record<string, string>;
    ChecksumSHA256?: string;
  },
  observed?: Readonly<{
    identity: ObjectStorageObjectVersionIdentity;
    sizeBytes: number;
    mediaType: string | null;
  }>
): HuleeSha256 | null {
  const metadataValue = output.Metadata?.[HULEE_CHECKSUM_METADATA_KEY];
  const metadataChecksum =
    metadataValue === undefined ? null : parseHuleeSha256(metadataValue);
  const providerChecksum =
    output.ChecksumSHA256 === undefined
      ? null
      : s3ChecksumToHuleeSha256(output.ChecksumSHA256);
  if (
    metadataChecksum !== null &&
    providerChecksum !== null &&
    metadataChecksum !== providerChecksum
  ) {
    if (observed !== undefined && observed.mediaType !== null) {
      throw new ObjectStorageError(
        "object_storage.integrity_mismatch",
        "S3 checksum metadata disagrees with the provider SHA-256 header.",
        {
          writeDisposition: "exact_version_observed",
          exactVersionEvidence: {
            identity: observed.identity,
            checksumSha256: providerChecksum,
            sizeBytes: observed.sizeBytes,
            mediaType: observed.mediaType
          }
        }
      );
    }
    throw new ObjectStorageError(
      "object_storage.integrity_mismatch",
      "S3 checksum metadata disagrees with the provider SHA-256 header."
    );
  }
  return metadataChecksum ?? providerChecksum;
}

function quarantineEvidenceFromTags(
  tags: readonly S3Tag[]
): ObjectStorageQuarantineEvidence | null {
  const values = new Map<string, string>();
  for (const tag of tags) {
    values.set(tag.Key, tag.Value);
  }
  const state = values.get(HULEE_STATE_TAG_KEY);
  const reason = values.get(HULEE_QUARANTINE_REASON_TAG_KEY);
  const evidenceHex = values.get(HULEE_QUARANTINE_EVIDENCE_TAG_KEY);
  const hasAnyEvidence =
    state !== undefined || reason !== undefined || evidenceHex !== undefined;
  if (!hasAnyEvidence) {
    return null;
  }
  if (
    state !== HULEE_QUARANTINED_TAG_VALUE ||
    reason === undefined ||
    !QUARANTINE_REASON_PATTERN.test(reason) ||
    evidenceHex === undefined
  ) {
    throw new ObjectStorageError(
      "object_storage.integrity_mismatch",
      "S3 object version contains incomplete quarantine evidence."
    );
  }
  return {
    reasonCode: reason,
    evidenceSha256: parseHuleeSha256(`sha256:${evidenceHex}`),
    physicalKind: "s3_object_version_tags"
  };
}

function isReservedQuarantineTag(key: string): boolean {
  return (
    key === HULEE_STATE_TAG_KEY ||
    key === HULEE_QUARANTINE_REASON_TAG_KEY ||
    key === HULEE_QUARANTINE_EVIDENCE_TAG_KEY
  );
}

function encodeListCursor(cursor: S3ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeListCursor(value: string, prefix: string): S3ListCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<S3ListCursor>;
    if (
      parsed.v !== 1 ||
      parsed.prefix !== prefix ||
      typeof parsed.keyMarker !== "string" ||
      !(
        parsed.versionIdMarker === null ||
        typeof parsed.versionIdMarker === "string"
      )
    ) {
      throw new Error("invalid cursor shape");
    }
    return parsed as S3ListCursor;
  } catch (error) {
    throw invalidArgument(
      "cursor is invalid or belongs to another prefix.",
      error
    );
  }
}

function validateIdentity(identity: ObjectStorageObjectVersionIdentity): void {
  validateStorageKey(identity.storageKey);
  validateBoundedText(
    identity.versionId,
    "versionId",
    MAX_STORAGE_VERSION_IDENTITY_LENGTH
  );
}

function validateStorageKey(storageKey: string): void {
  validateBoundedText(storageKey, "storageKey", MAX_STORAGE_KEY_LENGTH);
}

function validateMediaType(mediaType: string): void {
  validateBoundedText(mediaType, "mediaType", MAX_MEDIA_TYPE_LENGTH);
}

function validateBoundedText(
  value: string,
  field: string,
  maximumLength: number
): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw invalidArgument(
      `${field} must contain 1-${maximumLength} characters and no control characters.`
    );
  }
}

function validateNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidArgument(`${field} must be a non-negative safe integer.`);
  }
}

function validatePositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidArgument(`${field} must be a positive safe integer.`);
  }
}

function requireNonNegativeProviderInteger(
  value: number | undefined,
  field: string
): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    throw capabilityError(`${field} is missing or invalid.`);
  }
  return value;
}

function requireProviderVersionId(
  actual: string | undefined,
  expected?: string
): string {
  if (
    actual === undefined ||
    actual.length === 0 ||
    actual.length > MAX_STORAGE_VERSION_IDENTITY_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(actual)
  ) {
    throw capabilityError(
      "S3 did not return a bounded object version id; bucket versioning must be enabled."
    );
  }
  if (expected !== undefined && actual !== expected) {
    throw capabilityError(
      `S3 returned version ${actual} while ${expected} was requested.`
    );
  }
  return actual;
}

function requireProviderString(
  value: string | undefined,
  field: string
): string {
  if (value === undefined || value.length === 0) {
    throw capabilityError(`S3 ${field} is missing.`);
  }
  return value;
}

function invalidArgument(message: string, cause?: unknown): ObjectStorageError {
  return new ObjectStorageError("object_storage.invalid_argument", message, {
    cause
  });
}

function normalizeMaximumImmutableObjectBytes(value: number | undefined) {
  const resolved =
    value ?? DEFAULT_VERSION_AWARE_IMMUTABLE_OBJECT_MAXIMUM_BYTES;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new TypeError(
      "maximumImmutableObjectBytes must be a positive safe integer."
    );
  }
  return resolved;
}

function capabilityError(message: string): ObjectStorageError {
  return new ObjectStorageError(
    "object_storage.provider_capability_missing",
    message
  );
}

function providerError(message: string, cause: unknown): ObjectStorageError {
  if (cause instanceof ObjectStorageError) {
    return cause;
  }
  return new ObjectStorageError("object_storage.provider_failure", message, {
    cause
  });
}

/**
 * A transport/protocol failure around PutObject cannot prove that no immutable
 * version was created. Callers must retain reconciliation work and retry the
 * same deterministic key with If-None-Match instead of terminally failing the
 * application row.
 */
function writeOutcomeUnknownError(
  message: string,
  cause?: unknown
): ObjectStorageError {
  return new ObjectStorageError(
    "object_storage.write_outcome_unknown",
    message,
    {
      ...(cause === undefined ? {} : { cause }),
      writeDisposition: "unknown"
    }
  );
}

function exactVersionEvidenceFromObject(
  object: ObjectStorageObjectVersion
): ObjectStorageExactVersionEvidence | null {
  return exactVersionEvidence({
    identity: { storageKey: object.storageKey, versionId: object.versionId },
    checksumSha256: object.checksumSha256,
    sizeBytes: object.sizeBytes,
    mediaType: object.mediaType
  });
}

function exactVersionEvidence(
  input: Readonly<{
    identity: ObjectStorageObjectVersionIdentity;
    checksumSha256: HuleeSha256 | null;
    sizeBytes: number;
    mediaType: string | null;
  }>
): ObjectStorageExactVersionEvidence | null {
  if (input.checksumSha256 === null || input.mediaType === null) return null;
  return {
    identity: input.identity,
    checksumSha256: input.checksumSha256,
    sizeBytes: input.sizeBytes,
    mediaType: input.mediaType
  };
}

function withExactVersionEvidence(
  error: unknown,
  evidence: ObjectStorageExactVersionEvidence,
  fallbackMessage: string
): ObjectStorageError {
  return new ObjectStorageError(
    error instanceof ObjectStorageError
      ? error.code
      : "object_storage.provider_failure",
    error instanceof Error ? error.message : fallbackMessage,
    {
      cause: error,
      writeDisposition: "exact_version_observed",
      exactVersionEvidence: evidence
    }
  );
}

function notFoundError(
  identity: ObjectStorageObjectVersionIdentity,
  cause?: unknown
): ObjectStorageError {
  return new ObjectStorageError(
    "object_storage.not_found",
    `Object version ${identity.versionId} was not found at ${identity.storageKey}.`,
    { cause }
  );
}

function readBoundExceeded(maximumBytes: number): ObjectStorageError {
  return new ObjectStorageError(
    "object_storage.read_bound_exceeded",
    `Object read exceeded its ${maximumBytes}-byte bound.`
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

function isS3NotFound(error: unknown): boolean {
  return (
    errorName(error) === "NoSuchKey" ||
    errorName(error) === "NoSuchVersion" ||
    errorName(error) === "NotFound" ||
    errorStatus(error) === 404
  );
}

function isS3PreconditionFailed(error: unknown): boolean {
  return (
    errorName(error) === "PreconditionFailed" || errorStatus(error) === 412
  );
}

function isS3RangeNotSatisfiable(error: unknown): boolean {
  return errorName(error) === "InvalidRange" || errorStatus(error) === 416;
}

function isChecksumFailure(error: unknown): boolean {
  return (
    errorName(error) === "BadDigest" ||
    errorName(error) === "InvalidRequest" ||
    errorName(error) === "ChecksumMismatch"
  );
}

function isDefiniteS3WriteRejection(error: unknown): boolean {
  const status = errorStatus(error);
  const name = errorName(error);
  return (
    status !== null &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 425 &&
    status !== 429 &&
    name !== "RequestTimeout" &&
    name !== "RequestTimeoutException"
  );
}

function errorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  if ("name" in error && typeof error.name === "string") {
    return error.name;
  }
  if ("Code" in error && typeof error.Code === "string") {
    return error.Code;
  }
  return null;
}

function errorStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "$metadata" in error &&
    typeof error.$metadata === "object" &&
    error.$metadata !== null &&
    "httpStatusCode" in error.$metadata &&
    typeof error.$metadata.httpStatusCode === "number"
  ) {
    return error.$metadata.httpStatusCode;
  }
  return null;
}
