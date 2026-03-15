import { createCellMcpServer } from "@casfa/cell-mcp";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerRegistry } from "./services/server-registry.ts";
import type { ServerOAuthStateStore } from "./services/server-oauth-state.ts";
import { getBindingForServer } from "./services/tool-binding-registry.ts";
import { callToolForServer, getToolsForServers } from "./services/tool-discovery.ts";
import type { Env } from "./types.ts";

function authCheck(c: Context<Env>): boolean {
  const auth = c.get("auth");
  if (!auth) return false;
  if (auth.type === "user") return true;
  return auth.permissions.includes("use_mcp");
}

function onUnauthorized(c: Context<Env>): Response {
  const auth = c.get("auth");
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ error: "Forbidden", message: "use_mcp required" }, 403);
}

export function createGatewayMcpRoutes(deps: {
  serverRegistry: ServerRegistry;
  oauthStateStore: ServerOAuthStateStore;
}) {
  const routes = new Hono<Env>();
  function allocateServerId(): string {
    return `srv_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  const mcp = createCellMcpServer({
    name: "gateway",
    version: "0.1.0",
    authCheck,
    onUnauthorized,
  });

  async function getParentBranchIdFromBranchUrl(branchUrl: string): Promise<string> {
    const base = branchUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/api/realm/me/branches`);
    if (!res.ok) {
      throw new Error(`failed to query branch parent: ${res.status}`);
    }
    const payload = (await res.json()) as {
      branches?: Array<{ branchId?: string; parentId?: string | null }>;
    };
    const branch = payload.branches?.[0];
    if (!branch || typeof branch.parentId !== "string" || !branch.parentId.trim()) {
      throw new Error("failed to resolve parent branch id from runtime branch url");
    }
    return branch.parentId.trim();
  }

  mcp.registerTool(
    "list_servers",
    {
      description: "List MCP servers registered by current user.",
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      const auth = ctx.auth;
      if (!auth) throw new Error("Unauthorized");
      const userId = auth.type === "user" ? auth.userId : auth.realmId;
      const servers = await deps.serverRegistry.list(userId);
      return {
        content: [{ type: "text", text: JSON.stringify({ servers }, null, 2) }],
      };
    }
  );

  mcp.registerTool(
    "search_servers",
    {
      description: "Search MCP servers by id/name/url.",
      inputSchema: z.object({ query: z.string().optional() }),
    },
    async (args, ctx) => {
      const auth = ctx.auth;
      if (!auth) throw new Error("Unauthorized");
      const userId = auth.type === "user" ? auth.userId : auth.realmId;
      const query = typeof args.query === "string" ? args.query : "";
      const servers = await deps.serverRegistry.search(userId, query);
      return {
        content: [{ type: "text", text: JSON.stringify({ servers }, null, 2) }],
      };
    }
  );

  mcp.registerTool(
    "add_server",
    {
      description: "Register an MCP server for current user.",
      inputSchema: z.object({
        name: z.string(),
        url: z.string().url(),
      }),
    },
    async (args, ctx) => {
      const auth = ctx.auth;
      if (!auth) throw new Error("Unauthorized");
      const userId = auth.type === "user" ? auth.userId : auth.realmId;
      const id = allocateServerId();
      await deps.serverRegistry.add(userId, {
        id,
        name: args.name.trim(),
        url: args.url.trim(),
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ added: id }, null, 2) }],
      };
    }
  );

  mcp.registerTool(
    "remove_server",
    {
      description: "Remove an MCP server and related OAuth state.",
      inputSchema: z.object({ serverId: z.string() }),
    },
    async (args, ctx) => {
      const auth = ctx.auth;
      if (!auth) throw new Error("Unauthorized");
      const userId = auth.type === "user" ? auth.userId : auth.realmId;
      const serverId = args.serverId.trim();
      const removed = await deps.serverRegistry.remove(userId, serverId);
      await deps.oauthStateStore.remove(userId, serverId);
      return {
        content: [{ type: "text", text: JSON.stringify({ removed, serverId }, null, 2) }],
      };
    }
  );

  mcp.registerTool(
    "get_tools",
    {
      description: "Fetch tools from selected registered MCP servers.",
      inputSchema: z.object({ serverIds: z.array(z.string()).min(1) }),
    },
    async (args, ctx) => {
      const auth = ctx.auth;
      if (!auth) throw new Error("Unauthorized");
      const userId = auth.type === "user" ? auth.userId : auth.realmId;
      const serverIds = [...new Set(args.serverIds.map((id) => id.trim()).filter(Boolean))];
      const servers = (
        await Promise.all(serverIds.map((id) => deps.serverRegistry.get(userId, id)))
      ).filter((s): s is NonNullable<typeof s> => s !== null);
      const results = await getToolsForServers(userId, servers, deps.oauthStateStore);
      return {
        content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
      };
    }
  );

  mcp.registerTool(
    "load_tools",
    {
      description: "Resolve final loaded tool ids for agent side wiring.",
      inputSchema: z.object({
        tools: z.array(z.object({ serverId: z.string(), toolName: z.string() })).min(1),
      }),
    },
    async (args, ctx) => {
      const auth = ctx.auth;
      if (!auth) throw new Error("Unauthorized");
      const userId = auth.type === "user" ? auth.userId : auth.realmId;
      const results = [];
      for (const item of args.tools) {
        const serverId = item.serverId.trim();
        const toolName = item.toolName.trim();
        const server = await deps.serverRegistry.get(userId, serverId);
        if (!server) throw new Error(`server not found: ${serverId}`);
        results.push({
          serverId,
          toolName,
          loadedToolName: `mcp__${serverId}__${toolName}`,
        });
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
      };
    }
  );

  mcp.registerTool(
    "call_tool",
    {
      description: "Call a tool on a registered MCP server.",
      inputSchema: z.object({
        serverId: z.string(),
        toolName: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    async (args, ctx) => {
      const auth = ctx.auth;
      if (!auth) throw new Error("Unauthorized");
      const userId = auth.type === "user" ? auth.userId : auth.realmId;
      const serverId = args.serverId.trim();
      const toolName = args.toolName.trim();
      const server = await deps.serverRegistry.get(userId, serverId);
      if (!server) throw new Error(`server not found: ${serverId}`);
      const originalArgs = (args.args as Record<string, unknown> | undefined) ?? {};
      const binding = getBindingForServer(server, toolName);
      if (!binding) {
        const result = await callToolForServer(
          userId,
          serverId,
          toolName,
          originalArgs,
          [server],
          deps.oauthStateStore
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      const allServers = await deps.serverRegistry.list(userId);
      const driveServer = allServers.find((item) => {
        const id = item.id.toLowerCase();
        const name = item.name.toLowerCase();
        const url = item.url.toLowerCase();
        return id.includes("drive") || name.includes("drive") || url.includes("/drive/") || url.includes("drive.");
      });
      if (!driveServer) {
        throw new Error("drive server not found for gateway runtime binding");
      }

      function dirname(path: string): string {
        const normalized = path.trim().replace(/^\/+|\/+$/g, "");
        if (!normalized) return "";
        const idx = normalized.lastIndexOf("/");
        return idx <= 0 ? "" : normalized.slice(0, idx);
      }

      function basename(path: string): string {
        const normalized = path.trim().replace(/^\/+|\/+$/g, "");
        if (!normalized) return "";
        const idx = normalized.lastIndexOf("/");
        return idx < 0 ? normalized : normalized.slice(idx + 1);
      }

      const outputArgName = binding.outputs[0] ?? "";
      const requestedOutputPath =
        outputArgName && typeof originalArgs[outputArgName] === "string"
          ? String(originalArgs[outputArgName]).trim().replace(/^\/+|\/+$/g, "")
          : "";
      const inputArgName = binding.inputs[0] ?? "";
      const inputPath =
        inputArgName && typeof originalArgs[inputArgName] === "string"
          ? String(originalArgs[inputArgName]).trim().replace(/^\/+|\/+$/g, "")
          : "";

      const mountPath =
        dirname(inputPath) || dirname(requestedOutputPath) || `gateway_runtime/${crypto.randomUUID().slice(0, 8)}`;

      const createBranchResult = await callToolForServer(
        userId,
        driveServer.id,
        "create_branch",
        { mountPath },
        [driveServer],
        deps.oauthStateStore,
        { allowHiddenTools: true }
      );
      const createText = createBranchResult.content?.find((item) => item.type === "text")?.text ?? "{}";
      const createParsed = JSON.parse(createText) as { branchId?: string; accessUrlPrefix?: string };
      const branchUrl = typeof createParsed.accessUrlPrefix === "string" ? createParsed.accessUrlPrefix : "";
      const branchId = typeof createParsed.branchId === "string" ? createParsed.branchId : "";
      if (!branchUrl) throw new Error("runtime create_branch returned no accessUrlPrefix");
      const parentBranchId = await getParentBranchIdFromBranchUrl(branchUrl);

      const runtimeArgs: Record<string, unknown> = { ...originalArgs, [binding.branchUrl]: branchUrl };

      if (inputArgName && inputPath) {
        if (inputPath.startsWith(`${mountPath}/`)) {
          runtimeArgs[inputArgName] = inputPath.slice(mountPath.length + 1);
        } else {
          runtimeArgs[inputArgName] = basename(inputPath);
        }
      }

      let runtimeOutputPath = requestedOutputPath;
      if (outputArgName && requestedOutputPath) {
        if (requestedOutputPath.startsWith(`${mountPath}/`)) {
          runtimeOutputPath = requestedOutputPath.slice(mountPath.length + 1);
        } else {
          runtimeOutputPath = basename(requestedOutputPath) || requestedOutputPath;
        }
        runtimeArgs[outputArgName] = runtimeOutputPath;
      }

      const rawResult = await callToolForServer(
        userId,
        serverId,
        toolName,
        runtimeArgs,
        [server],
        deps.oauthStateStore
      );

      if (requestedOutputPath && runtimeOutputPath && branchId && parentBranchId) {
        await callToolForServer(
          userId,
          driveServer.id,
          "transfer_paths",
          {
            source: branchId,
            target: parentBranchId,
            mapping: {
              [runtimeOutputPath]: requestedOutputPath,
            },
            mode: "replace",
          },
          [driveServer],
          deps.oauthStateStore,
          { allowHiddenTools: true }
        );
      }

      if (branchId) {
        await callToolForServer(
          userId,
          driveServer.id,
          "close_branch",
          { branchId },
          [driveServer],
          deps.oauthStateStore,
          { allowHiddenTools: true }
        ).catch(() => undefined);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(rawResult, null, 2) }],
      };
    }
  );

  routes.route("/", mcp.getRoute());
  routes.get("/mcp", (c) =>
    c.json({ error: "METHOD_NOT_ALLOWED", message: "SSE not supported. Use POST for JSON-RPC only." }, 405)
  );
  return routes;
}
