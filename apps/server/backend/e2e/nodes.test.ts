/**
 * E2E Tests: Node Operations (Delegate Token API)
 *
 * Tests for Node endpoints:
 * - POST /api/realm/{realmId}/nodes/check - Check node status (Access Token)
 * - PUT /api/realm/{realmId}/nodes/:key - Upload node (Access Token + canUpload)
 * - GET /api/realm/{realmId}/nodes/:key/metadata - Get metadata (Access Token + X-CAS-Proof)
 * - GET /api/realm/{realmId}/nodes/:key - Get binary data (Access Token + X-CAS-Proof)
 *
 * Key Concepts:
 * - All operations require Access Token
 * - Read operations require X-CAS-Proof header for non-root delegates
 * - Root delegates have unrestricted access without proof
 * - Write operations require canUpload permission
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
import { createE2EContext, type E2EContext, testNodeKey, uniqueId } from "./setup.ts";

/** Real KeyProvider using blake3 (same as server) */
const keyProvider: KeyProvider = {
  computeKey: async (data: Uint8Array) => {
    const raw = blake3(data, { dkLen: 16 });
    raw[0] = computeSizeFlagByte(data.length);
    return raw;
  },
};

describe("Node Operations", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // POST /api/realm/{realmId}/nodes/check - Check Node Status
  // ==========================================================================

  describe("POST /api/realm/{realmId}/nodes/check", () => {
    it("should return all keys as missing for non-existent nodes", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const testKeys = [testNodeKey(1), testNodeKey(2)];

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "POST",
        `/api/realm/${realm}/nodes/check`,
        { keys: testKeys }
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.missing).toEqual(expect.arrayContaining(testKeys));
      expect(data.owned).toEqual([]);
      expect(data.unowned).toEqual([]);
    });

    it("should handle empty keys array", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "POST",
        `/api/realm/${realm}/nodes/check`,
        { keys: [] }
      );

      // Accept either success with empty result or 400 for empty input
      if (response.status === 200) {
        const data = (await response.json()) as any;
        expect(data.owned).toEqual([]);
        expect(data.unowned).toEqual([]);
        expect(data.missing).toEqual([]);
      } else {
        expect(response.status).toBe(400);
      }
    });

    it("should reject invalid node key format", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "POST",
        `/api/realm/${realm}/nodes/check`,
        { keys: ["invalid-key-format"] }
      );

      expect(response.status).toBe(400);
    });

    it("should reject too many keys (> 1000)", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const tooManyKeys = Array.from({ length: 1001 }, (_, i) => testNodeKey(i));

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "POST",
        `/api/realm/${realm}/nodes/check`,
        { keys: tooManyKeys }
      );

      expect(response.status).toBe(400);
    });

    it("should work with child delegate that has restricted permissions", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // In the new model, all tokens are access tokens — even child delegates
      const childToken = await ctx.helpers.createDelegateToken(token, realm, {
        name: "read-only child",
        canUpload: false,
      });

      const response = await ctx.helpers.accessRequest(
        childToken.accessToken,
        "POST",
        `/api/realm/${realm}/nodes/check`,
        { keys: [testNodeKey(1)] }
      );

      // Child delegate access tokens can still call check (read operation)
      expect(response.status).toBe(200);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/nodes/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [testNodeKey(1)] }),
      });

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // PUT /api/realm/{realmId}/nodes/:key - Upload Node
  // ==========================================================================

  describe("PUT /api/realm/{realmId}/nodes/:key", () => {
    it("should upload a node with canUpload permission", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canUpload: true,
      });

      // Create a simple test node (this would normally be a properly formatted CAS node)
      const nodeData = new Uint8Array([1, 2, 3, 4, 5]);
      const nodeKey = testNodeKey(1);

      const response = await fetch(`${ctx.baseUrl}/api/realm/${realm}/nodes/${nodeKey}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: nodeData,
      });

      // PUT does not require X-CAS-Proof (no scope validation for uploads)
      // Returns 400 if node format is invalid, 200 if valid
      expect(response.status === 200 || response.status === 400).toBe(true);
    });

    it("should reject upload without canUpload permission", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canUpload: false,
      });

      const nodeData = new Uint8Array([1, 2, 3, 4, 5]);
      const nodeKey = testNodeKey(2);

      const response = await fetch(`${ctx.baseUrl}/api/realm/${realm}/nodes/${nodeKey}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: nodeData,
      });

      expect(response.status).toBe(403);
    });

    it("should reject unauthenticated requests", async () => {
      const nodeData = new Uint8Array([1, 2, 3, 4, 5]);
      const nodeKey = testNodeKey(1);

      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/nodes/${nodeKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: nodeData,
      });

      expect(response.status).toBe(401);
    });

    it("should upload a valid file node and return success", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

      // Encode a valid CAS file node
      const data = new TextEncoder().encode("hello e2e");
      const encoded = await encodeFileNode(
        { data, contentType: "text/plain", fileSize: data.length },
        keyProvider
      );
      const nodeKey = hashToNodeKey(encoded.hash);

      const response = await fetch(`${ctx.baseUrl}/api/realm/${realm}/nodes/${nodeKey}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: encoded.bytes,
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.key).toBe(nodeKey);
      expect(body.kind).toBe("file");
    });

    it("should upload a dict node referencing the well-known EMPTY_DICT", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

      // Build a dict node whose only child is the well-known empty dict.
      // The empty dict is virtual (never persisted to storage), so the
      // existsChecker in the PUT handler must recognise it as well-known.
      const emptyDictHash = keyToHash(EMPTY_DICT_KEY); // 16-byte hash
      const dictEncoded = await encodeDictNode(
        { children: [emptyDictHash], childNames: ["subdir"] },
        keyProvider
      );
      const dictNodeKey = hashToNodeKey(dictEncoded.hash);

      const response = await fetch(`${ctx.baseUrl}/api/realm/${realm}/nodes/${dictNodeKey}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: dictEncoded.bytes,
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.key).toBe(dictNodeKey);
      expect(body.kind).toBe("dict");
    });

    it("should upload a dict node with a mix of well-known and uploaded children", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

      // First upload a regular file node
      const fileData = new TextEncoder().encode("mixed-child-test");
      const fileEncoded = await encodeFileNode(
        { data: fileData, contentType: "text/plain", fileSize: fileData.length },
        keyProvider
      );
      const fileNodeKey = hashToNodeKey(fileEncoded.hash);

      const putFileResp = await fetch(`${ctx.baseUrl}/api/realm/${realm}/nodes/${fileNodeKey}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: fileEncoded.bytes,
      });
      expect(putFileResp.status).toBe(200);

      // Now build a dict node with two children:
      //   "empty-subdir" → well-known EMPTY_DICT (virtual, never in storage)
      //   "readme.txt"   → the file we just uploaded
      const emptyDictHash = keyToHash(EMPTY_DICT_KEY);
      const dictEncoded = await encodeDictNode(
        {
          children: [emptyDictHash, fileEncoded.hash],
          childNames: ["empty-subdir", "readme.txt"],
        },
        keyProvider
      );
      const dictNodeKey = hashToNodeKey(dictEncoded.hash);

      const putDictResp = await fetch(`${ctx.baseUrl}/api/realm/${realm}/nodes/${dictNodeKey}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: dictEncoded.bytes,
      });

      expect(putDictResp.status).toBe(200);
      const body = (await putDictResp.json()) as any;
      expect(body.key).toBe(dictNodeKey);
      expect(body.kind).toBe("dict");
    });

    it("should return missing_nodes only for truly missing children, not well-known ones", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

      // Build a dict that references EMPTY_DICT (well-known) + a non-existent file node.
      // Only the non-existent one should appear in the missing list.
      const emptyDictHash = keyToHash(EMPTY_DICT_KEY);
      const fakeHash = new Uint8Array(16);
      fakeHash.set([0xff, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

      const dictEncoded = await encodeDictNode(
        {
          children: [emptyDictHash, fakeHash],
          childNames: ["subdir", "missing.txt"],
        },
        keyProvider
      );
      const dictNodeKey = hashToNodeKey(dictEncoded.hash);

      const response = await fetch(`${ctx.baseUrl}/api/realm/${realm}/nodes/${dictNodeKey}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: dictEncoded.bytes,
      });

      // Should fail because the fake child doesn't exist
      expect(response.status).toBe(409);
      const body = (await response.json()) as any;
      expect(body.error).toBe("missing_nodes");
      // Only the fake hash should be missing, NOT the well-known empty dict
      expect(body.missing).toHaveLength(1);
      // Missing keys must use nod_ prefix for consistency with checkNodes
      expect(body.missing[0]).toMatch(/^nod_/);
      expect(body.missing).not.toContainEqual(expect.stringContaining(EMPTY_DICT_KEY));
    });

    it("should report well-known nodes as owned in check endpoint", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "POST",
        `/api/realm/${realm}/nodes/check`,
        { keys: [EMPTY_DICT_NODE_KEY] }
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.owned).toContain(EMPTY_DICT_NODE_KEY);
      expect(data.missing).not.toContain(EMPTY_DICT_NODE_KEY);
    });
  });

  // ==========================================================================
  // GET /api/realm/{realmId}/nodes/:key/metadata - Get Metadata
  // ==========================================================================

  describe("GET /api/realm/{realmId}/nodes/:key/metadata", () => {
    it("should return 404 for non-existent node (root delegate)", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Root delegate has unrestricted access — no proof needed
      const accessToken = await ctx.helpers.createAccessToken(token, realm);
      const nodeKey = testNodeKey(99);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${realm}/nodes/${nodeKey}/metadata`
      );

      // Root delegate bypasses proof, so missing node returns 404
      expect(response.status).toBe(404);
    });

    it("should reject child delegate without proof", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Child delegate needs X-CAS-Proof for read access
      const childToken = await ctx.helpers.createAccessToken(token, realm, {
        name: "child",
      });

      const nodeKey = testNodeKey(1);

      // No X-CAS-Proof header — child delegate has no proof
      const response = await ctx.helpers.accessRequest(
        childToken.accessToken,
        "GET",
        `/api/realm/${realm}/nodes/${nodeKey}/metadata`
      );

      expect(response.status).toBe(403);
    });

    it("should reject unauthenticated requests", async () => {
      const nodeKey = testNodeKey(1);

      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/nodes/${nodeKey}/metadata`);

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/realm/{realmId}/nodes/:key - Get Binary Data
  // ==========================================================================

  describe("GET /api/realm/{realmId}/nodes/:key", () => {
    it("should return 404 for non-existent node (root delegate)", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Root delegate has unrestricted access — no proof needed
      const accessToken = await ctx.helpers.createAccessToken(token, realm);
      const nodeKey = testNodeKey(99);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${realm}/nodes/${nodeKey}`
      );

      // Root delegate bypasses proof, so missing node returns 404
      expect(response.status).toBe(404);
    });

    it("should reject child delegate without proof", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Child delegate needs X-CAS-Proof for read access
      const childToken = await ctx.helpers.createAccessToken(token, realm, {
        name: "child",
      });

      const nodeKey = testNodeKey(1);

      // No X-CAS-Proof header — child delegate has no proof
      const response = await ctx.helpers.accessRequest(
        childToken.accessToken,
        "GET",
        `/api/realm/${realm}/nodes/${nodeKey}`
      );

      expect(response.status).toBe(403);
    });

    it("should reject unauthenticated requests", async () => {
      const nodeKey = testNodeKey(1);

      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/nodes/${nodeKey}`);

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // Access Control Tests
  // ==========================================================================

  describe("Access Control", () => {
    it("should reject access to other user's realm nodes", async () => {
      const userId1 = uniqueId();
      const userId2 = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId1, "authorized");
      const { realm: otherRealm } = await ctx.helpers.createTestUser(userId2, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const nodeKey = testNodeKey(1);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${otherRealm}/nodes/${nodeKey}`
      );

      expect(response.status).toBe(403);
    });

    it("should reject invalid X-CAS-Proof format", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Use child delegate so it doesn't get root bypass
      const childToken = await ctx.helpers.createAccessToken(token, realm, {
        name: "child-for-invalid-proof",
      });

      const nodeKey = testNodeKey(1);

      const response = await ctx.helpers.accessRequest(
        childToken.accessToken,
        "GET",
        `/api/realm/${realm}/nodes/${nodeKey}`,
        undefined,
        { "X-CAS-Proof": "invalid-not-json" }
      );

      expect(response.status).toBe(400);
    });
  });
});
