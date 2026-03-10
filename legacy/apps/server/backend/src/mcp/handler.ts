/**
 * MCP (Model Context Protocol) Handler
 *
 * v1.0 — Full implementation with 16 tools, 4 resource templates, and 4 prompts.
 *
 * Shares service-layer logic with the HTTP controllers:
 * - FsService for filesystem operations
 * - DepotsDb for depot CRUD
 * - createChildDelegate for delegate creation
 * - Storage + decodeNode for node metadata
 *
 * See docs/mcp-tools/README.md for the complete design.
 */

import { type PathSegment, parsePathSegments } from "@casfa/cas-uri";
import { decodeNode, getWellKnownNodeData, isWellKnownNode } from "@casfa/core";
import type { FsRewriteEntry } from "@casfa/protocol";
import { hashToNodeKey, nodeKeyToStorageKey, storageKeyToNodeKey } from "@casfa/protocol";
import type { StorageProvider } from "@casfa/storage-core";
import type { Context } from "hono";
import type { ServerConfig } from "../config.ts";
import type { DelegatesDb } from "../db/delegates.ts";
import type { DepotsDb } from "../db/depots.ts";
import type { OwnershipV2Db } from "../db/ownership-v2.ts";
import type { RefCountDb } from "../db/refcount.ts";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes.ts";
import type { UsageDb } from "../db/usage.ts";
import { computeCommitDiff } from "../services/commit-diff.ts";
import { type CreateDelegateDeps, createChildDelegate } from "../services/delegate-creation.ts";
import type { FsService } from "../services/fs/index.ts";
import { isFsError } from "../services/fs/index.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";
import { getPromptMessages, MCP_PROMPTS } from "./prompts.ts";
import { MCP_TOOLS } from "./tools.ts";

// ============================================================================
// Types
// ============================================================================

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
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

// MCP Error Codes
const MCP_PARSE_ERROR = -32700;
const MCP_INVALID_REQUEST = -32600;
const MCP_METHOD_NOT_FOUND = -32601;
const MCP_INVALID_PARAMS = -32602;

// ============================================================================
// Response Helpers
// ============================================================================

const mcpSuccess = (id: string | number, result: unknown): McpResponse => ({
  jsonrpc: "2.0",
  id,
  result,
});

const mcpError = (
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): McpResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, data },
});

/** Wrap a successful tool result as MCP content */
const toolResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

/** Wrap a tool error as MCP content with isError flag */
const toolError = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

// ============================================================================
// Resource Templates
// ============================================================================

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "cas://depot:{depotId}",
    name: "Depot root",
    description:
      "Current root of a depot. Subscribe to receive notifications when the root changes (new commit).",
    mimeType: "application/json",
  },
  {
    uriTemplate: "cas://depot:{depotId}/{+path}",
    name: "File or directory in depot",
    description:
      "Read a file (returns text content) or list a directory (returns JSON children list) from the depot's current root.",
    mimeType: "text/plain",
  },
  {
    uriTemplate: "cas://node:{nodeKey}",
    name: "CAS node metadata",
    description:
      "Structural metadata of an immutable CAS node. Content never changes — safe to cache indefinitely.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "cas://node:{nodeKey}/{+path}",
    name: "File or directory under CAS node",
    description:
      "Read a file or list a directory under an immutable CAS node. Content never changes for the same URI.",
    mimeType: "text/plain",
  },
];

// ============================================================================
// Handler Dependencies
// ============================================================================

export type McpHandlerDeps = {
  depotsDb: DepotsDb;
  fsService: FsService;
  storage: StorageProvider;
  ownershipV2Db: OwnershipV2Db;
  refCountDb: RefCountDb;
  usageDb: UsageDb;
  delegatesDb: DelegatesDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  serverConfig: ServerConfig;
};

