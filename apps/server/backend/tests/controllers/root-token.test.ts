/**
 * Unit tests for Root Token Controller (JWT direct auth)
 *
 * Tests the root token creation flow:
 * - JWT auth → root delegate metadata (new delegate → 201)
 * - JWT auth → existing delegate metadata (existing delegate → 200)
 * - Realm validation
 * - Revoked root delegate handling
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Delegate } from "@casfa/delegate";
import {
  createRootTokenController,
  type RootTokenController,
} from "../../src/controllers/root-token.ts";
import type { DelegatesDb } from "../../src/db/delegates.ts";

// ============================================================================
// Mock factories
// ============================================================================

function makeFakeDelegate(
  delegateId: string,
  realm: string,
  overrides?: Partial<Delegate>
): Delegate {
  return {
    delegateId,
    realm,
    parentId: null,
    chain: [delegateId],
    depth: 0,
    canUpload: true,
    canManageDepot: true,
    isRevoked: false,
    createdAt: Date.now(),
    currentRtHash: "",
    currentAtHash: "",
    atExpiresAt: 0,
    ...overrides,
  };
}

function createMockDelegatesDb(overrides?: Partial<DelegatesDb>): DelegatesDb {
  return {
    create: mock(async () => {}),
    get: mock(async () => null),
    revoke: mock(async () => true),
    listChildren: mock(async () => ({ delegates: [], nextCursor: undefined })),
    getOrCreateRoot: mock(
      async (
        realm: string,
        delegateId: string
      ): Promise<{ delegate: Delegate; created: boolean }> => ({
        delegate: makeFakeDelegate(delegateId, realm),
        created: true,
      })
    ),
    rotateTokens: mock(async () => true),
    getRootByRealm: mock(async () => null),
    ...overrides,
  };
}

/**
 * Create a minimal Hono Context mock for testing
 */
