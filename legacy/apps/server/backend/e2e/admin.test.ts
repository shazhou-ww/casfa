/**
 * E2E Tests: Admin API
 *
 * Tests for admin user management endpoints:
 * - GET /api/admin/users
 * - PATCH /api/admin/users/:userId
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Admin API", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("GET /api/admin/users", () => {
    it("should list all users for admin", async () => {
      const adminId = uniqueId();
      const { token } = await ctx.helpers.createTestUser(adminId, "admin");

      const response = await ctx.helpers.authRequest(token, "GET", "/api/admin/users");

      expect(response.status).toBe(200);
      const data = (await response.json()) as any as { users: unknown[] };
      expect(data.users).toBeInstanceOf(Array);
    });

    it("should reject non-admin users", async () => {
      const userId = uniqueId();
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.authRequest(token, "GET", "/api/admin/users");

      expect(response.status).toBe(403);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/admin/users`);
      expect(response.status).toBe(401);
    });
  });

  describe("PATCH /api/admin/users/:userId", () => {
    it("should update user role", async () => {
      const adminId = uniqueId();
      const userId = uniqueId();
      const { token: adminToken } = await ctx.helpers.createTestUser(adminId, "admin");
      await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.authRequest(
        adminToken,
        "PATCH",
        `/api/admin/users/${userId}`,
        { role: "admin" }
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any as { role: string };
      expect(data.role).toBe("admin");
    });

    it("should reject non-admin users", async () => {
      const userId1 = uniqueId();
      const userId2 = uniqueId();
      const { token } = await ctx.helpers.createTestUser(userId1, "authorized");
      await ctx.helpers.createTestUser(userId2, "authorized");

      const response = await ctx.helpers.authRequest(
        token,
        "PATCH",
        `/api/admin/users/${userId2}`,
        { role: "admin" }
      );

      expect(response.status).toBe(403);
    });

    it("should reject invalid role value", async () => {
      const adminId = uniqueId();
      const userId = uniqueId();
      const { token: adminToken } = await ctx.helpers.createTestUser(adminId, "admin");
      await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.authRequest(
        adminToken,
        "PATCH",
        `/api/admin/users/${userId}`,
        { role: "superuser" } // Invalid role
      );

      expect(response.status).toBe(400);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/admin/users/test`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      });

      expect(response.status).toBe(401);
    });
  });
});
