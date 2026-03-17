import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext } from "./setup.ts";

describe("OAuth routes", () => {
  const ctx = createE2EContext();

  beforeAll(async () => {
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("GET /api/oauth/client-info without client_id returns ErrorBody", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/oauth/client-info`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("BAD_REQUEST");
    expect(typeof body.message).toBe("string");
  });
});
