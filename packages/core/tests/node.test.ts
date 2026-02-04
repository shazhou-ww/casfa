/**
 * Node encoding/decoding roundtrip tests (v2.1 format)
 */
import { describe, expect, it } from "bun:test";
import { FILEINFO_SIZE, HASH_SIZE, HEADER_SIZE } from "../src/constants.ts";
import {
  decodeNode,
  encodeDictNode,
  encodeFileNode,
  encodeSuccessorNode,
  getNodeKind,
  isValidNode,
} from "../src/node.ts";
import type { HashProvider } from "../src/types.ts";

// Mock hash provider for testing
const mockHashProvider: HashProvider = {
  async hash(data: Uint8Array): Promise<Uint8Array> {
    // Simple mock: just return first 16 bytes or pad with zeros
    const hash = new Uint8Array(HASH_SIZE);
    hash.set(data.slice(0, Math.min(data.length, HASH_SIZE)));
    return hash;
  },
};

// Real hash provider using Web Crypto (truncated SHA-256 for testing)
const realHashProvider: HashProvider = {
  async hash(data: Uint8Array): Promise<Uint8Array> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(hashBuffer).slice(0, 16);
  },
};

describe("Node", () => {
  describe("encodeFileNode (f-node)", () => {
    it("should encode simple file node", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await encodeFileNode({ data, fileSize: 5 }, mockHashProvider);

      // Header(16) + FileInfo(64) + data(5) = 85
      expect(result.bytes.length).toBe(HEADER_SIZE + FILEINFO_SIZE + 5);
      expect(result.hash.length).toBe(HASH_SIZE);
    });

    it("should encode file node with content type", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeFileNode(
        { data, contentType: "image/png", fileSize: 3 },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("file");
      expect(decoded.fileInfo?.contentType).toBe("image/png");
      expect(decoded.fileInfo?.fileSize).toBe(3);
      expect(decoded.data).toEqual(data);
    });

    it("should encode file node with children", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const child1 = new Uint8Array(HASH_SIZE).fill(0xaa);
      const child2 = new Uint8Array(HASH_SIZE).fill(0xbb);

      const result = await encodeFileNode(
        { data, children: [child1, child2], fileSize: 1000 },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("file");
      expect(decoded.children).toHaveLength(2);
      expect(decoded.children![0]).toEqual(child1);
      expect(decoded.children![1]).toEqual(child2);
      expect(decoded.fileInfo?.fileSize).toBe(1000);
    });

    it("should store fileSize in FileInfo", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await encodeFileNode(
        { data, fileSize: 1000000, contentType: "text/plain" },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.fileInfo?.fileSize).toBe(1000000);
    });

    it("should store contentType in 56-byte slot", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const longContentType = "application/vnd.custom.type+json; charset=utf-8";

      const result = await encodeFileNode(
        { data, contentType: longContentType, fileSize: 3 },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.fileInfo?.contentType).toBe(longContentType);
    });
  });

  describe("encodeSuccessorNode (s-node)", () => {
    it("should encode successor node", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await encodeSuccessorNode({ data }, mockHashProvider);

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("successor");
      expect(decoded.data).toEqual(data);
      expect(decoded.fileInfo).toBeUndefined();
    });

    it("should encode successor node with children", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const child = new Uint8Array(HASH_SIZE).fill(0xcc);

      const result = await encodeSuccessorNode({ data, children: [child] }, mockHashProvider);

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("successor");
      expect(decoded.data).toEqual(data);
      expect(decoded.children).toHaveLength(1);
    });

    it("should not have FileInfo", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeSuccessorNode({ data }, mockHashProvider);

      // Header(16) + data(3) = 19 (no FileInfo)
      expect(result.bytes.length).toBe(HEADER_SIZE + 3);
    });
  });

  describe("encodeDictNode (d-node)", () => {
    it("should encode dict node with children and names", async () => {
      const child1 = new Uint8Array(HASH_SIZE).fill(0x11);
      const child2 = new Uint8Array(HASH_SIZE).fill(0x22);

      const result = await encodeDictNode(
        {
          children: [child1, child2],
          childNames: ["file1.txt", "folder2"],
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("dict");
      expect(decoded.children).toHaveLength(2);
    });

    it("should sort children by name (UTF-8 byte order)", async () => {
      const childA = new Uint8Array(HASH_SIZE).fill(0xaa);
      const childB = new Uint8Array(HASH_SIZE).fill(0xbb);
      const childC = new Uint8Array(HASH_SIZE).fill(0xcc);

      // Input unsorted
      const result = await encodeDictNode(
        {
          children: [childC, childA, childB],
          childNames: ["zebra", "alpha", "beta"],
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      // Should be sorted: alpha, beta, zebra
      expect(decoded.childNames).toEqual(["alpha", "beta", "zebra"]);
      expect(decoded.children![0]).toEqual(childA);
      expect(decoded.children![1]).toEqual(childB);
      expect(decoded.children![2]).toEqual(childC);
    });

    it("should throw on children/names count mismatch", async () => {
      const child1 = new Uint8Array(HASH_SIZE).fill(0x11);

      await expect(
        encodeDictNode(
          {
            children: [child1],
            childNames: ["a", "b"],
          },
          mockHashProvider
        )
      ).rejects.toThrow(/mismatch/);
    });

    it("should handle unicode names", async () => {
      const child1 = new Uint8Array(HASH_SIZE).fill(0x11);

      const result = await encodeDictNode(
        {
          children: [child1],
          childNames: ["文件夹 📁"],
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.childNames).toEqual(["文件夹 📁"]);
    });

    it("should handle empty dict node", async () => {
      const result = await encodeDictNode(
        {
          children: [],
          childNames: [],
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("dict");
      expect(decoded.children).toBeUndefined();
      expect(decoded.childNames).toEqual([]);
    });

    it("should not have fileInfo field", async () => {
      const child = new Uint8Array(HASH_SIZE).fill(0x11);
      const result = await encodeDictNode(
        { children: [child], childNames: ["x"] },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.fileInfo).toBeUndefined();
    });
  });

  describe("decodeNode", () => {
    it("should decode f-node correctly", async () => {
      const data = new Uint8Array([10, 20, 30, 40, 50]);
      const encoded = await encodeFileNode(
        { data, contentType: "application/octet-stream", fileSize: 5 },
        mockHashProvider
      );
      const decoded = decodeNode(encoded.bytes);

      expect(decoded.kind).toBe("file");
      expect(decoded.data).toEqual(data);
      expect(decoded.fileInfo?.contentType).toBe("application/octet-stream");
      expect(decoded.fileInfo?.fileSize).toBe(5);
    });

    it("should decode s-node correctly", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const encoded = await encodeSuccessorNode({ data }, mockHashProvider);
      const decoded = decodeNode(encoded.bytes);

      expect(decoded.kind).toBe("successor");
      expect(decoded.data).toEqual(data);
      expect(decoded.fileInfo).toBeUndefined();
    });

    it("should decode d-node correctly", async () => {
      const child = new Uint8Array(HASH_SIZE).fill(0x55);
      const encoded = await encodeDictNode(
        {
          children: [child],
          childNames: ["test"],
        },
        mockHashProvider
      );
      const decoded = decodeNode(encoded.bytes);

      expect(decoded.kind).toBe("dict");
      expect(decoded.childNames).toEqual(["test"]);
    });
  });

  describe("isValidNode", () => {
    it("should return true for valid node", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeFileNode({ data, fileSize: 3 }, mockHashProvider);
      expect(isValidNode(result.bytes)).toBe(true);
    });

    it("should return false for invalid magic", () => {
      const bytes = new Uint8Array(HEADER_SIZE);
      expect(isValidNode(bytes)).toBe(false);
    });

    it("should return false for too small buffer", () => {
      expect(isValidNode(new Uint8Array(8))).toBe(false);
    });
  });

  describe("getNodeKind", () => {
    it("should return file for f-node", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeFileNode({ data, fileSize: 3 }, mockHashProvider);
      expect(getNodeKind(result.bytes)).toBe("file");
    });

    it("should return successor for s-node", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeSuccessorNode({ data }, mockHashProvider);
      expect(getNodeKind(result.bytes)).toBe("successor");
    });

    it("should return dict for d-node", async () => {
      const child = new Uint8Array(HASH_SIZE).fill(0x11);
      const result = await encodeDictNode(
        { children: [child], childNames: ["x"] },
        mockHashProvider
      );
      expect(getNodeKind(result.bytes)).toBe("dict");
    });

    it("should return null for invalid buffer", () => {
      expect(getNodeKind(new Uint8Array(10))).toBe(null);
    });
  });

  describe("roundtrip with real hash", () => {
    it("should produce consistent hash", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result1 = await encodeFileNode({ data, fileSize: 5 }, realHashProvider);
      const result2 = await encodeFileNode({ data, fileSize: 5 }, realHashProvider);

      expect(result1.hash).toEqual(result2.hash);
      expect(result1.bytes).toEqual(result2.bytes);
    });

    it("should produce different hash for different data", async () => {
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([1, 2, 4]);

      const result1 = await encodeFileNode({ data: data1, fileSize: 3 }, realHashProvider);
      const result2 = await encodeFileNode({ data: data2, fileSize: 3 }, realHashProvider);

      expect(result1.hash).not.toEqual(result2.hash);
    });

    it("should produce same hash for same dict regardless of input order", async () => {
      const childA = new Uint8Array(HASH_SIZE).fill(0xaa);
      const childB = new Uint8Array(HASH_SIZE).fill(0xbb);

      // Different input order, same logical content
      const result1 = await encodeDictNode(
        { children: [childA, childB], childNames: ["a", "b"] },
        realHashProvider
      );
      const result2 = await encodeDictNode(
        { children: [childB, childA], childNames: ["b", "a"] },
        realHashProvider
      );

      // After sorting, should be identical
      expect(result1.hash).toEqual(result2.hash);
      expect(result1.bytes).toEqual(result2.bytes);
    });
  });
});
