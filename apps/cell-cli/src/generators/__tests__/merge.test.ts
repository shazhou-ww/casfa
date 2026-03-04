import { describe, expect, test } from "bun:test";
import type { ResolvedConfig } from "../../config/resolve-config.js";
import { generateTemplate } from "../merge.js";

describe("generateTemplate", () => {
  test("full template snapshot", () => {
    const config: ResolvedConfig = {
      name: "casfa-next",
      envVars: {
        DYNAMODB_TABLE_DELEGATES: "casfa-next-delegates",
        DYNAMODB_TABLE_GRANTS: "casfa-next-grants",
        S3_BUCKET_BLOB: "casfa-next-blob",
        FRONTEND_BUCKET: "casfa-next-frontend",
        COGNITO_REGION: "us-east-1",
        COGNITO_CLIENT_SECRET: "local-secret",
      },
      secretRefs: {
        COGNITO_CLIENT_SECRET: "COGNITO_CLIENT_SECRET",
      },
      tables: [
        {
          key: "delegates",
          tableName: "casfa-next-delegates",
          config: {
            keys: { pk: "S", sk: "S" },
            gsi: {
              "realm-index": {
                keys: { gsi1pk: "S", gsi1sk: "S" },
                projection: "ALL",
              },
            },
          },
        },
        {
          key: "grants",
          tableName: "casfa-next-grants",
          config: {
            keys: { pk: "S", sk: "S" },
            gsi: {
              "realm-hash-index": {
                keys: { gsi1pk: "S", gsi1sk: "S" },
                projection: "ALL",
              },
              "realm-refresh-index": {
                keys: { gsi2pk: "S", gsi2sk: "S" },
                projection: "ALL",
              },
            },
          },
        },
      ],
      buckets: [{ key: "blob", bucketName: "casfa-next-blob" }],
      frontendBucketName: "casfa-next-frontend",
      backend: {
        runtime: "nodejs20.x",
        entries: {
          api: {
            handler: "backend/lambda.ts",
            timeout: 30,
            memory: 1024,
            routes: ["*"],
          },
        },
      },
      domain: {
        zone: "shazhou.me",
        host: "beta.casfa.shazhou.me",
        certificate: "arn:aws:acm:us-east-1:123456789012:certificate/abc-def",
      },
    };

    const result = generateTemplate(config);
    expect(result).toMatchSnapshot();
  });
});
