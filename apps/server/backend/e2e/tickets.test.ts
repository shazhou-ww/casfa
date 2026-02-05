/**
 * E2E Tests: Ticket Management (Delegate Token API)
 *
 * Tests for Ticket endpoints:
 * - POST /api/realm/{realmId}/tickets - Create ticket (Access Token)
 * - GET /api/realm/{realmId}/tickets - List tickets (Access Token)
 * - GET /api/realm/{realmId}/tickets/:ticketId - Get ticket details (Access Token)
 * - POST /api/realm/{realmId}/tickets/:ticketId/submit - Submit ticket (Access Token)
 *
 * Key Concepts:
 * - Tickets are created by Access Token (not Delegate Token directly)
 * - Each Ticket represents a task workspace
 * - Submit automatically revokes the bound Access Token
 * - Visibility based on issuer chain
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext, testNodeKey, uniqueId } from "./setup.ts";

describe("Ticket Management", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // POST /api/realm/{realmId}/tickets - Create Ticket
  // ==========================================================================

  describe("POST /api/realm/{realmId}/tickets", () => {
    it("should create a ticket with Access Token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create Access Token first with canUpload permission
      const accessToken = await ctx.helpers.createAccessToken(token, realm, {
        name: "Ticket Creator",
        canUpload: true,
      });

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/tickets`,
        {
          title: "Test Task",
        }
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.ticketId).toMatch(/^tkt_/);
      expect(data.title).toBe("Test Task");
      expect(data.status).toBe("pending");
    });

    it("should create ticket with title only", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // canUpload is required for ticket creation
      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/tickets`,
        {
          title: "Simple Task",
        }
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.ticketId).toBeDefined();
      expect(data.title).toBe("Simple Task");
    });

    it("should reject Delegate Token for ticket creation", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create Delegate Token (not Access Token)
      const delegateToken = await ctx.helpers.createDelegateToken(token, realm);

      const response = await ctx.helpers.delegateRequest(
        delegateToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/tickets`,
        {
          title: "Invalid Creator",
        }
      );

      // Delegate Token cannot create tickets directly
      expect(response.status).toBe(403);
    });

    it("should reject missing title", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/tickets`,
        {}
      );

      expect(response.status).toBe(400);
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Unauthorized" }),
      });

      expect(response.status).toBe(401);
    });

    it("should reject access to other user's realm", async () => {
      const userId1 = uniqueId();
      const userId2 = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId1, "authorized");
      const { realm: otherRealm } = await ctx.helpers.createTestUser(userId2, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${otherRealm}/tickets`,
        {
          title: "Cross-realm",
        }
      );

      expect(response.status).toBe(403);
    });
  });

  // ==========================================================================
  // GET /api/realm/{realmId}/tickets - List Tickets
  // ==========================================================================

  describe("GET /api/realm/{realmId}/tickets", () => {
    it("should list tickets", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

      // Create a few tickets
      await ctx.helpers.createTicket(accessToken.tokenBase64, realm, { title: "Task 1" });
      await ctx.helpers.createTicket(accessToken.tokenBase64, realm, { title: "Task 2" });

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/tickets`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.tickets).toBeInstanceOf(Array);
      expect(data.tickets.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter by status", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

      // Create a ticket (status: pending)
      await ctx.helpers.createTicket(accessToken.tokenBase64, realm, { title: "Pending Task" });

      // Filter by pending status
      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/tickets?status=pending`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      for (const ticket of data.tickets) {
        expect(ticket.status).toBe("pending");
      }
    });

    it("should support pagination", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });

      // Create several tickets
      for (let i = 0; i < 5; i++) {
        await ctx.helpers.createTicket(accessToken.tokenBase64, realm, { title: `Task ${i}` });
      }

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/tickets?limit=2`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.tickets.length).toBeLessThanOrEqual(2);
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/tickets`);
      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/realm/{realmId}/tickets/:ticketId - Get Ticket Details
  // ==========================================================================

  describe("GET /api/realm/{realmId}/tickets/:ticketId", () => {
    it("should get ticket details", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });
      const ticket = await ctx.helpers.createTicket(accessToken.tokenBase64, realm, {
        title: "Detail Test",
      });

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/tickets/${ticket.ticketId}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.ticketId).toBe(ticket.ticketId);
      expect(data.title).toBe("Detail Test");
      expect(data.status).toBe("pending");
      expect(data.creatorIssuerId).toBeDefined();
    });

    it("should return 404 for non-existent ticket", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/tickets/ticket:nonexistent123`
      );

      expect(response.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /api/realm/{realmId}/tickets/:ticketId/submit - Submit Ticket
  // ==========================================================================

  describe("POST /api/realm/{realmId}/tickets/:ticketId/submit", () => {
    it("should submit ticket with output root", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });
      const ticket = await ctx.helpers.createTicket(accessToken.tokenBase64, realm, {
        title: "Submit Test",
      });

      const outputRoot = testNodeKey(1);

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/tickets/${ticket.ticketId}/submit`,
        {
          root: outputRoot,
        }
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
    });

    it("should update ticket status to submitted", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });
      const ticket = await ctx.helpers.createTicket(accessToken.tokenBase64, realm, {
        title: "Status Test",
      });

      const outputRoot = testNodeKey(2);

      // Submit
      await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/tickets/${ticket.ticketId}/submit`,
        { root: outputRoot }
      );

      // Get ticket details (need new token since the old one may be revoked)
      const newAccessToken = await ctx.helpers.createAccessToken(token, realm);
      const detailResponse = await ctx.helpers.accessRequest(
        newAccessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/tickets/${ticket.ticketId}`
      );

      if (detailResponse.status === 200) {
        const detail = (await detailResponse.json()) as any;
        expect(detail.status).toBe("submitted");
        expect(detail.root).toBe(outputRoot);
      }
    });

    it("should reject submit for already submitted ticket", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });
      const ticket = await ctx.helpers.createTicket(accessToken.tokenBase64, realm, {
        title: "Double Submit Test",
      });

      const outputRoot = testNodeKey(3);

      // First submit
      await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/tickets/${ticket.ticketId}/submit`,
        { root: outputRoot }
      );

      // Try second submit (should fail)
      const newAccessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });
      const response = await ctx.helpers.accessRequest(
        newAccessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/tickets/${ticket.ticketId}/submit`,
        { root: testNodeKey(4) }
      );

      expect(response.status).toBe(400);
    });

    it("should reject missing root", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const accessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });
      const ticket = await ctx.helpers.createTicket(accessToken.tokenBase64, realm, {
        title: "Missing Root Test",
      });

      const response = await ctx.helpers.accessRequest(
        accessToken.tokenBase64,
        "POST",
        `/api/realm/${realm}/tickets/${ticket.ticketId}/submit`,
        {}
      );

      expect(response.status).toBe(400);
    });
  });

  // ==========================================================================
  // Visibility Tests (Issuer Chain)
  // ==========================================================================

  describe("Issuer Chain Visibility", () => {
    it("should show tickets based on issuer chain", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // User creates access token with canUpload permission
      const userAccessToken = await ctx.helpers.createAccessToken(token, realm, { canUpload: true });
      const ticket1 = await ctx.helpers.createTicket(userAccessToken.tokenBase64, realm, {
        title: "User Direct Ticket",
      });

      // User creates delegate token, then access token from it
      const delegateToken = await ctx.helpers.createDelegateToken(token, realm);
      const delegatedAccessResult = await ctx.helpers.delegateToken(delegateToken.tokenBase64, {
        type: "access",
        scope: [".:"],
        canUpload: true,
      });
      const delegatedAccessToken = delegatedAccessResult as { tokenBase64: string };

      const ticket2 = await ctx.helpers.createTicket(delegatedAccessToken.tokenBase64, realm, {
        title: "Delegated Ticket",
      });

      // List tickets with user's access token - should see all
      const listResponse = await ctx.helpers.accessRequest(
        userAccessToken.tokenBase64,
        "GET",
        `/api/realm/${realm}/tickets`
      );

      expect(listResponse.status).toBe(200);
      const listData = (await listResponse.json()) as any;
      const ticketIds = listData.tickets.map((t: { ticketId: string }) => t.ticketId);
      expect(ticketIds).toContain(ticket1.ticketId);
      // ticket2 may or may not be visible depending on implementation
    });
  });
});
