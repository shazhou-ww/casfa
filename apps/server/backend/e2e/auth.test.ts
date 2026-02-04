/**
 * E2E Tests: Authentication
 *
 * Tests authentication and authorization using casfa-client-v2 SDK.
 *
 * Note: These tests use unique user IDs per test to avoid conflicts
 * since DynamoDB Local persists data between test runs.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Authentication", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("Protected Routes", () => {
    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/usage`);
      expect(response.status).toBe(401);
    });

    it("should accept authenticated requests via SDK UserClient", async () => {
      const userId = `test-user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId);
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.realm.getUsage(realm);

      expect(result.ok).toBe(true);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = `user-1-${uniqueId()}`;
      const userId2 = `user-2-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId1);
      const userClient = ctx.helpers.getUserClient(token);

      // Try to access another user's realm
      const result = await userClient.realm.getUsage(`usr_${userId2}`);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(403);
      }
    });
  });

  describe("User Roles", () => {
    it("should allow authorized users to access their realm", async () => {
      const userId = `authorized-user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.realm.getUsage(realm);

      expect(result.ok).toBe(true);
    });

    it("should allow admin users to access admin endpoints", async () => {
      const userId = `admin-user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "admin");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.admin.listUsers();

      expect(result.ok).toBe(true);
    });

    it("should reject non-admin users from admin endpoints", async () => {
      const userId = `regular-user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.admin.listUsers();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(403);
      }
    });
  });

  describe("SDK Client Types", () => {
    it("should authenticate via UserClient (Bearer token)", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.realm.getInfo(realm);

      expect(result.ok).toBe(true);
    });

    it("should authenticate via DelegateClient (Agent token)", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create agent token
      const createResult = await userClient.agentTokens.create({
        name: "Test Agent",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      // Use delegate client
      const delegateClient = ctx.helpers.getDelegateClient(createResult.data.token);
      const result = await delegateClient.realm.getInfo(realm);

      expect(result.ok).toBe(true);
    });

    it("should authenticate via TicketClient (Ticket token)", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      // Create ticket
      const createResult = await userClient.tickets.create(realm, {
        purpose: "SDK auth test",
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      // Use ticket client
      const ticketClient = ctx.helpers.getTicketClient(createResult.data.ticketId, realm);
      const result = await ticketClient.realm.getInfo();

      expect(result.ok).toBe(true);
    });
  });
});
