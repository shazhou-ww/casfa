import type { RegisteredServer } from "./server-registry.ts";

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

function collectBindingAliases(server: RegisteredServer): string[] {
  const aliases = new Set<string>();
  const push = (value: string | undefined) => {
    if (!value) return;
    const normalized = value.trim().toLowerCase();
    if (normalized) aliases.add(normalized);
  };

  push(server.id);
  push(server.name);

  try {
    const url = new URL(server.url);
    const pathParts = url.pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
    for (const part of pathParts) push(part);
    if (url.hostname) {
      const hostParts = url.hostname.split(".").filter(Boolean).map((part) => part.toLowerCase());
      for (const part of hostParts) push(part);
    }
  } catch {
    // ignore malformed url
  }

  return [...aliases];
}

export function getBindingForServer(server: RegisteredServer, toolName: string): MinimalBinding | null {
  const direct = getBinding(server.id, toolName);
  if (direct) return direct;

  const aliases = collectBindingAliases(server);
  for (const alias of aliases) {
    const match = getBinding(alias, toolName);
    if (match) return match;
  }
  return null;
}
