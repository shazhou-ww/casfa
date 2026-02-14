/**
 * Unit tests for Crockford Base32 encoding/decoding
 */

import { describe, expect, it } from "bun:test";
import {
  fromCrockfordBase32,
  isValidCrockfordBase32,
  toCrockfordBase32,
} from "../../src/util/encoding.ts";

describe("Crockford Base32 Encoding", () => {
  describe("toCrockfordBase32", () => {
    it("should encode empty bytes to empty string", () => {
      expect(toCrockfordBase32(new Uint8Array([]))).toBe("");
    });

    it("should encode single byte", () => {
      // 0x00 = 00000000 -> 00000 000 (0, then 0 with padding)
      expect(toCrockfordBase32(new Uint8Array([0x00]))).toBe("00");
    });

    it("should encode 0xFF correctly", () => {
      // 0xFF = 11111111 -> 11111 111 (31, then 28 with padding)
      expect(toCrockfordBase32(new Uint8Array([0xff]))).toBe("ZW");
    });

    it("should encode 16 bytes to 26 characters", () => {
      // 16 bytes = 128 bits
      // 128 / 5 = 25.6, so we need 26 characters
      const bytes = new Uint8Array(16).fill(0);
      const encoded = toCrockfordBase32(bytes);
      expect(encoded.length).toBe(26);
      expect(encoded).toBe("00000000000000000000000000");
    });

    it("should encode random bytes consistently", () => {
      const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a]);
      const encoded = toCrockfordBase32(bytes);
      // Verify it's deterministic
      expect(toCrockfordBase32(bytes)).toBe(encoded);
      // Verify it uses only valid Crockford characters
      expect(encoded).toMatch(/^[0-9A-HJ-NP-TV-Z]+$/);
    });

    it("should produce uppercase output", () => {
      const bytes = new Uint8Array([0xab, 0xcd, 0xef]);
      const encoded = toCrockfordBase32(bytes);
      expect(encoded).toBe(encoded.toUpperCase());
    });
  });

  describe("fromCrockfordBase32", () => {
    it("should decode empty string to empty bytes", () => {
      const decoded = fromCrockfordBase32("");
      expect(decoded.length).toBe(0);
    });

    it("should decode uppercase correctly", () => {
      const original = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
      const encoded = toCrockfordBase32(original);
      const decoded = fromCrockfordBase32(encoded);
      // Note: Due to bit padding, we may get extra zero bits
      // Compare only the original bytes
      expect(decoded.slice(0, original.length)).toEqual(original);
    });

    it("should decode lowercase correctly", () => {
      const original = new Uint8Array([0xab, 0xcd]);
      const encoded = toCrockfordBase32(original);
      const decoded = fromCrockfordBase32(encoded.toLowerCase());
      expect(decoded.slice(0, original.length)).toEqual(original);
    });

    it("should throw on invalid characters", () => {
      expect(() => fromCrockfordBase32("INVALID!")).toThrow();
      expect(() => fromCrockfordBase32("ABC DEF")).toThrow(); // space is invalid
      expect(() => fromCrockfordBase32("ABCUDEF")).toThrow(); // U is not in Crockford
    });

    it("should handle confusable characters per Crockford spec", () => {
      // Per the Crockford Base32 spec, I/L map to 1 and O maps to 0
      const from1 = fromCrockfordBase32("1");
      expect(fromCrockfordBase32("I")).toEqual(from1); // I → 1
      expect(fromCrockfordBase32("L")).toEqual(from1); // L → 1
      const from0 = fromCrockfordBase32("0");
      expect(fromCrockfordBase32("O")).toEqual(from0); // O → 0
    });

    it("should roundtrip 16 bytes correctly", () => {
      const original = new Uint8Array([
        0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32,
        0x10,
      ]);
      const encoded = toCrockfordBase32(original);
      expect(encoded.length).toBe(26);
      const decoded = fromCrockfordBase32(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe("isValidCrockfordBase32", () => {
    it("should accept valid uppercase strings", () => {
      expect(isValidCrockfordBase32("0123456789")).toBe(true);
      expect(isValidCrockfordBase32("ABCDEFGHJKMNPQRSTVWXYZ")).toBe(true);
    });

    it("should accept valid lowercase strings", () => {
      expect(isValidCrockfordBase32("abcdefghjkmnpqrstvwxyz")).toBe(true);
    });

    it("should accept mixed case", () => {
      expect(isValidCrockfordBase32("Abc123XyZ")).toBe(true);
    });

    it("should reject invalid characters", () => {
      expect(isValidCrockfordBase32("ABCI")).toBe(false); // I
      expect(isValidCrockfordBase32("ABCL")).toBe(false); // L
      expect(isValidCrockfordBase32("ABCO")).toBe(false); // O
      expect(isValidCrockfordBase32("ABCU")).toBe(false); // U
      expect(isValidCrockfordBase32("ABC!")).toBe(false);
      expect(isValidCrockfordBase32("ABC DEF")).toBe(false);
    });

    it("should accept empty string", () => {
      expect(isValidCrockfordBase32("")).toBe(true);
    });
  });
});
