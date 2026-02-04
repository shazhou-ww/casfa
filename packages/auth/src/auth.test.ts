/**
 * AWP Auth Package Test Suite
 *
 * Tests for ECDSA P-256 signature verification and auth flow.
 *
 * Run tests with:
 *   bun test packages/auth/src/auth.test.ts
 */

import { describe, expect, test } from "bun:test";
import { completeAuthorization, MemoryPubkeyStore } from "./auth-complete.ts";
import {
  generateVerificationCode,
  handleAuthInit,
  handleAuthStatus,
  MemoryPendingAuthStore,
} from "./auth-init.ts";
import {
  buildChallengeResponse,
  validateTimestamp,
  verifyAwpAuth,
  verifySignature,
} from "./awp-auth.ts";
import { createAwpAuthMiddleware, hasAwpAuthCredentials, routeAuthRequest } from "./middleware.ts";
import type { AuthHttpRequest } from "./types.ts";

// =============================================================================
// Helper Functions
// =============================================================================

function createMockRequest(options: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): AuthHttpRequest {
  const { url = "https://example.com/mcp", method = "POST", headers = {}, body = "{}" } = options;

  return {
    url,
    method,
    headers: new Headers(headers),
    text: async () => body,
    clone: () => createMockRequest(options),
  };
}

// Generate ECDSA P-256 keypair for testing
async function generateTestKeyPair(): Promise<{
  publicKey: string;
  privateKey: CryptoKey;
  publicCryptoKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);

  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const publicKey = `${publicJwk.x}.${publicJwk.y}`;

  return {
    publicKey,
    privateKey: keyPair.privateKey,
    publicCryptoKey: keyPair.publicKey,
  };
}

// Sign a payload with the test private key
async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(payload)
  );

  // Base64url encode
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Hash body using SHA-256
async function hashBody(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// =============================================================================
// Verification Code Tests
// =============================================================================

describe("Verification Code Generation", () => {
  test("generates 7-character code with hyphen", () => {
    const code = generateVerificationCode();
    expect(code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  });

  test("generates unique codes", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateVerificationCode());
    }
    // Should be mostly unique (allowing for some collision in 100 tries)
    expect(codes.size).toBeGreaterThan(90);
  });
});

// =============================================================================
// Timestamp Validation Tests
// =============================================================================

describe("Timestamp Validation", () => {
  test("accepts current timestamp", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    expect(validateTimestamp(timestamp, 300)).toBe(true);
  });

  test("accepts timestamp within skew", () => {
    const timestamp = (Math.floor(Date.now() / 1000) - 100).toString();
    expect(validateTimestamp(timestamp, 300)).toBe(true);
  });

  test("rejects expired timestamp", () => {
    const timestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    expect(validateTimestamp(timestamp, 300)).toBe(false);
  });

  test("rejects future timestamp beyond skew", () => {
    const timestamp = (Math.floor(Date.now() / 1000) + 600).toString();
    expect(validateTimestamp(timestamp, 300)).toBe(false);
  });

  test("rejects invalid timestamp", () => {
    expect(validateTimestamp("not-a-number", 300)).toBe(false);
  });
});

// =============================================================================
// Signature Verification Tests
// =============================================================================

describe("Signature Verification", () => {
  test("verifies valid signature", async () => {
    const { publicKey, privateKey } = await generateTestKeyPair();
    const payload = "test-payload";
    const signature = await signPayload(privateKey, payload);

    const result = await verifySignature(publicKey, payload, signature);
    expect(result).toBe(true);
  });

  test("rejects invalid signature", async () => {
    const { publicKey } = await generateTestKeyPair();
    const payload = "test-payload";
    const invalidSignature = "invalid-signature";

    const result = await verifySignature(publicKey, payload, invalidSignature);
    expect(result).toBe(false);
  });

  test("rejects mismatched payload", async () => {
    const { publicKey, privateKey } = await generateTestKeyPair();
    const signature = await signPayload(privateKey, "original-payload");

    const result = await verifySignature(publicKey, "different-payload", signature);
    expect(result).toBe(false);
  });
});

// =============================================================================
// AWP Auth Verification Tests
// =============================================================================

