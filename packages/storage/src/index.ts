import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

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

export type GetObjectInput = {
  storageKey: string;
};

export type GetObjectOutput = {
  body: Uint8Array;
  mediaType?: string;
  sizeBytes?: number;
};

export type ObjectStorage = {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(input: GetObjectInput): Promise<GetObjectOutput>;
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
    },

    async getObject(input) {
      const output = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: input.storageKey
        })
      );

      return {
        body: await s3BodyToUint8Array(output.Body),
        mediaType: output.ContentType,
        sizeBytes: output.ContentLength
      };
    }
  };
}

async function s3BodyToUint8Array(body: unknown): Promise<Uint8Array> {
  if (body === undefined || body === null) {
    return new Uint8Array();
  }

  if (body instanceof Uint8Array) {
    return body;
  }

  if (
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    return body.transformToByteArray() as Promise<Uint8Array>;
  }

  if (isAsyncIterable(body)) {
    const chunks: Uint8Array[] = [];

    for await (const chunk of body) {
      chunks.push(toUint8ArrayChunk(chunk));
    }

    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported S3 object body.");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
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

  throw new Error("Unsupported S3 object body chunk.");
}
