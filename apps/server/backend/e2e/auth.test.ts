/**
 * E2E Tests: Authentication
 *
 * Tests authentication and authorization using different credential types:
 * - User JWT (Bearer token)
 * - Delegate Token
 * - Access Token
 *
 * These tests verify the three-tier token hierarchy and role-based access control.
 *
 * Auth Flow:
 * - User JWT can call /api/tokens to create Delegate or Access Token
 * - Delegate Token can call /api/tokens/delegate to create child tokens
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

      // Realm endpoints require Access Token
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(200);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = uniqueId();
      const userId2 = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId1);
      // Get the realm for userId2 (without creating an account)
      const { realm: otherRealm } = await ctx.helpers.createTestUser(userId2);

      // Create access token scoped to user1's realm
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      // Try to access another user's realm with user1's access token
      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
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

      // Realm endpoints require Access Token
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(200);
    });

    it("should allow admin users to access admin endpoints", async () => {
      const userId = uniqueId();
      const { token } = await ctx.helpers.createTestUser(userId, "admin");

      // Admin endpoints use jwtAuthMiddleware, so User JWT works
      const response = await ctx.helpers.authRequest(
        token,
        "GET",
        "/api/admin/users"
      );

      expect(response.status).toBe(200);
    });

    it("should reject non-admin users from admin endpoints", async () => {
      const userId = uniqueId();
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      // Admin endpoints use jwtAuthMiddleware, so User JWT works
      const response = await ctx.helpers.authRequest(
        token,
        "GET",
        "/api/admin/users"
      );

      expect(response.status).toBe(403);
    });

    it("should reject unauthorized users from most endpoints", async () => {
      const userId = uniqueId();
      const { token, userId: userIdBase32, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // Set user to unauthorized role using user:base32 format
      await ctx.db.userRolesDb.setRole(userIdBase32, "unauthorized");

      // Try to create a token - unauthorized users should be rejected
      const response = await ctx.helpers.authRequest(
        token,
        "POST",
        "/api/tokens",
        {
          realm,
          name: "Test Token",
          type: "delegate",
          scope: [`cas://depot:${mainDepotId}`],
        }
      );

      // Service may return 401 or 403 for unauthorized role
      expect([401, 403]).toContain(response.status);
    });
  });

  describe("Token Types", () => {
    it("should authenticate with User JWT on /api/tokens", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // User JWT can access /api/tokens (uses jwtAuthMiddleware)
      const response = await ctx.helpers.authRequest(
        token,
        "POST",
        "/api/tokens",
        {
          realm,
          name: "Test Token",
          type: "delegate",
          scope: [`cas://depot:${mainDepotId}`],
        }
      );

      expect(response.status).toBe(201);
    });

    it("should authenticate with Delegate Token on /api/tokens/delegate", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create delegate token using user JWT
      const delegateToken = await ctx.helpers.createDelegateToken(token, realm, {
        name: "Test Delegate Token",
      });

      // Use delegate token to create child token via /api/tokens/delegate
      const response = await ctx.helpers.delegateRequest(
        delegateToken.tokenBase64,
        "POST",
        "/api/tokens/delegate",
        {
          type: "access",
          scope: [".:"],
        }
      );

      expect(response.status).toBe(201);
    });

    it("should authenticate with Access Token on realm endpoints", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create access token from user JWT
      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        name: "Test Access Token",
      });

      // Use access token to access realm (note: endpoint is /:realmId, not /:realmId/info)
      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}`
      );

      expect(response.status).toBe(200);
    });

    it("should enforce scope constraints on Delegate Token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create delegate token with limited scope (canUpload: false)
      const delegateToken = await ctx.helpers.createDelegateToken(token, realm, {
        name: "Limited Delegate Token",
        canUpload: false,
        canManageDepot: false,
      });

      // Try to delegate with canUpload: true (exceeds parent permissions)
      const response = await ctx.helpers.delegateRequest(
        delegateToken.tokenBase64,
        "POST",
        "/api/tokens/delegate",
        {
          type: "access",
          canUpload: true, // Exceeds parent
          scope: [".:"],
        }
      );

      // Should be rejected - cannot exceed parent permissions
      expect(response.status).toBe(400);
    });
  });

  describe("Token Hierarchy", () => {
    it("should allow User JWT to create Delegate Token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.authRequest(
        token,
        "POST",
        "/api/tokens",
        {
          realm,
          name: "Test Token",
          type: "delegate",
          scope: [`cas://depot:${mainDepotId}`],
        }
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as { tokenId: string; tokenBase64: string };
      expect(data.tokenId).toMatch(/^dlt1_/);
      expect(data.tokenBase64).toBeDefined();
    });

    it("should allow Delegate Token to create Access Token", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const delegateToken = await ctx.helpers.createDelegateToken(token, realm);

      const response = await ctx.helpers.delegateRequest(
        delegateToken.tokenBase64,
        "POST",
        "/api/tokens/delegate",
        {
          type: "access",
          scope: [".:"],
        }
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as { tokenId: string; tokenBase64: string };
      expect(data.tokenId).toMatch(/^dlt1_/);
      expect(data.tokenBase64).toBeDefined();
    });

    it("should allow Delegate Token to create child Delegate Token", async () => {
      const userId = uniqueId();
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const delegateToken = await ctx.helpers.createDelegateToken(token, realm);

      // Delegate tokens CAN create child delegate tokens via /api/tokens/delegate
      const response = await ctx.helpers.delegateRequest(
        delegateToken.tokenBase64,
        "POST",
        "/api/tokens/delegate",
        {
          type: "delegate",
          scope: [".:"],
        }
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as { tokenId: string; tokenBase64: string };
      expect(data.tokenId).toMatch(/^dlt1_/);
      expect(data.tokenBase64).toBeDefined();
    });

    it("should NOT allow Delegate Token to call /api/tokens directly", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");
      const delegateToken = await ctx.helpers.createDelegateToken(token, realm);

      // /api/tokens uses jwtAuthMiddleware - delegate tokens cannot call it directly
      const response = await ctx.helpers.delegateRequest(
        delegateToken.tokenBase64,
        "POST",
        "/api/tokens",
        {
          realm,
          name: "Invalid Token",
          type: "delegate",
          scope: [`cas://depot:${mainDepotId}`],
        }
      );

      // Should be rejected - /api/tokens requires User JWT
      expect([401, 403]).toContain(response.status);
    });

    it("should NOT allow Access Token to create tokens", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      // Try to create delegate token using access token on /api/tokens
      const response1 = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        "/api/tokens",
        {
          realm,
          name: "Invalid Token",
          type: "delegate",
          scope: [`cas://depot:${mainDepotId}`],
        }
      );

      expect([401, 403]).toContain(response1.status);

      // Try to delegate via /api/tokens/delegate - Access Tokens cannot delegate
      const response2 = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        "/api/tokens/delegate",
        {
          type: "access",
          scope: [".:"],
        }
      );

      expect([401, 403]).toContain(response2.status);
    });
  });

  describe("Invalid Credentials", () => {
    it("should reject invalid JWT", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/tokens`, {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid.jwt.token",
        },
      });

      expect(response.status).toBe(401);
    });

    it("should reject malformed Delegate Token", async () => {
      const response = await ctx.helpers.delegateRequest(
        "invalid-delegate-token",
        "POST",
        "/api/tokens/delegate",
        {
          type: "access",
          scope: [".:"],
        }
      );

      expect(response.status).toBe(401);
    });

    it("should reject expired tokens", async () => {
      // This test would require creating a token with a past expiration
      // For now, we just verify the endpoint exists and returns proper errors
      const response = await fetch(`${ctx.baseUrl}/api/tokens`, {
        method: "GET",
        headers: {
          Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid",
        },
      });

      expect(response.status).toBe(401);
    });
  });
});

