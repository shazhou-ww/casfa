import { describe, expect, test } from "bun:test";
import { buildDynamoDBArgs, buildMinIOArgs } from "../docker.js";

describe("buildDynamoDBArgs", () => {
  test("persistent=true: no -inMemory flag", () => {
    const args = buildDynamoDBArgs({
      port: 8000,
      persistent: true,
      containerName: "my-dynamo",
    });
    expect(args).toContain("docker");
    expect(args).toContain("run");
    expect(args).toContain("-d");
    expect(args).toContain("--name");
    expect(args).toContain("my-dynamo");
    expect(args).toContain("-p");
    expect(args).toContain("8000:8000");
    expect(args).toContain("amazon/dynamodb-local");
    expect(args).not.toContain("-inMemory");
  });

  test("persistent=false: includes -inMemory flag", () => {
    const args = buildDynamoDBArgs({
      port: 7102,
      persistent: false,
      containerName: "test-dynamo",
    });
    expect(args).toContain("-inMemory");
    expect(args).toContain("7102:8000");
    expect(args).toContain("test-dynamo");
  });

  test("port mapping format is correct", () => {
    const args = buildDynamoDBArgs({
      port: 9999,
      persistent: true,
      containerName: "d",
    });
    expect(args).toContain("9999:8000");
  });
});

describe("buildMinIOArgs", () => {
  test("with dataDir: includes -v volume mount", () => {
    const args = buildMinIOArgs({
      port: 9000,
      containerName: "my-minio",
      dataDir: "/tmp/minio-data",
    });
    expect(args).toContain("-v");
    expect(args).toContain("/tmp/minio-data:/data");
    expect(args).toContain("minio/minio");
    expect(args).toContain("server");
    expect(args).toContain("/data");
    expect(args).toContain("9000:9000");
  });

  test("without dataDir: no -v flag", () => {
    const args = buildMinIOArgs({
      port: 9000,
      containerName: "my-minio",
    });
    expect(args).not.toContain("-v");
    expect(args).toContain("minio/minio");
    expect(args).toContain("server");
    expect(args).toContain("/data");
  });

  test("environment variables for MinIO credentials are set", () => {
    const args = buildMinIOArgs({
      port: 9000,
      containerName: "m",
    });
    const envIdx = args.indexOf("MINIO_ROOT_USER=minioadmin");
    expect(envIdx).toBeGreaterThan(0);
    expect(args[envIdx - 1]).toBe("-e");

    const envIdx2 = args.indexOf("MINIO_ROOT_PASSWORD=minioadmin");
    expect(envIdx2).toBeGreaterThan(0);
    expect(args[envIdx2 - 1]).toBe("-e");
  });

  test("port mapping format is correct", () => {
    const args = buildMinIOArgs({
      port: 7104,
      containerName: "m",
    });
    expect(args).toContain("7104:9000");
  });
});
