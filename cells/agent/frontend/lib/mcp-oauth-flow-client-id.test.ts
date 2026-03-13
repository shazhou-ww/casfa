import { afterEach, describe, expect, test } from "bun:test";
import { resolveOAuthClientId } from "./mcp-oauth-flow";
import type { MCPServerConfig } from "./mcp-types";
import type { OAuthDiscoveryResult } from "./mcp-oauth-flow";

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { window?: unknown }).window = originalWindow;
});

describe("resolveOAuthClientId", () => {
  test("uses dynamic registration endpoint when available", async () => {
    let seenClientName = "";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { client_name?: string };
      seenClientName = body.client_name ?? "";
      return Response.json({ client_id: "mcp" });
    }) as unknown as typeof fetch;
    (globalThis as { window?: unknown }).window = {
      location: { origin: "http://localhost:7100", pathname: "/agent/settings" },
    };

    const config: MCPServerConfig = {
      id: "s1",
      name: "Drive MCP",
      transport: "http",
      auth: "oauth2",
      url: "http://localhost:7100/drive/mcp",
    };
    const discovery: OAuthDiscoveryResult = {
      resourceMetadata: {},
      asMetadata: {
        authorization_endpoint: "http://localhost:7100/drive/oauth/authorize",
        token_endpoint: "http://localhost:7100/drive/oauth/token",
        registration_endpoint: "http://localhost:7100/drive/oauth/register",
      },
      resourceUrl: "http://localhost:7100/drive/mcp",
      asBaseUrl: "http://localhost:7100/drive",
    };

    const clientId = await resolveOAuthClientId(
      config,
      discovery,
      "http://localhost:7100/agent/oauth/mcp-callback"
    );
    expect(clientId).toBe("mcp");
    expect(seenClientName).toBe("Drive MCP");
  });

  test("prefers configured oauthClientId and skips dynamic registration", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json({ client_id: "unexpected" });
    }) as unknown as typeof fetch;
    (globalThis as { window?: unknown }).window = {
      location: { origin: "http://localhost:7100", pathname: "/agent/settings" },
    };

    const config: MCPServerConfig = {
      id: "s1",
      name: "Drive MCP",
      transport: "http",
      auth: "oauth2",
      url: "http://localhost:7100/drive/mcp",
      oauthClientId: "preset-client-id",
    };
    const discovery: OAuthDiscoveryResult = {
      resourceMetadata: {},
      asMetadata: {
        authorization_endpoint: "http://localhost:7100/drive/oauth/authorize",
        token_endpoint: "http://localhost:7100/drive/oauth/token",
        registration_endpoint: "http://localhost:7100/drive/oauth/register",
      },
      resourceUrl: "http://localhost:7100/drive/mcp",
      asBaseUrl: "http://localhost:7100/drive",
    };

    const clientId = await resolveOAuthClientId(
      config,
      discovery,
      "http://localhost:7100/agent/oauth/mcp-callback"
    );
    expect(clientId).toBe("preset-client-id");
    expect(called).toBe(false);
  });
});

