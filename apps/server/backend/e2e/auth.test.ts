/**
 * E2E Tests: Authentication
 *
 * Tests authentication and authorization using different credential types:
 * - User JWT (Bearer token)
 * - Access Token (from Delegate model)
 *
 * Auth Flow:
 * - User JWT can call POST /api/tokens/root to create Root Delegate + AT
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

    it("should reject unauthorized users from root token creation", async () => {
      const userId = uniqueId();
      const {
        token,
        userId: userIdBase32,
        realm,
      } = await ctx.helpers.createTestUser(userId, "authorized");

      await ctx.db.userRolesDb.setRole(userIdBase32, "unauthorized");

      const response = await ctx.helpers.authRequest(token, "POST", "/api/tokens/root", {
        realm,
      });

      expect([401, 403]).toContain(response.status);
    });
  });

  describe("Token Types", () => {
    it("should authenticate with User JWT on /api/tokens/root", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.authRequest(token, "POST", "/api/tokens/root", {
        realm,
      });

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.delegate).toBeDefined();
      expect(data.delegate.delegateId).toBeDefined();
      // Root tokens no longer return AT/RT — root uses JWT auth directly
      expect(data.accessToken).toBeUndefined();
      expect(data.refreshToken).toBeUndefined();
    });

    it("should authenticate with JWT to create child delegate", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Ensure root delegate exists
      await ctx.helpers.createRootToken(token, realm);

      // Use JWT directly on realm endpoint (middleware supports both JWT and AT)
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
    it("should allow User JWT to create root delegate", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.authRequest(token, "POST", "/api/tokens/root", {
        realm,
      });

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.delegate.delegateId).toBeDefined();
      // Root delegates no longer return AT/RT
      expect(data.accessToken).toBeUndefined();
      expect(data.refreshToken).toBeUndefined();
    });

    it("should allow JWT to create child delegate (via root)", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      await ctx.helpers.createRootToken(token, realm);

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

    it("should NOT allow Access Token to call /api/tokens/root directly", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.accessToken,
        "POST",
        "/api/tokens/root",
        { realm }
      );

      expect([401, 403]).toContain(response.status);
    });
  });

  describe("Invalid Credentials", () => {
    it("should reject invalid JWT", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/tokens/root`, {
        method: "POST",
        headers: {
          Authorization: "Bearer invalid.jwt.token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ realm: "test" }),
      });

      expect(response.status).toBe(401);
    });

    it("should reject expired tokens", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/tokens/root`, {
        method: "POST",
        headers: {
          Authorization:
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ realm: "test" }),
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

      // Create root delegate first so it exists
      await ctx.helpers.createRootToken(token, realm);

      // Then revoke authorization
      await ctx.db.userRolesDb.setRole(userIdBase32, "unauthorized");

      // Attempt to access realm endpoint with JWT
      const response = await ctx.helpers.accessRequest(
        token,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(403);
      const body = (await response.json()) as any;
      expect(body.error).toBe("FORBIDDEN");
    });

    it("should reject JWT when root delegate does not exist", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Do NOT call createRootToken — root delegate doesn't exist
      const response = await ctx.helpers.accessRequest(
        token,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(401);
      const body = (await response.json()) as any;
      expect(body.error).toBe("ROOT_DELEGATE_NOT_FOUND");
    });

    it("should reject JWT when root delegate is revoked", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create root delegate then revoke it
      const rootResult = await ctx.helpers.createRootToken(token, realm);
      await ctx.db.delegatesDb.revoke(rootResult.delegate.delegateId, "test");

      const response = await ctx.helpers.accessRequest(
        token,
        "GET",
        `/api/realm/${realm}/usage`
      );

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

    it("should accept valid JWT on realm endpoint when root delegate exists", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      await ctx.helpers.createRootToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        token,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(200);
    });
  });
});
