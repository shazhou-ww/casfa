/**
 * E2E Tests: Realm API
 *
 * Tests for Realm basic endpoints:
 * - GET /api/realm/{realmId}/info - Realm endpoint info
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

  describe("GET /api/realm/{realmId}/info", () => {
    it("should return realm endpoint info", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Realm API requires Access Token, not User JWT
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      // Note: The actual route is /:realmId (not /:realmId/info)
      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${realm}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any as {
        realm?: string;
        realmId?: string;
        nodeLimit?: number;
        maxNameBytes?: number;
      };
      expect(data.realm ?? data.realmId).toBe(realm);
      expect(data.nodeLimit).toBeGreaterThan(0);
      expect(data.maxNameBytes).toBeGreaterThan(0);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/info`);
      expect(response.status).toBe(401);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = uniqueId();
      const userId2 = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId1, "authorized");
      const { realm: otherRealm } = await ctx.helpers.createTestUser(userId2, "authorized");

      // Create access token for user1's realm
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      // Try to access user2's realm with user1's token
      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${otherRealm}/info`
      );

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/realm/{realmId}/usage", () => {
    it("should return usage statistics", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Realm API requires Access Token
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any as {
        realm?: string;
        realmId?: string;
        physicalBytes?: number;
        totalBytes?: number;
        nodeCount?: number;
      };
      expect(data.realm ?? data.realmId).toBe(realm);
      expect(typeof (data.physicalBytes ?? data.totalBytes)).toBe("number");
      expect(typeof data.nodeCount).toBe("number");
    });

    it("should return zero usage for new realm", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Realm API requires Access Token
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any as {
        physicalBytes?: number;
        totalBytes?: number;
        nodeCount?: number;
      };
      expect(data.physicalBytes ?? data.totalBytes).toBe(0);
      expect(data.nodeCount).toBe(0);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/usage`);
      expect(response.status).toBe(401);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = uniqueId();
      const userId2 = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId1, "authorized");
      const { realm: otherRealm } = await ctx.helpers.createTestUser(userId2, "authorized");

      // Create access token for user1's realm
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      // Try to access user2's realm with user1's token
      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${otherRealm}/usage`
      );

      expect(response.status).toBe(403);
    });
  });

  describe("Authentication Methods", () => {
    it("should accept Access Token authentication (primary method)", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create access token
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      // Note: The actual route is /:realmId (not /:realmId/info)
      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${realm}`
      );

      expect(response.status).toBe(200);
    });

    it("should accept child Delegate access token (Realm API works with all access tokens)", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // In the new model, all tokens are access tokens — child delegates too
      const childToken = await ctx.helpers.createDelegateToken(token, realm, {
        name: "read-only child",
      });

      // Child delegate access token should work for realm API (read operation)
      const response = await ctx.helpers.accessRequest(
        childToken.accessToken,
        "GET",
        `/api/realm/${realm}`
      );

      expect(response.status).toBe(200);
    });

    it("should accept User JWT authentication (Access Token middleware supports JWT for root delegate)", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Note: The actual route is /:realmId (not /:realmId/info)
      // User JWT is accepted — accessTokenMiddleware resolves JWT to root delegate
      const response = await ctx.helpers.authRequest(token, "GET", `/api/realm/${realm}`);

      expect(response.status).toBe(200);
    });
  });
});
