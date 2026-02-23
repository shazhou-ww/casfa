/**
 * Chunks controller
 *
 * Handles node upload (PUT), nodes/check, node retrieval (GET),
 * and node navigation (GET /nodes/raw/:key/~0/~1).
 *
 * Children reference validation uses ownership-only checks (no proof headers).
 * See docs/proof-inline-migration/README.md §6.1.
 */

import {
  decodeNode,
  getWellKnownNodeData,
  isWellKnownNode,
  type KeyProvider,
  validateNode,
  validateNodeStructure,
} from "@casfa/core";
import {
  type CheckNodesResponse,
  CheckNodesSchema,
  type DictNodeMetadata,
  type FileNodeMetadata,
  hashToNodeKey,
  type NodeUploadResponse,
  nodeKeyToStorageKey,
  type SuccessorNodeMetadata,
  storageKeyToNodeKey,
} from "@casfa/protocol";
import type { StorageProvider } from "@casfa/storage-core";
import type { Context } from "hono";
import type { OwnershipV2Db } from "../db/ownership-v2.ts";
import type { RefCountDb } from "../db/refcount.ts";
import type { UsageDb } from "../db/usage.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";

export type ChunksController = {
  checkNodes: (c: Context<Env>) => Promise<Response>;
  put: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  getMetadata: (c: Context<Env>) => Promise<Response>;
  /** GET /nodes/raw/:key/~0/~1/... — navigate from :key along ~N index path */
  getNavigated: (c: Context<Env>) => Promise<Response>;
  /** GET /nodes/metadata/:key/~0/~1/... — navigate then return metadata */
  getMetadataNavigated: (c: Context<Env>) => Promise<Response>;
  /** GET /cas/:key — serve decoded content (d-node→JSON, f-node→file, s-node→error) */
  getCasContent: (c: Context<Env>) => Promise<Response>;
  /** GET /cas/:key/~0/~1/... — navigate then serve decoded content */
  getCasContentNavigated: (c: Context<Env>) => Promise<Response>;
};

type ChunksControllerDeps = {
  storage: StorageProvider;
  keyProvider: KeyProvider;
  ownershipV2Db: OwnershipV2Db;
  refCountDb: RefCountDb;
  usageDb: UsageDb;
};

