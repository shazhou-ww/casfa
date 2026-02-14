/**
 * CAS Controller - Functional API
 *
 * High-level functions for CAS operations, matching CASFA API granularity.
 * Uses injected StorageProvider and KeyProvider for platform abstraction.
 */

import { DEFAULT_NODE_LIMIT, HASH_SIZE } from "./constants.ts";
import { decodeNode, encodeDictNode, encodeFileNode, encodeSuccessorNode } from "./node.ts";
import { computeLayout } from "./topology.ts";
import type {
  CasNode,
  DictNodeInput,
  KeyProvider,
  LayoutNode,
  NodeKind,
  StorageProvider,
} from "./types.ts";
import { concatBytes, hashToKey, keyToHash } from "./utils.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Controller context - dependencies for CAS operations
 */
export type CasContext = {
  /** Storage provider for reading/writing nodes */
  storage: StorageProvider;
  /** Key provider for content-addressed key computation */
  key: KeyProvider;
  /** Maximum node size in bytes (default: 1MB) */
  nodeLimit?: number;
};

/**
 * Tree node info returned by getTree
 */
export type TreeNodeInfo = {
  kind: NodeKind;
  size: number;
  contentType?: string;
  children?: string[];
  childNames?: string[];
};

/**
 * Tree response from getTree
 */
export type TreeResponse = {
  nodes: Record<string, TreeNodeInfo>;
};

/**
 * Dict entry for makeDict
 */
export type DictEntry = {
  name: string;
  key: string;
};

/**
 * Write result
 */
export type WriteResult = {
  /** Root key of the written content */
  key: string;
  /** Total size in bytes */
  size: number;
  /** Number of nodes created */
  nodeCount: number;
};

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Convert CB32 storage key to hash bytes
 */
const keyToHashBytes = (key: string): Uint8Array => {
  const bytes = keyToHash(key);
  if (bytes.length !== HASH_SIZE) {
    throw new Error(`Invalid key format: expected ${HASH_SIZE} bytes, got ${bytes.length}`);
  }
  return bytes;
};

/**
 * Compute total data size from layout
 */
const computeLayoutTotalSize = (layout: LayoutNode): number => {
  let total = layout.dataSize;
  for (const child of layout.children) {
    total += computeLayoutTotalSize(child);
  }
  return total;
};

/**
 * Count nodes in layout
 */
const countLayoutNodes = (layout: LayoutNode): number => {
  let count = 1;
  for (const child of layout.children) {
    count += countLayoutNodes(child);
  }
  return count;
};

/**
 * Recursively upload a file node according to layout
 * In v2.1: f-node stores fileSize in FileInfo, s-node has no fileSize
 */
const uploadFileNode = async (
  ctx: CasContext,
  data: Uint8Array,
  offset: number,
  contentType: string,
  layout: LayoutNode,
  totalFileSize: number,
  isRoot: boolean = true
): Promise<Uint8Array> => {
  const { storage, key } = ctx;
  const nodeData = data.slice(offset, offset + layout.dataSize);

  if (layout.children.length === 0) {
    // Leaf node
    if (isRoot) {
      const encoded = await encodeFileNode(
        { data: nodeData, contentType, fileSize: totalFileSize },
        key
      );
      await storage.put(hashToKey(encoded.hash), encoded.bytes);
      return encoded.hash;
    } else {
      const encoded = await encodeSuccessorNode({ data: nodeData }, key);
      await storage.put(hashToKey(encoded.hash), encoded.bytes);
      return encoded.hash;
    }
  }

  // Internal node: upload children first
  const childHashes: Uint8Array[] = [];
  let childOffset = offset + layout.dataSize;

  for (const childLayout of layout.children) {
    const childHash = await uploadFileNode(
      ctx,
      data,
      childOffset,
      contentType,
      childLayout,
      totalFileSize,
      false
    );
    childHashes.push(childHash);
    childOffset += computeLayoutTotalSize(childLayout);
  }

  if (isRoot) {
    const encoded = await encodeFileNode(
      { data: nodeData, contentType, fileSize: totalFileSize, children: childHashes },
      key
    );
    await storage.put(hashToKey(encoded.hash), encoded.bytes);
    return encoded.hash;
  } else {
    const encoded = await encodeSuccessorNode({ data: nodeData, children: childHashes }, key);
    await storage.put(hashToKey(encoded.hash), encoded.bytes);
    return encoded.hash;
  }
};

/**
 * Recursively read file/successor node data
 */
const readFileNodeData = async (ctx: CasContext, node: CasNode): Promise<Uint8Array> => {
  const parts: Uint8Array[] = [];

  if (node.data) {
    parts.push(node.data);
  }

  if (node.children) {
    for (const childHash of node.children) {
      const childKey = hashToKey(childHash);
      const childNode = await getNode(ctx, childKey);
      if (childNode && (childNode.kind === "file" || childNode.kind === "successor")) {
        const childData = await readFileNodeData(ctx, childNode);
        parts.push(childData);
      }
    }
  }

  return concatBytes(...parts);
};

