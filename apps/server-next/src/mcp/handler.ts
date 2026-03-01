/**
 * MCP (Model Context Protocol) handler for server-next.
 * POST /api/mcp with Bearer auth; uses same root-resolver, files, branches logic as REST.
 */
import type { Context } from "hono";
import type { Env } from "../types.ts";
import type { RootResolverDeps } from "../services/root-resolver.ts";
import {
  getCurrentRoot,
  resolvePath,
  getNodeDecoded,
} from "../services/root-resolver.ts";
import { hashToKey } from "@casfa/core";
import type { ServerConfig } from "../config.ts";
import type { Delegate } from "@casfa/realm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type McpRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
};

type McpResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const MCP_PARSE_ERROR = -32700;
const MCP_INVALID_REQUEST = -32600;
const MCP_METHOD_NOT_FOUND = -32601;
const MCP_INVALID_PARAMS = -32602;

function mcpSuccess(id: string | number, result: unknown): McpResponse {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): McpResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function getRealmId(auth: NonNullable<Env["Variables"]["auth"]>): string {
  if (auth.type === "user") return auth.userId;
  return auth.realmId;
}

function hasFileRead(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return auth.permissions.includes("file_read");
  return auth.access === "readwrite" || auth.access === "readonly";
}

function hasBranchManage(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return auth.permissions.includes("branch_manage");
  return false;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  {
    name: "branches_list",
    description: "List branches in the realm. For Worker auth returns only the current branch.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "branch_create",
    description:
      "Create a branch. Without parentBranchId creates under realm root (requires branch_manage). With parentBranchId creates sub-branch (Worker only, parent must be own branch).",
    inputSchema: {
      type: "object" as const,
      properties: {
        mountPath: { type: "string" as const, description: "Mount path for the branch" },
        ttl: { type: "number" as const, description: "Optional TTL in seconds" },
        parentBranchId: { type: "string" as const, description: "Optional parent branch (Worker only)" },
      },
      required: ["mountPath"] as string[],
    },
  },
  {
    name: "fs_ls",
    description: "List direct children of a directory at the given path.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "Directory path (empty for root)" },
      },
      required: [] as string[],
    },
  },
  {
    name: "fs_stat",
    description: "Get metadata (kind, size, contentType) for a file or directory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "Path to the entry" },
      },
      required: ["path"] as string[],
    },
  },
  {
    name: "fs_read",
    description: "Read text content of a file (single-block, ≤4MB).",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path" },
      },
      required: ["path"] as string[],
    },
  },
];

// ---------------------------------------------------------------------------
// Protocol handlers
// ---------------------------------------------------------------------------

function handleInitialize(id: string | number): McpResponse {
  return mcpSuccess(id, {
    protocolVersion: "2025-03-26",
    capabilities: {
      tools: {},
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    },
    serverInfo: { name: "casfa-server-next-mcp", version: "0.1.0" },
  });
}

function handleToolsList(id: string | number): McpResponse {
  return mcpSuccess(id, { tools: MCP_TOOLS });
}

