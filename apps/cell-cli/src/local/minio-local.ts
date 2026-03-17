import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

function makeClient(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: "local",
    forcePathStyle: true,
    credentials: {
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
    },
  });
}

function isTransientMinioError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("socket connection was closed unexpectedly") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("socket hang up")
  );
}

async function createBucketWithRetry(client: S3Client, bucket: string): Promise<void> {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      return;
    } catch (err: any) {
      if (err?.name === "BucketAlreadyOwnedByYou" || err?.name === "BucketAlreadyExists") {
        return;
      }
      const retryable = isTransientMinioError(err);
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      await Bun.sleep(300 * attempt);
    }
  }
}

export async function ensureLocalBuckets(endpoint: string, bucketNames: string[]): Promise<void> {
  const client = makeClient(endpoint);
  try {
    for (const bucket of bucketNames) {
      await createBucketWithRetry(client, bucket);
    }
  } finally {
    client.destroy();
  }
}
