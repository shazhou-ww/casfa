/**
 * E2E Tests: Health Check and Service Info
 *
 * Tests for public endpoints that don't require authentication.
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

  it("should return healthy status", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/health`);

    expect(response.status).toBe(200);

    const data = ((await response.json()) as any) as { status: string };
    expect(data.status).toBe("ok");
  });

  it("should return service info", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/info`);

    expect(response.status).toBe(200);

    const data = ((await response.json()) as any) as {
      service?: string;
      name?: string;
      version?: string;
    };
    // Service info has either 'name' or 'service' property depending on server version
    expect(data.service ?? data.name).toBeDefined();
    expect(data.version).toBeDefined();
  });
});
