/**
 * E2E: Realm info, usage, gc.
 * Paths: /api/realm/:realmId, /api/realm/:realmId/usage, /api/realm/:realmId/gc.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext } from "./setup.ts";

describe("Realm", () => {
  const ctx = createE2EContext();
  const realmId = "e2e-" + crypto.randomUUID();

  beforeAll(async () => {
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("GET realm info returns realmId and counts", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const res = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}`
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      realmId?: string;
      nodeCount?: number;
      totalBytes?: number;
      delegateCount?: number;
      lastGcTime?: number;
    };
    expect(data.realmId).toBe(realmId);
    expect(typeof data.nodeCount).toBe("number");
    expect(typeof data.totalBytes).toBe("number");
    expect(typeof data.delegateCount).toBe("number");
  });

  it("GET realm usage returns nodeCount and totalBytes", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const res = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/usage`
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { nodeCount?: number; totalBytes?: number };
    expect(typeof data.nodeCount).toBe("number");
    expect(typeof data.totalBytes).toBe("number");
  });

  it("POST realm gc returns gc true and cutOffTime", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const cutOffTime = Date.now() - 3600_000;
    const res = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/gc`,
      { cutOffTime }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { gc?: boolean; cutOffTime?: number };
    expect(data.gc).toBe(true);
    expect(data.cutOffTime).toBe(cutOffTime);
  });
});
