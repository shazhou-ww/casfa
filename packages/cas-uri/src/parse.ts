/**
 * CAS URI parsing
 *
 * Root format: prefix_CB32VALUE (using underscore separator)
 * e.g., nod_ABCDEF.../path or dpt_ABCDEF.../path
 */

import { CROCKFORD_BASE32_26, ROOT_TYPES } from "./constants.ts";
import type {
  CasUri,
  CasUriParseError,
  CasUriParseResult,
  CasUriRoot,
  CasUriRootType,
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
 * Parse a CAS URI string
 *
 * Format: {root}[/path...][#index-path]
 *
 * @param uriStr - CAS URI string to parse
 * @returns Parse result with parsed URI or error
 *
 * @example
 * ```ts
 * parseCasUri("nod_ABC123XYZ01234567890ABCD/docs/readme.md")
 * // => { ok: true, uri: { root: { type: "nod", hash: "ABC123XYZ01234567890ABCD" }, path: ["docs", "readme.md"], indexPath: null } }
 *
 * parseCasUri("dpt_01HQABC123XYZ456789012/config#version")
 * // => { ok: true, uri: { root: { type: "dpt", id: "01HQABC123XYZ456789012" }, path: ["config"], indexPath: "version" } }
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

  // Split fragment (index path)
  let indexPath: string | null = null;
  let mainPart = uriStr;

  const hashIndex = uriStr.indexOf("#");
  if (hashIndex !== -1) {
    indexPath = uriStr.slice(hashIndex + 1);
    mainPart = uriStr.slice(0, hashIndex);
  }

  // Split by path separator
  const parts = mainPart.split("/");
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

  // Extract path segments (filter empty strings from consecutive slashes)
  const path = parts.slice(1).filter((p) => p !== "");

  return {
    ok: true,
    uri: {
      root: rootResult,
      path,
      indexPath,
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
