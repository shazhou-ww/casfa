/**
 * E2E Tests: Realm API
 *
 * Tests for Realm basic endpoints using casfa-client-v2 SDK:
 * - GET /api/realm/{realmId} - Realm endpoint info
 * - GET /api/realm/{realmId}/usage - Usage statistics
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Realm API", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("GET /api/realm/{realmId}", () => {
    it("should return realm endpoint info", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.realm.getInfo(realm);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        expect(data.realm ?? data.realmId).toBe(realm);
        expect(data.nodeLimit).toBeGreaterThan(0);
        expect(data.maxNameBytes).toBeGreaterThan(0);
      }
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test`);
      expect(response.status).toBe(401);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = `user1-${uniqueId()}`;
      const userId2 = `user2-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId1, "authorized");
      await ctx.helpers.createTestUser(userId2, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.realm.getInfo(`usr_${userId2}`);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(403);
      }
    });
  });

  describe("GET /api/realm/{realmId}/usage", () => {
    it("should return usage statistics", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.realm.getUsage(realm);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        expect(data.realm ?? data.realmId).toBe(realm);
        expect(typeof (data.physicalBytes ?? data.totalBytes)).toBe("number");
        expect(typeof data.nodeCount).toBe("number");
      }
    });

    it("should return zero usage for new realm", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.realm.getUsage(realm);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        expect(data.physicalBytes ?? data.totalBytes).toBe(0);
        expect(data.nodeCount).toBe(0);
      }
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/usage`);
      expect(response.status).toBe(401);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = `user1-${uniqueId()}`;
      const userId2 = `user2-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId1, "authorized");
      await ctx.helpers.createTestUser(userId2, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.realm.getUsage(`usr_${userId2}`);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(403);
      }
    });
  });

  describe("Authentication Methods", () => {
    it("should accept Bearer token authentication (via UserClient)", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.realm.getInfo(realm);

      expect(result.ok).toBe(true);
    });

    it("should accept Agent token authentication (via DelegateClient)", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create agent token
      const createResult = await userClient.agentTokens.create({
        name: "Test Agent",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      // Use agent token via delegate client
      const delegateClient = ctx.helpers.getDelegateClient(createResult.data.token);
      const result = await delegateClient.realm.getInfo(realm);

      expect(result.ok).toBe(true);
    });
  });
});
