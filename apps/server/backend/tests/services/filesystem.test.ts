/**
 * Unit tests for Filesystem Service
 *
 * Tests the core filesystem operations on CAS trees using real
 * encoding/decoding from @casfa/core with an in-memory storage backend.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  decodeCB32,
  encodeCB32,
  encodeDictNode,
  encodeFileNode,
  type HashProvider,
} from "@casfa/core";
import { hashToNodeKey, nodeKeyToStorageKey } from "@casfa/protocol";
import type { StorageProvider } from "@casfa/storage-core";
import type { DepotsDb } from "../../src/db/depots.ts";
import type { OwnershipV2Db } from "../../src/db/ownership-v2.ts";
import type { RefCountDb } from "../../src/db/refcount.ts";
import type { ScopeSetNodesDb } from "../../src/db/scope-set-nodes.ts";
import type { UsageDb } from "../../src/db/usage.ts";
import { createFsService, type FsError, type FsServiceDeps } from "../../src/services/fs/index.ts";
import { createNodeHashProvider } from "../../src/util/hash-provider.ts";

// ============================================================================
// Helpers
// ============================================================================

const REALM = "test-realm";
const TOKEN_ID = "test-token";

/** Hash utility */
const hashProvider: HashProvider = createNodeHashProvider();

/** Convert Uint8Array hash → CB32 storage key */
const hashToStorageKey = (hash: Uint8Array): string => encodeCB32(hash);

/** Convert CB32 storage key → Uint8Array */
const storageKeyToHash = (key: string): Uint8Array => decodeCB32(key);

/** Helper to check if result is an FsError */
function isFsError(result: unknown): result is FsError {
  return typeof result === "object" && result !== null && "code" in result && "status" in result;
}

// ============================================================================
// In-Memory Storage
// ============================================================================

function createMemoryStorage(): StorageProvider & { data: Map<string, Uint8Array> } {
  const data = new Map<string, Uint8Array>();
  return {
    data,
    has: async (key: string) => data.has(key),
    get: async (key: string) => data.get(key) ?? null,
    put: async (key: string, value: Uint8Array) => {
      data.set(key, value);
    },
  };
}

// ============================================================================
// Mock DBs
// ============================================================================

function createMockOwnershipDb(): OwnershipV2Db {
  return {
    addOwnership: mock(() => Promise.resolve()),
    hasOwnership: mock(() => Promise.resolve(false)),
    hasAnyOwnership: mock(() => Promise.resolve(false)),
    getOwnership: mock(() => Promise.resolve(null)),
    listOwners: mock(() => Promise.resolve([])),
  } as unknown as OwnershipV2Db;
}

function createMockRefCountDb(): RefCountDb {
  return {
    getRefCount: mock(() => Promise.resolve(null)),
    incrementRef: mock(() => Promise.resolve({ isNewToRealm: true })),
    decrementRef: mock(() => Promise.resolve({ newCount: 0, deleted: false })),
  } as unknown as RefCountDb;
}

function createMockUsageDb(): UsageDb {
  return {
    getUsage: mock(() =>
      Promise.resolve({
        realm: REALM,
        physicalBytes: 0,
        logicalBytes: 0,
        nodeCount: 0,
        quotaLimit: 1_000_000_000,
        updatedAt: Date.now(),
      })
    ),
    updateUsage: mock(() => Promise.resolve()),
    checkQuota: mock(() =>
      Promise.resolve({
        allowed: true,
        usage: {
          realm: REALM,
          physicalBytes: 0,
          logicalBytes: 0,
          nodeCount: 0,
          quotaLimit: 1_000_000_000,
          updatedAt: Date.now(),
        },
      })
    ),
    setQuotaLimit: mock(() => Promise.resolve()),
    getUserQuota: mock(() =>
      Promise.resolve({
        realm: REALM,
        quotaLimit: 1_000_000_000,
        physicalBytes: 0,
        logicalBytes: 0,
        nodeCount: 0,
      })
    ),
    updateUserQuota: mock(() => Promise.resolve()),
    incrementResourceCount: mock(() => Promise.resolve()),
    decrementResourceCount: mock(() => Promise.resolve()),
    checkResourceLimit: mock(() => Promise.resolve({ allowed: true, currentCount: 0 })),
  } as unknown as UsageDb;
}

