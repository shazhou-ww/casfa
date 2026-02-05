/**
 * CAS URI formatting
 */

import type { CasUri, CasUriRoot } from "./types.ts";

/**
 * Format a CasUriRoot to string
 */
function formatRoot(root: CasUriRoot): string {
  switch (root.type) {
    case "node":
      return `node:${root.hash}`;
    case "depot":
      return `depot:${root.id}`;
    case "ticket":
      return `ticket:${root.id}`;
  }
}

/**
 * Format a CAS URI to string
 *
 * @param uri - Parsed CAS URI
 * @returns CAS URI string
 *
 * @example
 * ```ts
 * formatCasUri({
 *   root: { type: "node", hash: "ABC123...XYZ" },
 *   path: ["docs", "readme.md"],
 *   indexPath: null
 * })
 * // => "node:ABC123...XYZ/docs/readme.md"
 * ```
 */
export function formatCasUri(uri: CasUri): string {
  let result = formatRoot(uri.root);

  if (uri.path.length > 0) {
    result += "/" + uri.path.join("/");
  }

  if (uri.indexPath !== null) {
    result += "#" + uri.indexPath;
  }

  return result;
}

/**
 * Create a CAS URI from components
 *
 * @param root - Root reference
 * @param path - Optional path segments
 * @param indexPath - Optional index path (fragment)
 * @returns CAS URI object
 */
export function createCasUri(
  root: CasUriRoot,
  path: string[] = [],
  indexPath: string | null = null
): CasUri {
  return { root, path, indexPath };
}

/**
 * Create a node URI
 *
 * @param hash - Node hash (26 character Crockford Base32)
 * @param path - Optional path segments
 * @param indexPath - Optional index path
 */
export function nodeUri(
  hash: string,
  path: string[] = [],
  indexPath: string | null = null
): CasUri {
  return createCasUri({ type: "node", hash }, path, indexPath);
}

/**
 * Create a depot URI
 *
 * @param id - Depot ID (26 character Crockford Base32)
 * @param path - Optional path segments
 * @param indexPath - Optional index path
 */
export function depotUri(
  id: string,
  path: string[] = [],
  indexPath: string | null = null
): CasUri {
  return createCasUri({ type: "depot", id }, path, indexPath);
}

/**
 * Create a ticket URI
 *
 * @param id - Ticket ID (26 character Crockford Base32)
 * @param path - Optional path segments
 * @param indexPath - Optional index path
 */
export function ticketUri(
  id: string,
  path: string[] = [],
  indexPath: string | null = null
): CasUri {
  return createCasUri({ type: "ticket", id }, path, indexPath);
}
