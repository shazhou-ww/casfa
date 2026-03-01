import type { CasFacade } from "@casfa/cas";
import { bytesFromStream, streamFromBytes } from "@casfa/cas";
import type { CasNode, KeyProvider, StorageProvider } from "@casfa/core";
import { decodeNode, encodeDictNode, hashToKey, keyToHash } from "@casfa/core";
import type { MovedEntry } from "@casfa/dag-diff";
import { dagDiff } from "@casfa/dag-diff";
import { createRealmError } from "./errors.ts";
import type { Depot, DepotStore } from "./realm-legacy-types.ts";

export type RealmServiceContext = {
  cas: CasFacade;
  depotStore: DepotStore;
  key: KeyProvider;
  storage: StorageProvider;
};

export type PathInput = string | string[];

function normalizePath(path: PathInput): string[] {
  if (Array.isArray(path)) {
    return path.filter((s) => s.length > 0);
  }
  return path.split("/").filter((s) => s.length > 0);
}

/** Normalize depot mountPath to a single string for dag-diff comparison (e.g. "foo" or "foo/bar"). */
function mountPathToString(mountPath: string[] | string): string {
  if (Array.isArray(mountPath)) {
    return mountPath.filter((s) => s.length > 0).join("/");
  }
  return mountPath;
}

/**
 * Resolve one path segment from a node: by name (dict) or by index (dict/set).
 * Returns child key or null if not found.
 */
function resolveSegment(node: CasNode, segment: string): string | null {
  const children = node.children;
  if (!children || children.length === 0) return null;

  if (node.kind === "dict") {
    const names = node.childNames;
    if (names) {
      const nameIdx = names.indexOf(segment);
      if (nameIdx >= 0) return hashToKey(children[nameIdx]!);
    }
    const num = parseInt(segment, 10);
    if (String(num) === segment && num >= 0 && num < children.length) {
      return hashToKey(children[num]!);
    }
    return null;
  }

  if (node.kind === "set") {
    const num = parseInt(segment, 10);
    if (String(num) === segment && num >= 0 && num < children.length) {
      return hashToKey(children[num]!);
    }
    return null;
  }

  return null;
}

/**
 * Resolve path from depot root to final node key. Returns key or null.
 */
async function resolvePath(
  cas: CasFacade,
  getRoot: (depotId: string) => Promise<string | null>,
  depotId: string,
  segments: string[]
): Promise<string | null> {
  const rootKey = await getRoot(depotId);
  if (rootKey === null) return null;
  if (segments.length === 0) return rootKey;

  let key = rootKey;
  for (const segment of segments) {
    const result = await cas.getNode(key);
    if (!result) return null;
    const bytes = await bytesFromStream(result.body);
    const node = decodeNode(bytes);
    const nextKey = resolveSegment(node, segment);
    if (nextKey === null) return null;
    key = nextKey;
  }
  return key;
}

/**
 * Build a new dict node that is a copy of the given node but with one entry replaced.
 * node must be a dict. Returns the key of the new node (caller must putNode).
 */
async function replaceDictEntry(
  cas: CasFacade,
  keyProvider: KeyProvider,
  nodeKey: string,
  replaceName: string,
  replaceKey: string
): Promise<{ newKey: string; bytes: Uint8Array }> {
  const result = await cas.getNode(nodeKey);
  if (!result) throw createRealmError("InvalidPath", "node not found");
  const bytes = await bytesFromStream(result.body);
  const node = decodeNode(bytes);
  if (node.kind !== "dict") throw createRealmError("InvalidPath", "node is not a dict");
  const names = node.childNames ?? [];
  const children = node.children ?? [];
  const nameIdx = names.indexOf(replaceName);
  if (nameIdx < 0) throw createRealmError("InvalidPath", `entry ${replaceName} not found`);
  const newChildren = children.slice();
  const newNames = names.slice();
  newChildren[nameIdx] = keyToHash(replaceKey);
  const encoded = await encodeDictNode(
    { children: newChildren, childNames: newNames },
    keyProvider
  );
  const newKey = hashToKey(encoded.hash);
  return { newKey, bytes: encoded.bytes };
}

/**
 * Replace subtree at path in the tree rooted at nodeKey. Path segments walk by name.
 * Returns the key of the new root (new nodes are put via cas).
 */
async function replaceSubtreeAtPath(
  cas: CasFacade,
  keyProvider: KeyProvider,
  nodeKey: string,
  segments: string[],
  newChildKey: string
): Promise<string> {
  if (segments.length === 0) throw createRealmError("InvalidPath", "mount path must not be empty");
  const result = await cas.getNode(nodeKey);
  if (!result) throw createRealmError("InvalidPath", "node not found");
  const bytes = await bytesFromStream(result.body);
  const node = decodeNode(bytes);
  if (node.kind !== "dict") throw createRealmError("InvalidPath", "node is not a dict");
  if (segments.length === 1) {
    const { newKey, bytes: newBytes } = await replaceDictEntry(
      cas,
      keyProvider,
      nodeKey,
      segments[0]!,
      newChildKey
    );
    await cas.putNode(newKey, streamFromBytes(newBytes));
    return newKey;
  }
  const firstKey = resolveSegment(node, segments[0]!);
  if (firstKey === null)
    throw createRealmError("InvalidPath", `path segment ${segments[0]} not found`);
  const newFirstKey = await replaceSubtreeAtPath(
    cas,
    keyProvider,
    firstKey,
    segments.slice(1),
    newChildKey
  );
  const { newKey, bytes: newBytes } = await replaceDictEntry(
    cas,
    keyProvider,
    nodeKey,
    segments[0]!,
    newFirstKey
  );
  await cas.putNode(newKey, streamFromBytes(newBytes));
  return newKey;
}