describe("AWP Auth Verification", () => {
  test("verifies valid request signature", async () => {
    const { publicKey, privateKey } = await generateTestKeyPair();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = '{"test": true}';
    const bodyHash = await hashBody(body);
    const payload = `${timestamp}.POST./mcp.${bodyHash}`;
    const signature = await signPayload(privateKey, payload);

    const pubkeyStore = new MemoryPubkeyStore();
    await pubkeyStore.store({
      pubkey: publicKey,
      userId: "user-123",
      clientName: "Test Client",
      createdAt: Date.now(),
    });

    const request = createMockRequest({
      url: "https://example.com/mcp",
      method: "POST",
      headers: {
        "X-AWP-Pubkey": publicKey,
        "X-AWP-Timestamp": timestamp,
        "X-AWP-Signature": signature,
      },
      body,
    });

    const result = await verifyAwpAuth(request, pubkeyStore);
    expect(result.authorized).toBe(true);
    expect(result.context?.userId).toBe("user-123");
  });

  test("rejects request without credentials", async () => {
    const pubkeyStore = new MemoryPubkeyStore();
    const request = createMockRequest({});

    const result = await verifyAwpAuth(request, pubkeyStore);
    expect(result.authorized).toBe(false);
  });

  test("rejects request with unknown pubkey", async () => {
    const { publicKey, privateKey } = await generateTestKeyPair();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "{}";
    const bodyHash = await hashBody(body);
    const payload = `${timestamp}.POST./mcp.${bodyHash}`;
    const signature = await signPayload(privateKey, payload);

    const pubkeyStore = new MemoryPubkeyStore();
    // Don't add the pubkey to store

    const request = createMockRequest({
      url: "https://example.com/mcp",
      method: "POST",
      headers: {
        "X-AWP-Pubkey": publicKey,
        "X-AWP-Timestamp": timestamp,
        "X-AWP-Signature": signature,
      },
      body,
    });

    const result = await verifyAwpAuth(request, pubkeyStore);
    expect(result.authorized).toBe(false);
  });

  test("rejects request with expired timestamp", async () => {
    const { publicKey, privateKey } = await generateTestKeyPair();
    const timestamp = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 min ago
    const body = "{}";
    const bodyHash = await hashBody(body);
    const payload = `${timestamp}.POST./mcp.${bodyHash}`;
    const signature = await signPayload(privateKey, payload);

    const pubkeyStore = new MemoryPubkeyStore();
    await pubkeyStore.store({
      pubkey: publicKey,
      userId: "user-123",
      clientName: "Test Client",
      createdAt: Date.now(),
    });

    const request = createMockRequest({
      url: "https://example.com/mcp",
      method: "POST",
      headers: {
        "X-AWP-Pubkey": publicKey,
        "X-AWP-Timestamp": timestamp,
        "X-AWP-Signature": signature,
      },
      body,
    });

    const result = await verifyAwpAuth(request, pubkeyStore, 300);
    expect(result.authorized).toBe(false);
  });
});

// =============================================================================
// Auth Init Handler Tests
// =============================================================================

describe("Auth Init Handler", () => {
  test("creates pending auth and returns verification code", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();

    const request = createMockRequest({
      url: "https://example.com/auth/init",
      method: "POST",
      body: JSON.stringify({
        pubkey: "abc123.def456",
        client_name: "Test Client",
      }),
    });

    const response = await handleAuthInit(request, {
      baseUrl: "https://example.com",
      pendingAuthStore,
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      auth_url: string;
      verification_code: string;
      expires_in: number;
      poll_interval: number;
    };
    expect(body.auth_url).toContain("https://example.com/auth");
    expect(body.verification_code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    expect(body.expires_in).toBe(600);
    expect(body.poll_interval).toBe(5);

    // Check pending auth was stored
    const pending = await pendingAuthStore.get("abc123.def456");
    expect(pending).not.toBeNull();
    expect(pending?.verificationCode).toBe(body.verification_code);
  });

  test("rejects invalid pubkey format", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();

    const request = createMockRequest({
      url: "https://example.com/auth/init",
      method: "POST",
      body: JSON.stringify({
        pubkey: "invalid-format",
        client_name: "Test Client",
      }),
    });

    const response = await handleAuthInit(request, {
      baseUrl: "https://example.com",
      pendingAuthStore,
    });

    expect(response.status).toBe(400);
  });

  test("rejects non-POST requests", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();

    const request = createMockRequest({
      url: "https://example.com/auth/init",
      method: "GET",
    });

    const response = await handleAuthInit(request, {
      baseUrl: "https://example.com",
      pendingAuthStore,
    });

    expect(response.status).toBe(405);
  });
});

// =============================================================================
// Auth Status Handler Tests
// =============================================================================

