/**
 * E2E tests for @casfa/storage-http
 *
 * Spins up a real test server (DynamoDB Local + in-memory CAS storage),
 * creates a CasfaClient with proper authentication, and exercises
 * createHttpStorage against it.
 *
 * Requirements (same as server e2e tests):
 * - DynamoDB Local running at DYNAMODB_ENDPOINT (default: http://localhost:8700)
 * - Test tables created via `bun run db:create`
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CasfaClient, createClient, type TokenState } from "@casfa/client";
import { computeSizeFlagByte, encodeFileNode, type KeyProvider } from "@casfa/core";
import type { PopContext } from "@casfa/proof";
import { hashToNodeKey, nodeKeyToStorageKey } from "@casfa/protocol";
import { blake3 } from "@noble/hashes/blake3";
import {
  createE2EContext,
  type E2EContext,
  uniqueId,
} from "../../../apps/server/backend/e2e/setup.ts";
import { createHttpStorage, type HttpStorageConfig } from "../src/http-storage.ts";

// ============================================================================
// Crypto helpers (real blake3, same as server)
// ============================================================================

const keyProvider: KeyProvider = {
  computeKey: async (data: Uint8Array) => {
    const raw = blake3(data, { dkLen: 16 });
    raw[0] = computeSizeFlagByte(data.length);
    return raw;
  },
};

const popContext: PopContext = {
  blake3_256: (data: Uint8Array): Uint8Array => blake3(data),
  blake3_128_keyed: (data: Uint8Array, key: Uint8Array): Uint8Array =>
    blake3(data, { dkLen: 16, key }),
  crockfordBase32Encode: (bytes: Uint8Array): string => {
    const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let result = "";
    let buffer = 0;
    let bitsLeft = 0;
    for (const byte of bytes) {
      buffer = (buffer << 8) | byte;
      bitsLeft += 8;
      while (bitsLeft >= 5) {
        bitsLeft -= 5;
        result += ALPHABET[(buffer >> bitsLeft) & 0x1f];
      }
    }
    if (bitsLeft > 0) {
      result += ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
    }
    return result;
  },
};

// ============================================================================
// Test helpers
// ============================================================================

async function createTestClient(
  ctx: E2EContext,
  options: {
    canUpload?: boolean;
    canManageDepot?: boolean;
  } = {}
): Promise<{
  client: CasfaClient;
  realm: string;
}> {
  const _options = options;
  const userUuid = uniqueId();
  const { token, realm, userId } = await ctx.helpers.createTestUser(userUuid, "authorized");

  // Root delegate is auto-created by server middleware on first JWT request.
  // Build initial token state with user JWT only.
  const initialState: TokenState = {
    user: {
      accessToken: token,
      refreshToken: "",
      userId,
      expiresAt: Date.now() + 3600_000,
    },
    rootDelegate: null,
  };

  const client = await createClient({
    baseUrl: ctx.baseUrl,
    realm,
    tokenStorage: {
      load: async () => initialState,
      save: async () => {},
      clear: async () => {},
    },
  });

  return { client, realm };
}

async function encodeTestFile(content: string) {
  const data = new TextEncoder().encode(content);
  const encoded = await encodeFileNode(
    { data, contentType: "text/plain", fileSize: data.length },
    keyProvider
  );
  const nodeKey = hashToNodeKey(encoded.hash);
  const storageKey = nodeKeyToStorageKey(nodeKey);
  return { nodeKey, storageKey, nodeBytes: encoded.bytes, nodeHash: encoded.hash };
}

async function createStorageWithClient(ctx: E2EContext) {
  const { client, realm } = await createTestClient(ctx);

  let cachedTokenBytes: Uint8Array | null = null;

  const config: HttpStorageConfig = {
    client,
    getTokenBytes: () => cachedTokenBytes,
    popContext,
  };

  const storage = createHttpStorage(config);

  // Pre-load token bytes
  const at = await client.getAccessToken();
  if (at) cachedTokenBytes = at.tokenBytes;

  return { storage, client, realm, config };
}

// ============================================================================
// Tests
// ============================================================================

describe("storage-http E2E", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // get
  // ==========================================================================

  describe("get", () => {
    it("should return null for a non-existent key", async () => {
      const { storage } = await createStorageWithClient(ctx);

      // A key that doesn't exist
      const fakeKey = "00000000000000000000000000";
      const result = await storage.get(fakeKey);
      expect(result).toBeNull();
    });

    it("should return the node bytes for an uploaded node", async () => {
      const { storage, client } = await createStorageWithClient(ctx);

      // Upload directly via client
      const { nodeKey, storageKey, nodeBytes } = await encodeTestFile(`get-test-${Date.now()}`);
      const putResult = await client.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);

      // Now get via storage
      const result = await storage.get(storageKey);
      expect(result).not.toBeNull();
      expect(result).toEqual(nodeBytes);
    });
  });

  // ==========================================================================
  // put
  // ==========================================================================

  describe("put", () => {
    it("should upload a missing node", async () => {
      const { storage, client } = await createStorageWithClient(ctx);

      const { nodeKey, storageKey, nodeBytes } = await encodeTestFile(`put-missing-${Date.now()}`);

      // Verify it's missing
      const checkBefore = await client.nodes.check({ keys: [nodeKey] });
      expect(checkBefore.ok).toBe(true);
      if (checkBefore.ok) expect(checkBefore.data.missing).toContain(nodeKey);

      // put via storage
      await storage.put(storageKey, nodeBytes);

      // Now it should be owned
      const checkAfter = await client.nodes.check({ keys: [nodeKey] });
      expect(checkAfter.ok).toBe(true);
      if (checkAfter.ok) expect(checkAfter.data.owned).toContain(nodeKey);
    });

    it("should claim an unowned node", async () => {
      // Client1 uploads a node
      const { client: client1 } = await createTestClient(ctx);
      const { nodeKey, storageKey, nodeBytes } = await encodeTestFile(`put-claim-${Date.now()}`);
      const putResult = await client1.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);

      // Client2 does storage.put — should detect "unowned" and claim it
      const { storage: storage2, client: client2 } = await createStorageWithClient(ctx);

      await storage2.put(storageKey, nodeBytes);

      // Verify client2 now owns the node
      const checkResult = await client2.nodes.check({ keys: [nodeKey] });
      expect(checkResult.ok).toBe(true);
      if (checkResult.ok) expect(checkResult.data.owned).toContain(nodeKey);
    });

    it("should no-op for an already-owned node", async () => {
      const { storage, client } = await createStorageWithClient(ctx);

      const { nodeKey, storageKey, nodeBytes } = await encodeTestFile(`put-owned-${Date.now()}`);

      // Upload via client first
      const putResult = await client.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);

      // storage.put should succeed without error (no-op)
      await storage.put(storageKey, nodeBytes);

      // Still owned
      const checkResult = await client.nodes.check({ keys: [nodeKey] });
      expect(checkResult.ok).toBe(true);
      if (checkResult.ok) expect(checkResult.data.owned).toContain(nodeKey);
    });
  });

  // ==========================================================================
  // put + get roundtrip
  // ==========================================================================

  describe("put + get roundtrip", () => {
    it("should roundtrip put then get", async () => {
      const { storage } = await createStorageWithClient(ctx);

      const { storageKey, nodeBytes } = await encodeTestFile(`roundtrip-${Date.now()}`);

      await storage.put(storageKey, nodeBytes);

      const result = await storage.get(storageKey);
      expect(result).not.toBeNull();
      expect(result).toEqual(nodeBytes);
    });
  });

  // ==========================================================================
  // Cache behaviour
  // ==========================================================================

  describe("check cache integration", () => {
    it("should cache check result so second put is no-op", async () => {
      const { storage } = await createStorageWithClient(ctx);

      const { storageKey, nodeBytes } = await encodeTestFile(`cache-test-${Date.now()}`);

      // First put uploads the node
      await storage.put(storageKey, nodeBytes);

      // Second put should be a no-op (cached as owned)
      await storage.put(storageKey, nodeBytes);
    });

    it("should upload on put after get misses", async () => {
      const { storage } = await createStorageWithClient(ctx);

      const { storageKey, nodeBytes } = await encodeTestFile(`cache-get-put-${Date.now()}`);

      // get returns null (missing)
      const getResult = await storage.get(storageKey);
      expect(getResult).toBeNull();

      // put should upload
      await storage.put(storageKey, nodeBytes);

      // Subsequent get should return data
      const data = await storage.get(storageKey);
      expect(data).toEqual(nodeBytes);
    });
  });
});
