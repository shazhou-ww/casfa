/**
 * Topology algorithm tests
 */
import { describe, expect, it } from "bun:test";
import { DEFAULT_NODE_LIMIT, HASH_SIZE, HEADER_SIZE } from "../src/constants.ts";
import {
  computeCapacity,
  computeDepth,
  computeLayout,
  computeLayoutSize,
  computeUsableSpace,
  countLayoutNodes,
  validateLayout,
} from "../src/topology.ts";

describe("Topology", () => {
  const L = computeUsableSpace(DEFAULT_NODE_LIMIT); // ~1MB - 32 = 1048544

  describe("computeUsableSpace", () => {
    it("should subtract header size", () => {
      expect(computeUsableSpace(1024)).toBe(1024 - HEADER_SIZE);
      expect(computeUsableSpace(DEFAULT_NODE_LIMIT)).toBe(DEFAULT_NODE_LIMIT - HEADER_SIZE);
    });
  });

  describe("computeCapacity", () => {
    it("should return L for depth 1", () => {
      expect(computeCapacity(1, DEFAULT_NODE_LIMIT)).toBe(L);
    });

    it("should return L^2/32 for depth 2", () => {
      const expected = (L * L) / HASH_SIZE;
      const actual = computeCapacity(2, DEFAULT_NODE_LIMIT);
      // Allow small floating point error
      expect(Math.abs(actual - expected) / expected).toBeLessThan(0.001);
    });

    it("should return L^3/32^2 for depth 3", () => {
      const expected = (L * L * L) / (HASH_SIZE * HASH_SIZE);
      const actual = computeCapacity(3, DEFAULT_NODE_LIMIT);
      expect(Math.abs(actual - expected) / expected).toBeLessThan(0.001);
    });

    it("should throw for depth < 1", () => {
      expect(() => computeCapacity(0, DEFAULT_NODE_LIMIT)).toThrow();
    });

    it("should clamp to MAX_SAFE_INTEGER", () => {
      const capacity = computeCapacity(5, DEFAULT_NODE_LIMIT);
      expect(capacity).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    });
  });

  describe("computeDepth", () => {
    it("should return 1 for small files", () => {
      expect(computeDepth(100, DEFAULT_NODE_LIMIT)).toBe(1);
      expect(computeDepth(L, DEFAULT_NODE_LIMIT)).toBe(1);
    });

    it("should return 2 for files up to L^2/32", () => {
      expect(computeDepth(L + 1, DEFAULT_NODE_LIMIT)).toBe(2);
      expect(computeDepth(L * 1000, DEFAULT_NODE_LIMIT)).toBe(2);
    });

    it("should return 3 for very large files", () => {
      const depth2Max = computeCapacity(2, DEFAULT_NODE_LIMIT);
      expect(computeDepth(depth2Max + 1, DEFAULT_NODE_LIMIT)).toBe(3);
    });

    it("should return 1 for zero or negative size", () => {
      expect(computeDepth(0, DEFAULT_NODE_LIMIT)).toBe(1);
      expect(computeDepth(-100, DEFAULT_NODE_LIMIT)).toBe(1);
    });
  });

  describe("computeLayout", () => {
    it("should create leaf node for small file", () => {
      const layout = computeLayout(1000, DEFAULT_NODE_LIMIT);
      expect(layout.depth).toBe(1);
      expect(layout.dataSize).toBe(1000);
      expect(layout.children).toHaveLength(0);
    });

    it("should create single node at max capacity", () => {
      const layout = computeLayout(L, DEFAULT_NODE_LIMIT);
      expect(layout.depth).toBe(1);
      expect(layout.dataSize).toBe(L);
      expect(layout.children).toHaveLength(0);
    });

    it("should create 2-level tree for L+1 bytes", () => {
      const layout = computeLayout(L + 1, DEFAULT_NODE_LIMIT);
      expect(layout.depth).toBe(2);
      expect(layout.children.length).toBeGreaterThan(0);
    });

    it("should have correct total size", () => {
      const sizes = [100, 1000, L, L + 1, L * 2, L * 10, L * 100];
      for (const size of sizes) {
        const layout = computeLayout(size, DEFAULT_NODE_LIMIT);
        expect(validateLayout(layout, size)).toBe(true);
      }
    });

    it("should create empty node for zero size", () => {
      const layout = computeLayout(0, DEFAULT_NODE_LIMIT);
      expect(layout.depth).toBe(1);
      expect(layout.dataSize).toBe(0);
      expect(layout.children).toHaveLength(0);
    });
  });

  describe("validateLayout", () => {
    it("should validate correct layout", () => {
      const layout = computeLayout(5000, DEFAULT_NODE_LIMIT);
      expect(validateLayout(layout, 5000)).toBe(true);
      expect(validateLayout(layout, 5001)).toBe(false);
    });
  });

  describe("computeLayoutSize", () => {
    it("should sum all data in tree", () => {
      const layout = computeLayout(L * 3, DEFAULT_NODE_LIMIT);
      expect(computeLayoutSize(layout)).toBe(L * 3);
    });
  });

  describe("countLayoutNodes", () => {
    it("should count single node", () => {
      const layout = computeLayout(1000, DEFAULT_NODE_LIMIT);
      expect(countLayoutNodes(layout)).toBe(1);
    });

    it("should count all nodes in tree", () => {
      // For L+1 bytes, we need at least 2 nodes
      const layout = computeLayout(L + 1, DEFAULT_NODE_LIMIT);
      expect(countLayoutNodes(layout)).toBeGreaterThanOrEqual(2);
    });
  });
});
