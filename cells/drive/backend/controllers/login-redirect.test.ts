import { describe, expect, test } from "bun:test";
import { resolveSsoBaseUrlForRequest, resolveSsoRefreshCookiePath } from "./login-redirect";

describe("resolveSsoBaseUrlForRequest", () => {
  test("uses request origin for loopback dev when configured origin differs by port", () => {
    const resolved = resolveSsoBaseUrlForRequest(
      "http://localhost:8900/sso",
      "http://localhost:7100"
    );
    expect(resolved).toBe("http://localhost:7100/sso");
  });

  test("keeps configured non-loopback origin", () => {
    const resolved = resolveSsoBaseUrlForRequest(
      "https://sso.example.com/sso",
      "https://drive.example.com"
    );
    expect(resolved).toBe("https://sso.example.com/sso");
  });
});

describe("resolveSsoRefreshCookiePath", () => {
  test("uses mounted refresh cookie path for path-based SSO URL", () => {
    expect(resolveSsoRefreshCookiePath("http://localhost:7100/sso")).toBe("/sso/oauth/refresh");
  });

  test("uses root refresh cookie path for host-based SSO URL", () => {
    expect(resolveSsoRefreshCookiePath("https://sso.example.com")).toBe("/oauth/refresh");
  });
});

