/**
 * CAS Binary Format Constants (v2.1)
 *
 * Node types:
 * - d-node (dict node): directory with sorted children by name
 * - s-node (successor node): file continuation chunk
 * - f-node (file node): file top-level node with FileInfo (fileSize + contentType)
 */

/**
 * Magic number: "CAS\x01" in little-endian (0x01534143)
 */
export const MAGIC = 0x01534143;

/**
 * Magic bytes for validation
 */
export const MAGIC_BYTES = new Uint8Array([0x43, 0x41, 0x53, 0x01]); // "CAS\x01"

/**
 * Header size in bytes (base header without extensions)
 */
export const HEADER_SIZE = 16;

/**
 * BLAKE3s-128 hash size in bytes
 */
export const HASH_SIZE = 16;

/**
 * FileInfo size in bytes (f-node only)
 * - fileSize: 8 bytes (u64 LE)
 * - contentType: 56 bytes (null-padded ASCII)
 */
export const FILEINFO_SIZE = 64;

/**
 * Content-Type max length in FileInfo
 */
export const CONTENT_TYPE_MAX_LENGTH = 56;

/**
 * Node type values (flags bits 0-1)
 *
 * Bit interpretation:
 * - Bit 0: has string section (names for d-node, FileInfo for f-node)
 * - Bit 1: has data section (s-node and f-node)
 *
 * | Type   | Bits | HasStrings | HasData |
 * |--------|------|------------|---------|
 * | set    | 00   | no         | no      |
 * | d-node | 01   | yes(names) | no      |
 * | s-node | 10   | no         | yes     |
 * | f-node | 11   | yes(info)  | yes     |
 */
export const NODE_TYPE = {
  /** Set node (authorization scope) - 00b */
  SET: 0b00,
  /** Dict node (directory) - 01b */
  DICT: 0b01,
  /** Successor node (file chunk) - 10b */
  SUCCESSOR: 0b10,
  /** File node (top-level file) - 11b */
  FILE: 0b11,
} as const;

/**
 * Flag bit masks and shifts
 *
 * Flags layout (32-bit):
 * - bits 0-1:   node type (2 bits)
 * - bits 2-3:   header extension count (2 bits, n * 16 bytes)
 * - bits 4-7:   block size (4 bits, 2^n * KB)
 * - bits 8-15:  hash algorithm (8 bits)
 * - bits 16-31: reserved (must be 0)
 */
export const FLAGS = {
  /** Node type mask (bits 0-1) */
  TYPE_MASK: 0b11,
  /** Header extension count mask (bits 2-3) */
  EXTENSION_MASK: 0b1100,
  /** Header extension count shift */
  EXTENSION_SHIFT: 2,
  /** Block size mask (bits 4-7) */
  BLOCK_SIZE_MASK: 0b11110000,
  /** Block size shift */
  BLOCK_SIZE_SHIFT: 4,
  /** Hash algorithm mask (bits 8-15) */
  HASH_ALGO_MASK: 0xff00,
  /** Hash algorithm shift */
  HASH_ALGO_SHIFT: 8,
  /** Reserved bits mask (bits 16-31) */
  RESERVED_MASK: 0xffff0000,
} as const;

/**
 * Hash algorithm values (flags bits 8-15)
 */
export const HASH_ALGO = {
  /** BLAKE3s-128 (default) */
  BLAKE3S_128: 0,
} as const;

/**
 * Default node limit (1 MB)
 */
export const DEFAULT_NODE_LIMIT = 1024 * 1024;

/**
 * Maximum safe integer for fileSize field (2^53 - 1)
 * This is the JavaScript Number.MAX_SAFE_INTEGER
 */
export const MAX_SAFE_SIZE = Number.MAX_SAFE_INTEGER;
