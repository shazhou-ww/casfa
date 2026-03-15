import { describe, expect, it } from "bun:test";
import { getBinding, getBindingForServer } from "../services/tool-binding-registry.ts";

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

  it("resolves binding via server alias when id is dynamic", () => {
    const binding = getBindingForServer(
      {
        id: "srv_c4536b303263",
        name: "Artist",
        url: "https://beta.casfa.shazhou.me/artist/mcp",
      },
      "flux_image"
    );
    expect(binding).toEqual({
      branchUrl: "casfaBranchUrl",
      inputs: [],
      outputs: ["outputPath"],
    });
  });
});
