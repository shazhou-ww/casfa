/**
 * Unit tests for Root Token Controller
 *
 * Tests the root token creation flow:
 * - JWT auth → root delegate + RT + AT
 * - Realm validation
 * - Revoked root delegate handling
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Delegate } from "@casfa/delegate";
import {
  createRootTokenController,
  type RootTokenController,
  type RootTokenControllerDeps,
} from "../../src/controllers/root-token.ts";
import type { DelegatesDb } from "../../src/db/delegates.ts";
import type { TokenRecordsDb } from "../../src/db/token-records.ts";

// ============================================================================
// Mock factories
// ============================================================================

function createMockDelegatesDb(overrides?: Partial<DelegatesDb>): DelegatesDb {
  return {
    create: mock(async () => {}),
    get: mock(async () => null),
    revoke: mock(async () => true),
    listChildren: mock(async () => ({ delegates: [], nextCursor: undefined })),
    getOrCreateRoot: mock(async (realm: string, delegateId: string): Promise<Delegate> => ({
      delegateId,
      realm,
      parentId: null,
      chain: [delegateId],
      depth: 0,
      canUpload: true,
      canManageDepot: true,
      isRevoked: false,
      createdAt: Date.now(),
    })),
    ...overrides,
  };
}

function createMockTokenRecordsDb(overrides?: Partial<TokenRecordsDb>): TokenRecordsDb {
  return {
    create: mock(async () => {}),
    get: mock(async () => null),
    markUsed: mock(async () => true),
    invalidateFamily: mock(async () => 0),
    listByDelegate: mock(async () => ({ tokens: [], nextCursor: undefined })),
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
      param: mock((name: string) => (options.params ?? {})[name]),
      query: mock((name: string) => (options.query ?? {})[name]),
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
  let mockTokenRecordsDb: TokenRecordsDb;

  beforeEach(() => {
    mockDelegatesDb = createMockDelegatesDb();
    mockTokenRecordsDb = createMockTokenRecordsDb();

    controller = createRootTokenController({
      delegatesDb: mockDelegatesDb,
      tokenRecordsDb: mockTokenRecordsDb,
    });
  });

  // --------------------------------------------------------------------------
  // Successful creation
  // --------------------------------------------------------------------------

  describe("create — success", () => {
    it("creates root delegate and returns RT + AT pair", async () => {
      const ctx = createMockContext({
        auth: {
          type: "jwt",
          userId: "user123",
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

      // Should return tokens
      expect(body.refreshToken).toBeDefined();
      expect(body.accessToken).toBeDefined();
      expect(body.refreshTokenId).toBeDefined();
      expect(body.accessTokenId).toBeDefined();
      expect(body.accessTokenExpiresAt).toBeGreaterThan(Date.now());

      // Token IDs should have dlt1_ prefix
      expect((body.refreshTokenId as string).startsWith("dlt1_")).toBe(true);
      expect((body.accessTokenId as string).startsWith("dlt1_")).toBe(true);
    });

    it("uses default realm from userId when body.realm is omitted", async () => {
      const ctx = createMockContext({
        auth: {
          type: "jwt",
          userId: "bob",
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

    it("calls getOrCreateRoot with correct realm", async () => {
      const ctx = createMockContext({
        auth: { type: "jwt", userId: "u1", realm: "usr_u1", role: "authorized" },
        body: { realm: "usr_u1" },
      });

      await controller.create(ctx as never);

      expect(mockDelegatesDb.getOrCreateRoot).toHaveBeenCalledTimes(1);
      const call = (mockDelegatesDb.getOrCreateRoot as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[0]).toBe("usr_u1");
    });

    it("stores 2 token records (RT + AT)", async () => {
      const ctx = createMockContext({
        auth: { type: "jwt", userId: "u1", realm: "usr_u1", role: "authorized" },
        body: { realm: "usr_u1" },
      });

      await controller.create(ctx as never);

      expect(mockTokenRecordsDb.create).toHaveBeenCalledTimes(2);
      const calls = (mockTokenRecordsDb.create as ReturnType<typeof mock>).mock.calls;

      // First call: RT record
      const rtRecord = calls[0]![0] as Record<string, unknown>;
      expect(rtRecord.tokenType).toBe("refresh");
      expect(rtRecord.expiresAt).toBe(0);

      // Second call: AT record
      const atRecord = calls[1]![0] as Record<string, unknown>;
      expect(atRecord.tokenType).toBe("access");
      expect(atRecord.expiresAt).toBeGreaterThan(0);

      // Both should share the same familyId
      expect(rtRecord.familyId).toBe(atRecord.familyId);
    });
  });

  // --------------------------------------------------------------------------
  // Error cases
  // --------------------------------------------------------------------------

  describe("create — errors", () => {
    it("rejects realm mismatch (403)", async () => {
      const ctx = createMockContext({
        auth: {
          type: "jwt",
          userId: "alice",
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
        getOrCreateRoot: mock(async (realm: string, delegateId: string): Promise<Delegate> => ({
          delegateId,
          realm,
          parentId: null,
          chain: [delegateId],
          depth: 0,
          canUpload: true,
          canManageDepot: true,
          isRevoked: true,
          revokedAt: Date.now(),
          revokedBy: "admin",
          createdAt: Date.now() - 3600_000,
        })),
      });

      controller = createRootTokenController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext({
        auth: { type: "jwt", userId: "u1", realm: "usr_u1", role: "authorized" },
        body: { realm: "usr_u1" },
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(403);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("ROOT_DELEGATE_REVOKED");
    });
  });
});
