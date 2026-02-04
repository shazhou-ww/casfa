/**
 * Unit tests for Client ID utilities
 */

import { describe, expect, it } from "bun:test";
import {
  computeClientId,
  computeTokenId,
  extractIdHash,
  isValidClientId,
  isValidTokenId,
} from "../../src/util/client-id.ts";

describe("Client ID Utilities", () => {
  describe("computeClientId", () => {
    it("should return client: prefixed ID", () => {
      const id = computeClientId("some-public-key");
      expect(id.startsWith("client:")).toBe(true);
    });

    it("should return 26-character hash after prefix", () => {
      const id = computeClientId("some-public-key");
      const hash = id.slice("client:".length);
      expect(hash.length).toBe(26);
    });

    it("should be deterministic", () => {
      const pubkey = "test-pubkey-12345";
      const id1 = computeClientId(pubkey);
      const id2 = computeClientId(pubkey);
      expect(id1).toBe(id2);
    });

    it("should produce different IDs for different pubkeys", () => {
      const id1 = computeClientId("pubkey-1");
      const id2 = computeClientId("pubkey-2");
      expect(id1).not.toBe(id2);
    });

    it("should produce valid client ID format", () => {
      const id = computeClientId("any-key");
      expect(isValidClientId(id)).toBe(true);
    });
  });

  describe("computeTokenId", () => {
    it("should return token: prefixed ID", () => {
      const id = computeTokenId("casfa_abc123");
      expect(id.startsWith("token:")).toBe(true);
    });

    it("should return 26-character hash after prefix", () => {
      const id = computeTokenId("casfa_abc123");
      const hash = id.slice("token:".length);
      expect(hash.length).toBe(26);
    });

    it("should be deterministic", () => {
      const token = "casfa_test_token";
      const id1 = computeTokenId(token);
      const id2 = computeTokenId(token);
      expect(id1).toBe(id2);
    });

    it("should produce valid token ID format", () => {
      const id = computeTokenId("any-token");
      expect(isValidTokenId(id)).toBe(true);
    });
  });

  describe("extractIdHash", () => {
    it("should extract hash from client ID", () => {
      const hash = extractIdHash("client:ABCDEFGHIJKLMNOPQRSTUVWXYZ");
      expect(hash).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    });

    it("should extract hash from token ID", () => {
      const hash = extractIdHash("token:12345678901234567890123456");
      expect(hash).toBe("12345678901234567890123456");
    });

    it("should extract hash from any prefixed format", () => {
      const hash = extractIdHash("prefix:value");
      expect(hash).toBe("value");
    });

    it("should throw on invalid format (no colon)", () => {
      expect(() => extractIdHash("nocolon")).toThrow("Invalid ID format");
    });

    it("should handle empty hash after colon", () => {
      const hash = extractIdHash("prefix:");
      expect(hash).toBe("");
    });

    it("should handle multiple colons", () => {
      const hash = extractIdHash("prefix:value:with:colons");
      expect(hash).toBe("value:with:colons");
    });
  });

  describe("isValidClientId", () => {
    it("should accept valid client ID", () => {
      const validId = computeClientId("test");
      expect(isValidClientId(validId)).toBe(true);
    });

    it("should reject wrong prefix", () => {
      expect(isValidClientId("token:ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe(false);
      expect(isValidClientId("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe(false);
    });

    it("should reject wrong length", () => {
      expect(isValidClientId("client:TOOSHORT")).toBe(false);
      expect(isValidClientId("client:TOOLONGABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe(false);
    });

    it("should reject lowercase hash", () => {
      expect(isValidClientId("client:abcdefghijklmnopqrstuvwxyz")).toBe(false);
    });

    it("should reject invalid characters", () => {
      expect(isValidClientId("client:ABCDEFGHIJKLMNOPQRSTUVWX!Z")).toBe(false);
    });
  });

  describe("isValidTokenId", () => {
    it("should accept valid token ID", () => {
      const validId = computeTokenId("test");
      expect(isValidTokenId(validId)).toBe(true);
    });

    it("should reject wrong prefix", () => {
      expect(isValidTokenId("client:ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe(false);
      expect(isValidTokenId("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe(false);
    });

    it("should reject wrong length", () => {
      expect(isValidTokenId("token:TOOSHORT")).toBe(false);
      expect(isValidTokenId("token:TOOLONGABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe(false);
    });
  });
});
