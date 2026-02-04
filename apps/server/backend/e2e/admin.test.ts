/**
 * E2E Tests: Admin API
 *
 * Tests for admin user management endpoints using casfa-client-v2 SDK:
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
      const adminId = `admin-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(adminId, "admin");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.admin.listUsers();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Server returns { users: [...] }, SDK type expects { items: [...] }
        const data = result.data as any;
        const items = data.items ?? data.users;
        expect(items).toBeInstanceOf(Array);
      }
    });

    it("should reject non-admin users", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.admin.listUsers();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(403);
      }
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/admin/users`);
      expect(response.status).toBe(401);
    });
  });

  describe("PATCH /api/admin/users/:userId", () => {
    it("should update user role to authorized", async () => {
      const adminId = `admin-${uniqueId()}`;
      const targetUserId = `target-${uniqueId()}`;
      const { token: adminToken } = await ctx.helpers.createTestUser(adminId, "admin");
      const userClient = ctx.helpers.getUserClient(adminToken);

      // Create target user as unauthorized first
      await ctx.db.userRolesDb.setRole(targetUserId, "unauthorized");

      const result = await userClient.admin.updateUserRole(`user:${targetUserId}`, {
        role: "authorized",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.role).toBe("authorized");
      }
    });

    it("should update user role to admin", async () => {
      const adminId = `admin-${uniqueId()}`;
      const targetUserId = `target-${uniqueId()}`;
      const { token: adminToken } = await ctx.helpers.createTestUser(adminId, "admin");
      await ctx.helpers.createTestUser(targetUserId, "authorized");
      const userClient = ctx.helpers.getUserClient(adminToken);

      const result = await userClient.admin.updateUserRole(`user:${targetUserId}`, {
        role: "admin",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.role).toBe("admin");
      }
    });

    it("should revoke user access by setting role to unauthorized", async () => {
      const adminId = `admin-${uniqueId()}`;
      const targetUserId = `target-${uniqueId()}`;
      const { token: adminToken } = await ctx.helpers.createTestUser(adminId, "admin");
      await ctx.helpers.createTestUser(targetUserId, "authorized");
      const userClient = ctx.helpers.getUserClient(adminToken);

      const result = await userClient.admin.updateUserRole(`user:${targetUserId}`, {
        role: "unauthorized",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.role).toBe("unauthorized");
      }
    });

    it("should reject invalid role", async () => {
      const adminId = `admin-${uniqueId()}`;
      const targetUserId = `target-${uniqueId()}`;
      const { token: adminToken } = await ctx.helpers.createTestUser(adminId, "admin");

      // Use raw fetch to test invalid role
      const response = await fetch(`${ctx.baseUrl}/api/admin/users/user:${targetUserId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ role: "invalid_role" }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject non-admin users", async () => {
      const userId = `user-${uniqueId()}`;
      const targetUserId = `target-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.admin.updateUserRole(`user:${targetUserId}`, {
        role: "authorized",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(403);
      }
    });
  });
});
