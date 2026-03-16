import type { RegisteredServer } from "./server-registry.ts";
import type { ServerOAuthStateStore } from "./server-oauth-state.ts";
import { getBindingForServer, type MinimalBinding } from "./tool-binding-registry.ts";
import { toMcpEndpoint } from "./mcp-endpoint.ts";

const HIDDEN_TOOL_NAMES = new Set(["create_branch", "transfer_paths", "close_branch"]);

export type ToolSummary = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  xBinding?: MinimalBinding;
};

export type GetToolsResult = {
  serverId: string;
  tools: ToolSummary[];
  error?: string;
};

function sanitizeSchemaForBinding(inputSchema: unknown, binding: MinimalBinding | null): unknown {
  if (!binding) return inputSchema;
  if (typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema)) {
    return inputSchema;
  }

  const schema = inputSchema as {
    type?: unknown;
    properties?: Record<string, unknown>;
    required?: unknown;
    [key: string]: unknown;
  };

  const next: Record<string, unknown> = { ...schema };

  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    const properties = { ...schema.properties };
    delete properties[binding.branchUrl];
    next.properties = properties;
  }

  if (Array.isArray(schema.required)) {
    next.required = schema.required.filter((item) => item !== binding.branchUrl);
  }

  return next;
}

function sanitizeDescriptionForBinding(
  description: string | undefined,
  binding: MinimalBinding | null
): string | undefined {
  if (!description || !binding) return description;
  if (!description.includes(binding.branchUrl)) return description;
  return `${description} Note: ${binding.branchUrl} is auto-injected by gateway runtime; do not provide it.`;
}

type JsonRpcResponse = {
  result?: {
    tools?: Array<{ name?: string; description?: string; inputSchema?: unknown }>;
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
  const endpoint = toMcpEndpoint(server.url);
  const res = await fetch(endpoint, {
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
  const text = await res.text();
  try {
    return JSON.parse(text) as JsonRpcResponse;
  } catch {
    return {
      error: {
        message: `Failed to parse JSON from ${endpoint}`,
      },
    };
  }
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
          ?.filter((tool): tool is { name: string; description?: string; inputSchema?: unknown } => typeof tool.name === "string")
          .filter((tool) => !HIDDEN_TOOL_NAMES.has(tool.name))
          .map((tool) => {
            const binding = getBindingForServer(server, tool.name);
            return {
            name: tool.name,
            description: sanitizeDescriptionForBinding(tool.description, binding),
              inputSchema: sanitizeSchemaForBinding(tool.inputSchema, binding),
            ...(binding && { xBinding: binding }),
            };
          }) ?? [];
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

type JsonRpcToolCallResponse = {
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: {
    message?: string;
  };
};

function getErrorTextSnippet(content?: Array<{ type: string; text?: string }>): string | null {
  const text = content?.find((item) => item.type === "text")?.text;
  if (!text) return null;
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

export async function callToolForServer(
  userId: string,
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  servers: RegisteredServer[],
  oauthStore: ServerOAuthStateStore,
  options?: { allowHiddenTools?: boolean }
): Promise<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }> {
  if (!options?.allowHiddenTools && HIDDEN_TOOL_NAMES.has(toolName)) {
    throw new Error(`tool ${toolName} is managed by gateway runtime and cannot be called directly`);
  }
  const server = servers.find((item) => item.id === serverId);
  if (!server) {
    throw new Error(`server not found: ${serverId}`);
  }
  const oauth = await oauthStore.get(userId, server.id);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (oauth?.accessToken) {
    headers.Authorization = `Bearer ${oauth.accessToken}`;
  }
  const endpoint = toMcpEndpoint(server.url);
  const argsJson = (() => {
    try {
      return JSON.stringify(args);
    } catch {
      return "[unserializable args]";
    }
  })();
  console.log(
    `[gateway:mcp] -> ${serverId} ${toolName} endpoint=${endpoint} args=${argsJson}`
  );
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });
  if (!res.ok) {
    console.error(
      `[gateway:mcp] <- ${serverId} ${toolName} status=${res.status} (http error)`
    );
    throw new Error(`tools/call failed: ${res.status}`);
  }
  const text = await res.text();
  let payload: JsonRpcToolCallResponse;
  try {
    payload = JSON.parse(text) as JsonRpcToolCallResponse;
  } catch {
    throw new Error(`Failed to parse JSON from ${endpoint}`);
  }
  if (payload.error) {
    console.error(
      `[gateway:mcp] <- ${serverId} ${toolName} rpc_error=${payload.error.message ?? "unknown"}`
    );
    throw new Error(payload.error.message ?? "tools/call failed");
  }
  const isError = payload.result?.isError === true;
  const contentCount = payload.result?.content?.length ?? 0;
  const errorTextSnippet = isError ? getErrorTextSnippet(payload.result?.content) : null;
  console.log(
    `[gateway:mcp] <- ${serverId} ${toolName} status=200 isError=${isError} contentItems=${contentCount}${errorTextSnippet ? ` error=${errorTextSnippet}` : ""}`
  );
  return payload.result ?? {};
}
