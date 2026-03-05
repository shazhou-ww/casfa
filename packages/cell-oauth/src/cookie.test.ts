import { describe, expect, it } from "bun:test";
import {
  buildAuthCookieHeader,
  buildClearAuthCookieHeader,
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

describe("buildAuthCookieHeader", () => {
  it("includes HttpOnly and SameSite=Lax", () => {
    const h = buildAuthCookieHeader("t1", { cookieName: "auth" });
    expect(h).toContain("HttpOnly");
    expect(h).toContain("SameSite=Lax");
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
  it("value is empty and Max-Age=0", () => {
    const h = buildClearAuthCookieHeader({ cookieName: "auth" });
    expect(h).toContain("auth=");
    expect(h).toContain("Max-Age=0");
    expect(h).toContain("HttpOnly");
    expect(h).toContain("SameSite=Lax");
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
