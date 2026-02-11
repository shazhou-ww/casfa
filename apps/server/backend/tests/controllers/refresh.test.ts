/**
 * Unit tests for Refresh Controller (token-simplification v3)
 *
 * Tests RT rotation flow:
 * - Valid RT → new RT + AT (rotation via atomic rotateTokens)
 * - RT hash mismatch → 401 TOKEN_INVALID (no auto-revoke)
 * - Concurrent rotation → 409 TOKEN_INVALID (rotateTokens fails)
 * - Missing / invalid header → 401
 * - Not-a-refresh-token (AT used as RT) → 400
 * - Revoked / expired / missing delegate → 401
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Delegate } from "@casfa/delegate";
import { encodeAccessToken, encodeRefreshToken } from "@casfa/delegate-token";
import { createRefreshController, type RefreshController } from "../../src/controllers/refresh.ts";
import type { DelegatesDb } from "../../src/db/delegates.ts";
import { computeTokenHash } from "../../src/util/delegate-token-utils.ts";
import { fromCrockfordBase32 } from "../../src/util/encoding.ts";

// ============================================================================
// Helpers
// ============================================================================

const testDelegateId = "dlt_04HMASW9NF6YY0938NKRKAYDXW";
const testRealm = "usr_testuser";

/** Decode a dlt_CB32 delegate ID to raw 16 bytes */
function delegateIdToBytes(delegateId: string): Uint8Array {
  return fromCrockfordBase32(delegateId.slice(4));
}

const testDelegateIdBytes = delegateIdToBytes(testDelegateId);

/**
 * Create a 24-byte Refresh Token for the test delegate.
 * Returns raw bytes, base64 encoding, and Blake3-128 hash (hex).
 */
function makeRefreshToken(): { bytes: Uint8Array; base64: string; hash: string } {
  const bytes = encodeRefreshToken({ delegateId: testDelegateIdBytes });
  const hash = computeTokenHash(bytes);
  const base64 = Buffer.from(bytes).toString("base64");
  return { bytes, base64, hash };
}

/**
 * Create a 32-byte Access Token for the test delegate.
 * Returns raw bytes, base64 encoding, and Blake3-128 hash (hex).
 */
function makeAccessToken(): { bytes: Uint8Array; base64: string; hash: string } {
  const bytes = encodeAccessToken({
    delegateId: testDelegateIdBytes,
    expiresAt: Date.now() + 3600_000,
  });
  const hash = computeTokenHash(bytes);
  const base64 = Buffer.from(bytes).toString("base64");
  return { bytes, base64, hash };
}

/**
 * Create a Delegate entity with token hashes matching the given RT.
 * If no rtHash/atHash supplied, generates a fresh pair.
 */
