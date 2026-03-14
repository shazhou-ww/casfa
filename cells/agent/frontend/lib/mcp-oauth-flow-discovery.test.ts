import { afterEach, describe, expect, test } from "bun:test";
import { discoverFromConfig } from "./mcp-oauth-flow";
import type { MCPServerConfig } from "./mcp-types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("discoverFromConfig", () => {
  test("prefers well-known metadata before probing MCP endpoint", async () => {
    const calls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url === "http://localhost:7100/.well-known/oauth-protected-resource/artist/mcp") {
        return Response.json({
          authorization_servers: ["http://localhost:7100/sso"],
        });
      }
      if (url === "http://localhost:7100/.well-known/oauth-authorization-server/sso") {
        return Response.json({
          issuer: "http://localhost:7100/sso",
          authorization_endpoint: "http://localhost:7100/sso/oauth/authorize",
          token_endpoint: "http://localhost:7100/sso/oauth/token",
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const config: MCPServerConfig = {
      id: "artist-local",
      name: "Artist Local",
      transport: "http",
      auth: "oauth2",
      url: "http://localhost:7100/artist/mcp",
    };

    const result = await discoverFromConfig(config);

    expect(result.resourceUrl).toBe("http://localhost:7100/artist/mcp");
    expect(result.asBaseUrl).toBe("http://localhost:7100/sso");
    expect(calls).toContain("http://localhost:7100/.well-known/oauth-protected-resource/artist/mcp");
    expect(calls).not.toContain("http://localhost:7100/artist/mcp");
  });
});
