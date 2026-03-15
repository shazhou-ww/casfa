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
  }) => Promise<void>;
  callRawTool: (params: {
    serverId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<unknown>;
  closeBranch: (branchId: string) => Promise<void>;
  resolvePathBranchId: (path: string) => Promise<string>;
};

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
        const branchRelativeInput = `inputs/${argName}`;
        const mapping: Record<string, string> = {};
        mapping[sourcePath] = branchRelativeInput;
        rawArgs[argName] = branchRelativeInput;
        await deps.transferPaths({
          source: sourceBranchId,
          target: exec.branchId,
          mapping,
          mode: "replace",
        });
      }
    }

    for (const argName of input.binding.outputs) {
      const outputPath = typeof input.args[argName] === "string" ? (input.args[argName] as string) : "";
      if (!outputPath) continue;
      rawArgs[argName] = `outputs/${argName}`;
    }

    await deps.callRawTool({
      serverId: input.serverId,
      toolName: input.toolName,
      args: rawArgs,
    });

    for (const argName of input.binding.outputs) {
      const outputPath = typeof input.args[argName] === "string" ? (input.args[argName] as string) : "";
      if (!outputPath) continue;
      const outputTargetBranchId = await deps.resolvePathBranchId(outputPath);
      await deps.transferPaths({
        source: exec.branchId,
        target: outputTargetBranchId,
        mapping: {
          [`outputs/${argName}`]: outputPath,
        },
        mode: "replace",
      });
    }

    await deps.closeBranch(exec.branchId);
    return { branchId: exec.branchId };
  } catch (error) {
    await deps.closeBranch(exec.branchId);
    throw error;
  }
}
