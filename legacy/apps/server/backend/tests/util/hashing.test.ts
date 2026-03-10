/**
 * Unit tests for Blake3 hashing utilities
 */

import { describe, expect, it } from "bun:test";
import { blake3Hash, blake3s128, blake3sBase32 } from "../../src/util/hashing.ts";

describe("Blake3 Hashing", () => {
  describe("blake3s128", () => {
    it("should return 16 bytes (128 bits)", () => {
      const hash = blake3s128("test");
      expect(hash.length).toBe(16);
    });

    it("should be deterministic", () => {
      const hash1 = blake3s128("hello world");
      const hash2 = blake3s128("hello world");
      expect(hash1).toEqual(hash2);
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = blake3s128("hello");
      const hash2 = blake3s128("world");
      expect(hash1).not.toEqual(hash2);
    });

    it("should accept Uint8Array input", () => {
      const bytes = new Uint8Array([0x01, 0x02, 0x03]);
      const hash = blake3s128(bytes);
      expect(hash.length).toBe(16);
    });

    it("should produce consistent results for string and equivalent bytes", () => {
      const str = "test";
      const bytes = new TextEncoder().encode(str);
      const hash1 = blake3s128(str);
      const hash2 = blake3s128(bytes);
      expect(hash1).toEqual(hash2);
    });
  });

  describe("blake3Hash", () => {
    it("should return 32 bytes (256 bits)", () => {
      const hash = blake3Hash("test");
      expect(hash.length).toBe(32);
    });

    it("should be deterministic", () => {
      const hash1 = blake3Hash("hello world");
      const hash2 = blake3Hash("hello world");
      expect(hash1).toEqual(hash2);
    });
  });

  describe("blake3sBase32", () => {
    it("should return 26-character Crockford Base32 string", () => {
      const result = blake3sBase32("test");
      expect(result.length).toBe(26);
    });

    it("should use only valid Crockford Base32 characters", () => {
      const result = blake3sBase32("test input");
      // Crockford excludes I, L, O, U
      expect(result).toMatch(/^[0-9A-HJ-NP-TV-Z]+$/);
    });

    it("should be deterministic", () => {
      const result1 = blake3sBase32("consistent");
      const result2 = blake3sBase32("consistent");
      expect(result1).toBe(result2);
    });

    it("should produce different results for different inputs", () => {
      const result1 = blake3sBase32("input1");
      const result2 = blake3sBase32("input2");
      expect(result1).not.toBe(result2);
    });

    it("should handle empty string", () => {
      const result = blake3sBase32("");
      expect(result.length).toBe(26);
      expect(result).toMatch(/^[0-9A-HJ-NP-TV-Z]+$/);
    });

    it("should handle unicode strings", () => {
      const result = blake3sBase32("你好世界🌍");
      expect(result.length).toBe(26);
      expect(result).toMatch(/^[0-9A-HJ-NP-TV-Z]+$/);
    });
  });
});
