/**
 * MCP (Model Context Protocol) handler for drive.
 * POST /mcp with Bearer auth; uses same root-resolver, files, branches logic as REST.
 */

import type { ToolResult } from "@casfa/cell-mcp";
import { streamFromBytes } from "@casfa/cas";
import { encodeDictNode, encodeFileNode, hashToKey } from "@casfa/core";
import type { Context } from "hono";
import type { ServerConfig } from "../config.ts";
import type { RootResolverDeps } from "../services/root-resolver.ts";
import {
  ensureEmptyRoot,
  getCurrentRoot,
  getEffectiveDelegateId,
  getNodeDecoded,
  resolvePath,
} from "../services/root-resolver.ts";
import { ensurePathThenAddOrReplace, removeEntryAtPath } from "../services/tree-mutations.ts";
import { validateTransferSpec } from "../services/transfer-paths.ts";
import { executeTransfer } from "../services/transfer-paths.ts";
import {
  applyPathTemplate,
  resolvePathPatternMatches,
  type PatternMode,
  type PathPatternMatch,
} from "../services/fs-patterns.ts";
import type { Env } from "../types.ts";
import type { TransferSpec } from "../types/transfer.ts";
import { encodeCrockfordBase32 } from "../utils/crockford-base32.ts";
import { prependUtf8BomIfText } from "../utils/utf8-bom.ts";
import skillContent from "./skills/casfa-file-management.md";

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

function normalizeRelativePath(rawPath: string): string {
  const normalized = rawPath.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) throw new Error("E_PATH_INVALID: path must not be empty");
  return normalized;
}

