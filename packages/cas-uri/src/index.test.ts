/**
 * CAS URI tests
 */

import { describe, expect, it } from "bun:test";
import {
  appendIndex,
  appendPath,
  basename,
  createCasUri,
  depotUri,
  formatCasUri,
  getIndexPath,
  getNamePath,
  indexSegment,
  isAncestorOf,
  nameSegment,
  nodeUri,
  parentUri,
  parseCasUri,
  parseCasUriOrThrow,
  resolvePath,
  rootUri,
  uriEquals,
} from "./index.ts";

// ============================================================================
// Test Constants
// ============================================================================

// Valid 26-character Crockford Base32 strings
const VALID_HASH = "A6JCHNMFWRT90AXMYWHJ8HKS90";
const VALID_DEPOT_ID = "01HQXK5V8N3Y7M2P4R6T9W0ABC";

// ============================================================================
// Parsing Tests
// ============================================================================

describe("parseCasUri", () => {
  describe("node URIs", () => {
    it("should parse node URI without segments", () => {
      const result = parseCasUri(`nod_${VALID_HASH}`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.root).toEqual({ type: "nod", hash: VALID_HASH });
        expect(result.uri.segments).toEqual([]);
      }
    });

    it("should parse node URI with name path", () => {
      const result = parseCasUri(`nod_${VALID_HASH}/docs/readme.md`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.root).toEqual({ type: "nod", hash: VALID_HASH });
        expect(result.uri.segments).toEqual([
          { kind: "name", value: "docs" },
          { kind: "name", value: "readme.md" },
        ]);
      }
    });

    it("should parse node URI with index segments", () => {
      const result = parseCasUri(`nod_${VALID_HASH}/~0/~2/~1`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.segments).toEqual([
          { kind: "index", value: 0 },
          { kind: "index", value: 2 },
          { kind: "index", value: 1 },
        ]);
      }
    });

    it("should parse node URI with mixed name+index segments", () => {
      const result = parseCasUri(`nod_${VALID_HASH}/src/~0/~1`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.segments).toEqual([
          { kind: "name", value: "src" },
          { kind: "index", value: 0 },
          { kind: "index", value: 1 },
        ]);
      }
    });

    it("should parse index-then-name segments", () => {
      const result = parseCasUri(`nod_${VALID_HASH}/~1/utils/helper.ts`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.segments).toEqual([
          { kind: "index", value: 1 },
          { kind: "name", value: "utils" },
          { kind: "name", value: "helper.ts" },
        ]);
      }
    });
  });

  describe("depot URIs", () => {
    it("should parse depot URI", () => {
      const result = parseCasUri(`dpt_${VALID_DEPOT_ID}`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.root).toEqual({ type: "dpt", id: VALID_DEPOT_ID });
      }
    });

    it("should parse depot URI with mixed segments", () => {
      const result = parseCasUri(`dpt_${VALID_DEPOT_ID}/src/main.ts/~0`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.root).toEqual({ type: "dpt", id: VALID_DEPOT_ID });
        expect(result.uri.segments).toEqual([
          { kind: "name", value: "src" },
          { kind: "name", value: "main.ts" },
          { kind: "index", value: 0 },
        ]);
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
      const result = parseCasUri(`invalid_${VALID_HASH}`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_root");
      }
    });

    it("should fail on invalid hash format", () => {
      const result = parseCasUri("nod_invalid-hash");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_hash");
      }
    });

    it("should fail on invalid depot ID", () => {
      const result = parseCasUri("dpt_short");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_id");
      }
    });

    it("should fail on missing underscore", () => {
      const result = parseCasUri("nod");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_format");
      }
    });
  });

  describe("edge cases", () => {
    it("should handle consecutive slashes", () => {
      const result = parseCasUri(`nod_${VALID_HASH}//docs///file.txt`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Empty segments are filtered
        expect(result.uri.segments).toEqual([
          { kind: "name", value: "docs" },
          { kind: "name", value: "file.txt" },
        ]);
      }
    });

    it("should handle index-only after root", () => {
      const result = parseCasUri(`nod_${VALID_HASH}/~3`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.uri.segments).toEqual([{ kind: "index", value: 3 }]);
      }
    });
  });
});

describe("parseCasUriOrThrow", () => {
  it("should return parsed URI on success", () => {
    const uri = parseCasUriOrThrow(`nod_${VALID_HASH}/path`);
    expect(uri.root).toEqual({ type: "nod", hash: VALID_HASH });
    expect(uri.segments).toEqual([{ kind: "name", value: "path" }]);
  });

  it("should throw on invalid URI", () => {
    expect(() => parseCasUriOrThrow("invalid")).toThrow();
  });
});

