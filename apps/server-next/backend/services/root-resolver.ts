/**
 * Resolve "current root" from auth and path string to node key.
 * User/Delegate: realm root (BranchStore); Worker: branch root.
 */
import type { AuthContext } from "../types.ts";
import type { CasFacade } from "@casfa/cas";
import { bytesFromStream, streamFromBytes } from "@casfa/cas";
import type { CasNode, KeyProvider } from "@casfa/core";
import { decodeNode, encodeDictNode, hashToKey } from "@casfa/core";
import type { BranchStore } from "../db/branch-store.ts";

export type RootResolverDeps = {
  branchStore: BranchStore;
  cas: CasFacade;
  key: KeyProvider;
};

/** Create empty dict root in CAS and return its key. */
export async function ensureEmptyRoot(
  cas: CasFacade,
  key: KeyProvider
): Promise<string> {
  const encoded = await encodeDictNode({ children: [], childNames: [] }, key);
  const nodeKey = hashToKey(encoded.hash);
  const exists = await cas.hasNode(nodeKey);
  if (exists) return nodeKey;
  await cas.putNode(nodeKey, streamFromBytes(encoded.bytes));
  return nodeKey;
}

/** Normalize path: trim slashes, disallow "..", return segments. */
export function normalizePath(pathStr: string): string[] {
  const trimmed = pathStr.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return [];
  const segments = trimmed.split("/").filter((s) => s.length > 0);
  if (segments.some((s) => s === ".." || s === ".")) {
    throw new Error("Path must not contain .. or .");
  }
  return segments;
}

export async function getNodeDecoded(cas: CasFacade, key: string): Promise<CasNode | null> {
  const result = await cas.getNode(key);
  if (!result) return null;
  const bytes = await bytesFromStream(result.body);
  return decodeNode(new Uint8Array(bytes));
}

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
 * Get the current root node key for the given auth.
 * User/Delegate: realm root (must already exist; not created here).
 * Worker: branch root.
 * Returns null if no root exists (realm not initialized or branch not committed).
 */
export async function getCurrentRoot(
  auth: AuthContext,
  deps: RootResolverDeps
): Promise<string | null> {
  if (auth.type === "worker") {
    return deps.branchStore.getBranchRoot(auth.branchId);
  }
  const realmId = auth.type === "user" ? auth.userId : auth.realmId;
  return deps.branchStore.getRealmRoot(realmId);
}

/** Branch id for commit (setBranchRoot). User/Delegate → root record id; Worker → branchId. */
export async function getEffectiveDelegateId(
  auth: AuthContext,
  deps: RootResolverDeps
): Promise<string> {
  if (auth.type === "worker") return auth.branchId;
  const realmId = auth.type === "user" ? auth.userId : auth.realmId;
  const record = await deps.branchStore.getRealmRootRecord(realmId);
  if (!record) throw new Error("Realm not initialized");
  return record.branchId;
}

/**
 * Resolve path from root key to final node key.
 * Path is normalized (no leading/trailing slashes, no "..").
 * Empty path returns rootKey. Returns null if any segment is missing.
 */
export async function resolvePath(
  cas: CasFacade,
  rootKey: string,
  pathStr: string
): Promise<string | null> {
  const segments = normalizePath(pathStr);
  if (segments.length === 0) return rootKey;
  let key = rootKey;
  for (const segment of segments) {
    const node = await getNodeDecoded(cas, key);
    if (!node) return null;
    const nextKey = resolveSegment(node, segment);
    if (nextKey === null) return null;
    key = nextKey;
  }
  return key;
}
