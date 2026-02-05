/**
 * CAS URI tests
 */

import { describe, it, expect } from "bun:test";
import {
  // Types
  type CasUri,
  // Parsing
  parseCasUri,
  parseCasUriOrThrow,
  // Formatting
  formatCasUri,
  createCasUri,
  nodeUri,
  depotUri,
  ticketUri,
  // Path resolution
  appendPath,
  parentUri,
  rootUri,
  withIndexPath,
  basename,
  resolvePath,
  uriEquals,
  isAncestorOf,
} from "./index.ts";

// ============================================================================
// Test Constants
// ============================================================================

// Valid 26-character Crockford Base32 strings
const VALID_HASH = "A6JCHNMFWRT90AXMYWHJ8HKS90";
const VALID_DEPOT_ID = "01HQXK5V8N3Y7M2P4R6T9W0ABC";
const VALID_TICKET_ID = "01HQXK5V8N3Y7M2P4R6T9W0DEF";

// ============================================================================
// Parsing Tests
// ============================================================================

describe("parseCasUri", () => {
  describe("node URIs", () => {
    it("should parse node URI without path", () => {
      const result = parseCasUri(`node:${VALID_HASH}`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.root).toEqual({ type: "node", hash: VALID_HASH });
        expect(result.uri.path).toEqual([]);
        expect(result.uri.indexPath).toBeNull();
      }
    });

    it("should parse node URI with path", () => {
      const result = parseCasUri(`node:${VALID_HASH}/docs/readme.md`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.root).toEqual({ type: "node", hash: VALID_HASH });
        expect(result.uri.path).toEqual(["docs", "readme.md"]);
      }
    });

    it("should parse node URI with index path", () => {
      const result = parseCasUri(`node:${VALID_HASH}/config#version`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.path).toEqual(["config"]);
        expect(result.uri.indexPath).toBe("version");
      }
    });
  });

  describe("depot URIs", () => {
    it("should parse depot URI", () => {
      const result = parseCasUri(`depot:${VALID_DEPOT_ID}`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.root).toEqual({ type: "depot", id: VALID_DEPOT_ID });
      }
    });

    it("should parse depot URI with path and fragment", () => {
      const result = parseCasUri(`depot:${VALID_DEPOT_ID}/src/main.ts#exports`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.root).toEqual({ type: "depot", id: VALID_DEPOT_ID });
        expect(result.uri.path).toEqual(["src", "main.ts"]);
        expect(result.uri.indexPath).toBe("exports");
      }
    });
  });

  describe("ticket URIs", () => {
    it("should parse ticket URI", () => {
      const result = parseCasUri(`ticket:${VALID_TICKET_ID}`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.root).toEqual({ type: "ticket", id: VALID_TICKET_ID });
      }
    });
  });

  describe("error cases", () => {
    it("should fail on empty URI", () => {
      const result = parseCasUri("");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("empty_uri");
      }
    });

    it("should fail on invalid root type", () => {
      const result = parseCasUri(`invalid:${VALID_HASH}`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_root");
      }
    });

    it("should fail on invalid hash format", () => {
      const result = parseCasUri("node:invalid-hash");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_hash");
      }
    });

    it("should fail on invalid depot ID", () => {
      const result = parseCasUri("depot:short");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_id");
      }
    });

    it("should fail on missing colon", () => {
      const result = parseCasUri("node");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_format");
      }
    });
  });

  describe("edge cases", () => {
    it("should handle consecutive slashes", () => {
      const result = parseCasUri(`node:${VALID_HASH}//docs///file.txt`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Empty segments are filtered
        expect(result.uri.path).toEqual(["docs", "file.txt"]);
      }
    });

    it("should handle fragment-only after root", () => {
      const result = parseCasUri(`node:${VALID_HASH}#index`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.path).toEqual([]);
        expect(result.uri.indexPath).toBe("index");
      }
    });
  });
});

describe("parseCasUriOrThrow", () => {
  it("should return parsed URI on success", () => {
    const uri = parseCasUriOrThrow(`node:${VALID_HASH}/path`);
    expect(uri.root).toEqual({ type: "node", hash: VALID_HASH });
    expect(uri.path).toEqual(["path"]);
  });

  it("should throw on invalid URI", () => {
    expect(() => parseCasUriOrThrow("invalid")).toThrow();
  });
});

// ============================================================================
// Formatting Tests
// ============================================================================

