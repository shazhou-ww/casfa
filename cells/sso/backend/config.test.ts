import { describe, expect, test } from "bun:test";
import { loadConfigFromEnv } from "./config.ts";

describe("loadConfigFromEnv", () => {
  test("path-based baseUrl uses mounted refresh cookie path", () => {
    const config = loadConfigFromEnv({
      CELL_BASE_URL: "http://localhost:7100/sso",
      COGNITO_REGION: "us-east-1",
      COGNITO_USER_POOL_ID: "pool",
      COGNITO_CLIENT_ID: "client",
      COGNITO_HOSTED_UI_URL: "https://example.auth.us-east-1.amazoncognito.com",
    });

    expect(config.cookie.authCookiePath).toBe("/");
    expect(config.cookie.refreshCookiePath).toBe("/sso/oauth/refresh");
  });
});
