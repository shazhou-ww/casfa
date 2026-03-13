import { describe, expect, test } from "bun:test";
import { buildForwardUrlForCellMount } from "../forward-url.js";

describe("buildForwardUrlForCellMount", () => {
  test("preserves query string when forwarding nested mount paths", () => {
    const forwarded = buildForwardUrlForCellMount(
      "http://localhost:8900/sso/oauth/callback?code=abc-123&state=xyz",
      "/sso"
    );

    expect(forwarded.pathname).toBe("/oauth/callback");
    expect(forwarded.search).toBe("?code=abc-123&state=xyz");
  });

  test("forwards mount root to slash path", () => {
    const forwarded = buildForwardUrlForCellMount("http://localhost:8900/sso/", "/sso");
    expect(forwarded.pathname).toBe("/");
    expect(forwarded.search).toBe("");
  });
});
