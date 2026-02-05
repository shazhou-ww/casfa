/**
 * CAS URI path resolution
 */

import type { CasUri } from "./types.ts";

/**
 * Append path segments to a CAS URI
 *
 * @param uri - Base CAS URI
 * @param segments - Path segments to append
 * @returns New CAS URI with appended path
 */
export function appendPath(uri: CasUri, ...segments: string[]): CasUri {
  return {
    ...uri,
    path: [...uri.path, ...segments.filter((s) => s !== "")],
    // Clear index path when appending (navigation changes the target)
    indexPath: null,
  };
}

/**
 * Get parent URI (go up one level)
 *
 * @param uri - CAS URI
 * @returns Parent URI, or null if already at root
 */
export function parentUri(uri: CasUri): CasUri | null {
  if (uri.path.length === 0) {
    return null; // Already at root
  }

  return {
    ...uri,
    path: uri.path.slice(0, -1),
    indexPath: null,
  };
}

/**
 * Get the root URI (remove all path and fragment)
 *
 * @param uri - CAS URI
 * @returns Root URI
 */
export function rootUri(uri: CasUri): CasUri {
  return {
    root: uri.root,
    path: [],
    indexPath: null,
  };
}

/**
 * Set the index path (fragment)
 *
 * @param uri - CAS URI
 * @param indexPath - New index path (null to remove)
 * @returns New URI with updated index path
 */
export function withIndexPath(uri: CasUri, indexPath: string | null): CasUri {
  return {
    ...uri,
    indexPath,
  };
}

/**
 * Get the last path segment (basename)
 *
 * @param uri - CAS URI
 * @returns Last path segment, or null if no path
 */
export function basename(uri: CasUri): string | null {
  if (uri.path.length === 0) {
    return null;
  }
  return uri.path[uri.path.length - 1] ?? null;
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
  const segments = relativePath.split("/").filter((s) => s !== "" && s !== ".");

  let currentPath = [...base.path];

  for (const segment of segments) {
    if (segment === "..") {
      // Go up one level
      if (currentPath.length > 0) {
        currentPath.pop();
      }
      // If at root, stay at root (don't go above root)
    } else {
      // Append segment
      currentPath.push(segment);
    }
  }

  return {
    ...base,
    path: currentPath,
    indexPath: null,
  };
}

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
    case "node":
      if (b.root.type !== "node" || a.root.hash !== b.root.hash) {
        return false;
      }
      break;
    case "depot":
      if (b.root.type !== "depot" || a.root.id !== b.root.id) {
        return false;
      }
      break;
    case "ticket":
      if (b.root.type !== "ticket" || a.root.id !== b.root.id) {
        return false;
      }
      break;
  }

  // Compare paths
  if (a.path.length !== b.path.length) {
    return false;
  }
  for (let i = 0; i < a.path.length; i++) {
    if (a.path[i] !== b.path[i]) {
      return false;
    }
  }

  // Compare index paths
  return a.indexPath === b.indexPath;
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
    case "node":
      if (
        descendant.root.type !== "node" ||
        ancestor.root.hash !== descendant.root.hash
      ) {
        return false;
      }
      break;
    case "depot":
      if (
        descendant.root.type !== "depot" ||
        ancestor.root.id !== descendant.root.id
      ) {
        return false;
      }
      break;
    case "ticket":
      if (
        descendant.root.type !== "ticket" ||
        ancestor.root.id !== descendant.root.id
      ) {
        return false;
      }
      break;
  }

  // Ancestor path must be prefix of descendant path
  if (ancestor.path.length > descendant.path.length) {
    return false;
  }

  for (let i = 0; i < ancestor.path.length; i++) {
    if (ancestor.path[i] !== descendant.path[i]) {
      return false;
    }
  }

  return true;
}
