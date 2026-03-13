import { CreateBucketCommand, ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";

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

export async function ensureLocalBuckets(endpoint: string, bucketNames: string[]): Promise<void> {
  const client = makeClient(endpoint);
  try {
    for (const bucket of bucketNames) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e.name === "BucketAlreadyOwnedByYou" || e.name === "BucketAlreadyExists") {
          continue;
        }
        throw err;
      }
    }
  } finally {
    client.destroy();
  }
}

export async function isMinIOReady(endpoint: string): Promise<boolean> {
  const client = makeClient(endpoint);
  try {
    await client.send(new ListBucketsCommand({}));
    return true;
  } catch {
    return false;
  } finally {
    client.destroy();
  }
}
