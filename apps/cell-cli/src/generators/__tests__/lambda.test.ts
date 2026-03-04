import { describe, expect, test } from "bun:test";
import type { ResolvedConfig } from "../../config/resolve-config.js";
import { generateLambda } from "../lambda.js";

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

const defaultBackend = {
  runtime: "nodejs20.x",
  entries: {
    api: {
      handler: "src/lambda.ts",
      timeout: 30,
      memory: 1024,
      routes: ["*"],
    },
  },
};

describe("generateLambda", () => {
  test("lambda function with correct runtime, timeout, memory", () => {
    const config = makeConfig({ backend: defaultBackend });
    const result = generateLambda(config);
    const fn = result.Resources.ApiFunction as any;
    expect(fn.Type).toBe("AWS::Lambda::Function");
    expect(fn.Properties.Runtime).toBe("nodejs20.x");
    expect(fn.Properties.Timeout).toBe(30);
    expect(fn.Properties.MemorySize).toBe(1024);
    expect(fn.Properties.Handler).toBe("index.handler");
  });

  test("environment variables include all params", () => {
    const config = makeConfig({
      envVars: { APP_MODE: "production", DB_NAME: "mydb" },
      backend: defaultBackend,
    });
    const result = generateLambda(config);
    const fn = result.Resources.ApiFunction as any;
    expect(fn.Properties.Environment.Variables.APP_MODE).toBe("production");
    expect(fn.Properties.Environment.Variables.DB_NAME).toBe("mydb");
  });

  test("secret params use {{resolve:secretsmanager:...}} syntax", () => {
    const config = makeConfig({
      envVars: { DB_PASSWORD: "local-value" },
      secretRefs: { DB_PASSWORD: "DB_PASSWORD" },
      backend: defaultBackend,
    });
    const result = generateLambda(config);
    const fn = result.Resources.ApiFunction as any;
    expect(fn.Properties.Environment.Variables.DB_PASSWORD).toBe(
      "{{resolve:secretsmanager:test-app/DB_PASSWORD}}",
    );
  });

  test("IAM role has DynamoDB permissions when tables exist", () => {
    const config = makeConfig({
      tables: [
        {
          key: "users",
          tableName: "test-app-users",
          config: { keys: { pk: "S" } },
        },
      ],
      backend: defaultBackend,
    });
    const result = generateLambda(config);
    const role = result.Resources.LambdaExecutionRole as any;
    const statements = role.Properties.Policies[0].PolicyDocument.Statement;
    const dynamoStatement = statements.find(
      (s: any) => Array.isArray(s.Action) && s.Action.includes("dynamodb:GetItem"),
    );
    expect(dynamoStatement).toBeDefined();
  });

  test("IAM role has S3 permissions when buckets exist", () => {
    const config = makeConfig({
      buckets: [{ key: "blob", bucketName: "test-app-blob" }],
      backend: defaultBackend,
    });
    const result = generateLambda(config);
    const role = result.Resources.LambdaExecutionRole as any;
    const statements = role.Properties.Policies[0].PolicyDocument.Statement;
    const s3Statement = statements.find(
      (s: any) =>
        Array.isArray(s.Action) && s.Action.includes("s3:GetObject"),
    );
    expect(s3Statement).toBeDefined();
  });

  test("no DynamoDB policy when tables empty", () => {
    const config = makeConfig({ backend: defaultBackend });
    const result = generateLambda(config);
    const role = result.Resources.LambdaExecutionRole as any;
    const statements = role.Properties.Policies[0].PolicyDocument.Statement;
    const dynamoStatement = statements.find(
      (s: any) => Array.isArray(s.Action) && s.Action.includes("dynamodb:GetItem"),
    );
    expect(dynamoStatement).toBeUndefined();
  });
});
