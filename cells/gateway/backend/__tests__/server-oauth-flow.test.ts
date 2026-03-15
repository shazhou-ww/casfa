import { describe, expect, it } from "bun:test";
import { normalizeReturnUrl } from "../services/server-oauth-flow.ts";

describe("server oauth flow", () => {
  it("normalizes return_url to same-origin target", () => {
    const base = "https://gateway.example.com/gateway";
    expect(normalizeReturnUrl("/gateway", base)).toBe("https://gateway.example.com/gateway");
    expect(normalizeReturnUrl("https://gateway.example.com/gateway?x=1", base)).toBe(
      "https://gateway.example.com/gateway?x=1"
    );
  });

  it("rejects cross-origin return_url", () => {
    const base = "https://gateway.example.com/gateway";
    expect(normalizeReturnUrl("https://evil.example.com/steal", base)).toBe(base);
  });
});
