/**
 * @casfa/proof — comprehensive unit tests.
 *
 * Coverage:
 * - parseProofHeader: valid JSON, malformed JSON, empty, missing
 * - parseProofWord: ipath, depot-version, invalid formats
 * - parseIndexPath: valid, malformed, edge cases
 * - verifyNodeAccess: ownership shortcut, root delegate shortcut,
 *   ipath navigation, depot-version proof, missing proof → 403,
 *   path mismatch → 403, child OOB, node not found
 * - verifyMultiNodeAccess: all pass, partial fail
 * - formatProofHeader / formatProofWord: round-trip
 * - ipath / depot builder helpers
 */

import { describe, expect, it } from "bun:test";
import {
  depot,
  formatDepotProofWord,
  formatIPathProofWord,
  formatProofHeader,
  formatProofWord,
  ipath,
  parseIndexPath,
  parseProofHeader,
  parseProofWord,
  verifyMultiNodeAccess,
  verifyNodeAccess,
} from "./index.ts";
import type { ProofMap, ProofVerificationContext, ProofWord, ResolvedNode } from "./types.ts";

// ============================================================================
// Helpers — mock CAS DAG
// ============================================================================

/**
 * Build a simple DAG for testing.
 *
 * ```
 * Scope Root (hash=root_aaa)
 *   ├── [0] child (hash=bbb)
 *   │     ├── [0] child (hash=ddd)
 *   │     └── [1] child (hash=eee)
 *   └── [1] child (hash=ccc)
 *         └── [0] child (hash=fff)
 * ```
 */
function buildTestDag(): Map<string, ResolvedNode> {
  const dag = new Map<string, ResolvedNode>();
  dag.set("root_aaa", { children: ["bbb", "ccc"] });
  dag.set("bbb", { children: ["ddd", "eee"] });
  dag.set("ccc", { children: ["fff"] });
  dag.set("ddd", { children: [] });
  dag.set("eee", { children: [] });
  dag.set("fff", { children: [] });
  return dag;
}

/** Depot version roots */
const depotVersions: Record<string, Record<string, string>> = {
  depot_1: { v1: "root_aaa", v2: "bbb" },
};

/** Ownership set: `nodeHash:delegateId` */
const ownershipSet = new Set<string>();

/** Root delegate set */
const rootDelegateSet = new Set<string>();

/** Delegate scope roots */
const delegateScopeRoots: Record<string, string[]> = {};

/** Depot access: `delegateId:depotId` */
const depotAccessSet = new Set<string>();

function buildCtx(dag?: Map<string, ResolvedNode>): ProofVerificationContext {
  const dagMap = dag ?? buildTestDag();
  return {
    hasOwnership: async (nodeHash, delegateId) => ownershipSet.has(`${nodeHash}:${delegateId}`),
    isRootDelegate: async (id) => rootDelegateSet.has(id),
    getScopeRoots: async (id) => delegateScopeRoots[id] ?? [],
    resolveNode: async (hash) => dagMap.get(hash) ?? null,
    resolveDepotVersion: async (depotId, version) => depotVersions[depotId]?.[version] ?? null,
    hasDepotAccess: async (delegateId, depotId) => depotAccessSet.has(`${delegateId}:${depotId}`),
  };
}

/** Reset all mutable sets between tests */
function resetState() {
  ownershipSet.clear();
  rootDelegateSet.clear();
  for (const k of Object.keys(delegateScopeRoots)) delete delegateScopeRoots[k];
  depotAccessSet.clear();
}

// ============================================================================
// parseIndexPath
// ============================================================================

describe("parseIndexPath", () => {
  it("parses valid path", () => {
    expect(parseIndexPath("0:1:2")).toEqual([0, 1, 2]);
  });

  it("parses single index", () => {
    expect(parseIndexPath("0")).toEqual([0]);
  });

  it("parses large indices", () => {
    expect(parseIndexPath("100:200:0")).toEqual([100, 200, 0]);
  });

  it("returns null for empty string", () => {
    expect(parseIndexPath("")).toBeNull();
  });

  it("returns null for negative index", () => {
    expect(parseIndexPath("0:-1:2")).toBeNull();
  });

  it("returns null for non-integer", () => {
    expect(parseIndexPath("0:1.5:2")).toBeNull();
  });

  it("returns null for non-numeric", () => {
    expect(parseIndexPath("0:abc:2")).toBeNull();
  });
});

