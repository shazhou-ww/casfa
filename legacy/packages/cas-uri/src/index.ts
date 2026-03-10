/**
 * @casfa/cas-uri
 *
 * CAS URI parsing and formatting for content-addressable storage.
 *
 * CAS URI format: {root}[/segment...]
 * Segments can be name segments or ~N index segments.
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
  PathSegment,
} from "./types.ts";

// ============================================================================
// Constants
// ============================================================================

export {
  CROCKFORD_BASE32_26,
  INDEX_SEGMENT_PREFIX,
  INDEX_SEGMENT_REGEX,
  PATH_SEGMENT_REGEX,
  ROOT_TYPES,
} from "./constants.ts";

// ============================================================================
// Parsing
// ============================================================================

export { parseCasUri, parseCasUriOrThrow, parsePathSegments } from "./parse.ts";

// ============================================================================
// Formatting
// ============================================================================

export {
  createCasUri,
  depotUri,
  formatCasUri,
  nodeUri,
} from "./format.ts";

// ============================================================================
// Path Resolution
// ============================================================================

export {
  appendIndex,
  appendPath,
  basename,
  getIndexPath,
  getNamePath,
  indexSegment,
  isAncestorOf,
  nameSegment,
  parentUri,
  resolvePath,
  rootUri,
  uriEquals,
} from "./resolve.ts";
