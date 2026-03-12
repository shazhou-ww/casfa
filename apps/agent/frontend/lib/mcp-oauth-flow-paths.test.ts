import { afterEach, describe, expect, test } from "bun:test";
import { getMcpClientMetadataUrl, getMcpOAuthRedirectUri } from "./mcp-oauth-flow";

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
});

describe("mcp oauth mount-aware URLs", () => {
  test("builds callback URL under mount path", () => {
    (globalThis as { window?: unknown }).window = {
      location: {
        origin: "http://localhost:7100",
        pathname: "/agent/settings",
      },
    };
    expect(getMcpOAuthRedirectUri()).toBe("http://localhost:7100/agent/oauth/mcp-callback");
  });

  test("builds client metadata URL under mount path", () => {
    (globalThis as { window?: unknown }).window = {
      location: {
        origin: "http://localhost:7100",
        pathname: "/agent/settings",
      },
    };
    expect(getMcpClientMetadataUrl()).toBe("http://localhost:7100/agent/oauth/mcp-client-metadata");
  });
});

