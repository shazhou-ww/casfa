import { describe, expect, it } from "bun:test";
import {
  generateCsrfToken,
  getCsrfFromRequest,
  validateCsrf,
  buildCsrfCookieHeader,
} from "./csrf.ts";

describe("generateCsrfToken", () => {
  it("returns 32-byte hex string", () => {
    const t = generateCsrfToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(t.length).toBe(64);
  });
});

describe("getCsrfFromRequest", () => {
  it("returns cookie value when present", () => {
    const req = new Request("https://x/y", {
      headers: { Cookie: "csrf_token=abc123; other=ignored" },
    });
    expect(getCsrfFromRequest(req, { cookieName: "csrf_token" })).toBe("abc123");
  });

  it("returns null when cookie name not present", () => {
    const req = new Request("https://x/y", {
      headers: { Cookie: "other=value" },
    });
    expect(getCsrfFromRequest(req, { cookieName: "csrf_token" })).toBeNull();
  });
});

describe("validateCsrf", () => {
  it("returns true when cookie and header match and non-empty", () => {
    const req = new Request("https://x/y", {
      method: "POST",
      headers: {
        Cookie: "csrf_token=secret",
        "X-CSRF-Token": "secret",
      },
    });
    expect(
      validateCsrf(req, { cookieName: "csrf_token", headerName: "X-CSRF-Token" })
    ).toBe(true);
  });

  it("returns false when header missing", () => {
    const req = new Request("https://x/y", {
      headers: { Cookie: "csrf_token=secret" },
    });
    expect(
      validateCsrf(req, { cookieName: "csrf_token", headerName: "X-CSRF-Token" })
    ).toBe(false);
  });

  it("returns false when values differ", () => {
    const req = new Request("https://x/y", {
      headers: {
        Cookie: "csrf_token=secret",
        "X-CSRF-Token": "other",
      },
    });
    expect(
      validateCsrf(req, { cookieName: "csrf_token", headerName: "X-CSRF-Token" })
    ).toBe(false);
  });
});

describe("buildCsrfCookieHeader", () => {
  it("does not include HttpOnly, includes SameSite=Strict by default", () => {
    const h = buildCsrfCookieHeader("token1", { cookieName: "csrf_token" });
    expect(h).not.toContain("HttpOnly");
    expect(h).toContain("SameSite=Strict");
    expect(h).toContain("csrf_token=token1");
    expect(h).toContain("Path=/");
  });
});
