/**
 * B-Tree Topology Algorithms
 *
 * Capacity formula: C(d) = L^d / 32^(d-1)
 * Where:
 * - d = tree depth (1 = leaf)
 * - L = usable space per node (nodeLimit - HEADER_SIZE)
 *
 * Greedy fill algorithm:
 * - Always fill leftmost nodes first
 * - Non-leaf nodes: data space = L - childCount * 32
 * - Each child must be completely filled before moving to next
 */

import { HASH_SIZE, HEADER_SIZE } from "./constants.ts";
import type { LayoutNode } from "./types.ts";

/**
 * Compute usable space per node
 */
export function computeUsableSpace(nodeLimit: number): number {
  return nodeLimit - HEADER_SIZE;
}

/**
 * Compute maximum capacity at a given depth
 *
 * C(d) = L^d / 32^(d-1)
 *
 * @param depth - Tree depth (1 = leaf)
 * @param nodeLimit - Maximum node size in bytes
 * @returns Maximum file size that can be stored
 */
export function computeCapacity(depth: number, nodeLimit: number): number {
  if (depth < 1) {
    throw new Error("Depth must be >= 1");
  }

  const L = computeUsableSpace(nodeLimit);

  if (depth === 1) {
    return L;
  }

  // C(d) = L^d / 32^(d-1)
  // Use logarithms to avoid overflow for large depths
  const logCapacity = depth * Math.log(L) - (depth - 1) * Math.log(HASH_SIZE);
  const capacity = Math.exp(logCapacity);

  // Clamp to MAX_SAFE_INTEGER
  return Math.min(capacity, Number.MAX_SAFE_INTEGER);
}

/**
 * Compute minimum depth required for a given file size
 *
 * @param fileSize - File size in bytes
 * @param nodeLimit - Maximum node size in bytes
 * @returns Minimum tree depth (1 = leaf)
 */
export function computeDepth(fileSize: number, nodeLimit: number): number {
  if (fileSize <= 0) {
    return 1;
  }

  let depth = 1;
  while (computeCapacity(depth, nodeLimit) < fileSize) {
    depth++;
    if (depth > 10) {
      // Safety limit - depth 10 can store astronomically large files
      throw new Error(`File size ${fileSize} requires depth > 10, likely an error`);
    }
  }

  return depth;
}

/**
 * Compute the tree layout for a given file size
 *
 * Uses greedy algorithm: fill leftmost nodes first
 *
 * @param fileSize - File size in bytes
 * @param nodeLimit - Maximum node size in bytes
 * @returns Root layout node describing the tree structure
 */
export function computeLayout(fileSize: number, nodeLimit: number): LayoutNode {
  if (fileSize <= 0) {
    return { depth: 1, dataSize: 0, children: [] };
  }

  const depth = computeDepth(fileSize, nodeLimit);
  return computeLayoutAtDepth(fileSize, depth, nodeLimit);
}

/**
 * Compute layout at a specific depth
 */
function computeLayoutAtDepth(remainingSize: number, depth: number, nodeLimit: number): LayoutNode {
  const L = computeUsableSpace(nodeLimit);

  // Leaf node: all space is data
  if (depth === 1) {
    const dataSize = Math.min(remainingSize, L);
    return { depth: 1, dataSize, children: [] };
  }

  // Non-leaf node: need to compute how to split between data and children
  const childCapacity = computeCapacity(depth - 1, nodeLimit);

  // If remaining fits in L, just use data (no children needed)
  if (remainingSize <= L) {
    return { depth, dataSize: remainingSize, children: [] };
  }

  // Calculate number of children needed
  // Each child costs 32 bytes in this node but adds childCapacity
  // Let n = childCount, then:
  //   myData = L - n * 32
  //   n * childCapacity >= remainingSize - myData
  //   n * childCapacity >= remainingSize - L + n * 32
  //   n * (childCapacity - 32) >= remainingSize - L
  //   n >= (remainingSize - L) / (childCapacity - 32)
  const effectiveChildCapacity = childCapacity - HASH_SIZE;
  if (effectiveChildCapacity <= 0) {
    throw new Error("Invalid configuration: childCapacity <= HASH_SIZE");
  }

  const childCount = Math.ceil((remainingSize - L) / effectiveChildCapacity);
  const myDataSize = L - childCount * HASH_SIZE;

  if (myDataSize < 0) {
    throw new Error(`Invalid layout: negative data size at depth ${depth}`);
  }

  // Distribute remaining data to children (after myData)
  let leftover = remainingSize - myDataSize;
  const children: LayoutNode[] = [];

  for (let i = 0; i < childCount; i++) {
    const childSize = Math.min(leftover, childCapacity);
    children.push(computeLayoutAtDepth(childSize, depth - 1, nodeLimit));
    leftover -= childSize;
  }

  return { depth, dataSize: myDataSize, children };
}

/**
 * Validate that a layout correctly represents the file size
 */
export function validateLayout(layout: LayoutNode, expectedSize: number): boolean {
  const actualSize = computeLayoutSize(layout);
  return actualSize === expectedSize;
}

/**
 * Compute total data size represented by a layout
 */
export function computeLayoutSize(layout: LayoutNode): number {
  let total = layout.dataSize;
  for (const child of layout.children) {
    total += computeLayoutSize(child);
  }
  return total;
}

/**
 * Count total nodes in a layout
 */
export function countLayoutNodes(layout: LayoutNode): number {
  let count = 1;
  for (const child of layout.children) {
    count += countLayoutNodes(child);
  }
  return count;
}
