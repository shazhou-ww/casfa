/**
 * Utility function tests
 */
import { describe, expect, it } from "bun:test";
import {
  bytesToHex,
  concatBytes,
  decodePascalString,
  decodePascalStrings,
  encodePascalString,
  encodePascalStrings,
  hashToKey,
  hexToBytes,
  keyToHash,
} from "../src/utils.ts";

describe("Utils", () => {
  describe("Pascal strings", () => {
    it("should encode empty string", () => {
      const encoded = encodePascalString("");
      expect(encoded).toEqual(new Uint8Array([0, 0]));
    });

    it("should encode ASCII string", () => {
      const encoded = encodePascalString("hello");
      expect(encoded[0]).toBe(5); // length low byte
      expect(encoded[1]).toBe(0); // length high byte
      expect(encoded.slice(2)).toEqual(new TextEncoder().encode("hello"));
    });

    it("should roundtrip ASCII string", () => {
      const original = "hello world";
      const encoded = encodePascalString(original);
      const [decoded, consumed] = decodePascalString(encoded, 0);
      expect(decoded).toBe(original);
      expect(consumed).toBe(2 + original.length);
    });

    it("should roundtrip unicode string", () => {
      const original = "你好世界 🌍";
      const encoded = encodePascalString(original);
      const [decoded, _consumed] = decodePascalString(encoded, 0);
      expect(decoded).toBe(original);
    });

    it("should throw on string too long", () => {
      const long = "x".repeat(70000);
      expect(() => encodePascalString(long)).toThrow(/too long/);
    });

    it("should encode multiple strings", () => {
      const strings = ["foo", "bar", "baz"];
      const encoded = encodePascalStrings(strings);
      const decoded = decodePascalStrings(encoded, 0, 3);
      expect(decoded).toEqual(strings);
    });

    it("should handle empty strings array", () => {
      const encoded = encodePascalStrings([]);
      expect(encoded.length).toBe(0);
      const decoded = decodePascalStrings(encoded, 0, 0);
      expect(decoded).toEqual([]);
    });
  });

  describe("Hex conversion", () => {
    it("should convert bytes to hex", () => {
      const bytes = new Uint8Array([0x00, 0x01, 0xff, 0xab]);
      expect(bytesToHex(bytes)).toBe("0001ffab");
    });

    it("should convert hex to bytes", () => {
      const hex = "0001ffab";
      expect(hexToBytes(hex)).toEqual(new Uint8Array([0x00, 0x01, 0xff, 0xab]));
    });

    it("should roundtrip bytes", () => {
      const original = new Uint8Array([0, 127, 255, 16, 32]);
      expect(hexToBytes(bytesToHex(original))).toEqual(original);
    });

    it("should throw on odd-length hex", () => {
      expect(() => hexToBytes("abc")).toThrow(/even length/);
    });

    it("should handle empty input", () => {
      expect(bytesToHex(new Uint8Array([]))).toBe("");
      expect(hexToBytes("")).toEqual(new Uint8Array([]));
    });
  });

  describe("concatBytes", () => {
    it("should concatenate arrays", () => {
      const a = new Uint8Array([1, 2]);
      const b = new Uint8Array([3, 4, 5]);
      const c = new Uint8Array([6]);
      expect(concatBytes(a, b, c)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    });

    it("should handle empty arrays", () => {
      expect(concatBytes()).toEqual(new Uint8Array([]));
      expect(concatBytes(new Uint8Array([]))).toEqual(new Uint8Array([]));
    });
  });

  describe("Hash key conversion", () => {
    it("should create CB32 key (no prefix)", () => {
      const hash = new Uint8Array(16).fill(0xab);
      const key = hashToKey(hash);
      // 16 bytes of 0xab → CB32 encoded
      expect(key.length).toBe(26);
      // Roundtrip should reproduce same bytes
      expect(keyToHash(key)).toEqual(hash);
    });

    it("should extract hash from CB32 key", () => {
      // Encode then decode
      const original = new Uint8Array(16).fill(0xcd);
      const key = hashToKey(original);
      const hash = keyToHash(key);
      expect(hash).toEqual(original);
    });

    it("should roundtrip hash", () => {
      const original = new Uint8Array(16);
      for (let i = 0; i < 16; i++) original[i] = i;
      expect(keyToHash(hashToKey(original))).toEqual(original);
    });
  });
});
