import type { CasService } from "@casfa/cas";
import type { CasNode } from "@casfa/core";
import { hashToKey } from "@casfa/core";
import type { DepotStore } from "./types.ts";

export type RealmServiceContext = {
  cas: CasService;
  depotStore: DepotStore;
};

export type PathInput = string | string[];

function normalizePath(path: PathInput): string[] {
  if (Array.isArray(path)) {
    return path.filter((s) => s.length > 0);
  }
  return path.split("/").filter((s) => s.length > 0);
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

export class RealmService {
  readonly cas: CasService;
  readonly depotStore: DepotStore;

  constructor(ctx: RealmServiceContext) {
    this.cas = ctx.cas;
    this.depotStore = ctx.depotStore;
  }

  async createDepot(_parentDepotId: string, _path: string): Promise<unknown> {
    throw new Error("not implemented");
  }

  async commitDepot(_depotId: string, _newRoot: string, _oldRoot: string): Promise<void> {
    throw new Error("not implemented");
  }

  async closeDepot(_depotId: string): Promise<void> {
    throw new Error("not implemented");
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
