import { describe, expect, test } from "bun:test";
import type { OAuthServer } from "@casfa/cell-cognito-server";
import { createSsoOAuthRoutes } from "./oauth.ts";
import type { SsoConfig } from "../config.ts";

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
        secure: false,
      },
      dynamodbTableGrants: "sso-dev-grants",
    };

    const routes = createSsoOAuthRoutes({
      config,
      cognitoConfig: config.cognito,
      oauthServer: createStubOAuthServer(),
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
