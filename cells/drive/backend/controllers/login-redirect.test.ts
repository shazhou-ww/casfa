import { describe, expect, test } from "bun:test";
import { createMemoryPendingClientInfoStore } from "@casfa/cell-delegates-server";
import { createLoginRedirectRoutes, resolveSsoBaseUrlForRequest, resolveSsoRefreshCookiePath } from "./login-redirect";
import type { ServerConfig } from "../config";

describe("resolveSsoBaseUrlForRequest", () => {
  test("uses request origin for loopback dev when configured origin differs by port", () => {
    const resolved = resolveSsoBaseUrlForRequest(
      "http://localhost:8900/sso",
      "http://localhost:7100"
    );
    expect(resolved).toBe("http://localhost:7100/sso");
  });

  test("keeps configured non-loopback origin", () => {
    const resolved = resolveSsoBaseUrlForRequest(
      "https://sso.example.com/sso",
      "https://drive.example.com"
    );
    expect(resolved).toBe("https://sso.example.com/sso");
  });
});

describe("resolveSsoRefreshCookiePath", () => {
  test("uses mounted refresh cookie path for path-based SSO URL", () => {
    expect(resolveSsoRefreshCookiePath("http://localhost:7100/sso")).toBe("/sso/oauth/refresh");
  });

  test("uses root refresh cookie path for host-based SSO URL", () => {
    expect(resolveSsoRefreshCookiePath("https://sso.example.com")).toBe("/oauth/refresh");
  });
});

describe("createLoginRedirectRoutes error body", () => {
  const baseConfig: ServerConfig = {
    port: 7101,
    baseUrl: "http://localhost:7101",
    auth: {},
    ssoBaseUrl: "http://localhost:7100/sso",
    dynamodbTableRealms: "realms",
    dynamodbTableGrants: "grants",
    dynamodbTablePendingClientInfo: "pending",
    s3Bucket: "blob",
  };

  test("GET /api/oauth/client-info without client_id returns error and message", async () => {
    const app = createLoginRedirectRoutes(baseConfig, {
      pendingClientInfoStore: createMemoryPendingClientInfoStore(),
    });
    const res = await app.request("http://localhost/api/oauth/client-info");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("BAD_REQUEST");
    expect(typeof body.message).toBe("string");
  });

  test("GET /api/oauth/client-info unknown client returns error and message", async () => {
    const app = createLoginRedirectRoutes(baseConfig, {
      pendingClientInfoStore: createMemoryPendingClientInfoStore(),
    });
    const res = await app.request("http://localhost/api/oauth/client-info?client_id=unknown");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("NOT_FOUND");
    expect(typeof body.message).toBe("string");
  });
});

