import { describe, expect, test } from "bun:test";
import {
  buildOAuthAuthorizationServerMetadata,
  buildOAuthProtectedResourceMetadata,
  createOAuthDiscoveryRegistry,
  extractMountFromAuthorizationServerWellKnownPath,
  extractProtectedResourcePathFromWellKnown,
} from "../well-known.js";

describe("extractMountFromAuthorizationServerWellKnownPath", () => {
  test("extracts mount from RFC 8414 well-known path suffix", () => {
    expect(
      extractMountFromAuthorizationServerWellKnownPath(
        "/.well-known/oauth-authorization-server/agent"
      )
    ).toBe("agent");
  });

  test("returns null for root no-suffix discovery path", () => {
    expect(
      extractMountFromAuthorizationServerWellKnownPath(
        "/.well-known/oauth-authorization-server"
      )
    ).toBeNull();
  });

  test("returns null for invalid suffix with extra segments", () => {
    expect(
      extractMountFromAuthorizationServerWellKnownPath(
        "/.well-known/oauth-authorization-server/agent/nested"
      )
    ).toBeNull();
  });
});

describe("createOAuthDiscoveryRegistry", () => {
  test("registers only oauth-enabled cells", () => {
    const registry = createOAuthDiscoveryRegistry([
      { mount: "agent", config: { oauth: { enabled: true, role: "both", scopes: ["use_mcp"] } } },
      { mount: "drive", config: { oauth: { enabled: false, role: "both", scopes: ["use_mcp"] } } },
      { mount: "plain", config: {} },
    ] as any);
    expect(Array.from(registry.keys())).toEqual(["agent"]);
  });
});

describe("buildOAuthAuthorizationServerMetadata", () => {
  test("builds metadata with issuer at mount path", () => {
    const metadata = buildOAuthAuthorizationServerMetadata("http://localhost:8900", "agent", ["use_mcp"]);
    expect(metadata.issuer).toBe("http://localhost:8900/agent");
    expect(metadata.authorization_endpoint).toBe("http://localhost:8900/agent/oauth/authorize");
    expect(metadata.token_endpoint).toBe("http://localhost:8900/agent/oauth/token");
    expect(metadata.registration_endpoint).toBe("http://localhost:8900/agent/oauth/register");
    expect(metadata.scopes_supported).toEqual(["use_mcp"]);
  });
});

describe("extractProtectedResourcePathFromWellKnown", () => {
  test("extracts protected resource path from RFC 9728 suffix", () => {
    expect(
      extractProtectedResourcePathFromWellKnown(
        "/.well-known/oauth-protected-resource/drive/mcp"
      )
    ).toBe("/drive/mcp");
  });

  test("returns null for root path without suffix", () => {
    expect(
      extractProtectedResourcePathFromWellKnown(
        "/.well-known/oauth-protected-resource"
      )
    ).toBeNull();
  });
});

describe("buildOAuthProtectedResourceMetadata", () => {
  test("builds resource metadata for mounted MCP route", () => {
    const metadata = buildOAuthProtectedResourceMetadata(
      "http://localhost:7100",
      "/drive/mcp",
      "drive",
      ["use_mcp"]
    );
    expect(metadata.authorization_servers).toEqual(["http://localhost:7100/drive"]);
    expect(metadata.resource).toBe("http://localhost:7100/drive/mcp");
    expect(metadata.scopes_supported).toEqual(["use_mcp"]);
  });
});
