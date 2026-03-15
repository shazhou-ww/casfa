import { describe, expect, it } from "bun:test";
import { createMemoryBranchStore } from "./branch-store.ts";

describe("branch store", () => {
  it("stores branch without mountPath", async () => {
    const store = createMemoryBranchStore();
    await store.insertBranch({
      branchId: "b1",
      realmId: "r1",
      parentId: "root-1",
      expiresAt: Date.now() + 60_000,
    });

    const branch = await store.getBranch("b1");
    expect(branch?.branchId).toBe("b1");
    expect(branch?.realmId).toBe("r1");
    expect((branch as { mountPath?: unknown } | null)?.mountPath).toBeUndefined();
  });
});
