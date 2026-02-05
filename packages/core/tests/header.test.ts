/**
 * Header encoding/decoding tests (v2.1 format)
 */
import { describe, expect, it } from "bun:test";
import { HEADER_SIZE, MAGIC, NODE_TYPE } from "../src/constants.ts";
import {
  createDictHeader,
  createFileHeader,
  createSetHeader,
  createSuccessorHeader,
  decodeHeader,
  encodeHeader,
  getNodeType,
} from "../src/header.ts";
import type { CasHeader } from "../src/types.ts";

describe("Header", () => {
  describe("encodeHeader", () => {
    it("should produce 16 bytes", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: 0,
        count: 0,
      };
      const bytes = encodeHeader(header);
      expect(bytes.length).toBe(HEADER_SIZE);
    });

    it("should encode magic correctly", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: 0,
        count: 0,
      };
      const bytes = encodeHeader(header);
      // "CAS\x01" in LE
      expect(bytes[0]).toBe(0x43); // 'C'
      expect(bytes[1]).toBe(0x41); // 'A'
      expect(bytes[2]).toBe(0x53); // 'S'
      expect(bytes[3]).toBe(0x01); // version
    });

    it("should encode size as u32 LE at offset 8", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: 0x12345678, // u32 value
        count: 0,
      };
      const bytes = encodeHeader(header);
      const view = new DataView(bytes.buffer);
      expect(view.getUint32(8, true)).toBe(0x12345678);
    });

    it("should encode count at offset 12", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: 0,
        count: 42,
      };
      const bytes = encodeHeader(header);
      const view = new DataView(bytes.buffer);
      expect(view.getUint32(12, true)).toBe(42);
    });
  });

  describe("decodeHeader", () => {
    it("should roundtrip header correctly", () => {
      const original: CasHeader = {
        magic: MAGIC,
        flags: 0b11,
        size: 1024 * 1024,
        count: 42,
      };
      const bytes = encodeHeader(original);
      const decoded = decodeHeader(bytes);
      expect(decoded).toEqual(original);
    });

    it("should throw on invalid magic", () => {
      const bytes = new Uint8Array(16);
      bytes[0] = 0x00;
      expect(() => decodeHeader(bytes)).toThrow(/Invalid magic/);
    });

    it("should throw on buffer too small", () => {
      const bytes = new Uint8Array(8);
      expect(() => decodeHeader(bytes)).toThrow(/Buffer too small/);
    });

    it("should handle max u32 size correctly", () => {
      const original: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: 0xffffffff, // max u32
        count: 0,
      };
      const bytes = encodeHeader(original);
      const decoded = decodeHeader(bytes);
      expect(decoded.size).toBe(0xffffffff);
    });
  });

  describe("node type helpers", () => {
    it("should create set-node header", () => {
      const header = createSetHeader(3);
      expect(getNodeType(header.flags)).toBe(NODE_TYPE.SET);
      expect(header.size).toBe(0); // Set nodes have no payload
      expect(header.count).toBe(3);
    });

    it("should create d-node header", () => {
      const header = createDictHeader(100, 5);
      expect(getNodeType(header.flags)).toBe(NODE_TYPE.DICT);
      expect(header.size).toBe(100);
      expect(header.count).toBe(5);
    });

    it("should create s-node header", () => {
      const header = createSuccessorHeader(100, 2);
      expect(getNodeType(header.flags)).toBe(NODE_TYPE.SUCCESSOR);
      expect(header.size).toBe(100);
      expect(header.count).toBe(2);
    });

    it("should create f-node header", () => {
      const header = createFileHeader(164, 2); // FileInfo(64) + data(100)
      expect(getNodeType(header.flags)).toBe(NODE_TYPE.FILE);
      expect(header.size).toBe(164);
      expect(header.count).toBe(2);
    });
  });
});
