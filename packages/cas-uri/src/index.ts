/**
 * @casfa/cas-uri
 *
 * CAS URI parsing and formatting for content-addressable storage.
 *
 * CAS URI format: {root}[/path...][#index-path]
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

export type {
  CasUri,
  CasUriParseError,
  CasUriParseResult,
  CasUriRoot,
  CasUriRootType,
} from "./types.ts";

// ============================================================================
// Constants
// ============================================================================

export { CROCKFORD_BASE32_26, PATH_SEGMENT_REGEX, ROOT_TYPES } from "./constants.ts";

// ============================================================================
// Parsing
// ============================================================================

export { parseCasUri, parseCasUriOrThrow } from "./parse.ts";

// ============================================================================
// Formatting
// ============================================================================

export {
  createCasUri,
  depotUri,
  formatCasUri,
  nodeUri,
  ticketUri,
} from "./format.ts";

// ============================================================================
// Path Resolution
// ============================================================================

export {
  appendPath,
  basename,
  isAncestorOf,
  parentUri,
  resolvePath,
  rootUri,
  uriEquals,
  withIndexPath,
} from "./resolve.ts";
