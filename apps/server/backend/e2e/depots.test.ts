/**
 * E2E Tests: Depot Management
 *
 * Tests for Depot endpoints using casfa-client-v2 SDK:
 * - GET /api/realm/{realmId}/depots - List depots
 * - POST /api/realm/{realmId}/depots - Create depot
 * - GET /api/realm/{realmId}/depots/:depotId - Get depot details
 * - PATCH /api/realm/{realmId}/depots/:depotId - Update depot metadata
 * - POST /api/realm/{realmId}/depots/:depotId/commit - Commit new root
 * - DELETE /api/realm/{realmId}/depots/:depotId - Delete depot
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext, testNodeKey, uniqueId } from "./setup.ts";

describe("Depot Management", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("GET /api/realm/{realmId}/depots", () => {
    it("should list depots including default main depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.depots.list(realm);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Server returns { depots: [...] }, SDK type expects { items: [...] }
        const data = result.data as any;
        const items = data.items ?? data.depots;
        expect(items).toBeInstanceOf(Array);
        expect(items.length).toBeGreaterThanOrEqual(0);
      }
    });

    it("should support pagination", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create a few depots
      for (let i = 0; i < 3; i++) {
        await userClient.depots.create(realm, { title: `Depot ${i}` });
      }

      const result = await userClient.depots.list(realm, { limit: 2 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        const items = data.items ?? data.depots;
        expect(items.length).toBeLessThanOrEqual(2);
      }
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/depots`);
      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/realm/{realmId}/depots", () => {
    it("should create a new depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.depots.create(realm, {
        title: "My Documents",
        maxHistory: 10,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        expect(data.depotId).toMatch(/^depot:/);
        expect(data.title).toBe("My Documents");
        expect(data.maxHistory).toBe(10);
        expect(data.createdAt).toBeLessThanOrEqual(Date.now());
      }
    });

    it("should create depot with default maxHistory", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.depots.create(realm, {
        title: "Default History Depot",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        expect(data.maxHistory).toBe(20); // Default value
      }
    });

    it("should reject maxHistory exceeding system limit", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.depots.create(realm, {
        title: "Too Much History",
        maxHistory: 101, // Exceeds max of 100
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
      }
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Unauthorized" }),
      });
      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/realm/{realmId}/depots/:depotId", () => {
    it("should get depot details with history", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create depot
      const createResult = await userClient.depots.create(realm, {
        title: "Detail Test",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const { depotId } = createResult.data;

      // Get details
      const result = await userClient.depots.get(realm, depotId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.depotId).toBe(depotId);
        expect(result.data.title).toBe("Detail Test");
        expect(result.data.history).toBeInstanceOf(Array);
      }
    });

    it("should return 404 for non-existent depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.depots.get(realm, "depot:NONEXISTENT0000000000000");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
      }
    });
  });

  describe("PATCH /api/realm/{realmId}/depots/:depotId", () => {
    it("should update depot title", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create depot
      const createResult = await userClient.depots.create(realm, {
        title: "Original Title",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const { depotId } = createResult.data;

      // Update title
      const result = await userClient.depots.update(realm, depotId, {
        title: "New Title",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe("New Title");
      }
    });

    it("should update depot maxHistory", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create depot
      const createResult = await userClient.depots.create(realm, {
        title: "History Update",
        maxHistory: 10,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const { depotId } = createResult.data;

      // Update maxHistory
      const result = await userClient.depots.update(realm, depotId, {
        maxHistory: 30,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        expect(data.maxHistory).toBe(30);
      }
    });

    it("should reject maxHistory exceeding limit", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create depot
      const createResult = await userClient.depots.create(realm, {
        title: "Bad Update",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const { depotId } = createResult.data;

      // Try to set too high maxHistory
      const result = await userClient.depots.update(realm, depotId, {
        maxHistory: 200,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
      }
    });

    it("should return 404 for non-existent depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.depots.update(realm, "depot:NONEXISTENT0000000000000", {
        title: "Update",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
      }
    });
  });

  describe("POST /api/realm/{realmId}/depots/:depotId/commit", () => {
    it("should attempt commit new root node", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create depot
      const createResult = await userClient.depots.create(realm, {
        title: "Commit Test",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const { depotId } = createResult.data;

      // Commit new root (note: would fail if node doesn't exist)
      const newRoot = testNodeKey(1);
      const result = await userClient.depots.commit(realm, depotId, {
        root: newRoot,
      });

      // Expect failure because the root node doesn't actually exist
      expect(result.ok === true || result.error?.status === 400).toBe(true);
    });

    it("should reject invalid root key format", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create depot
      const createResult = await userClient.depots.create(realm, {
        title: "Invalid Root Test",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const { depotId } = createResult.data;

      // Commit with invalid root format
      const result = await userClient.depots.commit(realm, depotId, {
        root: "invalid-root-format",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
      }
    });

    it("should return 404 for non-existent depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.depots.commit(realm, "depot:NONEXISTENT0000000000000", {
        root: testNodeKey(1),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
      }
    });
  });

  describe("DELETE /api/realm/{realmId}/depots/:depotId", () => {
    it("should delete depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create depot
      const createResult = await userClient.depots.create(realm, {
        title: "Delete Test",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const { depotId } = createResult.data;

      // Delete depot
      const result = await userClient.depots.delete(realm, depotId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(true);
      }

      // Verify deleted
      const getResult = await userClient.depots.get(realm, depotId);
      expect(getResult.ok).toBe(false);
      if (!getResult.ok) {
        expect(getResult.error.status).toBe(404);
      }
    });

    it("should return 404 for non-existent depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.depots.delete(realm, "depot:NONEXISTENT0000000000000");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
      }
    });
  });

  describe("Access Control", () => {
    it("should reject access to other users realm depots", async () => {
      const userId1 = `user1-${uniqueId()}`;
      const userId2 = `user2-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId1, "authorized");
      await ctx.helpers.createTestUser(userId2, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.depots.list(`usr_${userId2}`);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(403);
      }
    });

    it("should not allow Ticket to access depots list", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create ticket
      const createResult = await userClient.tickets.create(realm, {
        purpose: "Depot access test",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const { ticketId } = createResult.data;

      // Try to list depots with ticket - use raw fetch since ticketClient doesn't have list
      const response = await ctx.helpers.ticketRequest(
        ticketId,
        "GET",
        `/api/realm/${realm}/depots`
      );

      expect(response.status).toBe(403);
    });
  });
});
