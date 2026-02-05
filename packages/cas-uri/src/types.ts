/**
 * CAS URI type definitions
 *
 * CAS URI format: {root}[/path...][#index-path]
 *
 * Root types:
 * - node:{hash}     - Direct node reference
 * - depot:{id}      - Depot current root
 * - ticket:{id}     - Ticket output root
 */

/**
 * CAS URI root types
 */
export type CasUriRootType = "node" | "depot" | "ticket";

/**
 * Parsed CAS URI root
 */
export type CasUriRoot =
  | { type: "node"; hash: string }
  | { type: "depot"; id: string }
  | { type: "ticket"; id: string };

/**
 * Parsed CAS URI
 */
export type CasUri = {
  /** Root reference (node, depot, or ticket) */
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
  code:
    | "invalid_format"
    | "invalid_root"
    | "invalid_hash"
    | "invalid_id"
    | "empty_uri";
  message: string;
};

/**
 * CAS URI parse result
 */
export type CasUriParseResult =
  | { ok: true; uri: CasUri }
  | { ok: false; error: CasUriParseError };
