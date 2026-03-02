/**
 * Tree mutations: replace subtree at path, add or replace dict entry.
 * Used by upload and fs operations.
 */
import type { CasFacade } from "@casfa/cas";
import { streamFromBytes } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import { encodeDictNode, hashToKey, keyToHash } from "@casfa/core";
import { getNodeDecoded } from "./root-resolver.ts";
import { normalizePath, resolvePath } from "./root-resolver.ts";

function resolveSegment(
  node: { kind: string; children?: Uint8Array[]; childNames?: string[] },
  segment: string
): string | null {
  const children = node.children;
  if (!children || children.length === 0) return null;
  if (node.kind === "dict" && node.childNames) {
    const nameIdx = node.childNames.indexOf(segment);
    if (nameIdx >= 0) return hashToKey(children[nameIdx]!);
    const num = parseInt(segment, 10);
    if (String(num) === segment && num >= 0 && num < children.length)
      return hashToKey(children[num]!);
    return null;
  }
  return null;
}

/** Replace existing entry at path; path must exist. Returns new root key. */
export async function replaceSubtreeAtPath(
  cas: CasFacade,
  keyProvider: KeyProvider,
  rootKey: string,
  segments: string[],
  newChildKey: string
): Promise<string> {
  if (segments.length === 0) throw new Error("Path must not be empty");
  const node = await getNodeDecoded(cas, rootKey);
  if (!node || node.kind !== "dict") throw new Error("Not a dict");
  const names = node.childNames ?? [];
  const children = node.children ?? [];
  const nameIdx = names.indexOf(segments[0]!);
  if (nameIdx < 0) throw new Error(`Entry ${segments[0]} not found`);
  if (segments.length === 1) {
    const newChildren = children.slice();
    const newNames = names.slice();
    newChildren[nameIdx] = keyToHash(newChildKey);
    const encoded = await encodeDictNode(
      { children: newChildren, childNames: newNames },
      keyProvider
    );
    await cas.putNode(hashToKey(encoded.hash), streamFromBytes(encoded.bytes));
    return hashToKey(encoded.hash);
  }
  const firstKey = resolveSegment(node, segments[0]!);
  if (firstKey === null) throw new Error(`Segment ${segments[0]} not found`);
  const newFirstKey = await replaceSubtreeAtPath(
    cas,
    keyProvider,
    firstKey,
    segments.slice(1),
    newChildKey
  );
  const newChildren = children.slice();
  const newNames = names.slice();
  newChildren[nameIdx] = keyToHash(newFirstKey);
  const encoded = await encodeDictNode(
    { children: newChildren, childNames: newNames },
    keyProvider
  );
  await cas.putNode(hashToKey(encoded.hash), streamFromBytes(encoded.bytes));
  return hashToKey(encoded.hash);
}

/** Add or replace a single entry in a dict. Returns new dict key. */
export async function addOrReplaceInDict(
  cas: CasFacade,
  keyProvider: KeyProvider,
  dictKey: string,
  name: string,
  childKey: string
): Promise<string> {
  const node = await getNodeDecoded(cas, dictKey);
  if (!node || node.kind !== "dict") throw new Error("Not a dict");
  const names = node.childNames ?? [];
  const children = node.children ?? [];
  const nameIdx = names.indexOf(name);
  const newNames =
    nameIdx >= 0 ? names.slice() : [...names, name].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  let newChildren: Uint8Array[];
  if (nameIdx >= 0) {
    newChildren = children.slice();
    newChildren[nameIdx] = keyToHash(childKey);
  } else {
    const hash = keyToHash(childKey);
    const insertIdx = newNames.indexOf(name);
    newChildren = children.slice();
    newChildren.splice(insertIdx, 0, hash);
  }
  const encoded = await encodeDictNode(
    { children: newChildren, childNames: newNames },
    keyProvider
  );
  await cas.putNode(hashToKey(encoded.hash), streamFromBytes(encoded.bytes));
  return hashToKey(encoded.hash);
}

/** Add or replace entry at path (path = parentPath/fileName). Parent must exist. Returns new root key. */
export async function addOrReplaceAtPath(
  cas: CasFacade,
  keyProvider: KeyProvider,
  rootKey: string,
  pathStr: string,
  newChildKey: string
): Promise<string> {
  const segments = normalizePath(pathStr);
  if (segments.length === 0) throw new Error("Path must not be empty");
  const parentPath = segments.slice(0, -1).join("/");
  const fileName = segments[segments.length - 1]!;
  const parentKey =
    parentPath === "" ? rootKey : await resolvePath(cas, rootKey, parentPath);
  if (parentKey === null) throw new Error("Parent path not found");
  const newParentKey = await addOrReplaceInDict(
    cas,
    keyProvider,
    parentKey,
    fileName,
    newChildKey
  );
  if (segments.length === 1) return newParentKey;
  return replaceSubtreeAtPath(
    cas,
    keyProvider,
    rootKey,
    segments.slice(0, -1),
    newParentKey
  );
}

/** Remove entry at path. Path must exist. Returns new root key. */
export async function removeEntryAtPath(
  cas: CasFacade,
  keyProvider: KeyProvider,
  rootKey: string,
  pathStr: string
): Promise<string> {
  const segments = normalizePath(pathStr);
  if (segments.length === 0) throw new Error("Path must not be empty");
  const parentPath = segments.slice(0, -1).join("/");
  const fileName = segments[segments.length - 1]!;
  const parentKey =
    parentPath === "" ? rootKey : await resolvePath(cas, rootKey, parentPath);
  if (parentKey === null) throw new Error("Parent path not found");
  const node = await getNodeDecoded(cas, parentKey);
  if (!node || node.kind !== "dict") throw new Error("Parent is not a dict");
  const names = node.childNames ?? [];
  const children = node.children ?? [];
  const nameIdx = names.indexOf(fileName);
  if (nameIdx < 0) throw new Error(`Entry ${fileName} not found`);
  const newNames = names.filter((_, i) => i !== nameIdx);
  const newChildren = children.filter((_, i) => i !== nameIdx);
  const encoded = await encodeDictNode(
    { children: newChildren, childNames: newNames },
    keyProvider
  );
  const newParentKey = hashToKey(encoded.hash);
  await cas.putNode(newParentKey, streamFromBytes(encoded.bytes));
  if (segments.length === 1) return newParentKey;
  return replaceSubtreeAtPath(
    cas,
    keyProvider,
    rootKey,
    segments.slice(0, -1),
    newParentKey
  );
}
