import { describe, expect, test } from "bun:test";
import { createCsrfController } from "./csrf";
import type { ServerConfig } from "../config";

describe("createCsrfController", () => {
  test("returns ErrorBody when SSO is not configured", async () => {
    const config: ServerConfig = {
      port: 7101,
      baseUrl: "http://localhost:7101",
      auth: {},
      dynamodbTableRealms: "realms",
      dynamodbTableGrants: "grants",
      dynamodbTablePendingClientInfo: "pending",
      s3Bucket: "blob",
    };
    const app = createCsrfController(config);
    const res = await app.request("http://localhost/api/csrf");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("SSO_NOT_CONFIGURED");
    expect(typeof body.message).toBe("string");
  });
});
