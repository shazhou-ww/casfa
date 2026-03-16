import { describe, expect, test } from "bun:test";
import type { OAuthServer } from "@casfa/cell-cognito-server";
import { createRefreshHandle, createSsoOAuthRoutes, selectAuthCookieToken } from "./oauth.ts";
import type { SsoConfig } from "../config.ts";
import { createMemoryRefreshSessionStore } from "../refresh-session-store.ts";

function createStubOAuthServer(): OAuthServer {
  return {
    handleToken: async () => {
      throw new Error("not used in this test");
    },
    getMetadata: () => ({}),
    registerClient: () => ({ clientId: "x", clientName: "x", redirectUris: [] }),
  } as unknown as OAuthServer;
}

describe("createSsoOAuthRoutes", () => {
  test("createRefreshHandle returns url-safe random token", () => {
    const handle = createRefreshHandle();
    expect(handle.length).toBeGreaterThan(20);
    expect(/^[A-Za-z0-9_-]+$/.test(handle)).toBe(true);
  });

  test("selectAuthCookieToken prefers id token for richer user claims", () => {
    expect(
      selectAuthCookieToken({
        accessToken: "access-short",
        idToken: "id-long",
      })
    ).toBe("id-long");
  });

  test("selectAuthCookieToken falls back to access token when id token missing", () => {
    expect(
      selectAuthCookieToken({
        accessToken: "access-short",
        idToken: null,
      })
    ).toBe("access-short");
  });

  test("oauth/authorize uses configured CELL_BASE_URL for redirect_uri", async () => {
    const config: SsoConfig = {
      baseUrl: "http://localhost:8900/sso",
      cognito: {
        region: "us-east-1",
        userPoolId: "pool",
        clientId: "client-id",
        hostedUiUrl: "https://example.auth.us-east-1.amazoncognito.com",
      },
      cookie: {
        authCookieName: "auth",
        authCookiePath: "/",
        refreshCookieName: "auth_refresh",
        refreshCookiePath: "/oauth/refresh",
        sameSite: "Lax",
        secure: false,
      },
      dynamodbTableGrants: "sso-dev-grants",
      dynamodbTableRefreshSessions: "sso-dev-grants",
    };

    const routes = createSsoOAuthRoutes({
      config,
      cognitoConfig: config.cognito,
      oauthServer: createStubOAuthServer(),
      refreshSessionStore: createMemoryRefreshSessionStore(),
    });

    const res = await routes.fetch(
      new Request("http://localhost:7100/oauth/authorize?return_url=http://localhost:7100/drive", {
        headers: {
          Host: "localhost:7100",
          "X-Forwarded-Proto": "http",
        },
      })
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toContain(
      encodeURIComponent("http://localhost:8900/sso/oauth/callback")
    );
  });
});