// ============================================================================
// Formatting Tests
// ============================================================================

describe("formatCasUri", () => {
  it("should format node URI without segments", () => {
    const uri = nodeUri(VALID_HASH);
    expect(formatCasUri(uri)).toBe(`nod_${VALID_HASH}`);
  });

  it("should format node URI with name path", () => {
    const uri = nodeUri(VALID_HASH, ["docs", "readme.md"]);
    expect(formatCasUri(uri)).toBe(`nod_${VALID_HASH}/docs/readme.md`);
  });

  it("should format URI with index segments", () => {
    const uri = nodeUri(VALID_HASH, ["config"], [0, 1]);
    expect(formatCasUri(uri)).toBe(`nod_${VALID_HASH}/config/~0/~1`);
  });

  it("should format URI with index-only segments", () => {
    const uri = nodeUri(VALID_HASH, [], [1, 2, 3]);
    expect(formatCasUri(uri)).toBe(`nod_${VALID_HASH}/~1/~2/~3`);
  });

  it("should format depot URI", () => {
    const uri = depotUri(VALID_DEPOT_ID, ["src"]);
    expect(formatCasUri(uri)).toBe(`dpt_${VALID_DEPOT_ID}/src`);
  });
});

describe("parse/format roundtrip", () => {
  const testCases = [
    `nod_${VALID_HASH}`,
    `nod_${VALID_HASH}/path`,
    `nod_${VALID_HASH}/docs/readme.md`,
    `nod_${VALID_HASH}/config/~0/~1`,
    `nod_${VALID_HASH}/~1/~2/~3`,
    `dpt_${VALID_DEPOT_ID}`,
    `dpt_${VALID_DEPOT_ID}/src/main.ts/~0`,
    `dpt_${VALID_DEPOT_ID}/~1/utils/helper.ts`,
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
  it("should create URI with segments", () => {
    const uri = createCasUri({ type: "nod", hash: VALID_HASH }, [
      nameSegment("path"),
      nameSegment("to"),
      indexSegment(2),
    ]);
    expect(uri.root).toEqual({ type: "nod", hash: VALID_HASH });
    expect(uri.segments).toEqual([
      { kind: "name", value: "path" },
      { kind: "name", value: "to" },
      { kind: "index", value: 2 },
    ]);
  });

  it("should default to empty segments", () => {
    const uri = createCasUri({ type: "dpt", id: VALID_DEPOT_ID });
    expect(uri.segments).toEqual([]);
  });
});

// ============================================================================
// Path Resolution Tests
// ============================================================================

describe("appendPath", () => {
  it("should append single name segment", () => {
    const base = nodeUri(VALID_HASH, ["docs"]);
    const result = appendPath(base, "readme.md");
    expect(result.segments).toEqual([
      { kind: "name", value: "docs" },
      { kind: "name", value: "readme.md" },
    ]);
  });

  it("should append multiple name segments", () => {
    const base = nodeUri(VALID_HASH);
    const result = appendPath(base, "src", "lib", "utils.ts");
    expect(result.segments).toEqual([
      { kind: "name", value: "src" },
      { kind: "name", value: "lib" },
      { kind: "name", value: "utils.ts" },
    ]);
  });

  it("should filter empty segments", () => {
    const base = nodeUri(VALID_HASH);
    const result = appendPath(base, "", "path", "");
    expect(result.segments).toEqual([{ kind: "name", value: "path" }]);
  });
});

describe("appendIndex", () => {
  it("should append index segments", () => {
    const base = nodeUri(VALID_HASH, ["src"]);
    const result = appendIndex(base, 0, 1);
    expect(result.segments).toEqual([
      { kind: "name", value: "src" },
      { kind: "index", value: 0 },
      { kind: "index", value: 1 },
    ]);
  });

  it("should append index after existing index segments", () => {
    const base = nodeUri(VALID_HASH, [], [1, 2]);
    const result = appendIndex(base, 3);
    expect(result.segments).toEqual([
      { kind: "index", value: 1 },
      { kind: "index", value: 2 },
      { kind: "index", value: 3 },
    ]);
  });
});

describe("parentUri", () => {
  it("should return parent (drop last name segment)", () => {
    const uri = nodeUri(VALID_HASH, ["docs", "readme.md"]);
    const parent = parentUri(uri);
    expect(parent).not.toBeNull();
    expect(parent!.segments).toEqual([{ kind: "name", value: "docs" }]);
  });

  it("should return parent (drop last index segment)", () => {
    const uri = nodeUri(VALID_HASH, ["src"], [0, 1]);
    const parent = parentUri(uri);
    expect(parent).not.toBeNull();
    expect(parent!.segments).toEqual([
      { kind: "name", value: "src" },
      { kind: "index", value: 0 },
    ]);
  });

  it("should return null at root", () => {
    const uri = nodeUri(VALID_HASH);
    expect(parentUri(uri)).toBeNull();
  });
});

describe("rootUri", () => {
  it("should return root", () => {
    const uri = nodeUri(VALID_HASH, ["deep", "nested", "path"], [0, 1]);
    const root = rootUri(uri);
    expect(root.root).toEqual({ type: "nod", hash: VALID_HASH });
    expect(root.segments).toEqual([]);
  });
});

describe("basename", () => {
  it("should return last name segment", () => {
    const uri = nodeUri(VALID_HASH, ["docs", "readme.md"]);
    expect(basename(uri)).toBe("readme.md");
  });

  it("should return ~N for last index segment", () => {
    const uri = nodeUri(VALID_HASH, ["src"], [3]);
    expect(basename(uri)).toBe("~3");
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
    expect(result.segments).toEqual([
      { kind: "name", value: "docs" },
      { kind: "name", value: "readme.md" },
    ]);
  });

  it("should handle ./ prefix", () => {
    const base = nodeUri(VALID_HASH, ["docs"]);
    const result = resolvePath(base, "./readme.md");
    expect(result.segments).toEqual([
      { kind: "name", value: "docs" },
      { kind: "name", value: "readme.md" },
    ]);
  });

  it("should handle ../ (go up)", () => {
    const base = nodeUri(VALID_HASH, ["docs", "api"]);
    const result = resolvePath(base, "../readme.md");
    expect(result.segments).toEqual([
      { kind: "name", value: "docs" },
      { kind: "name", value: "readme.md" },
    ]);
  });

  it("should handle multiple ../", () => {
    const base = nodeUri(VALID_HASH, ["a", "b", "c"]);
    const result = resolvePath(base, "../../d");
    expect(result.segments).toEqual([
      { kind: "name", value: "a" },
      { kind: "name", value: "d" },
    ]);
  });

  it("should not go above root", () => {
    const base = nodeUri(VALID_HASH, ["docs"]);
    const result = resolvePath(base, "../../file.txt");
    expect(result.segments).toEqual([{ kind: "name", value: "file.txt" }]);
  });
});

// ============================================================================
// Extraction Helper Tests
// ============================================================================

describe("getNamePath", () => {
  it("should extract only name segments", () => {
    const uri = nodeUri(VALID_HASH, ["src", "utils"], [0, 1]);
    expect(getNamePath(uri)).toEqual(["src", "utils"]);
  });

  it("should return empty for index-only URI", () => {
    const uri = nodeUri(VALID_HASH, [], [0, 1]);
    expect(getNamePath(uri)).toEqual([]);
  });
});

describe("getIndexPath", () => {
  it("should extract only index segments", () => {
    const uri = nodeUri(VALID_HASH, ["src", "utils"], [0, 1]);
    expect(getIndexPath(uri)).toEqual([0, 1]);
  });

  it("should return empty for name-only URI", () => {
    const uri = nodeUri(VALID_HASH, ["src", "utils"]);
    expect(getIndexPath(uri)).toEqual([]);
  });
});

// ============================================================================
// Comparison Tests
// ============================================================================

describe("uriEquals", () => {
  it("should return true for equal URIs", () => {
    const a = nodeUri(VALID_HASH, ["docs"], [0]);
    const b = nodeUri(VALID_HASH, ["docs"], [0]);
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

  it("should return false for different segment kinds", () => {
    const a = createCasUri({ type: "nod", hash: VALID_HASH }, [nameSegment("0")]);
    const b = createCasUri({ type: "nod", hash: VALID_HASH }, [indexSegment(0)]);
    expect(uriEquals(a, b)).toBe(false);
  });

  it("should return false for different index values", () => {
    const a = nodeUri(VALID_HASH, [], [0]);
    const b = nodeUri(VALID_HASH, [], [1]);
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

  it("should handle mixed segment ancestry", () => {
    const ancestor = createCasUri({ type: "nod", hash: VALID_HASH }, [
      nameSegment("src"),
      indexSegment(0),
    ]);
    const descendant = createCasUri({ type: "nod", hash: VALID_HASH }, [
      nameSegment("src"),
      indexSegment(0),
      nameSegment("utils"),
    ]);
    expect(isAncestorOf(ancestor, descendant)).toBe(true);
  });
});
