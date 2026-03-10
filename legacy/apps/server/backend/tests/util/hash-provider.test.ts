/**
 * Unit tests for Key Provider utilities
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { type CombinedKeyProvider, createNodeKeyProvider } from "../../src/util/hash-provider.ts";

describe("Key Provider Utilities", () => {
  describe("createNodeKeyProvider", () => {
    it("should create a provider with both computeKey and sha256 methods", () => {
      const provider = createNodeKeyProvider();
      expect(typeof provider.computeKey).toBe("function");
      expect(typeof provider.sha256).toBe("function");
    });
  });

  describe("computeKey (Blake3s-128)", () => {
    let provider: CombinedKeyProvider;

    beforeEach(() => {
      provider = createNodeKeyProvider();
    });

    it("should return 16-byte hash", async () => {
      const data = new TextEncoder().encode("test data");
      const hash = await provider.computeKey(data);
      expect(hash.length).toBe(16);
    });

    it("should be deterministic", async () => {
      const data = new TextEncoder().encode("consistent input");
      const hash1 = await provider.computeKey(data);
      const hash2 = await provider.computeKey(data);
      expect(hash1).toEqual(hash2);
    });

    it("should produce different hashes for different inputs", async () => {
      const data1 = new TextEncoder().encode("input 1");
      const data2 = new TextEncoder().encode("input 2");
      const hash1 = await provider.computeKey(data1);
      const hash2 = await provider.computeKey(data2);
      expect(hash1).not.toEqual(hash2);
    });

    it("should handle empty input", async () => {
      const data = new Uint8Array(0);
      const hash = await provider.computeKey(data);
      expect(hash.length).toBe(16);
    });

    it("should handle large input", async () => {
      const data = new Uint8Array(1024 * 1024); // 1MB
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }
      const hash = await provider.computeKey(data);
      expect(hash.length).toBe(16);
    });
  });

  describe("sha256", () => {
    let provider: CombinedKeyProvider;

    beforeEach(() => {
      provider = createNodeKeyProvider();
    });

    it("should return 32-byte hash", async () => {
      const data = new TextEncoder().encode("test data");
      const hash = await provider.sha256(data);
      expect(hash.length).toBe(32);
    });

    it("should be deterministic", async () => {
      const data = new TextEncoder().encode("consistent input");
      const hash1 = await provider.sha256(data);
      const hash2 = await provider.sha256(data);
      expect(hash1).toEqual(hash2);
    });

    it("should produce different hashes for different inputs", async () => {
      const data1 = new TextEncoder().encode("input 1");
      const data2 = new TextEncoder().encode("input 2");
      const hash1 = await provider.sha256(data1);
      const hash2 = await provider.sha256(data2);
      expect(hash1).not.toEqual(hash2);
    });

    it("should produce known SHA-256 hash", async () => {
      // SHA-256 of "hello" is 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
      const data = new TextEncoder().encode("hello");
      const hash = await provider.sha256(data);
      const hex = Array.from(hash)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    });

    it("should handle empty input", async () => {
      // SHA-256 of "" is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      const data = new Uint8Array(0);
      const hash = await provider.sha256(data);
      const hex = Array.from(hash)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      expect(hex).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });
  });

  describe("type compatibility", () => {
    it("should satisfy CombinedKeyProvider interface", () => {
      const provider: CombinedKeyProvider = createNodeKeyProvider();
      // If this compiles, the type is compatible
      expect(provider).toBeDefined();
    });
  });
});
