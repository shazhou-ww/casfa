/**
 * Hash Provider implementations
 *
 * Platform-specific hash provider implementations.
 */

import { createHash } from "node:crypto";
import type { HashProvider as CasHashProvider } from "@casfa/core";
import type { HashProvider as StorageHashProvider } from "@casfa/storage-core";
import { blake3 } from "@noble/hashes/blake3";

/**
 * Combined hash provider that satisfies both cas-core and cas-storage-core interfaces
 */
export type CombinedHashProvider = CasHashProvider & StorageHashProvider;

/**
 * Create a Node.js-based hash provider using crypto module and @noble/hashes
 *
 * Provides:
 * - hash: Blake3s-128 for cas-core (CAS node validation)
 * - sha256: SHA-256 for cas-storage-core (content addressing)
 */
export const createNodeHashProvider = (): CombinedHashProvider => ({
  // Blake3s-128 for cas-core (CAS node validation)
  hash: async (data) => {
    return blake3(data, { dkLen: 16 });
  },
  // SHA-256 for cas-storage-core (content addressing)
  sha256: async (data) => {
    const hash = createHash("sha256").update(data).digest();
    return new Uint8Array(hash);
  },
});
