import {
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  PutObjectTaggingCommand
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import {
  calculateHuleeSha256,
  createS3ObjectStorage,
  DEFAULT_VERSION_AWARE_IMMUTABLE_OBJECT_MAXIMUM_BYTES,
  huleeSha256ToS3Checksum,
  isVersionAwareObjectStorage,
  parseHuleeSha256,
  requireVersionAwareObjectStorage,
  s3ChecksumToHuleeSha256,
  type ObjectStorage,
  type S3ObjectStorageClient
} from "./index";

const config = {
  endpoint: "http://object-storage.test",
  region: "test-1",
  bucket: "tenant-objects",
  accessKeyId: "access",
  secretAccessKey: "secret",
  forcePathStyle: true
};
const fixedNow = new Date("2026-07-18T12:00:00.000Z");
const probeToken = "probe-token-0001";

describe("S3 version-aware object storage", () => {
  it("conditionally puts immutable bytes with provider SHA-256 and no filename metadata", async () => {
    const body = Buffer.from("hello");
    const checksum = calculateHuleeSha256(body);
    const client = scriptedClient([
      {
        VersionId: "version-1",
        ChecksumSHA256: huleeSha256ToS3Checksum(checksum),
        ETag: '"not-a-checksum"'
      }
    ]);
    const storage = createStorage(client);

    const output = await storage.putObjectImmutable({
      storageKey: "tenant/file-1/original",
      body,
      sizeBytes: body.byteLength,
      mediaType: "text/plain",
      checksumSha256: checksum,
      condition: "key_absent"
    });

    expect(output).toMatchObject({
      outcome: "created",
      object: {
        storageKey: "tenant/file-1/original",
        versionId: "version-1",
        checksumSha256: checksum,
        state: "available"
      },
      providerReceipt: {
        checksumVerifiedByProvider: true,
        recordedAt: fixedNow.toISOString()
      }
    });
    const command = expectCommand(client.commands[0], PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: config.bucket,
      Key: "tenant/file-1/original",
      Body: body,
      ContentLength: body.byteLength,
      ContentType: "text/plain",
      ChecksumSHA256: huleeSha256ToS3Checksum(checksum),
      IfNoneMatch: "*",
      Metadata: { "hulee-sha256": checksum }
    });
    expect(command.input.Metadata).not.toHaveProperty("originalFileName");
    expect(command.input.Metadata).not.toHaveProperty("originalfilename");
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-canonical-checksum"]
  ])(
    "verifies exact stored bytes before accepting a %s PUT checksum response",
    async (_label, responseChecksum) => {
      const body = Buffer.from("verify after put");
      const checksum = calculateHuleeSha256(body);
      const client = scriptedClient([
        {
          VersionId: "version-read-verified",
          ...(responseChecksum === undefined
            ? {}
            : { ChecksumSHA256: responseChecksum })
        },
        { VersionId: "version-read-verified", TagSet: [] },
        {
          VersionId: "version-read-verified",
          ContentLength: body.byteLength,
          ContentType: "text/plain",
          Body: body
        }
      ]);

      await expect(
        createStorage(client).putObjectImmutable({
          storageKey: `tenant/${_label}-put-checksum`,
          body,
          sizeBytes: body.byteLength,
          mediaType: "text/plain",
          checksumSha256: checksum
        })
      ).resolves.toMatchObject({
        outcome: "created",
        object: {
          versionId: "version-read-verified",
          checksumSha256: checksum,
          sizeBytes: body.byteLength
        },
        providerReceipt: { checksumVerifiedByProvider: false }
      });
      expect(client.commands[1]).toBeInstanceOf(GetObjectTaggingCommand);
      expect(client.commands[2]).toBeInstanceOf(GetObjectCommand);
      expect(client.commands).toHaveLength(3);
    }
  );

  it("quarantines an acknowledged exact version when post-write verification finds different bytes", async () => {
    const body = Buffer.from("expected bytes");
    const corruptBody = Buffer.from("corrupted byte");
    const checksum = calculateHuleeSha256(body);
    const observedChecksum = calculateHuleeSha256(corruptBody);
    const reasonCode = "integrity.post_write_verification_mismatch";
    const evidenceSha256 = exactVersionIntegrityEvidence({
      reasonCode,
      storageKey: "tenant/post-write-mismatch",
      versionId: "version-post-write-mismatch",
      checksumSha256: observedChecksum,
      sizeBytes: corruptBody.byteLength,
      mediaType: "text/plain"
    });
    const quarantineTags = quarantineTagSet({ reasonCode, evidenceSha256 });
    const client = scriptedClient([
      { VersionId: "version-post-write-mismatch" },
      { VersionId: "version-post-write-mismatch", TagSet: [] },
      {
        VersionId: "version-post-write-mismatch",
        ContentLength: corruptBody.byteLength,
        ContentType: "text/plain",
        Body: corruptBody
      },
      { VersionId: "version-post-write-mismatch", TagSet: [] },
      { VersionId: "version-post-write-mismatch" },
      { VersionId: "version-post-write-mismatch", TagSet: quarantineTags }
    ]);

    await expect(
      createStorage(client).putObjectImmutable({
        storageKey: "tenant/post-write-mismatch",
        body,
        sizeBytes: body.byteLength,
        mediaType: "text/plain",
        checksumSha256: checksum
      })
    ).rejects.toMatchObject({
      code: "object_storage.integrity_mismatch",
      writeDisposition: "exact_version_observed",
      exactVersionEvidence: {
        identity: {
          storageKey: "tenant/post-write-mismatch",
          versionId: "version-post-write-mismatch"
        },
        checksumSha256: observedChecksum,
        sizeBytes: corruptBody.byteLength,
        mediaType: "text/plain"
      },
      quarantineEvidence: {
        reasonCode,
        evidenceSha256,
        physicalKind: "s3_object_version_tags"
      }
    });
    expect(client.commands[4]).toBeInstanceOf(PutObjectTaggingCommand);
  });

  it("keeps legacy put source-compatible without persisting original filename metadata", async () => {
    const client = scriptedClient([{}]);
    const storage = createStorage(client);

    await storage.putObject({
      storageKey: "legacy/file",
      body: Buffer.from("x"),
      mediaType: "text/plain",
      fileName: "personal-name.txt"
    });

    const command = expectCommand(client.commands[0], PutObjectCommand);
    expect(command.input.Metadata).toBeUndefined();
  });

  it("rejects keys, version identities and media types outside DB bounds", async () => {
    const client = scriptedClient([]);
    const storage = createStorage(client);

    await expect(
      storage.putObject({
        storageKey: `${"k".repeat(2_048)}x`,
        body: new Uint8Array(),
        mediaType: "application/octet-stream"
      })
    ).rejects.toMatchObject({ code: "object_storage.invalid_argument" });
    await expect(
      storage.putObject({
        storageKey: "tenant/control\nkey",
        body: new Uint8Array(),
        mediaType: "application/octet-stream"
      })
    ).rejects.toMatchObject({ code: "object_storage.invalid_argument" });
    await expect(
      storage.headObjectVersion({
        identity: {
          storageKey: "tenant/file",
          versionId: "v".repeat(1_025)
        }
      })
    ).rejects.toMatchObject({ code: "object_storage.invalid_argument" });
    await expect(
      storage.headObjectVersion({
        identity: {
          storageKey: "tenant/file",
          versionId: "version\u0000id"
        }
      })
    ).rejects.toMatchObject({ code: "object_storage.invalid_argument" });
    await expect(
      storage.putObject({
        storageKey: "tenant/file",
        body: new Uint8Array(),
        mediaType: "text/plain\r"
      })
    ).rejects.toMatchObject({ code: "object_storage.invalid_argument" });
    await expect(
      storage.putObject({
        storageKey: "tenant/file",
        body: new Uint8Array(),
        mediaType: "m".repeat(256)
      })
    ).rejects.toMatchObject({ code: "object_storage.invalid_argument" });
    expect(client.commands).toHaveLength(0);
  });

  it("rejects oversized immutable input before provider I/O or body iteration", async () => {
    const client = scriptedClient([]);
    let iterated = false;
    const body = (async function* () {
      iterated = true;
      yield new Uint8Array([1]);
    })();

    await expect(
      createStorage(client).putObjectImmutable({
        storageKey: "tenant/oversized",
        body,
        sizeBytes: DEFAULT_VERSION_AWARE_IMMUTABLE_OBJECT_MAXIMUM_BYTES + 1,
        mediaType: "application/octet-stream",
        checksumSha256: calculateHuleeSha256(new Uint8Array([1]))
      })
    ).rejects.toMatchObject({
      code: "object_storage.invalid_argument",
      writeDisposition: "definitely_not_written"
    });
    expect(iterated).toBe(false);
    expect(client.commands).toHaveLength(0);
  });

  it("classifies a malformed immutable checksum as definitely not written before provider I/O", async () => {
    const client = scriptedClient([]);

    await expect(
      createStorage(client).putObjectImmutable({
        storageKey: "tenant/invalid-checksum",
        body: new Uint8Array([1]),
        sizeBytes: 1,
        mediaType: "application/octet-stream",
        checksumSha256: "sha256:not-a-digest" as never
      })
    ).rejects.toMatchObject({
      code: "object_storage.invalid_argument",
      writeDisposition: "definitely_not_written",
      exactVersionEvidence: null
    });
    expect(client.commands).toHaveLength(0);
  });

  it("treats a conditional replay with the same SHA-256 as already existing", async () => {
    const body = Buffer.from("same bytes");
    const checksum = calculateHuleeSha256(body);
    const client = scriptedClient([
      awsError("PreconditionFailed", 412),
      {
        VersionId: "version-existing",
        ContentLength: body.byteLength,
        ContentType: "text/plain",
        ChecksumSHA256: huleeSha256ToS3Checksum(checksum),
        Metadata: { "hulee-sha256": checksum },
        ETag: '"different-semantic"'
      },
      { VersionId: "version-existing", TagSet: [] }
    ]);
    const storage = createStorage(client);

    await expect(
      storage.putObjectImmutable({
        storageKey: "tenant/replayed",
        body,
        sizeBytes: body.byteLength,
        mediaType: "text/plain",
        checksumSha256: checksum
      })
    ).resolves.toMatchObject({
      outcome: "already_exists",
      object: {
        versionId: "version-existing",
        checksumSha256: checksum
      },
      providerReceipt: {
        checksumVerifiedByProvider: true
      }
    });
    expect(client.commands[1]).toBeInstanceOf(HeadObjectCommand);
    expect(client.commands[2]).toBeInstanceOf(GetObjectTaggingCommand);
  });

  it("hashes an exact version before adopting a metadata-only conditional replay", async () => {
    const body = Buffer.from("same bytes");
    const checksum = calculateHuleeSha256(body);
    const client = scriptedClient([
      awsError("PreconditionFailed", 412),
      {
        VersionId: "version-existing",
        ContentLength: body.byteLength,
        ContentType: "text/plain",
        Metadata: { "hulee-sha256": checksum }
      },
      { VersionId: "version-existing", TagSet: [] },
      { VersionId: "version-existing", TagSet: [] },
      {
        VersionId: "version-existing",
        ContentLength: body.byteLength,
        ContentType: "text/plain",
        Metadata: { "hulee-sha256": checksum },
        Body: body
      }
    ]);
    const storage = createStorage(client);

    await expect(
      storage.putObjectImmutable({
        storageKey: "tenant/replayed-metadata-only",
        body,
        sizeBytes: body.byteLength,
        mediaType: "text/plain",
        checksumSha256: checksum
      })
    ).resolves.toMatchObject({
      outcome: "already_exists",
      object: { versionId: "version-existing", checksumSha256: checksum },
      providerReceipt: { checksumVerifiedByProvider: false }
    });
    expect(client.commands[3]).toBeInstanceOf(GetObjectTaggingCommand);
    const get = expectCommand(client.commands[4], GetObjectCommand);
    expect(get.input).toMatchObject({
      Key: "tenant/replayed-metadata-only",
      VersionId: "version-existing",
      ChecksumMode: "ENABLED"
    });
    expect(client.commands).toHaveLength(5);
  });

  it("quarantines and rejects corrupt bytes behind matching replay metadata", async () => {
    const body = Buffer.from("expected!!");
    const corruptBody = Buffer.from("corrupted!");
    const checksum = calculateHuleeSha256(body);
    const observedChecksum = calculateHuleeSha256(corruptBody);
    const evidenceSha256 = calculateHuleeSha256(
      Buffer.from(
        JSON.stringify({
          schemaId: "core:object-storage.exact-version-integrity-evidence",
          schemaVersion: "v1",
          reasonCode: "integrity.conditional_replay_mismatch",
          identity: {
            storageKey: "tenant/corrupt-replay",
            versionId: "version-corrupt"
          },
          checksumSha256: observedChecksum,
          sizeBytes: corruptBody.byteLength,
          mediaType: "text/plain"
        }),
        "utf8"
      )
    );
    const quarantineTags = [
      { Key: "hulee-state", Value: "quarantined" },
      {
        Key: "hulee-quarantine-reason",
        Value: "integrity.conditional_replay_mismatch"
      },
      {
        Key: "hulee-quarantine-evidence",
        Value: evidenceSha256.slice("sha256:".length)
      }
    ];
    const client = scriptedClient([
      awsError("PreconditionFailed", 412),
      {
        VersionId: "version-corrupt",
        ContentLength: body.byteLength,
        ContentType: "text/plain",
        Metadata: { "hulee-sha256": checksum }
      },
      { VersionId: "version-corrupt", TagSet: [] },
      { VersionId: "version-corrupt", TagSet: [] },
      {
        VersionId: "version-corrupt",
        ContentLength: corruptBody.byteLength,
        ContentType: "text/plain",
        Metadata: { "hulee-sha256": checksum },
        Body: corruptBody
      },
      { VersionId: "version-corrupt", TagSet: [] },
      { VersionId: "version-corrupt" },
      { VersionId: "version-corrupt", TagSet: quarantineTags }
    ]);
    const storage = createStorage(client);

    await expect(
      storage.putObjectImmutable({
        storageKey: "tenant/corrupt-replay",
        body,
        sizeBytes: body.byteLength,
        mediaType: "text/plain",
        checksumSha256: checksum
      })
    ).rejects.toMatchObject({
      code: "object_storage.immutable_conflict",
      writeDisposition: "exact_version_observed",
      exactVersionEvidence: {
        identity: {
          storageKey: "tenant/corrupt-replay",
          versionId: "version-corrupt"
        },
        checksumSha256: observedChecksum,
        sizeBytes: corruptBody.byteLength,
        mediaType: "text/plain"
      },
      quarantineEvidence: {
        reasonCode: "integrity.conditional_replay_mismatch",
        evidenceSha256,
        physicalKind: "s3_object_version_tags"
      }
    });
    const quarantine = expectCommand(
      client.commands[6],
      PutObjectTaggingCommand
    );
    expect(quarantine.input).toMatchObject({
      Key: "tenant/corrupt-replay",
      VersionId: "version-corrupt",
      Tagging: { TagSet: quarantineTags }
    });
    expect(client.commands).toHaveLength(8);
  });

  it("hashes actual bytes before quarantining a collision with different unauthenticated metadata", async () => {
    const requestedBody = Buffer.from("requested!");
    const actualBody = Buffer.from("actual-old");
    const requestedChecksum = calculateHuleeSha256(requestedBody);
    const metadataChecksum = calculateHuleeSha256(Buffer.from("metadata-only"));
    const actualChecksum = calculateHuleeSha256(actualBody);
    const evidenceSha256 = exactVersionIntegrityEvidence({
      reasonCode: "integrity.immutable_key_collision",
      storageKey: "tenant/untrusted-metadata-collision",
      versionId: "version-untrusted-metadata",
      checksumSha256: actualChecksum,
      sizeBytes: actualBody.byteLength,
      mediaType: "application/octet-stream"
    });
    const quarantineTags = quarantineTagSet({
      reasonCode: "integrity.immutable_key_collision",
      evidenceSha256
    });
    const client = scriptedClient([
      awsError("PreconditionFailed", 412),
      {
        VersionId: "version-untrusted-metadata",
        ContentLength: actualBody.byteLength,
        ContentType: "application/octet-stream",
        Metadata: { "hulee-sha256": metadataChecksum }
      },
      { VersionId: "version-untrusted-metadata", TagSet: [] },
      { VersionId: "version-untrusted-metadata", TagSet: [] },
      {
        VersionId: "version-untrusted-metadata",
        ContentLength: actualBody.byteLength,
        ContentType: "application/octet-stream",
        Metadata: { "hulee-sha256": metadataChecksum },
        Body: actualBody
      },
      { VersionId: "version-untrusted-metadata", TagSet: [] },
      { VersionId: "version-untrusted-metadata" },
      { VersionId: "version-untrusted-metadata", TagSet: quarantineTags }
    ]);

    await expect(
      createStorage(client).putObjectImmutable({
        storageKey: "tenant/untrusted-metadata-collision",
        body: requestedBody,
        sizeBytes: requestedBody.byteLength,
        mediaType: "application/octet-stream",
        checksumSha256: requestedChecksum
      })
    ).rejects.toMatchObject({
      code: "object_storage.immutable_conflict",
      exactVersionEvidence: {
        checksumSha256: actualChecksum,
        sizeBytes: actualBody.byteLength,
        mediaType: "application/octet-stream"
      },
      quarantineEvidence: {
        reasonCode: "integrity.immutable_key_collision",
        evidenceSha256,
        physicalKind: "s3_object_version_tags"
      }
    });
    expect(actualChecksum).not.toBe(metadataChecksum);
    expect(
      expectCommand(client.commands[6], PutObjectTaggingCommand).input
    ).toMatchObject({ Tagging: { TagSet: quarantineTags } });
  });

  it("does not read or quarantine unauthenticated existing bytes above the verification ceiling", async () => {
    const body = Buffer.from("new");
    const checksumSha256 = calculateHuleeSha256(body);
    const client = scriptedClient([
      awsError("PreconditionFailed", 412),
      {
        VersionId: "version-too-large",
        ContentLength: 9,
        ContentType: "application/octet-stream",
        Metadata: {
          "hulee-sha256": calculateHuleeSha256(Buffer.from("metadata"))
        }
      },
      { VersionId: "version-too-large", TagSet: [] }
    ]);

    await expect(
      createStorage(client, {
        maximumImmutableObjectBytes: 8
      }).putObjectImmutable({
        storageKey: "tenant/oversized-existing",
        body,
        sizeBytes: body.byteLength,
        mediaType: "application/octet-stream",
        checksumSha256
      })
    ).rejects.toMatchObject({
      code: "object_storage.read_bound_exceeded",
      writeDisposition: "unknown",
      exactVersionEvidence: null,
      quarantineEvidence: null
    });
    expect(client.commands).toHaveLength(3);
    expect(client.commands).not.toEqual(
      expect.arrayContaining([
        expect.any(GetObjectCommand),
        expect.any(PutObjectTaggingCommand)
      ])
    );
  });

  it("rejects a conditional key collision with different bytes", async () => {
    const body = Buffer.from("new");
    const checksum = calculateHuleeSha256(body);
    const observedChecksum = calculateHuleeSha256(Buffer.from("old"));
    const evidenceSha256 = exactVersionIntegrityEvidence({
      reasonCode: "integrity.immutable_key_collision",
      storageKey: "tenant/collision",
      versionId: "version-old",
      checksumSha256: observedChecksum,
      sizeBytes: body.byteLength,
      mediaType: "text/plain"
    });
    const quarantineTags = quarantineTagSet({
      reasonCode: "integrity.immutable_key_collision",
      evidenceSha256
    });
    const client = scriptedClient([
      awsError("PreconditionFailed", 412),
      {
        VersionId: "version-old",
        ContentLength: body.byteLength,
        ContentType: "text/plain",
        ChecksumSHA256: huleeSha256ToS3Checksum(observedChecksum),
        Metadata: {
          "hulee-sha256": observedChecksum
        }
      },
      { VersionId: "version-old", TagSet: [] },
      { VersionId: "version-old", TagSet: [] },
      { VersionId: "version-old" },
      { VersionId: "version-old", TagSet: quarantineTags }
    ]);

    await expect(
      createStorage(client).putObjectImmutable({
        storageKey: "tenant/collision",
        body,
        sizeBytes: body.byteLength,
        mediaType: "text/plain",
        checksumSha256: checksum
      })
    ).rejects.toMatchObject({
      code: "object_storage.immutable_conflict",
      writeDisposition: "exact_version_observed",
      exactVersionEvidence: {
        identity: {
          storageKey: "tenant/collision",
          versionId: "version-old"
        },
        checksumSha256: observedChecksum,
        sizeBytes: body.byteLength,
        mediaType: "text/plain"
      },
      quarantineEvidence: {
        reasonCode: "integrity.immutable_key_collision",
        evidenceSha256,
        physicalKind: "s3_object_version_tags"
      }
    });
    expect(
      expectCommand(client.commands[4], PutObjectTaggingCommand).input
    ).toMatchObject({ Tagging: { TagSet: quarantineTags } });
  });

  it("distinguishes definite write rejection from an unknown PUT outcome", async () => {
    const body = Buffer.from("write outcome");
    const checksum = calculateHuleeSha256(body);
    const rejected = createStorage(
      scriptedClient([awsError("AccessDenied", 403)])
    );
    const uncertain = createStorage(
      scriptedClient([awsError("InternalError", 500)])
    );

    await expect(
      rejected.putObjectImmutable({
        storageKey: "tenant/rejected",
        body,
        sizeBytes: body.byteLength,
        mediaType: "text/plain",
        checksumSha256: checksum
      })
    ).rejects.toMatchObject({
      code: "object_storage.write_rejected",
      writeDisposition: "definitely_not_written"
    });
    await expect(
      uncertain.putObjectImmutable({
        storageKey: "tenant/uncertain",
        body,
        sizeBytes: body.byteLength,
        mediaType: "text/plain",
        checksumSha256: checksum
      })
    ).rejects.toMatchObject({
      code: "object_storage.write_outcome_unknown",
      writeDisposition: "unknown"
    });
  });

  it("retains exact evidence when an acknowledged PUT reports a different checksum", async () => {
    const body = Buffer.from("acknowledged without identity");
    const checksum = calculateHuleeSha256(body);
    const missingVersion = createStorage(scriptedClient([{}]));
    const observedChecksum = calculateHuleeSha256(Buffer.from("different"));
    const evidenceSha256 = exactVersionIntegrityEvidence({
      reasonCode: "integrity.provider_checksum_mismatch",
      storageKey: "tenant/ack-uncertain",
      versionId: "version-mismatched-checksum",
      checksumSha256: observedChecksum,
      sizeBytes: body.byteLength,
      mediaType: "text/plain"
    });
    const quarantineTags = quarantineTagSet({
      reasonCode: "integrity.provider_checksum_mismatch",
      evidenceSha256
    });
    const mismatchedClient = scriptedClient([
      {
        VersionId: "version-mismatched-checksum",
        ChecksumSHA256: huleeSha256ToS3Checksum(observedChecksum)
      },
      { VersionId: "version-mismatched-checksum", TagSet: [] },
      { VersionId: "version-mismatched-checksum" },
      { VersionId: "version-mismatched-checksum", TagSet: quarantineTags }
    ]);
    const mismatchedChecksum = createStorage(mismatchedClient);

    await expect(
      missingVersion.putObjectImmutable({
        storageKey: "tenant/ack-uncertain",
        body,
        sizeBytes: body.byteLength,
        mediaType: "text/plain",
        checksumSha256: checksum
      })
    ).rejects.toMatchObject({
      code: "object_storage.write_outcome_unknown",
      writeDisposition: "unknown",
      exactVersionEvidence: null
    });
    await expect(
      mismatchedChecksum.putObjectImmutable({
        storageKey: "tenant/ack-uncertain",
        body,
        sizeBytes: body.byteLength,
        mediaType: "text/plain",
        checksumSha256: checksum
      })
    ).rejects.toMatchObject({
      code: "object_storage.integrity_mismatch",
      writeDisposition: "exact_version_observed",
      exactVersionEvidence: {
        identity: {
          storageKey: "tenant/ack-uncertain",
          versionId: "version-mismatched-checksum"
        },
        checksumSha256: observedChecksum,
        sizeBytes: body.byteLength,
        mediaType: "text/plain"
      },
      quarantineEvidence: {
        reasonCode: "integrity.provider_checksum_mismatch",
        evidenceSha256,
        physicalKind: "s3_object_version_tags"
      }
    });
    expect(
      expectCommand(mismatchedClient.commands[2], PutObjectTaggingCommand).input
    ).toMatchObject({ Tagging: { TagSet: quarantineTags } });
  });

  it("validates streamed writes while the S3 client consumes them", async () => {
    const expectedBody = Buffer.from("abcd");
    const checksum = calculateHuleeSha256(expectedBody);
    const client: S3ObjectStorageClient = {
      async send(command) {
        const put = expectCommand(command, PutObjectCommand);
        await collect(put.input.Body as AsyncIterable<Uint8Array>);
        return { VersionId: "version-stream" };
      }
    };
    const storage = createStorage(client);

    await expect(
      storage.putObjectImmutable({
        storageKey: "tenant/stream",
        body: chunks("ab", "c"),
        sizeBytes: expectedBody.byteLength,
        mediaType: "application/octet-stream",
        checksumSha256: checksum
      })
    ).rejects.toMatchObject({
      code: "object_storage.write_outcome_unknown",
      writeDisposition: "unknown"
    });
  });

  it("streams an exact version and enforces the requested byte range", async () => {
    const fullBody = Buffer.from("0123456789");
    const checksum = calculateHuleeSha256(fullBody);
    const client = scriptedClient([
      { VersionId: "v1", TagSet: [] },
      {
        VersionId: "v1",
        Body: chunks("23", "45"),
        ContentLength: 4,
        ContentRange: "bytes 2-5/10",
        ContentType: "application/octet-stream",
        Metadata: { "hulee-sha256": checksum },
        ETag: '"must-not-be-used-as-checksum"'
      }
    ]);
    const storage = createStorage(client);

    const output = await storage.getObjectVersion({
      identity: { storageKey: "tenant/range", versionId: "v1" },
      maximumBytes: 4,
      range: { start: 2, endInclusive: 5 }
    });

    expect(Buffer.from(await collect(output.body)).toString()).toBe("2345");
    expect(output).toMatchObject({
      checksumSha256: checksum,
      objectSizeBytes: 10,
      responseSizeBytes: 4,
      range: { start: 2, endInclusive: 5 }
    });
    const command = expectCommand(client.commands[1], GetObjectCommand);
    expect(command.input).toMatchObject({
      VersionId: "v1",
      Range: "bytes=2-5",
      ChecksumMode: "ENABLED"
    });
  });

  it("fails a stream that exceeds its caller-owned read bound", async () => {
    const client = scriptedClient([
      { VersionId: "v1", TagSet: [] },
      {
        VersionId: "v1",
        Body: chunks("abc", "def"),
        ContentType: "application/octet-stream"
      }
    ]);
    const output = await createStorage(client).getObjectVersion({
      identity: { storageKey: "tenant/bounded", versionId: "v1" },
      maximumBytes: 5
    });

    await expect(collect(output.body)).rejects.toMatchObject({
      code: "object_storage.read_bound_exceeded"
    });
  });

  it("fails when streamed bytes do not match the provider range receipt", async () => {
    const client = scriptedClient([
      { VersionId: "v1", TagSet: [] },
      {
        VersionId: "v1",
        Body: chunks("abc"),
        ContentLength: 4,
        ContentRange: "bytes 0-3/10"
      }
    ]);
    const output = await createStorage(client).getObjectVersion({
      identity: { storageKey: "tenant/short", versionId: "v1" },
      maximumBytes: 4,
      range: { start: 0, endInclusive: 3 }
    });

    await expect(collect(output.body)).rejects.toMatchObject({
      code: "object_storage.range_contract_violation"
    });
  });

  it("verifies a complete exact-version stream against provider SHA-256 evidence", async () => {
    const expectedChecksum = calculateHuleeSha256(Buffer.from("good"));
    const client = scriptedClient([
      { VersionId: "v1", TagSet: [] },
      {
        VersionId: "v1",
        Body: chunks("evil"),
        ContentLength: 4,
        Metadata: { "hulee-sha256": expectedChecksum }
      }
    ]);
    const output = await createStorage(client).getObjectVersion({
      identity: { storageKey: "tenant/checksum", versionId: "v1" },
      maximumBytes: 4
    });

    await expect(collect(output.body)).rejects.toMatchObject({
      code: "object_storage.integrity_mismatch"
    });
  });

  it("does not allocate transformToByteArray when ContentLength is unknown", async () => {
    const transformToByteArray = vi.fn(async () => Buffer.alloc(1_024));
    const client = scriptedClient([
      { VersionId: "v1", TagSet: [] },
      {
        VersionId: "v1",
        Body: { transformToByteArray }
      }
    ]);
    const output = await createStorage(client).getObjectVersion({
      identity: { storageKey: "tenant/unknown-length", versionId: "v1" },
      maximumBytes: 8
    });

    await expect(collect(output.body)).rejects.toMatchObject({
      code: "object_storage.provider_capability_missing"
    });
    expect(transformToByteArray).not.toHaveBeenCalled();
  });

  it("rejects a provider that does not confirm a requested range", async () => {
    const client = scriptedClient([
      { VersionId: "v1", TagSet: [] },
      {
        VersionId: "v1",
        Body: chunks("abc"),
        ContentLength: 3
      }
    ]);

    await expect(
      createStorage(client).getObjectVersion({
        identity: { storageKey: "tenant/range", versionId: "v1" },
        maximumBytes: 3,
        range: { start: 0, endInclusive: 2 }
      })
    ).rejects.toMatchObject({
      code: "object_storage.range_contract_violation"
    });
  });

  it("heads the exact physical version and never treats ETag as SHA-256", async () => {
    const client = scriptedClient([
      {
        VersionId: "v1",
        ContentLength: 12,
        ContentType: "image/png",
        LastModified: new Date("2026-07-18T11:00:00.000Z"),
        ETag: '"pretend-checksum"'
      },
      { VersionId: "v1", TagSet: [] }
    ]);

    await expect(
      createStorage(client).headObjectVersion({
        identity: { storageKey: "tenant/image", versionId: "v1" }
      })
    ).resolves.toMatchObject({
      outcome: "found",
      object: {
        versionId: "v1",
        checksumSha256: null,
        sizeBytes: 12
      }
    });
    const command = expectCommand(client.commands[0], HeadObjectCommand);
    expect(command.input).toMatchObject({
      Key: "tenant/image",
      VersionId: "v1",
      ChecksumMode: "ENABLED"
    });
  });

  it("returns a bounded opaque cursor and enumerates object versions plus delete markers", async () => {
    const client = scriptedClient([
      {
        IsTruncated: true,
        NextKeyMarker: "tenant/b",
        NextVersionIdMarker: "v-next",
        Versions: [
          {
            Key: "tenant/a",
            VersionId: "v1",
            IsLatest: true,
            Size: 20,
            LastModified: new Date("2026-07-18T10:00:00.000Z"),
            ChecksumAlgorithm: ["SHA256"]
          }
        ],
        DeleteMarkers: [
          {
            Key: "tenant/a",
            VersionId: "delete-1",
            IsLatest: false,
            LastModified: new Date("2026-07-18T09:00:00.000Z")
          }
        ]
      },
      { IsTruncated: false, Versions: [], DeleteMarkers: [] }
    ]);
    const storage = createStorage(client);

    const first = await storage.listObjectVersions({
      prefix: "tenant/",
      pageSize: 2
    });
    expect(first.items).toEqual([
      expect.objectContaining({
        kind: "object",
        identity: { storageKey: "tenant/a", versionId: "v1" },
        providerChecksumAlgorithms: ["SHA256"]
      }),
      expect.objectContaining({
        kind: "delete_marker",
        identity: { storageKey: "tenant/a", versionId: "delete-1" }
      })
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));

    await storage.listObjectVersions({
      prefix: "tenant/",
      pageSize: 2,
      cursor: first.nextCursor ?? undefined
    });
    const secondCommand = expectCommand(
      client.commands[1],
      ListObjectVersionsCommand
    );
    expect(secondCommand.input).toMatchObject({
      KeyMarker: "tenant/b",
      VersionIdMarker: "v-next",
      MaxKeys: 2
    });

    await expect(
      storage.listObjectVersions({
        prefix: "another/",
        cursor: first.nextCursor ?? undefined
      })
    ).rejects.toMatchObject({ code: "object_storage.invalid_argument" });
    expect(client.commands).toHaveLength(2);
  });

  it("deletes only the requested version and treats provider not-found idempotently", async () => {
    const client = scriptedClient([
      { VersionId: "v1", DeleteMarker: false },
      { VersionId: "delete-1", DeleteMarker: true },
      awsError("NoSuchVersion", 404)
    ]);
    const storage = createStorage(client);
    const identity = { storageKey: "tenant/file", versionId: "v1" };
    const deleteMarkerIdentity = {
      storageKey: "tenant/file",
      versionId: "delete-1"
    };

    await expect(
      storage.deleteObjectVersion({ identity })
    ).resolves.toMatchObject({ outcome: "deleted", identity });
    await expect(
      storage.deleteObjectVersion({ identity: deleteMarkerIdentity })
    ).resolves.toMatchObject({
      outcome: "deleted",
      identity: deleteMarkerIdentity,
      providerDeleteMarker: true
    });
    await expect(
      storage.deleteObjectVersion({ identity: deleteMarkerIdentity })
    ).resolves.toMatchObject({
      outcome: "not_found",
      identity: deleteMarkerIdentity
    });
    expect(
      expectCommand(client.commands[0], DeleteObjectCommand).input
    ).toMatchObject({
      Key: identity.storageKey,
      VersionId: identity.versionId
    });
    for (const entry of client.commands.slice(1)) {
      expect(expectCommand(entry, DeleteObjectCommand).input).toMatchObject({
        Key: deleteMarkerIdentity.storageKey,
        VersionId: deleteMarkerIdentity.versionId
      });
    }
  });

  it("records and verifies physical quarantine evidence, then denies reads", async () => {
    const evidenceSha256 = calculateHuleeSha256(Buffer.from("evidence"));
    const quarantineTags = [
      { Key: "retained", Value: "value" },
      { Key: "hulee-state", Value: "quarantined" },
      { Key: "hulee-quarantine-reason", Value: "malware.detected" },
      {
        Key: "hulee-quarantine-evidence",
        Value: evidenceSha256.slice("sha256:".length)
      }
    ];
    const client = scriptedClient([
      { VersionId: "v1", TagSet: [{ Key: "retained", Value: "value" }] },
      {},
      { VersionId: "v1", TagSet: quarantineTags },
      { VersionId: "v1", TagSet: quarantineTags },
      { VersionId: "v1", TagSet: quarantineTags },
      { VersionId: "v1", TagSet: quarantineTags }
    ]);
    const storage = createStorage(client);
    const identity = { storageKey: "tenant/file", versionId: "v1" };

    await expect(
      storage.quarantineObjectVersion({
        identity,
        reasonCode: "malware.detected",
        evidenceSha256
      })
    ).resolves.toMatchObject({
      outcome: "quarantined",
      identity,
      evidence: {
        reasonCode: "malware.detected",
        evidenceSha256,
        physicalKind: "s3_object_version_tags"
      }
    });
    const command = expectCommand(client.commands[1], PutObjectTaggingCommand);
    expect(command.input).toMatchObject({
      Key: identity.storageKey,
      VersionId: identity.versionId,
      Tagging: { TagSet: quarantineTags }
    });

    await expect(
      storage.quarantineObjectVersion({
        identity,
        reasonCode: "malware.detected",
        evidenceSha256
      })
    ).resolves.toMatchObject({
      outcome: "already_quarantined",
      evidence: { reasonCode: "malware.detected", evidenceSha256 }
    });
    await expect(
      storage.quarantineObjectVersion({
        identity,
        reasonCode: "policy.blocked",
        evidenceSha256: calculateHuleeSha256(Buffer.from("other-evidence"))
      })
    ).rejects.toMatchObject({ code: "object_storage.immutable_conflict" });

    await expect(
      storage.getObjectVersion({ identity, maximumBytes: 100 })
    ).rejects.toMatchObject({ code: "object_storage.quarantined" });
    expect(client.commands).toHaveLength(6);
    expect(client.commands[5]).toBeInstanceOf(GetObjectTaggingCommand);
  });

  it("actively verifies and reversibly cleans up every required version-aware capability", async () => {
    const body = Buffer.from("hulee-object-storage-capability-probe-v1");
    const checksumSha256 = calculateHuleeSha256(body);
    const evidenceSha256 = calculateHuleeSha256(
      Buffer.from(`quarantine:${checksumSha256}`)
    );
    const storageKey = `__probe__/object-${probeToken}`;
    const quarantineTags = [
      { Key: "hulee-state", Value: "quarantined" },
      { Key: "hulee-quarantine-reason", Value: "capability.probe" },
      {
        Key: "hulee-quarantine-evidence",
        Value: evidenceSha256.slice("sha256:".length)
      }
    ];
    const client = scriptedClient([
      { Status: "Enabled" },
      { IsTruncated: false, Versions: [], DeleteMarkers: [] },
      {
        VersionId: "probe-v1",
        ChecksumSHA256: huleeSha256ToS3Checksum(checksumSha256)
      },
      {
        VersionId: "probe-v1",
        ContentLength: body.byteLength,
        ContentType: "application/octet-stream",
        Metadata: { "hulee-sha256": checksumSha256 }
      },
      { VersionId: "probe-v1", TagSet: [] },
      { VersionId: "probe-v1", TagSet: [] },
      {
        VersionId: "probe-v1",
        ContentLength: body.byteLength,
        ContentType: "application/octet-stream",
        ChecksumSHA256: huleeSha256ToS3Checksum(checksumSha256),
        Metadata: { "hulee-sha256": checksumSha256 },
        Body: body
      },
      {
        IsTruncated: false,
        Versions: [
          {
            Key: storageKey,
            VersionId: "probe-v1",
            Size: body.byteLength,
            ChecksumAlgorithm: ["SHA256"]
          }
        ],
        DeleteMarkers: []
      },
      awsError("PreconditionFailed", 412),
      {
        VersionId: "probe-v1",
        ContentLength: body.byteLength,
        ContentType: "application/octet-stream",
        Metadata: { "hulee-sha256": checksumSha256 }
      },
      { VersionId: "probe-v1", TagSet: [] },
      { VersionId: "probe-v1", TagSet: [] },
      {
        VersionId: "probe-v1",
        ContentLength: body.byteLength,
        ContentType: "application/octet-stream",
        Metadata: { "hulee-sha256": checksumSha256 },
        Body: body
      },
      { VersionId: "probe-v1", TagSet: [] },
      { VersionId: "probe-v1" },
      { VersionId: "probe-v1", TagSet: quarantineTags },
      { VersionId: "probe-v1", TagSet: quarantineTags },
      { VersionId: "probe-v1", DeleteMarker: false },
      awsError("NoSuchKey", 404)
    ]);
    const storage = createStorage(client);

    await expect(
      storage.probeCapabilities({ prefix: "__probe__/" })
    ).resolves.toMatchObject({
      provider: "s3",
      bucketVersioning: "enabled",
      versionEnumeration: "supported",
      observedVersionCount: 1,
      observedDeleteMarkerCount: 0,
      readyForVersionAwareWrites: true,
      failure: null,
      checks: {
        bucketVersioning: { state: "passed" },
        versionEnumerationApi: { state: "passed" },
        immutableWrite: { state: "passed" },
        exactVersionHead: { state: "passed" },
        streamingReadChecksum: { state: "passed" },
        exactVersionEnumeration: { state: "passed" },
        immutableConditionalPut: { state: "passed" },
        physicalQuarantineEvidence: { state: "passed" },
        exactVersionDelete: { state: "passed" },
        cleanup: { state: "passed" }
      },
      capabilities: {
        providerEntityTagIsChecksum: false,
        originalFileNameInObjectMetadata: false
      }
    });
    expect(client.commands[0]).toBeInstanceOf(GetBucketVersioningCommand);
    const list = expectCommand(client.commands[1], ListObjectVersionsCommand);
    expect(list.input).toMatchObject({ Prefix: "__probe__/", MaxKeys: 1 });
    const put = expectCommand(client.commands[2], PutObjectCommand);
    expect(put.input).toMatchObject({
      Key: storageKey,
      IfNoneMatch: "*",
      ChecksumSHA256: huleeSha256ToS3Checksum(checksumSha256)
    });
    const conflictingPut = expectCommand(client.commands[8], PutObjectCommand);
    expect(conflictingPut.input).toMatchObject({
      Key: storageKey,
      IfNoneMatch: "*"
    });
    const quarantine = expectCommand(
      client.commands[14],
      PutObjectTaggingCommand
    );
    expect(quarantine.input).toMatchObject({
      Key: storageKey,
      VersionId: "probe-v1",
      Tagging: { TagSet: quarantineTags }
    });
    const deletion = expectCommand(client.commands[17], DeleteObjectCommand);
    expect(deletion.input).toMatchObject({
      Key: storageKey,
      VersionId: "probe-v1"
    });
    expect(client.commands[16]).toBeInstanceOf(GetObjectTaggingCommand);
    expect(client.commands).toHaveLength(19);
  });

  it("does not report ready when versioning and listing pass but the conditional write fails", async () => {
    const client = scriptedClient([
      { Status: "Enabled" },
      { IsTruncated: false, Versions: [], DeleteMarkers: [] },
      awsError("AccessDenied", 403)
    ]);
    const storage = createStorage(client);

    await expect(
      storage.probeCapabilities({ prefix: "__probe__/" })
    ).resolves.toMatchObject({
      bucketVersioning: "enabled",
      versionEnumeration: "supported",
      readyForVersionAwareWrites: false,
      failure: {
        check: "immutableWrite",
        errorCode: "object_storage.write_rejected"
      },
      checks: {
        bucketVersioning: { state: "passed" },
        versionEnumerationApi: { state: "passed" },
        immutableWrite: {
          state: "failed",
          errorCode: "object_storage.write_rejected"
        },
        exactVersionHead: { state: "skipped" },
        cleanup: { state: "passed" }
      }
    });
    const put = expectCommand(client.commands[2], PutObjectCommand);
    expect(put.input).toMatchObject({ IfNoneMatch: "*" });
    expect(client.commands).toHaveLength(3);
  });

  it("deletes an exact probe version when a downstream capability check fails", async () => {
    const body = Buffer.from("hulee-object-storage-capability-probe-v1");
    const checksumSha256 = calculateHuleeSha256(body);
    const storageKey = `__probe__/object-${probeToken}`;
    const client = scriptedClient([
      { Status: "Enabled" },
      { IsTruncated: false, Versions: [], DeleteMarkers: [] },
      {
        VersionId: "probe-v1",
        ChecksumSHA256: huleeSha256ToS3Checksum(checksumSha256)
      },
      awsError("InternalError", 500),
      { VersionId: "probe-v1", DeleteMarker: false },
      awsError("NoSuchKey", 404)
    ]);
    const storage = createStorage(client);

    await expect(
      storage.probeCapabilities({ prefix: "__probe__/" })
    ).resolves.toMatchObject({
      readyForVersionAwareWrites: false,
      failure: {
        check: "exactVersionHead",
        errorCode: "object_storage.provider_failure"
      },
      checks: {
        immutableWrite: { state: "passed" },
        exactVersionHead: { state: "failed" },
        cleanup: { state: "passed" }
      }
    });
    const deletion = expectCommand(client.commands[4], DeleteObjectCommand);
    expect(deletion.input).toMatchObject({
      Key: storageKey,
      VersionId: "probe-v1"
    });
    expect(client.commands[5]).toBeInstanceOf(HeadObjectCommand);
    expect(client.commands).toHaveLength(6);
  });

  it("exposes a runtime guard without breaking legacy dependency-injected fakes", () => {
    const legacy: ObjectStorage = {
      putObject: vi.fn(async () => undefined),
      getObject: vi.fn(async () => ({ body: new Uint8Array() }))
    };
    expect(isVersionAwareObjectStorage(legacy)).toBe(false);
    expect(() => requireVersionAwareObjectStorage(legacy)).toThrowError(
      expect.objectContaining({
        code: "object_storage.provider_capability_missing"
      })
    );

    const versionAware = createStorage(scriptedClient([]));
    expect(isVersionAwareObjectStorage(versionAware)).toBe(true);
    expect(requireVersionAwareObjectStorage(versionAware)).toBe(versionAware);
  });
});

