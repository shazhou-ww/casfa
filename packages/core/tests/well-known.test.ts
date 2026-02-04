/**
 * Tests for well-known CAS keys and data (v2.1 format)
 */

import { describe, expect, it } from "bun:test";
import { HEADER_SIZE, MAGIC, NODE_TYPE } from "../src/constants.ts";
import { decodeHeader, getNodeType } from "../src/header.ts";
import { EMPTY_DICT_BYTES, EMPTY_DICT_KEY, WELL_KNOWN_KEYS } from "../src/well-known.ts";

describe("Well-known Keys", () => {
  describe("EMPTY_DICT_BYTES", () => {
    it("should be exactly HEADER_SIZE bytes", () => {
      expect(EMPTY_DICT_BYTES.length).toBe(HEADER_SIZE);
    });

    it("should have correct magic number", () => {
      const view = new DataView(EMPTY_DICT_BYTES.buffer);
      expect(view.getUint32(0, true)).toBe(MAGIC);
    });

    it("should have d-node type flag", () => {
      const view = new DataView(EMPTY_DICT_BYTES.buffer);
      const flags = view.getUint32(4, true);
      expect(flags & 0b11).toBe(NODE_TYPE.DICT);
    });

    it("should have size = 0 at offset 8 (u32)", () => {
      const view = new DataView(EMPTY_DICT_BYTES.buffer);
      expect(view.getUint32(8, true)).toBe(0);
    });

    it("should have count = 0 at offset 12", () => {
      const view = new DataView(EMPTY_DICT_BYTES.buffer);
      expect(view.getUint32(12, true)).toBe(0);
    });

    it("should decode correctly as a d-node header", () => {
      const header = decodeHeader(EMPTY_DICT_BYTES);
      expect(header.count).toBe(0);
      expect(header.size).toBe(0);
      expect(getNodeType(header.flags)).toBe(NODE_TYPE.DICT);
    });
  });

  describe("EMPTY_DICT_KEY", () => {
    it("should be a valid hex storage key format (32 chars)", () => {
      expect(EMPTY_DICT_KEY).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should match the BLAKE3-128 hash of EMPTY_DICT_BYTES", async () => {
      // Import BLAKE3 dynamically for test
      const { blake3 } = await import("@noble/hashes/blake3");
      const fullHash = blake3(EMPTY_DICT_BYTES);
      const truncatedHashHex = Array.from(fullHash.slice(0, 16))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      expect(EMPTY_DICT_KEY).toBe(truncatedHashHex);
    });
  });

  describe("WELL_KNOWN_KEYS", () => {
    it("should export EMPTY_DICT key", () => {
      expect(WELL_KNOWN_KEYS.EMPTY_DICT).toBe(EMPTY_DICT_KEY);
    });
  });
});
