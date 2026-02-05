/**
 * E2E Tests: Client Authorization (Device Flow)
 *
 * Tests for Client Authorization endpoints:
 * - POST /api/tokens/requests - Create auth request
 * - GET /api/tokens/requests/:requestId/poll - Poll status
 * - GET /api/tokens/requests/:requestId - Get request details (User)
 * - POST /api/tokens/requests/:requestId/approve - Approve request (User)
 * - POST /api/tokens/requests/:requestId/reject - Reject request (User)
 *
 * Flow:
 * 1. Client generates clientSecret locally
 * 2. Client creates request via POST /api/tokens/requests
 * 3. User opens authorizeUrl, reviews, and approves/rejects
 * 4. Client polls for status and receives encrypted token
 * 5. Client decrypts token with clientSecret
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

/** Generate a valid clientSecretHash for testing */
const generateClientSecretHash = async () => {
  const clientSecret = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
  const encoder = new TextEncoder();
  const data = encoder.encode(clientSecret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const clientSecretHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { clientSecret, clientSecretHash };
};

describe("Client Authorization", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // POST /api/tokens/requests - Create Auth Request
  // ==========================================================================

  describe("POST /api/tokens/requests", () => {
    it("should create an auth request", async () => {
      const { clientSecretHash } = await generateClientSecretHash();
      const response = await fetch(`${ctx.baseUrl}/api/tokens/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: "Test IDE",
          description: "AI coding assistant",
          clientSecretHash,
        }),
      });

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.requestId).toMatch(/^req_/);
      expect(data.displayCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(data.authorizeUrl).toBeDefined();
      expect(data.expiresAt).toBeGreaterThan(Date.now());
      expect(data.pollInterval).toBeGreaterThan(0);
    });

    it("should create request with minimal info", async () => {
      const { clientSecretHash } = await generateClientSecretHash();
      const response = await fetch(`${ctx.baseUrl}/api/tokens/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: "Minimal Client",
          clientSecretHash,
        }),
      });

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.requestId).toMatch(/^req_/);
    });

    it("should reject missing clientName", async () => {
      const { clientSecretHash } = await generateClientSecretHash();
      const response = await fetch(`${ctx.baseUrl}/api/tokens/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientSecretHash }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject empty clientName", async () => {
      const { clientSecretHash } = await generateClientSecretHash();
      const response = await fetch(`${ctx.baseUrl}/api/tokens/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: "", clientSecretHash }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject clientName exceeding max length", async () => {
      const { clientSecretHash } = await generateClientSecretHash();
      const response = await fetch(`${ctx.baseUrl}/api/tokens/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: "A".repeat(100), clientSecretHash }), // > 64 chars
      });

      expect(response.status).toBe(400);
    });
  });

  // ==========================================================================
  // GET /api/tokens/requests/:requestId/poll - Poll Status
  // ==========================================================================

  describe("GET /api/tokens/requests/:requestId/poll", () => {
    it("should return pending status for new request", async () => {
      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Poll Test" });

      const response = await fetch(`${ctx.baseUrl}/api/tokens/requests/${request.requestId}/poll`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.status).toBe("pending");
    });

    it("should return 404 for non-existent request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/tokens/requests/req_nonexistent/poll`);

      expect(response.status).toBe(404);
    });
  });

  // ==========================================================================
  // GET /api/tokens/requests/:requestId - Get Request Details
  // ==========================================================================

  describe("GET /api/tokens/requests/:requestId", () => {
    it("should return request details for authenticated user", async () => {
      const userId = uniqueId();
      const { token, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Detail Test" });

      const response = await ctx.helpers.authRequest(
        token,
        "GET",
        `/api/tokens/requests/${request.requestId}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.requestId).toBe(request.requestId);
      expect(data.clientName).toBe("Detail Test");
      expect(data.displayCode).toBe(request.displayCode);
      expect(data.status).toBe("pending");
    });

    it("should reject unauthenticated request", async () => {
      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Auth Test" });

      const response = await fetch(
        `${ctx.baseUrl}/api/tokens/requests/${request.requestId}`
      );

      expect(response.status).toBe(401);
    });

    it("should return 404 for non-existent request", async () => {
      const userId = uniqueId();
      const { token, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await ctx.helpers.authRequest(
        token,
        "GET",
        "/api/tokens/requests/req_nonexistent"
      );

      expect(response.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /api/tokens/requests/:requestId/approve - Approve Request
  // ==========================================================================

  describe("POST /api/tokens/requests/:requestId/approve", () => {
    it("should approve request and return encrypted token", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Approve Test" });

      const response = await ctx.helpers.authRequest(
        token,
        "POST",
        `/api/tokens/requests/${request.requestId}/approve`,
        {
          realm,
          type: "delegate",
          name: "Approved Token",
          expiresIn: 3600,
          canUpload: true,
          canManageDepot: false,
          scope: [`cas://depot:${mainDepotId}`],
          clientSecret: request.clientSecret,
        }
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.encryptedToken).toBeDefined();
    });

    it("should reject missing required fields", async () => {
      const userId = uniqueId();
      const { token, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Missing Fields" });

      // Missing realm
      const response = await ctx.helpers.authRequest(
        token,
        "POST",
        `/api/tokens/requests/${request.requestId}/approve`,
        {
          type: "delegate",
          name: "Test",
          scope: [`cas://depot:${mainDepotId}`],
          clientSecret: request.clientSecret,
        }
      );

      expect(response.status).toBe(400);
    });

    it("should reject unauthenticated request", async () => {
      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Unauth Test" });

      const response = await fetch(
        `${ctx.baseUrl}/api/tokens/requests/${request.requestId}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            realm: "usr_test",
            type: "delegate",
            name: "Test",
            scope: ["cas://depot:AAAAAAAAAAAAAAAAAAAAAAAAAA"], // Fake depot ID for unauthenticated test
            clientSecret: request.clientSecret,
          }),
        }
      );

      expect(response.status).toBe(401);
    });

    it("should update poll status to approved", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Poll Status Test" });

      // Approve
      await ctx.helpers.authRequest(
        token,
        "POST",
        `/api/tokens/requests/${request.requestId}/approve`,
        {
          realm,
          type: "delegate",
          name: "Approved",
          scope: [`cas://depot:${mainDepotId}`],
          clientSecret: request.clientSecret,
        }
      );

      // Poll should show approved
      const pollResponse = await fetch(
        `${ctx.baseUrl}/api/tokens/requests/${request.requestId}/poll`
      );

      expect(pollResponse.status).toBe(200);
      const pollData = (await pollResponse.json()) as any;
      expect(pollData.status).toBe("approved");
      expect(pollData.encryptedToken).toBeDefined();
    });
  });

  // ==========================================================================
  // POST /api/tokens/requests/:requestId/reject - Reject Request
  // ==========================================================================

  describe("POST /api/tokens/requests/:requestId/reject", () => {
    it("should reject request", async () => {
      const userId = uniqueId();
      const { token, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Reject Test" });

      const response = await ctx.helpers.authRequest(
        token,
        "POST",
        `/api/tokens/requests/${request.requestId}/reject`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
    });

    it("should update poll status to rejected", async () => {
      const userId = uniqueId();
      const { token, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Reject Poll Test" });

      // Reject
      await ctx.helpers.authRequest(
        token,
        "POST",
        `/api/tokens/requests/${request.requestId}/reject`
      );

      // Poll should show rejected
      const pollResponse = await fetch(
        `${ctx.baseUrl}/api/tokens/requests/${request.requestId}/poll`
      );

      expect(pollResponse.status).toBe(200);
      const pollData = (await pollResponse.json()) as any;
      expect(pollData.status).toBe("rejected");
    });

    it("should reject unauthenticated request", async () => {
      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Unauth Reject" });

      const response = await fetch(
        `${ctx.baseUrl}/api/tokens/requests/${request.requestId}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(401);
    });

    it("should not allow approving after rejection", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      const request = await ctx.helpers.createClientAuthRequest({ clientName: "Already Rejected" });

      // Reject first
      await ctx.helpers.authRequest(
        token,
        "POST",
        `/api/tokens/requests/${request.requestId}/reject`
      );

      // Try to approve
      const response = await ctx.helpers.authRequest(
        token,
        "POST",
        `/api/tokens/requests/${request.requestId}/approve`,
        {
          realm,
          type: "delegate",
          name: "Too Late",
          scope: [`cas://depot:${mainDepotId}`],
          clientSecret: request.clientSecret,
        }
      );

      expect(response.status).toBe(400);
    });
  });

  // ==========================================================================
  // Expiration Tests
  // ==========================================================================

  describe("Request Expiration", () => {
    it("should reject approval of expired request", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");

      // Create a request that's already expired by directly using the db
      const requestId = `req_${Date.now().toString(36)}`;
      const clientSecret = Array.from({ length: 32 }, () => 
        Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
      ).join("");
      
      // Hash the client secret
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(clientSecret));
      const clientSecretHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Create request directly in db with negative expiresIn (already expired)
      await ctx.db.tokenRequestsDb.create({
        requestId,
        clientName: "Expired Test Client",
        clientSecretHash,
        displayCode: "TEST-CODE",
        expiresIn: -60, // Expired 1 minute ago
      });

      // Try to approve the expired request
      const response = await ctx.helpers.authRequest(
        token,
        "POST",
        `/api/tokens/requests/${requestId}/approve`,
        {
          realm,
          type: "delegate",
          name: "Too Late Token",
          expiresIn: 3600,
          canUpload: false,
          canManageDepot: false,
          scope: [`cas://depot:${mainDepotId}`],
          clientSecret,
        }
      );

      // Should fail with 400 REQUEST_EXPIRED
      expect(response.status).toBe(400);
      const data = (await response.json()) as any;
      expect(data.error).toBe("REQUEST_EXPIRED");
    });

    it("should reject polling of expired request", async () => {
      // Create an expired request directly in db
      const requestId = `req_${Date.now().toString(36)}_poll`;
      const clientSecretHash = "a".repeat(64);

      await ctx.db.tokenRequestsDb.create({
        requestId,
        clientName: "Expired Poll Test",
        clientSecretHash,
        displayCode: "POLL-TEST",
        expiresIn: -60, // Expired
      });

      // Poll should return expired status
      const response = await fetch(
        `${ctx.baseUrl}/api/tokens/requests/${requestId}/poll`
      );
      
      // Could be 200 with status: "expired" or a 400/410 error
      // Depends on implementation - let's check the actual behavior
      if (response.status === 200) {
        const data = (await response.json()) as any;
        expect(data.status).toBe("expired");
      } else {
        expect([400, 410]).toContain(response.status);
      }
    });

    it("should not allow approval of non-existent request", async () => {
      const userId = uniqueId();
      const { token, realm, mainDepotId } = await ctx.helpers.createTestUser(userId, "authorized");
      const { clientSecret } = await generateClientSecretHash();

      const response = await ctx.helpers.authRequest(
        token,
        "POST",
        "/api/tokens/requests/req_expired_or_nonexistent/approve",
        {
          realm,
          type: "delegate",
          name: "Too Late",
          scope: [`cas://depot:${mainDepotId}`],
          clientSecret,
        }
      );

      expect(response.status).toBe(404);
    });
  });
});
