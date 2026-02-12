/**
 * Unit tests for Access Token Authentication Middleware
 *
 * Tests both authentication paths:
 *
 * JWT path (root delegate):
 * - JWT verification failure → 401
 * - JWT expired → 401
 * - Unauthorized user → 403
 * - Root delegate not found → 401
 * - Root delegate revoked → 401
 * - Valid JWT → sets correct AccessTokenAuthContext
 *
 * AT path (child delegate):
 * - Invalid Base64 → 401
 * - Wrong token size → 401
 * - Delegate not found → 401
 * - Delegate revoked → 401
 * - Delegate expired → 401
 * - AT hash mismatch → 401
 * - AT expired → 401
 * - Valid AT → sets correct AccessTokenAuthContext
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Delegate } from "@casfa/delegate";
import { encodeAccessToken } from "@casfa/delegate-token";
import {
  createAccessTokenMiddleware,
  type AccessTokenMiddlewareDeps,
} from "../../src/middleware/access-token-auth.ts";
import type { DelegatesDb } from "../../src/db/delegates.ts";
import type { UserRolesDb } from "../../src/db/user-roles.ts";
import type { JwtVerifier } from "../../src/middleware/jwt-auth.ts";
import { computeTokenHash, bytesToDelegateId } from "../../src/util/delegate-token-utils.ts";
import { fromCrockfordBase32 } from "../../src/util/encoding.ts";

// ============================================================================
// Test Constants
// ============================================================================

const TEST_USER_ID = "usr_testuser123";
const TEST_REALM = TEST_USER_ID; // realm = userId
const ROOT_DELEGATE_ID = "dlt_ROOT00000000000000000000";
const CHILD_DELEGATE_ID = "dlt_04HMASW9NF6YY0938NKRKAYDXW";
const CHILD_DELEGATE_ID_BYTES = fromCrockfordBase32(CHILD_DELEGATE_ID.slice(4));

// ============================================================================
// Helpers
// ============================================================================

function makeRootDelegate(overrides?: Partial<Delegate>): Delegate {
  return {
    delegateId: ROOT_DELEGATE_ID,
    realm: TEST_REALM,
    parentId: null,
    chain: [ROOT_DELEGATE_ID],
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

function makeChildDelegate(overrides?: Partial<Delegate>): Delegate {
  const at = makeAccessToken();
  return {
    delegateId: CHILD_DELEGATE_ID,
    realm: TEST_REALM,
    parentId: ROOT_DELEGATE_ID,
    chain: [ROOT_DELEGATE_ID, CHILD_DELEGATE_ID],
    depth: 1,
    canUpload: true,
    canManageDepot: false,
    isRevoked: false,
    createdAt: Date.now(),
    currentRtHash: "a".repeat(32),
    currentAtHash: at.hash,
    atExpiresAt: Date.now() + 3600_000,
    ...overrides,
  };
}

function makeAccessToken(): { bytes: Uint8Array; base64: string; hash: string } {
  const bytes = encodeAccessToken({
    delegateId: CHILD_DELEGATE_ID_BYTES,
    expiresAt: Date.now() + 3600_000,
  });
  const hash = computeTokenHash(bytes);
  const base64 = Buffer.from(bytes).toString("base64");
  return { bytes, base64, hash };
}

// ============================================================================
// Mock Factories
// ============================================================================

function createMockDelegatesDb(overrides?: Partial<DelegatesDb>): DelegatesDb {
  return {
    create: mock(async () => {}),
    get: mock(async () => null),
    revoke: mock(async () => true),
    listChildren: mock(async () => ({ delegates: [], nextCursor: undefined })),
    rotateTokens: mock(async () => true),
    getOrCreateRoot: mock(async (realm: string, id: string) => ({
      delegate: makeRootDelegate({ delegateId: id, realm }),
      created: true,
    })),
    getRootByRealm: mock(async () => null),
    ...overrides,
  };
}

function createMockUserRolesDb(overrides?: Partial<UserRolesDb>): UserRolesDb {
  return {
    getRole: mock(async () => "authorized" as const),
    setRole: mock(async () => {}),
    revoke: mock(async () => {}),
    listRoles: mock(async () => []),
    ...overrides,
  };
}

function createMockJwtVerifier(
  result: { userId: string; exp?: number } | null = { userId: TEST_USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 }
): JwtVerifier {
  return mock(async () => result);
}

/**
 * Create a minimal Hono context mock
 */
function createMockContext(authHeader?: string) {
  const responseData: { body?: unknown; status?: number } = {};
  let authValue: unknown = undefined;

  const context = {
    req: {
      header: mock((name: string) => {
        if (name === "Authorization") return authHeader;
        return undefined;
      }),
    },
    get: mock((key: string) => {
      if (key === "auth") return authValue;
      return undefined;
    }),
    set: mock((key: string, value: unknown) => {
      if (key === "auth") authValue = value;
    }),
    json: mock((body: unknown, status?: number) => {
      responseData.body = body;
      responseData.status = status ?? 200;
      return new Response(JSON.stringify(body), { status: status ?? 200 });
    }),
    responseData,
    getAuthValue: () => authValue,
  };

  return context;
}

// ============================================================================
// Tests
// ============================================================================

