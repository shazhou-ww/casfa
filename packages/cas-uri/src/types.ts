/**
 * CAS URI type definitions
 *
 * CAS URI format: {root}[/segment...]
 *
 * Segments can be:
 * - Name segments: regular path names (e.g., "src", "main.ts")
 * - Index segments: prefixed with ~ (e.g., ~0, ~1, ~2)
 *
 * Root types:
 * - nod_{hash}     - Direct node reference
 * - dpt_{id}       - Depot current root
 */

/**
 * CAS URI root types
 */
export type CasUriRootType = "nod" | "dpt";

/**
 * Parsed CAS URI root
 */
export type CasUriRoot = { type: "nod"; hash: string } | { type: "dpt"; id: string };

/**
 * A path segment in a CAS URI.
 * - "name" segments navigate by child name in d-nodes
 * - "index" segments navigate by child index in any node
 */
export type PathSegment = { kind: "name"; value: string } | { kind: "index"; value: number };

/**
 * Parsed CAS URI
 */
export type CasUri = {
  /** Root reference (nod or dpt) */
  root: CasUriRoot;
  /** Path segments — name or index */
  segments: PathSegment[];
};

/**
 * CAS URI parse error
 */
export type CasUriParseError = {
  code:
    | "invalid_format"
    | "invalid_root"
    | "invalid_hash"
    | "invalid_id"
    | "empty_uri"
    | "invalid_index";
  message: string;
};

/**
 * CAS URI parse result
 */
export type CasUriParseResult = { ok: true; uri: CasUri } | { ok: false; error: CasUriParseError };
