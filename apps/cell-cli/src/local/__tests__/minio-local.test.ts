import { describe, expect, test, mock } from "bun:test";
import { ensureLocalBuckets } from "../minio-local.js";

describe("ensureLocalBuckets", () => {
  test("function exists and is properly typed", () => {
    expect(typeof ensureLocalBuckets).toBe("function");
    // Verify the signature accepts (string, string[])
    const fn: (endpoint: string, bucketNames: string[]) => Promise<void> =
      ensureLocalBuckets;
    expect(fn).toBeDefined();
  });

  test("calls CreateBucketCommand for each bucket name", async () => {
    const sendCalls: string[] = [];

    const { S3Client, CreateBucketCommand } = await import("@aws-sdk/client-s3");

    const originalSend = S3Client.prototype.send;
    S3Client.prototype.send = mock(async function (this: any, cmd: any) {
      if (cmd.constructor.name === "CreateBucketCommand") {
        sendCalls.push(cmd.input.Bucket);
      }
      return {};
    }) as any;

    try {
      await ensureLocalBuckets("http://localhost:9000", [
        "bucket-a",
        "bucket-b",
        "bucket-c",
      ]);
      expect(sendCalls).toContain("bucket-a");
      expect(sendCalls).toContain("bucket-b");
      expect(sendCalls).toContain("bucket-c");
      expect(sendCalls).toHaveLength(3);
    } finally {
      S3Client.prototype.send = originalSend;
    }
  });
});
