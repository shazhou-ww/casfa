/**
 * CAS Node Header Encoding/Decoding (v2.1)
 *
 * Header layout (16 bytes base + optional extensions):
 * - 0-3:   magic (u32 LE) - 0x01534143 ("CAS\x01")
 * - 4-7:   flags (u32 LE) - see FLAGS constants for bit layout
 * - 8-11:  size (u32 LE) - payload size
 * - 12-15: count (u32 LE) - number of children
 *
 * Flags layout:
 * - bits 0-1:   node type
 * - bits 2-3:   header extension count (n * 16 bytes)
 * - bits 4-7:   block size (2^n * KB)
 * - bits 8-15:  hash algorithm (0 = BLAKE3s-128)
 * - bits 16-31: reserved
 */

import { FLAGS, HASH_ALGO, HEADER_SIZE, MAGIC, NODE_TYPE } from "./constants.ts";
import type { CasHeader } from "./types.ts";

/**
 * Encode a CAS header to bytes
 */
export function encodeHeader(header: CasHeader): Uint8Array {
  const buffer = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buffer);

  view.setUint32(0, header.magic, true); // LE
  view.setUint32(4, header.flags, true);
  view.setUint32(8, header.size, true);
  view.setUint32(12, header.count, true);

  return new Uint8Array(buffer);
}

/**
 * Decode a CAS header from bytes
 * @throws Error if magic number is invalid or buffer too small
 */
export function decodeHeader(buffer: Uint8Array): CasHeader {
  if (buffer.length < HEADER_SIZE) {
    throw new Error(`Buffer too small: ${buffer.length} < ${HEADER_SIZE}`);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(`Invalid magic: 0x${magic.toString(16)} (expected 0x${MAGIC.toString(16)})`);
  }

  const flags = view.getUint32(4, true);
  const size = view.getUint32(8, true);
  const count = view.getUint32(12, true);

  return {
    magic,
    flags,
    size,
    count,
  };
}

/**
 * Get node type from flags (bits 0-1)
 */
export function getNodeType(flags: number): number {
  return flags & FLAGS.TYPE_MASK;
}

/**
 * Get header extension count from flags (bits 2-3)
 * Returns the number of 16-byte extension segments
 */
export function getExtensionCount(flags: number): number {
  return (flags & FLAGS.EXTENSION_MASK) >>> FLAGS.EXTENSION_SHIFT;
}

/**
 * Set header extension count in flags (bits 2-3)
 * @param flags - Current flags value
 * @param count - Extension count (0-3)
 */
export function setExtensionCount(flags: number, count: number): number {
  return (
    (flags & ~FLAGS.EXTENSION_MASK) | ((count << FLAGS.EXTENSION_SHIFT) & FLAGS.EXTENSION_MASK)
  );
}

/**
 * Get block size limit from flags (bits 4-7)
 * Returns the exponent n where block size limit = 2^n * KB
 * This is a system-wide configuration, not the actual size of individual blocks.
 */
export function getBlockSizeLimit(flags: number): number {
  return (flags & FLAGS.BLOCK_SIZE_MASK) >>> FLAGS.BLOCK_SIZE_SHIFT;
}

/**
 * Set block size limit in flags (bits 4-7)
 * @param flags - Current flags value
 * @param limit - Block size limit exponent (0-15), e.g. 12 for 4 MB
 */
export function setBlockSizeLimit(flags: number, limit: number): number {
  return (
    (flags & ~FLAGS.BLOCK_SIZE_MASK) | ((limit << FLAGS.BLOCK_SIZE_SHIFT) & FLAGS.BLOCK_SIZE_MASK)
  );
}

/**
 * Get hash algorithm from flags (bits 8-15)
 * 0 = BLAKE3s-128
 */
export function getHashAlgo(flags: number): number {
  return (flags & FLAGS.HASH_ALGO_MASK) >>> FLAGS.HASH_ALGO_SHIFT;
}

/**
 * Set hash algorithm in flags (bits 8-15)
 * @param flags - Current flags value
 * @param algo - Hash algorithm value (0 = BLAKE3s-128)
 */
export function setHashAlgo(flags: number, algo: number): number {
  return (flags & ~FLAGS.HASH_ALGO_MASK) | ((algo << FLAGS.HASH_ALGO_SHIFT) & FLAGS.HASH_ALGO_MASK);
}

/**
 * Build flags for a dict node (d-node)
 * Uses default hash algorithm (BLAKE3s-128)
 */
export function buildDictFlags(): number {
  return NODE_TYPE.DICT | (HASH_ALGO.BLAKE3S_128 << FLAGS.HASH_ALGO_SHIFT);
}

/**
 * Build flags for a successor node (s-node)
 * Uses default hash algorithm (BLAKE3s-128)
 */
export function buildSuccessorFlags(): number {
  return NODE_TYPE.SUCCESSOR | (HASH_ALGO.BLAKE3S_128 << FLAGS.HASH_ALGO_SHIFT);
}

/**
 * Build flags for a file node (f-node)
 * Uses default hash algorithm (BLAKE3s-128)
 */
export function buildFileFlags(): number {
  return NODE_TYPE.FILE | (HASH_ALGO.BLAKE3S_128 << FLAGS.HASH_ALGO_SHIFT);
}

/**
 * Create a header for a dict node (d-node)
 * @param payloadSize - Size of names payload (sum of Pascal string lengths)
 * @param count - Number of children
 */
export function createDictHeader(payloadSize: number, count: number): CasHeader {
  return {
    magic: MAGIC,
    flags: buildDictFlags(),
    size: payloadSize,
    count,
  };
}

/**
 * Create a header for a successor node (s-node)
 * @param dataSize - Size of data payload
 * @param count - Number of children
 */
export function createSuccessorHeader(dataSize: number, count: number): CasHeader {
  return {
    magic: MAGIC,
    flags: buildSuccessorFlags(),
    size: dataSize,
    count,
  };
}

/**
 * Create a header for a file node (f-node)
 * @param payloadSize - Size of payload (FileInfo + data)
 * @param count - Number of children
 */
export function createFileHeader(payloadSize: number, count: number): CasHeader {
  return {
    magic: MAGIC,
    flags: buildFileFlags(),
    size: payloadSize,
    count,
  };
}
