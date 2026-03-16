import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createMemoryBranchStore } from "../../db/branch-store.ts";
import { createBranchUrlAuthMiddleware } from "../../middleware/branch-url-auth.ts";
import type { Env } from "../../types.ts";

describe("branch url auth middleware mount path", () => {
  it("handles mount-prefixed /drive/branch/:id/:verification URLs", async () => {
    const branchStore = createMemoryBranchStore();
    const branchId = "branch-mount-1";
    const verification = "VERIFICATION12345678901234";
    await branchStore.insertBranch({
      branchId,
      realmId: "realm-1",
      parentId: "parent-1",
      expiresAt: Date.now() + 60_000,
      accessVerification: { value: verification, expiresAt: Date.now() + 60_000 },
    });

    const app = new Hono<Env>();
    app.use("*", createBranchUrlAuthMiddleware({ branchStore, app }));
    app.put("/api/realm/:realmId/root", (c) => c.json({ ok: true }, 201));

    const res = await app.request(
      `http://localhost/drive/branch/${branchId}/${verification}/api/realm/me/root`,
      {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array([1, 2, 3]),
      }
    );

    expect(res.status).toBe(201);
    const data = (await res.json()) as { ok?: boolean };
    expect(data.ok).toBe(true);
  });
});
