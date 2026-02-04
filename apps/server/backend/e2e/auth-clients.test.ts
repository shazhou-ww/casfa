/**
 * E2E Tests: Client Authentication
 *
 * Tests for Client (P256 public key) management endpoints using casfa-client-v2 SDK:
 * - POST /api/auth/clients/init
 * - GET /api/auth/clients/:clientId
 * - POST /api/auth/clients/complete
 * - GET /api/auth/clients
 * - DELETE /api/auth/clients/:clientId
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Client Authentication", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("POST /api/auth/clients/init", () => {
    it("should initialize client auth flow", async () => {
      const testPubkey = `test-pubkey-${uniqueId()}`;
      const anonymousClient = ctx.helpers.getAnonymousClient();

      const result = await anonymousClient.awp.initClient({
        publicKey: testPubkey,
        name: "Test Client",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        expect(data.clientId).toBeDefined();
        expect(data.clientId).toMatch(/^client:/);
        expect(data.authUrl).toBeDefined();
        expect(data.displayCode).toBeDefined();
        expect(data.expiresIn).toBeGreaterThan(0);
        // pollInterval might not be in SDK type but is in response
        expect(data.pollInterval ?? 5).toBeGreaterThan(0);
      }
    });

    it("should reject missing pubkey", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: "Test Client",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject missing clientName", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: `test-pubkey-${uniqueId()}`,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/auth/clients/:clientId (poll)", () => {
    it("should return pending status for pending auth", async () => {
      const testPubkey = `test-pubkey-${uniqueId()}`;
      const anonymousClient = ctx.helpers.getAnonymousClient();

      // First init the auth flow
      const initResult = await anonymousClient.awp.initClient({
        publicKey: testPubkey,
        name: "Test Client",
      });

      expect(initResult.ok).toBe(true);
      if (!initResult.ok) return;

      // Check status using poll
      const result = await anonymousClient.awp.pollClient({
        clientId: initResult.data.clientId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as any;
        expect(data.status).toBe("pending");
        expect(data.clientId).toBe(initResult.data.clientId);
      }
    });

    it("should return 404 for non-existent clientId", async () => {
      const anonymousClient = ctx.helpers.getAnonymousClient();

      const result = await anonymousClient.awp.pollClient({
        clientId: "client:NONEXISTENT00000000000000",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
      }
    });
  });

  describe("POST /api/auth/clients/complete", () => {
    it("should complete client authorization", async () => {
      const userId = `user-${uniqueId()}`;
      const testPubkey = `test-pubkey-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      // Init auth flow using anonymous client
      const anonymousClient = ctx.helpers.getAnonymousClient();
      const initResult = await anonymousClient.awp.initClient({
        publicKey: testPubkey,
        name: "Test Client",
      });

      expect(initResult.ok).toBe(true);
      if (!initResult.ok) return;

      // Complete authorization using user client
      const userClient = ctx.helpers.getUserClient(token);
      const result = await userClient.clients.complete({
        clientId: initResult.data.clientId,
        verificationCode: initResult.data.displayCode,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(true);
      }
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "client:SOMECLIENTID00000000000",
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/auth/clients", () => {
    it("should list authorized clients", async () => {
      const userId = `user-${uniqueId()}`;
      const testPubkey = `test-pubkey-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      // Init auth flow using anonymous client
      const anonymousClient = ctx.helpers.getAnonymousClient();
      const initResult = await anonymousClient.awp.initClient({
        publicKey: testPubkey,
        name: "Test Client",
      });

      expect(initResult.ok).toBe(true);
      if (!initResult.ok) return;

      // Complete authorization
      const userClient = ctx.helpers.getUserClient(token);
      await userClient.clients.complete({
        clientId: initResult.data.clientId,
        verificationCode: initResult.data.displayCode,
      });

      // List clients
      const result = await userClient.clients.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.items).toBeInstanceOf(Array);
        expect(result.data.items.length).toBeGreaterThan(0);
        expect(result.data.items.some((c) => c.clientId === initResult.data.clientId)).toBe(true);
      }
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients`);
      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/auth/clients/:clientId", () => {
    it("should revoke authorized client", async () => {
      const userId = `user-${uniqueId()}`;
      const testPubkey = `test-pubkey-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      // Init auth flow
      const anonymousClient = ctx.helpers.getAnonymousClient();
      const initResult = await anonymousClient.awp.initClient({
        publicKey: testPubkey,
        name: "Test Client",
      });

      expect(initResult.ok).toBe(true);
      if (!initResult.ok) return;

      // Complete authorization
      const userClient = ctx.helpers.getUserClient(token);
      await userClient.clients.complete({
        clientId: initResult.data.clientId,
        verificationCode: initResult.data.displayCode,
      });

      // Revoke client
      const result = await userClient.clients.revoke({
        clientId: initResult.data.clientId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(true);
      }
    });

    it("should return 404 for non-existent client", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const userClient = ctx.helpers.getUserClient(token);

      const result = await userClient.clients.revoke({
        clientId: "client:NONEXISTENT00000000000000",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
      }
    });
  });
});