describe("Hulee SHA-256 conversion", () => {
  it("round-trips canonical Hulee hex and S3 base64", () => {
    const checksum = calculateHuleeSha256(Buffer.from("checksum"));
    expect(s3ChecksumToHuleeSha256(huleeSha256ToS3Checksum(checksum))).toBe(
      checksum
    );
    expect(parseHuleeSha256(checksum)).toBe(checksum);
  });

  it("rejects non-canonical values instead of accepting ETag-like strings", () => {
    expect(() => parseHuleeSha256('"etag"')).toThrow();
    expect(() => parseHuleeSha256(`sha256:${"A".repeat(64)}`)).toThrow();
    expect(() => s3ChecksumToHuleeSha256("not-base64")).toThrow();
  });
});

function createStorage(
  client: S3ObjectStorageClient,
  options: Readonly<{ maximumImmutableObjectBytes?: number }> = {}
) {
  return createS3ObjectStorage(config, {
    client,
    now: () => fixedNow,
    probeToken: () => probeToken,
    ...options
  });
}

function scriptedClient(
  script: Array<unknown | Error>
): S3ObjectStorageClient & { commands: unknown[] } {
  const commands: unknown[] = [];
  return {
    commands,
    async send(command) {
      commands.push(command);
      if (script.length === 0) {
        throw new Error("Unexpected S3 command.");
      }
      const next = script.shift();
      if (next instanceof Error) {
        throw next;
      }
      return next;
    }
  };
}

