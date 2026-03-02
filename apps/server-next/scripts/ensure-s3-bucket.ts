#!/usr/bin/env bun
/**
 * Ensure an S3-compatible bucket exists (e.g. MinIO at localhost:7104).
 * Optionally clear bucket contents (for local-test).
 */
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const DEFAULT_ENDPOINT = "http://localhost:7104";
const DEFAULT_CREDENTIALS = { accessKeyId: "S3RVER", secretAccessKey: "S3RVER00" };

export async function ensureS3Bucket(
  endpoint: string = DEFAULT_ENDPOINT,
  bucket: string
): Promise<void> {
  const client = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: DEFAULT_CREDENTIALS,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (e: unknown) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      return;
    }
    throw e;
  }
}

/** Delete all objects in the bucket (for local-test clean run). */
export async function clearS3Bucket(
  endpoint: string = DEFAULT_ENDPOINT,
  bucket: string
): Promise<void> {
  const client = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: DEFAULT_CREDENTIALS,
  });
  let continuationToken: string | undefined;
  do {
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken })
    );
    const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
    }
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);
}
