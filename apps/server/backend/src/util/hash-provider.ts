/**
 * Hash Provider implementations
 *
 * Platform-specific hash provider implementations.
 */

import { createHash } from "node:crypto";
import type { HashProvider } from "@casfa/core";
import { blake3 } from "@noble/hashes/blake3";

/**
 * Extended hash provider — includes BLAKE3s-128 (CAS nodes) and SHA-256 (legacy).
 */
export type CombinedHashProvider = HashProvider & {
  sha256: (data: Uint8Array) => Promise<Uint8Array>;
};

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
