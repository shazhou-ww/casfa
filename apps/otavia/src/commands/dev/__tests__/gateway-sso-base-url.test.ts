import { describe, expect, test } from "bun:test";
import { resolveGatewaySsoBaseUrl } from "../gateway";

describe("resolveGatewaySsoBaseUrl", () => {
  test("prefers configured SSO base URL from env", () => {
    expect(resolveGatewaySsoBaseUrl("http://localhost:7100/sso", 8900, "sso")).toBe(
      "http://localhost:7100/sso"
    );
  });

  test("falls back to backend mount URL when env is missing", () => {
    expect(resolveGatewaySsoBaseUrl(undefined, 8900, "sso")).toBe("http://localhost:8900/sso");
  });
});
