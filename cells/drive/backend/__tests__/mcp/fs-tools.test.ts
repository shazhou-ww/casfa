import { describe, expect, it } from "bun:test";
import {
  createCasFacade,
  createCasStorageFromBuffer,
  streamFromBytes,
  type CasFacade,
} from "@casfa/cas";
import {
  computeSizeFlagByte,
  encodeDictNode,
  hashToKey,
  type KeyProvider,
} from "@casfa/core";
import { createMemoryBranchStore } from "../../db/branch-store.ts";
import { executeTool, type McpHandlerDeps } from "../../mcp/handler.ts";

function createKeyProvider(): KeyProvider {
  return {
    computeKey: async (data: Uint8Array) => {
      const { blake3 } = await import("@noble/hashes/blake3");
      const raw = blake3(data, { dkLen: 16 });
      raw[0] = computeSizeFlagByte(data.length);
      return raw;
    },
  };
}

function createTestCas(): { cas: CasFacade; key: KeyProvider } {
  const key = createKeyProvider();
  const store = new Map<string, Uint8Array>();
  const storage = createCasStorageFromBuffer({
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, bytes: Uint8Array) => {
      store.set(k, bytes);
    },
    del: async (_k: string) => {},
  });
  return { cas: createCasFacade({ storage, key }), key };
}

async function setupDepsWithTree(): Promise<{
  deps: McpHandlerDeps;
  auth: { type: "user"; userId: string };
}> {
  const { cas, key } = createTestCas();
  const branchStore = createMemoryBranchStore();
  const auth = { type: "user" as const, userId: "u-1" };

  const leaf = await encodeDictNode({ children: [], childNames: [] }, key);
  const leafKey = hashToKey(leaf.hash);
  await cas.putNode(leafKey, streamFromBytes(leaf.bytes));

  const imagesDir = await encodeDictNode(
    { children: [leaf.hash, leaf.hash, leaf.hash], childNames: ["a.jpg", "b.jpg", "nested"] },
    key
  );
  const imagesDirKey = hashToKey(imagesDir.hash);
  await cas.putNode(imagesDirKey, streamFromBytes(imagesDir.bytes));

  const root = await encodeDictNode({ children: [imagesDir.hash], childNames: ["images"] }, key);
  const rootKey = hashToKey(root.hash);
  await cas.putNode(rootKey, streamFromBytes(root.bytes));

  await branchStore.ensureRealmRoot(auth.userId, rootKey);
  await branchStore.setRealmRoot(auth.userId, rootKey);

  const deps: McpHandlerDeps = {
    cas,
    key,
    branchStore,
    config: {
      port: 0,
      baseUrl: "http://localhost",
      auth: {},
      dynamodbTableRealms: "x",
      dynamodbTableGrants: "y",
      dynamodbTablePendingClientInfo: "z",
      s3Bucket: "b",
    },
  };
  return { deps, auth };
}

describe("mcp fs tools", () => {
  it("fs_ls supports glob mode and no recursive expansion", async () => {
    const { deps, auth } = await setupDepsWithTree();
    const result = await executeTool(auth, deps, "fs_ls", {
      paths: ["images/*.jpg"],
      mode: "glob",
    });
    const text = result.content[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { entries: Array<{ path: string }>; noMatch: number };
    expect(parsed.entries.map((item) => item.path).sort()).toEqual(["images/a.jpg", "images/b.jpg"]);
    expect(parsed.noMatch).toBe(0);
  });

  it("fs_batch returns failed union on command error", async () => {
    const { deps, auth } = await setupDepsWithTree();
    const result = await executeTool(auth, deps, "fs_batch", {
      commands: [{ name: "unknown", arguments: {} }],
    });
    const text = result.content[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { status: string; error?: { code: string }; tombstones?: unknown };
    expect(parsed.status).toBe("failed");
    expect(parsed.error?.code).toBe("E_INVALID_COMMAND");
    expect("tombstones" in parsed).toBe(false);
  });

  it("fs_batch returns compact committed summary with tombstones", async () => {
    const { deps, auth } = await setupDepsWithTree();
    const result = await executeTool(auth, deps, "fs_batch", {
      commands: [
        {
          name: "cp",
          arguments: {
            from: "images/a.jpg",
            to: "images/b.jpg",
            mode: "glob",
          },
        },
      ],
    });
    const text = result.content[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as {
      status: string;
      summary: { copied: number; overwritten: number; noMatch: number };
      tombstones: Array<{ path: string; key: string }>;
    };
    expect(parsed.status).toBe("committed");
    expect(parsed.summary.copied).toBe(1);
    expect(parsed.summary.overwritten).toBe(1);
    expect(parsed.summary.noMatch).toBe(0);
    expect(parsed.tombstones).toHaveLength(1);
    expect(parsed.tombstones[0]?.path).toBe("images/b.jpg");
  });

  it("fs_batch keeps noMatch count without failing", async () => {
    const { deps, auth } = await setupDepsWithTree();
    const result = await executeTool(auth, deps, "fs_batch", {
      commands: [
        {
          name: "rm",
          arguments: {
            paths: ["images/no-hit-*.jpg"],
            mode: "glob",
          },
        },
        {
          name: "mkdir",
          arguments: {
            paths: ["images/new-dir"],
          },
        },
      ],
    });
    const text = result.content[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as {
      status: string;
      summary: { deleted: number; created: number; noMatch: number };
    };
    expect(parsed.status).toBe("committed");
    expect(parsed.summary.deleted).toBe(0);
    expect(parsed.summary.created).toBe(1);
    expect(parsed.summary.noMatch).toBe(1);
  });
});
