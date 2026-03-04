import { describe, expect, it } from "bun:test";
import {
  createDelegateAccessToken,
  decodeDelegateTokenPayload,
  generateDelegateId,
  generateRandomToken,
  sha256Hex,
  verifyCodeChallenge,
} from "./token.ts";

describe("sha256Hex", () => {
  it("produces a 64-char hex string", async () => {
    const hash = await sha256Hex("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", async () => {
    const a = await sha256Hex("test-input");
    const b = await sha256Hex("test-input");
    expect(a).toBe(b);
  });
});

describe("generateDelegateId", () => {
  it("starts with dlg_", () => {
    const id = generateDelegateId();
    expect(id.startsWith("dlg_")).toBe(true);
  });

  it("generates unique IDs", () => {
    const a = generateDelegateId();
    const b = generateDelegateId();
    expect(a).not.toBe(b);
  });
});

describe("generateRandomToken", () => {
  it("returns a base64url string", () => {
    const token = generateRandomToken();
    expect(token.length).toBeGreaterThan(20);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("delegate access token", () => {
  it("roundtrips encode/decode", () => {
    const token = createDelegateAccessToken("user-123", "dlg_ABC");
    const payload = decodeDelegateTokenPayload(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-123");
    expect(payload!.dlg).toBe("dlg_ABC");
  });

  it("returns null for invalid tokens", () => {
    expect(decodeDelegateTokenPayload("not-a-token")).toBeNull();
    expect(decodeDelegateTokenPayload("a.b.c")).toBeNull();
    expect(decodeDelegateTokenPayload("")).toBeNull();
  });
});

describe("verifyCodeChallenge", () => {
  it("verifies S256 challenge", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const challenge = btoa(String.fromCharCode(...hash))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifyCodeChallenge(verifier, challenge, "S256")).toBe(true);
    expect(await verifyCodeChallenge("wrong", challenge, "S256")).toBe(false);
  });

  it("verifies plain challenge", async () => {
    expect(await verifyCodeChallenge("abc", "abc", "plain")).toBe(true);
    expect(await verifyCodeChallenge("abc", "def", "plain")).toBe(false);
  });
});
