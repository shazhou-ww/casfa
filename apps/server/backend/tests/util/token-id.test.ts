/**
 * Unit tests for Token ID utilities
 */

import { describe, expect, it } from "bun:test";
import {
  extractTokenId,
  generateAgentTokenId,
  generateDepotId,
  generateTicketId,
  generateTokenId,
  toTokenPk,
} from "../../src/util/token-id.ts";

describe("Token ID Utilities", () => {
  describe("generateTokenId", () => {
    it("should generate ID with default prefix", () => {
      const id = generateTokenId();
      expect(id.startsWith("tok_")).toBe(true);
    });

    it("should generate ID with custom prefix", () => {
      const id = generateTokenId("custom");
      expect(id.startsWith("custom_")).toBe(true);
    });

    it("should generate 32-character hex after prefix", () => {
      const id = generateTokenId();
      const parts = id.split("_");
      expect(parts.length).toBe(2);
      const hex = parts[1] as string;
      expect(hex.length).toBe(32);
      expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
    });

    it("should generate unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTokenId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("generateTicketId", () => {
    it("should generate ID with tkt prefix", () => {
      const id = generateTicketId();
      expect(id.startsWith("tkt_")).toBe(true);
    });
  });

  describe("generateAgentTokenId", () => {
    it("should generate ID with agt prefix", () => {
      const id = generateAgentTokenId();
      expect(id.startsWith("agt_")).toBe(true);
    });
  });

  describe("generateDepotId", () => {
    it("should generate ID with dpt prefix", () => {
      const id = generateDepotId();
      expect(id.startsWith("dpt_")).toBe(true);
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
      const original = generateTokenId();
      const pk = toTokenPk(original);
      const extracted = extractTokenId(pk);
      expect(extracted).toBe(original);
    });
  });
});