export function createRealmService(ctx: RealmServiceContext) {
  const { cas, depotStore, key, storage } = ctx;
  return {
    get cas(): CasFacade {
      return cas;
    },
    get depotStore(): DepotStore {
      return depotStore;
    },
    get key(): KeyProvider {
      return key;
    },
    get storage(): StorageProvider {
      return storage;
    },

    async createDepot(parentDepotId: string, path: PathInput): Promise<Depot> {
      const parent = await depotStore.getDepot(parentDepotId);
      if (!parent) throw createRealmError("NotFound", "parent depot not found");
      const rootKey = await depotStore.getRoot(parentDepotId);
      if (rootKey === null) throw createRealmError("NotFound", "parent has no root");
      const segments = normalizePath(path);
      const childKey = await resolvePath(
        cas,
        (id) => depotStore.getRoot(id),
        parentDepotId,
        segments
      );
      if (childKey === null)
        throw createRealmError("InvalidPath", "path does not resolve under parent root");
      const depotId = crypto.randomUUID();
      const mountPath = typeof path === "string" ? path : segments;
      const newDepot: Depot = {
        depotId,
        realmId: parent.realmId,
        parentId: parent.depotId,
        mountPath,
      };
      await depotStore.insertDepot(newDepot);
      await depotStore.setRoot(depotId, childKey);
      return newDepot;
    },

    async commitDepot(depotId: string, newRootKey: string, oldRootKey: string): Promise<void> {
      const current = await depotStore.getRoot(depotId);
      if (current !== oldRootKey) throw createRealmError("CommitConflict");
      const depot = await depotStore.getDepot(depotId);
      if (!depot) throw createRealmError("NotFound", "depot not found");
      await depotStore.setRoot(depotId, newRootKey);

      const allDepots = await depotStore.listDepots(depot.realmId);
      const children = allDepots.filter((d) => d.parentId === depotId);
      if (children.length === 0) return;

      const result = await dagDiff(oldRootKey, newRootKey, { storage });
      const updateDepotPath = depotStore.updateDepotPath;
      if (!updateDepotPath) return;

      for (const child of children) {
        const mountPathStr = mountPathToString(child.mountPath);
        const childRootKey = await depotStore.getRoot(child.depotId);
        if (childRootKey === null) continue;
        const moved = result.entries.find(
          (e): e is MovedEntry =>
            e.type === "moved" && e.pathsFrom.includes(mountPathStr) && e.nodeKey === childRootKey
        );
        if (moved && moved.pathsTo.length > 0) {
          const newPath = moved.pathsTo[0]!;
          await updateDepotPath(child.depotId, newPath);
        }
      }
    },

    async closeDepot(depotId: string): Promise<void> {
      const depot = await depotStore.getDepot(depotId);
      if (!depot) throw createRealmError("NotFound", "depot not found");
      const parentId = depot.parentId;
      if (parentId === null) throw createRealmError("InvalidPath", "cannot close root depot");
      const mountPath = depot.mountPath;
      const segments = normalizePath(mountPath);
      if (segments.length === 0)
        throw createRealmError("InvalidPath", "mount path must not be empty");

      const childRootKey = await depotStore.getRoot(depotId);
      if (childRootKey === null) throw createRealmError("NotFound", "child depot has no root");
      const parentRootKey = await depotStore.getRoot(parentId);
      if (parentRootKey === null) throw createRealmError("NotFound", "parent has no root");

      const newParentRootKey = await replaceSubtreeAtPath(
        cas,
        key,
        parentRootKey,
        segments,
        childRootKey
      );
      await this.commitDepot(parentId, newParentRootKey, parentRootKey);

      if (depotStore.setClosed) {
        await depotStore.setClosed(depotId);
      } else {
        await depotStore.removeDepot(depotId);
      }
    },

    async getNode(depotId: string, path: PathInput): Promise<CasNode | null> {
      const segments = normalizePath(path);
      const keyResolved = await resolvePath(cas, (id) => depotStore.getRoot(id), depotId, segments);
      if (keyResolved === null) return null;
      const result = await cas.getNode(keyResolved);
      if (!result) return null;
      const bytes = await bytesFromStream(result.body);
      return decodeNode(bytes);
    },

    async hasNode(depotId: string, path: PathInput): Promise<boolean> {
      const segments = normalizePath(path);
      const keyResolved = await resolvePath(cas, (id) => depotStore.getRoot(id), depotId, segments);
      if (keyResolved === null) return false;
      return cas.hasNode(keyResolved);
    },

    async putNode(nodeKey: string, data: Uint8Array): Promise<void> {
      await cas.putNode(nodeKey, streamFromBytes(data));
    },

    async gc(realmId: string, cutOffTime: number): Promise<void> {
      const depots = await depotStore.listDepots(realmId);
      const rootKeys = new Set<string>();
      for (const d of depots) {
        const root = await depotStore.getRoot(d.depotId);
        if (root !== null) rootKeys.add(root);
      }
      await cas.gc([...rootKeys], cutOffTime);
    },

    async info(realmId?: string): Promise<{
      lastGcTime?: number;
      nodeCount: number;
      totalBytes: number;
      depotCount?: number;
    }> {
      const casInfo = await cas.info();
      const result = { ...casInfo };
      if (realmId !== undefined) {
        const depots = await depotStore.listDepots(realmId);
        (result as { depotCount?: number }).depotCount = depots.length;
      }
      return result;
    },
  };
}

export type RealmService = ReturnType<typeof createRealmService>;
