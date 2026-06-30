import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export type PutObjectInput = {
  storageKey: string;
  body: Uint8Array;
  mediaType: string;
  fileName?: string;
};

export type ObjectStorage = {
  putObject(input: PutObjectInput): Promise<void>;
};

export function createS3ObjectStorage(
  config: ObjectStorageConfig
): ObjectStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  return {
    async putObject(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.storageKey,
          Body: input.body,
          ContentType: input.mediaType,
          Metadata: input.fileName
            ? {
                originalFileName: input.fileName
              }
            : undefined
        })
      );
    }
  };
}