export type McpController = {
  handle: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Handler Factory
// ============================================================================

export const createMcpController = (deps: McpHandlerDeps): McpController => {
  const {
    depotsDb,
    fsService,
    storage,
    ownershipV2Db,
    refCountDb,
    usageDb,
    delegatesDb,
    scopeSetNodesDb,
    serverConfig,
  } = deps;

  const delegateCreateDeps: CreateDelegateDeps = {
    delegatesDb,
    scopeSetNodesDb,
    getNode: (_realm: string, hash: string) => storage.get(hash),
  };

  // --------------------------------------------------------------------------
  // Path parsing helper
  // --------------------------------------------------------------------------

  const parsePath = (
    path?: string
  ): { ok: true; segments: PathSegment[] } | { ok: false; error: string } => {
    const result = parsePathSegments(path);
    if (!result.ok) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true, segments: result.segments };
  };

  // --------------------------------------------------------------------------
  // Protocol handlers
  // --------------------------------------------------------------------------

  const handleInitialize = (id: string | number): McpResponse => {
    return mcpSuccess(id, {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: {},
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: false },
      },
      serverInfo: { name: "casfa-mcp", version: "1.0.0" },
    });
  };

  // --------------------------------------------------------------------------
  // Tools
  // --------------------------------------------------------------------------

  const handleToolsList = (id: string | number): McpResponse => {
    return mcpSuccess(id, { tools: MCP_TOOLS });
  };

  const handleToolsCall = async (
    id: string | number,
    params: { name: string; arguments?: Record<string, unknown> } | undefined,
    auth: AccessTokenAuthContext
  ): Promise<McpResponse> => {
    if (!params?.name) {
      return mcpError(id, MCP_INVALID_PARAMS, "Missing tool name");
    }

    const args = params.arguments ?? {};
    const realm = auth.realm;
    const ownerId = auth.delegateId;

    try {
      let result: unknown;

      switch (params.name) {
        // ── Depots ───────────────────────────────────────────────────
        case "list_depots":
          result = await handleListDepots(realm, args);
          break;
        case "get_depot":
          result = await handleGetDepot(realm, args);
          break;

        // ── Filesystem Read ──────────────────────────────────────────
        case "fs_stat":
          result = await handleFsStat(realm, args);
          break;
        case "fs_ls":
          result = await handleFsLs(realm, args);
          break;
        case "fs_read":
          result = await handleFsRead(realm, args);
          break;
        case "fs_tree":
          result = await handleFsTree(realm, args);
          break;

        // ── Node Metadata ────────────────────────────────────────────
        case "node_metadata":
          result = await handleNodeMetadata(realm, args);
          break;

        // ── Filesystem Write ─────────────────────────────────────────
        case "fs_write":
          result = await handleFsWrite(realm, ownerId, auth, args);
          break;
        case "fs_mkdir":
          result = await handleFsMkdir(realm, ownerId, args);
          break;
        case "fs_rm":
          result = await handleFsRm(realm, ownerId, args);
          break;
        case "fs_mv":
          result = await handleFsMv(realm, ownerId, args);
          break;
        case "fs_cp":
          result = await handleFsCp(realm, ownerId, args);
          break;
        case "fs_rewrite":
          result = await handleFsRewrite(realm, ownerId, auth, args);
          break;

        // ── Depot Commit ─────────────────────────────────────────────
        case "depot_commit":
          result = await handleDepotCommit(realm, auth, args);
          break;

        // ── Delegate ─────────────────────────────────────────────────
        case "create_delegate":
          result = await handleCreateDelegate(realm, auth, args);
          break;

        // ── Realm ────────────────────────────────────────────────────
        case "get_realm_info":
          result = handleGetRealmInfo(auth);
          break;
        case "get_usage":
          result = await handleGetUsage(realm);
          break;

        default:
          return mcpError(id, MCP_METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
      }

      return mcpSuccess(id, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpSuccess(id, toolError(`Internal error: ${message}`));
    }
  };

  // --------------------------------------------------------------------------
  // Tool Implementations
  // --------------------------------------------------------------------------

  // ── list_depots ──────────────────────────────────────────────────────

  const handleListDepots = async (realm: string, args: Record<string, unknown>) => {
    const limit = typeof args.limit === "number" ? args.limit : 100;
    const cursor = typeof args.cursor === "string" ? args.cursor : undefined;
    const result = await depotsDb.list(realm, { limit, startKey: cursor });

    return toolResult({
      depots: result.depots.map((d) => ({
        depotId: d.depotId,
        title: d.title,
        root: d.root,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      nextCursor: result.nextKey ?? null,
      hasMore: result.hasMore,
    });
  };

  // ── get_depot ────────────────────────────────────────────────────────

  const handleGetDepot = async (realm: string, args: Record<string, unknown>) => {
    const depotId = args.depotId as string;
    if (!depotId) return toolError("Missing required parameter: depotId");

    const depot = await depotsDb.get(realm, depotId);
    if (!depot) return toolError(`Error: DEPOT_NOT_FOUND — Depot '${depotId}' does not exist`);

    return toolResult({
      depotId: depot.depotId,
      title: depot.title,
      root: depot.root,
      maxHistory: depot.maxHistory,
      history: depot.history,
      createdAt: depot.createdAt,
      updatedAt: depot.updatedAt,
    });
  };

  // ── fs_stat ──────────────────────────────────────────────────────────

  const handleFsStat = async (realm: string, args: Record<string, unknown>) => {
    const nodeKey = args.nodeKey as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");

    const parsed = parsePath(args.path as string | undefined);
    if (!parsed.ok) return toolError(`Error: INVALID_PATH — ${parsed.error}`);

    const result = await fsService.stat(realm, nodeKey, parsed.segments);
    if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);

    return toolResult(result);
  };

  // ── fs_ls ────────────────────────────────────────────────────────────

  const handleFsLs = async (realm: string, args: Record<string, unknown>) => {
    const nodeKey = args.nodeKey as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");

    const parsed = parsePath(args.path as string | undefined);
    if (!parsed.ok) return toolError(`Error: INVALID_PATH — ${parsed.error}`);

    const limit = typeof args.limit === "number" ? Math.min(args.limit, 1000) : 100;
    const cursor = typeof args.cursor === "string" ? args.cursor : undefined;

    const result = await fsService.ls(realm, nodeKey, parsed.segments, limit, cursor);
    if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);

    return toolResult(result);
  };

  // ── fs_read ──────────────────────────────────────────────────────────

  const handleFsRead = async (realm: string, args: Record<string, unknown>) => {
    const nodeKey = args.nodeKey as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");

    const parsed = parsePath(args.path as string | undefined);
    if (!parsed.ok) return toolError(`Error: INVALID_PATH — ${parsed.error}`);

    const result = await fsService.read(realm, nodeKey, parsed.segments);
    if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);

    // Decode bytes to UTF-8 text
    const text = new TextDecoder("utf-8", { fatal: false }).decode(result.data);

    return toolResult({
      path: args.path ?? "/",
      key: result.key,
      size: result.size,
      contentType: result.contentType,
      content: text,
    });
  };

  // ── fs_tree ──────────────────────────────────────────────────────────

  const handleFsTree = async (realm: string, args: Record<string, unknown>) => {
    const nodeKey = args.nodeKey as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");

    const parsed = parsePath(args.path as string | undefined);
    if (!parsed.ok) return toolError(`Error: INVALID_PATH — ${parsed.error}`);

    const opts: { path?: PathSegment[]; depth?: number; maxEntries?: number } = {};
    if (parsed.segments.length > 0) opts.path = parsed.segments;
    if (typeof args.depth === "number") opts.depth = args.depth;
    if (typeof args.maxEntries === "number") opts.maxEntries = args.maxEntries;

    const result = await fsService.tree(realm, nodeKey, opts);
    if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);

    return toolResult(result);
  };

  // ── node_metadata ────────────────────────────────────────────────────

  const handleNodeMetadata = async (realm: string, args: Record<string, unknown>) => {
    const nodeKey = args.nodeKey as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");

    // Resolve nodeKey if it's a depot ID
    let resolvedKey = nodeKey;
    if (nodeKey.startsWith("dpt_")) {
      const result = await fsService.resolveNodeKey(realm, nodeKey);
      if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);
      resolvedKey = storageKeyToNodeKey(result);
    }

    // Navigate if navigation path is provided
    let storageKey = nodeKeyToStorageKey(resolvedKey);

    if (args.navigation && typeof args.navigation === "string") {
      const segments = (args.navigation as string).split("/").filter(Boolean);
      for (const seg of segments) {
        if (!/^~\d+$/.test(seg)) {
          return toolError(
            `Error: INVALID_PATH — Invalid navigation segment: ${seg}. Expected ~N format.`
          );
        }

        const index = Number.parseInt(seg.slice(1), 10);
        const nodeData = isWellKnownNode(storageKey)
          ? getWellKnownNodeData(storageKey)
          : await storage.get(storageKey);
        if (!nodeData) return toolError("Error: NOT_FOUND — Node not found during navigation");

        let decoded: ReturnType<typeof decodeNode>;
        try {
          decoded = decodeNode(nodeData);
        } catch {
          return toolError("Error: INVALID_NODE — Failed to decode node during navigation");
        }

        if (!decoded.children || index >= decoded.children.length) {
          return toolError(
            `Error: CHILD_INDEX_OUT_OF_BOUNDS — Child index ${index} out of bounds (node has ${decoded.children?.length ?? 0} children)`
          );
        }

        const childHash = decoded.children[index]!;
        storageKey = nodeKeyToStorageKey(hashToNodeKey(childHash));
      }
    }

    // Get and decode the node
    const nodeData = isWellKnownNode(storageKey)
      ? getWellKnownNodeData(storageKey)
      : await storage.get(storageKey);
    if (!nodeData) return toolError("Error: NOT_FOUND — Node not found");

    try {
      const node = decodeNode(nodeData);
      const currentNodeKey = storageKeyToNodeKey(storageKey);

      if (node.kind === "dict") {
        const children: Record<string, string> = {};
        if (node.children && node.childNames) {
          for (let i = 0; i < node.childNames.length; i++) {
            const name = node.childNames[i];
            const childHash = node.children[i];
            if (name && childHash) {
              children[name] = hashToNodeKey(childHash);
            }
          }
        }
        const refRecord = isWellKnownNode(storageKey)
          ? null
          : await refCountDb.getRefCount(realm, storageKey);
        const refCount = refRecord?.count ?? 0;
        return toolResult({
          key: currentNodeKey,
          kind: "dict",
          payloadSize: node.size,
          children,
          refCount,
        });
      }

      if (node.kind === "file") {
        const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : null;
        const refRecord = isWellKnownNode(storageKey)
          ? null
          : await refCountDb.getRefCount(realm, storageKey);
        const refCount = refRecord?.count ?? 0;
        return toolResult({
          key: currentNodeKey,
          kind: "file",
          payloadSize: node.size,
          contentType: node.fileInfo?.contentType ?? "application/octet-stream",
          successor,
          refCount,
        });
      }

      if (node.kind === "successor") {
        const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : null;
        const refRecord = isWellKnownNode(storageKey)
          ? null
          : await refCountDb.getRefCount(realm, storageKey);
        const refCount = refRecord?.count ?? 0;
        return toolResult({
          key: currentNodeKey,
          kind: "successor",
          payloadSize: node.size,
          successor,
          refCount,
        });
      }

      return toolError("Error: INVALID_NODE — Unknown node kind");
    } catch {
      return toolError("Error: INVALID_NODE — Failed to decode node");
    }
  };

  // ── fs_write ─────────────────────────────────────────────────────────

  const handleFsWrite = async (
    realm: string,
    ownerId: string,
    _auth: AccessTokenAuthContext,
    args: Record<string, unknown>
  ) => {
    const nodeKey = args.nodeKey as string;
    const path = args.path as string;
    const content = args.content as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");
    if (!path) return toolError("Missing required parameter: path");
    if (content === undefined || content === null)
      return toolError("Missing required parameter: content");

    const parsed = parsePath(path);
    if (!parsed.ok) return toolError(`Error: INVALID_PATH — ${parsed.error}`);

    // Encode content to UTF-8 bytes
    const encoder = new TextEncoder();
    const fileContent = encoder.encode(content);
    const contentType = (args.contentType as string) ?? "text/plain";

    const result = await fsService.write(
      realm,
      ownerId,
      nodeKey,
      parsed.segments,
      fileContent,
      contentType
    );
    if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);

    return toolResult(result);
  };

  // ── fs_mkdir ─────────────────────────────────────────────────────────

  const handleFsMkdir = async (realm: string, ownerId: string, args: Record<string, unknown>) => {
    const nodeKey = args.nodeKey as string;
    const path = args.path as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");
    if (!path) return toolError("Missing required parameter: path");

    const result = await fsService.mkdir(realm, ownerId, nodeKey, path);
    if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);

    return toolResult(result);
  };

  // ── fs_rm ────────────────────────────────────────────────────────────

  const handleFsRm = async (realm: string, ownerId: string, args: Record<string, unknown>) => {
    const nodeKey = args.nodeKey as string;
    const path = args.path as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");
    if (!path) return toolError("Missing required parameter: path");

    const parsed = parsePath(path);
    if (!parsed.ok) return toolError(`Error: INVALID_PATH — ${parsed.error}`);

    const result = await fsService.rm(realm, ownerId, nodeKey, parsed.segments);
    if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);

    return toolResult(result);
  };

  // ── fs_mv ────────────────────────────────────────────────────────────

  const handleFsMv = async (realm: string, ownerId: string, args: Record<string, unknown>) => {
    const nodeKey = args.nodeKey as string;
    const from = args.from as string;
    const to = args.to as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");
    if (!from) return toolError("Missing required parameter: from");
    if (!to) return toolError("Missing required parameter: to");

    const result = await fsService.mv(realm, ownerId, nodeKey, from, to);
    if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);

    return toolResult(result);
  };

  // ── fs_cp ────────────────────────────────────────────────────────────

  const handleFsCp = async (realm: string, ownerId: string, args: Record<string, unknown>) => {
    const nodeKey = args.nodeKey as string;
    const from = args.from as string;
    const to = args.to as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");
    if (!from) return toolError("Missing required parameter: from");
    if (!to) return toolError("Missing required parameter: to");

    const result = await fsService.cp(realm, ownerId, nodeKey, from, to);
    if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);

    return toolResult(result);
  };

  // ── fs_rewrite ───────────────────────────────────────────────────────

  const handleFsRewrite = async (
    realm: string,
    ownerId: string,
    auth: AccessTokenAuthContext,
    args: Record<string, unknown>
  ) => {
    const nodeKey = args.nodeKey as string;
    if (!nodeKey) return toolError("Missing required parameter: nodeKey");

    const entries = args.entries as Record<string, FsRewriteEntry> | undefined;
    const deletes = args.deletes as string[] | undefined;

    const result = await fsService.rewrite(
      realm,
      ownerId,
      nodeKey,
      entries,
      deletes,
      auth.issuerChain,
      auth.delegateId,
      auth
    );
    if (isFsError(result)) return toolError(`Error: ${result.code} — ${result.message}`);

    return toolResult(result);
  };

  // ── depot_commit ─────────────────────────────────────────────────────

  const handleDepotCommit = async (
    realm: string,
    auth: AccessTokenAuthContext,
    args: Record<string, unknown>
  ) => {
    const depotId = args.depotId as string;
    const newRoot = args.root as string;
    const expectedRoot = args.expectedRoot as string | null | undefined;
    if (!depotId) return toolError("Missing required parameter: depotId");
    if (!newRoot) return toolError("Missing required parameter: root");

    if (!auth.canUpload) {
      return toolError("Error: UPLOAD_NOT_ALLOWED — Current token does not have upload permission");
    }

    // Check depot exists
    const existingDepot = await depotsDb.get(realm, depotId);
    if (!existingDepot)
      return toolError(`Error: DEPOT_NOT_FOUND — Depot '${depotId}' does not exist`);

    // Validate root node
    const storageKey = nodeKeyToStorageKey(newRoot);
    if (!isWellKnownNode(storageKey)) {
      const exists = (await storage.get(storageKey)) !== null;
      if (!exists) return toolError("Error: ROOT_NOT_FOUND — Root node does not exist");

      // Ownership verification
      let rootAuthorized = false;
      for (const id of auth.issuerChain) {
        if (await ownershipV2Db.hasOwnership(storageKey, id)) {
          rootAuthorized = true;
          break;
        }
      }
      if (!rootAuthorized) {
        return toolError(
          "Error: ROOT_NOT_AUTHORIZED — Not authorized to set this node as depot root. Upload the node first."
        );
      }
    }

    // Compute dag diff between old and new root (best-effort, max 5 entries)
    const previousRoot = existingDepot.root ?? null;
    const commitDiff = await computeCommitDiff(previousRoot, newRoot, storage);

    const depot = await depotsDb.commit(
      realm,
      depotId,
      newRoot,
      expectedRoot,
      commitDiff ?? undefined
    );
    if (!depot) return toolError(`Error: DEPOT_NOT_FOUND — Depot '${depotId}' does not exist`);

    return toolResult({
      depotId: depot.depotId,
      root: depot.root,
      previousRoot,
      updatedAt: depot.updatedAt,
    });
  };

  // ── create_delegate ──────────────────────────────────────────────────

  const handleCreateDelegate = async (
    realm: string,
    auth: AccessTokenAuthContext,
    args: Record<string, unknown>
  ) => {
    const parentDelegate = auth.delegate;

    const result = await createChildDelegate(delegateCreateDeps, parentDelegate, realm, {
      name: args.name as string | undefined,
      canUpload: args.canUpload as boolean | undefined,
      canManageDepot: false, // Never allow via MCP
      scope: args.scope as string[] | undefined,
      expiresIn: args.expiresIn as number | undefined,
    });

    if (!result.ok) return toolError(`Error: ${result.error} — ${result.message}`);

    return toolResult({
      delegate: result.delegate,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
      refreshToken: result.refreshToken,
    });
  };

  // ── get_realm_info ───────────────────────────────────────────────────

  const handleGetRealmInfo = (auth: AccessTokenAuthContext) => {
    return toolResult({
      realm: auth.realm,
      commit: auth.canUpload ? {} : undefined,
      nodeLimit: serverConfig.nodeLimit,
      maxNameBytes: serverConfig.maxNameBytes,
    });
  };

  // ── get_usage ────────────────────────────────────────────────────────

  const handleGetUsage = async (realm: string) => {
    const usage = await usageDb.getUsage(realm);
    return toolResult({
      realm: usage.realm,
      physicalBytes: usage.physicalBytes,
      logicalBytes: usage.logicalBytes,
      nodeCount: usage.nodeCount,
      quotaLimit: usage.quotaLimit,
      updatedAt: usage.updatedAt ?? Date.now(),
    });
  };

  // --------------------------------------------------------------------------
  // Resources
  // --------------------------------------------------------------------------

  const handleResourcesList = async (id: string | number, realm: string): Promise<McpResponse> => {
    // List all depots as concrete resources
    const result = await depotsDb.list(realm);
    const resources = result.depots.map((d) => ({
      uri: `cas://depot:${d.depotId.replace("dpt_", "")}`,
      name: d.title || d.depotId,
      description: `Depot: ${d.title || d.depotId}`,
      mimeType: "application/json",
    }));
    return mcpSuccess(id, { resources });
  };

  const handleResourcesTemplatesList = (id: string | number): McpResponse => {
    return mcpSuccess(id, { resourceTemplates: RESOURCE_TEMPLATES });
  };

  const handleResourcesRead = async (
    id: string | number,
    params: { uri?: string } | undefined,
    realm: string
  ): Promise<McpResponse> => {
    const uri = params?.uri;
    if (!uri) return mcpError(id, MCP_INVALID_PARAMS, "Missing uri parameter");

    // Parse cas:// URI
    const match = uri.match(/^cas:\/\/(depot|node):([^/]+)(\/(.*))?$/);
    if (!match) return mcpError(id, MCP_INVALID_PARAMS, `Invalid CAS URI: ${uri}`);

    const type = match[1]!; // "depot" or "node"
    const rawId = match[2]!; // ID without prefix
    const path = match[4]; // optional path after /

    if (type === "depot") {
      const depotId = rawId.startsWith("dpt_") ? rawId : `dpt_${rawId}`;

      if (!path) {
        // Depot root metadata
        const depot = await depotsDb.get(realm, depotId);
        if (!depot) return mcpError(id, MCP_INVALID_PARAMS, `Depot not found: ${depotId}`);

        return mcpSuccess(id, {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({
                depotId: depot.depotId,
                title: depot.title,
                root: depot.root,
                updatedAt: depot.updatedAt,
              }),
            },
          ],
        });
      }

      // Read file or list directory via depot root
      return await readResourcePath(id, uri, realm, depotId, path);
    }

    if (type === "node") {
      const nodeKey = rawId.startsWith("nod_") ? rawId : `nod_${rawId}`;

      if (!path) {
        // Node metadata (immutable)
        return await readNodeMetadataResource(id, uri, nodeKey);
      }

      // Read file or list directory via immutable node
      return await readResourcePath(id, uri, realm, nodeKey, path);
    }

    return mcpError(id, MCP_INVALID_PARAMS, `Unsupported CAS URI type: ${type}`);
  };

  const readResourcePath = async (
    id: string | number,
    uri: string,
    realm: string,
    nodeKey: string,
    path: string
  ): Promise<McpResponse> => {
    const parsed = parsePath(path);
    if (!parsed.ok) return mcpError(id, MCP_INVALID_PARAMS, `Invalid path: ${parsed.error}`);

    // Try stat to determine type
    const statResult = await fsService.stat(realm, nodeKey, parsed.segments);
    if (isFsError(statResult))
      return mcpError(id, MCP_INVALID_PARAMS, `${statResult.code}: ${statResult.message}`);

    if (statResult.type === "dir") {
      // Directory — return ls result
      const lsResult = await fsService.ls(realm, nodeKey, parsed.segments, 100);
      if (isFsError(lsResult))
        return mcpError(id, MCP_INVALID_PARAMS, `${lsResult.code}: ${lsResult.message}`);

      return mcpSuccess(id, {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(lsResult),
          },
        ],
      });
    }

    // File — return content as text
    const readResult = await fsService.read(realm, nodeKey, parsed.segments);
    if (isFsError(readResult))
      return mcpError(id, MCP_INVALID_PARAMS, `${readResult.code}: ${readResult.message}`);

    const text = new TextDecoder("utf-8", { fatal: false }).decode(readResult.data);
    return mcpSuccess(id, {
      contents: [
        {
          uri,
          mimeType: readResult.contentType,
          text,
        },
      ],
    });
  };

  const readNodeMetadataResource = async (
    id: string | number,
    uri: string,
    nodeKey: string
  ): Promise<McpResponse> => {
    const storageKey = nodeKeyToStorageKey(nodeKey);
    const nodeData = isWellKnownNode(storageKey)
      ? getWellKnownNodeData(storageKey)
      : await storage.get(storageKey);

    if (!nodeData) return mcpError(id, MCP_INVALID_PARAMS, `Node not found: ${nodeKey}`);

    try {
      const node = decodeNode(nodeData);
      let metadata: unknown;

      if (node.kind === "dict") {
        const children: Record<string, string> = {};
        if (node.children && node.childNames) {
          for (let i = 0; i < node.childNames.length; i++) {
            const name = node.childNames[i];
            const childHash = node.children[i];
            if (name && childHash) {
              children[name] = hashToNodeKey(childHash);
            }
          }
        }
        metadata = { key: nodeKey, kind: "dict", payloadSize: node.size, children };
      } else if (node.kind === "file") {
        const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : null;
        metadata = {
          key: nodeKey,
          kind: "file",
          payloadSize: node.size,
          contentType: node.fileInfo?.contentType ?? "application/octet-stream",
          successor,
        };
      } else if (node.kind === "successor") {
        const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : null;
        metadata = { key: nodeKey, kind: "successor", payloadSize: node.size, successor };
      } else {
        return mcpError(id, MCP_INVALID_PARAMS, "Unknown node kind");
      }

      return mcpSuccess(id, {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(metadata),
          },
        ],
      });
    } catch {
      return mcpError(id, MCP_INVALID_PARAMS, "Failed to decode node");
    }
  };

  // --------------------------------------------------------------------------
  // Prompts
  // --------------------------------------------------------------------------

  const handlePromptsList = (id: string | number): McpResponse => {
    return mcpSuccess(id, { prompts: MCP_PROMPTS });
  };

  const handlePromptsGet = (
    id: string | number,
    params: { name?: string; arguments?: Record<string, string> } | undefined
  ): McpResponse => {
    if (!params?.name) return mcpError(id, MCP_INVALID_PARAMS, "Missing prompt name");

    const messages = getPromptMessages(params.name, params.arguments);
    if (!messages) {
      // Check if the prompt exists but args are missing
      const prompt = MCP_PROMPTS.find((p) => p.name === params.name);
      if (prompt) {
        const requiredArg = prompt.arguments?.find((a) => a.required);
        if (requiredArg) {
          return mcpError(id, MCP_INVALID_PARAMS, `Missing required argument: ${requiredArg.name}`);
        }
      }
      return mcpError(id, MCP_METHOD_NOT_FOUND, `Unknown prompt: ${params.name}`);
    }

    return mcpSuccess(id, { messages });
  };

  // --------------------------------------------------------------------------
  // Main Router
  // --------------------------------------------------------------------------

  return {
    handle: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;

      // Parse request
      let request: McpRequest;
      try {
        request = await c.req.json();
      } catch {
        return c.json(mcpError(0, MCP_PARSE_ERROR, "Parse error"));
      }

      if (request.jsonrpc !== "2.0" || !request.method) {
        return c.json(mcpError(request.id ?? 0, MCP_INVALID_REQUEST, "Invalid request"));
      }

      // Route to handler
      let response: McpResponse;

      switch (request.method) {
        // Protocol
        case "initialize":
          response = handleInitialize(request.id);
          break;

        // Tools
        case "tools/list":
          response = handleToolsList(request.id);
          break;
        case "tools/call":
          response = await handleToolsCall(
            request.id,
            request.params as { name: string; arguments?: Record<string, unknown> },
            auth
          );
          break;

        // Resources
        case "resources/list":
          response = await handleResourcesList(request.id, auth.realm);
          break;
        case "resources/templates/list":
          response = handleResourcesTemplatesList(request.id);
          break;
        case "resources/read":
          response = await handleResourcesRead(
            request.id,
            request.params as { uri?: string },
            auth.realm
          );
          break;

        // Prompts
        case "prompts/list":
          response = handlePromptsList(request.id);
          break;
        case "prompts/get":
          response = handlePromptsGet(
            request.id,
            request.params as { name?: string; arguments?: Record<string, string> }
          );
          break;

        default:
          response = mcpError(
            request.id,
            MCP_METHOD_NOT_FOUND,
            `Method not found: ${request.method}`
          );
      }

      return c.json(response);
    },
  };
};