describe("Auth Status Handler", () => {
  test("returns authorized: false for pending auth", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();
    const pubkeyStore = new MemoryPubkeyStore();

    await pendingAuthStore.create({
      pubkey: "abc123.def456",
      clientName: "Test Client",
      verificationCode: "ABC-123",
      createdAt: Date.now(),
      expiresAt: Date.now() + 600000,
    });

    const request = createMockRequest({
      url: "https://example.com/auth/status?pubkey=abc123.def456",
      method: "GET",
    });

    const response = await handleAuthStatus(request, {
      pendingAuthStore,
      pubkeyStore,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { authorized: boolean };
    expect(body.authorized).toBe(false);
  });

  test("returns authorized: true for completed auth", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();
    const pubkeyStore = new MemoryPubkeyStore();

    await pubkeyStore.store({
      pubkey: "abc123.def456",
      userId: "user-123",
      clientName: "Test Client",
      createdAt: Date.now(),
    });

    const request = createMockRequest({
      url: "https://example.com/auth/status?pubkey=abc123.def456",
      method: "GET",
    });

    const response = await handleAuthStatus(request, {
      pendingAuthStore,
      pubkeyStore,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { authorized: boolean };
    expect(body.authorized).toBe(true);
  });
});

// =============================================================================
// Auth Complete Tests
// =============================================================================

describe("Auth Completion", () => {
  test("completes authorization with valid code", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();
    const pubkeyStore = new MemoryPubkeyStore();

    await pendingAuthStore.create({
      pubkey: "abc123.def456",
      clientName: "Test Client",
      verificationCode: "ABC-123",
      createdAt: Date.now(),
      expiresAt: Date.now() + 600000,
    });

    const result = await completeAuthorization("abc123.def456", "ABC-123", "user-123", {
      pendingAuthStore,
      pubkeyStore,
    });

    expect(result.success).toBe(true);

    // Check pubkey was stored
    const auth = await pubkeyStore.lookup("abc123.def456");
    expect(auth).not.toBeNull();
    expect(auth?.userId).toBe("user-123");

    // Check pending auth was deleted
    const pending = await pendingAuthStore.get("abc123.def456");
    expect(pending).toBeNull();
  });

  test("rejects invalid verification code", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();
    const pubkeyStore = new MemoryPubkeyStore();

    await pendingAuthStore.create({
      pubkey: "abc123.def456",
      clientName: "Test Client",
      verificationCode: "ABC-123",
      createdAt: Date.now(),
      expiresAt: Date.now() + 600000,
    });

    const result = await completeAuthorization("abc123.def456", "WRONG-CODE", "user-123", {
      pendingAuthStore,
      pubkeyStore,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_code");
  });

  test("rejects expired pending auth", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();
    const pubkeyStore = new MemoryPubkeyStore();

    await pendingAuthStore.create({
      pubkey: "abc123.def456",
      clientName: "Test Client",
      verificationCode: "ABC-123",
      createdAt: Date.now() - 700000,
      expiresAt: Date.now() - 100000, // Expired
    });

    const result = await completeAuthorization("abc123.def456", "ABC-123", "user-123", {
      pendingAuthStore,
      pubkeyStore,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("not_found");
  });
});

// =============================================================================
// Middleware Tests
// =============================================================================

describe("AWP Auth Middleware", () => {
  test("allows excluded paths without auth", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();
    const pubkeyStore = new MemoryPubkeyStore();

    const middleware = createAwpAuthMiddleware({
      pendingAuthStore,
      pubkeyStore,
    });

    const request = createMockRequest({
      url: "https://example.com/auth/init",
    });

    const result = await middleware(request);
    expect(result.authorized).toBe(true);
  });

  test("returns challenge for unauthenticated request", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();
    const pubkeyStore = new MemoryPubkeyStore();

    const middleware = createAwpAuthMiddleware({
      pendingAuthStore,
      pubkeyStore,
    });

    const request = createMockRequest({
      url: "https://example.com/mcp",
    });

    const result = await middleware(request);
    expect(result.authorized).toBe(false);
    expect(result.challengeResponse).toBeDefined();
    expect(result.challengeResponse?.status).toBe(401);
  });
});

// =============================================================================
// Challenge Response Tests
// =============================================================================

describe("Challenge Response", () => {
  test("builds proper 401 response", async () => {
    const response = buildChallengeResponse("/auth/init");

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('AWP realm="awp"');

    const body = (await response.json()) as {
      error: string;
      auth_init_endpoint: string;
    };
    expect(body.error).toBe("unauthorized");
    expect(body.auth_init_endpoint).toBe("/auth/init");
  });
});

// =============================================================================
// hasAwpAuthCredentials Tests
// =============================================================================

describe("hasAwpAuthCredentials", () => {
  test("detects AWP auth headers", () => {
    const request = createMockRequest({
      headers: {
        "X-AWP-Pubkey": "abc123.def456",
        "X-AWP-Signature": "sig",
      },
    });
    expect(hasAwpAuthCredentials(request)).toBe(true);
  });

  test("returns false without credentials", () => {
    const request = createMockRequest({});
    expect(hasAwpAuthCredentials(request)).toBe(false);
  });

  test("returns false with partial credentials", () => {
    const request = createMockRequest({
      headers: {
        "X-AWP-Pubkey": "abc123.def456",
      },
    });
    expect(hasAwpAuthCredentials(request)).toBe(false);
  });
});

// =============================================================================
// Auth Router Tests
// =============================================================================

describe("Auth Router", () => {
  test("routes /auth/init to handler", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();
    const pubkeyStore = new MemoryPubkeyStore();

    const request = createMockRequest({
      url: "https://example.com/auth/init",
      method: "POST",
      body: JSON.stringify({
        pubkey: "abc123.def456",
        client_name: "Test Client",
      }),
    });

    const response = await routeAuthRequest(request, {
      baseUrl: "https://example.com",
      pendingAuthStore,
      pubkeyStore,
    });

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
  });

  test("returns null for non-auth paths", async () => {
    const pendingAuthStore = new MemoryPendingAuthStore();
    const pubkeyStore = new MemoryPubkeyStore();

    const request = createMockRequest({
      url: "https://example.com/mcp",
    });

    const response = await routeAuthRequest(request, {
      baseUrl: "https://example.com",
      pendingAuthStore,
      pubkeyStore,
    });

    expect(response).toBeNull();
  });
});

