import { describe, expect, test } from "bun:test";
import { buildOAuthAuthorizationServerMetadataUrl } from "./oauth-discovery-url";

describe("buildOAuthAuthorizationServerMetadataUrl", () => {
  test("builds RFC 8414 URL for path issuer", () => {
    const url = buildOAuthAuthorizationServerMetadataUrl("https://casfa.shazhou.me/agent");
    expect(url).toBe("https://casfa.shazhou.me/.well-known/oauth-authorization-server/agent");
  });

  test("normalizes trailing slash in issuer URL", () => {
    const url = buildOAuthAuthorizationServerMetadataUrl("https://casfa.shazhou.me/agent/");
    expect(url).toBe("https://casfa.shazhou.me/.well-known/oauth-authorization-server/agent");
  });

  test("builds root discovery URL for root issuer", () => {
    const url = buildOAuthAuthorizationServerMetadataUrl("https://casfa.shazhou.me/");
    expect(url).toBe("https://casfa.shazhou.me/.well-known/oauth-authorization-server");
  });
});
