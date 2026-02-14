import { describe, expect, test } from "bun:test";
import {
  base64urlDecode,
  base64urlEncode,
  bytesToHex,
  decodeCB32,
  encodeCB32,
  formatSize,
  hexToBytes,
  isValidCB32,
} from "./index.ts";

// ============================================================================
// Crockford Base32
// ============================================================================

describe("encodeCB32 / decodeCB32", () => {
  test("round-trip 16 bytes", () => {
    const input = new Uint8Array([
      0x34, 0x08, 0x04, 0xd8, 0x50, 0xd1, 0x70, 0x22, 0x08, 0xcc, 0xc9, 0x3a, 0x71, 0x98, 0xcc,
      0x99,
    ]);
    const encoded = encodeCB32(input);
    expect(encoded).toHaveLength(26);
    expect(decodeCB32(encoded)).toEqual(input);
  });

  test("empty bytes", () => {
    expect(encodeCB32(new Uint8Array([]))).toBe("");
    expect(decodeCB32("")).toEqual(new Uint8Array([]));
  });

  test("single byte", () => {
    const input = new Uint8Array([0xff]);
    const encoded = encodeCB32(input);
    expect(decodeCB32(encoded)).toEqual(input);
  });

  test("handles confusable characters on decode", () => {
    // I/i/L/l → 1, O/o → 0
    const fromI = decodeCB32("I");
    const from1 = decodeCB32("1");
    expect(fromI).toEqual(from1);

    const fromO = decodeCB32("O");
    const from0 = decodeCB32("0");
    expect(fromO).toEqual(from0);
  });

  test("case-insensitive decode", () => {
    const upper = decodeCB32("ABCDEFGH");
    const lower = decodeCB32("abcdefgh");
    expect(upper).toEqual(lower);
  });

  test("throws on invalid character", () => {
    expect(() => decodeCB32("U")).toThrow("Invalid Crockford Base32 character");
  });
});

describe("isValidCB32", () => {
  test("valid strings", () => {
    expect(isValidCB32("0123456789ABCDEFGHJKMNPQRSTVWXYZ")).toBe(true);
    expect(isValidCB32("")).toBe(true);
  });

  test("invalid strings", () => {
    expect(isValidCB32("ILOO")).toBe(false); // I, L, O excluded from strict charset
    expect(isValidCB32("U")).toBe(false);
    expect(isValidCB32("hello world")).toBe(false);
  });
});

// ============================================================================
// Base64URL
// ============================================================================

describe("base64urlEncode / base64urlDecode", () => {
  test("round-trip", () => {
    const input = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = base64urlEncode(input);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(base64urlDecode(encoded)).toEqual(input);
  });

  test("empty", () => {
    expect(base64urlEncode(new Uint8Array([]))).toBe("");
    expect(base64urlDecode("")).toEqual(new Uint8Array([]));
  });

  test("SHA-256 output (32 bytes)", () => {
    const hash = new Uint8Array(32);
    for (let i = 0; i < 32; i++) hash[i] = i;
    const encoded = base64urlEncode(hash);
    expect(base64urlDecode(encoded)).toEqual(hash);
  });
});

// ============================================================================
// Hex
// ============================================================================

describe("bytesToHex / hexToBytes", () => {
  test("round-trip", () => {
    const input = new Uint8Array([0xff, 0x00, 0xab, 0xcd]);
    expect(bytesToHex(input)).toBe("ff00abcd");
    expect(hexToBytes("ff00abcd")).toEqual(input);
  });

  test("empty", () => {
    expect(bytesToHex(new Uint8Array([]))).toBe("");
    expect(hexToBytes("")).toEqual(new Uint8Array([]));
  });

  test("throws on odd-length hex", () => {
    expect(() => hexToBytes("abc")).toThrow("even length");
  });
});

// ============================================================================
// formatSize
// ============================================================================

describe("formatSize", () => {
  test("zero", () => {
    expect(formatSize(0)).toBe("0 B");
  });

  test("bytes", () => {
    expect(formatSize(512)).toBe("512 B");
  });

  test("kilobytes", () => {
    expect(formatSize(1536)).toBe("1.5 KB");
  });

  test("megabytes", () => {
    expect(formatSize(1048576)).toBe("1.0 MB");
  });

  test("custom precision", () => {
    expect(formatSize(1536, { precision: 2 })).toBe("1.50 KB");
  });

  test("null returns em-dash", () => {
    expect(formatSize(null)).toBe("\u2014");
    expect(formatSize(undefined)).toBe("\u2014");
  });

  test("custom null fallback", () => {
    expect(formatSize(null, { nullFallback: "N/A" })).toBe("N/A");
  });
});
