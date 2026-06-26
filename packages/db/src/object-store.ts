import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStoreClient } from './index.js';

export interface ObjectStoreConfig {
  readonly bucket: string;
  /** S3-compatible endpoint (e.g. MinIO at http://localhost:9000). Omit for real AWS S3. */
  readonly endpoint?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly region?: string;
}

/**
 * Real `ObjectStoreClient` backed by `@aws-sdk/client-s3`, pointed at
 * MinIO locally (via `endpoint` + `forcePathStyle`) and at real S3/GCS
 * (S3-compatible mode) in staging/production by omitting `endpoint`.
 */
export function createObjectStoreClient(config: ObjectStoreConfig): ObjectStoreClient {
  const s3 = new S3Client({
    region: config.region ?? 'us-east-1',
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint), // required for MinIO; harmless for AWS
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
  });

  return {
    async getObject(key: string) {
      const result = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      const body = await result.Body?.transformToByteArray();
      return {
        body: body ?? new Uint8Array(),
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    },

    async putObject(key: string, body: Uint8Array | Buffer, contentType: string) {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async deleteObject(key: string) {
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },

    async presignGetUrl(key: string, expiresInSeconds: number) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },

    async presignPutUrl(key: string, expiresInSeconds: number, contentType: string) {
      return getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType }),
        { expiresIn: expiresInSeconds },
      );
    },
  };
}
