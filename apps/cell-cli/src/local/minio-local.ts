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

export async function ensureLocalBuckets(endpoint: string, bucketNames: string[]): Promise<void> {
  const client = makeClient(endpoint);
  try {
    for (const bucket of bucketNames) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err: any) {
        if (err.name === "BucketAlreadyOwnedByYou" || err.name === "BucketAlreadyExists") {
          continue;
        }
        throw err;
      }
    }
  } finally {
    client.destroy();
  }
}
