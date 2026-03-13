import { describe, it, expect } from "bun:test";
import { encodeCrockfordBase32, decodeCrockfordBase32 } from "../crockford-base32.ts";

describe("crockford-base32", () => {
  it("encodes 16 bytes to 26 characters", () => {
    const bytes = new Uint8Array(16);
    bytes[15] = 1;
    const s = encodeCrockfordBase32(bytes);
    expect(s).toHaveLength(26);
    expect(s).toMatch(/^[0-9A-Z]+$/);
    expect(s).not.toMatch(/[ILOU]/);
  });

  it("round-trip preserves 128 bits", () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const s = encodeCrockfordBase32(bytes);
    const decoded = decodeCrockfordBase32(s);
    expect(decoded).not.toBeNull();
    expect(new Uint8Array(decoded!)).toEqual(bytes);
  });

  it("decode is case-insensitive", () => {
    const bytes = new Uint8Array(16);
    bytes[0] = 0xff;
    const s = encodeCrockfordBase32(bytes);
    const lower = s.toLowerCase();
    expect(decodeCrockfordBase32(lower)).toEqual(decodeCrockfordBase32(s));
  });

  it("decode returns null for invalid length or chars", () => {
    expect(decodeCrockfordBase32("abc")).toBeNull();
    expect(decodeCrockfordBase32("0O0")).toBeNull(); // O not in alphabet
  });
});
