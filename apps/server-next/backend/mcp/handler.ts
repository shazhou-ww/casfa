/**
 * MCP (Model Context Protocol) handler for server-next.
 * POST /api/mcp with Bearer auth; uses same root-resolver, files, branches logic as REST.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { streamFromBytes } from "@casfa/cas";
import { encodeDictNode, encodeFileNode, hashToKey } from "@casfa/core";
import type { Context } from "hono";
import type { ServerConfig } from "../config.ts";
import { completeBranch } from "../services/branch-complete.ts";
import type { RootResolverDeps } from "../services/root-resolver.ts";
import {
  ensureEmptyRoot,
  getCurrentRoot,
  getEffectiveDelegateId,
  getNodeDecoded,
  resolvePath,
} from "../services/root-resolver.ts";
import { addOrReplaceAtPath, removeEntryAtPath } from "../services/tree-mutations.ts";
import type { Env } from "../types.ts";
import { prependUtf8BomIfText } from "../utils/utf8-bom.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const skillContent = readFileSync(
  resolve(__dirname, "skills", "casfa-file-management.md"),
  "utf-8"
);

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

function mcpError(id: string | number, code: number, message: string, data?: unknown): McpResponse {
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

function hasFileWrite(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return auth.permissions.includes("file_write");
  return auth.access === "readwrite";
}

/** Root for write tools; worker NUL -> create empty root first. */
async function getRootForMcpWrite(
  auth: NonNullable<Env["Variables"]["auth"]>,
  deps: McpHandlerDeps
): Promise<{ rootKey: string } | { error: string }> {
  if (auth.type === "worker") {
    const branch = await deps.branchStore.getBranch(auth.branchId);
    if (!branch) return { error: "Branch not found" };
    let rootKey = await getCurrentRoot(auth, deps);
    if (rootKey === null) {
      const emptyRootKey = await ensureEmptyRoot(deps.cas, deps.key);
      await deps.branchStore.setBranchRoot(auth.branchId, emptyRootKey);
      rootKey = emptyRootKey;
    }
    return { rootKey };
  }
  if (auth.type === "user" || auth.type === "delegate") {
    const realmId = getRealmId(auth);
    const emptyKey = await ensureEmptyRoot(deps.cas, deps.key);
    await deps.branchStore.ensureRealmRoot(realmId, emptyKey);
  }
  const rootKey = await getCurrentRoot(auth, deps);
  if (rootKey === null)
    return { error: "Realm not initialized. Open your profile or realm first." };
  return { rootKey };
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
      "Create a branch. Without parentBranchId creates under realm root (requires branch_manage). With parentBranchId creates sub-branch (Worker only, parent must be own branch). Returns branchId, accessToken, expiresAt; when CELL_BASE_URL is configured also returns baseUrl for use as casfaBaseUrl in image-workshop flux_image.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mountPath: { type: "string" as const, description: "Mount path for the branch" },
        ttl: { type: "number" as const, description: "Optional TTL in seconds" },
        parentBranchId: {
          type: "string" as const,
          description: "Optional parent branch (Worker only)",
        },
      },
      required: ["mountPath"] as string[],
    },
  },
  {
    name: "branch_complete",
    description:
      "Complete the current branch (Worker only): merge into parent and invalidate this branch.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "fs_mkdir",
    description:
      "Create a directory at the given path. Parent path must exist. Required for creating a path before branch_create (e.g. create 'images' then create branch with mountPath 'images').",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description: "Directory path to create (e.g. 'images' or 'output/generated')",
        },
      },
      required: ["path"] as string[],
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
  {
    name: "fs_rm",
    description: "Remove a file or directory at the given path. Requires file_write.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "Path to remove" },
      },
      required: ["path"] as string[],
    },
  },
  {
    name: "fs_mv",
    description: "Move or rename a file or directory. Requires file_write.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from: { type: "string" as const, description: "Source path" },
        to: { type: "string" as const, description: "Destination path" },
      },
      required: ["from", "to"] as string[],
    },
  },
  {
    name: "fs_cp",
    description: "Copy a file or directory to a new path. Requires file_write.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from: { type: "string" as const, description: "Source path" },
        to: { type: "string" as const, description: "Destination path" },
      },
      required: ["from", "to"] as string[],
    },
  },
  {
    name: "fs_write",
    description:
      "Write a text file at the given path (UTF-8). Creates or overwrites. Single file ≤4MB. Text content only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path including file name" },
        content: { type: "string" as const, description: "Text content (UTF-8)" },
        contentType: {
          type: "string" as const,
          description: "Optional; default text/plain (e.g. text/markdown, application/json)",
        },
      },
      required: ["path", "content"] as string[],
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

