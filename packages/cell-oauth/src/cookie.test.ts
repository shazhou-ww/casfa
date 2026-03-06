import { describe, expect, it } from "bun:test";
import {
  buildAuthCookieHeader,
  buildClearAuthCookieHeader,
  buildRefreshCookieHeader,
  buildClearRefreshCookieHeader,
  getCookieFromRequest,
  getTokenFromRequest,
} from "./cookie.ts";

describe("getTokenFromRequest", () => {
  it("returns token from Authorization Bearer", () => {
    const req = new Request("https://x/y", {
      headers: { Authorization: "Bearer my-token-123" },
    });
    expect(getTokenFromRequest(req, {})).toBe("my-token-123");
    expect(getTokenFromRequest(req, { cookieName: "auth" })).toBe("my-token-123");
  });

  it("returns token from cookie when no Authorization and cookieName set", () => {
    const req = new Request("https://x/y", {
      headers: { Cookie: "auth=from-cookie; other=ignored" },
    });
    expect(getTokenFromRequest(req, { cookieName: "auth" })).toBe("from-cookie");
  });

  it("prefers Bearer over cookie when both present", () => {
    const req = new Request("https://x/y", {
      headers: {
        Authorization: "Bearer bearer-token",
        Cookie: "auth=cookie-token",
      },
    });
    expect(getTokenFromRequest(req, { cookieName: "auth" })).toBe("bearer-token");
  });

  it("returns null when cookieName not set and no Bearer", () => {
    const req = new Request("https://x/y", {
      headers: { Cookie: "auth=token" },
    });
    expect(getTokenFromRequest(req, {})).toBeNull();
  });

  it("returns null when Cookie header missing or cookie name not present", () => {
    const reqNoCookie = new Request("https://x/y");
    expect(getTokenFromRequest(reqNoCookie, { cookieName: "auth" })).toBeNull();

    const reqOtherCookie = new Request("https://x/y", {
      headers: { Cookie: "other=value" },
    });
    expect(getTokenFromRequest(reqOtherCookie, { cookieName: "auth" })).toBeNull();
  });

  it("trims Bearer token", () => {
    const req = new Request("https://x/y", {
      headers: { Authorization: "Bearer  trimmed  " },
    });
    expect(getTokenFromRequest(req, {})).toBe("trimmed");
  });
});

describe("getCookieFromRequest", () => {
  it("returns cookie value when present", () => {
    const req = new Request("https://x/y", {
      headers: { Cookie: "auth_refresh=rt-value; other=ignored" },
    });
    expect(getCookieFromRequest(req, "auth_refresh")).toBe("rt-value");
  });

  it("returns null when cookie name not present", () => {
    const req = new Request("https://x/y", {
      headers: { Cookie: "other=value" },
    });
    expect(getCookieFromRequest(req, "auth_refresh")).toBeNull();
  });

  it("returns null when Cookie header missing", () => {
    const req = new Request("https://x/y");
    expect(getCookieFromRequest(req, "auth_refresh")).toBeNull();
  });
});

describe("buildAuthCookieHeader", () => {
  it("includes HttpOnly and SameSite=Strict by default", () => {
    const h = buildAuthCookieHeader("t1", { cookieName: "auth" });
    expect(h).toContain("HttpOnly");
    expect(h).toContain("SameSite=Strict");
    expect(h).toContain("auth=t1");
    expect(h).toContain("Path=/");
  });

  it("includes Domain when provided", () => {
    const h = buildAuthCookieHeader("t1", {
      cookieName: "auth",
      cookieDomain: ".example.com",
    });
    expect(h).toContain("Domain=.example.com");
  });

  it("includes Max-Age when provided", () => {
    const h = buildAuthCookieHeader("t1", {
      cookieName: "auth",
      cookieMaxAgeSeconds: 86400,
    });
    expect(h).toContain("Max-Age=86400");
  });

  it("includes Secure when true", () => {
    const h = buildAuthCookieHeader("t1", { cookieName: "auth", secure: true });
    expect(h).toContain("Secure");
  });

  it("uses custom path when provided", () => {
    const h = buildAuthCookieHeader("t1", { cookieName: "auth", cookiePath: "/api" });
    expect(h).toContain("Path=/api");
  });
});

describe("buildClearAuthCookieHeader", () => {
  it("value is empty, Max-Age=0, and SameSite=Strict by default", () => {
    const h = buildClearAuthCookieHeader({ cookieName: "auth" });
    expect(h).toContain("auth=");
    expect(h).toContain("Max-Age=0");
    expect(h).toContain("HttpOnly");
    expect(h).toContain("SameSite=Strict");
  });

  it("includes Path and Domain when provided", () => {
    const h = buildClearAuthCookieHeader({
      cookieName: "auth",
      cookiePath: "/",
      cookieDomain: ".example.com",
    });
    expect(h).toContain("Path=/");
    expect(h).toContain("Domain=.example.com");
  });
});

describe("buildRefreshCookieHeader", () => {
  it("uses Path=/oauth/refresh, HttpOnly, SameSite=Strict by default", () => {
    const h = buildRefreshCookieHeader("rt1", { cookieName: "auth_refresh" });
    expect(h).toContain("auth_refresh=rt1");
    expect(h).toContain("Path=/oauth/refresh");
    expect(h).toContain("HttpOnly");
    expect(h).toContain("SameSite=Strict");
  });

  it("includes Domain and Secure when provided", () => {
    const h = buildRefreshCookieHeader("rt1", {
      cookieName: "auth_refresh",
      cookieDomain: ".example.com",
      secure: true,
    });
    expect(h).toContain("Domain=.example.com");
    expect(h).toContain("Secure");
  });
});

describe("buildClearRefreshCookieHeader", () => {
  it("clears with Path=/oauth/refresh and SameSite=Strict by default", () => {
    const h = buildClearRefreshCookieHeader({ cookieName: "auth_refresh" });
    expect(h).toContain("auth_refresh=");
    expect(h).toContain("Path=/oauth/refresh");
    expect(h).toContain("Max-Age=0");
    expect(h).toContain("SameSite=Strict");
  });
});