async function handleToolsCall(
  id: string | number,
  name: string,
  args: Record<string, unknown>,
  auth: NonNullable<Env["Variables"]["auth"]>,
  deps: RootResolverDeps & { config: ServerConfig }
): Promise<McpResponse> {
  const pathStr = typeof args.path === "string" ? args.path.replace(/^\/+|\/+$/g, "") : "";

  try {
    if (name === "branches_list") {
      const realmId = getRealmId(auth);
      if (auth.type === "worker") {
        const delegate = await deps.delegateStore.getDelegate(auth.branchId);
        if (!delegate) {
          return mcpError(id, MCP_INVALID_PARAMS, "Branch not found");
        }
        return mcpSuccess(id, {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                branches: [
                  {
                    branchId: delegate.delegateId,
                    mountPath: delegate.mountPath,
                    parentId: delegate.parentId,
                    expiresAt: delegate.lifetime === "limited" ? delegate.expiresAt : undefined,
                  },
                ],
              }),
            },
          ],
        });
      }
      const delegates = await deps.delegateStore.listDelegates(realmId);
      const branches = delegates.map((d) => ({
        branchId: d.delegateId,
        mountPath: d.mountPath,
        parentId: d.parentId,
        expiresAt: d.lifetime === "limited" ? d.expiresAt : undefined,
      }));
      return mcpSuccess(id, {
        content: [{ type: "text" as const, text: JSON.stringify({ branches }) }],
      });
    }

    if (name === "branch_create") {
      const mountPath = typeof args.mountPath === "string" ? args.mountPath.trim().replace(/^\/+|\/+$/g, "") : "";
      if (!mountPath) {
        return mcpError(id, MCP_INVALID_PARAMS, "mountPath required");
      }
      const ttlSec = typeof args.ttl === "number" && args.ttl > 0 ? args.ttl : undefined;
      const ttlMs = ttlSec != null ? Math.min(ttlSec * 1000, deps.config.auth.maxBranchTtlMs ?? 3600_000) : undefined;
      const parentBranchId = typeof args.parentBranchId === "string" ? args.parentBranchId.trim() || undefined : undefined;
      const realmId = getRealmId(auth);

      if (!parentBranchId) {
        if (!hasBranchManage(auth)) {
          return mcpError(id, MCP_INVALID_PARAMS, "branch_manage or user required");
        }
        const rootFacade = await deps.realm.getRootDelegate(realmId, {});
        const childFacade = await rootFacade.createChildDelegate(mountPath, { ttl: ttlMs });
        return mcpSuccess(id, {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                branchId: childFacade.delegateId,
                accessToken: base64urlEncode(childFacade.delegateId),
                ...(childFacade.lifetime === "limited" && childFacade.expiresAt != null && { expiresAt: childFacade.expiresAt }),
              }),
            },
          ],
        });
      }

      if (auth.type !== "worker" || auth.branchId !== parentBranchId) {
        return mcpError(id, MCP_INVALID_PARAMS, "Must be worker of parent branch");
      }
      const parentDelegate = await deps.delegateStore.getDelegate(parentBranchId);
      if (!parentDelegate) {
        return mcpError(id, MCP_INVALID_PARAMS, "Parent branch not found");
      }
      const parentRootKey = await deps.delegateStore.getRoot(parentBranchId);
      if (parentRootKey === null) {
        return mcpError(id, MCP_INVALID_PARAMS, "Parent branch has no root");
      }
      const childRootKey = await resolvePath(deps.cas, parentRootKey, mountPath);
      if (childRootKey === null) {
        return mcpError(id, MCP_INVALID_PARAMS, "mountPath does not resolve under parent root");
      }
      const childId = crypto.randomUUID();
      const now = Date.now();
      const tokenStr = base64urlEncode(childId);
      const accessTokenHash = await sha256Hex(tokenStr);
      let childDelegate: Delegate;
      let expiresAt: number | undefined;
      if (ttlMs !== undefined && ttlMs > 0) {
        expiresAt = now + ttlMs;
        childDelegate = {
          lifetime: "limited",
          delegateId: childId,
          realmId: parentDelegate.realmId,
          parentId: parentBranchId,
          mountPath,
          accessTokenHash,
          expiresAt,
        };
      } else {
        const refreshHash = await sha256Hex(crypto.randomUUID());
        childDelegate = {
          lifetime: "unlimited",
          delegateId: childId,
          realmId: parentDelegate.realmId,
          parentId: parentBranchId,
          mountPath,
          accessTokenHash,
          refreshTokenHash: refreshHash,
          accessExpiresAt: now + 3600_000,
        };
      }
      await deps.delegateStore.insertDelegate(childDelegate);
      await deps.delegateStore.setRoot(childId, childRootKey);
      return mcpSuccess(id, {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              branchId: childId,
              accessToken: tokenStr,
              ...(expiresAt != null && { expiresAt }),
            }),
          },
        ],
      });
    }

    // fs_ls, fs_stat, fs_read
    if (!hasFileRead(auth)) {
      return mcpError(id, MCP_INVALID_PARAMS, "file_read required");
    }
    const rootKey = await getCurrentRoot(auth, deps);
    if (rootKey === null) {
      return mcpError(id, MCP_INVALID_PARAMS, "Realm or branch root not found");
    }
    const nodeKey = await resolvePath(deps.cas, rootKey, pathStr);
    if (nodeKey === null) {
      return mcpError(id, MCP_INVALID_PARAMS, "Path not found");
    }
    const node = await getNodeDecoded(deps.cas, nodeKey);
    if (!node) {
      return mcpError(id, MCP_INVALID_PARAMS, "Node not found");
    }

    if (name === "fs_ls") {
      if (node.kind !== "dict") {
        return mcpError(id, MCP_INVALID_PARAMS, "Not a directory");
      }
      const names = node.childNames ?? [];
      const children = node.children ?? [];
      const entries: { name: string; kind: "file" | "directory"; size?: number }[] = [];
      for (let i = 0; i < names.length; i++) {
        const childName = names[i]!;
        const childKey = hashToKey(children[i]!);
        const childNode = await getNodeDecoded(deps.cas, childKey);
        const kind = childNode?.kind === "file" ? "file" : "directory";
        const size = childNode?.kind === "file" ? childNode.fileInfo?.fileSize : undefined;
        entries.push({ name: childName, kind, ...(size !== undefined && { size }) });
      }
      return mcpSuccess(id, {
        content: [{ type: "text" as const, text: JSON.stringify({ entries }) }],
      });
    }

    if (name === "fs_stat") {
      if (node.kind === "file") {
        return mcpSuccess(id, {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                kind: "file",
                size: node.fileInfo?.fileSize ?? 0,
                contentType: node.fileInfo?.contentType ?? "application/octet-stream",
              }),
            },
          ],
        });
      }
      return mcpSuccess(id, {
        content: [{ type: "text" as const, text: JSON.stringify({ kind: "directory" }) }],
      });
    }

    if (name === "fs_read") {
      if (node.kind !== "file") {
        return mcpError(id, MCP_INVALID_PARAMS, "Not a file");
      }
      const data = node.data ?? new Uint8Array(0);
      const text = new TextDecoder().decode(data);
      return mcpSuccess(id, {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ content: text, contentType: node.fileInfo?.contentType ?? "application/octet-stream" }),
          },
        ],
      });
    }

    return mcpError(id, MCP_METHOD_NOT_FOUND, `Unknown tool: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool call failed";
    return mcpError(id, MCP_INVALID_PARAMS, message);
  }
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export type McpHandlerDeps = RootResolverDeps & { config: ServerConfig };

export function createMcpHandler(deps: McpHandlerDeps) {
  return async (c: Context<Env>) => {
    const auth = c.get("auth");
    if (!auth) {
      return c.json(mcpError(0, MCP_INVALID_REQUEST, "Auth required"), 401);
    }

    let request: McpRequest;
    try {
      request = await c.req.json();
    } catch {
      return c.json(mcpError(0, MCP_PARSE_ERROR, "Parse error"), 400);
    }

    if (request.jsonrpc !== "2.0" || !request.method) {
      return c.json(
        mcpError(request.id ?? 0, MCP_INVALID_REQUEST, "Invalid request"),
        400
      );
    }

    let response: McpResponse;

    switch (request.method) {
      case "initialize":
        response = handleInitialize(request.id);
        break;
      case "tools/list":
        response = handleToolsList(request.id);
        break;
      case "tools/call": {
        const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
        const name = params?.name;
        const args = params?.arguments ?? {};
        if (typeof name !== "string" || !name) {
          response = mcpError(request.id, MCP_INVALID_PARAMS, "tools/call requires name");
        } else {
          response = await handleToolsCall(request.id, name, args, auth, deps);
        }
        break;
      }
      default:
        response = mcpError(request.id, MCP_METHOD_NOT_FOUND, `Method not found: ${request.method}`);
    }

    return c.json(response, 200);
  };
}
