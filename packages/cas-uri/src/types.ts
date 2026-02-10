/**
 * CAS URI type definitions
 *
 * CAS URI format: {root}[/path...][#index-path]
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
export type CasUriRoot =
  | { type: "nod"; hash: string }
  | { type: "dpt"; id: string };

/**
 * Parsed CAS URI
 */
export type CasUri = {
  /** Root reference (nod or dpt) */
  root: CasUriRoot;
  /** Path segments (after root, before fragment) */
  path: string[];
  /** Index path (fragment part, for dict item indexing) */
  indexPath: string | null;
};

/**
 * CAS URI parse error
 */
export type CasUriParseError = {
  code: "invalid_format" | "invalid_root" | "invalid_hash" | "invalid_id" | "empty_uri";
  message: string;
};

/**
 * CAS URI parse result
 */
export type CasUriParseResult = { ok: true; uri: CasUri } | { ok: false; error: CasUriParseError };