// ============================================================================
// parseProofWord
// ============================================================================

describe("parseProofWord", () => {
  it("parses ipath word", () => {
    expect(parseProofWord("ipath#0:1:2")).toEqual({
      type: "ipath",
      scopeIndex: 0,
      path: [1, 2],
    });
  });

  it("parses ipath with scope index only (no path)", () => {
    expect(parseProofWord("ipath#0")).toEqual({
      type: "ipath",
      scopeIndex: 0,
      path: [],
    });
  });

  it("parses ipath with multi-scope index", () => {
    expect(parseProofWord("ipath#2:0:1")).toEqual({
      type: "ipath",
      scopeIndex: 2,
      path: [0, 1],
    });
  });

  it("parses depot-version word", () => {
    expect(parseProofWord("depot:myDepot@v1#0:1:2")).toEqual({
      type: "depot",
      depotId: "myDepot",
      version: "v1",
      path: [0, 1, 2],
    });
  });

  it("parses depot-version with complex IDs", () => {
    expect(parseProofWord("depot:dep-123@2024-01-01T00:00:00Z#0")).toEqual({
      type: "depot",
      depotId: "dep-123",
      version: "2024-01-01T00:00:00Z",
      path: [0],
    });
  });

  it("returns null for empty string", () => {
    expect(parseProofWord("")).toBeNull();
  });

  it("returns null for unknown prefix", () => {
    expect(parseProofWord("unknown#0:1:2")).toBeNull();
  });

  it("returns null for ipath with no indices", () => {
    expect(parseProofWord("ipath#")).toBeNull();
  });

  it("returns null for depot with no @ separator", () => {
    expect(parseProofWord("depot:noversion#0")).toBeNull();
  });

  it("returns null for depot with no # separator", () => {
    expect(parseProofWord("depot:id@v1")).toBeNull();
  });

  it("returns null for depot with empty depotId", () => {
    expect(parseProofWord("depot:@v1#0")).toBeNull();
  });

  it("returns null for depot with empty version", () => {
    expect(parseProofWord("depot:id@#0")).toBeNull();
  });
});

// ============================================================================
// parseProofHeader
// ============================================================================

describe("parseProofHeader", () => {
  it("parses valid JSON with ipath entries", () => {
    const header = '{"abc123":"ipath#0:1:2","def456":"ipath#0:3"}';
    const map = parseProofHeader(header);
    expect(map).not.toBeNull();
    expect(map!.size).toBe(2);
    expect(map!.get("abc123")).toEqual({
      type: "ipath",
      scopeIndex: 0,
      path: [1, 2],
    });
    expect(map!.get("def456")).toEqual({
      type: "ipath",
      scopeIndex: 0,
      path: [3],
    });
  });

  it("parses valid JSON with depot entries", () => {
    const header = '{"abc":"depot:d1@v1#0:1"}';
    const map = parseProofHeader(header);
    expect(map).not.toBeNull();
    expect(map!.size).toBe(1);
    expect(map!.get("abc")).toEqual({
      type: "depot",
      depotId: "d1",
      version: "v1",
      path: [0, 1],
    });
  });

  it("returns empty map for undefined", () => {
    const map = parseProofHeader(undefined);
    expect(map).not.toBeNull();
    expect(map!.size).toBe(0);
  });

  it("returns empty map for empty string", () => {
    const map = parseProofHeader("");
    expect(map).not.toBeNull();
    expect(map!.size).toBe(0);
  });

  it("returns null for invalid JSON", () => {
    expect(parseProofHeader("not-json")).toBeNull();
  });

  it("returns null for JSON array", () => {
    expect(parseProofHeader("[1,2,3]")).toBeNull();
  });

  it("returns null for non-string values", () => {
    expect(parseProofHeader('{"abc":123}')).toBeNull();
  });

  it("returns null for malformed proof word in value", () => {
    expect(parseProofHeader('{"abc":"bad#format"}')).toBeNull();
  });

  it("parses mixed ipath and depot entries", () => {
    const header = '{"a":"ipath#0:1","b":"depot:d@v#0"}';
    const map = parseProofHeader(header);
    expect(map).not.toBeNull();
    expect(map!.size).toBe(2);
    expect(map!.get("a")!.type).toBe("ipath");
    expect(map!.get("b")!.type).toBe("depot");
  });
});

