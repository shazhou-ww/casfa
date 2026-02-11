/**
 * Chunks controller
 *
 * Handles node upload (PUT), nodes/check, and node retrieval (GET).
 * Implements ownership model with multi-owner tracking and children reference validation.
 */

import {
  decodeNode,
  getWellKnownNodeData,
  type HashProvider,
  isWellKnownNode,
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
} from "@casfa/protocol";
import type { StorageProvider } from "@casfa/storage-core";
import type { Context } from "hono";
import type { OwnershipV2Db } from "../db/ownership-v2.ts";
import type { RefCountDb } from "../db/refcount.ts";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes.ts";
import type { UsageDb } from "../db/usage.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";
import { parseChildProofsHeader, validateProofAgainstScope } from "../util/scope-proof.ts";

export type ChunksController = {
  checkNodes: (c: Context<Env>) => Promise<Response>;
  put: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  getMetadata: (c: Context<Env>) => Promise<Response>;
};

type ChunksControllerDeps = {
  storage: StorageProvider;
  hashProvider: HashProvider;
  ownershipV2Db: OwnershipV2Db;
  refCountDb: RefCountDb;
  usageDb: UsageDb;
  scopeSetNodesDb: ScopeSetNodesDb;
};

export const createChunksController = (deps: ChunksControllerDeps): ChunksController => {
  const { storage, hashProvider, ownershipV2Db, refCountDb, usageDb, scopeSetNodesDb } = deps;

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
        const exists = await storage.has(storageKey);
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
      const validationResult = await validateNode(bytes, storageKey, hashProvider, (childKey) =>
        storage.has(childKey)
      );

      if (!validationResult.valid) {
        if (validationResult.error?.includes("Missing children")) {
          return c.json({
            success: false,
            error: "missing_nodes",
            missing: validationResult.childKeys ?? [],
          });
        }
        return c.json({ error: "Node validation failed", details: validationResult.error }, 400);
      }

      // Calculate sizes
      const physicalSize = bytes.length;
      // File and successor nodes have data content; dict nodes are just directories
      const logicalSize =
        structureResult.kind !== "dict" ? (validationResult.size ?? bytes.length) : 0;
      const childKeys = validationResult.childKeys ?? [];

      // ---- Children reference validation (see put-node-children-auth.md §4) ----
      // Owner ID: the current delegate
      const ownerId = auth.delegateId;
      const delegateChain = auth.issuerChain;

      if (childKeys.length > 0) {
        // Parse X-CAS-Child-Proofs header for scope proofs
        const childProofs = parseChildProofsHeader(c.req.header("X-CAS-Child-Proofs"));

        const unauthorized: string[] = [];

        for (const childKey of childKeys) {
          // Well-known nodes are universally owned — skip ownership check
          if (isWellKnownNode(childKey)) {
            continue;
          }

          // Step 1: ownership verification — check if any delegate in chain owns this child
          let authorized = false;
          for (const id of delegateChain) {
            if (await ownershipV2Db.hasOwnership(childKey, id)) {
              authorized = true;
              break;
            }
          }

          // Step 2: scope verification (proof) — only if ownership verification failed
          if (!authorized) {
            const proof = childProofs.get(childKey);
            if (proof) {
              authorized = await validateProofAgainstScope(proof, childKey, auth, {
                storage,
                scopeSetNodesDb,
              });
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
              unauthorized,
            },
            403
          );
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
      const _realm = getRealm(c);
      const nodeKey = decodeURIComponent(c.req.param("key"));
      const key = toStorageKey(nodeKey);

      // Well-known nodes — always accessible, decode from memory
      const wellKnownData = getWellKnownNodeData(key);
      if (wellKnownData) {
        // Re-use the same decode logic below by assigning bytes
        const bytes = wellKnownData;
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
            });
          }
          if (node.kind === "file") {
            const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : undefined;
            return c.json<FileNodeMetadata>({
              key: nodeKey,
              kind: "file",
              payloadSize: node.size,
              contentType: node.fileInfo?.contentType ?? "application/octet-stream",
              successor,
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
          });
        }

        if (node.kind === "file") {
          // f-node: file
          const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : undefined;
          return c.json<FileNodeMetadata>({
            key: nodeKey,
            kind: "file",
            payloadSize: node.size,
            contentType: node.fileInfo?.contentType ?? "application/octet-stream",
            successor,
          });
        }

        if (node.kind === "successor") {
          // s-node: continuation
          const successor = node.children?.[0] ? hashToNodeKey(node.children[0]) : undefined;
          return c.json<SuccessorNodeMetadata>({
            key: nodeKey,
            kind: "successor",
            payloadSize: node.size,
            successor,
          });
        }

        return c.json({ error: "invalid_node", message: "Unknown node kind" }, 400);
      } catch {
        return c.json({ error: "invalid_node", message: "Failed to decode node" }, 400);
      }
    },
  };
};
