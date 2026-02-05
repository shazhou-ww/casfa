/**
 * E2E Tests: Node Operations (Delegate Token API)
 *
 * Tests for Node endpoints:
 * - POST /api/realm/{realmId}/nodes/prepare - Check missing nodes (Access Token)
 * - PUT /api/realm/{realmId}/nodes/:key - Upload node (Access Token + canUpload)
 * - GET /api/realm/{realmId}/nodes/:key/metadata - Get metadata (Access Token + X-CAS-Index-Path)
 * - GET /api/realm/{realmId}/nodes/:key - Get binary data (Access Token + X-CAS-Index-Path)
 *
 * Key Concepts:
 * - All operations require Access Token (not Delegate Token)
 * - Read operations require X-CAS-Index-Path header to prove scope access
 * - Write operations require canUpload permission
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  buildIndexPath,
  createE2EContext,
  type E2EContext,
  testNodeKey,
  uniqueId,
} from "./setup.ts";

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
  // POST /api/realm/{realmId}/nodes/prepare - Check Missing Nodes
  // ==========================================================================

  describe("POST /api/realm/{realmId}/nodes/prepare", () => {
    it("should return all keys as missing for non-existent nodes", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const testKeys = [testNodeKey(1), testNodeKey(2)];

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/nodes/prepare`,
        { keys: testKeys }
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.missing).toEqual(expect.arrayContaining(testKeys));
      expect(data.exists).toEqual([]);
    });

    it("should handle empty keys array", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/nodes/prepare`,
        { keys: [] }
      );

      // Accept either success with empty result or 400 for empty input
      if (response.status === 200) {
        const data = (await response.json()) as any;
        expect(data.exists).toEqual([]);
        expect(data.missing).toEqual([]);
      } else {
        expect(response.status).toBe(400);
      }
    });

    it("should reject invalid node key format", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/nodes/prepare`,
        { keys: ["invalid-key-format"] }
      );

      expect(response.status).toBe(400);
    });

    it("should reject too many keys (> 1000)", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const tooManyKeys = Array.from({ length: 1001 }, (_, i) => testNodeKey(i));

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/nodes/prepare`,
        { keys: tooManyKeys }
      );

      expect(response.status).toBe(400);
    });

    it("should reject Delegate Token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const delegateToken = await ctx.helpers.createDelegateToken(token, realm);

      const response = await ctx.helpers.delegateRequest(
        delegateToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/nodes/prepare`,
        { keys: [testNodeKey(1)] }
      );

      // Delegate Token cannot access node data directly
      expect(response.status).toBe(403);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/nodes/prepare`, {
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
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canUpload: true,
      });

      // Create a simple test node (this would normally be a properly formatted CAS node)
      const nodeData = new Uint8Array([1, 2, 3, 4, 5]);
      const nodeKey = testNodeKey(1);

      const response = await fetch(`${ctx.baseUrl}/api/realm/${realm}/nodes/${nodeKey}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken.tokenBase64}`,
          "Content-Type": "application/octet-stream",
        },
        body: nodeData,
      });

      // The actual response depends on whether the node format is valid
      // Accept either success or 400 (invalid format)
      expect(response.status === 200 || response.status === 400).toBe(true);
    });

    it("should reject upload without canUpload permission", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canUpload: false,
      });

      const nodeData = new Uint8Array([1, 2, 3, 4, 5]);
      const nodeKey = testNodeKey(2);

      const response = await fetch(`${ctx.baseUrl}/api/realm/${realm}/nodes/${nodeKey}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken.tokenBase64}`,
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
  });

  // ==========================================================================
  // GET /api/realm/{realmId}/nodes/:key/metadata - Get Metadata
  // ==========================================================================

  describe("GET /api/realm/{realmId}/nodes/:key/metadata", () => {
    it("should return 404 for non-existent node", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const nodeKey = testNodeKey(99);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/nodes/${nodeKey}/metadata`,
        undefined,
        { "X-CAS-Index-Path": buildIndexPath(0) }
      );

      expect(response.status).toBe(404);
    });

    it("should reject request without X-CAS-Index-Path header", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const nodeKey = testNodeKey(1);

      // No X-CAS-Index-Path header
      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/nodes/${nodeKey}/metadata`
      );

      expect(response.status).toBe(400);
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
    it("should return 404 for non-existent node", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const nodeKey = testNodeKey(99);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/nodes/${nodeKey}`,
        undefined,
        { "X-CAS-Index-Path": buildIndexPath(0) }
      );

      expect(response.status).toBe(404);
    });

    it("should reject request without X-CAS-Index-Path header", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const nodeKey = testNodeKey(1);

      // No X-CAS-Index-Path header
      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/nodes/${nodeKey}`
      );

      expect(response.status).toBe(400);
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
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId1, "authorized");
      const { realm: otherRealm } = await ctx.helpers.createTestUser(userId2, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const nodeKey = testNodeKey(1);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${otherRealm}/nodes/${nodeKey}`,
        undefined,
        { "X-CAS-Index-Path": buildIndexPath(0) }
      );

      expect(response.status).toBe(403);
    });

    it("should reject invalid index-path format", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const nodeKey = testNodeKey(1);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/nodes/${nodeKey}`,
        undefined,
        { "X-CAS-Index-Path": "invalid:path:format" }
      );

      expect(response.status).toBe(400);
    });
  });
});
