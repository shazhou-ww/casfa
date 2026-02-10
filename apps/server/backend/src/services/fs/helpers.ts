/**
 * Filesystem Service — Helpers
 *
 * Pure utility functions: hash conversions, path parsing, child navigation.
 * No storage or I/O — all functions are synchronous.
 */

import type { CasNode } from "@casfa/core";
import {
  decodeCrockfordBase32,
  encodeCrockfordBase32,
  FS_MAX_NAME_BYTES,
  storageKeyToNodeKey,
} from "@casfa/protocol";
import { type FsError, fsError } from "./types.ts";

const textEncoder = new TextEncoder();

// ============================================================================
// Hash / Storage Key Conversions (CB32 format)
// ============================================================================

/** Convert Uint8Array hash → CB32 storage key string */
export const hashToStorageKey = (hash: Uint8Array): string => {
  return encodeCrockfordBase32(hash);
};

/** Convert CB32 storage key → Uint8Array hash bytes */
export const storageKeyToHash = (key: string): Uint8Array => {
  return decodeCrockfordBase32(key);
};

/** Convert CB32 storage key → "nod_{cb32}" node key */
export const storageKeyToNodeKey_ = storageKeyToNodeKey;

// ============================================================================
// Path Parsing
// ============================================================================

/** Parse a name-based path string into validated segments */
export const parsePath = (path: string): string[] | FsError => {
  if (!path) return [];

  if (path.startsWith("/")) {
    return fsError("INVALID_PATH", 400, "Absolute paths not allowed");
  }
  if (path.includes("..")) {
    return fsError("INVALID_PATH", 400, "Path traversal (..) not allowed");
  }

  const segments = path.split("/").filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg.length === 0) {
      return fsError("INVALID_PATH", 400, "Empty path segment");
    }
    const bytes = textEncoder.encode(seg);
    if (bytes.length > FS_MAX_NAME_BYTES) {
      return fsError(
        "NAME_TOO_LONG",
        400,
        `Name too long: '${seg}' (${bytes.length} bytes, max ${FS_MAX_NAME_BYTES})`
      );
    }
  }
  return segments;
};

/** Parse an index-based path ("0:2:1") into an array of integers */
export const parseIndexPath = (indexPath: string): number[] | FsError => {
  if (!indexPath) return [];
  const parts = indexPath.split(":").map((s) => Number.parseInt(s, 10));
  if (parts.some(Number.isNaN)) {
    return fsError("INVALID_PATH", 400, "Invalid indexPath format");
  }
  return parts;
};

// ============================================================================
// Child Navigation
// ============================================================================

/** Find a child in a d-node by name; returns hash + index or null */
export const findChildByName = (
  node: CasNode,
  name: string
): { hash: Uint8Array; index: number } | null => {
  if (node.kind !== "dict" || !node.childNames || !node.children) return null;
  const idx = node.childNames.indexOf(name);
  if (idx === -1) return null;
  return { hash: node.children[idx]!, index: idx };
};

/** Find a child in a d-node by index; returns hash + name or null */
export const findChildByIndex = (
  node: CasNode,
  index: number
): { hash: Uint8Array; name: string } | null => {
  if (node.kind !== "dict" || !node.childNames || !node.children) return null;
  if (index < 0 || index >= node.children.length) return null;
  return { hash: node.children[index]!, name: node.childNames[index]! };
};
