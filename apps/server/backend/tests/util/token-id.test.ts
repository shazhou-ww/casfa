/**
 * Unit tests for Token ID utilities
 */

import { describe, expect, it } from "bun:test";
import {
  extractTokenId,
  generateDelegateId,
  generateDepotId,
  generateRequestId,
  toTokenPk,
} from "../../src/util/token-id.ts";

describe("Token ID Utilities", () => {
  describe("generateDelegateId", () => {
    it("should generate ID with dlt_ prefix", () => {
      const id = generateDelegateId();
      expect(id.startsWith("dlt_")).toBe(true);
    });

    it("should generate 26-character CB32 after prefix", () => {
      const id = generateDelegateId();
      const suffix = id.slice(4); // after "dlt_"
      expect(suffix.length).toBe(26);
      expect(/^[0-9A-HJKMNP-TV-Z]+$/.test(suffix)).toBe(true);
    });

    it("should generate unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateDelegateId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("generateDepotId", () => {
    it("should generate ID with dpt_ prefix", () => {
      const id = generateDepotId();
      expect(id.startsWith("dpt_")).toBe(true);
    });

    it("should generate 26-character CB32 after prefix", () => {
      const id = generateDepotId();
      const suffix = id.slice(4); // after "dpt_"
      expect(suffix.length).toBe(26);
      expect(/^[0-9A-HJKMNP-TV-Z]+$/.test(suffix)).toBe(true);
    });
  });

  describe("generateRequestId", () => {
    it("should generate ID with req_ prefix", () => {
      const id = generateRequestId();
      expect(id.startsWith("req_")).toBe(true);
    });

    it("should generate 26-character CB32 after prefix", () => {
      const id = generateRequestId();
      const suffix = id.slice(4); // after "req_"
      expect(suffix.length).toBe(26);
      expect(/^[0-9A-HJKMNP-TV-Z]+$/.test(suffix)).toBe(true);
    });
  });

  describe("toTokenPk", () => {
    it("should create primary key from token ID", () => {
      const pk = toTokenPk("tok_abc123");
      expect(pk).toBe("token#tok_abc123");
    });

    it("should handle empty token ID", () => {
      const pk = toTokenPk("");
      expect(pk).toBe("token#");
    });
  });

  describe("extractTokenId", () => {
    it("should extract ID from primary key", () => {
      const id = extractTokenId("token#tok_abc123");
      expect(id).toBe("tok_abc123");
    });

    it("should return original if not prefixed", () => {
      const id = extractTokenId("tok_abc123");
      expect(id).toBe("tok_abc123");
    });

    it("should handle empty after prefix", () => {
      const id = extractTokenId("token#");
      expect(id).toBe("");
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip token ID through pk", () => {
      const original = generateDelegateId();
      const pk = toTokenPk(original);
      const extracted = extractTokenId(pk);
      expect(extracted).toBe(original);
    });
  });
});