export const createChunksController = (deps: ChunksControllerDeps): ChunksController => {
  const { storage, keyProvider, ownershipV2Db, refCountDb, usageDb } = deps;

  const getRealm = (c: Context<Env>): string => {
    return c.req.param("realmId") ?? c.get("auth").realm;
  };

  // Convert node key to CB32 storage key
  const toStorageKey = (nodeKey: string): string => nodeKeyToStorageKey(nodeKey);

  return {
    checkNodes: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;
      const _realm = getRealm(c);
      const { keys } = CheckNodesSchema.parse(await c.req.json());

      // Delegate chain = [root, ..., self] — all ancestors that share ownership
      const delegateChain = auth.issuerChain;

      const missing: string[] = [];
      const owned: string[] = [];
      const unowned: string[] = [];

      for (const key of keys) {
        const storageKey = toStorageKey(key);

        // Well-known nodes — always exist and are "owned"
        if (isWellKnownNode(storageKey)) {
          owned.push(key);
          continue;
        }

        // First check if the node physically exists in storage
        const exists = (await storage.get(storageKey)) !== null;
        if (!exists) {
          missing.push(key);
          continue;
        }

        // Node exists — check if any delegate in the chain owns it (O(1) per delegate)
        let isOwned = false;
        for (const id of delegateChain) {
          if (await ownershipV2Db.hasOwnership(storageKey, id)) {
            isOwned = true;
            break;
          }
        }

        if (isOwned) {
          owned.push(key);
        } else {
          unowned.push(key);
        }
      }

      return c.json<CheckNodesResponse>({ missing, owned, unowned });
    },

    put: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;
      const realm = getRealm(c);
      const nodeKey = decodeURIComponent(c.req.param("key"));
      const storageKey = toStorageKey(nodeKey);

      // Get binary content
      const arrayBuffer = await c.req.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      if (bytes.length === 0) {
        return c.json({ error: "Empty body" }, 400);
      }

      // Quick structure validation
      const structureResult = validateNodeStructure(bytes);
      if (!structureResult.valid) {
        return c.json({ error: "Invalid node structure", details: structureResult.error }, 400);
      }

      // Full validation (use storageKey which is hex format)
      // existsChecker must handle well-known nodes which are virtual (never persisted to storage)
      const validationResult = await validateNode(bytes, storageKey, keyProvider, (childKey) =>
        isWellKnownNode(childKey)
          ? Promise.resolve(true)
          : storage.get(childKey).then((v) => v !== null)
      );

      if (!validationResult.valid) {
        if (validationResult.error?.includes("Missing children")) {
          return c.json(
            {
              success: false,
              error: "missing_nodes",
              missing: (validationResult.missingChildKeys ?? []).map(storageKeyToNodeKey),
            },
            409
          );
        }
        return c.json({ error: "Node validation failed", details: validationResult.error }, 400);
      }

      // Calculate sizes
      const physicalSize = bytes.length;
      // File and successor nodes have data content; dict nodes are just directories
      const logicalSize =
        structureResult.kind !== "dict" ? (validationResult.size ?? bytes.length) : 0;
      const childKeys = validationResult.childKeys ?? [];

      // ---- Children reference validation (ownership-only, §6.1) ----
      // All child nodes must be owned by the delegate chain.
      // No proof headers needed — if child is not owned, client must claim first.
      const ownerId = auth.delegateId;
      const delegateChain = auth.issuerChain;

      if (childKeys.length > 0) {
        // Root delegate (depth=0) skips child ownership checks
        if (auth.delegate.depth > 0) {
          const unauthorized: string[] = [];

          for (const childKey of childKeys) {
            // Well-known nodes are universally owned — skip ownership check
            if (isWellKnownNode(childKey)) {
              continue;
            }

            // Ownership verification — check if any delegate in chain owns this child
            let authorized = false;
            for (const id of delegateChain) {
              if (await ownershipV2Db.hasOwnership(childKey, id)) {
                authorized = true;
                break;
              }
            }

            if (!authorized) {
              unauthorized.push(childKey);
            }
          }

          if (unauthorized.length > 0) {
            return c.json(
              {
                error: "CHILD_NOT_AUTHORIZED",
                message: "Not authorized to reference these child nodes",
                unauthorized: unauthorized.map(storageKeyToNodeKey),
              },
              403
            );
          }
        }
      }

      // Check realm quota
      const existingRef = await refCountDb.getRefCount(realm, storageKey);
      const estimatedNewBytes = existingRef ? 0 : physicalSize;

      if (estimatedNewBytes > 0) {
        const { allowed, usage } = await usageDb.checkQuota(realm, estimatedNewBytes);
        if (!allowed) {
          return c.json(
            {
              error: "REALM_QUOTA_EXCEEDED",
              message: "Upload would exceed realm storage quota",
              details: {
                limit: usage.quotaLimit,
                used: usage.physicalBytes,
                requested: estimatedNewBytes,
              },
            },
            403
          );
        }
      }

      // Store the node
      await storage.put(storageKey, bytes);

      // Full-chain ownership write (one record per delegate in the chain)
      await ownershipV2Db.addOwnership(
        storageKey,
        delegateChain,
        ownerId,
        "application/octet-stream",
        validationResult.size ?? bytes.length,
        validationResult.kind
      );

      // Increment reference count
      const { isNewToRealm } = await refCountDb.incrementRef(
        realm,
        storageKey,
        physicalSize,
        logicalSize
      );

      // Increment ref for children
      for (const childKey of childKeys) {
        const childRef = await refCountDb.getRefCount(realm, childKey);
        if (childRef) {
          await refCountDb.incrementRef(
            realm,
            childKey,
            childRef.physicalSize,
            childRef.logicalSize
          );
        } else {
          // Child has no refcount record yet — create one.
          // This happens for well-known nodes (e.g. empty d-node) or nodes
          // that were claimed/owned but never went through the PUT path.
          const childData = isWellKnownNode(childKey)
            ? getWellKnownNodeData(childKey)
            : await storage.get(childKey);
          if (childData) {
            let childLogicalSize = 0;
            try {
              const childNode = decodeNode(childData);
              if (childNode.kind !== "dict") {
                childLogicalSize = childNode.fileInfo?.fileSize ?? childData.length;
              }
            } catch {}
            await refCountDb.incrementRef(realm, childKey, childData.length, childLogicalSize);
          }
        }
      }

      // Update usage
      if (isNewToRealm) {
        await usageDb.updateUsage(realm, {
          physicalBytes: physicalSize,
          logicalBytes: logicalSize,
          nodeCount: 1,
        });
      }

      return c.json<NodeUploadResponse>({
        key: nodeKey,
        payloadSize: validationResult.size ?? 0,
        kind: validationResult.kind!,
      });
    },

    get: async (c) => {
      const _realm = getRealm(c);
      const nodeKey = decodeURIComponent(c.req.param("key"));
      const key = toStorageKey(nodeKey);

      // Well-known nodes — always accessible, served from memory
      const wellKnownData = getWellKnownNodeData(key);
      if (wellKnownData) {
        let kind: string | undefined;
        let size: number | undefined;
        try {
          const node = decodeNode(wellKnownData);
          kind = node.kind;
          size = node.size;
        } catch {}
        const headers: Record<string, string> = {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(wellKnownData.length),
        };
        if (kind) headers["X-CAS-Kind"] = kind;
        if (size !== undefined) headers["X-CAS-Payload-Size"] = String(size);
        return new Response(wellKnownData, { status: 200, headers });
      }

      // Check ownership
      const hasAccess = await ownershipV2Db.hasAnyOwnership(key);
      if (!hasAccess) {
        return c.json({ error: "not_found", message: "Node not found" }, 404);
      }

      // Get content
      const bytes = await storage.get(key);
      if (!bytes) {
        return c.json({ error: "not_found", message: "Node content not found" }, 404);
      }

      // Decode metadata
      let kind: string | undefined;
      let size: number | undefined;
      let contentType: string | undefined;
      try {
        const node = decodeNode(bytes);
        kind = node.kind;
        size = node.size;
        contentType = node.fileInfo?.contentType;
      } catch {
        // If decode fails, just return raw
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
      };
      if (kind) headers["X-CAS-Kind"] = kind;
      if (size !== undefined) headers["X-CAS-Payload-Size"] = String(size);
      if (contentType) headers["X-CAS-Content-Type"] = contentType;

      return new Response(bytes, { status: 200, headers });
    },

    getMetadata: async (c) => {
      const realm = getRealm(c);
      const nodeKey = decodeURIComponent(c.req.param("key"));
      const key = toStorageKey(nodeKey);

      // Well-known nodes — always accessible, decode from memory
      const wellKnownData = getWellKnownNodeData(key);
      if (wellKnownData) {
        // Re-use the same decode logic below by assigning bytes
        const bytes = wellKnownData;
        // Well-known nodes can still have per-realm refcount (from parent references)
        const wkRefRecord = await refCountDb.getRefCount(realm, key);
        const wkRefCount = wkRefRecord?.count ?? 0;
        try {
          const node = decodeNode(bytes);
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
            return c.json<DictNodeMetadata>({
              key: nodeKey,
              kind: "dict",
              payloadSize: node.size,
              children,
              refCount: wkRefCount,
            });
          }
          if (node.kind === "file") {
            const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : null;
            return c.json<FileNodeMetadata>({
              key: nodeKey,
              kind: "file",
              payloadSize: node.size,
              contentType: node.fileInfo?.contentType ?? "application/octet-stream",
              successor,
              refCount: wkRefCount,
            });
          }
        } catch {}
        return c.json({ error: "invalid_node", message: "Failed to decode well-known node" }, 400);
      }

      // Check ownership
      const hasAccess = await ownershipV2Db.hasAnyOwnership(key);
      if (!hasAccess) {
        return c.json({ error: "not_found", message: "Node not found" }, 404);
      }

      // Get content
      const bytes = await storage.get(key);
      if (!bytes) {
        return c.json({ error: "not_found", message: "Node content not found" }, 404);
      }

      try {
        const node = decodeNode(bytes);
        // nodeKey is already provided by the request

        // Fetch refcount for this node in the current realm
        const refCountRecord = await refCountDb.getRefCount(realm, key);
        const refCount = refCountRecord?.count ?? 0;

        if (node.kind === "dict") {
          // d-node: directory
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
          return c.json<DictNodeMetadata>({
            key: nodeKey,
            kind: "dict",
            payloadSize: node.size,
            children,
            refCount,
          });
        }

        if (node.kind === "file") {
          // f-node: file
          const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : null;
          return c.json<FileNodeMetadata>({
            key: nodeKey,
            kind: "file",
            payloadSize: node.size,
            contentType: node.fileInfo?.contentType ?? "application/octet-stream",
            successor,
            refCount,
          });
        }

        if (node.kind === "successor") {
          // s-node: continuation
          const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : null;
          return c.json<SuccessorNodeMetadata>({
            key: nodeKey,
            kind: "successor",
            payloadSize: node.size,
            successor,
            refCount,
          });
        }

        return c.json({ error: "invalid_node", message: "Unknown node kind" }, 400);
      } catch {
        return c.json({ error: "invalid_node", message: "Failed to decode node" }, 400);
      }
    },

    // ========================================================================
    // Navigation handlers (GET /nodes/raw/:key/~0/~1/..., GET /nodes/metadata/:key/~0/~1/...)
    // ========================================================================

    getNavigated: async (c) => {
      const nodeKey = decodeURIComponent(c.req.param("key"));
      const nav = await navigateToTarget(c, nodeKey, storage, toStorageKey);
      if (!nav.ok) return c.json({ error: nav.error, message: nav.message }, nav.status);

      // Get content
      const bytes = await storage.get(nav.storageKey);
      if (!bytes) {
        return c.json({ error: "not_found", message: "Navigated node content not found" }, 404);
      }

      let kind: string | undefined;
      let size: number | undefined;
      let contentType: string | undefined;
      try {
        const node = decodeNode(bytes);
        kind = node.kind;
        size = node.size;
        contentType = node.fileInfo?.contentType;
      } catch {}

      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
      };
      if (kind) headers["X-CAS-Kind"] = kind;
      if (size !== undefined) headers["X-CAS-Payload-Size"] = String(size);
      if (contentType) headers["X-CAS-Content-Type"] = contentType;

      return new Response(bytes, { status: 200, headers });
    },

    getMetadataNavigated: async (c) => {
      const realm = getRealm(c);
      const nodeKey = decodeURIComponent(c.req.param("key"));
      const nav = await navigateToTarget(c, nodeKey, storage, toStorageKey);
      if (!nav.ok) return c.json({ error: nav.error, message: nav.message }, nav.status);

      const bytes = await storage.get(nav.storageKey);
      if (!bytes) {
        return c.json({ error: "not_found", message: "Navigated node content not found" }, 404);
      }

      try {
        const node = decodeNode(bytes);
        const navRefRecord = await refCountDb.getRefCount(realm, nav.storageKey);
        const navRefCount = navRefRecord?.count ?? 0;
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
          return c.json<DictNodeMetadata>({
            key: nav.nodeKey,
            kind: "dict",
            payloadSize: node.size,
            children,
            refCount: navRefCount,
          });
        }
        if (node.kind === "file") {
          const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : null;
          return c.json<FileNodeMetadata>({
            key: nav.nodeKey,
            kind: "file",
            payloadSize: node.size,
            contentType: node.fileInfo?.contentType ?? "application/octet-stream",
            successor,
            refCount: navRefCount,
          });
        }
        if (node.kind === "successor") {
          const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : null;
          return c.json<SuccessorNodeMetadata>({
            key: nav.nodeKey,
            kind: "successor",
            payloadSize: node.size,
            successor,
            refCount: navRefCount,
          });
        }
        return c.json({ error: "invalid_node", message: "Unknown node kind" }, 400);
      } catch {
        return c.json({ error: "invalid_node", message: "Failed to decode node" }, 400);
      }
    },

    getCasContent: async (c) => {
      const nodeKey = decodeURIComponent(c.req.param("key"));
      const key = toStorageKey(nodeKey);

      // Well-known nodes
      const wellKnownData = getWellKnownNodeData(key);
      const bytes = wellKnownData ?? (await storage.get(key));
      if (!bytes) {
        return c.json({ error: "not_found", message: "Node not found" }, 404);
      }

      return serveCasContent(c, nodeKey, bytes);
    },

    getCasContentNavigated: async (c) => {
      const nodeKey = decodeURIComponent(c.req.param("key"));
      const nav = await navigateToTarget(c, nodeKey, storage, toStorageKey);
      if (!nav.ok) return c.json({ error: nav.error, message: nav.message }, nav.status);

      const bytes = await storage.get(nav.storageKey);
      if (!bytes) {
        return c.json({ error: "not_found", message: "Navigated node content not found" }, 404);
      }

      return serveCasContent(c, nav.nodeKey, bytes);
    },
  };
};