// =============================================================================
// Memory Store Tests
// =============================================================================

describe("Memory Stores", () => {
  describe("MemoryPendingAuthStore", () => {
    test("creates and retrieves pending auth", async () => {
      const store = new MemoryPendingAuthStore();

      await store.create({
        pubkey: "abc123.def456",
        clientName: "Test",
        verificationCode: "ABC-123",
        createdAt: Date.now(),
        expiresAt: Date.now() + 600000,
      });

      const auth = await store.get("abc123.def456");
      expect(auth).not.toBeNull();
      expect(auth?.clientName).toBe("Test");
    });

    test("returns null for expired auth", async () => {
      const store = new MemoryPendingAuthStore();

      await store.create({
        pubkey: "abc123.def456",
        clientName: "Test",
        verificationCode: "ABC-123",
        createdAt: Date.now() - 700000,
        expiresAt: Date.now() - 100000,
      });

      const auth = await store.get("abc123.def456");
      expect(auth).toBeNull();
    });
  });

  describe("MemoryPubkeyStore", () => {
    test("stores and retrieves authorized pubkey", async () => {
      const store = new MemoryPubkeyStore();

      await store.store({
        pubkey: "abc123.def456",
        userId: "user-123",
        clientName: "Test",
        createdAt: Date.now(),
      });

      const auth = await store.lookup("abc123.def456");
      expect(auth).not.toBeNull();
      expect(auth?.userId).toBe("user-123");
    });

    test("revokes pubkey", async () => {
      const store = new MemoryPubkeyStore();

      await store.store({
        pubkey: "abc123.def456",
        userId: "user-123",
        clientName: "Test",
        createdAt: Date.now(),
      });

      await store.revoke("abc123.def456");

      const auth = await store.lookup("abc123.def456");
      expect(auth).toBeNull();
    });

    test("lists pubkeys by user", async () => {
      const store = new MemoryPubkeyStore();

      await store.store({
        pubkey: "key1.pub",
        userId: "user-123",
        clientName: "Client 1",
        createdAt: Date.now(),
      });

      await store.store({
        pubkey: "key2.pub",
        userId: "user-123",
        clientName: "Client 2",
        createdAt: Date.now(),
      });

      await store.store({
        pubkey: "key3.pub",
        userId: "user-456",
        clientName: "Client 3",
        createdAt: Date.now(),
      });

      const keys = await store.listByUser("user-123");
      expect(keys).toHaveLength(2);
    });
  });
});
