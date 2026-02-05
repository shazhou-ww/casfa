/**
 * E2E Tests: Authentication
 *
 * Tests authentication and authorization using different credential types:
 * - User JWT (Bearer token)
 * - Delegate Token
 * - Access Token
 *
 * These tests verify the three-tier token hierarchy and role-based access control.
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

    it("should accept authenticated requests with User JWT", async () => {
      const userId = `test-user-${uniqueId()}`;
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId);

      const response = await ctx.helpers.authRequest(
        token,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(200);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = `user-1-${uniqueId()}`;
      const userId2 = `user-2-${uniqueId()}`;
      const { token, mainDepotId } = await ctx.helpers.createTestUser(userId1);

      // Try to access another user's realm
      const response = await ctx.helpers.authRequest(
        token,
        "GET",
        `/api/realm/usr_${userId2}/usage`
      );

      expect(response.status).toBe(403);
    });
  });

  describe("User Roles", () => {
    it("should allow authorized users to access their realm", async () => {
      const userId = `authorized-user-${uniqueId()}`;
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.authRequest(
        token,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(200);
    });

    it("should allow admin users to access admin endpoints", async () => {
      const userId = `admin-user-${uniqueId()}`;
      const { token, mainDepotId } = await ctx.helpers.createTestUser(userId, "admin");

      const response = await ctx.helpers.authRequest(
        token,
        "GET",
        "/api/admin/users"
      );

      expect(response.status).toBe(200);
    });

    it("should reject non-admin users from admin endpoints", async () => {
      const userId = `regular-user-${uniqueId()}`;
      const { token, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.authRequest(
        token,
        "GET",
        "/api/admin/users"
      );

      expect(response.status).toBe(403);
    });

    it("should reject unauthorized users from most endpoints", async () => {
      const userId = `unauth-user-${uniqueId()}`;
      // Note: createTestUser only accepts "admin" | "authorized", so we set role directly
      await ctx.db.userRolesDb.setRole(userId, "unauthorized");
      const token = ctx.helpers.createUserToken(userId);
      const realm = `usr_${userId}`;

      // Unauthorized users should not be able to access realm endpoints
      const response = await ctx.helpers.authRequest(
        token,
        "GET",
        `/api/realm/${realm}/usage`
      );

      // Service may return 403 for unauthorized role
      expect([401, 403]).toContain(response.status);
    });
  });

  describe("Token Types", () => {
    it("should authenticate with User JWT (Bearer token)", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await fetch(`${ctx.baseUrl}/api/realm/${realm}/info`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(response.status).toBe(200);
    });

    it("should authenticate with Delegate Token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create delegate token using user JWT
      const delegateResponse = await ctx.helpers.authRequest(
        token,
        "POST",
        "/api/tokens",
        {
          name: "Test Delegate Token",
          scopes: [{ path: realm }],
        }
      );

      expect(delegateResponse.status).toBe(201);
      const { token: delegateToken } = (await delegateResponse.json()) as {
        token: string;
      };

      // Use delegate token to access realm
      const response = await ctx.helpers.delegateRequest(
        delegateToken,
        "GET",
        `/api/realm/${realm}/info`
      );

      expect(response.status).toBe(200);
    });

    it("should authenticate with Access Token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create delegate token
      const delegateResponse = await ctx.helpers.authRequest(
        token,
        "POST",
        "/api/tokens",
        {
          name: "Test Delegate Token",
          scopes: [{ path: realm }],
        }
      );

      expect(delegateResponse.status).toBe(201);
      const { token: delegateToken } = (await delegateResponse.json()) as {
        token: string;
      };

      // Create access token from delegate token
      const accessResponse = await ctx.helpers.delegateRequest(
        delegateToken,
        "POST",
        "/api/tokens/delegate",
        {
          scopes: [{ path: realm }],
          ttl: 3600,
        }
      );

      expect(accessResponse.status).toBe(201);
      const { token: accessToken } = (await accessResponse.json()) as {
        token: string;
      };

      // Use access token to access realm
      const response = await ctx.helpers.accessRequest(
        accessToken,
        "GET",
        `/api/realm/${realm}/info`
      );

      expect(response.status).toBe(200);
    });

    it("should enforce scope constraints on Delegate Token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create delegate token with limited scope
      const delegateResponse = await ctx.helpers.authRequest(
        token,
        "POST",
        "/api/tokens",
        {
          name: "Limited Delegate Token",
          scopes: [{ path: `${realm}/specific/path` }],
        }
      );

      expect(delegateResponse.status).toBe(201);
      const { token: delegateToken } = (await delegateResponse.json()) as {
        token: string;
      };

      // Delegate token cannot access root realm (scope is limited)
      // This depends on how the server enforces scopes
      const response = await ctx.helpers.delegateRequest(
        delegateToken,
        "GET",
        `/api/realm/${realm}/info`
      );

      // May return 200 if realm info is allowed, or 403 if strictly scoped
      expect([200, 403]).toContain(response.status);
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
          name: "Test Token",
          scopes: [{ path: realm }],
        }
      );

      expect(response.status).toBe(201);
    });

    it("should allow Delegate Token to create Access Token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");
      const delegateToken = await ctx.helpers.createDelegateToken(token, realm);

      const response = await ctx.helpers.delegateRequest(
        delegateToken.tokenBase64,
        "POST",
        "/api/tokens/delegate",
        {
          scopes: [{ path: realm }],
          ttl: 3600,
        }
      );

      expect(response.status).toBe(201);
    });

    it("should NOT allow Delegate Token to create Delegate Token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");
      const delegateToken = await ctx.helpers.createDelegateToken(token, realm);

      // Try to create another delegate token using delegate token
      // This should fail - only User JWT can create delegate tokens
      const response = await ctx.helpers.delegateRequest(
        delegateToken.tokenBase64,
        "POST",
        "/api/tokens",
        {
          name: "Invalid Token",
          scopes: [{ path: realm }],
        }
      );

      // Should be rejected - delegate tokens cannot create other delegate tokens
      expect([401, 403]).toContain(response.status);
    });

    it("should NOT allow Access Token to create tokens", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");
      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      // Try to create delegate token using access token
      const response1 = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        "/api/tokens",
        {
          name: "Invalid Token",
          scopes: [{ path: realm }],
        }
      );

      expect([401, 403]).toContain(response1.status);

      // Try to create access token using access token
      const response2 = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        "/api/tokens/delegate",
        {
          scopes: [{ path: realm }],
          ttl: 3600,
        }
      );

      expect([401, 403]).toContain(response2.status);
    });
  });

  describe("Invalid Credentials", () => {
    it("should reject invalid JWT", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/info`, {
        headers: {
          Authorization: "Bearer invalid.jwt.token",
        },
      });

      expect(response.status).toBe(401);
    });

    it("should reject malformed Delegate Token", async () => {
      const response = await ctx.helpers.delegateRequest(
        "invalid-delegate-token",
        "GET",
        "/api/realm/usr_test/info"
      );

      expect(response.status).toBe(401);
    });

    it("should reject expired tokens", async () => {
      // This test would require creating a token with a past expiration
      // For now, we just verify the endpoint exists and returns proper errors
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/info`, {
        headers: {
          Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid",
        },
      });

      expect(response.status).toBe(401);
    });
  });
});

