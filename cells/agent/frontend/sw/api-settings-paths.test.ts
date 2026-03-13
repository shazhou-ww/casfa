import { afterEach, describe, expect, test } from "bun:test";
import { listSettings, setSetting } from "./api";

const originalFetch = globalThis.fetch;
const originalSelf = globalThis.self as unknown;

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { self?: unknown }).self = originalSelf;
});

describe("sw settings api paths", () => {
  test("listSettings uses /api/me/settings", async () => {
    let calledUrl = "";
    (globalThis as { self?: unknown }).self = {
      registration: { scope: "http://localhost:7100/agent/" },
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;

    await listSettings();
    expect(calledUrl).toBe("http://localhost:7100/agent/api/me/settings");
  });

  test("setSetting uses /api/me/settings/:key", async () => {
    let calledUrl = "";
    (globalThis as { self?: unknown }).self = {
      registration: { scope: "http://localhost:7100/agent/" },
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    await setSetting("mcp.servers", [{ id: "x" }]);
    expect(calledUrl).toBe("http://localhost:7100/agent/api/me/settings/mcp.servers");
  });
});