/**
 * Recursively stream file/successor node data
 */
const streamFileNodeData = async (
  ctx: CasContext,
  node: CasNode,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> => {
  if (node.data && node.data.length > 0) {
    controller.enqueue(node.data);
  }

  if (node.children) {
    for (const childHash of node.children) {
      const childKey = hashToKey(childHash);
      const childNode = await getNode(ctx, childKey);
      if (childNode && (childNode.kind === "file" || childNode.kind === "successor")) {
        await streamFileNodeData(ctx, childNode, controller);
      }
    }
  }
};

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Write a file, automatically splitting into B-Tree if needed
 */
export const writeFile = async (
  ctx: CasContext,
  data: Uint8Array,
  contentType: string
): Promise<WriteResult> => {
  const nodeLimit = ctx.nodeLimit ?? DEFAULT_NODE_LIMIT;
  const size = data.length;
  const layout = computeLayout(size, nodeLimit);
  const nodeCount = countLayoutNodes(layout);

  const rootHash = await uploadFileNode(ctx, data, 0, contentType, layout, size);
  const key = hashToKey(rootHash);

  return { key, size, nodeCount };
};

/**
 * Put a raw file node (for cases where caller handles splitting)
 */
export const putFileNode = async (
  ctx: CasContext,
  data: Uint8Array,
  contentType?: string
): Promise<string> => {
  const encoded = await encodeFileNode({ data, contentType, fileSize: data.length }, ctx.key);
  await ctx.storage.put(hashToKey(encoded.hash), encoded.bytes);
  return hashToKey(encoded.hash);
};

/**
 * Make a dict (directory) from existing nodes
 */
export const makeDict = async (ctx: CasContext, entries: DictEntry[]): Promise<string> => {
  const children: Uint8Array[] = [];
  const childNames: string[] = [];
  let _totalSize = 0;

  for (const entry of entries) {
    children.push(keyToHashBytes(entry.key));
    childNames.push(entry.name);
    const childNode = await getNode(ctx, entry.key);
    if (childNode) {
      _totalSize += childNode.size;
    }
  }

  const input: DictNodeInput = {
    children,
    childNames,
  };

  const encoded = await encodeDictNode(input, ctx.key);
  await ctx.storage.put(hashToKey(encoded.hash), encoded.bytes);

  return hashToKey(encoded.hash);
};

/**
 * Get tree structure starting from a key
 */
export const getTree = async (
  ctx: CasContext,
  rootKey: string,
  limit = 1000
): Promise<TreeResponse> => {
  const nodes: Record<string, TreeNodeInfo> = {};
  const queue: string[] = [rootKey];

  while (queue.length > 0 && Object.keys(nodes).length < limit) {
    const key = queue.shift()!;

    if (nodes[key]) continue;

    const data = await ctx.storage.get(key);
    if (!data) continue;

    const node = decodeNode(data);
    const childKeys = node.children?.map((h) => hashToKey(h));

    const info: TreeNodeInfo = {
      kind: node.kind,
      size: node.size,
    };

    if (node.fileInfo?.contentType) {
      info.contentType = node.fileInfo.contentType;
    }

    if (childKeys && childKeys.length > 0) {
      info.children = childKeys;
    }

    if (node.childNames && node.childNames.length > 0) {
      info.childNames = node.childNames;
    }

    nodes[key] = info;

    if (childKeys) {
      for (const childKey of childKeys) {
        if (!nodes[childKey]) {
          queue.push(childKey);
        }
      }
    }
  }

  return { nodes };
};

/**
 * Get raw chunk data
 */
export const getChunk = async (ctx: CasContext, key: string): Promise<Uint8Array | null> => {
  return ctx.storage.get(key);
};

/**
 * Get decoded node
 */
export const getNode = async (ctx: CasContext, key: string): Promise<CasNode | null> => {
  const data = await ctx.storage.get(key);
  if (!data) return null;
  return decodeNode(data);
};

/**
 * Read file content by traversing B-Tree
 */
export const readFile = async (ctx: CasContext, key: string): Promise<Uint8Array | null> => {
  const node = await getNode(ctx, key);
  if (!node) return null;
  if (node.kind !== "file" && node.kind !== "successor") return null;

  return readFileNodeData(ctx, node);
};

/**
 * Open file as readable stream (for large files)
 */
export const openFileStream = (ctx: CasContext, key: string): ReadableStream<Uint8Array> => {
  return new ReadableStream({
    async start(controller) {
      const node = await getNode(ctx, key);
      if (!node) {
        controller.close();
        return;
      }
      if (node.kind !== "file" && node.kind !== "successor") {
        controller.close();
        return;
      }

      await streamFileNodeData(ctx, node, controller);
      controller.close();
    },
  });
};

/**
 * Get the node limit from context
 */
export const getNodeLimit = (ctx: CasContext): number => {
  return ctx.nodeLimit ?? DEFAULT_NODE_LIMIT;
};
