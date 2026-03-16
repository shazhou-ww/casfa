import type { MinimalBinding } from "./tool-binding-registry.ts";

export type ExecuteToolRuntimeInput = {
  serverId: string;
  toolName: string;
  binding: MinimalBinding;
  args: Record<string, unknown>;
};

export type ExecuteToolRuntimeDeps = {
  createBranch: () => Promise<{ branchId: string; branchUrl: string }>;
  transferPaths: (spec: {
    source: string;
    target: string;
    mapping: Record<string, string>;
    mode?: "replace" | "fail_if_exists" | "merge_dir";
  }) => Promise<unknown>;
  callRawTool: (params: {
    serverId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<unknown>;
  closeBranch: (branchId: string) => Promise<void>;
  resolvePathBranchId: (path: string) => Promise<string>;
};

function basename(path: string): string {
  const normalized = path.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

function extractToolError(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const payload = result as {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (!payload.isError) return null;
  const text = payload.content?.find((item) => item?.type === "text")?.text;
  if (!text) return "tool call returned isError=true";
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // Keep raw text as fallback when response is not JSON.
  }
  return text;
}

export async function executeToolRuntime(
  input: ExecuteToolRuntimeInput,
  deps: ExecuteToolRuntimeDeps
): Promise<{ branchId: string }> {
  const exec = await deps.createBranch();
  try {
    const rawArgs: Record<string, unknown> = { ...input.args, [input.binding.branchUrl]: exec.branchUrl };

    if (input.binding.inputs.length > 0) {
      for (const argName of input.binding.inputs) {
        const sourcePath = typeof input.args[argName] === "string" ? (input.args[argName] as string) : "";
        if (!sourcePath) throw new Error(`missing input path arg: ${argName}`);
        const sourceBranchId = await deps.resolvePathBranchId(sourcePath);
        const sourceName = basename(sourcePath) || argName;
        const branchRelativeInput = `inputs/${sourceName}`;
        const mapping: Record<string, string> = {};
        mapping[sourcePath] = branchRelativeInput;
        rawArgs[argName] = branchRelativeInput;
        const transferInputResult = await deps.transferPaths({
          source: sourceBranchId,
          target: exec.branchId,
          mapping,
          mode: "replace",
        });
        const transferInputError = extractToolError(transferInputResult);
        if (transferInputError) {
          throw new Error(transferInputError);
        }
      }
    }

    for (const argName of input.binding.outputs) {
      const outputPath = typeof input.args[argName] === "string" ? (input.args[argName] as string) : "";
      if (!outputPath) continue;
      rawArgs[argName] = `outputs/${argName}`;
    }

    const toolResult = await deps.callRawTool({
      serverId: input.serverId,
      toolName: input.toolName,
      args: rawArgs,
    });
    const toolError = extractToolError(toolResult);
    if (toolError) {
      throw new Error(toolError);
    }

    for (const argName of input.binding.outputs) {
      const outputPath = typeof input.args[argName] === "string" ? (input.args[argName] as string) : "";
      if (!outputPath) continue;
      const outputTargetBranchId = await deps.resolvePathBranchId(outputPath);
      const transferOutputResult = await deps.transferPaths({
        source: exec.branchId,
        target: outputTargetBranchId,
        mapping: {
          [`outputs/${argName}`]: outputPath,
        },
        mode: "replace",
      });
      const transferOutputError = extractToolError(transferOutputResult);
      if (transferOutputError) {
        throw new Error(transferOutputError);
      }
    }

    await deps.closeBranch(exec.branchId);
    return { branchId: exec.branchId };
  } catch (error) {
    await deps.closeBranch(exec.branchId);
    throw error;
  }
}
