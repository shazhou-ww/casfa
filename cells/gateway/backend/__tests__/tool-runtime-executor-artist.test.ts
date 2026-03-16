import { describe, expect, it } from "bun:test";
import { executeToolRuntime } from "../services/tool-runtime-executor.ts";

describe("tool runtime executor", () => {
  it("runs expected pipeline for image edit", async () => {
    const calls: string[] = [];
    const toolArgs: Record<string, unknown>[] = [];
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
        async callRawTool(params: { args: Record<string, unknown> }) {
          calls.push("call_raw_tool");
          toolArgs.push(params.args);
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
    expect(toolArgs).toEqual([
      {
        casfaBranchUrl: "https://drive.example.com/branch/exec-1/ver",
        inputImagePath: "inputs/source.png",
        outputPath: "outputs/outputPath",
        prompt: "make it watercolor",
      },
    ]);
  });

  it("stops output transfer when tool call returns error", async () => {
    const calls: string[] = [];
    await expect(
      executeToolRuntime(
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
            return {
              isError: true,
              content: [{ type: "text", text: "{\"success\":false,\"error\":\"boom\"}" }],
            };
          },
          async closeBranch() {
            calls.push("close_branch");
          },
          async resolvePathBranchId(path) {
            if (path === "images/source.png") return "source-branch";
            return "target-branch";
          },
        }
      )
    ).rejects.toThrow("boom");

    expect(calls).toEqual([
      "create_branch",
      "transfer_paths_input",
      "call_raw_tool",
      "close_branch",
    ]);
  });

  it("stops before tool call when input transfer returns isError", async () => {
    const calls: string[] = [];
    await expect(
      executeToolRuntime(
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
              return {
                isError: true,
                content: [{ type: "text", text: "{\"success\":false,\"error\":\"copy failed\"}" }],
              };
            }
            calls.push("transfer_paths_output");
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
      )
    ).rejects.toThrow("copy failed");

    expect(calls).toEqual([
      "create_branch",
      "transfer_paths_input",
      "close_branch",
    ]);
  });
});
