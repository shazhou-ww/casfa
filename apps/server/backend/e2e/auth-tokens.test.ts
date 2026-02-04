/**
 * E2E Tests: Agent Token Management
 *
 * Tests for Agent Token endpoints using casfa-client-v2 SDK:
 * - POST /api/auth/tokens
 * - GET /api/auth/tokens
 * - DELETE /api/auth/tokens/:id
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Agent Token Management", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("POST /api/auth/tokens", () => {
    it("should create an Agent Token", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.agentTokens.create({
        name: "My AI Agent",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        expect(data.id ?? data.tokenId).toMatch(/^token:/);
        expect(data.token).toMatch(/^casfa_/);
        expect(data.name).toBe("My AI Agent");
        expect(data.expiresAt).toBeGreaterThan(Date.now());
        expect(data.createdAt).toBeLessThanOrEqual(Date.now());
      }
    });

    it("should create Agent Token with custom expiration", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const expiresIn = 3600; // 1 hour
      const result = await userClient.agentTokens.create({
        name: "Short-lived Token",
        expiresIn,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        // Check expiration is approximately 1 hour from now
        const expectedExpiry = Date.now() + expiresIn * 1000;
        expect(data.expiresAt).toBeGreaterThan(expectedExpiry - 5000);
        expect(data.expiresAt).toBeLessThan(expectedExpiry + 5000);
      }
    });

    it("should reject missing name", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      // Use raw fetch to test missing name
      const response = await fetch(`${ctx.baseUrl}/api/auth/tokens`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it("should reject empty name", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.agentTokens.create({
        name: "",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
      }
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized Token",
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/auth/tokens", () => {
    it("should list user tokens", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create a few tokens
      await userClient.agentTokens.create({ name: "Token 1" });
      await userClient.agentTokens.create({ name: "Token 2" });

      // List tokens
      const result = await userClient.agentTokens.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Server returns { tokens: [...] }, SDK type expects { items: [...] }
        const data = result.data as any;
        const items = data.items ?? data.tokens;
        expect(items).toBeInstanceOf(Array);
        expect(items.length).toBeGreaterThanOrEqual(2);

        // Token value should NOT be included in list
        for (const t of items) {
          expect(t).not.toHaveProperty("token");
        }
      }
    });

    it("should return empty list for new user", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.agentTokens.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        const items = data.items ?? data.tokens;
        expect(items).toBeInstanceOf(Array);
        expect(items.length).toBe(0);
      }
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/tokens`);
      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/auth/tokens/:id", () => {
    it("should revoke token", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create a token
      const createResult = await userClient.agentTokens.create({
        name: "Token to Revoke",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const data = createResult.data as any;
      const tokenId = data.id ?? data.tokenId;

      // Revoke the token
      const result = await userClient.agentTokens.revoke({ tokenId });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(true);
      }

      // Verify token is no longer in list
      const listResult = await userClient.agentTokens.list();
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        const listData = listResult.data as any;
        const items = listData.items ?? listData.tokens;
        const revokedToken = items.find((t: any) => (t.id ?? t.tokenId) === tokenId);
        expect(revokedToken).toBeUndefined();
      }
    });

    it("should return 404 for non-existent token", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.agentTokens.revoke({
        tokenId: "token:NONEXISTENT0000000000000000",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
      }
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/tokens/token:SOMETOKEN`, {
        method: "DELETE",
      });
      expect(response.status).toBe(401);
    });
  });

  describe("Agent Token Authentication", () => {
    it("should authenticate with Agent Token", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create an Agent Token
      const createResult = await userClient.agentTokens.create({
        name: "Auth Test Token",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      // Use Agent Token via delegate client to access realm
      const delegateClient = ctx.helpers.getDelegateClient(createResult.data.token);
      const result = await delegateClient.realm.getUsage(realm);

      expect(result.ok).toBe(true);
    });
  });
});
