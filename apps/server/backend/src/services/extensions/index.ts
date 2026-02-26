/**
 * Node Extensions — Registration & Lifecycle
 *
 * A "node extension" produces derived data from CAS node content.
 * Derived data is deterministic (pure function of the node + its descendants)
 * and immutable — once generated, it never changes because CAS nodes are
 * immutable.
 *
 * ## Content type matching
 *
 * Each extension declares which node content types it targets:
 * - `"*"` — matches all f-nodes and d-nodes
 * - `"application/casfa-directory"` — matches d-nodes only
 * - `"image/*"` — wildcard MIME matching for f-nodes
 * - `"image/png"` — exact MIME match
 *
 * d-nodes use the virtual content type `"application/casfa-directory"`.
 *
 * ## Generation timing
 *
 * - `"on-create"` — generated when the node is stored (PUT path).
 *   Best for cheap metadata that is almost always needed (e.g., "meta").
 *
 * - `"on-demand"` — generated on first access (query returns null → generate → store).
 *   Best for expensive operations that may not always be needed (e.g., "thumbnail").
 *
 * @packageDocumentation
 */

import type { CasNode } from "@casfa/core";
import type { NodeDerivedDb } from "../../db/node-derived.ts";

// ============================================================================
// Types
// ============================================================================

/** Virtual content type for d-nodes */
export const DIRECTORY_CONTENT_TYPE = "application/casfa-directory";

/**
 * Context available to extension generators.
 */
export type ExtensionContext = {
  /** The CB32 storage key of the node */
  storageKey: string;
  /** The decoded CAS node */
  node: CasNode;
  /** Effective content type ("application/casfa-directory" for d-nodes) */
  contentType: string;
  /** Read another node by storage key (for traversing descendants) */
  getNode: (storageKey: string) => Promise<CasNode | null>;
};

/**
 * Definition of a node extension.
 */
export type NodeExtensionDef<T extends Record<string, unknown> = Record<string, unknown>> = {
  /** Unique extension name (used as DB key, e.g., "meta", "thumbnail") */
  name: string;

  /**
   * Content type patterns this extension applies to.
   * - `"*"` matches everything (f-nodes and d-nodes)
   * - `"application/casfa-directory"` matches d-nodes only
   * - `"image/*"` wildcard MIME for f-nodes
   * - `"image/png"` exact match
   */
  contentTypes: string[];

  /** When to generate derived data */
  timing: "on-create" | "on-demand";

  /**
   * Generate derived data from a node.
   * Must return a JSON-serializable object that fits in a single DynamoDB
   * item (<400KB).
   */
  generate: (ctx: ExtensionContext) => Promise<T>;
};

// ============================================================================
// Content-Type Matching
// ============================================================================

/**
 * Determine the effective content type for matching purposes.
 * d-nodes → "application/casfa-directory"
 * f-nodes → their actual content type
 */
export function getEffectiveContentType(node: CasNode): string {
  if (node.kind === "dict") return DIRECTORY_CONTENT_TYPE;
  if (node.kind === "file") return node.fileInfo?.contentType ?? "application/octet-stream";
  // successor / set nodes — not targeted by extensions
  return "application/octet-stream";
}

/** Check if a content type pattern matches an effective content type */
function matchesContentType(pattern: string, contentType: string): boolean {
  if (pattern === "*") return true;
  if (pattern === contentType) return true;
  // Wildcard: "image/*" matches "image/png"
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // "image/"
    return contentType.startsWith(prefix);
  }
  return false;
}

// ============================================================================
// Extension Registry
// ============================================================================

export type ExtensionRegistry = {
  /** Register an extension definition */
  register: (ext: NodeExtensionDef) => void;

  /** Get a registered extension by name */
  getExtension: (name: string) => NodeExtensionDef | undefined;

  /** List all registered extensions */
  listExtensions: () => NodeExtensionDef[];

  /**
   * Find extensions that match a given node, filtered by timing.
   */
  findMatchingExtensions: (
    node: CasNode,
    timing?: "on-create" | "on-demand"
  ) => NodeExtensionDef[];
};

