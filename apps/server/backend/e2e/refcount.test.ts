/**
 * E2E Tests: Reference Count (refCount)
 *
 * Verifies that the refCount field is correctly maintained when nodes are
 * uploaded via PUT /api/realm/{realmId}/nodes/raw/:key and properly surfaced
 * by GET /api/realm/{realmId}/nodes/metadata/:key.
 *
 * Covered scenarios:
 * - Single file node upload → refCount = 1
 * - Dict node with children → parent and children each get correct refCount
 * - Multiple parents referencing the same child → child refCount increments
 * - Well-known empty d-node referenced as a child → refCount tracked per realm
 * - Re-uploading the same node (idempotent PUT) → refCount increments
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  computeSizeFlagByte,
  EMPTY_DICT_KEY,
  encodeDictNode,
  encodeFileNode,
  type KeyProvider,
  keyToHash,
} from "@casfa/core";
import { EMPTY_DICT_NODE_KEY, hashToNodeKey } from "@casfa/protocol";
import { blake3 } from "@noble/hashes/blake3";
import { createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Real KeyProvider using blake3 (same as server) */
const keyProvider: KeyProvider = {
  computeKey: async (data: Uint8Array) => {
    const raw = blake3(data, { dkLen: 16 });
    raw[0] = computeSizeFlagByte(data.length);
    return raw;
  },
};

