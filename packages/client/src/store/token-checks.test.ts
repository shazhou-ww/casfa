/**
 * Token validity checks tests for two-tier model.
 */

import { describe, expect, it } from "bun:test";
import type {
  StoredAccessToken,
  StoredRootDelegate,
  StoredUserToken,
  TokenState,
} from "../types/tokens.ts";
import { emptyTokenState } from "../types/tokens.ts";
import {
  DEFAULT_EXPIRY_BUFFER_MS,
  hasRefreshToken,
  isAccessTokenValid,
  isStoredAccessTokenValid,
  isTokenExpiringSoon,
  isTokenValid,
  isUserTokenValid,
  needsRootDelegate,
  shouldRefreshAccessToken,
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

const createRootDelegate = (overrides: Partial<StoredRootDelegate> = {}): StoredRootDelegate => ({
  delegateId: "dlg_root123",
  realm: "test-realm",
  refreshToken: "base64-refresh-token",
  refreshTokenId: "rt_123",
  accessToken: "base64-access-token",
  accessTokenId: "at_123",
  accessTokenExpiresAt: Date.now() + 3600_000,
  depth: 0,
  canUpload: true,
  canManageDepot: true,
  ...overrides,
});

const createAccessToken = (overrides: Partial<StoredAccessToken> = {}): StoredAccessToken => ({
  tokenBase64: "base64-access-token",
  tokenBytes: new Uint8Array(128),
  tokenId: "at_access123",
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
// isAccessTokenValid Tests (root delegate)
// ============================================================================

describe("isAccessTokenValid", () => {
  it("should return false for null root delegate", () => {
    expect(isAccessTokenValid(null)).toBe(false);
  });

  it("should return true for root delegate with valid access token", () => {
    const rd = createRootDelegate({
      accessTokenExpiresAt: Date.now() + 3600_000,
    });
    expect(isAccessTokenValid(rd)).toBe(true);
  });

  it("should return false for root delegate with expired access token", () => {
    const rd = createRootDelegate({
      accessTokenExpiresAt: Date.now() - 1000,
    });
    expect(isAccessTokenValid(rd)).toBe(false);
  });

  it("should return false when AT expires within default buffer", () => {
    const rd = createRootDelegate({
      accessTokenExpiresAt: Date.now() + 30_000, // 30 seconds, buffer is 60s
    });
    expect(isAccessTokenValid(rd)).toBe(false);
  });

  it("should respect custom buffer", () => {
    const rd = createRootDelegate({
      accessTokenExpiresAt: Date.now() + 30_000,
    });
    expect(isAccessTokenValid(rd, 10_000)).toBe(true);
    expect(isAccessTokenValid(rd, 60_000)).toBe(false);
  });
});

// ============================================================================
// isStoredAccessTokenValid Tests (view type)
// ============================================================================

describe("isStoredAccessTokenValid", () => {
  it("should return false for null", () => {
    expect(isStoredAccessTokenValid(null)).toBe(false);
  });

  it("should return true for valid stored access token", () => {
    const at = createAccessToken();
    expect(isStoredAccessTokenValid(at)).toBe(true);
  });

  it("should return false for expired stored access token", () => {
    const at = createAccessToken({ expiresAt: Date.now() - 1000 });
    expect(isStoredAccessTokenValid(at)).toBe(false);
  });

  it("should respect buffer parameter", () => {
    const at = createAccessToken({ expiresAt: Date.now() + 30_000 });
    expect(isStoredAccessTokenValid(at, 10_000)).toBe(true);
    expect(isStoredAccessTokenValid(at, 60_000)).toBe(false);
  });
});

// ============================================================================
// hasRefreshToken Tests
// ============================================================================

describe("hasRefreshToken", () => {
  it("should return false for null root delegate", () => {
    expect(hasRefreshToken(null)).toBe(false);
  });

  it("should return true when refresh token is present", () => {
    const rd = createRootDelegate({ refreshToken: "some-rt" });
    expect(hasRefreshToken(rd)).toBe(true);
  });

  it("should return false when refresh token is empty string", () => {
    const rd = createRootDelegate({ refreshToken: "" });
    expect(hasRefreshToken(rd)).toBe(false);
  });
});

// ============================================================================
// needsRootDelegate Tests
// ============================================================================

describe("needsRootDelegate", () => {
  it("should return true when no root delegate", () => {
    const state = emptyTokenState();
    expect(needsRootDelegate(state)).toBe(true);
  });

  it("should return true when rootDelegate is null with user present", () => {
    const state: TokenState = {
      user: createUserToken(),
      rootDelegate: null,
    };
    expect(needsRootDelegate(state)).toBe(true);
  });

  it("should return false when root delegate exists", () => {
    const state: TokenState = {
      user: createUserToken(),
      rootDelegate: createRootDelegate(),
    };
    expect(needsRootDelegate(state)).toBe(false);
  });

  it("should return false when root delegate exists without user", () => {
    const state: TokenState = {
      user: null,
      rootDelegate: createRootDelegate(),
    };
    expect(needsRootDelegate(state)).toBe(false);
  });
});

// ============================================================================
// shouldRefreshAccessToken Tests
// ============================================================================

describe("shouldRefreshAccessToken", () => {
  it("should return false when no root delegate", () => {
    const state: TokenState = {
      user: createUserToken(),
      rootDelegate: null,
    };
    expect(shouldRefreshAccessToken(state)).toBe(false);
  });

  it("should return false when empty state", () => {
    const state = emptyTokenState();
    expect(shouldRefreshAccessToken(state)).toBe(false);
  });

  it("should return false when access token is still valid", () => {
    const state: TokenState = {
      user: createUserToken(),
      rootDelegate: createRootDelegate({
        accessTokenExpiresAt: Date.now() + 3600_000, // 1 hour
      }),
    };
    expect(shouldRefreshAccessToken(state)).toBe(false);
  });

  it("should return true when access token is expired", () => {
    const state: TokenState = {
      user: createUserToken(),
      rootDelegate: createRootDelegate({
        accessTokenExpiresAt: Date.now() - 1000,
      }),
    };
    expect(shouldRefreshAccessToken(state)).toBe(true);
  });

  it("should return true when access token is expiring within buffer", () => {
    const state: TokenState = {
      user: createUserToken(),
      rootDelegate: createRootDelegate({
        accessTokenExpiresAt: Date.now() + 30_000, // 30 seconds, buffer is 60s
      }),
    };
    expect(shouldRefreshAccessToken(state)).toBe(true);
  });

  it("should return true when root delegate present but AT expired, no user", () => {
    const state: TokenState = {
      user: null,
      rootDelegate: createRootDelegate({
        accessTokenExpiresAt: Date.now() - 1000,
      }),
    };
    expect(shouldRefreshAccessToken(state)).toBe(true);
  });
});
