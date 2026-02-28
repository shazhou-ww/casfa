import type { CasService } from "@casfa/cas";
import type { CasNode, KeyProvider, StorageProvider } from "@casfa/core";
import { encodeDictNode, hashToKey, keyToHash } from "@casfa/core";
import { dagDiff } from "@casfa/dag-diff";
import type { MovedEntry } from "@casfa/dag-diff";
import { RealmError } from "./errors.ts";
import type { Depot, DepotStore } from "./types.ts";

export type RealmServiceContext = {
  cas: CasService;
  depotStore: DepotStore;
  /** KeyProvider for building new dict nodes (e.g. closeDepot). Same as CAS context key. */
  key: KeyProvider;
  /** Storage for dag-diff (e.g. same store CAS uses). Required for updating child depot paths on parent commit move. */
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
  cas: CasService,
  getRoot: (depotId: string) => Promise<string | null>,
  depotId: string,
  segments: string[]
): Promise<string | null> {
  const rootKey = await getRoot(depotId);
  if (rootKey === null) return null;
  if (segments.length === 0) return rootKey;

  let key = rootKey;
  for (const segment of segments) {
    const node = await cas.getNode(key);
    if (!node) return null;
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
  cas: CasService,
  keyProvider: KeyProvider,
  nodeKey: string,
  replaceName: string,
  replaceKey: string
): Promise<{ newKey: string; bytes: Uint8Array }> {
  const node = await cas.getNode(nodeKey);
  if (!node || node.kind !== "dict") throw new RealmError("InvalidPath", "node is not a dict");
  const names = node.childNames ?? [];
  const children = node.children ?? [];
  const nameIdx = names.indexOf(replaceName);
  if (nameIdx < 0) throw new RealmError("InvalidPath", `entry ${replaceName} not found`);
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
  cas: CasService,
  keyProvider: KeyProvider,
  nodeKey: string,
  segments: string[],
  newChildKey: string
): Promise<string> {
  if (segments.length === 0) throw new RealmError("InvalidPath", "mount path must not be empty");
  const node = await cas.getNode(nodeKey);
  if (!node || node.kind !== "dict") throw new RealmError("InvalidPath", "node is not a dict");
  if (segments.length === 1) {
    const { newKey, bytes } = await replaceDictEntry(
      cas,
      keyProvider,
      nodeKey,
      segments[0]!,
      newChildKey
    );
    await cas.putNode(newKey, bytes);
    return newKey;
  }
  const firstKey = resolveSegment(node, segments[0]!);
  if (firstKey === null) throw new RealmError("InvalidPath", `path segment ${segments[0]} not found`);
  const newFirstKey = await replaceSubtreeAtPath(
    cas,
    keyProvider,
    firstKey,
    segments.slice(1),
    newChildKey
  );
  const { newKey, bytes } = await replaceDictEntry(
    cas,
    keyProvider,
    nodeKey,
    segments[0]!,
    newFirstKey
  );
  await cas.putNode(newKey, bytes);
  return newKey;
}

export class RealmService {
  readonly cas: CasService;
  readonly depotStore: DepotStore;
  readonly key: KeyProvider;
  readonly storage: StorageProvider;

  constructor(ctx: RealmServiceContext) {
    this.cas = ctx.cas;
    this.depotStore = ctx.depotStore;
    this.key = ctx.key;
    this.storage = ctx.storage;
  }

  async createDepot(parentDepotId: string, path: PathInput): Promise<Depot> {
    const parent = await this.depotStore.getDepot(parentDepotId);
    if (!parent) throw new RealmError("NotFound", "parent depot not found");
    const rootKey = await this.depotStore.getRoot(parentDepotId);
    if (rootKey === null) throw new RealmError("NotFound", "parent has no root");
    const segments = normalizePath(path);
    const childKey = await resolvePath(
      this.cas,
      (id) => this.depotStore.getRoot(id),
      parentDepotId,
      segments
    );
    if (childKey === null) throw new RealmError("InvalidPath", "path does not resolve under parent root");
    const depotId = crypto.randomUUID();
    const mountPath = typeof path === "string" ? path : segments;
    const newDepot: Depot = {
      depotId,
      realmId: parent.realmId,
      parentId: parent.depotId,
      mountPath,
    };
    await this.depotStore.insertDepot(newDepot);
    await this.depotStore.setRoot(depotId, childKey);
    return newDepot;
  }

  async commitDepot(depotId: string, newRootKey: string, oldRootKey: string): Promise<void> {
    const current = await this.depotStore.getRoot(depotId);
    if (current !== oldRootKey) throw new RealmError("CommitConflict");
    const depot = await this.depotStore.getDepot(depotId);
    if (!depot) throw new RealmError("NotFound", "depot not found");
    await this.depotStore.setRoot(depotId, newRootKey);

    // After parent commit: if this depot has child depots, run dag-diff and update child mount paths on move
    const allDepots = await this.depotStore.listDepots(depot.realmId);
    const children = allDepots.filter((d) => d.parentId === depotId);
    if (children.length === 0) return;

    const result = await dagDiff(oldRootKey, newRootKey, { storage: this.storage });
    const updateDepotPath = this.depotStore.updateDepotPath;
    if (!updateDepotPath) return;

    for (const child of children) {
      const mountPathStr = mountPathToString(child.mountPath);
      const childRootKey = await this.depotStore.getRoot(child.depotId);
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
  }

  async closeDepot(depotId: string): Promise<void> {
    const depot = await this.depotStore.getDepot(depotId);
    if (!depot) throw new RealmError("NotFound", "depot not found");
    const parentId = depot.parentId;
    if (parentId === null) throw new RealmError("InvalidPath", "cannot close root depot");
    const mountPath = depot.mountPath;
    const segments = normalizePath(mountPath);
    if (segments.length === 0) throw new RealmError("InvalidPath", "mount path must not be empty");

    const childRootKey = await this.depotStore.getRoot(depotId);
    if (childRootKey === null) throw new RealmError("NotFound", "child depot has no root");
    const parentRootKey = await this.depotStore.getRoot(parentId);
    if (parentRootKey === null) throw new RealmError("NotFound", "parent has no root");

    const newParentRootKey = await replaceSubtreeAtPath(
      this.cas,
      this.key,
      parentRootKey,
      segments,
      childRootKey
    );
    await this.commitDepot(parentId, newParentRootKey, parentRootKey);

    if (this.depotStore.setClosed) {
      await this.depotStore.setClosed(depotId);
    } else {
      await this.depotStore.removeDepot(depotId);
    }
  }

  async getNode(depotId: string, path: PathInput): Promise<CasNode | null> {
    const segments = normalizePath(path);
    const key = await resolvePath(
      this.cas,
      (id) => this.depotStore.getRoot(id),
      depotId,
      segments
    );
    if (key === null) return null;
    return this.cas.getNode(key);
  }

  async hasNode(depotId: string, path: PathInput): Promise<boolean> {
    const segments = normalizePath(path);
    const key = await resolvePath(
      this.cas,
      (id) => this.depotStore.getRoot(id),
      depotId,
      segments
    );
    if (key === null) return false;
    return this.cas.hasNode(key);
  }

  async putNode(nodeKey: string, data: Uint8Array): Promise<void> {
    await this.cas.putNode(nodeKey, data);
  }

  async gc(_cutOffTime: number): Promise<void> {
    throw new Error("not implemented");
  }

  async info(): Promise<unknown> {
    throw new Error("not implemented");
  }
}
