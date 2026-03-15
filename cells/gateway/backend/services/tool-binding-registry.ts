export type MinimalBinding = {
  branchUrl: string;
  inputs: string[];
  outputs: string[];
};

type BindingKey = `${string}:${string}`;

function keyOf(serverId: string, toolName: string): BindingKey {
  return `${serverId}:${toolName}`;
}

const BINDINGS = new Map<BindingKey, MinimalBinding>([
  [
    keyOf("artist", "flux_image"),
    {
      branchUrl: "casfaBranchUrl",
      inputs: [],
      outputs: ["outputPath"],
    },
  ],
  [
    keyOf("artist", "flux_image_edit"),
    {
      branchUrl: "casfaBranchUrl",
      inputs: ["inputImagePath"],
      outputs: ["outputPath"],
    },
  ],
]);

export function getBinding(serverId: string, toolName: string): MinimalBinding | null {
  return BINDINGS.get(keyOf(serverId, toolName)) ?? null;
}
