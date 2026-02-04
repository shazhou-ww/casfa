/**
 * E2E Tests: Health Check and Service Info
 *
 * Tests using casfa-client-v2 SDK for public endpoints.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext } from "./setup.ts";

describe("Health Check", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("should return healthy status via raw fetch", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/health`);

    expect(response.status).toBe(200);

    const data = (await response.json()) as { status: string };
    expect(data.status).toBe("ok");
  });

  it("should return service info via SDK anonymous client", async () => {
    const anonymousClient = ctx.helpers.getAnonymousClient();

    const result = await anonymousClient.getInfo();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as any;
      // Service info has either 'name' or 'service' property depending on server version
      expect(data.service ?? data.name).toBeDefined();
      expect(data.version).toBeDefined();
    }
  });
});
