/**
 * Unit tests for Claim Controller
 *
 * Tests the node claim (PoP-based ownership) flow:
 * - Successful claim (new ownership)
 * - Idempotent claim (already owned)
 * - Invalid PoP → 403
 * - Node not found → 404
 * - Missing canUpload → 403
 * - Realm mismatch → 403
 * - Non-access token → 403
 * - Full-chain write verification
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { PopContext } from "@casfa/proof";
import { nodeKeyToHex } from "@casfa/protocol";
import {
  createClaimController,
  type ClaimController,
  type ClaimControllerDeps,
} from "../../src/controllers/claim.ts";
import type { OwnershipV2Db } from "../../src/db/ownership-v2.ts";

// ============================================================================
// Mock factories
// ============================================================================

const TEST_REALM = "usr_testuser";
const TEST_DELEGATE_ID = "dlg_child";
const TEST_ROOT_DELEGATE_ID = "dlg_root";
/** Node key in node:XXXX (Crockford base32) format */
const TEST_NODE_KEY = "node:NF6YY4HMASW91AYDXW938NKRJ0";
/** Corresponding hex storage key */
const TEST_STORAGE_KEY = nodeKeyToHex(TEST_NODE_KEY);
const TEST_TOKEN_BYTES = new Uint8Array(128).fill(0x42);
const TEST_CONTENT = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
const TEST_POP = "pop:VALID_POP_STRING";

/**
 * Create a mock PoP context where computePoP returns TEST_POP
 * and verifyPoP succeeds only for the matching token + content.
 */
function createMockPopContext(overrides?: {
  verifyResult?: boolean;
}): PopContext {
  const shouldVerify = overrides?.verifyResult ?? true;
  return {
    blake3_256: mock((data: Uint8Array) => new Uint8Array(32).fill(0xaa)),
    blake3_128_keyed: mock((data: Uint8Array, key: Uint8Array) => {
      // Return a deterministic 16-byte result
      const result = new Uint8Array(16);
      // If shouldVerify, match what the controller will check
      if (shouldVerify) {
        result.fill(0xbb);
      } else {
        result.fill(0xcc); // Different → verify will fail
      }
      return result;
    }),
    crockfordBase32Encode: mock((bytes: Uint8Array) => {
      // Return the hex portion that matches or doesn't match TEST_POP
      if (shouldVerify && bytes[0] === 0xbb) {
        return "VALID_POP_STRING";
      }
      return "DIFFERENT_POP";
    }),
  };
}

function createMockOwnershipDb(overrides?: Partial<OwnershipV2Db>): OwnershipV2Db {
  return {
    addOwnership: mock(async () => {}),
    hasOwnership: mock(async () => false),
    hasAnyOwnership: mock(async () => false),
    getOwnership: mock(async () => null),
    listOwners: mock(async () => []),
    ...overrides,
  };
}

/**
 * Create a minimal Hono Context mock for testing
 */
function createMockContext(options: {
  auth?: Record<string, unknown>;
  body?: Record<string, unknown> | null;
  params?: Record<string, string>;
}) {
  const responseData: { body?: unknown; status?: number } = {};

  const context = {
    get: mock((key: string) => {
      if (key === "auth") return options.auth;
      return undefined;
    }),
    set: mock(() => {}),
    req: {
      json: mock(async () => {
        if (options.body === null) throw new Error("Invalid JSON");
        return options.body ?? {};
      }),
      param: mock((name: string) => (options.params ?? {})[name]),
      query: mock((_name: string) => undefined),
      header: mock((_name: string) => undefined),
    },
    json: mock((body: unknown, status?: number) => {
      responseData.body = body;
      responseData.status = status ?? 200;
      return new Response(JSON.stringify(body), { status: status ?? 200 });
    }),
    responseData,
  };

  return context;
}

