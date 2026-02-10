/**
 * Client helper functions tests.
 */

import { describe, expect, it, mock } from "bun:test";
import type { FetchResult } from "../types/client.ts";
import type { StoredAccessToken, StoredUserToken } from "../types/tokens.ts";
import { ERRORS, type TokenGetter, withAccessToken, withToken, withUserToken } from "./helpers.ts";

// ============================================================================
// Test Helpers
// ============================================================================

const createUserToken = (): StoredUserToken => ({
  accessToken: "jwt-access-token",
  refreshToken: "jwt-refresh-token",
  userId: "usr_test123",
  expiresAt: Date.now() + 3600_000,
});

const createAccessToken = (): StoredAccessToken => ({
  tokenBase64: "base64-access-token",
  tokenBytes: new Uint8Array(128),
  expiresAt: Date.now() + 3600_000,
  canUpload: true,
  canManageDepot: true,
});

// ============================================================================
// ERRORS Tests
// ============================================================================

describe("ERRORS", () => {
  it("should have USER_REQUIRED error", () => {
    expect(ERRORS.USER_REQUIRED).toEqual({
      code: "UNAUTHORIZED",
      message: "User login required",
    });
  });

  it("should have ACCESS_REQUIRED error", () => {
    expect(ERRORS.ACCESS_REQUIRED).toEqual({
      code: "FORBIDDEN",
      message: "Access token required",
    });
  });
});

// ============================================================================
// withToken Tests
// ============================================================================

describe("withToken", () => {
  it("should call fn with token when token exists", async () => {
    const token = { id: "test-token" };
    const getToken: TokenGetter<typeof token> = async () => token;
    const fn = mock(
      async (t: typeof token): Promise<FetchResult<string>> => ({
        ok: true,
        data: `received-${t.id}`,
        status: 200,
      })
    );

    const wrapped = withToken(getToken, { code: "ERROR", message: "Error" });
    const result = await wrapped(fn);

    expect(fn).toHaveBeenCalledWith(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("received-test-token");
    }
  });

  it("should return error when token is null", async () => {
    const getToken: TokenGetter<string> = async () => null;
    const fn = mock(
      async (): Promise<FetchResult<string>> => ({
        ok: true,
        data: "should not reach",
        status: 200,
      })
    );
    const error = { code: "MISSING_TOKEN", message: "Token is required" };

    const wrapped = withToken(getToken, error);
    const result = await wrapped(fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(error);
    }
  });

  it("should propagate fn result", async () => {
    const token = "valid-token";
    const getToken: TokenGetter<string> = async () => token;
    const fn = mock(
      async (): Promise<FetchResult<number>> => ({
        ok: true,
        data: 42,
        status: 200,
      })
    );

    const wrapped = withToken(getToken, { code: "ERROR", message: "Error" });
    const result = await wrapped(fn);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(42);
    }
  });

  it("should propagate fn error result", async () => {
    const token = "valid-token";
    const getToken: TokenGetter<string> = async () => token;
    const fnError = { code: "FN_ERROR", message: "Function failed" };
    const fn = mock(
      async (): Promise<FetchResult<number>> => ({
        ok: false,
        error: fnError,
      })
    );

    const wrapped = withToken(getToken, { code: "ERROR", message: "Error" });
    const result = await wrapped(fn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(fnError);
    }
  });
});

// ============================================================================
// withUserToken Tests
// ============================================================================

describe("withUserToken", () => {
  it("should call fn with user token when available", async () => {
    const userToken = createUserToken();
    const getToken: TokenGetter<StoredUserToken> = async () => userToken;
    const fn = mock(
      async (token: StoredUserToken): Promise<FetchResult<string>> => ({
        ok: true,
        data: token.userId,
        status: 200,
      })
    );

    const wrapped = withUserToken(getToken);
    const result = await wrapped(fn);

    expect(fn).toHaveBeenCalledWith(userToken);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("usr_test123");
    }
  });

  it("should return USER_REQUIRED error when token is null", async () => {
    const getToken: TokenGetter<StoredUserToken> = async () => null;
    const fn = mock(
      async (): Promise<FetchResult<string>> => ({
        ok: true,
        data: "should not reach",
        status: 200,
      })
    );

    const wrapped = withUserToken(getToken);
    const result = await wrapped(fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(ERRORS.USER_REQUIRED);
    }
  });
});

// ============================================================================
// withAccessToken Tests
// ============================================================================

describe("withAccessToken", () => {
  it("should call fn with access token when available", async () => {
    const accessToken = createAccessToken();
    const getToken: TokenGetter<StoredAccessToken> = async () => accessToken;
    const fn = mock(
      async (token: StoredAccessToken): Promise<FetchResult<string>> => ({
        ok: true,
        data: token.tokenBase64,
        status: 200,
      })
    );

    const wrapped = withAccessToken(getToken);
    const result = await wrapped(fn);

    expect(fn).toHaveBeenCalledWith(accessToken);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("base64-access-token");
    }
  });

  it("should return ACCESS_REQUIRED error when token is null", async () => {
    const getToken: TokenGetter<StoredAccessToken> = async () => null;
    const fn = mock(
      async (): Promise<FetchResult<string>> => ({
        ok: true,
        data: "should not reach",
        status: 200,
      })
    );

    const wrapped = withAccessToken(getToken);
    const result = await wrapped(fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(ERRORS.ACCESS_REQUIRED);
    }
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  it("should handle async token getter that throws", async () => {
    const getToken: TokenGetter<string> = async () => {
      throw new Error("Token getter failed");
    };
    const fn = mock(
      async (): Promise<FetchResult<string>> => ({
        ok: true,
        data: "should not reach",
        status: 200,
      })
    );

    const wrapped = withToken(getToken, { code: "ERROR", message: "Error" });

    await expect(wrapped(fn)).rejects.toThrow("Token getter failed");
    expect(fn).not.toHaveBeenCalled();
  });

  it("should handle async fn that throws", async () => {
    const token = "valid-token";
    const getToken: TokenGetter<string> = async () => token;
    const fn = mock(async (): Promise<FetchResult<string>> => {
      throw new Error("Function failed");
    });

    const wrapped = withToken(getToken, { code: "ERROR", message: "Error" });

    await expect(wrapped(fn)).rejects.toThrow("Function failed");
    expect(fn).toHaveBeenCalled();
  });
});
