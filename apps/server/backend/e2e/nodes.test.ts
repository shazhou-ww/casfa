/**
 * E2E Tests: Node Operations
 *
 * Tests for Node endpoints using casfa-client-v2 SDK:
 * - POST /api/realm/{realmId}/prepare-nodes - Pre-upload check
 * - PUT /api/realm/{realmId}/nodes/:key - Upload node
 * - GET /api/realm/{realmId}/nodes/:key/metadata - Get metadata
 * - GET /api/realm/{realmId}/nodes/:key - Get binary data
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext, testNodeKey, uniqueId } from "./setup.ts";

describe("Node Operations", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("POST /api/realm/{realmId}/prepare-nodes", () => {
    it("should return all keys as missing for non-existent nodes", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const testKeys = [testNodeKey(1), testNodeKey(2)];

      const result = await userClient.nodes.prepare(realm, { keys: testKeys });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.missing).toEqual(expect.arrayContaining(testKeys));
        expect(result.data.exists).toEqual([]);
      }
    });

    it("should handle empty keys array", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.nodes.prepare(realm, { keys: [] });

      // SDK might handle empty keys locally or return 400
      if (result.ok) {
        expect(result.data.exists).toEqual([]);
        expect(result.data.missing).toEqual([]);
      } else {
        expect(result.error.status).toBe(400);
      }
    });

    it("should reject invalid node key format", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.nodes.prepare(realm, {
        keys: ["invalid-key-format"],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
      }
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/prepare-nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: [testNodeKey(1)],
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("PUT /api/realm/{realmId}/nodes/:key", () => {
    it("should attempt to upload a node", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create a simple test node (this would normally be a properly formatted CAS node)
      const nodeData = new Uint8Array([1, 2, 3, 4, 5]);
      const nodeKey = testNodeKey(1);

      const result = await userClient.nodes.put(realm, nodeKey, { data: nodeData });

      // The actual response depends on whether the node format is valid
      // Accept either success or 400 (invalid format)
      expect(result.ok === true || result.error?.status === 400).toBe(true);
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

  describe("GET /api/realm/{realmId}/nodes/:key/metadata", () => {
    it("should return 404 for non-existent node", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const nodeKey = testNodeKey(99);

      const result = await userClient.nodes.getMetadata(realm, nodeKey);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
      }
    });

    it("should reject unauthenticated requests", async () => {
      const nodeKey = testNodeKey(1);

      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/nodes/${nodeKey}/metadata`);

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/realm/{realmId}/nodes/:key", () => {
    it("should return 404 for non-existent node", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const nodeKey = testNodeKey(99);

      const result = await userClient.nodes.get(realm, nodeKey);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
      }
    });

    it("should reject unauthenticated requests", async () => {
      const nodeKey = testNodeKey(1);

      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/nodes/${nodeKey}`);

      expect(response.status).toBe(401);
    });
  });

  describe("Access Control", () => {
    it("should reject access to other users realm nodes", async () => {
      const userId1 = `user1-${uniqueId()}`;
      const userId2 = `user2-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId1, "authorized");
      await ctx.helpers.createTestUser(userId2, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const nodeKey = testNodeKey(1);

      const result = await userClient.nodes.get(`usr_${userId2}`, nodeKey);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(403);
      }
    });
  });
});