function awsError(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode }
  });
}

function exactVersionIntegrityEvidence(input: {
  reasonCode: string;
  storageKey: string;
  versionId: string;
  checksumSha256: ReturnType<typeof calculateHuleeSha256>;
  sizeBytes: number;
  mediaType: string;
}) {
  return calculateHuleeSha256(
    Buffer.from(
      JSON.stringify({
        schemaId: "core:object-storage.exact-version-integrity-evidence",
        schemaVersion: "v1",
        reasonCode: input.reasonCode,
        identity: {
          storageKey: input.storageKey,
          versionId: input.versionId
        },
        checksumSha256: input.checksumSha256,
        sizeBytes: input.sizeBytes,
        mediaType: input.mediaType
      }),
      "utf8"
    )
  );
}

function quarantineTagSet(input: {
  reasonCode: string;
  evidenceSha256: ReturnType<typeof calculateHuleeSha256>;
}) {
  return [
    { Key: "hulee-state", Value: "quarantined" },
    { Key: "hulee-quarantine-reason", Value: input.reasonCode },
    {
      Key: "hulee-quarantine-evidence",
      Value: input.evidenceSha256.slice("sha256:".length)
    }
  ];
}

async function* chunks(...values: string[]): AsyncGenerator<Uint8Array> {
  for (const value of values) {
    yield Buffer.from(value);
  }
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function expectCommand<T extends abstract new (...args: never[]) => object>(
  value: unknown,
  constructor: T
): InstanceType<T> {
  expect(value).toBeInstanceOf(constructor);
  return value as InstanceType<T>;
}
