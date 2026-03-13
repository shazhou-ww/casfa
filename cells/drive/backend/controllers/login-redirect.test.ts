import { describe, expect, test } from "bun:test";
import { resolveSsoBaseUrlForRequest } from "./login-redirect";

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

