/**
 * Key Provider implementations
 *
 * Platform-specific key provider implementations.
 */

import { createHash } from "node:crypto";
import type { KeyProvider } from "@casfa/core";
import { blake3 } from "@noble/hashes/blake3";

/**
 * Extended key provider — includes BLAKE3s-128 (CAS nodes) and SHA-256 (legacy).
 */
export type CombinedKeyProvider = KeyProvider & {
  sha256: (data: Uint8Array) => Promise<Uint8Array>;
};

/** @deprecated Use CombinedKeyProvider */
export type CombinedHashProvider = CombinedKeyProvider;

/**
 * Create a Node.js-based key provider using crypto module and @noble/hashes
 *
 * Provides:
 * - computeKey: Blake3s-128 for cas-core (CAS node key computation)
 * - sha256: SHA-256 for cas-storage-core (content addressing)
 */
export const createNodeKeyProvider = (): CombinedKeyProvider => ({
  // Blake3s-128 for cas-core (CAS node key computation)
  computeKey: async (data) => {
    return blake3(data, { dkLen: 16 });
  },
  // SHA-256 for cas-storage-core (content addressing)
  sha256: async (data) => {
    const hash = createHash("sha256").update(data).digest();
    return new Uint8Array(hash);
  },
});

/** @deprecated Use createNodeKeyProvider */
export const createNodeHashProvider = createNodeKeyProvider;