// ============================================================================
// CAS content serving helper
// ============================================================================

/**
 * Serve decoded CAS content based on node type:
 * - d-node (dict): JSON object with children names → node keys
 * - f-node (file): raw file content with proper Content-Type (single-block only)
 * - s-node (successor): error — not directly servable
 * - set: error — not directly servable
 */
function serveCasContent(c: Context<Env>, nodeKey: string, bytes: Uint8Array): Response {
  let node: ReturnType<typeof decodeNode>;
  try {
    node = decodeNode(bytes);
  } catch {
    return c.json(
      { error: "invalid_node", message: "Failed to decode node" },
      400
    ) as unknown as Response;
  }

  const immutableCache = "public, max-age=31536000, immutable";

  switch (node.kind) {
    case "dict": {
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
      return c.json({ type: "dict", key: nodeKey, children }, 200, {
        "Cache-Control": immutableCache,
      }) as unknown as Response;
    }

    case "file": {
      // Only single-block files are supported
      if (node.children && node.children.length > 0) {
        return c.json(
          {
            error: "multi_block_unsupported",
            message:
              "Multi-block files cannot be served via /cas/. Use the nodes/raw API to reassemble.",
          },
          422
        ) as unknown as Response;
      }

      const contentType = node.fileInfo?.contentType || "application/octet-stream";
      const data = node.data ?? new Uint8Array(0);

      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(data.length),
          "Cache-Control": immutableCache,
          "X-CAS-Key": nodeKey,
        },
      });
    }

    case "successor":
      return c.json(
        {
          error: "unsupported_node_type",
          message: "Successor nodes cannot be served directly via /cas/",
        },
        422
      ) as unknown as Response;

    case "set":
      return c.json(
        {
          error: "unsupported_node_type",
          message: "Set nodes cannot be served directly via /cas/",
        },
        422
      ) as unknown as Response;

    default:
      return c.json(
        { error: "invalid_node", message: "Unknown node kind" },
        400
      ) as unknown as Response;
  }
}

