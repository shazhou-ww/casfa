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
import {
  type CasfaClient,
  createClient,
  type StoredRootDelegate,
} from "@casfa/client";
import { encodeFileNode, type HashProvider } from "@casfa/core";
import { computePoP, type PopContext } from "@casfa/proof";
import { hashToNodeKey, nodeKeyToStorageKey } from "@casfa/protocol";
import { blake3 } from "@noble/hashes/blake3";
import {
  createE2EContext,
  type E2EContext,
  uniqueId,
} from "../../../apps/server/backend/e2e/setup.ts";
import {
  createHttpStorage,
  type HttpStorageConfig,
} from "../src/http-storage.ts";

// ============================================================================
// Crypto helpers (real blake3, same as server)
// ============================================================================

const hashProvider: HashProvider = {
  hash: async (data: Uint8Array) => blake3(data, { dkLen: 16 }),
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

async function createTestClient(ctx: E2EContext, options: {
  canUpload?: boolean;
  canManageDepot?: boolean;
} = {}): Promise<{
  client: CasfaClient;
  realm: string;
  rootDelegate: StoredRootDelegate;
}> {
  const { canUpload = true, canManageDepot = true } = options;
  const userUuid = uniqueId();
  const { token, realm } = await ctx.helpers.createTestUser(userUuid, "authorized");

  const delegateResult = await ctx.helpers.createDelegateToken(token, realm, {
    canUpload,
    canManageDepot,
  });

  const rootDelegate: StoredRootDelegate = {
    delegateId: delegateResult.delegate.delegateId,
    realm: delegateResult.delegate.realm,
    refreshToken: delegateResult.refreshToken,
    accessToken: delegateResult.accessToken,
    accessTokenExpiresAt: delegateResult.accessTokenExpiresAt,
    depth: delegateResult.delegate.depth,
    canUpload: delegateResult.delegate.canUpload,
    canManageDepot: delegateResult.delegate.canManageDepot,
  };

  const client = await createClient({ baseUrl: ctx.baseUrl, realm });
  client.setRootDelegate(rootDelegate);

  return { client, realm, rootDelegate };
}

async function encodeTestFile(content: string) {
  const data = new TextEncoder().encode(content);
  const encoded = await encodeFileNode(
    { data, contentType: "text/plain", fileSize: data.length },
    hashProvider,
  );
  const nodeKey = hashToNodeKey(encoded.hash);
  const storageKey = nodeKeyToStorageKey(nodeKey);
  return { nodeKey, storageKey, nodeBytes: encoded.bytes, nodeHash: encoded.hash };
}

function makeHttpStorage(client: CasfaClient): {
  storage: ReturnType<typeof createHttpStorage>;
  config: HttpStorageConfig;
} {
  let cachedTokenBytes: Uint8Array | null = null;

  const config: HttpStorageConfig = {
    client,
    getTokenBytes: () => cachedTokenBytes,
    popContext,
  };

  // Pre-load token bytes (we'll call this before returning)
  const storage = createHttpStorage(config);

  // Expose a helper to load token bytes
  const init = async () => {
    const at = await client.getAccessToken();
    if (at) cachedTokenBytes = at.tokenBytes;
  };

  return {
    storage,
    config,
    // @ts-expect-error init is a one-time async setup helper
    init,
  };
}

async function createStorageWithClient(ctx: E2EContext) {
  const { client, realm, rootDelegate } = await createTestClient(ctx);

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

  return { storage, client, realm, rootDelegate, config };
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
      const { nodeKey, storageKey, nodeBytes } = await encodeTestFile(
        `get-test-${Date.now()}`,
      );
      const putResult = await client.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);

      // Now get via storage
      const result = await storage.get(storageKey);
      expect(result).not.toBeNull();
      expect(result).toEqual(nodeBytes);
    });
  });

  // ==========================================================================
  // has
  // ==========================================================================

  describe("has", () => {
    it("should return false for a missing node", async () => {
      const { storage } = await createStorageWithClient(ctx);

      const fakeKey = "00000000000000000000000000";
      expect(await storage.has(fakeKey)).toBe(false);
    });

    it("should return true for an owned node", async () => {
      const { storage, client } = await createStorageWithClient(ctx);

      const { nodeKey, storageKey, nodeBytes } = await encodeTestFile(
        `has-owned-${Date.now()}`,
      );

      // Upload (auto-owned by the uploader)
      const putResult = await client.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);

      // has should be true (owned)
      expect(await storage.has(storageKey)).toBe(true);
    });

    it("should return false for an unowned node", async () => {
      // Client1 uploads a node
      const { client: client1 } = await createTestClient(ctx);
      const { nodeKey, storageKey, nodeBytes } = await encodeTestFile(
        `has-unowned-${Date.now()}`,
      );
      const putResult = await client1.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);

      // Client2 checks — node exists but is unowned by client2
      const { storage: storage2 } = await createStorageWithClient(ctx);
      expect(await storage2.has(storageKey)).toBe(false);
    });
  });

  // ==========================================================================
  // put
  // ==========================================================================

  describe("put", () => {
    it("should upload a missing node", async () => {
      const { storage, client } = await createStorageWithClient(ctx);

      const { nodeKey, storageKey, nodeBytes } = await encodeTestFile(
        `put-missing-${Date.now()}`,
      );

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
      const { nodeKey, storageKey, nodeBytes } = await encodeTestFile(
        `put-claim-${Date.now()}`,
      );
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

      const { nodeKey, storageKey, nodeBytes } = await encodeTestFile(
        `put-owned-${Date.now()}`,
      );

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

      const { storageKey, nodeBytes } = await encodeTestFile(
        `roundtrip-${Date.now()}`,
      );

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
    it("should cache check result so has after put is true", async () => {
      const { storage } = await createStorageWithClient(ctx);

      const { storageKey, nodeBytes } = await encodeTestFile(
        `cache-test-${Date.now()}`,
      );

      // put caches "owned" after upload
      await storage.put(storageKey, nodeBytes);

      // has should be true without another network call
      expect(await storage.has(storageKey)).toBe(true);
    });

    it("should cache has result so put reuses it", async () => {
      const { storage } = await createStorageWithClient(ctx);

      const { storageKey, nodeBytes } = await encodeTestFile(
        `cache-has-put-${Date.now()}`,
      );

      // has → caches "missing"
      expect(await storage.has(storageKey)).toBe(false);

      // put → should use cached "missing" and upload
      await storage.put(storageKey, nodeBytes);

      // Subsequent has → cached "owned" (updated by put)
      expect(await storage.has(storageKey)).toBe(true);
    });
  });
});
