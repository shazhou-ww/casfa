/**
 * CAS URI formatting
 */

import { INDEX_SEGMENT_PREFIX } from "./constants.ts";
import type { CasUri, CasUriRoot, PathSegment } from "./types.ts";

/**
 * Format a CasUriRoot to string
 */
function formatRoot(root: CasUriRoot): string {
  switch (root.type) {
    case "nod":
      return `nod_${root.hash}`;
    case "dpt":
      return `dpt_${root.id}`;
  }
}

/**
 * Format a single path segment to string
 */
function formatSegment(seg: PathSegment): string {
  switch (seg.kind) {
    case "name":
      return seg.value;
    case "index":
      return `${INDEX_SEGMENT_PREFIX}${seg.value}`;
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
 *   root: { type: "nod", hash: "ABC123XYZ01234567890ABCD" },
 *   segments: [{ kind: "name", value: "docs" }, { kind: "name", value: "readme.md" }]
 * })
 * // => "nod_ABC123XYZ01234567890ABCD/docs/readme.md"
 *
 * formatCasUri({
 *   root: { type: "dpt", id: "01HQABC..." },
 *   segments: [{ kind: "name", value: "src" }, { kind: "index", value: 0 }]
 * })
 * // => "dpt_01HQABC.../src/~0"
 * ```
 */
export function formatCasUri(uri: CasUri): string {
  let result = formatRoot(uri.root);

  if (uri.segments.length > 0) {
    result += `/${uri.segments.map(formatSegment).join("/")}`;
  }

  return result;
}

/**
 * Create a CAS URI from components
 *
 * @param root - Root reference
 * @param segments - Path segments (name or index)
 * @returns CAS URI object
 */
export function createCasUri(root: CasUriRoot, segments: PathSegment[] = []): CasUri {
  return { root, segments };
}

/**
 * Create a node URI
 *
 * @param hash - Node hash (26 character Crockford Base32)
 * @param path - Optional name path segments
 * @param indexPath - Optional trailing index segments
 */
export function nodeUri(hash: string, path: string[] = [], indexPath?: number[]): CasUri {
  const segments: PathSegment[] = [
    ...path.map((value): PathSegment => ({ kind: "name", value })),
    ...(indexPath ?? []).map((value): PathSegment => ({ kind: "index", value })),
  ];
  return createCasUri({ type: "nod", hash }, segments);
}

/**
 * Create a depot URI
 *
 * @param id - Depot ID (26 character Crockford Base32)
 * @param path - Optional name path segments
 * @param indexPath - Optional trailing index segments
 */
export function depotUri(id: string, path: string[] = [], indexPath?: number[]): CasUri {
  const segments: PathSegment[] = [
    ...path.map((value): PathSegment => ({ kind: "name", value })),
    ...(indexPath ?? []).map((value): PathSegment => ({ kind: "index", value })),
  ];
  return createCasUri({ type: "dpt", id }, segments);
}
