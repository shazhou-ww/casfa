/**
 * Well-known CAS keys and data (v2.1)
 *
 * These are special CAS nodes with pre-computed hashes that have
 * system-wide significance.
 */

import { FLAGS, HASH_ALGO, HEADER_SIZE, MAGIC, NODE_TYPE } from "./constants.ts";

/**
 * Empty dict node bytes - a d-node with zero children
 *
 * Structure (16 bytes):
 * - 0-3:   magic: 0x01534143 (4 bytes, little-endian)
 * - 4-7:   flags: NODE_TYPE.DICT | hash_algo (4 bytes)
 * - 8-11:  size: 0 (4 bytes, no names payload)
 * - 12-15: count: 0 (4 bytes)
 */
export const EMPTY_DICT_BYTES = new Uint8Array(HEADER_SIZE);

// Encode the empty dict node header
(() => {
  const view = new DataView(EMPTY_DICT_BYTES.buffer);
  view.setUint32(0, MAGIC, true); // magic
  // flags = d-node (0b01) with hash algo BLAKE3S_128 (0)
  const flags = NODE_TYPE.DICT | (HASH_ALGO.BLAKE3S_128 << FLAGS.HASH_ALGO_SHIFT);
  view.setUint32(4, flags, true);
  view.setUint32(8, 0, true); // size = 0 (no names payload)
  view.setUint32(12, 0, true); // count = 0
})();

/**
 * Size-flagged BLAKE3s-128 key of EMPTY_DICT_BYTES (CB32 format for storage)
 *
 * Computed from: blake3(16-byte header with d-node flags, count=0, size=0)
 * truncated to 128 bits (16 bytes), first byte replaced with
 * computeSizeFlagByte(16) = 0x11, then Crockford Base32 encoded.
 */
export const EMPTY_DICT_KEY = "240B5PHBGEC2A705WTKKMVRS30";

/**
 * Well-known keys for system-level CAS nodes
 */
export const WELL_KNOWN_KEYS = {
  /** Empty dict node - used as initial root for new Depots */
  EMPTY_DICT: EMPTY_DICT_KEY,
} as const;

// ============================================================================
// Unified well-known node registry
// ============================================================================

/**
 * Map from CB32 storage key → raw node bytes for all well-known nodes.
 *
 * These nodes are virtual — they are never persisted to storage but can be
 * referenced by depots, ownership records, etc.  Any code path that reads a
 * node from storage should first check this map so it never hits the backend
 * for well-known keys.
 */
export const WELL_KNOWN_NODES: ReadonlyMap<string, Uint8Array> = new Map([
  [EMPTY_DICT_KEY, EMPTY_DICT_BYTES],
]);

/**
 * Check whether a storage key is a well-known node.
 */
export const isWellKnownNode = (storageKey: string): boolean => WELL_KNOWN_NODES.has(storageKey);

/**
 * Get the raw bytes of a well-known node (returns a fresh copy), or null.
 */
export const getWellKnownNodeData = (storageKey: string): Uint8Array | null => {
  const bytes = WELL_KNOWN_NODES.get(storageKey);
  return bytes ? bytes.slice() : null;
};