describe("formatCasUri", () => {
  it("should format node URI without path", () => {
    const uri = nodeUri(VALID_HASH);
    expect(formatCasUri(uri)).toBe(`node:${VALID_HASH}`);
  });

  it("should format node URI with path", () => {
    const uri = nodeUri(VALID_HASH, ["docs", "readme.md"]);
    expect(formatCasUri(uri)).toBe(`node:${VALID_HASH}/docs/readme.md`);
  });

  it("should format URI with index path", () => {
    const uri = nodeUri(VALID_HASH, ["config"], "version");
    expect(formatCasUri(uri)).toBe(`node:${VALID_HASH}/config#version`);
  });

  it("should format depot URI", () => {
    const uri = depotUri(VALID_DEPOT_ID, ["src"]);
    expect(formatCasUri(uri)).toBe(`depot:${VALID_DEPOT_ID}/src`);
  });

  it("should format ticket URI", () => {
    const uri = ticketUri(VALID_TICKET_ID);
    expect(formatCasUri(uri)).toBe(`ticket:${VALID_TICKET_ID}`);
  });
});

describe("parse/format roundtrip", () => {
  const testCases = [
    `node:${VALID_HASH}`,
    `node:${VALID_HASH}/path`,
    `node:${VALID_HASH}/docs/readme.md`,
    `node:${VALID_HASH}/config#version`,
    `depot:${VALID_DEPOT_ID}`,
    `depot:${VALID_DEPOT_ID}/src/main.ts#exports`,
    `ticket:${VALID_TICKET_ID}`,
    `ticket:${VALID_TICKET_ID}/output`,
  ];

  for (const uriStr of testCases) {
    it(`should roundtrip: ${uriStr}`, () => {
      const parsed = parseCasUriOrThrow(uriStr);
      const formatted = formatCasUri(parsed);
      expect(formatted).toBe(uriStr);
    });
  }
});

// ============================================================================
// URI Builder Tests
// ============================================================================

describe("createCasUri", () => {
  it("should create URI with all components", () => {
    const uri = createCasUri(
      { type: "node", hash: VALID_HASH },
      ["path", "to", "file"],
      "index"
    );
    expect(uri.root).toEqual({ type: "node", hash: VALID_HASH });
    expect(uri.path).toEqual(["path", "to", "file"]);
    expect(uri.indexPath).toBe("index");
  });

  it("should default path and indexPath", () => {
    const uri = createCasUri({ type: "depot", id: VALID_DEPOT_ID });
    expect(uri.path).toEqual([]);
    expect(uri.indexPath).toBeNull();
  });
});

// ============================================================================
// Path Resolution Tests
// ============================================================================

describe("appendPath", () => {
  it("should append single segment", () => {
    const base = nodeUri(VALID_HASH, ["docs"]);
    const result = appendPath(base, "readme.md");
    expect(result.path).toEqual(["docs", "readme.md"]);
  });

  it("should append multiple segments", () => {
    const base = nodeUri(VALID_HASH);
    const result = appendPath(base, "src", "lib", "utils.ts");
    expect(result.path).toEqual(["src", "lib", "utils.ts"]);
  });

  it("should filter empty segments", () => {
    const base = nodeUri(VALID_HASH);
    const result = appendPath(base, "", "path", "");
    expect(result.path).toEqual(["path"]);
  });

  it("should clear index path when appending", () => {
    const base = nodeUri(VALID_HASH, ["config"], "version");
    const result = appendPath(base, "sub");
    expect(result.indexPath).toBeNull();
  });
});

describe("parentUri", () => {
  it("should return parent", () => {
    const uri = nodeUri(VALID_HASH, ["docs", "readme.md"]);
    const parent = parentUri(uri);
    expect(parent).not.toBeNull();
    expect(parent!.path).toEqual(["docs"]);
  });

  it("should return null at root", () => {
    const uri = nodeUri(VALID_HASH);
    expect(parentUri(uri)).toBeNull();
  });

  it("should clear index path", () => {
    const uri = nodeUri(VALID_HASH, ["config"], "version");
    const parent = parentUri(uri);
    expect(parent).not.toBeNull();
    expect(parent!.indexPath).toBeNull();
  });
});

describe("rootUri", () => {
  it("should return root", () => {
    const uri = nodeUri(VALID_HASH, ["deep", "nested", "path"], "index");
    const root = rootUri(uri);
    expect(root.root).toEqual({ type: "node", hash: VALID_HASH });
    expect(root.path).toEqual([]);
    expect(root.indexPath).toBeNull();
  });
});

describe("withIndexPath", () => {
  it("should set index path", () => {
    const uri = nodeUri(VALID_HASH, ["config"]);
    const result = withIndexPath(uri, "version");
    expect(result.indexPath).toBe("version");
  });

  it("should clear index path", () => {
    const uri = nodeUri(VALID_HASH, ["config"], "version");
    const result = withIndexPath(uri, null);
    expect(result.indexPath).toBeNull();
  });
});

