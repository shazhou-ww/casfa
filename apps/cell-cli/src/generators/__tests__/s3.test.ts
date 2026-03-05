import { describe, expect, test } from "bun:test";
import type { ResolvedConfig } from "../../config/resolve-config.js";
import { generateS3 } from "../s3.js";

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    name: "test-app",
    envVars: {},
    secretRefs: {},
    tables: [],
    buckets: [],
    frontendBucketName: "test-app-frontend",
    ...overrides,
  };
}

describe("generateS3", () => {
  test("blob bucket without DeletionPolicy (rollback/delete removes it)", () => {
    const config = makeConfig({
      buckets: [{ key: "blob", bucketName: "test-app-blob" }],
    });
    const result = generateS3(config);
    const bucket = result.Resources.BlobBucket as any;
    expect(bucket.Type).toBe("AWS::S3::Bucket");
    expect(bucket.DeletionPolicy).toBeUndefined();
    expect(bucket.Properties.BucketName).toBe("test-app-blob");
  });

  test("frontend bucket without Retain, with PublicAccessBlock", () => {
    const config = makeConfig();
    const result = generateS3(config);
    const frontend = result.Resources.FrontendBucket as any;
    expect(frontend.Type).toBe("AWS::S3::Bucket");
    expect(frontend.DeletionPolicy).toBeUndefined();
    expect(frontend.Properties.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
  });

  test("empty buckets → only frontend bucket generated", () => {
    const config = makeConfig();
    const result = generateS3(config);
    const resourceKeys = Object.keys(result.Resources);
    expect(resourceKeys).toEqual(["FrontendBucket"]);
  });
});