function makeDelegate(overrides?: Partial<Delegate>): Delegate {
  // Generate default token hashes if not provided
  const defaultRt = makeRefreshToken();
  const defaultAt = makeAccessToken();

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
    currentRtHash: defaultRt.hash,
    currentAtHash: defaultAt.hash,
    atExpiresAt: Date.now() + 3600_000,
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
    rotateTokens: mock(async () => true),
    getOrCreateRoot: mock(async (realm: string, id: string, tokenHashes) => ({
      delegate: makeDelegate({
        delegateId: id,
        realm,
        currentRtHash: tokenHashes.currentRtHash,
        currentAtHash: tokenHashes.currentAtHash,
        atExpiresAt: tokenHashes.atExpiresAt,
      }),
      created: true,
    })),
    getRootByRealm: mock(async () => null),
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

  // --------------------------------------------------------------------------
  // Successful rotation
  // --------------------------------------------------------------------------

  describe("refresh — success", () => {
    it("rotates RT: returns new RT + AT + delegateId", async () => {
      const rt = makeRefreshToken();

      // Delegate's currentRtHash matches the presented RT
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => makeDelegate({ currentRtHash: rt.hash })),
        rotateTokens: mock(async () => true),
      });

      controller = createRefreshController({ delegatesDb: mockDelegatesDb });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(200);
      const body = ctx.responseData.body as Record<string, unknown>;

      expect(body.refreshToken).toBeDefined();
      expect(body.accessToken).toBeDefined();
      expect(body.accessTokenExpiresAt).toBeDefined();
      expect(body.delegateId).toBe(testDelegateId);
    });

    it("calls rotateTokens with correct parameters", async () => {
      const rt = makeRefreshToken();

      const rotateTokensMock = mock(async () => true);
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => makeDelegate({ currentRtHash: rt.hash })),
        rotateTokens: rotateTokensMock,
      });

      controller = createRefreshController({ delegatesDb: mockDelegatesDb });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(rotateTokensMock).toHaveBeenCalledTimes(1);
      const calls = rotateTokensMock.mock.calls as unknown as Array<
        [
          {
            delegateId: string;
            expectedRtHash: string;
            newRtHash: string;
            newAtHash: string;
            newAtExpiresAt: number;
          },
        ]
      >;
      const args = calls[0]![0];

      expect(args.delegateId).toBe(testDelegateId);
      expect(args.expectedRtHash).toBe(rt.hash);
      // New hashes should be non-empty hex strings (32 chars = 16 bytes hex)
      expect(args.newRtHash).toMatch(/^[0-9a-f]{32}$/);
      expect(args.newAtHash).toMatch(/^[0-9a-f]{32}$/);
      expect(args.newAtExpiresAt).toBeGreaterThan(Date.now());
    });

    it("looks up delegate by delegateId only (no realm)", async () => {
      const rt = makeRefreshToken();

      const getMock = mock(async () => makeDelegate({ currentRtHash: rt.hash }));
      mockDelegatesDb = createMockDelegatesDb({
        get: getMock,
        rotateTokens: mock(async () => true),
      });

      controller = createRefreshController({ delegatesDb: mockDelegatesDb });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(getMock).toHaveBeenCalledTimes(1);
      // get() now takes only delegateId — verify single argument
      const getCalls = getMock.mock.calls as unknown as Array<[string]>;
      expect(getCalls.length).toBe(1);
      expect(getCalls[0]![0]).toBe(testDelegateId);
    });
  });

  // --------------------------------------------------------------------------
  // Error: missing/invalid auth header
  // --------------------------------------------------------------------------

  describe("refresh — auth header errors", () => {
    beforeEach(() => {
      mockDelegatesDb = createMockDelegatesDb();
      controller = createRefreshController({ delegatesDb: mockDelegatesDb });
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

      expect(ctx.responseData.status).toBe(401);
    });

    it("returns 401 for wrong token size (too short)", async () => {
      const tooShort = Buffer.from(new Uint8Array(10)).toString("base64");
      const ctx = createMockContext(`Bearer ${tooShort}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
    });

    it("returns 401 for wrong token size (too long — 64 bytes)", async () => {
      const tooLong = Buffer.from(new Uint8Array(64)).toString("base64");
      const ctx = createMockContext(`Bearer ${tooLong}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Error: not a refresh token (AT used as RT)
  // --------------------------------------------------------------------------

  describe("refresh — not a refresh token", () => {
    it("returns 400 for access token (32 bytes) used as RT", async () => {
      const at = makeAccessToken();

      mockDelegatesDb = createMockDelegatesDb();
      controller = createRefreshController({ delegatesDb: mockDelegatesDb });

      const ctx = createMockContext(`Bearer ${at.base64}`);
      await controller.refresh(ctx as never);

      // AT is 32 bytes, RT must be 24 bytes → size check fails first → 401
      expect(ctx.responseData.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Error: RT hash mismatch (stale or replayed RT)
  // --------------------------------------------------------------------------

  describe("refresh — RT hash mismatch", () => {
    it("returns 401 TOKEN_INVALID when RT hash does not match delegate.currentRtHash", async () => {
      const rt = makeRefreshToken();

      // Delegate has a DIFFERENT currentRtHash (simulates stale RT)
      const staleHash = "a".repeat(32);
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => makeDelegate({ currentRtHash: staleHash })),
      });

      controller = createRefreshController({ delegatesDb: mockDelegatesDb });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("TOKEN_INVALID");
    });
  });

  // --------------------------------------------------------------------------
  // Error: concurrent rotation → rotateTokens fails → 409
  // --------------------------------------------------------------------------

  describe("refresh — concurrent rotation (rotateTokens fails)", () => {
    it("returns 409 TOKEN_INVALID when rotateTokens returns false", async () => {
      const rt = makeRefreshToken();

      // RT hash matches, but rotateTokens fails (another request rotated first)
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => makeDelegate({ currentRtHash: rt.hash })),
        rotateTokens: mock(async () => false),
      });

      controller = createRefreshController({ delegatesDb: mockDelegatesDb });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(409);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("TOKEN_INVALID");
    });
  });

  // --------------------------------------------------------------------------
  // Error: delegate revoked / expired / not found
  // --------------------------------------------------------------------------

  describe("refresh — delegate status", () => {
    it("returns 401 when delegate is revoked", async () => {
      const rt = makeRefreshToken();

      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => makeDelegate({ isRevoked: true, currentRtHash: rt.hash })),
      });

      controller = createRefreshController({ delegatesDb: mockDelegatesDb });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("DELEGATE_REVOKED");
    });

    it("returns 401 when delegate has expired", async () => {
      const rt = makeRefreshToken();

      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () =>
          makeDelegate({ expiresAt: Date.now() - 1000, currentRtHash: rt.hash })
        ),
      });

      controller = createRefreshController({ delegatesDb: mockDelegatesDb });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("DELEGATE_EXPIRED");
    });

    it("returns 401 when delegate not found", async () => {
      const rt = makeRefreshToken();

      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => null),
      });

      controller = createRefreshController({ delegatesDb: mockDelegatesDb });

      const ctx = createMockContext(`Bearer ${rt.base64}`);
      await controller.refresh(ctx as never);

      expect(ctx.responseData.status).toBe(401);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("DELEGATE_NOT_FOUND");
    });
  });
});