function createMockDepotsDb(depots: Map<string, { root: string }> = new Map()): DepotsDb {
  return {
    create: mock(() => Promise.resolve({} as never)),
    get: mock(async (_realm: string, depotId: string) => {
      const d = depots.get(depotId);
      if (!d) return null;
      return {
        realm: _realm,
        depotId,
        root: d.root,
        title: "",
        maxHistory: 10,
        history: [],
        createdAt: 0,
        updatedAt: 0,
      } as never;
    }),
    getByName: mock(() => Promise.resolve(null)),
    getByTitle: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve(null)),
    commit: mock(() => Promise.resolve(null)),
    delete: mock(() => Promise.resolve(false)),
    list: mock(() => Promise.resolve({ depots: [], hasMore: false })),
    listByCreator: mock(() => Promise.resolve({ items: [], hasMore: false })),
    listVisibleToToken: mock(() => Promise.resolve({ items: [], hasMore: false })),
    checkAccess: mock(() => Promise.resolve(true)),
  } as unknown as DepotsDb;
}

function createMockScopeSetNodesDb(): ScopeSetNodesDb {
  return {
    getOrCreate: mock(() =>
      Promise.resolve({ setNodeId: "mock", children: [], refCount: 0, createdAt: 0 })
    ),
    createOrIncrement: mock(() => Promise.resolve()),
    get: mock(() => Promise.resolve(null)),
    incrementRef: mock(() => Promise.resolve()),
    decrementRef: mock(() => Promise.resolve()),
    deleteZeroRefNodes: mock(() => Promise.resolve(0)),
    computeId: mock(() => "mock-set-node-id"),
  } as unknown as ScopeSetNodesDb;
}

// ============================================================================
// Tree Builder Helpers
// ============================================================================

/**
 * Build a tree from a simple object structure and store it.
 * Returns the root CB32 storage key.
 *
 * Example:
 *   { "README.md": "Hello", "src": { "main.ts": "code" } }
 */
async function buildTree(
  storage: StorageProvider,
  tree: Record<string, string | Record<string, unknown>>
): Promise<string> {
  return buildTreeNode(storage, tree);
}

async function buildTreeNode(
  storage: StorageProvider,
  node: Record<string, string | Record<string, unknown>>
): Promise<string> {
  const names: string[] = [];
  const hashes: Uint8Array[] = [];

  for (const [name, value] of Object.entries(node)) {
    if (typeof value === "string") {
      // File
      const data = new TextEncoder().encode(value);
      const encoded = await encodeFileNode(
        { data, contentType: "text/plain", fileSize: data.length },
        hashProvider
      );
      const key = hashToStorageKey(encoded.hash);
      await storage.put(key, encoded.bytes);
      names.push(name);
      hashes.push(encoded.hash);
    } else {
      // Directory (recurse)
      const childKey = await buildTreeNode(
        storage,
        value as Record<string, string | Record<string, unknown>>
      );
      names.push(name);
      hashes.push(storageKeyToHash(childKey));
    }
  }

  // Encode dict node
  const encoded = await encodeDictNode({ children: hashes, childNames: names }, hashProvider);
  const key = hashToStorageKey(encoded.hash);
  await storage.put(key, encoded.bytes);
  return key;
}

// ============================================================================
// Service Factory for Tests
// ============================================================================

function createTestService() {
  const storage = createMemoryStorage();
  const ownershipV2Db = createMockOwnershipDb();
  const refCountDb = createMockRefCountDb();
  const usageDb = createMockUsageDb();
  const depotsDb = createMockDepotsDb();
  const scopeSetNodesDb = createMockScopeSetNodesDb();

  const deps: FsServiceDeps = {
    storage,
    hashProvider,
    ownershipV2Db,
    refCountDb,
    usageDb,
    depotsDb,
    scopeSetNodesDb,
  };

  const service = createFsService(deps);
  return { service, storage, ownershipV2Db, refCountDb, usageDb, depotsDb };
}

/** Convert CB32 storage key to nod_ node key */
function storageKeyToNodeKey(key: string): string {
  return hashToNodeKey(storageKeyToHash(key));
}

// ============================================================================
// Tests
// ============================================================================

