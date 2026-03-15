import { describe, expect, it } from "bun:test";
import { getBinding } from "../services/tool-binding-registry.ts";

describe("gateway tool binding", () => {
  it("returns minimal binding for artist flux tools", () => {
    const image = getBinding("artist", "flux_image");
    const edit = getBinding("artist", "flux_image_edit");

    expect(image).toEqual({
      branchUrl: "casfaBranchUrl",
      inputs: [],
      outputs: ["outputPath"],
    });
    expect(edit).toEqual({
      branchUrl: "casfaBranchUrl",
      inputs: ["inputImagePath"],
      outputs: ["outputPath"],
    });
  });

  it("returns null when no binding is registered", () => {
    expect(getBinding("artist", "unknown")).toBeNull();
  });
});
