/**
 * Pull Remote Tree — test suite
 */

import { describe, expect, test } from "bun:test";
import {
  computeSizeFlagByte,
  decodeNode,
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
import { pullRemoteTree } from "../src/pull.ts";

// ---------------------------------------------------------------------------
// Test helpers
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
    del: async (key: string) => {
      store.delete(key);
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
): Promise<{ key: string; hash: Uint8Array }> {
  const encoded = await encodeDictNode({ children, childNames }, keyProvider);
  const key = hashToKey(encoded.hash);
  await storage.put(key, encoded.bytes);
  return { key, hash: encoded.hash };
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

/**
 * Create a fetchNode function that reads from "remote" storage
 * by navigating from the remote root using index path.
 * Simulates client.nodes.getNavigated(remoteRootKey, navPath).
 */
function createRemoteFetcher(remoteStorage: MemoryStorage, remoteRootKey: string) {
  return async (navPath: string): Promise<Uint8Array | null> => {
    const rootData = await remoteStorage.get(remoteRootKey);
    if (!rootData) return null;

    if (navPath === "") {
      // Return root node itself
      return rootData;
    }

    // Parse nav path like "~0/~1/~2" → [0, 1, 2]
    const indices = navPath.split("/").map((seg) => {
      const idx = parseInt(seg.replace("~", ""), 10);
      return idx;
    });

    // Walk the DAG following child indices
    let currentData = rootData;
    for (const idx of indices) {
      const node = decodeNode(currentData);
      if (node.kind !== "dict" || !node.children || idx >= node.children.length) {
        return null;
      }
      const childHash = node.children[idx]!;
      const childKey = hashToKey(childHash);
      const childData = await remoteStorage.get(childKey);
      if (!childData) return null;
      currentData = childData;
    }

    return currentData;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pullRemoteTree", () => {
  test("identical roots → no fetch", async () => {
    const storage = createMemoryStorage();
    const file = await storeFile(storage, "hello");
    const root = await storeDict(storage, ["a.txt"], [file.hash]);

    const result = await pullRemoteTree(root.key, root.key, {
      storage,
      fetchNode: async () => {
        throw new Error("should not be called");
      },
    });

    expect(result.nodesFetched).toBe(0);
    expect(result.nodesSkipped).toBe(0);
  });

  test("pulls remote root and children not in local storage", async () => {
    // Base tree with file A
    const local = createMemoryStorage();
    const fileA = await storeFile(local, "content-A");
    const base = await storeDict(local, ["a.txt"], [fileA.hash]);

    // Remote tree with file A (same) + file B (new)
    const remote = createMemoryStorage();
    const remoteFileA = await storeFile(remote, "content-A");
    const remoteFileB = await storeFile(remote, "content-B");
    const remoteRoot = await storeDict(
      remote,
      ["a.txt", "b.txt"],
      [remoteFileA.hash, remoteFileB.hash]
    );

    const fetchNode = createRemoteFetcher(remote, remoteRoot.key);

    const result = await pullRemoteTree(base.key, remoteRoot.key, {
      storage: local,
      fetchNode,
    });

    // Should have fetched: remote root + file B (file A was already local via hash match)
    expect(result.nodesFetched).toBeGreaterThanOrEqual(1); // at least root
    // file B should now be in local storage
    const storedB = await local.get(remoteFileB.key);
    expect(storedB).not.toBeNull();
    // remote root should be in local storage
    const storedRoot = await local.get(remoteRoot.key);
    expect(storedRoot).not.toBeNull();
  });

  test("hash short-circuit: skips subtrees with matching hashes", async () => {
    const local = createMemoryStorage();
    // Base tree: /dir/file1, /dir/file2
    const file1 = await storeFile(local, "content-1");
    const file2 = await storeFile(local, "content-2");
    const dir = await storeDict(local, ["file1", "file2"], [file1.hash, file2.hash]);
    const base = await storeDict(local, ["dir"], [dir.hash]);

    // Remote tree: /dir/file1, /dir/file2 (same dir!), /new.txt (new)
    const remote = createMemoryStorage();
    const rFile1 = await storeFile(remote, "content-1");
    const rFile2 = await storeFile(remote, "content-2");
    const rDir = await storeDict(remote, ["file1", "file2"], [rFile1.hash, rFile2.hash]);
    const rNew = await storeFile(remote, "new-content");
    const remoteRoot = await storeDict(remote, ["dir", "new.txt"], [rDir.hash, rNew.hash]);

    let _fetchCount = 0;
    const fetchNode = async (navPath: string) => {
      _fetchCount++;
      return createRemoteFetcher(remote, remoteRoot.key)(navPath);
    };

    const result = await pullRemoteTree(base.key, remoteRoot.key, {
      storage: local,
      fetchNode,
    });

    // dir subtree should be skipped (same hash), only root + new.txt fetched
    expect(result.nodesFetched).toBe(2); // remote root + new.txt
    expect(result.nodesSkipped).toBeGreaterThanOrEqual(1); // dir subtree skipped
  });

  test("pulls nested directory changes", async () => {
    const local = createMemoryStorage();
    // Base: /a/b/c.txt
    const fileC = await storeFile(local, "content-c");
    const dirB = await storeDict(local, ["c.txt"], [fileC.hash]);
    const dirA = await storeDict(local, ["b"], [dirB.hash]);
    const base = await storeDict(local, ["a"], [dirA.hash]);

    // Remote: /a/b/c.txt (changed) + /a/b/d.txt (new)
    const remote = createMemoryStorage();
    const rFileC = await storeFile(remote, "content-c-modified");
    const rFileD = await storeFile(remote, "content-d");
    const rDirB = await storeDict(remote, ["c.txt", "d.txt"], [rFileC.hash, rFileD.hash]);
    const rDirA = await storeDict(remote, ["b"], [rDirB.hash]);
    const remoteRoot = await storeDict(remote, ["a"], [rDirA.hash]);

    const fetchNode = createRemoteFetcher(remote, remoteRoot.key);

    const result = await pullRemoteTree(base.key, remoteRoot.key, {
      storage: local,
      fetchNode,
    });

    // Should fetch: root, dirA, dirB, fileC-modified, fileD
    expect(result.nodesFetched).toBeGreaterThanOrEqual(4);

    // Verify all remote nodes are now local
    expect(await local.get(remoteRoot.key)).not.toBeNull();
    expect(await local.get(rDirA.key)).not.toBeNull();
    expect(await local.get(rDirB.key)).not.toBeNull();
    expect(await local.get(rFileC.key)).not.toBeNull();
    expect(await local.get(rFileD.key)).not.toBeNull();
  });

  test("handles well-known nodes (empty dict)", async () => {
    const local = createMemoryStorage();
    const remote = createMemoryStorage();

    // Base: empty dict (well-known)
    const baseKey = EMPTY_DICT_KEY;

    // Remote: empty dict + file
    const rFile = await storeFile(remote, "hello");
    const remoteRoot = await storeDict(remote, ["hello.txt"], [rFile.hash]);

    const fetchNode = createRemoteFetcher(remote, remoteRoot.key);

    const result = await pullRemoteTree(baseKey, remoteRoot.key, {
      storage: local,
      fetchNode,
    });

    // Should have fetched remote root + file
    expect(result.nodesFetched).toBeGreaterThanOrEqual(1);
    expect(await local.get(remoteRoot.key)).not.toBeNull();
  });

  test("remote nodes already in local storage are not re-fetched", async () => {
    const local = createMemoryStorage();
    const remote = createMemoryStorage();

    // Build remote tree
    const rFile = await storeFile(remote, "hello");
    const remoteRoot = await storeDict(remote, ["hello.txt"], [rFile.hash]);

    // Pre-populate local with all remote nodes
    for (const [k, v] of remote.data) {
      await local.put(k, v);
    }

    // Base: empty dict (different from remote)
    const baseKey = EMPTY_DICT_KEY;

    let fetchCalls = 0;
    const fetchNode = async (navPath: string) => {
      fetchCalls++;
      return createRemoteFetcher(remote, remoteRoot.key)(navPath);
    };

    const result = await pullRemoteTree(baseKey, remoteRoot.key, {
      storage: local,
      fetchNode,
    });

    // All nodes already local → 0 fetches from remote
    expect(fetchCalls).toBe(0);
    expect(result.nodesFetched).toBe(0);
    expect(result.nodesSkipped).toBeGreaterThanOrEqual(1);
  });

  test("handles files gracefully (no recursion into f-nodes)", async () => {
    const local = createMemoryStorage();
    const remote = createMemoryStorage();

    // Base: single file at root (unusual, but valid)
    const baseFile = await storeFile(local, "base");
    const remoteFile = await storeFile(remote, "remote-content");

    const fetchNode = createRemoteFetcher(remote, remoteFile.key);

    const result = await pullRemoteTree(baseFile.key, remoteFile.key, {
      storage: local,
      fetchNode,
    });

    // Should fetch the remote file (it's different, and it's a leaf)
    expect(result.nodesFetched).toBe(1);
    expect(await local.get(remoteFile.key)).not.toBeNull();
  });
});