const MCP_RESOURCES = [
  {
    uri: "skill://casfa-file-management",
    name: "Casfa File Management",
    description: "Skill definition for branch-based file management",
    mimeType: "text/markdown",
  },
];

function handleResourcesList(id: string | number): McpResponse {
  return mcpSuccess(id, { resources: MCP_RESOURCES });
}

function handleResourcesRead(id: string | number, uri: string): McpResponse {
  if (uri === "skill://casfa-file-management") {
    return mcpSuccess(id, {
      contents: [
        {
          uri: "skill://casfa-file-management",
          mimeType: "text/markdown",
          text: skillContent,
        },
      ],
    });
  }
  return mcpError(id, MCP_INVALID_PARAMS, `Resource not found: ${uri}`);
}

async function handleToolsCall(
  id: string | number,
  name: string,
  args: Record<string, unknown>,
  auth: NonNullable<Env["Variables"]["auth"]>,
  deps: RootResolverDeps & { config: ServerConfig }
): Promise<McpResponse> {
  const _pathStr = typeof args.path === "string" ? args.path.replace(/^\/+|\/+$/g, "") : "";

  try {
    if (name === "branches_list") {
      const realmId = getRealmId(auth);
      if (auth.type === "worker") {
        const branch = await deps.branchStore.getBranch(auth.branchId);
        if (!branch) {
          return mcpError(id, MCP_INVALID_PARAMS, "Branch not found");
        }
        return mcpSuccess(id, {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                branches: [
                  {
                    branchId: branch.branchId,
                    mountPath: branch.mountPath,
                    parentId: branch.parentId,
                    expiresAt: branch.expiresAt,
                  },
                ],
              }),
            },
          ],
        });
      }
      const branches = await deps.branchStore.listBranches(realmId);
      return mcpSuccess(id, {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              branches: branches.map((b) => ({
                branchId: b.branchId,
                mountPath: b.mountPath,
                parentId: b.parentId,
                expiresAt: b.expiresAt,
              })),
            }),
          },
        ],
      });
    }

    if (name === "branch_create") {
      const mountPath =
        typeof args.mountPath === "string" ? args.mountPath.trim().replace(/^\/+|\/+$/g, "") : "";
      if (!mountPath) {
        return mcpError(id, MCP_INVALID_PARAMS, "mountPath required");
      }
      const ttlSec = typeof args.ttl === "number" && args.ttl > 0 ? args.ttl : undefined;
      const ttlMs =
        ttlSec != null
          ? Math.min(ttlSec * 1000, deps.config.auth.maxBranchTtlMs ?? 3600_000)
          : 3600_000;
      const parentBranchId =
        typeof args.parentBranchId === "string"
          ? args.parentBranchId.trim() || undefined
          : undefined;
      const realmId = getRealmId(auth);

      if (!parentBranchId) {
        if (!hasBranchManage(auth)) {
          return mcpError(id, MCP_INVALID_PARAMS, "branch_manage or user required");
        }
        if (auth.type === "user" || auth.type === "delegate") {
          const emptyKey = await ensureEmptyRoot(deps.cas, deps.key);
          await deps.branchStore.ensureRealmRoot(realmId, emptyKey);
        }
        const rootKey = await deps.branchStore.getRealmRoot(realmId);
        if (rootKey === null) {
          return mcpError(
            id,
            MCP_INVALID_PARAMS,
            "Realm not initialized. Open profile or realm first."
          );
        }
        const rootRecord = await deps.branchStore.getRealmRootRecord(realmId);
        if (!rootRecord) return mcpError(id, MCP_INVALID_PARAMS, "Realm root not found");
        const childRootKey = await resolvePath(deps.cas, rootKey, mountPath);
        const branchId = crypto.randomUUID();
        const now = Date.now();
        const expiresAt = now + ttlMs;
        await deps.branchStore.insertBranch({
          branchId,
          realmId,
          parentId: rootRecord.branchId,
          mountPath,
          expiresAt,
        });
        if (childRootKey !== null) {
          await deps.branchStore.setBranchRoot(branchId, childRootKey);
        }
        return mcpSuccess(id, {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                branchId,
                accessToken: base64urlEncode(branchId),
                expiresAt,
                ...(deps.config.baseUrl && { baseUrl: deps.config.baseUrl }),
              }),
            },
          ],
        });
      }

      if (auth.type !== "worker" || auth.branchId !== parentBranchId) {
        return mcpError(id, MCP_INVALID_PARAMS, "Must be worker of parent branch");
      }
      const parentBranch = await deps.branchStore.getBranch(parentBranchId);
      if (!parentBranch) {
        return mcpError(id, MCP_INVALID_PARAMS, "Parent branch not found");
      }
      const parentRootKey = await deps.branchStore.getBranchRoot(parentBranchId);
      if (parentRootKey === null) {
        return mcpError(id, MCP_INVALID_PARAMS, "Parent branch has no root");
      }
      const childRootKey = await resolvePath(deps.cas, parentRootKey, mountPath);
      if (childRootKey === null) {
        return mcpError(id, MCP_INVALID_PARAMS, "mountPath does not resolve under parent root");
      }
      const childId = crypto.randomUUID();
      const now = Date.now();
      const expiresAt = now + ttlMs;
      await deps.branchStore.insertBranch({
        branchId: childId,
        realmId: parentBranch.realmId,
        parentId: parentBranchId,
        mountPath,
        expiresAt,
      });
      await deps.branchStore.setBranchRoot(childId, childRootKey);
      return mcpSuccess(id, {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              branchId: childId,
              accessToken: base64urlEncode(childId),
              expiresAt,
              ...(deps.config.baseUrl && { baseUrl: deps.config.baseUrl }),
            }),
          },
        ],
      });
    }

    if (name === "branch_complete") {
      if (auth.type !== "worker") {
        return mcpError(id, MCP_INVALID_PARAMS, "Only Worker can complete a branch");
      }
      try {
        const result = await completeBranch(auth.branchId, deps);
        return mcpSuccess(id, {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return mcpError(id, MCP_INVALID_PARAMS, message);
      }
    }

    if (name === "fs_mkdir") {
      if (!hasFileWrite(auth)) {
        return mcpError(id, MCP_INVALID_PARAMS, "file_write required");
      }
      const pathStr =
        typeof args.path === "string"
          ? String(args.path)
              .trim()
              .replace(/^\/+|\/+$/g, "")
          : "";
      if (!pathStr) {
        return mcpError(id, MCP_INVALID_PARAMS, "path required");
      }
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return mcpError(id, MCP_INVALID_PARAMS, rootResult.error);
      }
      const rootKey = rootResult.rootKey;
      try {
        const realmId = getRealmId(auth);
        const onNodePut = deps.recordNewKey
          ? (k: string) => deps.recordNewKey!(realmId, k)
          : undefined;
        const emptyDict = await encodeDictNode({ children: [], childNames: [] }, deps.key);
        const emptyDictKey = hashToKey(emptyDict.hash);
        await deps.cas.putNode(emptyDictKey, streamFromBytes(emptyDict.bytes));
        deps.recordNewKey?.(realmId, emptyDictKey);
        const newRootKey = await addOrReplaceAtPath(
          deps.cas,
          deps.key,
          rootKey,
          pathStr,
          emptyDictKey,
          onNodePut
        );
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.branchStore.setBranchRoot(delegateId, newRootKey);
        return mcpSuccess(id, {
          content: [{ type: "text" as const, text: JSON.stringify({ path: pathStr }) }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "mkdir failed";
        if (
          message.includes("must not contain") ||
          message.includes("Parent path not found") ||
          message.includes("Not a dict")
        ) {
          return mcpError(id, MCP_INVALID_PARAMS, message);
        }
        throw err;
      }
    }

    if (name === "fs_rm") {
      if (!hasFileWrite(auth)) {
        return mcpError(id, MCP_INVALID_PARAMS, "file_write required");
      }
      const pathStr =
        typeof args.path === "string"
          ? String(args.path)
              .trim()
              .replace(/^\/+|\/+$/g, "")
          : "";
      if (!pathStr) {
        return mcpError(id, MCP_INVALID_PARAMS, "path required");
      }
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return mcpError(id, MCP_INVALID_PARAMS, rootResult.error);
      }
      const rootKey = rootResult.rootKey;
      try {
        const realmId = getRealmId(auth);
        const onNodePut = deps.recordNewKey
          ? (k: string) => deps.recordNewKey!(realmId, k)
          : undefined;
        const newRootKey = await removeEntryAtPath(deps.cas, deps.key, rootKey, pathStr, onNodePut);
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.branchStore.setBranchRoot(delegateId, newRootKey);
        return mcpSuccess(id, {
          content: [{ type: "text" as const, text: JSON.stringify({ path: pathStr }) }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "fs_rm failed";
        if (
          message.includes("must not contain") ||
          message.includes("not found") ||
          message.includes("Parent path")
        ) {
          return mcpError(id, MCP_INVALID_PARAMS, message);
        }
        throw err;
      }
    }

    if (name === "fs_mv") {
      if (!hasFileWrite(auth)) {
        return mcpError(id, MCP_INVALID_PARAMS, "file_write required");
      }
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return mcpError(id, MCP_INVALID_PARAMS, rootResult.error);
      }
      const rootKey = rootResult.rootKey;
      const fromStr =
        typeof args.from === "string"
          ? String(args.from)
              .trim()
              .replace(/^\/+|\/+$/g, "")
          : "";
      const toStr =
        typeof args.to === "string"
          ? String(args.to)
              .trim()
              .replace(/^\/+|\/+$/g, "")
          : "";
      if (!fromStr || !toStr) {
        return mcpError(id, MCP_INVALID_PARAMS, "from and to required");
      }
      try {
        const nodeKey = await resolvePath(deps.cas, rootKey, fromStr);
        if (nodeKey === null) {
          return mcpError(id, MCP_INVALID_PARAMS, "from path not found");
        }
        const realmId = getRealmId(auth);
        const onNodePut = deps.recordNewKey
          ? (k: string) => deps.recordNewKey!(realmId, k)
          : undefined;
        let newRootKey = await removeEntryAtPath(deps.cas, deps.key, rootKey, fromStr, onNodePut);
        newRootKey = await addOrReplaceAtPath(
          deps.cas,
          deps.key,
          newRootKey,
          toStr,
          nodeKey,
          onNodePut
        );
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.branchStore.setBranchRoot(delegateId, newRootKey);
        return mcpSuccess(id, {
          content: [{ type: "text" as const, text: JSON.stringify({ from: fromStr, to: toStr }) }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "fs_mv failed";
        if (
          message.includes("must not contain") ||
          message.includes("Parent path not found") ||
          message.includes("Not a dict")
        ) {
          return mcpError(id, MCP_INVALID_PARAMS, message);
        }
        throw err;
      }
    }

    if (name === "fs_cp") {
      if (!hasFileWrite(auth)) {
        return mcpError(id, MCP_INVALID_PARAMS, "file_write required");
      }
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return mcpError(id, MCP_INVALID_PARAMS, rootResult.error);
      }
      const rootKey = rootResult.rootKey;
      const fromStr =
        typeof args.from === "string"
          ? String(args.from)
              .trim()
              .replace(/^\/+|\/+$/g, "")
          : "";
      const toStr =
        typeof args.to === "string"
          ? String(args.to)
              .trim()
              .replace(/^\/+|\/+$/g, "")
          : "";
      if (!fromStr || !toStr) {
        return mcpError(id, MCP_INVALID_PARAMS, "from and to required");
      }
      try {
        const nodeKey = await resolvePath(deps.cas, rootKey, fromStr);
        if (nodeKey === null) {
          return mcpError(id, MCP_INVALID_PARAMS, "from path not found");
        }
        const realmId = getRealmId(auth);
        const onNodePut = deps.recordNewKey
          ? (k: string) => deps.recordNewKey!(realmId, k)
          : undefined;
        const newRootKey = await addOrReplaceAtPath(
          deps.cas,
          deps.key,
          rootKey,
          toStr,
          nodeKey,
          onNodePut
        );
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.branchStore.setBranchRoot(delegateId, newRootKey);
        return mcpSuccess(id, {
          content: [{ type: "text" as const, text: JSON.stringify({ from: fromStr, to: toStr }) }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "fs_cp failed";
        if (
          message.includes("must not contain") ||
          message.includes("Parent path not found") ||
          message.includes("Not a dict")
        ) {
          return mcpError(id, MCP_INVALID_PARAMS, message);
        }
        throw err;
      }
    }

    if (name === "fs_write") {
      if (!hasFileWrite(auth)) {
        return mcpError(id, MCP_INVALID_PARAMS, "file_write required");
      }
      const pathStr =
        typeof args.path === "string"
          ? String(args.path)
              .trim()
              .replace(/^\/+|\/+$/g, "")
          : "";
      if (!pathStr) {
        return mcpError(id, MCP_INVALID_PARAMS, "path required");
      }
      const content = typeof args.content === "string" ? args.content : "";
      const contentType =
        typeof args.contentType === "string"
          ? args.contentType.split(";")[0]?.trim().slice(0, 256) || "text/plain"
          : "text/plain";
      const bytes = new TextEncoder().encode(content);
      const data = prependUtf8BomIfText(contentType, bytes);
      const MAX_BYTES = 4 * 1024 * 1024;
      if (data.length > MAX_BYTES) {
        return mcpError(id, MCP_INVALID_PARAMS, `Content too large (max ${MAX_BYTES} bytes)`);
      }
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return mcpError(id, MCP_INVALID_PARAMS, rootResult.error);
      }
      const rootKey = rootResult.rootKey;
      try {
        const realmId = getRealmId(auth);
        const encoded = await encodeFileNode(
          { data, fileSize: data.length, contentType },
          deps.key
        );
        const fileNodeKey = hashToKey(encoded.hash);
        await deps.cas.putNode(fileNodeKey, streamFromBytes(encoded.bytes));
        deps.recordNewKey?.(realmId, fileNodeKey);
        const onNodePut = deps.recordNewKey
          ? (k: string) => deps.recordNewKey!(realmId, k)
          : undefined;
        const newRootKey = await addOrReplaceAtPath(
          deps.cas,
          deps.key,
          rootKey,
          pathStr,
          fileNodeKey,
          onNodePut
        );
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.branchStore.setBranchRoot(delegateId, newRootKey);
        return mcpSuccess(id, {
          content: [{ type: "text" as const, text: JSON.stringify({ path: pathStr }) }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "fs_write failed";
        if (
          message.includes("must not contain") ||
          message.includes("Path must not be empty") ||
          message.includes("Parent path not found") ||
          message.includes("Not a dict")
        ) {
          return mcpError(id, MCP_INVALID_PARAMS, message);
        }
        throw err;
      }
    }

    // fs_ls, fs_stat, fs_read
    if (!hasFileRead(auth)) {
      return mcpError(id, MCP_INVALID_PARAMS, "file_read required");
    }
    if (auth.type === "user" || auth.type === "delegate") {
      const realmId = getRealmId(auth);
      const emptyKey = await ensureEmptyRoot(deps.cas, deps.key);
      await deps.branchStore.ensureRealmRoot(realmId, emptyKey);
    }
    const pathStr =
      typeof args.path === "string"
        ? String(args.path)
            .trim()
            .replace(/^\/+|\/+$/g, "")
        : "";
    const rootKey = await getCurrentRoot(auth, deps);
    if (rootKey === null) {
      if (auth.type === "worker") {
        if (pathStr !== "") return mcpError(id, MCP_INVALID_PARAMS, "Path not found");
        if (name === "fs_ls") {
          return mcpSuccess(id, {
            content: [{ type: "text" as const, text: JSON.stringify({ entries: [] }) }],
          });
        }
        if (name === "fs_stat") {
          return mcpSuccess(id, {
            content: [{ type: "text" as const, text: JSON.stringify({ kind: "directory" }) }],
          });
        }
        return mcpError(id, MCP_INVALID_PARAMS, "Path not found");
      }
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
            text: JSON.stringify({
              content: text,
              contentType: node.fileInfo?.contentType ?? "application/octet-stream",
            }),
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

async function _sha256Hex(text: string): Promise<string> {
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
      return c.json(mcpError(request.id ?? 0, MCP_INVALID_REQUEST, "Invalid request"), 400);
    }

    let response: McpResponse;

    switch (request.method) {
      case "initialize":
        response = handleInitialize(request.id);
        break;
      case "tools/list":
        response = handleToolsList(request.id);
        break;
      case "resources/list":
        response = handleResourcesList(request.id);
        break;
      case "resources/read": {
        const params = request.params as { uri?: string } | undefined;
        const uri = params?.uri;
        if (typeof uri !== "string" || !uri) {
          response = mcpError(request.id, MCP_INVALID_PARAMS, "resources/read requires uri");
        } else {
          response = handleResourcesRead(request.id, uri);
        }
        break;
      }
      case "tools/call": {
        const params = request.params as
          | { name?: string; arguments?: Record<string, unknown> }
          | undefined;
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
        response = mcpError(
          request.id,
          MCP_METHOD_NOT_FOUND,
          `Method not found: ${request.method}`
        );
    }

    return c.json(response, 200);
  };
}