/** Upload a raw CAS node via PUT and return the parsed JSON response body. */
async function uploadNode(
  ctx: E2EContext,
  accessToken: string,
  realm: string,
  nodeKey: string,
  bytes: Uint8Array
): Promise<{ status: number; body: any }> {
  const url = `${ctx.baseUrl}/api/realm/${realm}/nodes/raw/${nodeKey}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
  });
  const body = response.headers.get("content-type")?.includes("json")
    ? await response.json()
    : null;
  return { status: response.status, body };
}

/** Fetch node metadata and return parsed response. */
async function getMetadata(
  ctx: E2EContext,
  token: string,
  realm: string,
  nodeKey: string
): Promise<{ status: number; body: any }> {
  const response = await ctx.helpers.accessRequest(
    token,
    "GET",
    `/api/realm/${realm}/nodes/metadata/${nodeKey}`
  );
  const body = response.headers.get("content-type")?.includes("json")
    ? await response.json()
    : null;
  return { status: response.status, body };
}

/** Encode a file node from text content and return { hash, bytes, nodeKey }. */
async function makeFileNode(content: string) {
  const data = new TextEncoder().encode(content);
  const encoded = await encodeFileNode(
    { data, contentType: "text/plain", fileSize: data.length },
    keyProvider
  );
  return {
    hash: encoded.hash,
    bytes: encoded.bytes,
    nodeKey: hashToNodeKey(encoded.hash),
  };
}

/** Encode a dict node and return { hash, bytes, nodeKey }. */
async function makeDictNode(children: Uint8Array[], childNames: string[]) {
  const encoded = await encodeDictNode({ children, childNames }, keyProvider);
  return {
    hash: encoded.hash,
    bytes: encoded.bytes,
    nodeKey: hashToNodeKey(encoded.hash),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RefCount", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // ========================================================================
  // Basic: single node upload
  // ========================================================================

  it("should set refCount = 1 for a newly uploaded file node", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    const file = await makeFileNode("refcount-single-file");
    const put = await uploadNode(ctx, at.accessToken, realm, file.nodeKey, file.bytes);
    expect(put.status).toBe(200);

    const meta = await getMetadata(ctx, token, realm, file.nodeKey);
    expect(meta.status).toBe(200);
    expect(meta.body.refCount).toBe(1);
  });

  it("should set refCount = 1 for a newly uploaded dict node", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    // Upload a file child first
    const file = await makeFileNode("dict-child-file");
    await uploadNode(ctx, at.accessToken, realm, file.nodeKey, file.bytes);

    // Build + upload a dict referencing that file
    const dict = await makeDictNode([file.hash], ["child.txt"]);
    const put = await uploadNode(ctx, at.accessToken, realm, dict.nodeKey, dict.bytes);
    expect(put.status).toBe(200);

    const meta = await getMetadata(ctx, token, realm, dict.nodeKey);
    expect(meta.status).toBe(200);
    expect(meta.body.refCount).toBe(1);
  });

  // ========================================================================
  // Parent → child relationship
  // ========================================================================

  it("should increment child refCount when referenced by a parent dict", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    // Upload a file node (refCount starts at 1)
    const file = await makeFileNode("child-ref-test");
    await uploadNode(ctx, at.accessToken, realm, file.nodeKey, file.bytes);

    const metaBefore = await getMetadata(ctx, token, realm, file.nodeKey);
    expect(metaBefore.body.refCount).toBe(1);

    // Upload a dict that references the file → child refCount becomes 2
    const dict = await makeDictNode([file.hash], ["readme.txt"]);
    await uploadNode(ctx, at.accessToken, realm, dict.nodeKey, dict.bytes);

    const metaAfter = await getMetadata(ctx, token, realm, file.nodeKey);
    expect(metaAfter.body.refCount).toBe(2);
  });

  it("should increment child refCount for each parent that references it", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    // Upload a shared file
    const sharedFile = await makeFileNode("shared-across-parents");
    await uploadNode(ctx, at.accessToken, realm, sharedFile.nodeKey, sharedFile.bytes);

    // Create two distinct parent dicts, each referencing the same file
    // (different child names make different dict hashes)
    const dictA = await makeDictNode([sharedFile.hash], ["a.txt"]);
    await uploadNode(ctx, at.accessToken, realm, dictA.nodeKey, dictA.bytes);

    const dictB = await makeDictNode([sharedFile.hash], ["b.txt"]);
    await uploadNode(ctx, at.accessToken, realm, dictB.nodeKey, dictB.bytes);

    // File was uploaded once (refCount=1), then referenced by dictA (+1) and dictB (+1) = 3
    const meta = await getMetadata(ctx, token, realm, sharedFile.nodeKey);
    expect(meta.body.refCount).toBe(3);
  });

  // ========================================================================
  // Same child appearing multiple times in a single dict
  // ========================================================================

  it("should count each occurrence when the same child appears multiple times in a dict", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    // Upload a file
    const file = await makeFileNode("multi-ref-in-dict");
    await uploadNode(ctx, at.accessToken, realm, file.nodeKey, file.bytes);

    // Dict with the SAME child hash appearing 3 times (different names)
    const dict = await makeDictNode(
      [file.hash, file.hash, file.hash],
      ["copy1.txt", "copy2.txt", "copy3.txt"]
    );
    await uploadNode(ctx, at.accessToken, realm, dict.nodeKey, dict.bytes);

    // 1 from initial upload + 3 from dict children = 4
    const meta = await getMetadata(ctx, token, realm, file.nodeKey);
    expect(meta.body.refCount).toBe(4);
  });

  // ========================================================================
  // Well-known nodes (EMPTY_DICT)
  // ========================================================================

  it("should track refCount for well-known empty d-node when referenced as child", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    // Build a dict node whose child is the well-known empty dict
    const emptyDictHash = keyToHash(EMPTY_DICT_KEY);
    const dict = await makeDictNode([emptyDictHash], ["empty-dir"]);
    await uploadNode(ctx, at.accessToken, realm, dict.nodeKey, dict.bytes);

    // getMetadata for the well-known empty d-node should reflect the reference
    const meta = await getMetadata(ctx, token, realm, EMPTY_DICT_NODE_KEY);
    expect(meta.status).toBe(200);
    expect(meta.body.kind).toBe("dict");
    expect(meta.body.refCount).toBeGreaterThanOrEqual(1);
  });

  it("should accumulate refCount for well-known empty d-node across multiple parents", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    const emptyDictHash = keyToHash(EMPTY_DICT_KEY);

    // Upload a file to make a unique dict (different from previous test)
    const file = await makeFileNode("wk-multi-parent-test");
    await uploadNode(ctx, at.accessToken, realm, file.nodeKey, file.bytes);

    // Parent A: references empty dict once
    const dictA = await makeDictNode([emptyDictHash, file.hash], ["subdir-a", "file.txt"]);
    await uploadNode(ctx, at.accessToken, realm, dictA.nodeKey, dictA.bytes);

    // Parent B: references empty dict twice (two empty sub-directories)
    const dictB = await makeDictNode([emptyDictHash, emptyDictHash], ["empty-x", "empty-y"]);
    await uploadNode(ctx, at.accessToken, realm, dictB.nodeKey, dictB.bytes);

    // The well-known node should have refCount >= 3 (1 from dictA, 2 from dictB)
    const meta = await getMetadata(ctx, token, realm, EMPTY_DICT_NODE_KEY);
    expect(meta.status).toBe(200);
    expect(meta.body.refCount).toBeGreaterThanOrEqual(3);
  });

  // ========================================================================
  // Metadata response shape
  // ========================================================================

  it("should include refCount in file node metadata", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    const file = await makeFileNode("meta-shape-file");
    await uploadNode(ctx, at.accessToken, realm, file.nodeKey, file.bytes);

    const meta = await getMetadata(ctx, token, realm, file.nodeKey);
    expect(meta.status).toBe(200);
    expect(meta.body.key).toBe(file.nodeKey);
    expect(meta.body.kind).toBe("file");
    expect(meta.body.refCount).toBeGreaterThanOrEqual(1);
  });

  it("should include refCount in dict node metadata", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    // Dict with well-known empty child (always available, no pre-upload needed)
    const emptyDictHash = keyToHash(EMPTY_DICT_KEY);
    const dict = await makeDictNode([emptyDictHash], ["sub"]);
    await uploadNode(ctx, at.accessToken, realm, dict.nodeKey, dict.bytes);

    const meta = await getMetadata(ctx, token, realm, dict.nodeKey);
    expect(meta.status).toBe(200);
    expect(meta.body.key).toBe(dict.nodeKey);
    expect(meta.body.kind).toBe("dict");
    expect(meta.body.children).toBeDefined();
    expect(meta.body.refCount).toBeGreaterThanOrEqual(1);
  });

  it("should include refCount in well-known dict node metadata", async () => {
    // Well-known nodes are accessible even without uploading, but refCount
    // is 0 in a brand-new realm where nobody has referenced them yet.
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

    const meta = await getMetadata(ctx, token, realm, EMPTY_DICT_NODE_KEY);
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({
      kind: "dict",
      refCount: 0, // No parent has referenced it in this fresh realm
    });
  });

  // ========================================================================
  // Idempotent PUT (re-upload same node)
  // ========================================================================

  it("should increment refCount when the same node is PUT again", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    const file = await makeFileNode("idempotent-put-test");

    // First upload
    await uploadNode(ctx, at.accessToken, realm, file.nodeKey, file.bytes);
    const meta1 = await getMetadata(ctx, token, realm, file.nodeKey);
    expect(meta1.body.refCount).toBe(1);

    // Second upload of the exact same node
    await uploadNode(ctx, at.accessToken, realm, file.nodeKey, file.bytes);
    const meta2 = await getMetadata(ctx, token, realm, file.nodeKey);
    expect(meta2.body.refCount).toBe(2);
  });

  // ========================================================================
  // Nested dict hierarchy
  // ========================================================================

  it("should correctly track refCounts in a nested dict hierarchy", async () => {
    const userId = uniqueId();
    const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
    const at = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

    // Build: root-dict → sub-dict → file
    const file = await makeFileNode("nested-hierarchy-leaf");
    await uploadNode(ctx, at.accessToken, realm, file.nodeKey, file.bytes);
    // file refCount = 1

    const subDict = await makeDictNode([file.hash], ["leaf.txt"]);
    await uploadNode(ctx, at.accessToken, realm, subDict.nodeKey, subDict.bytes);
    // subDict refCount = 1, file refCount = 2

    const rootDict = await makeDictNode([subDict.hash], ["subdir"]);
    await uploadNode(ctx, at.accessToken, realm, rootDict.nodeKey, rootDict.bytes);
    // rootDict refCount = 1, subDict refCount = 2, file refCount = 2

    const fileMeta = await getMetadata(ctx, token, realm, file.nodeKey);
    expect(fileMeta.body.refCount).toBe(2); // self-upload + sub-dict child ref

    const subDictMeta = await getMetadata(ctx, token, realm, subDict.nodeKey);
    expect(subDictMeta.body.refCount).toBe(2); // self-upload + root-dict child ref

    const rootDictMeta = await getMetadata(ctx, token, realm, rootDict.nodeKey);
    expect(rootDictMeta.body.refCount).toBe(1); // self-upload only
  });

  // ========================================================================
  // Cross-realm isolation
  // ========================================================================

  it("should isolate refCounts between different realms", async () => {
    const userA = uniqueId();
    const userB = uniqueId();
    const { token: tokenA, realm: realmA } = await ctx.helpers.createTestUser(userA, "authorized");
    const { token: tokenB, realm: realmB } = await ctx.helpers.createTestUser(userB, "authorized");
    const atA = await ctx.helpers.createAccessToken(tokenA, realmA, { canUpload: true });
    const atB = await ctx.helpers.createAccessToken(tokenB, realmB, { canUpload: true });

    // Same content → same CAS key in both realms
    const file = await makeFileNode("cross-realm-isolation");

    // Upload in realm A
    await uploadNode(ctx, atA.accessToken, realmA, file.nodeKey, file.bytes);
    // Upload in realm B (twice to get refCount=2)
    await uploadNode(ctx, atB.accessToken, realmB, file.nodeKey, file.bytes);
    await uploadNode(ctx, atB.accessToken, realmB, file.nodeKey, file.bytes);

    // Each realm has its own refCount
    const metaA = await getMetadata(ctx, tokenA, realmA, file.nodeKey);
    expect(metaA.body.refCount).toBe(1);

    const metaB = await getMetadata(ctx, tokenB, realmB, file.nodeKey);
    expect(metaB.body.refCount).toBe(2);
  });
});