describe("AccessTokenMiddleware", () => {
  // ==========================================================================
  // Common setup
  // ==========================================================================

  describe("header validation", () => {
    it("returns 401 when Authorization header is missing", async () => {
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb(),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext(undefined);
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("UNAUTHORIZED");
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 for invalid Authorization format", async () => {
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb(),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext("Basic dXNlcjpwYXNz");
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // JWT Auth Path
  // ==========================================================================

  describe("JWT auth path", () => {
    it("returns 401 when JWT verification fails (invalid signature)", async () => {
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb(),
        jwtVerifier: mock(async () => { throw new Error("signature mismatch"); }),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext("Bearer invalid.jwt.token");
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("UNAUTHORIZED");
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when JWT verification returns null", async () => {
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb(),
        jwtVerifier: createMockJwtVerifier(null),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext("Bearer some.jwt.token");
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("UNAUTHORIZED");
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when JWT is expired", async () => {
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb(),
        jwtVerifier: createMockJwtVerifier({
          userId: TEST_USER_ID,
          exp: 1, // expired (epoch second 1)
        }),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext("Bearer expired.jwt.token");
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("TOKEN_EXPIRED");
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when user is unauthorized", async () => {
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb(),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb({
          getRole: mock(async () => "unauthorized" as const),
        }),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext("Bearer valid.jwt.token");
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(403);
      expect((c.responseData.body as any).error).toBe("FORBIDDEN");
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when root delegate does not exist", async () => {
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb({
          getRootByRealm: mock(async () => null),
        }),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext("Bearer valid.jwt.token");
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("ROOT_DELEGATE_NOT_FOUND");
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when root delegate is revoked", async () => {
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb({
          getRootByRealm: mock(async () =>
            makeRootDelegate({ isRevoked: true, revokedAt: Date.now() })
          ),
        }),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext("Bearer valid.jwt.token");
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("DELEGATE_REVOKED");
      expect(next).not.toHaveBeenCalled();
    });

    it("sets correct AccessTokenAuthContext for valid JWT", async () => {
      const rootDelegate = makeRootDelegate();
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb({
          getRootByRealm: mock(async () => rootDelegate),
        }),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext("Bearer valid.jwt.token");
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(c.set).toHaveBeenCalledWith("auth", expect.objectContaining({
        type: "access",
        delegateId: ROOT_DELEGATE_ID,
        realm: TEST_REALM,
        canUpload: true,
        canManageDepot: true,
      }));

      // Verify tokenBytes is empty (JWT has no binary token)
      const authCall = (c.set as ReturnType<typeof mock>).mock.calls.find(
        (call: unknown[]) => call[0] === "auth"
      );
      const auth = authCall![1] as any;
      expect(auth.tokenBytes).toEqual(new Uint8Array(0));
      expect(auth.delegate.depth).toBe(0);
      expect(auth.issuerChain).toEqual([ROOT_DELEGATE_ID]);
    });
  });

  // ==========================================================================
  // AT Auth Path
  // ==========================================================================

  describe("AT auth path", () => {
    it("returns 401 for invalid Base64 encoding", async () => {
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb(),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      // A string without '.' that isn't valid base64 of correct length
      const c = createMockContext("Bearer !!!invalid!!!");
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when delegate is not found", async () => {
      const at = makeAccessToken();
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb({
          get: mock(async () => null),
        }),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext(`Bearer ${at.base64}`);
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("DELEGATE_NOT_FOUND");
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when delegate is revoked", async () => {
      const at = makeAccessToken();
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb({
          get: mock(async () =>
            makeChildDelegate({ isRevoked: true, revokedAt: Date.now() })
          ),
        }),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext(`Bearer ${at.base64}`);
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("DELEGATE_REVOKED");
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when delegate has expired", async () => {
      const at = makeAccessToken();
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb({
          get: mock(async () =>
            makeChildDelegate({
              expiresAt: Date.now() - 1000, // expired 1 second ago
              currentAtHash: at.hash,
            })
          ),
        }),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext(`Bearer ${at.base64}`);
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("DELEGATE_EXPIRED");
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when AT hash does not match", async () => {
      const at = makeAccessToken();
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb({
          get: mock(async () =>
            makeChildDelegate({ currentAtHash: "wrong_hash_value" })
          ),
        }),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext(`Bearer ${at.base64}`);
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("TOKEN_INVALID");
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when AT has expired (atExpiresAt)", async () => {
      const at = makeAccessToken();
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb({
          get: mock(async () =>
            makeChildDelegate({
              currentAtHash: at.hash,
              atExpiresAt: Date.now() - 1000, // expired
            })
          ),
        }),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext(`Bearer ${at.base64}`);
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(c.responseData.status).toBe(401);
      expect((c.responseData.body as any).error).toBe("TOKEN_EXPIRED");
      expect(next).not.toHaveBeenCalled();
    });

    it("sets correct AccessTokenAuthContext for valid AT", async () => {
      const at = makeAccessToken();
      const delegate = makeChildDelegate({ currentAtHash: at.hash });
      const deps: AccessTokenMiddlewareDeps = {
        delegatesDb: createMockDelegatesDb({
          get: mock(async () => delegate),
        }),
        jwtVerifier: createMockJwtVerifier(),
        userRolesDb: createMockUserRolesDb(),
      };
      const middleware = createAccessTokenMiddleware(deps);
      const c = createMockContext(`Bearer ${at.base64}`);
      const next = mock(async () => {});

      await middleware(c as any, next);

      expect(next).toHaveBeenCalledTimes(1);

      const authCall = (c.set as ReturnType<typeof mock>).mock.calls.find(
        (call: unknown[]) => call[0] === "auth"
      );
      const auth = authCall![1] as any;
      expect(auth.type).toBe("access");
      expect(auth.delegateId).toBe(CHILD_DELEGATE_ID);
      expect(auth.realm).toBe(TEST_REALM);
      expect(auth.delegate.depth).toBe(1);
      expect(auth.tokenBytes).toEqual(at.bytes);
      expect(auth.canUpload).toBe(true);
      expect(auth.canManageDepot).toBe(false);
      expect(auth.issuerChain).toEqual([ROOT_DELEGATE_ID, CHILD_DELEGATE_ID]);
    });
  });
});
