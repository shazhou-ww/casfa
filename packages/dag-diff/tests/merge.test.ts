/**
 * DAG 3-Way Merge — test suite
 */

import { describe, expect, test } from "bun:test";
import {
  computeSizeFlagByte,
  EMPTY_DICT_KEY,
  encodeDictNode,
  encodeFileNode,
  getWellKnownNodeData,
  hashToKey,
  isWellKnownNode,
  type KeyProvider,
  type StorageProvider,
} from "@casfa/core";
import { blake3 } from "@noble/hashes/blake3";
import type { MergeOp, MergeResult } from "../src/index.ts";
import { dagMerge } from "../src/index.ts";

// ---------------------------------------------------------------------------
// Test helpers (same as dag-diff.test.ts)
// ---------------------------------------------------------------------------

const createKeyProvider = (): KeyProvider => ({
  computeKey: async (data: Uint8Array) => {
    const raw = blake3(data, { dkLen: 16 });
    raw[0] = computeSizeFlagByte(data.length);
    return raw;
  },
});

type MemoryStorage = StorageProvider & {
  size: () => number;
  data: Map<string, Uint8Array>;
};

const createMemoryStorage = (): MemoryStorage => {
  const store = new Map<string, Uint8Array>();
  return {
    put: async (key: string, data: Uint8Array) => {
      store.set(key, new Uint8Array(data));
    },
    get: async (key: string) => {
      if (isWellKnownNode(key)) {
        return getWellKnownNodeData(key) ?? store.get(key) ?? null;
      }
      return store.get(key) ?? null;
    },
    size: () => store.size,
    data: store,
  };
};

const keyProvider = createKeyProvider();

async function storeDict(
  storage: MemoryStorage,
  childNames: string[],
  children: Uint8Array[]
): Promise<string> {
  const encoded = await encodeDictNode({ children, childNames }, keyProvider);
  const key = hashToKey(encoded.hash);
  await storage.put(key, encoded.bytes);
  return key;
}

async function storeFile(
  storage: MemoryStorage,
  content: string,
  contentType = "text/plain"
): Promise<{ key: string; hash: Uint8Array }> {
  const data = new TextEncoder().encode(content);
  const encoded = await encodeFileNode({ data, contentType, fileSize: data.length }, keyProvider);
  const key = hashToKey(encoded.hash);
  await storage.put(key, encoded.bytes);
  return { key, hash: encoded.hash };
}

