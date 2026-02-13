/**
 * E2E Tests: Authentication
 *
 * Tests authentication and authorization using different credential types:
 * - User JWT (Bearer token)
 * - Access Token (from Delegate model)
 *
 * Auth Flow:
 * - User JWT + middleware auto-creates root delegate on first request
 * - Access Token can call POST /api/realm/{realmId}/delegates to create child delegates
 * - Access Token can call /api/realm/{realmId}/... endpoints
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

    it("should accept authenticated requests with Access Token", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId);

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(200);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = uniqueId();
      const userId2 = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId1);
      const { realm: otherRealm } = await ctx.helpers.createTestUser(userId2);

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${otherRealm}/usage`
      );

      expect(response.status).toBe(403);
    });
  });

  describe("User Roles", () => {
    it("should allow authorized users to access their realm", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(200);
    });

    it("should allow admin users to access admin endpoints", async () => {
      const userId = uniqueId();
      const { token } = await ctx.helpers.createTestUser(userId, "admin");

      const response = await ctx.helpers.authRequest(token, "GET", "/api/admin/users");

      expect(response.status).toBe(200);
    });

    it("should reject non-admin users from admin endpoints", async () => {
      const userId = uniqueId();
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.authRequest(token, "GET", "/api/admin/users");

      expect(response.status).toBe(403);
    });

    it("should reject unauthorized users from realm access", async () => {
      const userId = uniqueId();
      const {
        token,
        userId: userIdBase32,
        realm,
      } = await ctx.helpers.createTestUser(userId, "authorized");

      await ctx.db.userRolesDb.setRole(userIdBase32, "unauthorized");

      // JWT on realm endpoint should be rejected for unauthorized users
      const response = await ctx.helpers.accessRequest(token, "GET", `/api/realm/${realm}/usage`);

      expect([401, 403]).toContain(response.status);
    });
  });

  describe("Token Types", () => {
    it("should auto-create root delegate on first JWT realm request", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // First JWT request should auto-create root delegate via middleware
      const response = await ctx.helpers.accessRequest(token, "GET", `/api/realm/${realm}/usage`);

      expect(response.status).toBe(200);
    });

    it("should authenticate with JWT to create child delegate", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Use JWT directly on realm endpoint (middleware auto-creates root delegate)
      const response = await ctx.helpers.accessRequest(
        token,
        "POST",
        `/api/realm/${realm}/delegates`,
        {
          name: "Child Delegate",
          canUpload: false,
          canManageDepot: false,
        }
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.delegate).toBeDefined();
      expect(data.accessToken).toBeDefined();
    });

    it("should authenticate with Access Token on realm endpoints", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        `/api/realm/${realm}`
      );

      expect(response.status).toBe(200);
    });

    it("should enforce permission constraints on child delegate", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const childDelegate = await ctx.helpers.createDelegateToken(token, realm, {
        name: "Limited Child",
        canUpload: false,
        canManageDepot: false,
      });

      const response = await ctx.helpers.accessRequest(
        childDelegate.accessToken,
        "POST",
        `/api/realm/${realm}/delegates`,
        {
          name: "Escalating Grandchild",
          canUpload: true,
        }
      );

      expect(response.status).toBe(400);
    });
  });

  describe("Token Hierarchy", () => {
    it("should allow User JWT to access realm (auto-creates root delegate)", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // JWT request should auto-create root delegate and succeed
      const response = await ctx.helpers.accessRequest(token, "GET", `/api/realm/${realm}/usage`);

      expect(response.status).toBe(200);
    });

    it("should allow JWT to create child delegate (root auto-created)", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Root delegate is auto-created by middleware on first JWT request.
      // JWT is accepted on realm endpoints via unified middleware
      const response = await ctx.helpers.accessRequest(
        token,
        "POST",
        `/api/realm/${realm}/delegates`,
        {
          name: "Child Delegate",
          canUpload: true,
          canManageDepot: false,
        }
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.delegate.delegateId).toBeDefined();
      expect(data.accessToken).toBeDefined();
    });

    it("should NOT allow Access Token to call admin endpoints directly", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      // Access tokens can't access admin endpoints
      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "GET",
        "/api/admin/users"
      );

      expect([401, 403]).toContain(response.status);
    });
  });

  describe("Invalid Credentials", () => {
    it("should reject invalid JWT", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/usage`, {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid.jwt.token",
        },
      });

      expect(response.status).toBe(401);
    });

    it("should reject expired tokens", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/usage`, {
        method: "GET",
        headers: {
          Authorization:
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid",
        },
      });

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // JWT on Realm Endpoints (access-token-auth middleware)
  // ==========================================================================

  describe("JWT on Realm Endpoints", () => {
    it("should reject JWT for unauthorized user on realm endpoint", async () => {
      const userId = uniqueId();
      const {
        token,
        userId: userIdBase32,
        realm,
      } = await ctx.helpers.createTestUser(userId, "authorized");

      // Make a request first to auto-create root delegate
      await ctx.helpers.accessRequest(token, "GET", `/api/realm/${realm}/usage`);

      // Then revoke authorization
      await ctx.db.userRolesDb.setRole(userIdBase32, "unauthorized");

      // Attempt to access realm endpoint with JWT
      const response = await ctx.helpers.accessRequest(token, "GET", `/api/realm/${realm}/usage`);

      expect(response.status).toBe(403);
      const body = (await response.json()) as any;
      expect(body.error).toBe("FORBIDDEN");
    });

    it("should auto-create root delegate on first JWT realm access", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // First JWT request — root delegate should be auto-created
      const response = await ctx.helpers.accessRequest(token, "GET", `/api/realm/${realm}/usage`);

      expect(response.status).toBe(200);
    });

    it("should reject JWT when root delegate is revoked", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Auto-create root delegate via first request, get its ID from DB
      await ctx.helpers.accessRequest(token, "GET", `/api/realm/${realm}/usage`);

      // Revoke the root delegate directly in DB
      const rootDelegate = await ctx.db.delegatesDb.getRootByRealm(realm);
      if (rootDelegate) {
        await ctx.db.delegatesDb.revoke(rootDelegate.delegateId, "test");
      }

      const response = await ctx.helpers.accessRequest(token, "GET", `/api/realm/${realm}/usage`);

      expect(response.status).toBe(401);
      const body = (await response.json()) as any;
      expect(body.error).toBe("DELEGATE_REVOKED");
    });

    it("should reject invalid JWT on realm endpoint", async () => {
      const response = await ctx.helpers.accessRequest(
        "invalid.jwt.token",
        "GET",
        "/api/realm/usr_test/usage"
      );

      expect(response.status).toBe(401);
    });

    it("should accept valid JWT on realm endpoint", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.accessRequest(token, "GET", `/api/realm/${realm}/usage`);

      expect(response.status).toBe(200);
    });
  });
});
