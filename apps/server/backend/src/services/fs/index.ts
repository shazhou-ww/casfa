/**
 * Filesystem Service — Server Adapter
 *
 * Wraps @casfa/fs with server-specific concerns:
 * - Ownership / refcount / usage bookkeeping via `onNodeStored` hook
 * - Depot key resolution via `resolveNodeKey` hook
 * - Link authorization via `authorizeLink` hook
 *
 * The controller layer passes realm / ownerId / auth for each call.
 * This adapter captures those in closures when building per-call FsContext.
 */

import { isWellKnownNode } from "@casfa/core";
import {
  type AuthorizeLinkFn,
  type FsService as CoreFsService,
  createFsService as createCoreFsService,
  type FsContext,
} from "@casfa/fs";
import type {
  FsCpResponse,
  FsLsResponse,
  FsMkdirResponse,
  FsMvResponse,
  FsRewriteEntry,
  FsRewriteResponse,
  FsRmResponse,
  FsStatResponse,
  FsWriteResponse,
} from "@casfa/protocol";
import { nodeKeyToStorageKey } from "@casfa/protocol";
import type { AccessTokenAuthContext } from "../../types.ts";
import { type ScopeProofDeps, validateProofAgainstScope } from "../../util/scope-proof.ts";
import type { FsServiceDeps } from "./types.ts";

// ============================================================================
// Re-exports
// ============================================================================

export { fsError } from "@casfa/fs";
export { type FsError, type FsServiceDeps, isFsError } from "./types.ts";

// ============================================================================
// Service Type
// ============================================================================

export type FsService = {
  stat(
    realm: string,
    rootNodeKey: string,
    pathStr?: string,
    indexPathStr?: string
  ): Promise<FsStatResponse | FsError>;
  read(
    realm: string,
    rootNodeKey: string,
    pathStr?: string,
    indexPathStr?: string
  ): Promise<{ data: Uint8Array; contentType: string; size: number; key: string } | FsError>;
  ls(
    realm: string,
    rootNodeKey: string,
    pathStr?: string,
    indexPathStr?: string,
    limit?: number,
    cursor?: string
  ): Promise<FsLsResponse | FsError>;
  write(
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    pathStr: string | undefined,
    indexPathStr: string | undefined,
    fileContent: Uint8Array,
    contentType: string
  ): Promise<FsWriteResponse | FsError>;
  mkdir(
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    pathStr: string
  ): Promise<FsMkdirResponse | FsError>;
  rm(
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    pathStr?: string,
    indexPathStr?: string
  ): Promise<FsRmResponse | FsError>;
  mv(
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    fromPath: string,
    toPath: string
  ): Promise<FsMvResponse | FsError>;
  cp(
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    fromPath: string,
    toPath: string
  ): Promise<FsCpResponse | FsError>;
  rewrite(
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    entries?: Record<string, FsRewriteEntry>,
    deletes?: string[],
    issuerChain?: string[],
    issuerId?: string,
    auth?: AccessTokenAuthContext
  ): Promise<FsRewriteResponse | FsError>;
  resolveNodeKey(realm: string, nodeKey: string): Promise<string | FsError>;
};

type FsError = import("./types.ts").FsError;

// ============================================================================
// Factory
// ============================================================================

