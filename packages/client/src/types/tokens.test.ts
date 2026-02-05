/**
 * Token types utility functions tests.
 */

import { describe, it, expect } from "bun:test";
import type {
  StoredUserToken,
  StoredDelegateToken,
  StoredAccessToken,
  TokenState,
} from "./tokens.ts";
import {
  emptyTokenState,
  getMaxIssuerId,
  isAccessTokenFromMaxIssuer,
  isDelegateTokenFromCurrentUser,
} from "./tokens.ts";

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

const createDelegateToken = (overrides: Partial<StoredDelegateToken> = {}): StoredDelegateToken => ({
  tokenId: "dlt1_delegate123",
  tokenBase64: "base64-delegate-token",
  type: "delegate",
  issuerId: "usr_test123",
  expiresAt: Date.now() + 3600_000,
  canUpload: true,
  canManageDepot: true,
  ...overrides,
});

const createAccessToken = (overrides: Partial<StoredAccessToken> = {}): StoredAccessToken => ({
  tokenId: "dlt1_access123",
  tokenBase64: "base64-access-token",
  type: "access",
  issuerId: "usr_test123",
  expiresAt: Date.now() + 3600_000,
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
    expect(state.delegate).toBe(null);
    expect(state.access).toBe(null);
  });

  it("should return a new object each time", () => {
    const state1 = emptyTokenState();
    const state2 = emptyTokenState();

    expect(state1).not.toBe(state2);
    expect(state1).toEqual(state2);
  });
});

// ============================================================================
// getMaxIssuerId Tests
// ============================================================================

describe("getMaxIssuerId (types module)", () => {
  it("should return null for empty state", () => {
    const state = emptyTokenState();
    expect(getMaxIssuerId(state)).toBe(null);
  });

  it("should return user userId when present", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_max" }),
      delegate: null,
      access: null,
    };
    expect(getMaxIssuerId(state)).toBe("usr_max");
  });

  it("should return user userId over delegate tokenId", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_priority" }),
      delegate: createDelegateToken({ tokenId: "dlt1_lower" }),
      access: null,
    };
    expect(getMaxIssuerId(state)).toBe("usr_priority");
  });

  it("should return delegate tokenId when user is null", () => {
    const state: TokenState = {
      user: null,
      delegate: createDelegateToken({ tokenId: "dlt1_fallback" }),
      access: null,
    };
    expect(getMaxIssuerId(state)).toBe("dlt1_fallback");
  });

  it("should return null when both user and delegate are null", () => {
    const state: TokenState = {
      user: null,
      delegate: null,
      access: createAccessToken(),
    };
    expect(getMaxIssuerId(state)).toBe(null);
  });
});

// ============================================================================
// isAccessTokenFromMaxIssuer Tests
// ============================================================================

describe("isAccessTokenFromMaxIssuer (types module)", () => {
  it("should return false when access token is null", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: null,
      access: null,
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(false);
  });

  it("should return false when no max issuer exists", () => {
    const state: TokenState = {
      user: null,
      delegate: null,
      access: createAccessToken(),
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(false);
  });

  it("should return true when access issuerId matches user userId", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_match" }),
      delegate: null,
      access: createAccessToken({ issuerId: "usr_match" }),
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(true);
  });

  it("should return false when access issuerId does not match", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_new" }),
      delegate: null,
      access: createAccessToken({ issuerId: "usr_old" }),
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(false);
  });

  it("should match against delegate when user is null", () => {
    const state: TokenState = {
      user: null,
      delegate: createDelegateToken({ tokenId: "dlt1_issuer" }),
      access: createAccessToken({ issuerId: "dlt1_issuer" }),
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(true);
  });
});

// ============================================================================
// isDelegateTokenFromCurrentUser Tests
// ============================================================================

describe("isDelegateTokenFromCurrentUser (types module)", () => {
  it("should return false when delegate token is null", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: null,
      access: null,
    };
    expect(isDelegateTokenFromCurrentUser(state)).toBe(false);
  });

  it("should return false when user token is null", () => {
    const state: TokenState = {
      user: null,
      delegate: createDelegateToken(),
      access: null,
    };
    expect(isDelegateTokenFromCurrentUser(state)).toBe(false);
  });

  it("should return true when delegate issuerId matches user userId", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_owner" }),
      delegate: createDelegateToken({ issuerId: "usr_owner" }),
      access: null,
    };
    expect(isDelegateTokenFromCurrentUser(state)).toBe(true);
  });

  it("should return false when delegate issuerId does not match user", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_current" }),
      delegate: createDelegateToken({ issuerId: "usr_previous" }),
      access: null,
    };
    expect(isDelegateTokenFromCurrentUser(state)).toBe(false);
  });
});

// ============================================================================
// TokenState Type Tests
// ============================================================================

describe("TokenState structure", () => {
  it("should allow complete state with all tokens", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: createDelegateToken(),
      access: createAccessToken(),
    };

    expect(state.user).not.toBe(null);
    expect(state.delegate).not.toBe(null);
    expect(state.access).not.toBe(null);
  });

  it("should allow partial state with some tokens null", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: null,
      access: createAccessToken(),
    };

    expect(state.user).not.toBe(null);
    expect(state.delegate).toBe(null);
    expect(state.access).not.toBe(null);
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
// StoredDelegateToken Type Tests
// ============================================================================

describe("StoredDelegateToken structure", () => {
  it("should have type as 'delegate'", () => {
    const token = createDelegateToken();
    expect(token.type).toBe("delegate");
  });

  it("should have all required fields", () => {
    const token: StoredDelegateToken = {
      tokenId: "dlt1_test",
      tokenBase64: "base64",
      type: "delegate",
      issuerId: "usr_issuer",
      expiresAt: Date.now(),
      canUpload: true,
      canManageDepot: false,
    };

    expect(token.tokenId).toBe("dlt1_test");
    expect(token.tokenBase64).toBe("base64");
    expect(token.issuerId).toBe("usr_issuer");
    expect(token.canUpload).toBe(true);
    expect(token.canManageDepot).toBe(false);
  });
});

// ============================================================================
// StoredAccessToken Type Tests
// ============================================================================

describe("StoredAccessToken structure", () => {
  it("should have type as 'access'", () => {
    const token = createAccessToken();
    expect(token.type).toBe("access");
  });

  it("should have all required fields", () => {
    const token: StoredAccessToken = {
      tokenId: "dlt1_access",
      tokenBase64: "base64",
      type: "access",
      issuerId: "dlt1_parent",
      expiresAt: Date.now(),
      canUpload: false,
      canManageDepot: true,
    };

    expect(token.tokenId).toBe("dlt1_access");
    expect(token.type).toBe("access");
    expect(token.canUpload).toBe(false);
    expect(token.canManageDepot).toBe(true);
  });
});
