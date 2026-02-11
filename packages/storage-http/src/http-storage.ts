/**
 * HTTP-backed StorageProvider
 *
 * Wraps the CASFA client's Node API as a standard StorageProvider.
 * All keys are raw CB32 storage keys — the `nod_` prefix conversion
 * happens internally.
 *
 * `put` is smart: it first calls `check` to classify the node as
 * missing / owned / unowned, then only uploads (put) or claims (PoP)
 * as needed.
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
};

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an HTTP-backed StorageProvider.
 *
 * - `get(key)` → fetches raw node bytes via `client.nodes.get(nod_key)`
 * - `has(key)` → calls `client.nodes.check` (single key)
 * - `put(key, bytes)` → check → put (missing) or claim (unowned) or no-op (owned)
 */
export const createHttpStorage = (config: HttpStorageConfig): StorageProvider => {
  const { client, getTokenBytes, popContext } = config;

  return {
    async get(key: string): Promise<Uint8Array | null> {
      const nodeKey = storageKeyToNodeKey(key);
      const result = await client.nodes.get(nodeKey);
      if (result.ok) return result.data;
      return null;
    },

    async has(key: string): Promise<boolean> {
      const nodeKey = storageKeyToNodeKey(key);
      const result = await client.nodes.check({ keys: [nodeKey] });
      if (!result.ok) return false;
      // If key is in owned or unowned, it exists
      return !result.data.missing.includes(nodeKey);
    },

    async put(key: string, value: Uint8Array): Promise<void> {
      const nodeKey = storageKeyToNodeKey(key);

      // Check status: missing → upload, unowned → claim, owned → skip
      const checkResult = await client.nodes.check({ keys: [nodeKey] });
      if (!checkResult.ok) {
        throw new Error(`Failed to check node ${nodeKey}: ${checkResult.error.message}`);
      }

      const { missing, unowned } = checkResult.data;

      if (missing.includes(nodeKey)) {
        // Node doesn't exist on server — upload it
        const putResult = await client.nodes.put(nodeKey, value);
        if (!putResult.ok) {
          throw new Error(`Failed to upload node ${nodeKey}: ${putResult.error.message}`);
        }
      } else if (unowned.includes(nodeKey)) {
        // Node exists but not owned by us — claim via PoP
        const tokenBytes = getTokenBytes();
        if (!tokenBytes || !popContext) {
          throw new Error(
            `Cannot claim unowned node ${nodeKey}: missing tokenBytes or popContext`,
          );
        }
        const pop = computePoP(tokenBytes, value, popContext);
        const claimResult = await client.nodes.claim(nodeKey, pop);
        if (!claimResult.ok) {
          throw new Error(`Failed to claim node ${nodeKey}: ${claimResult.error.message}`);
        }
      }
      // else: owned — nothing to do
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
  entries: Array<{ key: string; value: Uint8Array }>,
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
        throw new Error(`Cannot claim unowned node ${unownedKey}: missing tokenBytes or popContext`);
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