function createAccessTokenAuth(overrides?: Record<string, unknown>) {
  return {
    type: "access",
    realm: TEST_REALM,
    tokenId: "dlt1_test",
    tokenBytes: TEST_TOKEN_BYTES,
    canUpload: true,
    canManageDepot: false,
    issuerChain: [TEST_ROOT_DELEGATE_ID, TEST_DELEGATE_ID],
    tokenRecord: {
      tokenId: "dlt1_test",
      tokenType: "access",
      realm: TEST_REALM,
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("ClaimController", () => {
  let controller: ClaimController;
  let mockOwnershipDb: OwnershipV2Db;
  let mockPopContext: PopContext;
  let mockGetNodeContent: ReturnType<typeof mock>;

  beforeEach(() => {
    mockOwnershipDb = createMockOwnershipDb();
    mockPopContext = createMockPopContext();
    mockGetNodeContent = mock(async (_realm: string, _hash: string) => TEST_CONTENT);

    controller = createClaimController({
      ownershipDb: mockOwnershipDb,
      getNodeContent: mockGetNodeContent,
      popContext: mockPopContext,
    });
  });

  // ==========================================================================
  // Success paths
  // ==========================================================================

  describe("claim — success", () => {
    it("claims a new node and returns 200 with alreadyOwned=false", async () => {
      const c = createMockContext({
        auth: createAccessTokenAuth(),
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      const res = await controller.claim(c as any);
      expect(res.status).toBe(200);

      const body = c.responseData.body as Record<string, unknown>;
      expect(body.nodeHash).toBe(TEST_NODE_KEY);
      expect(body.alreadyOwned).toBe(false);
      expect(body.delegateId).toBe(TEST_DELEGATE_ID);
    });

    it("performs full-chain ownership write", async () => {
      const c = createMockContext({
        auth: createAccessTokenAuth(),
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      await controller.claim(c as any);

      expect(mockOwnershipDb.addOwnership).toHaveBeenCalledTimes(1);
      const call = (mockOwnershipDb.addOwnership as ReturnType<typeof mock>).mock.calls[0]!;
      // args: (storageKey, chain, uploadedBy, contentType, size)
      expect(call[0]).toBe(TEST_STORAGE_KEY);
      expect(call[1]).toEqual([TEST_ROOT_DELEGATE_ID, TEST_DELEGATE_ID]);
      expect(call[2]).toBe(TEST_DELEGATE_ID); // uploadedBy
      expect(call[4]).toBe(TEST_CONTENT.length); // size
    });

    it("returns idempotent 200 when already owned", async () => {
      mockOwnershipDb = createMockOwnershipDb({
        hasOwnership: mock(async () => true),
      });
      controller = createClaimController({
        ownershipDb: mockOwnershipDb,
        getNodeContent: mockGetNodeContent,
        popContext: mockPopContext,
      });

      const c = createMockContext({
        auth: createAccessTokenAuth(),
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      const res = await controller.claim(c as any);
      expect(res.status).toBe(200);

      const body = c.responseData.body as Record<string, unknown>;
      expect(body.alreadyOwned).toBe(true);
      expect(body.delegateId).toBe(TEST_DELEGATE_ID);

      // No addOwnership call when already owned
      expect(mockOwnershipDb.addOwnership).not.toHaveBeenCalled();
    });

    it("skips PoP check when already owned", async () => {
      mockOwnershipDb = createMockOwnershipDb({
        hasOwnership: mock(async () => true),
      });
      // Use a failing PoP context — shouldn't matter since we're already owned
      mockPopContext = createMockPopContext({ verifyResult: false });
      controller = createClaimController({
        ownershipDb: mockOwnershipDb,
        getNodeContent: mockGetNodeContent,
        popContext: mockPopContext,
      });

      const c = createMockContext({
        auth: createAccessTokenAuth(),
        body: { pop: "pop:ANYTHING" },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      const res = await controller.claim(c as any);
      expect(res.status).toBe(200);
      expect((c.responseData.body as Record<string, unknown>).alreadyOwned).toBe(true);
    });
  });

  // ==========================================================================
  // Error paths
  // ==========================================================================

  describe("claim — errors", () => {
    it("rejects non-access token (403)", async () => {
      const c = createMockContext({
        auth: { type: "delegate", realm: TEST_REALM },
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      const res = await controller.claim(c as any);
      expect(res.status).toBe(403);
      expect((c.responseData.body as Record<string, unknown>).error).toBe("ACCESS_TOKEN_REQUIRED");
    });

    it("rejects token without canUpload (403)", async () => {
      const c = createMockContext({
        auth: createAccessTokenAuth({ canUpload: false }),
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      const res = await controller.claim(c as any);
      expect(res.status).toBe(403);
      expect((c.responseData.body as Record<string, unknown>).error).toBe("UPLOAD_NOT_ALLOWED");
    });

    it("rejects realm mismatch (403)", async () => {
      const c = createMockContext({
        auth: createAccessTokenAuth({ realm: "usr_other" }),
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      const res = await controller.claim(c as any);
      expect(res.status).toBe(403);
      expect((c.responseData.body as Record<string, unknown>).error).toBe("REALM_MISMATCH");
    });

    it("returns 404 when node does not exist", async () => {
      mockGetNodeContent = mock(async () => null);
      controller = createClaimController({
        ownershipDb: mockOwnershipDb,
        getNodeContent: mockGetNodeContent,
        popContext: mockPopContext,
      });

      const c = createMockContext({
        auth: createAccessTokenAuth(),
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      const res = await controller.claim(c as any);
      expect(res.status).toBe(404);
      expect((c.responseData.body as Record<string, unknown>).error).toBe("NODE_NOT_FOUND");
    });

    it("returns 403 for invalid PoP", async () => {
      mockPopContext = createMockPopContext({ verifyResult: false });
      controller = createClaimController({
        ownershipDb: mockOwnershipDb,
        getNodeContent: mockGetNodeContent,
        popContext: mockPopContext,
      });

      const c = createMockContext({
        auth: createAccessTokenAuth(),
        body: { pop: "pop:WRONG" },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      const res = await controller.claim(c as any);
      expect(res.status).toBe(403);
      expect((c.responseData.body as Record<string, unknown>).error).toBe("INVALID_POP");
    });

    it("returns 400 for missing pop in body", async () => {
      const c = createMockContext({
        auth: createAccessTokenAuth(),
        body: {},
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      const res = await controller.claim(c as any);
      expect(res.status).toBe(400);
      expect((c.responseData.body as Record<string, unknown>).error).toBe("INVALID_REQUEST");
    });

    it("returns 400 for invalid JSON body", async () => {
      const c = createMockContext({
        auth: createAccessTokenAuth(),
        body: null,
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      const res = await controller.claim(c as any);
      expect(res.status).toBe(400);
      expect((c.responseData.body as Record<string, unknown>).error).toBe("INVALID_REQUEST");
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe("claim — edge cases", () => {
    it("derives delegateId from last element of issuerChain", async () => {
      const c = createMockContext({
        auth: createAccessTokenAuth({
          issuerChain: ["root", "mid", "leaf"],
        }),
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      await controller.claim(c as any);

      const body = c.responseData.body as Record<string, unknown>;
      expect(body.delegateId).toBe("leaf");
    });

    it("uses full issuerChain for ownership write", async () => {
      const chain = ["root", "mid", "leaf"];
      const c = createMockContext({
        auth: createAccessTokenAuth({
          issuerChain: chain,
        }),
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      await controller.claim(c as any);

      const call = (mockOwnershipDb.addOwnership as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[1]).toEqual(chain);
    });

    it("falls back to tokenId when issuerChain is empty", async () => {
      const c = createMockContext({
        auth: createAccessTokenAuth({
          issuerChain: [],
          tokenId: "dlt1_fallback",
        }),
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      await controller.claim(c as any);

      const body = c.responseData.body as Record<string, unknown>;
      expect(body.delegateId).toBe("dlt1_fallback");
    });

    it("passes tokenBytes from auth to verifyPoP", async () => {
      const customTokenBytes = new Uint8Array(128).fill(0x99);
      const c = createMockContext({
        auth: createAccessTokenAuth({ tokenBytes: customTokenBytes }),
        body: { pop: TEST_POP },
        params: { realmId: TEST_REALM, key: TEST_NODE_KEY },
      });

      await controller.claim(c as any);

      // blake3_256 should have been called with the custom token bytes
      const blake3_256Calls = (mockPopContext.blake3_256 as ReturnType<typeof mock>).mock.calls;
      expect(blake3_256Calls.length).toBeGreaterThan(0);
      expect(blake3_256Calls[0]![0]).toBe(customTokenBytes);
    });
  });
});
