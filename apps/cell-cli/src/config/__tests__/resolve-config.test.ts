import { describe, expect, test } from "bun:test";
import type { CellConfig } from "../cell-yaml-schema.js";
import { resolveConfig } from "../resolve-config.js";

function makeConfig(overrides: Partial<CellConfig> = {}): CellConfig {
  return { name: "my-app", ...overrides };
}

describe("resolveConfig", () => {
  test("cloud: string params become env vars", () => {
    const config = makeConfig({
      params: { API_URL: "https://api.example.com", MODE: "production" },
    });
    const resolved = resolveConfig(config, {}, "cloud");
    expect(resolved.envVars.API_URL).toBe("https://api.example.com");
    expect(resolved.envVars.MODE).toBe("production");
  });

  test("cloud: secrets resolved from env map", () => {
    const config = makeConfig({
      params: { DB_PASSWORD: { secret: "DB_PASSWORD" } },
    });
    const resolved = resolveConfig(config, { DB_PASSWORD: "s3cret" }, "cloud");
    expect(resolved.envVars.DB_PASSWORD).toBe("s3cret");
  });

  test("cloud: missing secret throws error", () => {
    const config = makeConfig({
      params: { DB_PASSWORD: { secret: "DB_PASSWORD" } },
    });
    expect(() => resolveConfig(config, {}, "cloud")).toThrow(/[Mm]issing secret.*DB_PASSWORD/);
  });

  test("dev: missing secret warns but continues", () => {
    const config = makeConfig({
      params: { DB_PASSWORD: { secret: "DB_PASSWORD" } },
    });
    const resolved = resolveConfig(config, {}, "dev");
    expect(resolved.envVars.DB_PASSWORD).toBeUndefined();
  });

  test("dev: table names include stage prefix", () => {
    const config = makeConfig({
      tables: { users: { keys: { pk: "S" } } },
    });
    const resolved = resolveConfig(config, {}, "dev");
    expect(resolved.tables[0].tableName).toBe("my-app-dev-users");
  });

  test("cloud: table names don't include stage prefix", () => {
    const config = makeConfig({
      tables: { users: { keys: { pk: "S" } } },
    });
    const resolved = resolveConfig(config, {}, "cloud");
    expect(resolved.tables[0].tableName).toBe("my-app-users");
  });

  test("auto-generated DYNAMODB_TABLE_* env vars", () => {
    const config = makeConfig({
      tables: {
        users: { keys: { pk: "S" } },
        orders: { keys: { pk: "S", sk: "S" } },
      },
    });
    const resolved = resolveConfig(config, {}, "cloud");
    expect(resolved.envVars.DYNAMODB_TABLE_USERS).toBe("my-app-users");
    expect(resolved.envVars.DYNAMODB_TABLE_ORDERS).toBe("my-app-orders");
  });

  test("auto-generated S3_BUCKET_* env vars", () => {
    const config = makeConfig({
      buckets: { uploads: {}, media: {} },
    });
    const resolved = resolveConfig(config, {}, "cloud");
    expect(resolved.envVars.S3_BUCKET_UPLOADS).toBe("my-app-uploads");
    expect(resolved.envVars.S3_BUCKET_MEDIA).toBe("my-app-media");
  });

  test("dev: DYNAMODB_ENDPOINT and S3_ENDPOINT with default PORT_BASE", () => {
    const resolved = resolveConfig(makeConfig(), {}, "dev");
    expect(resolved.envVars.DYNAMODB_ENDPOINT).toBe("http://localhost:7102");
    expect(resolved.envVars.S3_ENDPOINT).toBe("http://localhost:7104");
  });

  test("test: DYNAMODB_ENDPOINT and S3_ENDPOINT with default PORT_BASE", () => {
    const resolved = resolveConfig(makeConfig(), {}, "test");
    expect(resolved.envVars.DYNAMODB_ENDPOINT).toBe("http://localhost:7112");
    expect(resolved.envVars.S3_ENDPOINT).toBe("http://localhost:7114");
  });

  test("cloud: no DYNAMODB_ENDPOINT or S3_ENDPOINT", () => {
    const resolved = resolveConfig(makeConfig(), {}, "cloud");
    expect(resolved.envVars.DYNAMODB_ENDPOINT).toBeUndefined();
    expect(resolved.envVars.S3_ENDPOINT).toBeUndefined();
  });

  test("custom PORT_BASE changes endpoint ports", () => {
    const resolved = resolveConfig(makeConfig(), { PORT_BASE: "8000" }, "dev");
    expect(resolved.envVars.DYNAMODB_ENDPOINT).toBe("http://localhost:8002");
    expect(resolved.envVars.S3_ENDPOINT).toBe("http://localhost:8004");
  });

  test("empty tables/buckets = no auto-generated vars", () => {
    const resolved = resolveConfig(makeConfig(), {}, "cloud");
    const keys = Object.keys(resolved.envVars);
    const dynamoKeys = keys.filter((k) => k.startsWith("DYNAMODB_TABLE_"));
    const s3Keys = keys.filter((k) => k.startsWith("S3_BUCKET_"));
    expect(dynamoKeys).toHaveLength(0);
    expect(s3Keys).toHaveLength(0);
    expect(resolved.tables).toHaveLength(0);
    expect(resolved.buckets).toHaveLength(0);
  });

  test("frontend bucket name follows stage convention", () => {
    expect(resolveConfig(makeConfig(), {}, "cloud").frontendBucketName).toBe("my-app-frontend");
    expect(resolveConfig(makeConfig(), {}, "dev").frontendBucketName).toBe("my-app-dev-frontend");
  });

  test("FRONTEND_BUCKET env var is set", () => {
    const resolved = resolveConfig(makeConfig(), {}, "cloud");
    expect(resolved.envVars.FRONTEND_BUCKET).toBe("my-app-frontend");
  });

  test("passthrough fields preserved", () => {
    const config = makeConfig({
      backend: {
        runtime: "nodejs20.x",
        entries: {
          api: {
            handler: "src/lambda.ts",
            timeout: 30,
            memory: 1024,
            routes: ["*"],
          },
        },
      },
      testing: { unit: "src/**/*.test.ts", e2e: "e2e/**/*.test.ts" },
    });
    const resolved = resolveConfig(config, {}, "cloud");
    expect(resolved.backend).toEqual(config.backend);
    expect(resolved.testing).toEqual(config.testing);
  });
});
