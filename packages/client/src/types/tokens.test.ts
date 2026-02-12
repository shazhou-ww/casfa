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
import { emptyTokenState } from "./tokens.ts";

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
// StoredRootDelegate Type Tests (metadata only — no RT/AT)
// ============================================================================

describe("StoredRootDelegate structure", () => {
  it("should have all required fields", () => {
    const rd: StoredRootDelegate = {
      delegateId: "dlg_test",
      realm: "my-realm",
      depth: 0,
      canUpload: true,
      canManageDepot: false,
    };

    expect(rd.delegateId).toBe("dlg_test");
    expect(rd.realm).toBe("my-realm");
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
      tokenBytes: new Uint8Array(32),
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