export const createExtensionRegistry = (): ExtensionRegistry => {
  const extensions = new Map<string, NodeExtensionDef>();

  return {
    register: (ext) => {
      extensions.set(ext.name, ext);
    },

    getExtension: (name) => extensions.get(name),

    listExtensions: () => [...extensions.values()],

    findMatchingExtensions: (node, timing?) => {
      // Only f-node and d-node are targetable
      if (node.kind !== "file" && node.kind !== "dict") return [];

      const ct = getEffectiveContentType(node);
      const result: NodeExtensionDef[] = [];
      for (const ext of extensions.values()) {
        if (timing && ext.timing !== timing) continue;
        if (ext.contentTypes.some((pattern) => matchesContentType(pattern, ct))) {
          result.push(ext);
        }
      }
      return result;
    },
  };
};

// ============================================================================
// Extension Service — orchestrates generation + storage
// ============================================================================

export type ExtensionServiceDeps = {
  registry: ExtensionRegistry;
  derivedDb: NodeDerivedDb;
  /** Decode a node from storage by CB32 key */
  getAndDecodeNode: (storageKey: string) => Promise<CasNode | null>;
};

export type ExtensionService = {
  /**
   * Run all "on-create" extensions for a newly stored node.
   * Called from the node-put code path. Fire-and-forget safe.
   */
  onNodeCreated: (storageKey: string, node: CasNode) => Promise<void>;

  /**
   * Get derived data for a single node + extension.
   * If missing and the extension is "on-demand", generates and stores it.
   */
  getDerived: (
    storageKey: string,
    extensionName: string
  ) => Promise<Record<string, unknown> | null>;

  /**
   * Batch-get derived data for multiple nodes under the same extension.
   * Missing "on-demand" entries are generated and stored.
   * Returns Map<storageKey, data>.
   */
  batchGetDerived: (
    storageKeys: string[],
    extensionName: string
  ) => Promise<Map<string, Record<string, unknown>>>;
};

export const createExtensionService = (deps: ExtensionServiceDeps): ExtensionService => {
  const { registry, derivedDb, getAndDecodeNode } = deps;

  const makeContext = (storageKey: string, node: CasNode): ExtensionContext => ({
    storageKey,
    node,
    contentType: getEffectiveContentType(node),
    getNode: getAndDecodeNode,
  });

  const generateAndStore = async (
    storageKey: string,
    node: CasNode,
    ext: NodeExtensionDef
  ): Promise<Record<string, unknown>> => {
    const ctx = makeContext(storageKey, node);
    const data = await ext.generate(ctx);
    await derivedDb.put(storageKey, ext.name, data);
    return data;
  };

  return {
    onNodeCreated: async (storageKey, node) => {
      const exts = registry.findMatchingExtensions(node, "on-create");
      for (const ext of exts) {
        try {
          await generateAndStore(storageKey, node, ext);
        } catch {
          // Extension generation failure should not block node creation
        }
      }
    },

    getDerived: async (storageKey, extensionName) => {
      // Check DB first
      const existing = await derivedDb.get(storageKey, extensionName);
      if (existing) return existing.data;

      // On-demand generation
      const ext = registry.getExtension(extensionName);
      if (!ext) return null;

      const node = await getAndDecodeNode(storageKey);
      if (!node) return null;

      // Verify extension applies to this node kind
      if (node.kind !== "file" && node.kind !== "dict") return null;
      const ct = getEffectiveContentType(node);
      if (!ext.contentTypes.some((p) => matchesContentType(p, ct))) return null;

      return generateAndStore(storageKey, node, ext);
    },

    batchGetDerived: async (storageKeys, extensionName) => {
      const result = new Map<string, Record<string, unknown>>();
      if (storageKeys.length === 0) return result;

      // Batch read from DB
      const existing = await derivedDb.batchGet(storageKeys, extensionName);
      for (const [key, record] of existing) {
        result.set(key, record.data);
      }

      // Find missing keys
      const missing = storageKeys.filter((k) => !result.has(k));
      if (missing.length === 0) return result;

      // On-demand generation for missing keys
      const ext = registry.getExtension(extensionName);
      if (!ext) return result;

      for (const key of missing) {
        try {
          const node = await getAndDecodeNode(key);
          if (!node || (node.kind !== "file" && node.kind !== "dict")) continue;

          const ct = getEffectiveContentType(node);
          if (!ext.contentTypes.some((p) => matchesContentType(p, ct))) continue;

          const data = await generateAndStore(key, node, ext);
          result.set(key, data);
        } catch {
          // Skip nodes that fail — don't block the batch
        }
      }

      return result;
    },
  };
};
