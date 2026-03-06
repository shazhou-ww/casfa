import { describe, expect, it } from "bun:test";
import { buildCognitoAuthorizeUrl } from "./cognito-client.ts";
import type { CognitoConfig } from "./types.ts";

const testConfig: CognitoConfig = {
  region: "us-east-1",
  userPoolId: "us-east-1_test",
  clientId: "test-client-id",
  hostedUiUrl: "https://test.auth.us-east-1.amazoncognito.com",
};

describe("buildCognitoAuthorizeUrl", () => {
  it("builds correct URL with all params", () => {
    const url = buildCognitoAuthorizeUrl(testConfig, {
      redirectUri: "https://example.com/callback",
      state: "abc123",
      scope: "openid profile",
      identityProvider: "Google",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://test.auth.us-east-1.amazoncognito.com");
    expect(parsed.pathname).toBe("/oauth2/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
    expect(parsed.searchParams.get("state")).toBe("abc123");
    expect(parsed.searchParams.get("scope")).toBe("openid profile");
    expect(parsed.searchParams.get("identity_provider")).toBe("Google");
  });

  it("omits scope and identity_provider when null", () => {
    const url = buildCognitoAuthorizeUrl(testConfig, {
      redirectUri: "https://example.com/callback",
      state: "abc123",
      scope: null,
      identityProvider: null,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.has("scope")).toBe(false);
    expect(parsed.searchParams.has("identity_provider")).toBe(false);
  });
});