describe("basename", () => {
  it("should return last segment", () => {
    const uri = nodeUri(VALID_HASH, ["docs", "readme.md"]);
    expect(basename(uri)).toBe("readme.md");
  });

  it("should return null for root", () => {
    const uri = nodeUri(VALID_HASH);
    expect(basename(uri)).toBeNull();
  });
});

describe("resolvePath", () => {
  it("should resolve relative path", () => {
    const base = nodeUri(VALID_HASH, ["docs"]);
    const result = resolvePath(base, "readme.md");
    expect(result.path).toEqual(["docs", "readme.md"]);
  });

  it("should handle ./ prefix", () => {
    const base = nodeUri(VALID_HASH, ["docs"]);
    const result = resolvePath(base, "./readme.md");
    expect(result.path).toEqual(["docs", "readme.md"]);
  });

  it("should handle ../ (go up)", () => {
    const base = nodeUri(VALID_HASH, ["docs", "api"]);
    const result = resolvePath(base, "../readme.md");
    expect(result.path).toEqual(["docs", "readme.md"]);
  });

  it("should handle multiple ../", () => {
    const base = nodeUri(VALID_HASH, ["a", "b", "c"]);
    const result = resolvePath(base, "../../d");
    expect(result.path).toEqual(["a", "d"]);
  });

  it("should not go above root", () => {
    const base = nodeUri(VALID_HASH, ["docs"]);
    const result = resolvePath(base, "../../file.txt");
    expect(result.path).toEqual(["file.txt"]);
  });

  it("should clear index path", () => {
    const base = nodeUri(VALID_HASH, ["config"], "version");
    const result = resolvePath(base, "sub");
    expect(result.indexPath).toBeNull();
  });
});

// ============================================================================
// Comparison Tests
// ============================================================================

describe("uriEquals", () => {
  it("should return true for equal URIs", () => {
    const a = nodeUri(VALID_HASH, ["docs"], "index");
    const b = nodeUri(VALID_HASH, ["docs"], "index");
    expect(uriEquals(a, b)).toBe(true);
  });

  it("should return false for different roots", () => {
    const a = nodeUri(VALID_HASH);
    const b = depotUri(VALID_DEPOT_ID);
    expect(uriEquals(a, b)).toBe(false);
  });

  it("should return false for different hashes", () => {
    const a = nodeUri(VALID_HASH);
    const b = nodeUri("B6JCHNMFWRT90AXMYWHJ8HKS91");
    expect(uriEquals(a, b)).toBe(false);
  });

  it("should return false for different paths", () => {
    const a = nodeUri(VALID_HASH, ["docs"]);
    const b = nodeUri(VALID_HASH, ["src"]);
    expect(uriEquals(a, b)).toBe(false);
  });

  it("should return false for different index paths", () => {
    const a = nodeUri(VALID_HASH, ["config"], "v1");
    const b = nodeUri(VALID_HASH, ["config"], "v2");
    expect(uriEquals(a, b)).toBe(false);
  });
});

describe("isAncestorOf", () => {
  it("should return true for ancestor", () => {
    const ancestor = nodeUri(VALID_HASH, ["docs"]);
    const descendant = nodeUri(VALID_HASH, ["docs", "api", "readme.md"]);
    expect(isAncestorOf(ancestor, descendant)).toBe(true);
  });

  it("should return true for root as ancestor", () => {
    const ancestor = nodeUri(VALID_HASH);
    const descendant = nodeUri(VALID_HASH, ["any", "path"]);
    expect(isAncestorOf(ancestor, descendant)).toBe(true);
  });

  it("should return true for self", () => {
    const uri = nodeUri(VALID_HASH, ["docs"]);
    expect(isAncestorOf(uri, uri)).toBe(true);
  });

  it("should return false for different roots", () => {
    const ancestor = nodeUri(VALID_HASH);
    const descendant = depotUri(VALID_DEPOT_ID);
    expect(isAncestorOf(ancestor, descendant)).toBe(false);
  });

  it("should return false for descendant as ancestor", () => {
    const ancestor = nodeUri(VALID_HASH, ["docs", "api"]);
    const descendant = nodeUri(VALID_HASH, ["docs"]);
    expect(isAncestorOf(ancestor, descendant)).toBe(false);
  });

  it("should return false for sibling paths", () => {
    const a = nodeUri(VALID_HASH, ["docs"]);
    const b = nodeUri(VALID_HASH, ["src"]);
    expect(isAncestorOf(a, b)).toBe(false);
  });
});
