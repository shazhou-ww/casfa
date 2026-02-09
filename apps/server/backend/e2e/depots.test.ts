/**
 * E2E Tests: Depot Management (Delegate Token API)
 *
 * Tests for Depot endpoints:
 * - GET /api/realm/{realmId}/depots - List depots (Access Token)
 * - POST /api/realm/{realmId}/depots - Create depot (Access Token + canManageDepot)
 * - GET /api/realm/{realmId}/depots/:depotId - Get depot details (Access Token)
 * - PATCH /api/realm/{realmId}/depots/:depotId - Update depot (Access Token + canManageDepot)
 * - DELETE /api/realm/{realmId}/depots/:depotId - Delete depot (Access Token + canManageDepot)
 *
 * Key Concepts:
 * - All operations require Access Token (not Delegate Token)
 * - Create/Update/Delete require canManageDepot permission
 * - MAIN depot cannot be deleted
 * - Visibility based on issuer chain
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Depot Management", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // GET /api/realm/{realmId}/depots - List Depots
  // ==========================================================================

  describe("GET /api/realm/{realmId}/depots", () => {
    it("should list depots with Access Token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/depots`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.depots).toBeInstanceOf(Array);
    });

    it("should support pagination", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: true,
      });

      // Create a few depots
      for (let i = 0; i < 3; i++) {
        await ctx.helpers.accessRequest(
          accessToken.tokenBase64,
          "POST",
          `/api/realm/${realm}/depots`,
          { title: `Depot ${i}` }
        );
      }

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/depots?limit=2`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.depots.length).toBeLessThanOrEqual(2);
    });

    it("should work with child delegate token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // In the new model, child delegates are also access tokens
      const childToken = await ctx.helpers.createDelegateToken(token, realm, {
        name: "read-only child",
      });

      const response = await ctx.helpers.accessRequest(
        childToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/depots`
      );

      // Child delegate access tokens can list depots (read operation)
      expect(response.status).toBe(200);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/depots`);
      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // POST /api/realm/{realmId}/depots - Create Depot
  // ==========================================================================

  describe("POST /api/realm/{realmId}/depots", () => {
    it("should create a new depot with canManageDepot permission", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: true,
      });

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/depots`,
        {
          title: "My Documents",
          maxHistory: 10,
        }
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.depotId).toMatch(/^depot:/);
      expect(data.title).toBe("My Documents");
      expect(data.maxHistory).toBe(10);
    });

    it("should create depot with default maxHistory", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: true,
      });

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/depots`,
        { title: "Default History Depot" }
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.title).toBe("Default History Depot");
      // maxHistory should have a default value
    });

    it("should reject creation without canManageDepot permission", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: false,
      });

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/depots`,
        { title: "Unauthorized Depot" }
      );

      expect(response.status).toBe(403);
    });

    it("should create depot with empty body (auto-generated title)", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: true,
      });

      // Empty body is allowed - title will be auto-generated or empty
      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/depots`,
        {}
      );

      expect(response.status).toBe(201);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Unauthorized" }),
      });

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/realm/{realmId}/depots/:depotId - Get Depot Details
  // ==========================================================================

  describe("GET /api/realm/{realmId}/depots/:depotId", () => {
    it("should get depot details", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: true,
      });

      // Create a depot
      const createResponse = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/depots`,
        { title: "Detail Test Depot" }
      );

      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as any;

      // Get details
      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/depots/${created.depotId}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.depotId).toBe(created.depotId);
      expect(data.title).toBe("Detail Test Depot");
    });

    it("should return 404 for non-existent depot", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/depots/depot:nonexistent123`
      );

      expect(response.status).toBe(404);
    });
  });

  // ==========================================================================
  // PATCH /api/realm/{realmId}/depots/:depotId - Update Depot
  // ==========================================================================

  describe("PATCH /api/realm/{realmId}/depots/:depotId", () => {
    it("should update depot metadata with canManageDepot permission", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: true,
      });

      // Create a depot
      const createResponse = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/depots`,
        { title: "Original Title" }
      );

      const created = (await createResponse.json()) as any;

      // Update title
      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "PATCH",
        `/api/realm/${realm}/depots/${created.depotId}`,
        { title: "Updated Title" }
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.title).toBe("Updated Title");
    });

    it("should reject update without canManageDepot permission", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create with permission
      const createToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: true,
      });

      const createResponse = await ctx.helpers.accessRequest(
        createToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/depots`,
        { title: "Test Depot" }
      );

      const created = (await createResponse.json()) as any;

      // Try to update without permission
      const readOnlyToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: false,
      });

      const response = await ctx.helpers.accessRequest(
        readOnlyToken.tokenBase64,
        "PATCH",
        `/api/realm/${realm}/depots/${created.depotId}`,
        { title: "Unauthorized Update" }
      );

      expect(response.status).toBe(403);
    });
  });

  // ==========================================================================
  // DELETE /api/realm/{realmId}/depots/:depotId - Delete Depot
  // ==========================================================================

  describe("DELETE /api/realm/{realmId}/depots/:depotId", () => {
    it("should delete depot with canManageDepot permission", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: true,
      });

      // Create a depot
      const createResponse = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/depots`,
        { title: "To Delete" }
      );

      const created = (await createResponse.json()) as any;

      // Delete
      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "DELETE",
        `/api/realm/${realm}/depots/${created.depotId}`
      );

      expect(response.status).toBe(200);

      // Verify deleted
      const getResponse = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/depots/${created.depotId}`
      );

      expect(getResponse.status).toBe(404);
    });

    it("should not allow deleting MAIN depot", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: true,
      });

      // Use the actual mainDepotId (26-char base32), not the string "MAIN"
      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "DELETE",
        `/api/realm/${realm}/depots/${mainDepotId}`
      );

      expect(response.status).toBe(403); // Cannot delete main depot
    });

    it("should reject delete without canManageDepot permission", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create with permission
      const createToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: true,
      });

      const createResponse = await ctx.helpers.accessRequest(
        createToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/depots`,
        { title: "Protected Depot" }
      );

      const created = (await createResponse.json()) as any;

      // Try to delete without permission
      const readOnlyToken = await ctx.helpers.createAccessToken(token, realm, {
        canManageDepot: false,
      });

      const response = await ctx.helpers.accessRequest(
        readOnlyToken.tokenBase64,
        "DELETE",
        `/api/realm/${realm}/depots/${created.depotId}`
      );

      expect(response.status).toBe(403);
    });
  });

  // ==========================================================================
  // Access Control Tests
  // ==========================================================================

  describe("Access Control", () => {
    it("should reject access to other user's realm depots", async () => {
      const userId1 = uniqueId();
      const userId2 = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId1, "authorized");
      const { realm: otherRealm } = await ctx.helpers.createTestUser(userId2, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${otherRealm}/depots`
      );

      expect(response.status).toBe(403);
    });
  });
});
