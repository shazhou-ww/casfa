/**
 * CAS URI path resolution and utility functions
 */

import type { CasUri, PathSegment } from "./types.ts";

// ============================================================================
// Segment Constructors
// ============================================================================

/**
 * Create a name segment
 */
export function nameSegment(value: string): PathSegment {
  return { kind: "name", value };
}

/**
 * Create an index segment
 */
export function indexSegment(value: number): PathSegment {
  return { kind: "index", value };
}

// ============================================================================
// Path Manipulation
// ============================================================================

/**
 * Append name segments to a CAS URI
 *
 * @param uri - Base CAS URI
 * @param names - Name path segments to append
 * @returns New CAS URI with appended name segments
 */
export function appendPath(uri: CasUri, ...names: string[]): CasUri {
  return {
    ...uri,
    segments: [...uri.segments, ...names.filter((s) => s !== "").map(nameSegment)],
  };
}

/**
 * Append index segments to a CAS URI
 *
 * @param uri - Base CAS URI
 * @param indices - Index values to append
 * @returns New CAS URI with appended index segments
 */
export function appendIndex(uri: CasUri, ...indices: number[]): CasUri {
  return {
    ...uri,
    segments: [...uri.segments, ...indices.map(indexSegment)],
  };
}

/**
 * Get parent URI (go up one segment)
 *
 * @param uri - CAS URI
 * @returns Parent URI, or null if already at root
 */
export function parentUri(uri: CasUri): CasUri | null {
  if (uri.segments.length === 0) {
    return null; // Already at root
  }

  return {
    ...uri,
    segments: uri.segments.slice(0, -1),
  };
}

/**
 * Get the root URI (remove all segments)
 *
 * @param uri - CAS URI
 * @returns Root URI
 */
export function rootUri(uri: CasUri): CasUri {
  return {
    root: uri.root,
    segments: [],
  };
}

/**
 * Get the last segment's display name
 *
 * Returns the name value for name segments, or "~N" for index segments.
 *
 * @param uri - CAS URI
 * @returns Last segment display name, or null if no segments
 */
export function basename(uri: CasUri): string | null {
  if (uri.segments.length === 0) {
    return null;
  }
  const last = uri.segments[uri.segments.length - 1]!;
  return last.kind === "name" ? last.value : `~${last.value}`;
}

/**
 * Resolve a relative path against a base URI
 *
 * Supports:
 * - "./relative" - Same level
 * - "../up" - Go up one level
 * - "name" - Append to current path
 *
 * @param base - Base CAS URI
 * @param relativePath - Relative path string
 * @returns Resolved URI
 */
export function resolvePath(base: CasUri, relativePath: string): CasUri {
  // Split into segments
  const parts = relativePath.split("/").filter((s) => s !== "" && s !== ".");

  const currentSegments = [...base.segments];

  for (const part of parts) {
    if (part === "..") {
      // Go up one level
      if (currentSegments.length > 0) {
        currentSegments.pop();
      }
      // If at root, stay at root (don't go above root)
    } else {
      // Append name segment
      currentSegments.push(nameSegment(part));
    }
  }

  return {
    ...base,
    segments: currentSegments,
  };
}

// ============================================================================
// Comparison
// ============================================================================

/**
 * Check if two URIs are equal
 *
 * @param a - First URI
 * @param b - Second URI
 * @returns true if equal
 */
export function uriEquals(a: CasUri, b: CasUri): boolean {
  // Compare roots
  if (a.root.type !== b.root.type) {
    return false;
  }

  switch (a.root.type) {
    case "nod":
      if (b.root.type !== "nod" || a.root.hash !== b.root.hash) {
        return false;
      }
      break;
    case "dpt":
      if (b.root.type !== "dpt" || a.root.id !== b.root.id) {
        return false;
      }
      break;
  }

  // Compare segments
  if (a.segments.length !== b.segments.length) {
    return false;
  }
  for (let i = 0; i < a.segments.length; i++) {
    const sa = a.segments[i]!;
    const sb = b.segments[i]!;
    if (sa.kind !== sb.kind) return false;
    if (sa.value !== sb.value) return false;
  }

  return true;
}

/**
 * Check if a URI is a prefix of another (ancestor)
 *
 * @param ancestor - Potential ancestor URI
 * @param descendant - Potential descendant URI
 * @returns true if ancestor is a prefix of descendant
 */
export function isAncestorOf(ancestor: CasUri, descendant: CasUri): boolean {
  // Must have same root
  if (ancestor.root.type !== descendant.root.type) {
    return false;
  }

  switch (ancestor.root.type) {
    case "nod":
      if (descendant.root.type !== "nod" || ancestor.root.hash !== descendant.root.hash) {
        return false;
      }
      break;
    case "dpt":
      if (descendant.root.type !== "dpt" || ancestor.root.id !== descendant.root.id) {
        return false;
      }
      break;
  }

  // Ancestor segments must be prefix of descendant segments
  if (ancestor.segments.length > descendant.segments.length) {
    return false;
  }

  for (let i = 0; i < ancestor.segments.length; i++) {
    const sa = ancestor.segments[i]!;
    const sd = descendant.segments[i]!;
    if (sa.kind !== sd.kind) return false;
    if (sa.value !== sd.value) return false;
  }

  return true;
}

// ============================================================================
// Extraction helpers (bridge to legacy path/indexPath APIs)
// ============================================================================

/**
 * Extract only name segments from the URI
 *
 * Useful for bridging to APIs that take a separate path string.
 */
export function getNamePath(uri: CasUri): string[] {
  return uri.segments
    .filter((s): s is { kind: "name"; value: string } => s.kind === "name")
    .map((s) => s.value);
}

/**
 * Extract only index segments from the URI
 *
 * Useful for bridging to APIs that take a separate index path string.
 */
export function getIndexPath(uri: CasUri): number[] {
  return uri.segments
    .filter((s): s is { kind: "index"; value: number } => s.kind === "index")
    .map((s) => s.value);
}