// ============================================================================
// verifyNodeAccess — ownership shortcut
// ============================================================================

describe("verifyNodeAccess — ownership shortcut", () => {
  it("passes when delegate owns the node", async () => {
    resetState();
    ownershipSet.add("eee:dlg_child");
    delegateScopeRoots.dlg_child = ["root_aaa"];

    const proofMap: ProofMap = new Map();
    const result = await verifyNodeAccess("eee", "dlg_child", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("passes without any proof when ownership exists", async () => {
    resetState();
    ownershipSet.add("ddd:dlg_a");

    const proofMap: ProofMap = new Map();
    const result = await verifyNodeAccess("ddd", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// verifyNodeAccess — root delegate shortcut
// ============================================================================

describe("verifyNodeAccess — root delegate shortcut", () => {
  it("passes when delegate is root (no proof needed)", async () => {
    resetState();
    rootDelegateSet.add("dlg_root");

    const proofMap: ProofMap = new Map();
    const result = await verifyNodeAccess("eee", "dlg_root", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("passes for any node when delegate is root", async () => {
    resetState();
    rootDelegateSet.add("dlg_root");

    const proofMap: ProofMap = new Map();
    const result = await verifyNodeAccess("nonexistent_hash", "dlg_root", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// verifyNodeAccess — ipath proof
// ============================================================================

describe("verifyNodeAccess — ipath proof", () => {
  it("verifies valid ipath: root_aaa → [0] bbb → [1] eee", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"];

    const proofMap: ProofMap = new Map([["eee", { type: "ipath", scopeIndex: 0, path: [0, 1] }]]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("verifies ipath to immediate child: root_aaa → [1] ccc", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"];

    const proofMap: ProofMap = new Map([["ccc", { type: "ipath", scopeIndex: 0, path: [1] }]]);
    const result = await verifyNodeAccess("ccc", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("verifies ipath to scope root itself (empty path)", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"];

    const proofMap: ProofMap = new Map([["root_aaa", { type: "ipath", scopeIndex: 0, path: [] }]]);
    const result = await verifyNodeAccess("root_aaa", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("verifies deep path: root_aaa → [1] ccc → [0] fff", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"];

    const proofMap: ProofMap = new Map([["fff", { type: "ipath", scopeIndex: 0, path: [1, 0] }]]);
    const result = await verifyNodeAccess("fff", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("supports multi-scope: second scope root", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa", "bbb"];

    const proofMap: ProofMap = new Map([["eee", { type: "ipath", scopeIndex: 1, path: [1] }]]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("fails with MISSING_PROOF when no proof for node", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"];

    const proofMap: ProofMap = new Map(); // empty
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MISSING_PROOF");
    }
  });

  it("fails with PATH_MISMATCH when proof leads to wrong node", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"];

    // Proof says path [0, 0] leads to node ddd — but we claim it's eee
    const proofMap: ProofMap = new Map([["eee", { type: "ipath", scopeIndex: 0, path: [0, 0] }]]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_MISMATCH");
    }
  });

  it("fails with SCOPE_ROOT_OUT_OF_BOUNDS for invalid scope index", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"]; // only 1 root

    const proofMap: ProofMap = new Map([["eee", { type: "ipath", scopeIndex: 5, path: [0, 1] }]]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SCOPE_ROOT_OUT_OF_BOUNDS");
    }
  });

  it("fails with CHILD_INDEX_OUT_OF_BOUNDS for bad child index", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"];

    const proofMap: ProofMap = new Map([
      ["eee", { type: "ipath", scopeIndex: 0, path: [99] }], // root_aaa has only 2 children
    ]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CHILD_INDEX_OUT_OF_BOUNDS");
    }
  });

  it("fails with NODE_NOT_FOUND when intermediate node missing", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["ghost_node"];

    const proofMap: ProofMap = new Map([["eee", { type: "ipath", scopeIndex: 0, path: [0] }]]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NODE_NOT_FOUND");
    }
  });

  it("fails with PATH_MISMATCH when scope root ≠ target (empty path)", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"];

    const proofMap: ProofMap = new Map([["bbb", { type: "ipath", scopeIndex: 0, path: [] }]]);
    const result = await verifyNodeAccess("bbb", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_MISMATCH");
    }
  });
});

// ============================================================================
// verifyNodeAccess — depot-version proof
// ============================================================================

describe("verifyNodeAccess — depot-version proof", () => {
  it("verifies valid depot proof: depot_1@v1 → root_aaa → [0] bbb → [1] eee", async () => {
    resetState();
    delegateScopeRoots.dlg_a = [];
    depotAccessSet.add("dlg_a:depot_1");

    const proofMap: ProofMap = new Map([
      ["eee", { type: "depot", depotId: "depot_1", version: "v1", path: [0, 1] }],
    ]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("verifies depot proof with version v2 (different root)", async () => {
    resetState();
    depotAccessSet.add("dlg_a:depot_1");

    // v2 root is "bbb" → children [ddd, eee]
    const proofMap: ProofMap = new Map([
      ["ddd", { type: "depot", depotId: "depot_1", version: "v2", path: [0] }],
    ]);
    const result = await verifyNodeAccess("ddd", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("fails with DEPOT_ACCESS_DENIED when delegate has no depot access", async () => {
    resetState();
    // no depotAccessSet entry

    const proofMap: ProofMap = new Map([
      ["eee", { type: "depot", depotId: "depot_1", version: "v1", path: [0, 1] }],
    ]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DEPOT_ACCESS_DENIED");
    }
  });

  it("fails with DEPOT_VERSION_NOT_FOUND for unknown version", async () => {
    resetState();
    depotAccessSet.add("dlg_a:depot_1");

    const proofMap: ProofMap = new Map([
      ["eee", { type: "depot", depotId: "depot_1", version: "v999", path: [0, 1] }],
    ]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DEPOT_VERSION_NOT_FOUND");
    }
  });

  it("fails with DEPOT_VERSION_NOT_FOUND for unknown depot", async () => {
    resetState();
    depotAccessSet.add("dlg_a:unknown_depot");

    const proofMap: ProofMap = new Map([
      ["eee", { type: "depot", depotId: "unknown_depot", version: "v1", path: [0] }],
    ]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DEPOT_VERSION_NOT_FOUND");
    }
  });

  it("fails with PATH_MISMATCH when depot proof walks to wrong node", async () => {
    resetState();
    depotAccessSet.add("dlg_a:depot_1");

    // depot v1 root=root_aaa → [0]=bbb → [0]=ddd, but we claim target is eee
    const proofMap: ProofMap = new Map([
      ["eee", { type: "depot", depotId: "depot_1", version: "v1", path: [0, 0] }],
    ]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_MISMATCH");
    }
  });
});

// ============================================================================
// verifyMultiNodeAccess
// ============================================================================

describe("verifyMultiNodeAccess", () => {
  it("passes when all nodes have valid proofs", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"];

    const proofMap: ProofMap = new Map([
      ["bbb", { type: "ipath", scopeIndex: 0, path: [0] }],
      ["ccc", { type: "ipath", scopeIndex: 0, path: [1] }],
    ]);
    const result = await verifyMultiNodeAccess(["bbb", "ccc"], "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("fails on first node without proof", async () => {
    resetState();
    delegateScopeRoots.dlg_a = ["root_aaa"];

    const proofMap: ProofMap = new Map([
      ["bbb", { type: "ipath", scopeIndex: 0, path: [0] }],
      // no proof for ccc
    ]);
    const result = await verifyMultiNodeAccess(["bbb", "ccc"], "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MISSING_PROOF");
    }
  });

  it("passes for empty node list", async () => {
    resetState();
    const proofMap: ProofMap = new Map();
    const result = await verifyMultiNodeAccess([], "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("mixes ownership + proof: one owned, one proven", async () => {
    resetState();
    ownershipSet.add("bbb:dlg_a");
    delegateScopeRoots.dlg_a = ["root_aaa"];

    const proofMap: ProofMap = new Map([
      // bbb is owned, no proof needed
      ["ccc", { type: "ipath", scopeIndex: 0, path: [1] }],
    ]);
    const result = await verifyMultiNodeAccess(["bbb", "ccc"], "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// Priority: ownership > root > proof
// ============================================================================

describe("verification priority", () => {
  it("ownership takes priority even when proof is wrong", async () => {
    resetState();
    ownershipSet.add("eee:dlg_a");

    // Provide a deliberately wrong proof — but ownership should win
    const proofMap: ProofMap = new Map([
      ["eee", { type: "ipath", scopeIndex: 99, path: [99, 99] }],
    ]);
    const result = await verifyNodeAccess("eee", "dlg_a", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });

  it("root delegate takes priority even when proof is wrong", async () => {
    resetState();
    rootDelegateSet.add("dlg_root");

    const proofMap: ProofMap = new Map([["eee", { type: "ipath", scopeIndex: 99, path: [99] }]]);
    const result = await verifyNodeAccess("eee", "dlg_root", proofMap, buildCtx());
    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// format — ProofWord
// ============================================================================

describe("formatProofWord", () => {
  it("formats ipath", () => {
    expect(formatIPathProofWord({ type: "ipath", scopeIndex: 0, path: [1, 2] })).toBe(
      "ipath#0:1:2"
    );
  });

  it("formats ipath with empty path", () => {
    expect(formatIPathProofWord({ type: "ipath", scopeIndex: 0, path: [] })).toBe("ipath#0");
  });

  it("formats depot", () => {
    expect(
      formatDepotProofWord({ type: "depot", depotId: "d1", version: "v1", path: [0, 1] })
    ).toBe("depot:d1@v1#0:1");
  });

  it("formats via generic formatProofWord — ipath", () => {
    expect(formatProofWord({ type: "ipath", scopeIndex: 2, path: [3] })).toBe("ipath#2:3");
  });

  it("formats via generic formatProofWord — depot", () => {
    expect(formatProofWord({ type: "depot", depotId: "x", version: "y", path: [0] })).toBe(
      "depot:x@y#0"
    );
  });
});

// ============================================================================
// format — Header
// ============================================================================

describe("formatProofHeader", () => {
  it("formats single entry", () => {
    const header = formatProofHeader([["abc", { type: "ipath", scopeIndex: 0, path: [1, 2] }]]);
    expect(JSON.parse(header)).toEqual({ abc: "ipath#0:1:2" });
  });

  it("formats multiple entries", () => {
    const header = formatProofHeader([
      ["abc", { type: "ipath", scopeIndex: 0, path: [1] }],
      ["def", { type: "depot", depotId: "d1", version: "v1", path: [0, 2] }],
    ]);
    const parsed = JSON.parse(header);
    expect(parsed.abc).toBe("ipath#0:1");
    expect(parsed.def).toBe("depot:d1@v1#0:2");
  });

  it("formats empty entries", () => {
    expect(formatProofHeader([])).toBe("{}");
  });
});

// ============================================================================
// format — round-trip: format → parse
// ============================================================================

describe("format → parse round-trip", () => {
  it("round-trips ipath", () => {
    const word: ProofWord = { type: "ipath", scopeIndex: 0, path: [1, 2, 3] };
    const str = formatProofWord(word);
    const parsed = parseProofWord(str);
    expect(parsed).toEqual(word);
  });

  it("round-trips depot", () => {
    const word: ProofWord = { type: "depot", depotId: "my-depot", version: "v3", path: [0, 1] };
    const str = formatProofWord(word);
    const parsed = parseProofWord(str);
    expect(parsed).toEqual(word);
  });

  it("round-trips full header", () => {
    const entries: [string, ProofWord][] = [
      ["hash1", { type: "ipath", scopeIndex: 0, path: [1] }],
      ["hash2", { type: "depot", depotId: "d", version: "v", path: [0] }],
    ];
    const header = formatProofHeader(entries);
    const map = parseProofHeader(header);
    expect(map).not.toBeNull();
    expect(map!.size).toBe(2);
    expect(map!.get("hash1")).toEqual(entries[0]![1]);
    expect(map!.get("hash2")).toEqual(entries[1]![1]);
  });
});

// ============================================================================
// convenience builders
// ============================================================================

describe("ipath / depot builders", () => {
  it("ipath(0, 1, 2) → IPathProofWord", () => {
    expect(ipath(0, 1, 2)).toEqual({
      type: "ipath",
      scopeIndex: 0,
      path: [1, 2],
    });
  });

  it("ipath(0) → scope root only", () => {
    expect(ipath(0)).toEqual({
      type: "ipath",
      scopeIndex: 0,
      path: [],
    });
  });

  it("depot('d1', 'v1', 0, 1) → DepotProofWord", () => {
    expect(depot("d1", "v1", 0, 1)).toEqual({
      type: "depot",
      depotId: "d1",
      version: "v1",
      path: [0, 1],
    });
  });
});
