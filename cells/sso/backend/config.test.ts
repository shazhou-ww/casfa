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

  test("defaults sameSite to Lax in dev for non-localhost tunnel-like host", () => {
    const config = loadConfigFromEnv({
      CELL_BASE_URL: "https://sso.mymbp.shazhou.work",
      STAGE: "dev",
      COGNITO_REGION: "us-east-1",
      COGNITO_USER_POOL_ID: "pool",
      COGNITO_CLIENT_ID: "client",
      COGNITO_HOSTED_UI_URL: "https://example.auth.us-east-1.amazoncognito.com",
    });

    expect(config.cookie.sameSite).toBe("Lax");
  });

  test("defaults sameSite to Strict in non-dev stage for non-localhost host", () => {
    const config = loadConfigFromEnv({
      CELL_BASE_URL: "https://sso.casfa.shazhou.me",
      STAGE: "prod",
      COGNITO_REGION: "us-east-1",
      COGNITO_USER_POOL_ID: "pool",
      COGNITO_CLIENT_ID: "client",
      COGNITO_HOSTED_UI_URL: "https://example.auth.us-east-1.amazoncognito.com",
    });

    expect(config.cookie.sameSite).toBe("Strict");
  });

  test("AUTH_COOKIE_SAMESITE overrides default value (case-insensitive)", () => {
    const config = loadConfigFromEnv({
      CELL_BASE_URL: "https://sso.casfa.shazhou.me",
      STAGE: "prod",
      AUTH_COOKIE_SAMESITE: "none",
      COGNITO_REGION: "us-east-1",
      COGNITO_USER_POOL_ID: "pool",
      COGNITO_CLIENT_ID: "client",
      COGNITO_HOSTED_UI_URL: "https://example.auth.us-east-1.amazoncognito.com",
    });

    expect(config.cookie.sameSite).toBe("None");
  });

  test("normalizes AUTH_COOKIE_DOMAIN by removing leading dot", () => {
    const config = loadConfigFromEnv({
      CELL_BASE_URL: "https://sso.mymbp.shazhou.work",
      STAGE: "dev",
      AUTH_COOKIE_DOMAIN: ".mymbp.shazhou.work",
      COGNITO_REGION: "us-east-1",
      COGNITO_USER_POOL_ID: "pool",
      COGNITO_CLIENT_ID: "client",
      COGNITO_HOSTED_UI_URL: "https://example.auth.us-east-1.amazoncognito.com",
    });

    expect(config.cookie.authCookieDomain).toBe("mymbp.shazhou.work");
  });

  test("falls back refresh session table name when env var is empty", () => {
    const config = loadConfigFromEnv({
      CELL_BASE_URL: "https://sso.mymbp.shazhou.work",
      STAGE: "dev",
      DYNAMODB_TABLE_REFRESH_SESSIONS: "",
      DYNAMODB_TABLE_GRANTS: "",
      COGNITO_REGION: "us-east-1",
      COGNITO_USER_POOL_ID: "pool",
      COGNITO_CLIENT_ID: "client",
      COGNITO_HOSTED_UI_URL: "https://example.auth.us-east-1.amazoncognito.com",
    });

    expect(config.dynamodbTableGrants).toBe("sso-dev-grants");
    expect(config.dynamodbTableRefreshSessions).toBe("sso-dev-grants");
  });
});
