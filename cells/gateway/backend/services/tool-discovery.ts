import type { RegisteredServer } from "./server-registry.ts";
import type { ServerOAuthStateStore } from "./server-oauth-state.ts";
import { getBinding, type MinimalBinding } from "./tool-binding-registry.ts";

export type ToolSummary = {
  name: string;
  description?: string;
  xBinding?: MinimalBinding;
};

export type GetToolsResult = {
  serverId: string;
  tools: ToolSummary[];
  error?: string;
};

type JsonRpcResponse = {
  result?: {
    tools?: Array<{ name?: string; description?: string }>;
  };
  error?: {
    message?: string;
  };
};

async function callToolsList(server: RegisteredServer, accessToken?: string): Promise<JsonRpcResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const res = await fetch(`${server.url.replace(/\/$/, "")}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
  if (!res.ok) {
    return {
      error: {
        message: `tools/list failed: ${res.status}`,
      },
    };
  }
  return (await res.json()) as JsonRpcResponse;
}

export async function getToolsForServers(
  userId: string,
  servers: RegisteredServer[],
  oauthStore: ServerOAuthStateStore
): Promise<GetToolsResult[]> {
  const results: GetToolsResult[] = [];
  for (const server of servers) {
    const oauth = await oauthStore.get(userId, server.id);
    try {
      const payload = await callToolsList(server, oauth?.accessToken);
      if (payload.error) {
        results.push({ serverId: server.id, tools: [], error: payload.error.message ?? "tools/list failed" });
        continue;
      }
      const tools =
        payload.result?.tools
          ?.filter((tool): tool is { name: string; description?: string } => typeof tool.name === "string")
          .map((tool) => ({
            name: tool.name,
            description: tool.description,
            ...(getBinding(server.id, tool.name) && { xBinding: getBinding(server.id, tool.name)! }),
          })) ?? [];
      results.push({ serverId: server.id, tools });
    } catch (error) {
      results.push({
        serverId: server.id,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