describe("Filesystem Service", () => {
  let service: ReturnType<typeof createFsService>;
  let storage: ReturnType<typeof createMemoryStorage>;

  /**
   * Tree structure for most tests:
   *
   * root/
   *   README.md  (content: "# Hello")
   *   src/
   *     main.ts  (content: "console.log('hi')")
   *     lib/
   *       utils.ts (content: "export const x = 1")
   *   docs/
   *     guide.md (content: "Guide content")
   */
  let rootKey: string;
  let rootNodeKey: string;

  beforeEach(async () => {
    const ctx = createTestService();
    service = ctx.service;
    storage = ctx.storage;

    rootKey = await buildTree(storage, {
      "README.md": "# Hello",
      src: {
        "main.ts": "console.log('hi')",
        lib: {
          "utils.ts": "export const x = 1",
        },
      },
      docs: {
        "guide.md": "Guide content",
      },
    });
    rootNodeKey = storageKeyToNodeKey(rootKey);
  });

  // ==========================================================================
  // stat
  // ==========================================================================

  describe("stat", () => {
    it("should stat root directory", async () => {
      const result = await service.stat(REALM, rootNodeKey);
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.type).toBe("dir");
      expect(result.name).toBe("");
      expect(result.childCount).toBe(3); // README.md, src, docs
    });

    it("should stat a file by path", async () => {
      const result = await service.stat(REALM, rootNodeKey, "README.md");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.type).toBe("file");
      expect(result.name).toBe("README.md");
      expect(result.size).toBeDefined();
      expect(result.contentType).toBe("text/plain");
    });

    it("should stat a nested directory", async () => {
      const result = await service.stat(REALM, rootNodeKey, "src");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.type).toBe("dir");
      expect(result.name).toBe("src");
      expect(result.childCount).toBe(2); // main.ts, lib
    });

    it("should stat a deeply nested file", async () => {
      const result = await service.stat(REALM, rootNodeKey, "src/lib/utils.ts");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.type).toBe("file");
      expect(result.name).toBe("utils.ts");
    });

    it("should return PATH_NOT_FOUND for non-existent path", async () => {
      const result = await service.stat(REALM, rootNodeKey, "nonexistent.txt");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("PATH_NOT_FOUND");
      expect(result.status).toBe(404);
    });

    it("should return NOT_A_DIRECTORY for path through a file", async () => {
      const result = await service.stat(REALM, rootNodeKey, "README.md/child");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("NOT_A_DIRECTORY");
    });

    it("should return INVALID_ROOT for invalid node key format", async () => {
      const result = await service.stat(REALM, "invalid-key");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("INVALID_ROOT");
    });

    it("should return INVALID_PATH for absolute path", async () => {
      const result = await service.stat(REALM, rootNodeKey, "/absolute/path");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("INVALID_PATH");
    });

    it("should return INVALID_PATH for path traversal", async () => {
      const result = await service.stat(REALM, rootNodeKey, "../escape");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("INVALID_PATH");
    });
  });

  // ==========================================================================
  // stat with indexPath
  // ==========================================================================

  describe("stat with indexPath", () => {
    it("should stat by index path", async () => {
      // First, ls root to find out indices
      const lsResult = await service.ls(REALM, rootNodeKey);
      if (isFsError(lsResult)) throw new Error("ls failed");

      // Find index of a known child
      const child = lsResult.children[0]!;

      const result = await service.stat(REALM, rootNodeKey, undefined, String(child.index));
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.name).toBe(child.name);
    });

    it("should return INDEX_OUT_OF_BOUNDS for invalid index", async () => {
      const result = await service.stat(REALM, rootNodeKey, undefined, "999");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("INDEX_OUT_OF_BOUNDS");
    });
  });

  // ==========================================================================
  // read
  // ==========================================================================

  describe("read", () => {
    it("should read file content", async () => {
      const result = await service.read(REALM, rootNodeKey, "README.md");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      const text = new TextDecoder().decode(result.data);
      expect(text).toBe("# Hello");
      expect(result.contentType).toBe("text/plain");
      expect(result.size).toBe(7); // "# Hello" = 7 bytes
    });

    it("should read deeply nested file", async () => {
      const result = await service.read(REALM, rootNodeKey, "src/lib/utils.ts");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      const text = new TextDecoder().decode(result.data);
      expect(text).toBe("export const x = 1");
    });

    it("should return NOT_A_FILE for directory", async () => {
      const result = await service.read(REALM, rootNodeKey, "src");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("NOT_A_FILE");
    });

    it("should return PATH_NOT_FOUND for missing file", async () => {
      const result = await service.read(REALM, rootNodeKey, "missing.txt");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("PATH_NOT_FOUND");
    });
  });

  // ==========================================================================
  // ls
  // ==========================================================================

  describe("ls", () => {
    it("should list root directory", async () => {
      const result = await service.ls(REALM, rootNodeKey);
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.total).toBe(3);
      expect(result.children.length).toBe(3);
      expect(result.nextCursor).toBeNull();

      // d-node children are sorted by UTF-8 byte order
      const names = result.children.map((c) => c.name);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });

    it("should list subdirectory", async () => {
      const result = await service.ls(REALM, rootNodeKey, "src");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.total).toBe(2);
      const names = result.children.map((c) => c.name);
      expect(names).toContain("main.ts");
      expect(names).toContain("lib");
    });

    it("should include type info for children", async () => {
      const result = await service.ls(REALM, rootNodeKey, "src");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      const mainTs = result.children.find((c) => c.name === "main.ts");
      const lib = result.children.find((c) => c.name === "lib");

      expect(mainTs?.type).toBe("file");
      expect(mainTs?.size).toBeDefined();
      expect(mainTs?.contentType).toBe("text/plain");

      expect(lib?.type).toBe("dir");
      expect(lib?.childCount).toBeDefined();
    });

    it("should support pagination with limit", async () => {
      const result = await service.ls(REALM, rootNodeKey, undefined, undefined, 2);
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.children.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.nextCursor).not.toBeNull();
    });

    it("should support pagination with cursor", async () => {
      // Get first page
      const page1 = await service.ls(REALM, rootNodeKey, undefined, undefined, 2);
      if (isFsError(page1)) throw new Error("page1 failed");

      // Get second page
      const page2 = await service.ls(
        REALM,
        rootNodeKey,
        undefined,
        undefined,
        2,
        page1.nextCursor!
      );
      if (isFsError(page2)) throw new Error("page2 failed");

      expect(page2.children.length).toBe(1);
      expect(page2.nextCursor).toBeNull();

      // All children should be unique
      const allNames = [...page1.children, ...page2.children].map((c) => c.name);
      expect(new Set(allNames).size).toBe(3);
    });

    it("should return NOT_A_DIRECTORY for file", async () => {
      const result = await service.ls(REALM, rootNodeKey, "README.md");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("NOT_A_DIRECTORY");
    });
  });

  // ==========================================================================
  // write
  // ==========================================================================

  describe("write", () => {
    it("should create a new file at root", async () => {
      const content = new TextEncoder().encode("new file content");
      const result = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "new.txt",
        undefined,
        content,
        "text/plain"
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.created).toBe(true);
      expect(result.file.path).toBe("new.txt");
      expect(result.file.size).toBe(content.length);

      // Verify new root has the new file
      const _newRootKey = nodeKeyToStorageKey(result.newRoot);
      const lsResult = await service.ls(REALM, result.newRoot);
      if (isFsError(lsResult)) throw new Error("ls failed");

      const newChild = lsResult.children.find((c) => c.name === "new.txt");
      expect(newChild).toBeDefined();
      expect(newChild?.type).toBe("file");
    });

    it("should overwrite an existing file", async () => {
      const content = new TextEncoder().encode("updated content");
      const result = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "README.md",
        undefined,
        content,
        "text/markdown"
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.created).toBe(false);

      // Verify content was updated
      const readResult = await service.read(REALM, result.newRoot, "README.md");
      if (isFsError(readResult)) throw new Error("read failed");

      expect(new TextDecoder().decode(readResult.data)).toBe("updated content");
    });

    it("should create file in nested path with auto-mkdir", async () => {
      const content = new TextEncoder().encode("deep content");
      const result = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "a/b/c/deep.txt",
        undefined,
        content,
        "text/plain"
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.created).toBe(true);

      // Verify we can read the created file
      const readResult = await service.read(REALM, result.newRoot, "a/b/c/deep.txt");
      if (isFsError(readResult)) throw new Error("read failed");

      expect(new TextDecoder().decode(readResult.data)).toBe("deep content");
    });

    it("should write file into existing nested directory", async () => {
      const content = new TextEncoder().encode("another file");
      const result = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "src/new.ts",
        undefined,
        content,
        "text/typescript"
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.created).toBe(true);

      // Existing files should still be there
      const readMain = await service.read(REALM, result.newRoot, "src/main.ts");
      if (isFsError(readMain)) throw new Error("read main.ts failed");
      expect(new TextDecoder().decode(readMain.data)).toBe("console.log('hi')");
    });

    it("should return error when writing exceeds max size", async () => {
      const content = new Uint8Array(5 * 1024 * 1024); // 5MB > 4MB max
      const result = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "huge.bin",
        undefined,
        content,
        "application/octet-stream"
      );
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("FILE_TOO_LARGE");
    });

    it("should return error when path is missing", async () => {
      const content = new TextEncoder().encode("no path");
      const result = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        undefined,
        undefined,
        content,
        "text/plain"
      );
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("INVALID_PATH");
    });

    it("should not overwrite directory with file", async () => {
      const content = new TextEncoder().encode("should fail");
      const result = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "src",
        undefined,
        content,
        "text/plain"
      );
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("NOT_A_FILE");
    });

    it("should preserve Merkle tree integrity after write", async () => {
      const content = new TextEncoder().encode("integrity test");
      const result = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "src/lib/new.ts",
        undefined,
        content,
        "text/plain"
      );
      if (isFsError(result)) throw new Error("write failed");

      // Verify the entire tree is navigable from new root
      const statRoot = await service.stat(REALM, result.newRoot);
      if (isFsError(statRoot)) throw new Error("stat root failed");
      expect(statRoot.type).toBe("dir");

      const statSrc = await service.stat(REALM, result.newRoot, "src");
      if (isFsError(statSrc)) throw new Error("stat src failed");
      expect(statSrc.type).toBe("dir");

      const statLib = await service.stat(REALM, result.newRoot, "src/lib");
      if (isFsError(statLib)) throw new Error("stat lib failed");
      expect(statLib.type).toBe("dir");

      // Both old and new files should exist
      const readOld = await service.read(REALM, result.newRoot, "src/lib/utils.ts");
      if (isFsError(readOld)) throw new Error("read old failed");
      expect(new TextDecoder().decode(readOld.data)).toBe("export const x = 1");

      const readNew = await service.read(REALM, result.newRoot, "src/lib/new.ts");
      if (isFsError(readNew)) throw new Error("read new failed");
      expect(new TextDecoder().decode(readNew.data)).toBe("integrity test");
    });
  });

  // ==========================================================================
  // mkdir
  // ==========================================================================

  describe("mkdir", () => {
    it("should create a new directory at root", async () => {
      const result = await service.mkdir(REALM, TOKEN_ID, rootNodeKey, "new-dir");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.created).toBe(true);
      expect(result.dir.path).toBe("new-dir");

      // Verify directory exists
      const statResult = await service.stat(REALM, result.newRoot, "new-dir");
      if (isFsError(statResult)) throw new Error("stat failed");
      expect(statResult.type).toBe("dir");
      expect(statResult.childCount).toBe(0);
    });

    it("should create nested directories", async () => {
      const result = await service.mkdir(REALM, TOKEN_ID, rootNodeKey, "a/b/c");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.created).toBe(true);

      // Verify intermediate dirs
      const statA = await service.stat(REALM, result.newRoot, "a");
      if (isFsError(statA)) throw new Error("stat a failed");
      expect(statA.type).toBe("dir");

      const statB = await service.stat(REALM, result.newRoot, "a/b");
      if (isFsError(statB)) throw new Error("stat b failed");
      expect(statB.type).toBe("dir");

      const statC = await service.stat(REALM, result.newRoot, "a/b/c");
      if (isFsError(statC)) throw new Error("stat c failed");
      expect(statC.type).toBe("dir");
      expect(statC.childCount).toBe(0);
    });

    it("should be idempotent for existing directory", async () => {
      const result = await service.mkdir(REALM, TOKEN_ID, rootNodeKey, "src");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.created).toBe(false);
    });

    it("should fail if path contains a file segment", async () => {
      const result = await service.mkdir(REALM, TOKEN_ID, rootNodeKey, "README.md/subdir");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("NOT_A_DIRECTORY");
    });
  });

  // ==========================================================================
  // rm
  // ==========================================================================

  describe("rm", () => {
    it("should remove a file", async () => {
      const result = await service.rm(REALM, TOKEN_ID, rootNodeKey, "README.md");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.removed.path).toBe("README.md");
      expect(result.removed.type).toBe("file");

      // Verify file is gone
      const statResult = await service.stat(REALM, result.newRoot, "README.md");
      expect(isFsError(statResult)).toBe(true);
      if (!isFsError(statResult)) return;
      expect(statResult.code).toBe("PATH_NOT_FOUND");
    });

    it("should remove a directory (recursive)", async () => {
      const result = await service.rm(REALM, TOKEN_ID, rootNodeKey, "src");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.removed.type).toBe("dir");

      // Verify directory is gone
      const statResult = await service.stat(REALM, result.newRoot, "src");
      expect(isFsError(statResult)).toBe(true);
    });

    it("should remove nested file", async () => {
      const result = await service.rm(REALM, TOKEN_ID, rootNodeKey, "src/main.ts");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.removed.path).toBe("src/main.ts");

      // src directory should still exist with fewer children
      const statSrc = await service.stat(REALM, result.newRoot, "src");
      if (isFsError(statSrc)) throw new Error("stat src failed");
      expect(statSrc.childCount).toBe(1); // only lib remains
    });

    it("should return PATH_NOT_FOUND for missing file", async () => {
      const result = await service.rm(REALM, TOKEN_ID, rootNodeKey, "nonexistent");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("PATH_NOT_FOUND");
    });

    it("should not modify original root", async () => {
      await service.rm(REALM, TOKEN_ID, rootNodeKey, "README.md");

      // Original root should still have README.md
      const statResult = await service.stat(REALM, rootNodeKey, "README.md");
      expect(isFsError(statResult)).toBe(false);
    });
  });

  // ==========================================================================
  // mv
  // ==========================================================================

  describe("mv", () => {
    it("should rename a file", async () => {
      const result = await service.mv(REALM, TOKEN_ID, rootNodeKey, "README.md", "README.txt");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.from).toBe("README.md");
      expect(result.to).toBe("README.txt");

      // Old name should be gone
      const statOld = await service.stat(REALM, result.newRoot, "README.md");
      expect(isFsError(statOld)).toBe(true);

      // New name should exist with same content
      const readNew = await service.read(REALM, result.newRoot, "README.txt");
      if (isFsError(readNew)) throw new Error("read failed");
      expect(new TextDecoder().decode(readNew.data)).toBe("# Hello");
    });

    it("should move a file to a different directory", async () => {
      const result = await service.mv(REALM, TOKEN_ID, rootNodeKey, "README.md", "docs/README.md");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      // Old location should be gone
      const statOld = await service.stat(REALM, result.newRoot, "README.md");
      expect(isFsError(statOld)).toBe(true);

      // New location should have the file
      const readNew = await service.read(REALM, result.newRoot, "docs/README.md");
      if (isFsError(readNew)) throw new Error("read new failed");
      expect(new TextDecoder().decode(readNew.data)).toBe("# Hello");
    });

    it("should move a directory", async () => {
      const result = await service.mv(REALM, TOKEN_ID, rootNodeKey, "src", "source");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      // Old name gone
      const statOld = await service.stat(REALM, result.newRoot, "src");
      expect(isFsError(statOld)).toBe(true);

      // New name exists with children
      const lsNew = await service.ls(REALM, result.newRoot, "source");
      if (isFsError(lsNew)) throw new Error("ls failed");
      expect(lsNew.total).toBe(2); // main.ts, lib
    });

    it("should return PATH_NOT_FOUND for missing source", async () => {
      const result = await service.mv(REALM, TOKEN_ID, rootNodeKey, "nonexistent", "target");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("PATH_NOT_FOUND");
    });
  });

  // ==========================================================================
  // cp
  // ==========================================================================

  describe("cp", () => {
    it("should copy a file", async () => {
      const result = await service.cp(REALM, TOKEN_ID, rootNodeKey, "README.md", "README-copy.md");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      // Both should exist
      const readOrig = await service.read(REALM, result.newRoot, "README.md");
      if (isFsError(readOrig)) throw new Error("read orig failed");
      expect(new TextDecoder().decode(readOrig.data)).toBe("# Hello");

      const readCopy = await service.read(REALM, result.newRoot, "README-copy.md");
      if (isFsError(readCopy)) throw new Error("read copy failed");
      expect(new TextDecoder().decode(readCopy.data)).toBe("# Hello");
    });

    it("should copy a directory", async () => {
      const result = await service.cp(REALM, TOKEN_ID, rootNodeKey, "src", "src-copy");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      // Both should exist
      const lsOrig = await service.ls(REALM, result.newRoot, "src");
      if (isFsError(lsOrig)) throw new Error("ls orig failed");
      expect(lsOrig.total).toBe(2);

      const lsCopy = await service.ls(REALM, result.newRoot, "src-copy");
      if (isFsError(lsCopy)) throw new Error("ls copy failed");
      expect(lsCopy.total).toBe(2);
    });

    it("should copy to nested path with auto-mkdir", async () => {
      const result = await service.cp(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "README.md",
        "archive/2024/README.md"
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      const readCopy = await service.read(REALM, result.newRoot, "archive/2024/README.md");
      if (isFsError(readCopy)) throw new Error("read copy failed");
      expect(new TextDecoder().decode(readCopy.data)).toBe("# Hello");
    });

    it("should return PATH_NOT_FOUND for missing source", async () => {
      const result = await service.cp(REALM, TOKEN_ID, rootNodeKey, "missing", "target");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("PATH_NOT_FOUND");
    });
  });

  // ==========================================================================
  // rewrite
  // ==========================================================================

  describe("rewrite", () => {
    it("should apply delete entries", async () => {
      const result = await service.rewrite(REALM, TOKEN_ID, rootNodeKey, undefined, ["README.md"]);
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.deleted).toBe(1);

      // Verify
      const statResult = await service.stat(REALM, result.newRoot, "README.md");
      expect(isFsError(statResult)).toBe(true);
    });

    it("should apply from entries (move semantics)", async () => {
      const result = await service.rewrite(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        { "renamed.md": { from: "README.md" } },
        undefined
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.entriesApplied).toBeGreaterThanOrEqual(1);

      // New path should exist
      const readResult = await service.read(REALM, result.newRoot, "renamed.md");
      if (isFsError(readResult)) throw new Error("read failed");
      expect(new TextDecoder().decode(readResult.data)).toBe("# Hello");
    });

    it("should apply dir entries (create empty directory)", async () => {
      const result = await service.rewrite(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        { "empty-dir": { dir: true } },
        undefined
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      const statResult = await service.stat(REALM, result.newRoot, "empty-dir");
      if (isFsError(statResult)) throw new Error("stat failed");
      expect(statResult.type).toBe("dir");
      expect(statResult.childCount).toBe(0);
    });

    it("should combine entries and deletes", async () => {
      const result = await service.rewrite(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        { "new-dir": { dir: true } },
        ["README.md"]
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.entriesApplied).toBeGreaterThanOrEqual(1);
      expect(result.deleted).toBe(1);

      // Verify
      const statDir = await service.stat(REALM, result.newRoot, "new-dir");
      if (isFsError(statDir)) throw new Error("stat failed");
      expect(statDir.type).toBe("dir");

      const statRm = await service.stat(REALM, result.newRoot, "README.md");
      expect(isFsError(statRm)).toBe(true);
    });
  });

  // ==========================================================================
  // resolveNodeKey
  // ==========================================================================

  describe("resolveNodeKey", () => {
    it("should resolve nod_ prefix", async () => {
      // stat with the node key should work (tests nod_ resolution)
      const result = await service.stat(REALM, rootNodeKey);
      expect(isFsError(result)).toBe(false);
    });

    it("should resolve dpt_ prefix", async () => {
      // Create a service with depot support
      const depots = new Map<string, { root: string }>();
      depots.set("dpt_testdepot", { root: storageKeyToNodeKey(rootKey) });

      const ctx = createTestService();
      // Manually override the depots db to return our depot
      const depotsDb = createMockDepotsDb(depots);
      const _service2 = createFsService({
        storage: ctx.storage,
        hashProvider,
        ownershipV2Db: ctx.ownershipV2Db,
        refCountDb: ctx.refCountDb,
        usageDb: ctx.usageDb,
        depotsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
      });

      // We need to populate the storage with the tree too
      // Reuse our beforeEach storage
      const service3 = createFsService({
        storage,
        hashProvider,
        ownershipV2Db: ctx.ownershipV2Db,
        refCountDb: ctx.refCountDb,
        usageDb: ctx.usageDb,
        depotsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
      });

      const result = await service3.stat(REALM, "dpt_testdepot");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.type).toBe("dir");
      expect(result.childCount).toBe(3);
    });

    it("should return error for unknown prefix", async () => {
      const result = await service.stat(REALM, "unknown:key");
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("INVALID_ROOT");
    });
  });

  // ==========================================================================
  // Immutability: operations produce new roots
  // ==========================================================================

  describe("immutability", () => {
    it("should return different newRoot after write", async () => {
      const content = new TextEncoder().encode("new");
      const result = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "new.txt",
        undefined,
        content,
        "text/plain"
      );
      if (isFsError(result)) throw new Error("write failed");

      expect(result.newRoot).not.toBe(rootNodeKey);
    });

    it("should return different newRoot after mkdir", async () => {
      const result = await service.mkdir(REALM, TOKEN_ID, rootNodeKey, "new-dir");
      if (isFsError(result)) throw new Error("mkdir failed");

      expect(result.newRoot).not.toBe(rootNodeKey);
    });

    it("should return different newRoot after rm", async () => {
      const result = await service.rm(REALM, TOKEN_ID, rootNodeKey, "README.md");
      if (isFsError(result)) throw new Error("rm failed");

      expect(result.newRoot).not.toBe(rootNodeKey);
    });

    it("original root should be unmodified after multiple operations", async () => {
      // Perform multiple writes
      const content1 = new TextEncoder().encode("file1");
      const r1 = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "file1.txt",
        undefined,
        content1,
        "text/plain"
      );
      if (isFsError(r1)) throw new Error("write1 failed");

      const content2 = new TextEncoder().encode("file2");
      const r2 = await service.write(
        REALM,
        TOKEN_ID,
        rootNodeKey,
        "file2.txt",
        undefined,
        content2,
        "text/plain"
      );
      if (isFsError(r2)) throw new Error("write2 failed");

      // Original root should still have exactly 3 children
      const lsOrig = await service.ls(REALM, rootNodeKey);
      if (isFsError(lsOrig)) throw new Error("ls orig failed");
      expect(lsOrig.total).toBe(3);

      // Each new root is different
      expect(r1.newRoot).not.toBe(r2.newRoot);
    });
  });

  // ==========================================================================
  // Empty tree
  // ==========================================================================

  describe("empty tree", () => {
    let emptyRootNodeKey: string;

    beforeEach(async () => {
      const emptyKey = await buildTree(storage, {});
      emptyRootNodeKey = storageKeyToNodeKey(emptyKey);
    });

    it("should stat empty root", async () => {
      const result = await service.stat(REALM, emptyRootNodeKey);
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.type).toBe("dir");
      expect(result.childCount).toBe(0);
    });

    it("should ls empty root", async () => {
      const result = await service.ls(REALM, emptyRootNodeKey);
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.total).toBe(0);
      expect(result.children).toEqual([]);
    });

    it("should write to empty root", async () => {
      const content = new TextEncoder().encode("hello");
      const result = await service.write(
        REALM,
        TOKEN_ID,
        emptyRootNodeKey,
        "hello.txt",
        undefined,
        content,
        "text/plain"
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.created).toBe(true);

      const readResult = await service.read(REALM, result.newRoot, "hello.txt");
      if (isFsError(readResult)) throw new Error("read failed");
      expect(new TextDecoder().decode(readResult.data)).toBe("hello");
    });

    it("should mkdir in empty root", async () => {
      const result = await service.mkdir(REALM, TOKEN_ID, emptyRootNodeKey, "new-dir");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.created).toBe(true);
    });
  });
});
