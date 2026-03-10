/**
 * Delegate Creation Service
 *
 * Shared business logic for creating child delegates.
 * Used by both the HTTP controller and MCP handler.
 */

import type { Delegate } from "@casfa/delegate";
import { buildChain, validateCreateDelegate } from "@casfa/delegate";
import type { DelegatesDb } from "../db/delegates.ts";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes.ts";
import { generateTokenPair } from "../util/delegate-token-utils.ts";
import { toCrockfordBase32 } from "../util/encoding.ts";
import { blake3Hash } from "../util/hashing.ts";
import { resolveRelativeScope } from "../util/scope.ts";
import { generateDelegateId } from "../util/token-id.ts";

// ============================================================================
// Types
// ============================================================================

export type CreateDelegateInput = {
  name?: string;
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope?: string[];
  expiresIn?: number;
  delegatedDepots?: string[];
  tokenTtlSeconds?: number;
};

export type CreateDelegateResult =
  | {
      ok: true;
      delegate: {
        delegateId: string;
        name?: string;
        realm: string;
        parentId: string;
        depth: number;
        canUpload: boolean;
        canManageDepot: boolean;
        delegatedDepots?: string[];
        expiresAt?: number;
        createdAt: number;
      };
      refreshToken: string;
      accessToken: string;
      accessTokenExpiresAt: number;
    }
  | { ok: false; error: string; message: string; status: number };

export type CreateDelegateDeps = {
  delegatesDb: DelegatesDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  getNode: (realm: string, hash: string) => Promise<Uint8Array | null>;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AT_TTL_SECONDS = 3600; // 1 hour

// ============================================================================
// Service
// ============================================================================

export async function createChildDelegate(
  deps: CreateDelegateDeps,
  parentDelegate: Delegate,
  realm: string,
  input: CreateDelegateInput
): Promise<CreateDelegateResult> {
  const { delegatesDb, scopeSetNodesDb, getNode } = deps;

  if (parentDelegate.isRevoked) {
    return {
      ok: false,
      error: "DELEGATE_REVOKED",
      message: "Parent delegate has been revoked",
      status: 403,
    };
  }

  // Resolve scope (relative paths from parent)
  let scopeNodeHash: string | undefined;
  let scopeSetNodeId: string | undefined;

  if (input.scope) {
    const parentScopeRoots = await getParentScopeRoots(parentDelegate, scopeSetNodesDb);
    const getNodeInRealm = async (hash: string) => getNode(realm, hash);
    const scopeResult = await resolveRelativeScope(input.scope, parentScopeRoots, getNodeInRealm);

    if (!scopeResult.valid) {
      return { ok: false, error: "INVALID_SCOPE", message: scopeResult.error!, status: 400 };
    }

    const resolvedRoots = scopeResult.resolvedRoots!;
    if (resolvedRoots.length === 1) {
      scopeNodeHash = resolvedRoots[0];
    } else if (resolvedRoots.length > 1) {
      const setNodeId = toCrockfordBase32(blake3Hash(resolvedRoots.join(",")).slice(0, 16));
      await scopeSetNodesDb.createOrIncrement(setNodeId, resolvedRoots);
      scopeSetNodeId = setNodeId;
    }
  } else {
    // Inherit parent scope
    scopeNodeHash = parentDelegate.scopeNodeHash;
    scopeSetNodeId = parentDelegate.scopeSetNodeId;
  }

  // Build the child delegate
  const newDelegateId = generateDelegateId();
  const chain = buildChain(parentDelegate.chain, newDelegateId);
  const depth = parentDelegate.depth + 1;

  const canUpload = input.canUpload ?? false;
  const canManageDepot = input.canManageDepot ?? false;

  // Validate permissions using @casfa/delegate
  const parentPermissions = {
    canUpload: parentDelegate.canUpload,
    canManageDepot: parentDelegate.canManageDepot,
    depth: parentDelegate.depth,
    expiresAt: parentDelegate.expiresAt,
  };

  const childInput = {
    canUpload,
    canManageDepot,
    delegatedDepots: input.delegatedDepots,
    expiresAt: input.expiresIn ? Date.now() + input.expiresIn * 1000 : undefined,
  };

  const parentManageableDepots = new Set<string>(parentDelegate.delegatedDepots ?? []);

  const validationResult = validateCreateDelegate(
    parentPermissions,
    childInput,
    parentManageableDepots
  );

  if (!validationResult.valid) {
    return {
      ok: false,
      error: "PERMISSION_ESCALATION",
      message: validationResult.message!,
      status: 400,
    };
  }

  const now = Date.now();
  const expiresAt = input.expiresIn ? now + input.expiresIn * 1000 : undefined;

  // Generate RT + AT pair
  const tokenPair = generateTokenPair({
    delegateId: newDelegateId,
    accessTokenTtlSeconds: input.tokenTtlSeconds ?? DEFAULT_AT_TTL_SECONDS,
  });

  const newDelegate: Delegate = {
    delegateId: newDelegateId,
    name: input.name,
    realm,
    parentId: parentDelegate.delegateId,
    chain,
    depth,
    canUpload,
    canManageDepot,
    delegatedDepots: input.delegatedDepots,
    scopeNodeHash,
    scopeSetNodeId,
    expiresAt,
    isRevoked: false,
    createdAt: now,
    currentRtHash: tokenPair.refreshToken.hash,
    currentAtHash: tokenPair.accessToken.hash,
    atExpiresAt: tokenPair.accessToken.expiresAt,
  };

  await delegatesDb.create(newDelegate);

  return {
    ok: true,
    delegate: {
      delegateId: newDelegateId,
      name: input.name,
      realm,
      parentId: parentDelegate.delegateId,
      depth,
      canUpload,
      canManageDepot,
      delegatedDepots: input.delegatedDepots,
      expiresAt,
      createdAt: now,
    },
    refreshToken: tokenPair.refreshToken.base64,
    accessToken: tokenPair.accessToken.base64,
    accessTokenExpiresAt: tokenPair.accessToken.expiresAt,
  };
}

// ============================================================================
// Helpers
// ============================================================================

async function getParentScopeRoots(
  delegate: Delegate,
  scopeSetNodesDb: ScopeSetNodesDb
): Promise<string[]> {
  if (delegate.scopeNodeHash) {
    return [delegate.scopeNodeHash];
  }
  if (delegate.scopeSetNodeId) {
    const setNode = await scopeSetNodesDb.get(delegate.scopeSetNodeId);
    return setNode?.children ?? [];
  }
  return [];
}
