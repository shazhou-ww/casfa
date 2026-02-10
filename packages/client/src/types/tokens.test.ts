/**
 * Token types utility functions tests.
 */

import { describe, expect, it } from "bun:test";
import type {
  StoredAccessToken,
  StoredRootDelegate,
  StoredUserToken,
  TokenState,
} from "./tokens.ts";
import { emptyTokenState, hasValidAccessToken, rootDelegateToAccessToken } from "./tokens.ts";

// ============================================================================
// Test Helpers
// ============================================================================

const createUserToken = (overrides: Partial<StoredUserToken> = {}): StoredUserToken => ({
  accessToken: "jwt-access-token",
  refreshToken: "jwt-refresh-token",
  userId: "usr_test123",
  expiresAt: Date.now() + 3600_000,
  ...overrides,
});

const createRootDelegate = (overrides: Partial<StoredRootDelegate> = {}): StoredRootDelegate => ({
  delegateId: "dlg_root123",
  realm: "test-realm",
  refreshToken: "base64-refresh-token",
  // A valid base64 for 128 bytes (all zeros)
  accessToken: Buffer.from(new Uint8Array(128)).toString("base64"),
  accessTokenExpiresAt: Date.now() + 3600_000,
  depth: 0,
  canUpload: true,
  canManageDepot: true,
  ...overrides,
});

// ============================================================================
// emptyTokenState Tests
// ============================================================================

describe("emptyTokenState", () => {
  it("should return state with all null values", () => {
    const state = emptyTokenState();

    expect(state.user).toBe(null);
    expect(state.rootDelegate).toBe(null);
  });

  it("should return a new object each time", () => {
    const state1 = emptyTokenState();
    const state2 = emptyTokenState();

    expect(state1).not.toBe(state2);
    expect(state1).toEqual(state2);
  });
});

// ============================================================================
// rootDelegateToAccessToken Tests
// ============================================================================

describe("rootDelegateToAccessToken", () => {
  it("should extract access token view from root delegate", () => {
    // 128 bytes filled with 0x42
    const rawBytes = new Uint8Array(128).fill(0x42);
    const base64 = Buffer.from(rawBytes).toString("base64");

    const rd = createRootDelegate({
      accessToken: base64,
      accessTokenExpiresAt: 1234567890,
      canUpload: true,
      canManageDepot: false,
    });

    const at: StoredAccessToken = rootDelegateToAccessToken(rd);

    expect(at.tokenBase64).toBe(base64);
    expect(at.tokenBytes).toBeInstanceOf(Uint8Array);
    expect(at.tokenBytes.length).toBe(128);
    expect(at.tokenBytes).toEqual(rawBytes);
    expect(at.expiresAt).toBe(1234567890);
    expect(at.canUpload).toBe(true);
    expect(at.canManageDepot).toBe(false);
  });

  it("should map all fields correctly", () => {
    const rd = createRootDelegate();
    const at = rootDelegateToAccessToken(rd);

    expect(at.tokenBase64).toBe(rd.accessToken);
    expect(at.tokenBytes).toBeInstanceOf(Uint8Array);
    expect(at.tokenBytes.length).toBe(128);
    expect(at.expiresAt).toBe(rd.accessTokenExpiresAt);
    expect(at.canUpload).toBe(rd.canUpload);
    expect(at.canManageDepot).toBe(rd.canManageDepot);
  });
});

// ============================================================================
// hasValidAccessToken Tests
// ============================================================================

describe("hasValidAccessToken", () => {
  it("should return false when rootDelegate is null", () => {
    const state: TokenState = { user: null, rootDelegate: null };
    expect(hasValidAccessToken(state)).toBe(false);
  });

  it("should return true when access token is not expired", () => {
    const state: TokenState = {
      user: null,
      rootDelegate: createRootDelegate({
        accessTokenExpiresAt: Date.now() + 3600_000,
      }),
    };
    expect(hasValidAccessToken(state)).toBe(true);
  });

  it("should return false when access token is expired", () => {
    const state: TokenState = {
      user: null,
      rootDelegate: createRootDelegate({
        accessTokenExpiresAt: Date.now() - 1000,
      }),
    };
    expect(hasValidAccessToken(state)).toBe(false);
  });
});

// ============================================================================
// TokenState Type Tests
// ============================================================================

describe("TokenState structure", () => {
  it("should allow complete state with all tokens", () => {
    const state: TokenState = {
      user: createUserToken(),
      rootDelegate: createRootDelegate(),
    };

    expect(state.user).not.toBe(null);
    expect(state.rootDelegate).not.toBe(null);
  });

  it("should allow partial state with some tokens null", () => {
    const state: TokenState = {
      user: createUserToken(),
      rootDelegate: null,
    };

    expect(state.user).not.toBe(null);
    expect(state.rootDelegate).toBe(null);
  });
});

// ============================================================================
// StoredUserToken Type Tests
// ============================================================================

describe("StoredUserToken structure", () => {
  it("should have all required fields", () => {
    const token: StoredUserToken = {
      accessToken: "access",
      refreshToken: "refresh",
      userId: "usr_123",
      expiresAt: Date.now(),
    };

    expect(token.accessToken).toBe("access");
    expect(token.refreshToken).toBe("refresh");
    expect(token.userId).toBe("usr_123");
    expect(typeof token.expiresAt).toBe("number");
  });
});

// ============================================================================
// StoredRootDelegate Type Tests
// ============================================================================

describe("StoredRootDelegate structure", () => {
  it("should have all required fields", () => {
    const rd: StoredRootDelegate = {
      delegateId: "dlg_test",
      realm: "my-realm",
      refreshToken: "rt-base64",
      accessToken: "at-base64",
      accessTokenExpiresAt: Date.now() + 3600_000,
      depth: 0,
      canUpload: true,
      canManageDepot: false,
    };

    expect(rd.delegateId).toBe("dlg_test");
    expect(rd.realm).toBe("my-realm");
    expect(rd.refreshToken).toBe("rt-base64");
    expect(rd.accessToken).toBe("at-base64");
    expect(typeof rd.accessTokenExpiresAt).toBe("number");
    expect(rd.depth).toBe(0);
    expect(rd.canUpload).toBe(true);
    expect(rd.canManageDepot).toBe(false);
  });
});

// ============================================================================
// StoredAccessToken Type Tests
// ============================================================================

describe("StoredAccessToken structure", () => {
  it("should have all required fields", () => {
    const token: StoredAccessToken = {
      tokenBase64: "base64",
      tokenBytes: new Uint8Array(128),
      expiresAt: Date.now(),
      canUpload: false,
      canManageDepot: true,
    };

    expect(token.tokenBase64).toBe("base64");
    expect(token.tokenBytes).toBeInstanceOf(Uint8Array);
    expect(typeof token.expiresAt).toBe("number");
    expect(token.canUpload).toBe(false);
    expect(token.canManageDepot).toBe(true);
  });
});
