import { describe, expect, it } from "bun:test";
import { executeTransfer, validateTransferSpec } from "../../services/transfer-paths.ts";
import { createMemoryBranchStore } from "../../db/branch-store.ts";
import { createCasFacade } from "../../services/cas.ts";
import { loadConfig } from "../../config.ts";

describe("transfer paths preflight", () => {
  it("rejects parent-child conflicts in target paths", async () => {
    const spec = {
      source: "b-src",
      target: "b-tgt",
      mapping: {
        "a.png": "out",
        "b.png": "out/sub/b.png",
      },
      mode: "replace" as const,
    };
    const { cas, key } = createCasFacade(loadConfig());
    const branchStore = createMemoryBranchStore();
    await expect(executeTransfer(spec, { cas, key, branchStore })).rejects.toThrow(
      "target paths must not be ancestor/descendant"
    );
  });

  it("normalizes mapping paths", () => {
    const validated = validateTransferSpec({
      source: "b-src",
      target: "b-tgt",
      mapping: {
        "/inputs/a.png/": "/out/a.png/",
      },
    });
    expect(validated.mapping).toEqual({
      "inputs/a.png": "out/a.png",
    });
  });
});