function createMockContext(options: {
  auth?: Record<string, unknown>;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const responseData: { body?: unknown; status?: number } = {};

  const context = {
    get: mock((key: string) => {
      if (key === "auth") return options.auth;
      return undefined;
    }),
    set: mock(() => {}),
    req: {
      json: mock(async () => options.body ?? {}),
      param: mock((name: string) => options.params?.[name]),
      query: mock((name: string) => options.query?.[name]),
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

// ============================================================================
// Tests
// ============================================================================

describe("RootTokenController", () => {
  let controller: RootTokenController;
  let mockDelegatesDb: DelegatesDb;

  beforeEach(() => {
    mockDelegatesDb = createMockDelegatesDb();

    controller = createRootTokenController({
      delegatesDb: mockDelegatesDb,
    });
  });

  // --------------------------------------------------------------------------
  // Successful creation (new root delegate)
  // --------------------------------------------------------------------------

  describe("create — new root delegate (201)", () => {
    it("creates root delegate and returns metadata only (no tokens)", async () => {
      const ctx = createMockContext({
        auth: {
          type: "jwt",
          userId: "usr_user123",
          realm: "usr_user123",
          role: "authorized",
        },
        body: { realm: "usr_user123" },
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(201);
      const body = ctx.responseData.body as Record<string, unknown>;

      // Should return delegate info
      expect(body.delegate).toBeDefined();
      const delegate = body.delegate as Record<string, unknown>;
      expect(delegate.realm).toBe("usr_user123");
      expect(delegate.depth).toBe(0);
      expect(delegate.canUpload).toBe(true);
      expect(delegate.canManageDepot).toBe(true);

      // Root delegates do NOT return tokens (JWT auth is used directly)
      expect(body.refreshToken).toBeUndefined();
      expect(body.accessToken).toBeUndefined();
      expect(body.accessTokenExpiresAt).toBeUndefined();
    });

    it("uses default realm from userId when body.realm is omitted", async () => {
      const ctx = createMockContext({
        auth: {
          type: "jwt",
          userId: "usr_bob",
          realm: "usr_bob",
          role: "authorized",
        },
        body: {}, // No realm in body
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(201);
      const body = ctx.responseData.body as Record<string, unknown>;
      const delegate = body.delegate as Record<string, unknown>;
      expect(delegate.realm).toBe("usr_bob");
    });

    it("calls getOrCreateRoot with realm and delegateId (no token hashes)", async () => {
      const ctx = createMockContext({
        auth: { type: "jwt", userId: "usr_u1", realm: "usr_u1", role: "authorized" },
        body: { realm: "usr_u1" },
      });

      await controller.create(ctx as never);

      expect(mockDelegatesDb.getOrCreateRoot).toHaveBeenCalledTimes(1);
      const call = (mockDelegatesDb.getOrCreateRoot as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[0]).toBe("usr_u1"); // realm
      expect(typeof call[1]).toBe("string"); // delegateId
      // No third argument (no token hashes for root)
      expect(call[2]).toBeUndefined();
    });

    it("does NOT call rotateTokens (root delegates don't use tokens)", async () => {
      const ctx = createMockContext({
        auth: { type: "jwt", userId: "usr_u1", realm: "usr_u1", role: "authorized" },
        body: { realm: "usr_u1" },
      });

      await controller.create(ctx as never);

      expect(mockDelegatesDb.rotateTokens).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Existing root delegate (200) — no token rotation
  // --------------------------------------------------------------------------

  describe("create — existing root delegate (200)", () => {
    const existingDelegateId = "dlt_ABCDEFGHJK0000000000000000";

    beforeEach(() => {
      mockDelegatesDb = createMockDelegatesDb({
        getOrCreateRoot: mock(
          async (
            realm: string,
            _delegateId: string
          ): Promise<{ delegate: Delegate; created: boolean }> => ({
            delegate: makeFakeDelegate(existingDelegateId, realm),
            created: false,
          })
        ),
      });

      controller = createRootTokenController({
        delegatesDb: mockDelegatesDb,
      });
    });

    it("returns 200 with metadata only for existing root", async () => {
      const ctx = createMockContext({
        auth: { type: "jwt", userId: "usr_u1", realm: "usr_u1", role: "authorized" },
        body: { realm: "usr_u1" },
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(200);
      const body = ctx.responseData.body as Record<string, unknown>;

      // Only metadata, no tokens
      expect(body.refreshToken).toBeUndefined();
      expect(body.accessToken).toBeUndefined();
      expect(body.accessTokenExpiresAt).toBeUndefined();

      const delegate = body.delegate as Record<string, unknown>;
      expect(delegate.delegateId).toBe(existingDelegateId);
      expect(delegate.realm).toBe("usr_u1");
    });

    it("does NOT call rotateTokens for existing root", async () => {
      const ctx = createMockContext({
        auth: { type: "jwt", userId: "usr_u1", realm: "usr_u1", role: "authorized" },
        body: { realm: "usr_u1" },
      });

      await controller.create(ctx as never);

      expect(mockDelegatesDb.rotateTokens).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Error cases
  // --------------------------------------------------------------------------

  describe("create — errors", () => {
    it("rejects realm mismatch (400)", async () => {
      const ctx = createMockContext({
        auth: {
          type: "jwt",
          userId: "usr_alice",
          realm: "usr_alice",
          role: "authorized",
        },
        body: { realm: "usr_bob" }, // Wrong realm
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(400);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("INVALID_REALM");
    });

    it("rejects revoked root delegate (403)", async () => {
      mockDelegatesDb = createMockDelegatesDb({
        getOrCreateRoot: mock(
          async (
            realm: string,
            delegateId: string
          ): Promise<{ delegate: Delegate; created: boolean }> => ({
            delegate: makeFakeDelegate(delegateId, realm, {
              isRevoked: true,
              revokedAt: Date.now(),
              revokedBy: "admin",
              createdAt: Date.now() - 3600_000,
            }),
            created: true,
          })
        ),
      });

      controller = createRootTokenController({
        delegatesDb: mockDelegatesDb,
      });

      const ctx = createMockContext({
        auth: { type: "jwt", userId: "usr_u1", realm: "usr_u1", role: "authorized" },
        body: { realm: "usr_u1" },
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(403);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("ROOT_DELEGATE_REVOKED");
    });
  });
});