/** Find a merge op by path */
function findOp(result: MergeResult, path: string): MergeOp | undefined {
  return result.operations.find((op) => op.path === path);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dagMerge", () => {
  // -----------------------------------------------------------------------
  // Fast paths
  // -----------------------------------------------------------------------

  test("all three roots identical → empty merge", async () => {
    const storage = createMemoryStorage();
    const result = await dagMerge(EMPTY_DICT_KEY, EMPTY_DICT_KEY, EMPTY_DICT_KEY, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200,
    });
    expect(result.operations).toEqual([]);
    expect(result.resolutions).toEqual([]);
  });

  test("only ours changed → ours diff becomes operations", async () => {
    const storage = createMemoryStorage();
    const { hash: fHash } = await storeFile(storage, "new-file");

    const base = EMPTY_DICT_KEY;
    const ours = await storeDict(storage, ["a.txt"], [fHash]);
    const theirs = EMPTY_DICT_KEY;

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 50,
    });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ type: "add", path: "a.txt" });
    expect(result.resolutions).toEqual([]);
  });

  test("only theirs changed → theirs diff becomes operations", async () => {
    const storage = createMemoryStorage();
    const { hash: fHash } = await storeFile(storage, "new-file");

    const base = EMPTY_DICT_KEY;
    const ours = EMPTY_DICT_KEY;
    const theirs = await storeDict(storage, ["b.txt"], [fHash]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 50,
      theirsTimestamp: 100,
    });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ type: "add", path: "b.txt" });
    expect(result.resolutions).toEqual([]);
  });

  test("ours and theirs converged to same state → no conflict", async () => {
    const storage = createMemoryStorage();
    const { hash: fHash } = await storeFile(storage, "same");

    const base = EMPTY_DICT_KEY;
    const converged = await storeDict(storage, ["x.txt"], [fHash]);

    const result = await dagMerge(base, converged, converged, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 100,
    });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ type: "add", path: "x.txt" });
    expect(result.resolutions).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Non-conflicting merges
  // -----------------------------------------------------------------------

  test("ours adds file A, theirs adds file B → both added", async () => {
    const storage = createMemoryStorage();
    const { hash: hA } = await storeFile(storage, "fileA");
    const { hash: hB } = await storeFile(storage, "fileB");
    const { hash: hBase } = await storeFile(storage, "base");

    const base = await storeDict(storage, ["base.txt"], [hBase]);
    const ours = await storeDict(storage, ["a.txt", "base.txt"], [hA, hBase]);
    const theirs = await storeDict(storage, ["b.txt", "base.txt"], [hB, hBase]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200,
    });

    expect(result.operations).toHaveLength(2);
    expect(findOp(result, "a.txt")).toMatchObject({ type: "add" });
    expect(findOp(result, "b.txt")).toMatchObject({ type: "add" });
    expect(result.resolutions).toEqual([]);
  });

  test("ours removes A, theirs modifies B → both applied", async () => {
    const storage = createMemoryStorage();
    const { hash: hA } = await storeFile(storage, "fileA");
    const { hash: hB1 } = await storeFile(storage, "fileB-v1");
    const { hash: hB2 } = await storeFile(storage, "fileB-v2");

    const base = await storeDict(storage, ["a.txt", "b.txt"], [hA, hB1]);
    const ours = await storeDict(storage, ["b.txt"], [hB1]);
    const theirs = await storeDict(storage, ["a.txt", "b.txt"], [hA, hB2]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200,
    });

    expect(result.operations).toHaveLength(2);
    expect(findOp(result, "a.txt")).toMatchObject({ type: "remove" });
    expect(findOp(result, "b.txt")).toMatchObject({ type: "update" });
    expect(result.resolutions).toEqual([]);
  });

  test("both removed same file → single remove, no conflict", async () => {
    const storage = createMemoryStorage();
    const { hash: hA } = await storeFile(storage, "fileA");
    const { hash: hKeep } = await storeFile(storage, "keep");

    const base = await storeDict(storage, ["a.txt", "keep.txt"], [hA, hKeep]);
    const ours = await storeDict(storage, ["keep.txt"], [hKeep]);
    const theirs = await storeDict(storage, ["keep.txt"], [hKeep]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200,
    });

    expect(result.operations).toHaveLength(1);
    expect(findOp(result, "a.txt")).toMatchObject({ type: "remove" });
    expect(result.resolutions).toEqual([]);
  });

  test("both modified same file to same key → no conflict", async () => {
    const storage = createMemoryStorage();
    const { hash: hOld } = await storeFile(storage, "old-content");
    const { hash: hNew } = await storeFile(storage, "new-content");

    const base = await storeDict(storage, ["f.txt"], [hOld]);
    const ours = await storeDict(storage, ["f.txt"], [hNew]);
    const theirs = await storeDict(storage, ["f.txt"], [hNew]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200,
    });

    expect(result.operations).toHaveLength(1);
    expect(findOp(result, "f.txt")).toMatchObject({ type: "update" });
    expect(result.resolutions).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // LWW conflict resolution: both-added
  // -----------------------------------------------------------------------

  test("both added same path, different keys → LWW (theirs newer)", async () => {
    const storage = createMemoryStorage();
    const { hash: hOurs } = await storeFile(storage, "ours-version");
    const { key: kTheirs, hash: hTheirs } = await storeFile(storage, "theirs-version");

    const base = EMPTY_DICT_KEY;
    const ours = await storeDict(storage, ["new.txt"], [hOurs]);
    const theirs = await storeDict(storage, ["new.txt"], [hTheirs]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200, // theirs is newer
    });

    expect(result.operations).toHaveLength(1);
    expect(findOp(result, "new.txt")).toMatchObject({
      type: "add",
      nodeKey: kTheirs,
    });
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0]).toMatchObject({
      path: "new.txt",
      winner: "theirs",
      conflict: "both-added",
    });
  });

  test("both added same path, different keys → LWW (ours newer)", async () => {
    const storage = createMemoryStorage();
    const { key: kOurs, hash: hOurs } = await storeFile(storage, "ours-version");
    const { hash: hTheirs } = await storeFile(storage, "theirs-version");

    const base = EMPTY_DICT_KEY;
    const ours = await storeDict(storage, ["new.txt"], [hOurs]);
    const theirs = await storeDict(storage, ["new.txt"], [hTheirs]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 300,
      theirsTimestamp: 200, // ours is newer
    });

    expect(result.operations).toHaveLength(1);
    expect(findOp(result, "new.txt")).toMatchObject({
      type: "add",
      nodeKey: kOurs,
    });
    expect(result.resolutions[0]).toMatchObject({
      winner: "ours",
      conflict: "both-added",
    });
  });

  // -----------------------------------------------------------------------
  // LWW conflict resolution: both-modified
  // -----------------------------------------------------------------------

  test("both modified same file to different keys → LWW", async () => {
    const storage = createMemoryStorage();
    const { hash: hBase } = await storeFile(storage, "base-content");
    const { hash: hOurs } = await storeFile(storage, "ours-edit");
    const { key: kTheirs, hash: hTheirs } = await storeFile(storage, "theirs-edit");

    const base = await storeDict(storage, ["f.txt"], [hBase]);
    const ours = await storeDict(storage, ["f.txt"], [hOurs]);
    const theirs = await storeDict(storage, ["f.txt"], [hTheirs]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200,
    });

    expect(result.operations).toHaveLength(1);
    expect(findOp(result, "f.txt")).toMatchObject({
      type: "update",
      nodeKey: kTheirs,
    });
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0]).toMatchObject({
      path: "f.txt",
      winner: "theirs",
      conflict: "both-modified",
    });
  });

  // -----------------------------------------------------------------------
  // LWW conflict resolution: modify vs remove
  // -----------------------------------------------------------------------

  test("ours modified, theirs removed → LWW (theirs newer → remove)", async () => {
    const storage = createMemoryStorage();
    const { hash: hBase } = await storeFile(storage, "base-content");
    const { hash: hOurs } = await storeFile(storage, "ours-edit");

    const base = await storeDict(storage, ["f.txt"], [hBase]);
    const ours = await storeDict(storage, ["f.txt"], [hOurs]);
    const theirs = EMPTY_DICT_KEY; // removed everything

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200, // theirs is newer → removal wins
    });

    expect(findOp(result, "f.txt")).toMatchObject({ type: "remove" });
    expect(result.resolutions[0]).toMatchObject({
      path: "f.txt",
      winner: "theirs",
      conflict: "modify-remove",
    });
  });

  test("ours modified, theirs removed → LWW (ours newer → keep modification)", async () => {
    const storage = createMemoryStorage();
    const { hash: hBase } = await storeFile(storage, "base-content");
    const { key: kOurs, hash: hOurs } = await storeFile(storage, "ours-edit");

    const base = await storeDict(storage, ["f.txt"], [hBase]);
    const ours = await storeDict(storage, ["f.txt"], [hOurs]);
    const theirs = EMPTY_DICT_KEY;

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 300,
      theirsTimestamp: 200, // ours is newer → modification wins
    });

    expect(findOp(result, "f.txt")).toMatchObject({
      type: "update",
      nodeKey: kOurs,
    });
    expect(result.resolutions[0]).toMatchObject({
      winner: "ours",
      conflict: "modify-remove",
    });
  });

  test("theirs modified, ours removed → LWW (theirs newer → keep modification)", async () => {
    const storage = createMemoryStorage();
    const { hash: hBase } = await storeFile(storage, "base-content");
    const { key: kTheirs, hash: hTheirs } = await storeFile(storage, "theirs-edit");

    const base = await storeDict(storage, ["f.txt"], [hBase]);
    const ours = EMPTY_DICT_KEY;
    const theirs = await storeDict(storage, ["f.txt"], [hTheirs]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200, // theirs is newer → modification wins
    });

    expect(findOp(result, "f.txt")).toMatchObject({
      type: "update",
      nodeKey: kTheirs,
    });
    expect(result.resolutions[0]).toMatchObject({
      winner: "theirs",
      conflict: "modify-remove",
    });
  });

  // -----------------------------------------------------------------------
  // Tiebreaker: ours wins when timestamps are equal
  // -----------------------------------------------------------------------

  test("equal timestamps → ours wins", async () => {
    const storage = createMemoryStorage();
    const { hash: hBase } = await storeFile(storage, "base");
    const { key: kOurs, hash: hOurs } = await storeFile(storage, "ours");
    const { hash: hTheirs } = await storeFile(storage, "theirs");

    const base = await storeDict(storage, ["f.txt"], [hBase]);
    const ours = await storeDict(storage, ["f.txt"], [hOurs]);
    const theirs = await storeDict(storage, ["f.txt"], [hTheirs]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 100, // equal → ours wins
    });

    expect(findOp(result, "f.txt")).toMatchObject({
      type: "update",
      nodeKey: kOurs,
    });
    expect(result.resolutions[0]).toMatchObject({
      winner: "ours",
    });
  });

  // -----------------------------------------------------------------------
  // Nested directories
  // -----------------------------------------------------------------------

  test("nested merge: ours changes src/a.ts, theirs adds src/b.ts", async () => {
    const storage = createMemoryStorage();
    const { hash: hA1 } = await storeFile(storage, "a-v1");
    const { hash: hA2 } = await storeFile(storage, "a-v2");
    const { hash: hB } = await storeFile(storage, "b-new");

    // base: src/a.ts
    const baseSrcHash = (
      await encodeDictNode({ children: [hA1], childNames: ["a.ts"] }, keyProvider)
    ).hash;
    const _baseSrc = await storeDict(storage, ["a.ts"], [hA1]);
    const base = await storeDict(storage, ["src"], [baseSrcHash]);

    // ours: src/a.ts(v2)
    const oursSrcHash = (
      await encodeDictNode({ children: [hA2], childNames: ["a.ts"] }, keyProvider)
    ).hash;
    const _oursSrc = await storeDict(storage, ["a.ts"], [hA2]);
    const ours = await storeDict(storage, ["src"], [oursSrcHash]);

    // theirs: src/a.ts(v1), src/b.ts(new)
    const theirsSrcHash = (
      await encodeDictNode({ children: [hA1, hB], childNames: ["a.ts", "b.ts"] }, keyProvider)
    ).hash;
    const _theirsSrc = await storeDict(storage, ["a.ts", "b.ts"], [hA1, hB]);
    const theirs = await storeDict(storage, ["src"], [theirsSrcHash]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200,
    });

    // No conflicts: ours modified src/a.ts, theirs added src/b.ts
    expect(result.operations).toHaveLength(2);
    expect(findOp(result, "src/a.ts")).toMatchObject({ type: "update" });
    expect(findOp(result, "src/b.ts")).toMatchObject({ type: "add" });
    expect(result.resolutions).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Complex scenario
  // -----------------------------------------------------------------------

  test("complex merge: multiple paths, mixed operations and conflicts", async () => {
    const storage = createMemoryStorage();
    const { hash: hKeep } = await storeFile(storage, "unchanged");
    const { hash: hA } = await storeFile(storage, "fileA");
    const { hash: hB } = await storeFile(storage, "fileB");
    const { hash: hC1 } = await storeFile(storage, "fileC-v1");
    const { hash: hC2 } = await storeFile(storage, "fileC-ours");
    const { hash: hC3 } = await storeFile(storage, "fileC-theirs");
    const { hash: hD } = await storeFile(storage, "fileD");
    const { hash: hE } = await storeFile(storage, "fileE-ours");
    const { hash: hF } = await storeFile(storage, "fileF-theirs");

    // base: keep.txt, c.txt(v1), d.txt
    const base = await storeDict(storage, ["c.txt", "d.txt", "keep.txt"], [hC1, hD, hKeep]);

    // ours: keep.txt, a.txt(added), c.txt(ours-edit), e.txt(added)
    // (d.txt removed by ours)
    const ours = await storeDict(
      storage,
      ["a.txt", "c.txt", "e.txt", "keep.txt"],
      [hA, hC2, hE, hKeep]
    );

    // theirs: keep.txt, b.txt(added), c.txt(theirs-edit), d.txt(unchanged), f.txt(added)
    const theirs = await storeDict(
      storage,
      ["b.txt", "c.txt", "d.txt", "f.txt", "keep.txt"],
      [hB, hC3, hD, hF, hKeep]
    );

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200, // theirs wins LWW
    });

    // Non-conflicting:
    // - a.txt: only ours added → add
    // - b.txt: only theirs added → add
    // - d.txt: ours removed, theirs unchanged → remove
    // - e.txt: only ours added → add
    // - f.txt: only theirs added → add
    // - keep.txt: unchanged in both → not in operations
    //
    // Conflicting:
    // - c.txt: both modified to different keys → LWW (theirs wins)

    expect(findOp(result, "a.txt")).toMatchObject({ type: "add" });
    expect(findOp(result, "b.txt")).toMatchObject({ type: "add" });
    expect(findOp(result, "d.txt")).toMatchObject({ type: "remove" });
    expect(findOp(result, "e.txt")).toMatchObject({ type: "add" });
    expect(findOp(result, "f.txt")).toMatchObject({ type: "add" });
    expect(findOp(result, "keep.txt")).toBeUndefined();

    const cOp = findOp(result, "c.txt");
    expect(cOp).toMatchObject({ type: "update" });
    if (cOp?.type === "update") {
      expect(cOp.nodeKey).toBe(hashToKey(hC3)); // theirs wins
    }

    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0]).toMatchObject({
      path: "c.txt",
      winner: "theirs",
      conflict: "both-modified",
    });
  });

  // -----------------------------------------------------------------------
  // Resolution info completeness
  // -----------------------------------------------------------------------

  test("LWW resolution includes both nodeKeys", async () => {
    const storage = createMemoryStorage();
    const { key: kOurs, hash: hOurs } = await storeFile(storage, "ours");
    const { key: kTheirs, hash: hTheirs } = await storeFile(storage, "theirs");

    const base = EMPTY_DICT_KEY;
    const ours = await storeDict(storage, ["x.txt"], [hOurs]);
    const theirs = await storeDict(storage, ["x.txt"], [hTheirs]);

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 100,
      theirsTimestamp: 200,
    });

    expect(result.resolutions[0]).toMatchObject({
      oursNodeKey: kOurs,
      theirsNodeKey: kTheirs,
    });
  });

  test("modify-remove resolution: removed side has null nodeKey", async () => {
    const storage = createMemoryStorage();
    const { hash: hBase } = await storeFile(storage, "base");
    const { key: kOurs, hash: hOurs } = await storeFile(storage, "ours-edit");

    const base = await storeDict(storage, ["f.txt"], [hBase]);
    const ours = await storeDict(storage, ["f.txt"], [hOurs]);
    const theirs = EMPTY_DICT_KEY;

    const result = await dagMerge(base, ours, theirs, {
      storage,
      oursTimestamp: 300,
      theirsTimestamp: 200,
    });

    expect(result.resolutions[0]).toMatchObject({
      oursNodeKey: kOurs,
      theirsNodeKey: null, // theirs removed it
    });
  });
});
