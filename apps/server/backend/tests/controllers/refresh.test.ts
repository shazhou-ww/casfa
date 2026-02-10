/**
 * Unit tests for Refresh Controller
 *
 * Tests RT rotation flow:
 * - Valid RT → new RT + AT (rotation)
 * - Replay detection → 409 + family invalidation
 * - Missing / invalid header → 401
 * - Not-a-refresh-token → 400
 * - Revoked / expired delegate → 401
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Delegate } from "@casfa/delegate";
import {
  computeTokenId as computeTokenIdRaw,
  type DelegateTokenInput,
  encodeDelegateToken,
  formatTokenId,
} from "@casfa/delegate-token";
import { blake3 } from "@noble/hashes/blake3";
import { createRefreshController, type RefreshController } from "../../src/controllers/refresh.ts";
import type { DelegatesDb } from "../../src/db/delegates.ts";
import type {
  CreateTokenRecordInput,
  TokenRecord,
  TokenRecordsDb,
} from "../../src/db/token-records.ts";
import {
  computeRealmHash,
  computeScopeHash,
  delegateIdToIssuer,
} from "../../src/util/delegate-token-utils.ts";

// ============================================================================
// Helpers
// ============================================================================

const blake3_128 = (data: Uint8Array): Uint8Array => blake3(data, { dkLen: 16 });

const testDelegateId = "dlt_04HMASW9NF6YY0938NKRKAYDXW";
const testRealm = "usr_testuser";

async function makeRefreshToken(): Promise<{ bytes: Uint8Array; base64: string; tokenId: string }> {
  const issuer = delegateIdToIssuer(testDelegateId);
  const realmHash = computeRealmHash(testRealm);
  const scopeHash = computeScopeHash([]);

  const input: DelegateTokenInput = {
    type: "refresh",
    ttl: 0,
    canUpload: true,
    canManageDepot: true,
    issuer,
    realm: realmHash,
    scope: scopeHash,
    depth: 0,
  };

  const bytes = encodeDelegateToken(input);
  const idRaw = await computeTokenIdRaw(bytes, blake3_128);
  const tokenId = formatTokenId(idRaw);
  const base64 = Buffer.from(bytes).toString("base64");

  return { bytes, base64, tokenId };
}

async function makeAccessToken(): Promise<{ bytes: Uint8Array; base64: string; tokenId: string }> {
  const issuer = delegateIdToIssuer(testDelegateId);
  const realmHash = computeRealmHash(testRealm);
  const scopeHash = computeScopeHash([]);

  const input: DelegateTokenInput = {
    type: "access",
    ttl: Date.now() + 3600_000,
    canUpload: true,
    canManageDepot: true,
    issuer,
    realm: realmHash,
    scope: scopeHash,
    depth: 0,
  };

  const bytes = encodeDelegateToken(input);
  const idRaw = await computeTokenIdRaw(bytes, blake3_128);
  const tokenId = formatTokenId(idRaw);
  const base64 = Buffer.from(bytes).toString("base64");

  return { bytes, base64, tokenId };
}

function makeTokenRecord(tokenId: string, overrides?: Partial<TokenRecord>): TokenRecord {
  return {
    tokenId,
    tokenType: "refresh",
    delegateId: testDelegateId,
    realm: testRealm,
    expiresAt: 0,
    isUsed: false,
    isInvalidated: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeDelegate(overrides?: Partial<Delegate>): Delegate {
  return {
    delegateId: testDelegateId,
    realm: testRealm,
    parentId: null,
    chain: [testDelegateId],
    depth: 0,
    canUpload: true,
    canManageDepot: true,
    isRevoked: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// Mock factories
// ============================================================================

function createMockDelegatesDb(overrides?: Partial<DelegatesDb>): DelegatesDb {
  return {
    create: mock(async () => {}),
    get: mock(async () => makeDelegate()),
    revoke: mock(async () => true),
    listChildren: mock(async () => ({ delegates: [], nextCursor: undefined })),
    getOrCreateRoot: mock(async (realm: string, id: string) =>
      makeDelegate({ delegateId: id, realm })
    ),
    ...overrides,
  };
}

function createMockTokenRecordsDb(
  tokenRecordFn?: (tokenId: string) => TokenRecord | null,
  overrides?: Partial<TokenRecordsDb>
): TokenRecordsDb {
  return {
    create: mock(async () => {}),
    get: mock(async (tokenId: string) => tokenRecordFn?.(tokenId) ?? null),
    markUsed: mock(async () => true),
    invalidateByDelegate: mock(async () => 0),
    listByDelegate: mock(async () => ({ tokens: [], nextCursor: undefined })),
    ...overrides,
  };
}

function createMockContext(authHeader?: string) {
  const responseData: { body?: unknown; status?: number } = {};

  const context = {
    get: mock(() => undefined),
    set: mock(() => {}),
    req: {
      json: mock(async () => ({})),
      param: mock(() => undefined),
      query: mock(() => undefined),
      header: mock((name: string) => {
        if (name === "Authorization") return authHeader;
        return undefined;
      }),
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

describe("RefreshController", () => {
  let controller: RefreshController;
  let mockDelegatesDb: DelegatesDb;
  let mockTokenRecordsDb: TokenRecordsDb;

  // --------------------------------------------------------------------------
  // Successful rotation
  // --------------------------------------------------------------------------

  describe("refresh — success", () => {
    it("rotates RT: returns new RT + AT", async () => {
      const rt = await makeRefreshToken();

      mockTokenRecordsDb = createMockTokenRecordsDb((tokenId) =>
        tokenId === rt.tokenId ? makeTokenRecord(rt.tokenId) : null
      );
      mockDelegatesDb = createMockDelegatesDb();

      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(200);
      const body = ctx.responseData.body as Record<string, unknown>;

      expect(body.refreshToken).toBeDefined();
      expect(body.accessToken).toBeDefined();
      expect(body.refreshTokenId).toBeDefined();
      expect(body.accessTokenId).toBeDefined();
      expect(body.delegateId).toBe(testDelegateId);

      // New token IDs should be tkn_*
      expect((body.refreshTokenId as string).startsWith("tkn_")).toBe(true);
      expect((body.accessTokenId as string).startsWith("tkn_")).toBe(true);
    });

    it("marks old RT as used", async () => {
      const rt = await makeRefreshToken();

      mockTokenRecordsDb = createMockTokenRecordsDb((tokenId) =>
        tokenId === rt.tokenId ? makeTokenRecord(rt.tokenId) : null
      );
      mockDelegatesDb = createMockDelegatesDb();

      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(mockTokenRecordsDb.markUsed).toHaveBeenCalledWith(rt.tokenId);
    });

    it("stores 2 new token records with same delegateId", async () => {
      const rt = await makeRefreshToken();

      mockTokenRecordsDb = createMockTokenRecordsDb((tokenId) =>
        tokenId === rt.tokenId ? makeTokenRecord(rt.tokenId) : null
      );
      mockDelegatesDb = createMockDelegatesDb();

      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(mockTokenRecordsDb.create).toHaveBeenCalledTimes(2);
      const calls = (mockTokenRecordsDb.create as ReturnType<typeof mock>).mock.calls;

      const newRt = calls[0]![0] as CreateTokenRecordInput;
      const newAt = calls[1]![0] as CreateTokenRecordInput;
      expect(newRt.tokenType).toBe("refresh");
      expect(newAt.tokenType).toBe("access");
      expect(newRt.delegateId).toBe(testDelegateId);
      expect(newAt.delegateId).toBe(testDelegateId);
    });
  });

  // --------------------------------------------------------------------------
  // Error: missing/invalid auth header
  // --------------------------------------------------------------------------

  describe("refresh — auth header errors", () => {
    beforeEach(() => {
      mockDelegatesDb = createMockDelegatesDb();
      mockTokenRecordsDb = createMockTokenRecordsDb();
      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });
    });

    it("returns 401 for missing Authorization header", async () => {
      const ctx = createMockContext(undefined);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("UNAUTHORIZED");
    });

    it("returns 401 for invalid header format", async () => {
      const ctx = createMockContext("Basic abc123");
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
    });

    it("returns 401 for invalid base64", async () => {
      const ctx = createMockContext("Bearer !!!not-base64!!!");
      await controller.refresh(ctx as never);

      // Will fail at size check or base64 decode
      expect(ctx.responseData.status).toBe(401);
    });

    it("returns 401 for wrong token size", async () => {
      const tooShort = Buffer.from(new Uint8Array(64)).toString("base64");
      const ctx = createMockContext(`Bearer ${tooShort}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Error: not a refresh token
  // --------------------------------------------------------------------------

  describe("refresh — not a refresh token", () => {
    it("returns 400 for access token used as RT", async () => {
      const at = await makeAccessToken();

      mockDelegatesDb = createMockDelegatesDb();
      mockTokenRecordsDb = createMockTokenRecordsDb();
      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${at.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(400);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("NOT_REFRESH_TOKEN");
    });
  });

  // --------------------------------------------------------------------------
  // Error: token not found
  // --------------------------------------------------------------------------

  describe("refresh — token not found", () => {
    it("returns 401 when token record not in DB", async () => {
      const rt = await makeRefreshToken();

      mockDelegatesDb = createMockDelegatesDb();
      mockTokenRecordsDb = createMockTokenRecordsDb(() => null);
      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("TOKEN_NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // Error: token invalidated
  // --------------------------------------------------------------------------

  describe("refresh — token invalidated", () => {
    it("returns 401 when token family is invalidated", async () => {
      const rt = await makeRefreshToken();

      mockDelegatesDb = createMockDelegatesDb();
      mockTokenRecordsDb = createMockTokenRecordsDb((tokenId) =>
        tokenId === rt.tokenId ? makeTokenRecord(rt.tokenId, { isInvalidated: true }) : null
      );
      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("TOKEN_INVALIDATED");
    });
  });

  // --------------------------------------------------------------------------
  // Error: RT replay → 409 + delegate invalidation
  // --------------------------------------------------------------------------

  describe("refresh — replay detection", () => {
    it("returns 409 and invalidates delegate when RT is already used", async () => {
      const rt = await makeRefreshToken();

      mockDelegatesDb = createMockDelegatesDb();
      mockTokenRecordsDb = createMockTokenRecordsDb((tokenId) =>
        tokenId === rt.tokenId ? makeTokenRecord(rt.tokenId, { isUsed: true }) : null
      );
      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(409);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("TOKEN_REUSE");

      // Should have called invalidateByDelegate
      expect(mockTokenRecordsDb.invalidateByDelegate).toHaveBeenCalledWith(testDelegateId);
    });

    it("returns 409 when concurrent markUsed fails (race condition)", async () => {
      const rt = await makeRefreshToken();

      mockDelegatesDb = createMockDelegatesDb();
      mockTokenRecordsDb = createMockTokenRecordsDb(
        (tokenId) => (tokenId === rt.tokenId ? makeTokenRecord(rt.tokenId) : null),
        {
          // markUsed returns false (another request got there first)
          markUsed: mock(async () => false),
        }
      );
      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(409);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("TOKEN_REUSE");
      expect(mockTokenRecordsDb.invalidateByDelegate).toHaveBeenCalledWith(testDelegateId);
    });
  });

  // --------------------------------------------------------------------------
  // Error: delegate revoked / expired
  // --------------------------------------------------------------------------

  describe("refresh — delegate status", () => {
    it("returns 401 when delegate is revoked", async () => {
      const rt = await makeRefreshToken();

      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => makeDelegate({ isRevoked: true })),
      });
      mockTokenRecordsDb = createMockTokenRecordsDb((tokenId) =>
        tokenId === rt.tokenId ? makeTokenRecord(rt.tokenId) : null
      );
      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("DELEGATE_REVOKED");
    });

    it("returns 401 when delegate has expired", async () => {
      const rt = await makeRefreshToken();

      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => makeDelegate({ expiresAt: Date.now() - 1000 })),
      });
      mockTokenRecordsDb = createMockTokenRecordsDb((tokenId) =>
        tokenId === rt.tokenId ? makeTokenRecord(rt.tokenId) : null
      );
      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("DELEGATE_EXPIRED");
    });

    it("returns 401 when delegate not found", async () => {
      const rt = await makeRefreshToken();

      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => null),
      });
      mockTokenRecordsDb = createMockTokenRecordsDb((tokenId) =>
        tokenId === rt.tokenId ? makeTokenRecord(rt.tokenId) : null
      );
      controller = createRefreshController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
      });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("DELEGATE_NOT_FOUND");
    });
  });
});
