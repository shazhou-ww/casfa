/**
 * CAS URI parsing
 *
 * Root format: prefix_CB32VALUE (using underscore separator)
 * Segments: name segments or ~N index segments
 * e.g., nod_ABCDEF.../path/~0/~1 or dpt_ABCDEF.../path
 */

import { CROCKFORD_BASE32_26, INDEX_SEGMENT_REGEX, ROOT_TYPES } from "./constants.ts";
import type {
  CasUri,
  CasUriParseError,
  CasUriParseResult,
  CasUriRoot,
  CasUriRootType,
  PathSegment,
} from "./types.ts";

/**
 * Parse a root string into CasUriRoot
 *
 * Root format: prefix_CB32VALUE (e.g., nod_XXXX..., dpt_XXXX...)
 */
function parseRoot(rootStr: string): CasUriRoot | CasUriParseError {
  const underscoreIndex = rootStr.indexOf("_");
  if (underscoreIndex === -1) {
    return {
      code: "invalid_format",
      message: `Invalid root format: missing '_' separator`,
    };
  }

  const type = rootStr.slice(0, underscoreIndex) as CasUriRootType;
  const value = rootStr.slice(underscoreIndex + 1);

  if (!ROOT_TYPES.includes(type)) {
    return {
      code: "invalid_root",
      message: `Invalid root type: "${type}". Expected one of: ${ROOT_TYPES.join(", ")}`,
    };
  }

  // Validate the ID/hash format
  if (!CROCKFORD_BASE32_26.test(value)) {
    return {
      code: type === "nod" ? "invalid_hash" : "invalid_id",
      message: `Invalid ${type === "nod" ? "hash" : "ID"}: "${value}". Expected 26-character Crockford Base32`,
    };
  }

  switch (type) {
    case "nod":
      return { type: "nod", hash: value };
    case "dpt":
      return { type: "dpt", id: value };
  }
}

/**
 * Parse a raw path segment string into a PathSegment.
 *
 * Segments starting with ~ followed by digits are index segments.
 * All other segments are name segments.
 */
function parseSegment(raw: string): PathSegment | CasUriParseError {
  const indexMatch = raw.match(INDEX_SEGMENT_REGEX);
  if (indexMatch) {
    const value = Number.parseInt(indexMatch[1]!, 10);
    if (!Number.isFinite(value) || value < 0) {
      return {
        code: "invalid_index",
        message: `Invalid index segment: "${raw}"`,
      };
    }
    return { kind: "index", value };
  }
  return { kind: "name", value: raw };
}

/**
 * Parse a CAS URI string
 *
 * Format: {root}[/segment...]
 * Segments can be name segments or ~N index segments.
 *
 * @param uriStr - CAS URI string to parse
 * @returns Parse result with parsed URI or error
 *
 * @example
 * ```ts
 * parseCasUri("nod_ABC123XYZ01234567890ABCD/docs/readme.md")
 * // => { ok: true, uri: { root: { type: "nod", hash: "ABC123..." }, segments: [{kind:"name",value:"docs"},{kind:"name",value:"readme.md"}] } }
 *
 * parseCasUri("dpt_01HQABC123XYZ456789012/src/~0/~1")
 * // => { ok: true, uri: { root: { type: "dpt", id: "01HQABC..." }, segments: [{kind:"name",value:"src"},{kind:"index",value:0},{kind:"index",value:1}] } }
 * ```
 */
export function parseCasUri(uriStr: string): CasUriParseResult {
  // Handle empty input
  if (!uriStr || uriStr.trim() === "") {
    return {
      ok: false,
      error: {
        code: "empty_uri",
        message: "URI cannot be empty",
      },
    };
  }

  // Split by path separator
  const parts = uriStr.split("/");
  const rootStr = parts[0];

  if (!rootStr) {
    return {
      ok: false,
      error: {
        code: "invalid_format",
        message: "URI must start with a root reference",
      },
    };
  }

  // Parse root
  const rootResult = parseRoot(rootStr);
  if ("code" in rootResult) {
    return { ok: false, error: rootResult };
  }

  // Parse segments (filter empty strings from consecutive slashes)
  const segments: PathSegment[] = [];
  const rawSegments = parts.slice(1).filter((p) => p !== "");

  for (const raw of rawSegments) {
    const seg = parseSegment(raw);
    if ("code" in seg) {
      return { ok: false, error: seg };
    }
    segments.push(seg);
  }

  return {
    ok: true,
    uri: {
      root: rootResult,
      segments,
    },
  };
}

/**
 * Parse a CAS URI string, throwing on error
 *
 * @param uriStr - CAS URI string to parse
 * @returns Parsed CAS URI
 * @throws Error if parsing fails
 */
export function parseCasUriOrThrow(uriStr: string): CasUri {
  const result = parseCasUri(uriStr);
  if (!result.ok) {
    throw new Error(`Failed to parse CAS URI: ${result.error.message}`);
  }
  return result.uri;
}

/**
 * Parse a path-only string (no root) into PathSegment[].
 *
 * Splits on "/" and classifies each segment as a name or ~N index segment.
 * Returns an empty array for empty/undefined input.
 *
 * @example
 * ```ts
 * parsePathSegments("src/~0/utils/~2")
 * // => { ok: true, segments: [{kind:"name",value:"src"},{kind:"index",value:0},{kind:"name",value:"utils"},{kind:"index",value:2}] }
 * ```
 */
export function parsePathSegments(
  pathStr: string | undefined
): { ok: true; segments: PathSegment[] } | { ok: false; error: CasUriParseError } {
  if (!pathStr || pathStr.trim() === "") {
    return { ok: true, segments: [] };
  }

  const parts = pathStr.split("/").filter((p) => p !== "");
  const segments: PathSegment[] = [];

  for (const raw of parts) {
    const seg = parseSegment(raw);
    if ("code" in seg) {
      return { ok: false, error: seg };
    }
    segments.push(seg);
  }

  return { ok: true, segments };
}
