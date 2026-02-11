/**
 * CAS Binary Format Types (v2.1)
 *
 * Node types:
 * - set-node: set of children sorted by hash (for authorization scope)
 * - d-node (dict node): directory with sorted children by name
 * - s-node (successor node): file continuation chunk
 * - f-node (file node): file top-level node with FileInfo
 */

/**
 * Node kind discriminator
 */
export type NodeKind = "set" | "dict" | "file" | "successor";

/**
 * Key provider — computes a 128-bit content-addressed key for a node.
 *
 * The key is a pure function of the input bytes.  The provider may use
 * any combination of hashing, size-flagging, or other deterministic
 * transforms, as long as the output is 16 bytes.
 *
 * Current implementation: BLAKE3s-128 (will become size-flagged in Phase 2).
 */
export type KeyProvider = {
  /**
   * Compute 128-bit content-addressed key.
   * @param data - Serialized node bytes
   * @returns 16-byte key as Uint8Array
   */
  computeKey: (data: Uint8Array) => Promise<Uint8Array>;
};

/**
 * Re-export StorageProvider from @casfa/storage-core.
 *
 * The canonical definition lives in storage-core (zero-dep interface package).
 * Core re-exports it so that higher-level consumers (fs, explorer, etc.)
 * don't need to add a separate dependency on storage-core.
 */
export type { StorageProvider } from "@casfa/storage-core";

/**
 * Parsed CAS node header (16 bytes base + optional extensions)
 *
 * Layout:
 * - 0-3:   magic (u32 LE) - 0x01534143
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
export type CasHeader = {
  /** Magic number (0x01534143) */
  magic: number;
  /** Flag bits (see FLAGS constants) */
  flags: number;
  /** Payload size (not including header and children) */
  size: number;
  /** Number of children */
  count: number;
};

/**
 * File info for f-node (64 bytes)
 * - 0-7:   fileSize (u64 LE) - original file size
 * - 8-63:  contentType (56 bytes, null-padded ASCII)
 */
export type FileInfo = {
  /** Original file size (full B-Tree file size) */
  fileSize: number;
  /** MIME type (max 56 bytes) */
  contentType: string;
};

/**
 * Decoded CAS node
 */
export type CasNode = {
  /** Node type: dict, file, or successor */
  kind: NodeKind;
  /** Payload size (bytes in this node's payload section) */
  size: number;
  /** File info (f-node only: fileSize + contentType) */
  fileInfo?: FileInfo;
  /** Child hashes (16 bytes each) */
  children?: Uint8Array[];
  /** Child names (d-node only, sorted by UTF-8 bytes) */
  childNames?: string[];
  /** Raw data (f-node and s-node only) */
  data?: Uint8Array;
};

/**
 * File node input for encoding (f-node)
 */
export type FileNodeInput = {
  /** File content type (MIME type, max 56 bytes) */
  contentType?: string;
  /** Original file size (for B-Tree root node) */
  fileSize: number;
  /** Raw data bytes for this node */
  data: Uint8Array;
  /** Child chunk hashes (for B-Tree internal nodes) */
  children?: Uint8Array[];
};

/**
 * Successor node input for encoding (s-node)
 */
export type SuccessorNodeInput = {
  /** Raw data bytes */
  data: Uint8Array;
  /** Child chunk hashes (for B-Tree internal nodes) */
  children?: Uint8Array[];
};

/**
 * Dict node input for encoding (d-node)
 */
export type DictNodeInput = {
  /** Child hashes (16 bytes each) */
  children: Uint8Array[];
  /** Child names (will be sorted by UTF-8 bytes) */
  childNames: string[];
};

/**
 * Set node input for encoding (set-node)
 * Used for authorization scope - a pure set of children sorted by hash
 */
export type SetNodeInput = {
  /** Child hashes (16 bytes each, will be sorted by hash bytes) */
  children: Uint8Array[];
};

/**
 * B-Tree layout node description
 */
export type LayoutNode = {
  /** Depth of this node (1 = leaf) */
  depth: number;
  /** Data bytes stored in this node */
  dataSize: number;
  /** Child layouts (empty for leaf nodes) */
  children: LayoutNode[];
};

/**
 * Encoded node result
 */
export type EncodedNode = {
  /** Raw bytes of the encoded node */
  bytes: Uint8Array;
  /** BLAKE3s-128 hash of the bytes */
  hash: Uint8Array;
};