function parsePatternMode(rawMode: unknown): PatternMode {
  if (rawMode === undefined || rawMode === null || rawMode === "") return "glob";
  if (rawMode === "glob" || rawMode === "regex") return rawMode;
  throw new Error("E_INVALID_PATTERN: mode must be glob or regex");
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

type FsBatchSummary = {
  moved: number;
  copied: number;
  deleted: number;
  created: number;
  overwritten: number;
  noMatch: number;
};

function createEmptyFsBatchSummary(): FsBatchSummary {
  return {
    moved: 0,
    copied: 0,
    deleted: 0,
    created: 0,
    overwritten: 0,
    noMatch: 0,
  };
}

type Tombstone = { path: string; key: string };

async function collectPatternMatches(
  deps: McpHandlerDeps,
  rootKey: string,
  patterns: string[],
  mode: PatternMode
): Promise<{ matches: PathPatternMatch[]; noMatch: number }> {
  const all: PathPatternMatch[] = [];
  let noMatch = 0;
  for (const pattern of patterns) {
    const normalizedPattern = normalizeRelativePath(pattern);
    const resolved = await resolvePathPatternMatches(deps.cas, rootKey, normalizedPattern, mode);
    if (resolved.length === 0) {
      noMatch += 1;
      continue;
    }
    all.push(...resolved);
  }
  const deduped = new Map<string, PathPatternMatch>();
  for (const item of all) {
    deduped.set(item.path, item);
  }
  return { matches: [...deduped.values()], noMatch };
}

async function applyMkdirPaths(
  auth: NonNullable<Env["Variables"]["auth"]>,
  deps: McpHandlerDeps,
  rootKey: string,
  paths: string[]
): Promise<{ rootKey: string; created: number }> {
  const realmId = getRealmId(auth);
  const onNodePut = deps.recordNewKey ? (k: string) => deps.recordNewKey!(realmId, k) : undefined;
  const emptyDict = await encodeDictNode({ children: [], childNames: [] }, deps.key);
  const emptyDictKey = hashToKey(emptyDict.hash);
  await deps.cas.putNode(emptyDictKey, streamFromBytes(emptyDict.bytes));
  deps.recordNewKey?.(realmId, emptyDictKey);
  let nextRoot = rootKey;
  let created = 0;
  for (const rawPath of paths) {
    const path = normalizeRelativePath(rawPath);
    nextRoot = await ensurePathThenAddOrReplace(deps.cas, deps.key, nextRoot, path, emptyDictKey, onNodePut);
    created += 1;
  }
  return { rootKey: nextRoot, created };
}

async function applyRmPatterns(
  deps: McpHandlerDeps,
  rootKey: string,
  patterns: string[],
  mode: PatternMode,
  onNodePut?: (key: string) => void
): Promise<{ rootKey: string; deleted: number; noMatch: number; tombstones: Tombstone[] }> {
  const { matches, noMatch } = await collectPatternMatches(deps, rootKey, patterns, mode);
  const sorted = [...matches].sort((a, b) => b.path.localeCompare(a.path, "en", { sensitivity: "base" }));
  let nextRoot = rootKey;
  const tombstones: Tombstone[] = [];
  let deleted = 0;
  for (const entry of sorted) {
    const existing = await resolvePath(deps.cas, nextRoot, entry.path);
    if (!existing) continue;
    nextRoot = await removeEntryAtPath(deps.cas, deps.key, nextRoot, entry.path, onNodePut);
    tombstones.push({ path: entry.path, key: existing });
    deleted += 1;
  }
  return { rootKey: nextRoot, deleted, noMatch, tombstones };
}

async function applyMoveOrCopyPatterns(
  deps: McpHandlerDeps,
  rootKey: string,
  params: { from: string; to: string; mode: PatternMode; copyOnly: boolean },
  onNodePut?: (key: string) => void
): Promise<{
  rootKey: string;
  affected: number;
  noMatch: number;
  overwritten: number;
  tombstones: Tombstone[];
}> {
  const { matches, noMatch } = await collectPatternMatches(deps, rootKey, [params.from], params.mode);
  let nextRoot = rootKey;
  const tombstones: Tombstone[] = [];
  let affected = 0;
  let overwritten = 0;

  for (const entry of matches) {
    const toPath = applyPathTemplate(params.to, {
      path: entry.path,
      parentPath: entry.parentPath,
      name: entry.name,
      captures: entry.captures,
    });
    const targetExisting = await resolvePath(deps.cas, nextRoot, toPath);
    if (targetExisting) {
      tombstones.push({ path: toPath, key: targetExisting });
      overwritten += 1;
    }
    if (!params.copyOnly) {
      const currentSource = await resolvePath(deps.cas, nextRoot, entry.path);
      if (!currentSource) continue;
      nextRoot = await removeEntryAtPath(deps.cas, deps.key, nextRoot, entry.path, onNodePut);
      nextRoot = await ensurePathThenAddOrReplace(
        deps.cas,
        deps.key,
        nextRoot,
        toPath,
        currentSource,
        onNodePut
      );
      affected += 1;
      continue;
    }
    nextRoot = await ensurePathThenAddOrReplace(
      deps.cas,
      deps.key,
      nextRoot,
      toPath,
      entry.nodeKey,
      onNodePut
    );
    affected += 1;
  }
  return { rootKey: nextRoot, affected, noMatch, overwritten, tombstones };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  {
    name: "create_branch",
    description:
      "Create a branch. Without parentBranchId creates under realm root (requires branch_manage). With parentBranchId creates sub-branch (Worker only, parent must be own branch). If mountPath does not exist, the new branch starts with a null root (no root node); use this for artist flux_image so the image becomes the branch root. Returns branchId, accessToken, expiresAt, and accessUrlPrefix (single URL for branch-scoped requests; use as casfaBranchUrl in flux_image, no token needed).",
    inputSchema: {
      type: "object" as const,
      properties: {
        mountPath: { type: "string" as const, description: "Mount path for the branch" },
        ttl: { type: "number" as const, description: "Optional TTL in seconds" },
        parentBranchId: {
          type: "string" as const,
          description: "Optional parent branch (Worker only)",
        },
        initialTransfers: {
          type: "object" as const,
          description:
            "Optional transfer spec applied at create time for preflight validation. Execution will be wired in transfer_paths flow.",
        },
      },
      required: ["mountPath"] as string[],
    },
  },
  {
    name: "close_branch",
    description: "Close current branch (Worker) or specified branch (user/delegate with branch_manage).",
    inputSchema: {
      type: "object" as const,
      properties: {
        branchId: { type: "string" as const, description: "Optional branch id; default me for worker" },
      },
      required: [] as string[],
    },
  },
  {
    name: "transfer_paths",
    description:
      "Transfer mapped paths from one branch to another branch atomically. Supports mode replace/fail_if_exists/merge_dir.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source: { type: "string" as const, description: "Source branch id" },
        target: { type: "string" as const, description: "Target branch id" },
        mapping: {
          type: "object" as const,
          description: "Path mapping object where key is sourcePath and value is targetPath",
        },
        mode: {
          type: "string" as const,
          description: "replace | fail_if_exists | merge_dir",
        },
      },
      required: ["source", "target", "mapping"] as string[],
    },
  },
  {
    name: "fs_mkdir",
    description:
      "Create directories. Arguments: paths: string[], recursive?: boolean. Existing paths are treated as overwrite/no-op behavior.",
    inputSchema: {
      type: "object" as const,
      properties: {
        paths: { type: "array" as const, description: "Directory paths to create", items: { type: "string" as const } },
        recursive: { type: "boolean" as const, description: "Reserved; defaults to true" },
      },
      required: ["paths"] as string[],
    },
  },
  {
    name: "fs_ls",
    description:
      "List files/directories matched by { paths, mode? }. mode defaults to glob. Single-level only: glob forbids **; regex matches basename only. No match is not an error and is counted in noMatch.",
    inputSchema: {
      type: "object" as const,
      properties: {
        paths: { type: "array" as const, items: { type: "string" as const }, description: "Path patterns" },
        mode: { type: "string" as const, description: "glob | regex (default glob)" },
      },
      required: ["paths"] as string[],
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
    description:
      "Remove files/directories matched by { paths, mode? }. mode defaults to glob. Single-level only: glob forbids **; regex matches basename only. No match is not an error. Requires file_write.",
    inputSchema: {
      type: "object" as const,
      properties: {
        paths: { type: "array" as const, items: { type: "string" as const }, description: "Path patterns to remove" },
        mode: { type: "string" as const, description: "glob | regex (default glob)" },
      },
      required: ["paths"] as string[],
    },
  },
  {
    name: "fs_mv",
    description:
      "Move files/directories matched by { from, to, mode? }. mode defaults to glob. to supports {basename} {dirname} {ext}, and {capture:n} in regex mode. Single-level matching only (glob forbids **; regex matches basename only). No match is not an error. Requires file_write.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from: { type: "string" as const, description: "Source pattern" },
        to: { type: "string" as const, description: "Destination template path" },
        mode: { type: "string" as const, description: "glob | regex (default glob)" },
      },
      required: ["from", "to"] as string[],
    },
  },
  {
    name: "fs_cp",
    description:
      "Copy files/directories matched by { from, to, mode? }. mode defaults to glob. Directory copy is recursive by default. to supports {basename} {dirname} {ext}, and {capture:n} in regex mode. Single-level matching only (glob forbids **; regex matches basename only). No match is not an error. Requires file_write.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from: { type: "string" as const, description: "Source pattern" },
        to: { type: "string" as const, description: "Destination template path" },
        mode: { type: "string" as const, description: "glob | regex (default glob)" },
      },
      required: ["from", "to"] as string[],
    },
  },
  {
    name: "fs_batch",
    description:
      "Atomic batch with command objects { name, arguments }. Supported names: mv|cp|rm|mkdir. Fixed semantics: stop-on-error, overwrite, no-dry-run. Success response includes compact summary and tombstones; failed response includes error only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commands: {
          type: "array" as const,
          description: "Batch commands in MCP tool-call style",
          items: { type: "object" as const },
        },
        clientRequestId: {
          type: "string" as const,
          description: "Optional idempotency key",
        },
      },
      required: ["commands"] as string[],
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
    serverInfo: { name: "casfa-drive-mcp", version: "0.1.0" },
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

