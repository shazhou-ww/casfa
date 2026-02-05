/**
 * Token validity and issuer consistency checks tests.
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import type {
  StoredAccessToken,
  StoredDelegateToken,
  StoredUserToken,
  TokenState,
} from "../types/tokens.ts";
import { emptyTokenState } from "../types/tokens.ts";
import {
  DEFAULT_EXPIRY_BUFFER_MS,
  getMaxIssuerId,
  isAccessTokenFromMaxIssuer,
  isAccessTokenValid,
  isDelegateTokenFromCurrentUser,
  isDelegateTokenValid,
  isTokenExpiringSoon,
  isTokenValid,
  isUserTokenValid,
  shouldReissueAccessToken,
  shouldReissueDelegateToken,
} from "./token-checks.ts";

// ============================================================================
// Test Helpers
// ============================================================================

const createUserToken = (overrides: Partial<StoredUserToken> = {}): StoredUserToken => ({
  accessToken: "jwt-access-token",
  refreshToken: "jwt-refresh-token",
  userId: "usr_test123",
  expiresAt: Date.now() + 3600_000, // 1 hour from now
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
// isTokenValid Tests
// ============================================================================

describe("isTokenValid", () => {
  it("should return false for null token", () => {
    expect(isTokenValid(null)).toBe(false);
  });

  it("should return true for valid unexpired token", () => {
    const token = { expiresAt: Date.now() + 3600_000 };
    expect(isTokenValid(token)).toBe(true);
  });

  it("should return false for expired token", () => {
    const token = { expiresAt: Date.now() - 1000 };
    expect(isTokenValid(token)).toBe(false);
  });

  it("should return false for token expiring within buffer", () => {
    // Token expires in 30 seconds, buffer is 60 seconds
    const token = { expiresAt: Date.now() + 30_000 };
    expect(isTokenValid(token, DEFAULT_EXPIRY_BUFFER_MS)).toBe(false);
  });

  it("should respect custom buffer", () => {
    // Token expires in 30 seconds
    const token = { expiresAt: Date.now() + 30_000 };
    // With 10 second buffer, should be valid
    expect(isTokenValid(token, 10_000)).toBe(true);
    // With 60 second buffer, should be invalid
    expect(isTokenValid(token, 60_000)).toBe(false);
  });

  it("should use default buffer of 60 seconds", () => {
    expect(DEFAULT_EXPIRY_BUFFER_MS).toBe(60_000);
  });
});

// ============================================================================
// isTokenExpiringSoon Tests
// ============================================================================

describe("isTokenExpiringSoon", () => {
  it("should return false for null token", () => {
    expect(isTokenExpiringSoon(null)).toBe(false);
  });

  it("should return false for token with plenty of time left", () => {
    const token = { expiresAt: Date.now() + 30 * 60_000 }; // 30 minutes
    expect(isTokenExpiringSoon(token)).toBe(false);
  });

  it("should return true for token expiring within 5 minutes", () => {
    const token = { expiresAt: Date.now() + 3 * 60_000 }; // 3 minutes
    expect(isTokenExpiringSoon(token)).toBe(true);
  });

  it("should respect custom window", () => {
    const token = { expiresAt: Date.now() + 3 * 60_000 }; // 3 minutes
    // With 2 minute window, should not be expiring soon
    expect(isTokenExpiringSoon(token, 2 * 60_000)).toBe(false);
    // With 10 minute window, should be expiring soon
    expect(isTokenExpiringSoon(token, 10 * 60_000)).toBe(true);
  });

  it("should return true for already expired token", () => {
    const token = { expiresAt: Date.now() - 1000 };
    expect(isTokenExpiringSoon(token)).toBe(true);
  });
});

// ============================================================================
// isUserTokenValid Tests
// ============================================================================

describe("isUserTokenValid", () => {
  it("should return false for null", () => {
    expect(isUserTokenValid(null)).toBe(false);
  });

  it("should return true for valid user token", () => {
    const token = createUserToken();
    expect(isUserTokenValid(token)).toBe(true);
  });

  it("should return false for expired user token", () => {
    const token = createUserToken({ expiresAt: Date.now() - 1000 });
    expect(isUserTokenValid(token)).toBe(false);
  });

  it("should pass buffer to underlying check", () => {
    const token = createUserToken({ expiresAt: Date.now() + 30_000 });
    expect(isUserTokenValid(token, 10_000)).toBe(true);
    expect(isUserTokenValid(token, 60_000)).toBe(false);
  });
});

// ============================================================================
// isDelegateTokenValid Tests
// ============================================================================

describe("isDelegateTokenValid", () => {
  it("should return false for null", () => {
    expect(isDelegateTokenValid(null)).toBe(false);
  });

  it("should return true for valid delegate token", () => {
    const token = createDelegateToken();
    expect(isDelegateTokenValid(token)).toBe(true);
  });

  it("should return false for expired delegate token", () => {
    const token = createDelegateToken({ expiresAt: Date.now() - 1000 });
    expect(isDelegateTokenValid(token)).toBe(false);
  });
});

// ============================================================================
// isAccessTokenValid Tests
// ============================================================================

describe("isAccessTokenValid", () => {
  it("should return false for null", () => {
    expect(isAccessTokenValid(null)).toBe(false);
  });

  it("should return true for valid access token", () => {
    const token = createAccessToken();
    expect(isAccessTokenValid(token)).toBe(true);
  });

  it("should return false for expired access token", () => {
    const token = createAccessToken({ expiresAt: Date.now() - 1000 });
    expect(isAccessTokenValid(token)).toBe(false);
  });
});

// ============================================================================
// getMaxIssuerId Tests
// ============================================================================

describe("getMaxIssuerId", () => {
  it("should return null for empty state", () => {
    const state = emptyTokenState();
    expect(getMaxIssuerId(state)).toBe(null);
  });

  it("should return userId when user token is valid", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_max_issuer" }),
      delegate: null,
      access: null,
    };
    expect(getMaxIssuerId(state)).toBe("usr_max_issuer");
  });

  it("should return userId over tokenId when both exist", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_max_issuer" }),
      delegate: createDelegateToken({ tokenId: "dlt1_delegate" }),
      access: null,
    };
    expect(getMaxIssuerId(state)).toBe("usr_max_issuer");
  });

  it("should return delegate tokenId when user is invalid", () => {
    const state: TokenState = {
      user: createUserToken({ expiresAt: Date.now() - 1000 }), // Expired
      delegate: createDelegateToken({ tokenId: "dlt1_delegate" }),
      access: null,
    };
    expect(getMaxIssuerId(state)).toBe("dlt1_delegate");
  });

  it("should return delegate tokenId when user is null", () => {
    const state: TokenState = {
      user: null,
      delegate: createDelegateToken({ tokenId: "dlt1_delegate" }),
      access: null,
    };
    expect(getMaxIssuerId(state)).toBe("dlt1_delegate");
  });

  it("should return null when both user and delegate are invalid", () => {
    const state: TokenState = {
      user: createUserToken({ expiresAt: Date.now() - 1000 }),
      delegate: createDelegateToken({ expiresAt: Date.now() - 1000 }),
      access: null,
    };
    expect(getMaxIssuerId(state)).toBe(null);
  });
});

// ============================================================================
// isAccessTokenFromMaxIssuer Tests
// ============================================================================

describe("isAccessTokenFromMaxIssuer", () => {
  it("should return false when no access token", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: null,
      access: null,
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(false);
  });

  it("should return false when access token is invalid", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: null,
      access: createAccessToken({ expiresAt: Date.now() - 1000 }),
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(false);
  });

  it("should return true when access token issuerId matches user userId", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_issuer" }),
      delegate: null,
      access: createAccessToken({ issuerId: "usr_issuer" }),
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(true);
  });

  it("should return false when access token issuerId does not match max issuer", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_new_issuer" }),
      delegate: null,
      access: createAccessToken({ issuerId: "usr_old_issuer" }),
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(false);
  });

  it("should return true when no max issuer (orphaned but usable)", () => {
    const state: TokenState = {
      user: null,
      delegate: null,
      access: createAccessToken(),
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(true);
  });

  it("should match against delegate tokenId when user is absent", () => {
    const state: TokenState = {
      user: null,
      delegate: createDelegateToken({ tokenId: "dlt1_delegate_issuer" }),
      access: createAccessToken({ issuerId: "dlt1_delegate_issuer" }),
    };
    expect(isAccessTokenFromMaxIssuer(state)).toBe(true);
  });
});

// ============================================================================
// isDelegateTokenFromCurrentUser Tests
// ============================================================================

describe("isDelegateTokenFromCurrentUser", () => {
  it("should return false when no delegate token", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: null,
      access: null,
    };
    expect(isDelegateTokenFromCurrentUser(state)).toBe(false);
  });

  it("should return false when delegate token is invalid", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: createDelegateToken({ expiresAt: Date.now() - 1000 }),
      access: null,
    };
    expect(isDelegateTokenFromCurrentUser(state)).toBe(false);
  });

  it("should return true when no user token (delegate is top-level)", () => {
    const state: TokenState = {
      user: null,
      delegate: createDelegateToken(),
      access: null,
    };
    expect(isDelegateTokenFromCurrentUser(state)).toBe(true);
  });

  it("should return true when user token is invalid (delegate is top-level)", () => {
    const state: TokenState = {
      user: createUserToken({ expiresAt: Date.now() - 1000 }),
      delegate: createDelegateToken(),
      access: null,
    };
    expect(isDelegateTokenFromCurrentUser(state)).toBe(true);
  });

  it("should return true when delegate issuerId matches user userId", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_current" }),
      delegate: createDelegateToken({ issuerId: "usr_current" }),
      access: null,
    };
    expect(isDelegateTokenFromCurrentUser(state)).toBe(true);
  });

  it("should return false when delegate issuerId does not match user", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_new_user" }),
      delegate: createDelegateToken({ issuerId: "usr_old_user" }),
      access: null,
    };
    expect(isDelegateTokenFromCurrentUser(state)).toBe(false);
  });
});

// ============================================================================
// shouldReissueAccessToken Tests
// ============================================================================

describe("shouldReissueAccessToken", () => {
  it("should return true when no access token", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: null,
      access: null,
    };
    expect(shouldReissueAccessToken(state)).toBe(true);
  });

  it("should return true when access token is expired", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: null,
      access: createAccessToken({ expiresAt: Date.now() - 1000 }),
    };
    expect(shouldReissueAccessToken(state)).toBe(true);
  });

  it("should return true when issuer mismatch", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_new" }),
      delegate: null,
      access: createAccessToken({ issuerId: "usr_old" }),
    };
    expect(shouldReissueAccessToken(state)).toBe(true);
  });

  it("should return false when access token is valid and from max issuer", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_issuer" }),
      delegate: null,
      access: createAccessToken({ issuerId: "usr_issuer" }),
    };
    expect(shouldReissueAccessToken(state)).toBe(false);
  });
});

// ============================================================================
// shouldReissueDelegateToken Tests
// ============================================================================

describe("shouldReissueDelegateToken", () => {
  it("should return true when no delegate token", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: null,
      access: null,
    };
    expect(shouldReissueDelegateToken(state)).toBe(true);
  });

  it("should return true when delegate token is expired", () => {
    const state: TokenState = {
      user: createUserToken(),
      delegate: createDelegateToken({ expiresAt: Date.now() - 1000 }),
      access: null,
    };
    expect(shouldReissueDelegateToken(state)).toBe(true);
  });

  it("should return true when user exists but delegate not from current user", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_new" }),
      delegate: createDelegateToken({ issuerId: "usr_old" }),
      access: null,
    };
    expect(shouldReissueDelegateToken(state)).toBe(true);
  });

  it("should return false when delegate is valid and from current user", () => {
    const state: TokenState = {
      user: createUserToken({ userId: "usr_current" }),
      delegate: createDelegateToken({ issuerId: "usr_current" }),
      access: null,
    };
    expect(shouldReissueDelegateToken(state)).toBe(false);
  });

  it("should return false when no user token and delegate is valid", () => {
    const state: TokenState = {
      user: null,
      delegate: createDelegateToken(),
      access: null,
    };
    expect(shouldReissueDelegateToken(state)).toBe(false);
  });
});
