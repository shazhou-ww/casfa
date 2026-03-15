import { describe, expect, it } from "bun:test";
import { executeToolRuntime } from "../services/tool-runtime-executor.ts";

describe("tool runtime executor", () => {
  it("runs expected pipeline for image edit", async () => {
    const calls: string[] = [];
    await executeToolRuntime(
      {
        serverId: "artist",
        toolName: "flux_image_edit",
        binding: {
          branchUrl: "casfaBranchUrl",
          inputs: ["inputImagePath"],
          outputs: ["outputPath"],
        },
        args: {
          inputImagePath: "images/source.png",
          outputPath: "outputs/edited.png",
          prompt: "make it watercolor",
        },
      },
      {
        async createBranch() {
          calls.push("create_branch");
          return { branchId: "exec-1", branchUrl: "https://drive.example.com/branch/exec-1/ver" };
        },
        async transferPaths(spec) {
          if (spec.source === "source-branch") {
            calls.push("transfer_paths_input");
          } else {
            calls.push("transfer_paths_output");
          }
        },
        async callRawTool() {
          calls.push("call_raw_tool");
          return {};
        },
        async closeBranch() {
          calls.push("close_branch");
        },
        async resolvePathBranchId(path) {
          if (path === "images/source.png") return "source-branch";
          return "target-branch";
        },
      }
    );

    expect(calls).toEqual([
      "create_branch",
      "transfer_paths_input",
      "call_raw_tool",
      "transfer_paths_output",
      "close_branch",
    ]);
  });
});
