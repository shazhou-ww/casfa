/**
 * E2E Tests: Client SDK Integration
 *
 * Tests the full @casfa/client SDK flow against a real server:
 * - Create CasfaClient with root delegate
 * - Create child delegate
 * - Upload CAS nodes
 * - Claim ownership via PoP
 * - Commit root to depot
 *
 * This validates the implementation plan Step 7 checklist item:
 * "集成测试: client E2E flow（create delegate → upload → claim → commit）"
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CasfaClient, createClient, type TokenState } from "@casfa/client";
import { computeSizeFlagByte, encodeFileNode, type KeyProvider } from "@casfa/core";
import { computePoP, type PopContext } from "@casfa/proof";
import { hashToNodeKey } from "@casfa/protocol";
import { blake3 } from "@noble/hashes/blake3";
import { createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

// ============================================================================
// Test Crypto Context
// ============================================================================

/** Real KeyProvider using blake3 (same as server) */
const keyProvider: KeyProvider = {
  computeKey: async (data: Uint8Array) => {
    const raw = blake3(data, { dkLen: 16 });
    raw[0] = computeSizeFlagByte(data.length);
    return raw;
  },
};

/** Real PopContext using blake3 (same as server) */
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
// Tests
// ============================================================================

describe("Client SDK Integration", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  /**
  /**
   * Helper: create a CasfaClient pre-loaded with user JWT and root delegate.
   * Uses tokenStorage to inject the pre-existing auth state.
   */
  async function createTestClient(
    options: { canUpload?: boolean; canManageDepot?: boolean } = {}
  ): Promise<{
    client: CasfaClient;
    realm: string;
    mainDepotId: string;
  }> {
    const userUuid = uniqueId();
    const { token, realm, mainDepotId, userId } = await ctx.helpers.createTestUser(
      userUuid,
      "authorized"
    );

    // Root delegate is auto-created by server middleware on first JWT request.
    // Build initial token state with user JWT only.
    const initialState: TokenState = {
      user: {
        accessToken: token,
        refreshToken: "",
        userId: userId,
        expiresAt: Date.now() + 3600_000, // 1 hour
      },
      rootDelegate: null,
    };

    // Create CasfaClient with pre-loaded state
    const client = await createClient({
      baseUrl: ctx.baseUrl,
      realm,
      tokenStorage: {
        load: async () => initialState,
        save: async () => {},
        clear: async () => {},
      },
    });

    return { client, realm, mainDepotId };
  }

  /**
   * Helper: encode a file and compute its node key.
   */
  async function encodeTestFile(content: string): Promise<{
    nodeKey: string;
    nodeBytes: Uint8Array;
    nodeHash: Uint8Array;
  }> {
    const data = new TextEncoder().encode(content);
    const encoded = await encodeFileNode(
      { data, contentType: "text/plain", fileSize: data.length },
      keyProvider
    );
    const nodeKey = hashToNodeKey(encoded.hash);
    return { nodeKey, nodeBytes: encoded.bytes, nodeHash: encoded.hash };
  }

  // ==========================================================================
  // Full Flow: create delegate → upload → claim → commit
  // ==========================================================================

  describe("full flow: delegate → upload → claim → commit", () => {
    it("should complete the entire lifecycle", async () => {
      const { client, mainDepotId } = await createTestClient();

      // 1. Encode a CAS file node
      const content = `Hello, CASFA! ${Date.now()}`;
      const { nodeKey, nodeBytes } = await encodeTestFile(content);

      // 2. Check — which nodes are missing
      const prepResult = await client.nodes.check({ keys: [nodeKey] });
      expect(prepResult.ok).toBe(true);
      if (!prepResult.ok) throw new Error("check failed");
      expect(prepResult.data.missing).toContain(nodeKey);

      // 3. Upload the node
      const putResult = await client.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);
      if (!putResult.ok) throw new Error(`put failed: ${putResult.error.message}`);

      // 4. Check again — node should no longer be missing
      const prepResult2 = await client.nodes.check({ keys: [nodeKey] });
      expect(prepResult2.ok).toBe(true);
      if (!prepResult2.ok) throw new Error("check2 failed");
      // After upload, the node exists and is owned by the uploader
      expect(prepResult2.data.missing).not.toContain(nodeKey);

      // 5. Claim ownership via PoP (should be idempotent since upload already owns)
      const accessToken = await client.getAccessToken();
      expect(accessToken).not.toBeNull();

      const pop = computePoP(accessToken!.tokenBytes, nodeBytes, popContext);
      const claimResult = await client.nodes.claim(nodeKey, pop);
      expect(claimResult.ok).toBe(true);
      if (!claimResult.ok) throw new Error(`claim failed: ${claimResult.error.message}`);

      // 6. Commit to depot — set the uploaded node as the new root
      const commitResult = await client.depots.commit(mainDepotId, {
        root: nodeKey,
      });
      expect(commitResult.ok).toBe(true);
      if (!commitResult.ok) throw new Error(`commit failed: ${commitResult.error.message}`);

      // 7. Verify depot has the new root
      const depotResult = await client.depots.get(mainDepotId);
      expect(depotResult.ok).toBe(true);
      if (!depotResult.ok) throw new Error("depot get failed");
      expect(depotResult.data.root).toBe(nodeKey);
    });
  });

  // ==========================================================================
  // Create child delegate
  // ==========================================================================

  describe("delegate management", () => {
    it("should create a child delegate", async () => {
      const { client } = await createTestClient();

      const result = await client.delegates.create({
        name: "Test Child",
        canUpload: false,
        canManageDepot: false,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`create delegate failed: ${result.error.message}`);
      expect(result.data.delegate.canUpload).toBe(false);
      expect(result.data.delegate.canManageDepot).toBe(false);
      expect(result.data.delegate.depth).toBeGreaterThan(0);
      expect(result.data.accessToken).toBeDefined();
      expect(result.data.refreshToken).toBeDefined();
    });

    it("should list delegates", async () => {
      const { client } = await createTestClient();

      // Create two children
      await client.delegates.create({ name: "Child A", canUpload: true, canManageDepot: false });
      await client.delegates.create({ name: "Child B", canUpload: false, canManageDepot: false });

      const result = await client.delegates.list();
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("list delegates failed");
      expect(result.data.delegates.length).toBeGreaterThanOrEqual(2);
    });

    it("should revoke a delegate", async () => {
      const { client } = await createTestClient();

      const createResult = await client.delegates.create({
        name: "Revokable",
        canUpload: false,
        canManageDepot: false,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error("create failed");

      const delegateId = createResult.data.delegate.delegateId;

      const revokeResult = await client.delegates.revoke(delegateId);
      expect(revokeResult.ok).toBe(true);

      // After revocation, the delegate should show as revoked
      const getResult = await client.delegates.get(delegateId);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error("get failed");
      expect(getResult.data.isRevoked).toBe(true);
    });
  });

  // ==========================================================================
  // Upload + Claim with PoP (separate nodes)
  // ==========================================================================

  describe("upload and claim", () => {
    it("should upload a node and auto-own it", async () => {
      const { client } = await createTestClient();

      const { nodeKey, nodeBytes } = await encodeTestFile("auto-owned content");

      const putResult = await client.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);

      // After upload, check should show the node as owned
      const prepResult = await client.nodes.check({ keys: [nodeKey] });
      expect(prepResult.ok).toBe(true);
      if (!prepResult.ok) throw new Error("check failed");
      expect(prepResult.data.owned).toContain(nodeKey);
    });

    it("should claim an existing node with valid PoP", async () => {
      const { client } = await createTestClient();

      // Upload node with first client
      const { nodeKey, nodeBytes } = await encodeTestFile("claim-me");

      const putResult = await client.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);

      // Claim using same client (idempotent)
      const at = await client.getAccessToken();
      expect(at).not.toBeNull();

      const pop = computePoP(at!.tokenBytes, nodeBytes, popContext);
      const claimResult = await client.nodes.claim(nodeKey, pop);
      expect(claimResult.ok).toBe(true);
      if (!claimResult.ok) throw new Error(`claim failed: ${claimResult.error.message}`);
      // Since same delegate uploaded, it should already be owned
      expect(claimResult.data.alreadyOwned).toBe(true);
    });

    it("should reject claim with invalid PoP", async () => {
      const { client } = await createTestClient();

      const { nodeKey, nodeBytes } = await encodeTestFile("invalid-pop-test");

      // Upload the node (auto-claimed by client's root delegate)
      await client.nodes.put(nodeKey, nodeBytes);

      // Create a child delegate (depth > 0) to test PoP rejection.
      // Root delegates (depth=0) skip PoP verification, so we need a child.
      const userUuid = uniqueId();
      const { token: token2, realm: realm2 } = await ctx.helpers.createTestUser(
        userUuid,
        "authorized"
      );
      const childResult = await ctx.helpers.createDelegateToken(token2, realm2, {
        canUpload: true,
        canManageDepot: true,
      });

      // Claim the existing node with invalid PoP using the child delegate's AT
      const badPop = "pop:INVALIDPOPSTRING00000000";
      const claimResponse = await ctx.helpers.accessRequest(
        childResult.accessToken,
        "POST",
        `/api/realm/${realm2}/nodes/${nodeKey}/claim`,
        { pop: badPop }
      );
      expect(claimResponse.status).toBe(403);
    });

    it("should claim node from a different delegate using correct PoP", async () => {
      // Client1 uploads a node
      const { client: client1 } = await createTestClient();
      const { nodeKey, nodeBytes } = await encodeTestFile(`cross-claim-${Date.now()}`);
      const putResult = await client1.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);

      // Client2 claims it with valid PoP using its own token bytes
      const { client: client2 } = await createTestClient();
      const at2 = await client2.getAccessToken();
      expect(at2).not.toBeNull();

      const pop = computePoP(at2!.tokenBytes, nodeBytes, popContext);
      const claimResult = await client2.nodes.claim(nodeKey, pop);
      expect(claimResult.ok).toBe(true);
      if (!claimResult.ok) throw new Error(`claim failed: ${claimResult.error.message}`);
      expect(claimResult.data.alreadyOwned).toBe(false);
    });
  });

  // ==========================================================================
  // Depot operations
  // ==========================================================================

  describe("depot operations", () => {
    it("should list depots", async () => {
      const { client } = await createTestClient();

      const result = await client.depots.list();
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("list failed");
      // Every new user has a "main" depot
      expect(result.data.depots.length).toBeGreaterThanOrEqual(1);
    });

    it("should create a depot", async () => {
      const { client } = await createTestClient();

      const result = await client.depots.create({ title: "SDK Test Depot", maxHistory: 20 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`create depot failed: ${result.error.message}`);
      expect(result.data.depotId).toBeDefined();
    });

    it("should get depot details", async () => {
      const { client, mainDepotId } = await createTestClient();

      const result = await client.depots.get(mainDepotId);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("get depot failed");
      // Server response returns depotId directly (dpt_ prefix)
      expect(result.data.depotId).toBe(mainDepotId);
    });

    it("should commit root and update depot", async () => {
      const { client, mainDepotId } = await createTestClient();

      // Upload a node
      const { nodeKey, nodeBytes } = await encodeTestFile("depot-root-content");
      const putResult = await client.nodes.put(nodeKey, nodeBytes);
      expect(putResult.ok).toBe(true);

      // Commit to depot
      const commitResult = await client.depots.commit(mainDepotId, {
        root: nodeKey,
      });
      expect(commitResult.ok).toBe(true);

      // Verify
      const depotResult = await client.depots.get(mainDepotId);
      expect(depotResult.ok).toBe(true);
      if (!depotResult.ok) throw new Error("get failed");
      expect(depotResult.data.root).toBe(nodeKey);
    });
  });

  // ==========================================================================
  // Token auto-refresh (access token view)
  // ==========================================================================

  describe("token management", () => {
    it("should provide access token (JWT-based for root)", async () => {
      const { client } = await createTestClient();

      const at = await client.getAccessToken();
      expect(at).not.toBeNull();
      expect(at!.tokenBase64).toBeDefined();
      // JWT-based access token: tokenBytes is empty (PoP not used for root)
      expect(at!.tokenBytes).toBeInstanceOf(Uint8Array);
      expect(at!.tokenBytes.length).toBe(0);
      // tokenBase64 is a JWT string (contains dots)
      expect(at!.tokenBase64).toContain(".");
    });

    it("should have correct permissions in access token", async () => {
      const { client } = await createTestClient();

      const at = await client.getAccessToken();
      expect(at).not.toBeNull();
      // Root delegate always has full permissions
      expect(at!.canUpload).toBe(true);
      expect(at!.canManageDepot).toBe(true);
    });
  });
});