/** Server-next does not expose prompts; return empty list so discovery does not get Method not found. */
function handlePromptsList(id: string | number): McpResponse {
  return mcpSuccess(id, { prompts: [] });
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

/** Tool execution: same logic as handleToolsCall but returns ToolResult for cell-mcp. */
export async function executeTool(
  auth: NonNullable<Env["Variables"]["auth"]>,
  deps: McpHandlerDeps,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  function err(message: string): ToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
  }
  function ok(content: ToolResult["content"]): ToolResult {
    return { content };
  }

  try {
    if (name === "create_branch") {
      const mountPath =
        typeof args.mountPath === "string" ? args.mountPath.trim().replace(/^\/+|\/+$/g, "") : "";
      if (!mountPath) {
        return err("mountPath required");
      }
      const ttlSec = typeof args.ttl === "number" && args.ttl > 0 ? args.ttl : undefined;
      const ttlMs =
        ttlSec != null
          ? Math.min(ttlSec * 1000, deps.config.auth.maxBranchTtlMs ?? 600_000)
          : 600_000;
      const parentBranchId =
        typeof args.parentBranchId === "string"
          ? args.parentBranchId.trim() || undefined
          : undefined;
      const initialTransfers =
        typeof args.initialTransfers === "object" && args.initialTransfers !== null
          ? (args.initialTransfers as TransferSpec)
          : undefined;
      if (initialTransfers) {
        validateTransferSpec(initialTransfers);
      }
      const realmId = getRealmId(auth);

      if (!parentBranchId) {
        if (!hasBranchManage(auth)) {
          return err("branch_manage or user required");
        }
        if (auth.type === "user" || auth.type === "delegate") {
          const emptyKey = await ensureEmptyRoot(deps.cas, deps.key);
          await deps.branchStore.ensureRealmRoot(realmId, emptyKey);
        }
        const rootKey = await deps.branchStore.getRealmRoot(realmId);
        if (rootKey === null) {
          return err("Realm not initialized. Open profile or realm first.");
        }
        const rootRecord = await deps.branchStore.getRealmRootRecord(realmId);
        if (!rootRecord) return err("Realm root not found");
        const childRootKey = await resolvePath(deps.cas, rootKey, mountPath);
        const branchId = crypto.randomUUID();
        const now = Date.now();
        const expiresAt = now + ttlMs;
        const verificationBytes = new Uint8Array(16);
        crypto.getRandomValues(verificationBytes);
        const verification = encodeCrockfordBase32(verificationBytes);
        await deps.branchStore.insertBranch({
          branchId,
          realmId,
          parentId: rootRecord.branchId,
          expiresAt,
          accessVerification: { value: verification, expiresAt },
        });
        if (childRootKey !== null) {
          await deps.branchStore.setBranchRoot(branchId, childRootKey);
        }
        const base = deps.config.baseUrl?.replace(/\/$/, "");
        return ok([
            {
              type: "text" as const,
              text: JSON.stringify({
                branchId,
                accessToken: base64urlEncode(branchId),
                expiresAt,
                ...(base && { baseUrl: deps.config.baseUrl, accessUrlPrefix: `${base}/branch/${branchId}/${verification}` }),
              }),
            },
          ]);
      }

      if (auth.type !== "worker" || auth.branchId !== parentBranchId) {
        return err("Must be worker of parent branch");
      }
      const parentBranch = await deps.branchStore.getBranch(parentBranchId);
      if (!parentBranch) {
        return err("Parent branch not found");
      }
      const parentRootKey = await deps.branchStore.getBranchRoot(parentBranchId);
      if (parentRootKey === null) {
        return err("Parent branch has no root");
      }
      const childRootKey = await resolvePath(deps.cas, parentRootKey, mountPath);
      if (childRootKey === null) {
        return err("mountPath does not resolve under parent root");
      }
      const childId = crypto.randomUUID();
      const now = Date.now();
      const expiresAt = now + ttlMs;
      const verificationBytes = new Uint8Array(16);
      crypto.getRandomValues(verificationBytes);
      const verification = encodeCrockfordBase32(verificationBytes);
      await deps.branchStore.insertBranch({
        branchId: childId,
        realmId: parentBranch.realmId,
        parentId: parentBranchId,
        expiresAt,
        accessVerification: { value: verification, expiresAt },
      });
      await deps.branchStore.setBranchRoot(childId, childRootKey);
      const base = deps.config.baseUrl?.replace(/\/$/, "");
      return ok([
          {
            type: "text" as const,
            text: JSON.stringify({
              branchId: childId,
              accessToken: base64urlEncode(childId),
              expiresAt,
              ...(base && { baseUrl: deps.config.baseUrl, accessUrlPrefix: `${base}/branch/${childId}/${verification}` }),
            }),
          },
      ]);
    }

    if (name === "close_branch") {
      const requestedBranchId =
        typeof args.branchId === "string" && args.branchId.trim().length > 0
          ? args.branchId.trim()
          : "me";
      if (auth.type === "worker") {
        if (requestedBranchId !== "me" && requestedBranchId !== auth.branchId) {
          return err("Can only close own branch");
        }
        const branch = await deps.branchStore.getBranch(auth.branchId);
        if (!branch) {
          return ok([{ type: "text" as const, text: JSON.stringify({ closed: auth.branchId }) }]);
        }
        await deps.branchStore.removeBranch(auth.branchId);
        return ok([{ type: "text" as const, text: JSON.stringify({ closed: auth.branchId }) }]);
      }
      if (!hasBranchManage(auth)) {
        return err("branch_manage or user required");
      }
      const realmId = getRealmId(auth);
      const branchId = requestedBranchId;
      const branch = await deps.branchStore.getBranch(branchId);
      if (!branch || branch.realmId !== realmId) {
        return ok([{ type: "text" as const, text: JSON.stringify({ closed: branchId }) }]);
      }
      await deps.branchStore.removeBranch(branchId);
      return ok([{ type: "text" as const, text: JSON.stringify({ closed: branchId }) }]);
    }

    if (name === "transfer_paths") {
      const spec = {
        source: typeof args.source === "string" ? args.source : "",
        target: typeof args.target === "string" ? args.target : "",
        mapping:
          typeof args.mapping === "object" && args.mapping !== null
            ? (args.mapping as Record<string, string>)
            : {},
        mode:
          typeof args.mode === "string" && args.mode.length > 0
            ? (args.mode as "replace" | "fail_if_exists" | "merge_dir")
            : undefined,
      };
      const normalized = validateTransferSpec(spec);
      if (auth.type === "worker") {
        if (normalized.target !== auth.branchId || normalized.source !== auth.branchId) {
          return err("Worker can only transfer within own branch");
        }
      } else if (!hasBranchManage(auth)) {
        return err("branch_manage or user required");
      }
      const result = await executeTransfer(normalized, deps);
      return ok([{ type: "text" as const, text: JSON.stringify(result) }]);
    }

    if (name === "fs_mkdir") {
      if (!hasFileWrite(auth)) {
        return err("file_write required");
      }
      const paths = parseStringList(args.paths);
      if (paths.length === 0) {
        return err("paths required");
      }
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return err(rootResult.error);
      }
      let rootKey = rootResult.rootKey;
      try {
        const { rootKey: newRootKey, created } = await applyMkdirPaths(auth, deps, rootKey, paths);
        rootKey = newRootKey;
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.branchStore.setBranchRoot(delegateId, rootKey);
        return ok([{ type: "text" as const, text: JSON.stringify({ created }) }]);
      } catch (e) {
        const message = e instanceof Error ? e.message : "mkdir failed";
        if (
          message.includes("must not contain") ||
          message.includes("Parent path not found") ||
          message.includes("Not a dict") ||
          message.includes("E_PATH_INVALID")
        ) {
          return err(message);
        }
        throw e;
      }
    }

    if (name === "fs_rm") {
      if (!hasFileWrite(auth)) {
        return err("file_write required");
      }
      const paths = parseStringList(args.paths);
      if (paths.length === 0) {
        return err("paths required");
      }
      const mode = parsePatternMode(args.mode);
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return err(rootResult.error);
      }
      let rootKey = rootResult.rootKey;
      try {
        const realmId = getRealmId(auth);
        const onNodePut = deps.recordNewKey
          ? (k: string) => deps.recordNewKey!(realmId, k)
          : undefined;
        const { rootKey: nextRoot, deleted, noMatch, tombstones } = await applyRmPatterns(
          deps,
          rootKey,
          paths,
          mode,
          onNodePut
        );
        rootKey = nextRoot;
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.branchStore.setBranchRoot(delegateId, rootKey);
        return ok([
          {
            type: "text" as const,
            text: JSON.stringify({
              deleted,
              noMatch,
              tombstones,
            }),
          },
        ]);
      } catch (e) {
        const message = e instanceof Error ? e.message : "fs_rm failed";
        if (
          message.includes("must not contain") ||
          message.includes("Parent path") ||
          message.includes("E_PATTERN_NOT_ALLOWED") ||
          message.includes("E_INVALID_PATTERN") ||
          message.includes("E_PATH_INVALID")
        ) {
          return err(message);
        }
        throw e;
      }
    }

    if (name === "fs_mv") {
      if (!hasFileWrite(auth)) {
        return err("file_write required");
      }
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return err(rootResult.error);
      }
      let rootKey = rootResult.rootKey;
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
        return err("from and to required");
      }
      const mode = parsePatternMode(args.mode);
      try {
        const realmId = getRealmId(auth);
        const onNodePut = deps.recordNewKey
          ? (k: string) => deps.recordNewKey!(realmId, k)
          : undefined;
        const result = await applyMoveOrCopyPatterns(deps, rootKey, {
          from: fromStr,
          to: toStr,
          mode,
          copyOnly: false,
        }, onNodePut);
        rootKey = result.rootKey;
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.branchStore.setBranchRoot(delegateId, rootKey);
        return ok([
          {
            type: "text" as const,
            text: JSON.stringify({
              moved: result.affected,
              noMatch: result.noMatch,
              overwritten: result.overwritten,
              tombstones: result.tombstones,
            }),
          },
        ]);
      } catch (e) {
        const message = e instanceof Error ? e.message : "fs_mv failed";
        if (
          message.includes("must not contain") ||
          message.includes("Parent path not found") ||
          message.includes("Not a dict") ||
          message.includes("E_PATTERN_NOT_ALLOWED") ||
          message.includes("E_INVALID_PATTERN") ||
          message.includes("E_TEMPLATE_EVAL_FAILED") ||
          message.includes("E_PATH_INVALID")
        ) {
          return err(message);
        }
        throw e;
      }
    }

    if (name === "fs_cp") {
      if (!hasFileWrite(auth)) {
        return err("file_write required");
      }
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return err(rootResult.error);
      }
      let rootKey = rootResult.rootKey;
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
        return err("from and to required");
      }
      const mode = parsePatternMode(args.mode);
      try {
        const realmId = getRealmId(auth);
        const onNodePut = deps.recordNewKey
          ? (k: string) => deps.recordNewKey!(realmId, k)
          : undefined;
        const result = await applyMoveOrCopyPatterns(deps, rootKey, {
          from: fromStr,
          to: toStr,
          mode,
          copyOnly: true,
        }, onNodePut);
        rootKey = result.rootKey;
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.branchStore.setBranchRoot(delegateId, rootKey);
        return ok([
          {
            type: "text" as const,
            text: JSON.stringify({
              copied: result.affected,
              noMatch: result.noMatch,
              overwritten: result.overwritten,
              tombstones: result.tombstones,
            }),
          },
        ]);
      } catch (e) {
        const message = e instanceof Error ? e.message : "fs_cp failed";
        if (
          message.includes("must not contain") ||
          message.includes("Parent path not found") ||
          message.includes("Not a dict") ||
          message.includes("E_PATTERN_NOT_ALLOWED") ||
          message.includes("E_INVALID_PATTERN") ||
          message.includes("E_TEMPLATE_EVAL_FAILED") ||
          message.includes("E_PATH_INVALID")
        ) {
          return err(message);
        }
        throw e;
      }
    }

    if (name === "fs_batch") {
      if (!hasFileWrite(auth)) {
        return err("file_write required");
      }
      const commands = Array.isArray(args.commands) ? args.commands : [];
      if (commands.length === 0) {
        return err("commands required");
      }
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return err(rootResult.error);
      }
      let rootKey = rootResult.rootKey;
      const summary = createEmptyFsBatchSummary();
      const tombstones: Tombstone[] = [];
      const txnId = `txn_${crypto.randomUUID().replace(/-/g, "")}`;
      const branchId = await getEffectiveDelegateId(auth, deps);
      try {
        const realmId = getRealmId(auth);
        const onNodePut = deps.recordNewKey
          ? (k: string) => deps.recordNewKey!(realmId, k)
          : undefined;
        for (const command of commands) {
          if (!command || typeof command !== "object") {
            throw new Error("E_INVALID_COMMAND: command must be object");
          }
          const nameRaw = (command as { name?: unknown }).name;
          const commandArgs = (command as { arguments?: Record<string, unknown> }).arguments ?? {};
          if (typeof nameRaw !== "string") {
            throw new Error("E_INVALID_COMMAND: command name required");
          }
          if (nameRaw === "mkdir") {
            const paths = parseStringList(commandArgs.paths);
            if (paths.length === 0) throw new Error("E_INVALID_COMMAND: mkdir paths required");
            const mkdirResult = await applyMkdirPaths(auth, deps, rootKey, paths);
            rootKey = mkdirResult.rootKey;
            summary.created += mkdirResult.created;
            continue;
          }
          if (nameRaw === "rm") {
            const paths = parseStringList(commandArgs.paths);
            const mode = parsePatternMode(commandArgs.mode);
            if (paths.length === 0) throw new Error("E_INVALID_COMMAND: rm paths required");
            const rmResult = await applyRmPatterns(deps, rootKey, paths, mode, onNodePut);
            rootKey = rmResult.rootKey;
            summary.deleted += rmResult.deleted;
            summary.noMatch += rmResult.noMatch;
            tombstones.push(...rmResult.tombstones);
            continue;
          }
          if (nameRaw === "mv" || nameRaw === "cp") {
            const from =
              typeof commandArgs.from === "string"
                ? commandArgs.from.trim().replace(/^\/+|\/+$/g, "")
                : "";
            const to =
              typeof commandArgs.to === "string"
                ? commandArgs.to.trim().replace(/^\/+|\/+$/g, "")
                : "";
            const mode = parsePatternMode(commandArgs.mode);
            if (!from || !to) throw new Error(`E_INVALID_COMMAND: ${nameRaw} from and to required`);
            const mvOrCpResult = await applyMoveOrCopyPatterns(deps, rootKey, {
              from,
              to,
              mode,
              copyOnly: nameRaw === "cp",
            }, onNodePut);
            rootKey = mvOrCpResult.rootKey;
            summary.noMatch += mvOrCpResult.noMatch;
            summary.overwritten += mvOrCpResult.overwritten;
            tombstones.push(...mvOrCpResult.tombstones);
            if (nameRaw === "mv") {
              summary.moved += mvOrCpResult.affected;
            } else {
              summary.copied += mvOrCpResult.affected;
            }
            continue;
          }
          throw new Error(`E_INVALID_COMMAND: unsupported command ${nameRaw}`);
        }
        await deps.branchStore.setBranchRoot(branchId, rootKey);
        return ok([
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "committed",
              txnId,
              branchId,
              summary,
              tombstones,
            }),
          },
        ]);
      } catch (e) {
        const message = e instanceof Error ? e.message : "batch failed";
        const code = message.includes(":") ? message.slice(0, message.indexOf(":")) : "E_INTERNAL";
        return ok([
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "failed",
              txnId,
              branchId,
              error: {
                code: /^E_[A-Z0-9_]+$/.test(code) ? code : "E_INTERNAL",
                message,
              },
            }),
          },
        ]);
      }
    }

    if (name === "fs_write") {
      if (!hasFileWrite(auth)) {
        return err("file_write required");
      }
      const pathStr =
        typeof args.path === "string"
          ? String(args.path)
              .trim()
              .replace(/^\/+|\/+$/g, "")
          : "";
      if (!pathStr) {
        return err("path required");
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
        return err(`Content too large (max ${MAX_BYTES} bytes)`);
      }
      const rootResult = await getRootForMcpWrite(auth, deps);
      if ("error" in rootResult) {
        return err(rootResult.error);
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
        const newRootKey = await ensurePathThenAddOrReplace(
          deps.cas,
          deps.key,
          rootKey,
          pathStr,
          fileNodeKey,
          onNodePut
        );
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.branchStore.setBranchRoot(delegateId, newRootKey);
        return ok([{ type: "text" as const, text: JSON.stringify({ path: pathStr }) }]);
      } catch (e) {
        const message = e instanceof Error ? e.message : "fs_write failed";
        if (
          message.includes("must not contain") ||
          message.includes("Path must not be empty") ||
          message.includes("Parent path not found") ||
          message.includes("Not a dict")
        ) {
          return err(message);
        }
        throw e;
      }
    }

    // fs_ls, fs_stat, fs_read
    if (!hasFileRead(auth)) {
      return err("file_read required");
    }
    if (auth.type === "user" || auth.type === "delegate") {
      const realmId = getRealmId(auth);
      const emptyKey = await ensureEmptyRoot(deps.cas, deps.key);
      await deps.branchStore.ensureRealmRoot(realmId, emptyKey);
    }
    const rootKey = await getCurrentRoot(auth, deps);
    if (rootKey === null) {
      if (auth.type === "worker") {
        if (name === "fs_ls") {
          return ok([{ type: "text" as const, text: JSON.stringify({ entries: [], noMatch: 0 }) }]);
        }
        if (name === "fs_stat") {
          return ok([{ type: "text" as const, text: JSON.stringify({ kind: "directory" }) }]);
        }
        return err("Path not found");
      }
      return err("Realm or branch root not found");
    }

    if (name === "fs_ls") {
      const paths = parseStringList(args.paths);
      if (paths.length === 0) {
        return err("paths required");
      }
      const mode = parsePatternMode(args.mode);
      const { matches, noMatch } = await collectPatternMatches(deps, rootKey, paths, mode);
      const entries: Array<{ path: string; kind: "file" | "directory"; size?: number }> = [];
      for (const match of matches) {
        const node = await getNodeDecoded(deps.cas, match.nodeKey);
        if (!node) continue;
        if (node.kind === "file") {
          entries.push({
            path: match.path,
            kind: "file",
            size: node.fileInfo?.fileSize ?? 0,
          });
        } else {
          entries.push({
            path: match.path,
            kind: "directory",
          });
        }
      }
      return ok([{ type: "text" as const, text: JSON.stringify({ entries, noMatch }) }]);
    }

    const pathStr =
      typeof args.path === "string"
        ? String(args.path)
            .trim()
            .replace(/^\/+|\/+$/g, "")
        : "";
    const nodeKey = await resolvePath(deps.cas, rootKey, pathStr);
    if (nodeKey === null) {
      return err("Path not found");
    }
    const node = await getNodeDecoded(deps.cas, nodeKey);
    if (!node) {
      return err("Node not found");
    }

    if (name === "fs_stat") {
      if (node.kind === "file") {
        return ok([
          {
            type: "text" as const,
            text: JSON.stringify({
              kind: "file",
              size: node.fileInfo?.fileSize ?? 0,
              contentType: node.fileInfo?.contentType ?? "application/octet-stream",
            }),
          },
        ]);
      }
      return ok([{ type: "text" as const, text: JSON.stringify({ kind: "directory" }) }]);
    }

    if (name === "fs_read") {
      if (node.kind !== "file") {
        return err("Not a file");
      }
      const data = node.data ?? new Uint8Array(0);
      const text = new TextDecoder().decode(data);
      return ok([
        {
          type: "text" as const,
          text: JSON.stringify({
            content: text,
            contentType: node.fileInfo?.contentType ?? "application/octet-stream",
          }),
        },
      ]);
    }

    return err(`Unknown tool: ${name}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Tool call failed";
    return err(message);
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
      case "prompts/list":
        response = handlePromptsList(request.id);
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
          const result = await executeTool(auth, deps, name, args ?? {});
          if (result.isError) {
            response = mcpError(request.id, MCP_INVALID_PARAMS, result.content[0]?.text ?? "Tool error");
          } else {
            response = mcpSuccess(request.id, { content: result.content });
          }
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
