/**
 * Viewer service — unified API combining built-in and custom viewers.
 *
 * Used by the SW to handle viewer-related RPC calls from the main thread.
 * Built-in viewers are initialized lazily via initBuiltinViewers(); custom
 * viewers are persisted in IndexedDB via ViewerStore.
 */

import type { KeyProvider } from "@casfa/core";
import { initBuiltinViewers, type BuiltinViewer } from "./builtin-viewers.ts";
import { createViewerStore, type CustomViewerEntry, type ViewerStore } from "./viewer-store.ts";

// ============================================================================
// Types
// ============================================================================

/** Unified viewer info returned to the main thread */
export interface ViewerInfo {
  /** Unique identifier (builtin key or custom UUID) */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Supported content type patterns (e.g. "image/*", "text/*") */
  contentTypes: string[];
  /** CAS node key of the viewer d-node (nod_XXX) */
  nodeKey: string;
  /** Whether this is a built-in viewer */
  isBuiltin: boolean;
}

/** Input for adding a custom viewer */
export interface AddCustomViewerInput {
  /** Display name */
  name: string;
  /** Description */
  description?: string;
  /** Supported content type patterns */
  contentTypes: string[];
  /** CAS node key of the viewer d-node (nod_XXX) */
  nodeKey: string;
}

/** Input for updating a custom viewer */
export interface UpdateCustomViewerInput {
  /** New display name */
  name?: string;
  /** New description */
  description?: string;
  /** New content type patterns */
  contentTypes?: string[];
  /** New node key */
  nodeKey?: string;
}

// ============================================================================
// Service
// ============================================================================

export interface ViewerService {
  /** List all viewers (built-in + custom) */
  listAll(): Promise<ViewerInfo[]>;
  /** List only built-in viewers */
  listBuiltin(): Promise<ViewerInfo[]>;
  /** List only custom viewers */
  listCustom(): Promise<ViewerInfo[]>;
  /** Add a custom viewer */
  addCustom(input: AddCustomViewerInput): Promise<ViewerInfo>;
  /** Remove a custom viewer by id */
  removeCustom(id: string): Promise<void>;
  /** Update a custom viewer */
  updateCustom(id: string, updates: UpdateCustomViewerInput): Promise<ViewerInfo>;
}

function builtinToInfo(v: BuiltinViewer): ViewerInfo {
  return {
    id: `builtin:${v.nodeKey}`,
    name: v.name,
    description: v.description,
    contentTypes: v.contentTypes,
    nodeKey: v.nodeKey,
    isBuiltin: true,
  };
}

function customToInfo(e: CustomViewerEntry): ViewerInfo {
  return {
    id: e.id,
    name: e.name,
    description: e.description,
    contentTypes: e.contentTypes,
    nodeKey: e.nodeKey,
    isBuiltin: false,
  };
}

export function createViewerService(
  keyProvider: KeyProvider,
  virtualStore: Map<string, Uint8Array>
): ViewerService {
  const store: ViewerStore = createViewerStore();

  async function getBuiltins(): Promise<BuiltinViewer[]> {
    return initBuiltinViewers(keyProvider, virtualStore);
  }

  return {
    async listAll(): Promise<ViewerInfo[]> {
      console.log("[ViewerService] listAll() start");
      const [builtins, customs] = await Promise.all([getBuiltins(), store.loadAll()]);
      console.log("[ViewerService] listAll() done — builtins:", builtins.length, "customs:", customs.length);
      return [...builtins.map(builtinToInfo), ...customs.map(customToInfo)];
    },

    async listBuiltin(): Promise<ViewerInfo[]> {
      const builtins = await getBuiltins();
      return builtins.map(builtinToInfo);
    },

    async listCustom(): Promise<ViewerInfo[]> {
      const customs = await store.loadAll();
      return customs.map(customToInfo);
    },

    async addCustom(input: AddCustomViewerInput): Promise<ViewerInfo> {
      const entry: CustomViewerEntry = {
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description ?? "",
        contentTypes: input.contentTypes,
        nodeKey: input.nodeKey,
        createdAt: Date.now(),
      };
      await store.put(entry);
      return customToInfo(entry);
    },

    async removeCustom(id: string): Promise<void> {
      await store.remove(id);
    },

    async updateCustom(id: string, updates: UpdateCustomViewerInput): Promise<ViewerInfo> {
      const existing = await store.get(id);
      if (!existing) {
        throw new Error(`Custom viewer not found: ${id}`);
      }
      const updated: CustomViewerEntry = {
        ...existing,
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.contentTypes !== undefined && { contentTypes: updates.contentTypes }),
        ...(updates.nodeKey !== undefined && { nodeKey: updates.nodeKey }),
      };
      await store.put(updated);
      return customToInfo(updated);
    },
  };
}
