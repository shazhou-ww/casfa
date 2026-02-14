/**
 * HTTP-backed StorageProvider
 *
 * Wraps the CASFA client's Node API as a standard StorageProvider.
 * All keys are raw CB32 storage keys — the `nod_` prefix conversion
 * happens internally.
 *
 * - `get(key)` → fetches raw node bytes via `client.nodes.get(nod_key)`
 * - `put(key, bytes)` → check → put (missing) / claim (unowned) / no-op (owned)
 *
 * Check results are cached per key so repeated `put` calls avoid
 * redundant network round-trips.
 *
 * @packageDocumentation
 */

import type { CasfaClient } from "@casfa/client";
import type { PopContext } from "@casfa/proof";
import { computePoP } from "@casfa/proof";
import { storageKeyToNodeKey } from "@casfa/protocol";
import type { StorageProvider } from "@casfa/storage-core";

// ============================================================================
// Types
// ============================================================================

/** Three-way status returned by the server's check endpoint */
export type NodeStatus = "owned" | "unowned" | "missing";

export type HttpStorageConfig = {
  /** Authenticated CASFA client */
  client: CasfaClient;
  /**
   * Callback to get the raw 32-byte access token bytes.
   * Needed for PoP computation when claiming unowned nodes.
   */
  getTokenBytes: () => Uint8Array | null;
  /**
   * PopContext for PoP computation (blake3_256, blake3_128_keyed, CB32 encoder).
   * Only needed if the server may contain nodes uploaded by other delegates.
   */
  popContext?: PopContext;
  /**
   * Extract direct child storage keys from raw node bytes.
   * When provided, a successful `get()` will also mark the node's
   * direct children as "owned" in the internal check cache,
   * avoiding redundant check calls on subsequent uploads.
   */
  getChildKeys?: (value: Uint8Array) => string[];
};

/** Three-way check result keyed by storage key */
export type CheckManyResult = {
  missing: string[];
  unowned: string[];
  owned: string[];
};

/**
 * Extended StorageProvider with batch check and claim support.
 *
 * - `checkMany(keys)` — single batch check, returns three-way status
 * - `claim(key, value)` — claim an unowned node via PoP (no bytes uploaded)
 */