// ============================================================================
// Navigation helper
// ============================================================================

type NavigationResult =
  | { ok: true; nodeKey: string; storageKey: string }
  | { ok: false; error: string; message: string; status: 400 | 404 };

/**
 * Parse ~N segments from the wildcard path and walk the DAG from startKey.
 * Returns the navigated node key (nod_...) or an error descriptor.
 */
async function navigateToTarget(
  c: Context<Env>,
  startNodeKey: string,
  storage: StorageProvider,
  toStorageKey: (nk: string) => string
): Promise<NavigationResult> {
  // Hono captures the wildcard as a single string (e.g. "~0/~1/~2")
  const wildcard = c.req.url
    .split(`/${encodeURIComponent(startNodeKey)}/`)
    .slice(1)
    .join("/")
    .split("?")[0];
  if (!wildcard) {
    return { ok: false, error: "INVALID_REQUEST", message: "Missing navigation path", status: 400 };
  }

  const segments = wildcard.split("/").filter(Boolean);

  // Validate all segments are ~N format
  for (const seg of segments) {
    if (!/^~\d+$/.test(seg)) {
      return {
        ok: false,
        error: "INVALID_PATH",
        message: `Invalid navigation segment: ${seg}. Expected ~N format.`,
        status: 404,
      };
    }
  }

  if (segments.length === 0) {
    return { ok: false, error: "INVALID_REQUEST", message: "Empty navigation path", status: 400 };
  }

  let currentStorageKey = toStorageKey(startNodeKey);

  for (const seg of segments) {
    const index = Number.parseInt(seg.slice(1), 10);

    const nodeData = await storage.get(currentStorageKey);
    if (!nodeData) {
      return {
        ok: false,
        error: "not_found",
        message: `Node not found during navigation`,
        status: 404,
      };
    }

    let decoded: ReturnType<typeof decodeNode>;
    try {
      decoded = decodeNode(nodeData);
    } catch {
      return {
        ok: false,
        error: "invalid_node",
        message: `Failed to decode node during navigation`,
        status: 400,
      };
    }

    if (!decoded.children || index >= decoded.children.length) {
      return {
        ok: false,
        error: "CHILD_INDEX_OUT_OF_BOUNDS",
        message: `Child index ${index} out of bounds (node has ${decoded.children?.length ?? 0} children)`,
        status: 404,
      };
    }

    const childHash = decoded.children[index]!;
    const childNodeKey = hashToNodeKey(childHash);
    currentStorageKey = toStorageKey(childNodeKey);
  }

  return {
    ok: true,
    nodeKey: storageKeyToNodeKey(currentStorageKey),
    storageKey: currentStorageKey,
  };
}