export const createFsService = (deps: FsServiceDeps): FsService => {
  const { storage, keyProvider, ownershipV2Db, refCountDb, usageDb, depotsDb, scopeSetNodesDb } =
    deps;

  // --------------------------------------------------------------------------
  // Per-call context builders
  // --------------------------------------------------------------------------

  /**
   * Create a FsContext that captures realm + ownerId for bookkeeping hooks.
   */
  const makeFsContext = (realm: string, ownerId: string): FsContext => ({
    storage,
    key: keyProvider,

    onNodeStored: async (info) => {
      // Always ensure ownership (idempotent)
      await ownershipV2Db.addOwnership(
        info.storageKey,
        [ownerId],
        ownerId,
        "application/octet-stream",
        info.logicalSize,
        info.kind
      );
      // Increment refcount — returns whether this is the first ref in the realm
      const { isNewToRealm } = await refCountDb.incrementRef(
        realm,
        info.storageKey,
        info.bytes.length,
        info.logicalSize
      );
      // Only update usage if this node is new to the realm
      if (isNewToRealm) {
        await usageDb.updateUsage(realm, {
          physicalBytes: info.bytes.length,
          logicalBytes: info.logicalSize,
          nodeCount: 1,
        });
      }
    },

    resolveNodeKey: async (nodeKey: string) => {
      if (nodeKey.startsWith("dpt_")) {
        const depot = await depotsDb.get(realm, nodeKey);
        if (!depot) {
          return { code: "INVALID_ROOT", status: 400, message: `Depot not found: ${nodeKey}` };
        }
        return nodeKeyToStorageKey(depot.root);
      }
      return { code: "INVALID_ROOT", status: 400, message: `Invalid nodeKey format: ${nodeKey}` };
    },
  });

  /**
   * Create an authorizeLink function that captures auth context.
   */
  const makeAuthorizeLink = (
    issuerChain?: string[],
    _issuerId?: string,
    auth?: AccessTokenAuthContext
  ): AuthorizeLinkFn => {
    return async (linkStorageKey: string, proof?: string) => {
      // Well-known nodes are universally owned
      if (isWellKnownNode(linkStorageKey)) {
        return true;
      }

      // Step 1: ownership verification using delegate chain
      if (issuerChain && issuerChain.length > 0) {
        for (const id of issuerChain) {
          if (await ownershipV2Db.hasOwnership(linkStorageKey, id)) {
            return true;
          }
        }
      }

      // Step 2: scope verification (proof) — only if uploader verification failed
      if (proof && auth) {
        const scopeProofDeps: ScopeProofDeps = {
          storage,
          scopeSetNodesDb,
        };
        return validateProofAgainstScope(proof, linkStorageKey, auth, scopeProofDeps);
      }

      return false;
    };
  };

  // --------------------------------------------------------------------------
  // Helper: create a core fs service for a specific call context
  // --------------------------------------------------------------------------

  const getReadService = (realm: string): CoreFsService => {
    // Read-only — no ownerId needed, empty string is fine
    return createCoreFsService({ ctx: makeFsContext(realm, "") });
  };

  const getWriteService = (
    realm: string,
    ownerId: string,
    issuerChain?: string[],
    issuerId?: string,
    auth?: AccessTokenAuthContext
  ): CoreFsService => {
    return createCoreFsService({
      ctx: makeFsContext(realm, ownerId),
      authorizeLink: makeAuthorizeLink(issuerChain, issuerId, auth),
    });
  };

  // --------------------------------------------------------------------------
  // Adapter methods — match server's existing FsService signatures
  // --------------------------------------------------------------------------

  return {
    stat: (realm, rootNodeKey, pathStr?, indexPathStr?) => {
      return getReadService(realm).stat(rootNodeKey, pathStr, indexPathStr);
    },

    read: (realm, rootNodeKey, pathStr?, indexPathStr?) => {
      return getReadService(realm).read(rootNodeKey, pathStr, indexPathStr);
    },

    ls: (realm, rootNodeKey, pathStr?, indexPathStr?, limit?, cursor?) => {
      return getReadService(realm).ls(rootNodeKey, pathStr, indexPathStr, limit, cursor);
    },

    write: (realm, ownerId, rootNodeKey, pathStr, indexPathStr, fileContent, contentType) => {
      return getWriteService(realm, ownerId).write(
        rootNodeKey,
        pathStr,
        indexPathStr,
        fileContent,
        contentType
      );
    },

    mkdir: (realm, ownerId, rootNodeKey, pathStr) => {
      return getWriteService(realm, ownerId).mkdir(rootNodeKey, pathStr);
    },

    rm: (realm, ownerId, rootNodeKey, pathStr?, indexPathStr?) => {
      return getWriteService(realm, ownerId).rm(rootNodeKey, pathStr, indexPathStr);
    },

    mv: (realm, ownerId, rootNodeKey, fromPath, toPath) => {
      return getWriteService(realm, ownerId).mv(rootNodeKey, fromPath, toPath);
    },

    cp: (realm, ownerId, rootNodeKey, fromPath, toPath) => {
      return getWriteService(realm, ownerId).cp(rootNodeKey, fromPath, toPath);
    },

    rewrite: (realm, ownerId, rootNodeKey, entries?, deletes?, issuerChain?, issuerId?, auth?) => {
      return getWriteService(realm, ownerId, issuerChain, issuerId, auth).rewrite(
        rootNodeKey,
        entries,
        deletes
      );
    },

    resolveNodeKey: (realm, nodeKey) => {
      return getReadService(realm).resolveNodeKey(nodeKey);
    },
  };
};