export type HttpStorageProvider = StorageProvider & {
  /** Batch check returning three-way status for each key. */
  checkMany: (keys: string[]) => Promise<CheckManyResult>;
  /** Claim an unowned node via Proof of Possession. The value is only used locally for PoP computation — NOT uploaded. */
  claim: (key: string, value: Uint8Array) => Promise<void>;
  /**
   * Check if a key is already known to be "owned" from internal cache.
   * Useful for callers to skip nodes that don't need re-checking.
   * The key is a **storage key** (CB32, no prefix).
   */
  isKnownOwned: (key: string) => boolean;
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Call the check endpoint for a single nodeKey and return its status.
 * The result is written into `cache` so subsequent lookups are free.
 */
const checkOne = async (
  client: CasfaClient,
  nodeKey: string,
  cache: Map<string, NodeStatus>
): Promise<NodeStatus> => {
  const cached = cache.get(nodeKey);
  if (cached !== undefined) return cached;

  const result = await client.nodes.check({ keys: [nodeKey] });
  if (!result.ok) {
    throw new Error(`Failed to check node ${nodeKey}: ${result.error.message}`);
  }

  // Populate cache for every key in the response
  for (const k of result.data.owned) cache.set(k, "owned");
  for (const k of result.data.unowned) cache.set(k, "unowned");
  for (const k of result.data.missing) cache.set(k, "missing");

  return cache.get(nodeKey) ?? "missing";
};

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an HTTP-backed StorageProvider.
 *
 * - `get(key)` → fetches raw node bytes via `client.nodes.get(nod_key)`
 * - `put(key, bytes)` → check → put (missing) / claim (unowned) / no-op (owned)
 */
export const createHttpStorage = (config: HttpStorageConfig): HttpStorageProvider => {
  const { client, getTokenBytes, popContext, getChildKeys } = config;

  /** Per-key check-result cache (survives for the lifetime of the provider) */
  const checkCache = new Map<string, NodeStatus>();

  return {
    async get(key: string): Promise<Uint8Array | null> {
      const nodeKey = storageKeyToNodeKey(key);
      const result = await client.nodes.get(nodeKey);
      if (result.ok) {
        // Successful GET means the node exists on the server.
        // Mark it as "owned" if not already cached.
        if (!checkCache.has(nodeKey)) {
          checkCache.set(nodeKey, "owned");
        }
        // Also mark direct children as owned (no recursive expansion).
        // If we can read the parent, its children must also exist & be owned.
        if (getChildKeys) {
          for (const childKey of getChildKeys(result.data)) {
            const childNodeKey = storageKeyToNodeKey(childKey);
            if (!checkCache.has(childNodeKey)) {
              checkCache.set(childNodeKey, "owned");
            }
          }
        }
        return result.data;
      }
      return null;
    },

    async put(key: string, value: Uint8Array): Promise<void> {
      const nodeKey = storageKeyToNodeKey(key);
      const status = await checkOne(client, nodeKey, checkCache);

      if (status === "missing") {
        // Node doesn't exist on server — upload it
        const putResult = await client.nodes.put(nodeKey, value);
        if (!putResult.ok) {
          throw new Error(`Failed to upload node ${nodeKey}: ${putResult.error.message}`);
        }
        // After successful upload it is now owned
        checkCache.set(nodeKey, "owned");
      } else if (status === "unowned") {
        // Node exists but not owned by us — claim via PoP
        const tokenBytes = getTokenBytes();
        if (!tokenBytes || !popContext) {
          throw new Error(`Cannot claim unowned node ${nodeKey}: missing tokenBytes or popContext`);
        }
        const pop = computePoP(tokenBytes, value, popContext);
        const claimResult = await client.nodes.claim(nodeKey, pop);
        if (!claimResult.ok) {
          throw new Error(`Failed to claim node ${nodeKey}: ${claimResult.error.message}`);
        }
        // After successful claim it is now owned
        checkCache.set(nodeKey, "owned");
      }
      // else: owned — nothing to do
    },

    async checkMany(keys: string[]): Promise<CheckManyResult> {
      const missing: string[] = [];
      const unowned: string[] = [];
      const owned: string[] = [];

      // Build storage→node key mapping
      const nodeToStorage = new Map(keys.map((k) => [storageKeyToNodeKey(k), k]));
      const nodeKeys = keys.map(storageKeyToNodeKey);

      // ── Use cached statuses to skip redundant network calls ──
      const uncachedNodeKeys: string[] = [];
      for (const nk of nodeKeys) {
        const cached = checkCache.get(nk);
        if (cached !== undefined) {
          const sk = nodeToStorage.get(nk);
          if (sk) {
            if (cached === "owned") owned.push(sk);
            else if (cached === "unowned") unowned.push(sk);
            else if (cached === "missing") missing.push(sk);
          }
        } else {
          uncachedNodeKeys.push(nk);
        }
      }

      // All keys resolved from cache — no network call needed
      if (uncachedNodeKeys.length === 0) return { missing, unowned, owned };

      for (let i = 0; i < uncachedNodeKeys.length; i += 1000) {
        const batch = uncachedNodeKeys.slice(i, i + 1000);
        const result = await client.nodes.check({ keys: batch });
        if (!result.ok) {
          throw new Error(`Batch check failed: ${result.error.message}`);
        }
        for (const nk of result.data.missing) {
          checkCache.set(nk, "missing");
          const sk = nodeToStorage.get(nk);
          if (sk) missing.push(sk);
        }
        for (const nk of result.data.unowned) {
          checkCache.set(nk, "unowned");
          const sk = nodeToStorage.get(nk);
          if (sk) unowned.push(sk);
        }
        for (const nk of result.data.owned) {
          checkCache.set(nk, "owned");
          const sk = nodeToStorage.get(nk);
          if (sk) owned.push(sk);
        }
      }

      return { missing, unowned, owned };
    },

    async claim(key: string, value: Uint8Array): Promise<void> {
      const nodeKey = storageKeyToNodeKey(key);
      const tokenBytes = getTokenBytes();
      if (!tokenBytes || !popContext) {
        throw new Error(`Cannot claim unowned node ${nodeKey}: missing tokenBytes or popContext`);
      }
      const pop = computePoP(tokenBytes, value, popContext);
      const claimResult = await client.nodes.claim(nodeKey, pop);
      if (!claimResult.ok) {
        throw new Error(`Failed to claim node ${nodeKey}: ${claimResult.error.message}`);
      }
      checkCache.set(nodeKey, "owned");
    },

    isKnownOwned(key: string): boolean {
      const nodeKey = storageKeyToNodeKey(key);
      return checkCache.get(nodeKey) === "owned";
    },
  };
};

// ============================================================================
// Batch-optimized put
// ============================================================================

/**
 * Put multiple nodes with a single batch `check` call.
 * Much more efficient than calling `storage.put()` individually.
 *
 * @returns Array of keys that were actually uploaded or claimed
 */
export const batchPut = async (
  config: HttpStorageConfig,
  entries: Array<{ key: string; value: Uint8Array }>
): Promise<string[]> => {
  if (entries.length === 0) return [];

  const { client, getTokenBytes, popContext } = config;

  // Convert to node keys for check
  const nodeKeys = entries.map((e) => storageKeyToNodeKey(e.key));
  const keyMap = new Map(entries.map((e) => [storageKeyToNodeKey(e.key), e]));

  // Batch check (max 1000 per call)
  const affected: string[] = [];
  for (let i = 0; i < nodeKeys.length; i += 1000) {
    const batch = nodeKeys.slice(i, i + 1000);
    const checkResult = await client.nodes.check({ keys: batch });
    if (!checkResult.ok) {
      throw new Error(`Batch check failed: ${checkResult.error.message}`);
    }

    // Upload missing nodes
    for (const missingKey of checkResult.data.missing) {
      const entry = keyMap.get(missingKey);
      if (!entry) continue;
      const putResult = await client.nodes.put(missingKey, entry.value);
      if (!putResult.ok) {
        throw new Error(`Failed to upload node ${missingKey}: ${putResult.error.message}`);
      }
      affected.push(entry.key);
    }

    // Claim unowned nodes
    for (const unownedKey of checkResult.data.unowned) {
      const entry = keyMap.get(unownedKey);
      if (!entry) continue;
      const tokenBytes = getTokenBytes();
      if (!tokenBytes || !popContext) {
        throw new Error(
          `Cannot claim unowned node ${unownedKey}: missing tokenBytes or popContext`
        );
      }
      const pop = computePoP(tokenBytes, entry.value, popContext);
      const claimResult = await client.nodes.claim(unownedKey, pop);
      if (!claimResult.ok) {
        throw new Error(`Failed to claim node ${unownedKey}: ${claimResult.error.message}`);
      }
      affected.push(entry.key);
    }
  }

  return affected;
};
