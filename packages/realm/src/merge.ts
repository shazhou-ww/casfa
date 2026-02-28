import type { PathSegment } from "@casfa/cas-uri";
import { decodeNode, encodeDictNode, getWellKnownNodeData, hashToKey, keyToHash } from "@casfa/core";
import type { CasContext } from "@casfa/core";
import type { CasNode } from "@casfa/core";
import type { GetNode } from "./path.ts";

export type MergeContext = {
  getNode: GetNode;
  /** Core makeDict: (ctx, entries) => new key, puts to storage */
  makeDict: (ctx: CasContext, entries: { name: string; key: string }[]) => Promise<string>;
  /** Storage + key for makeDict */
  ctx: CasContext;
};

/**
 * Replace the subtree at the given path with newChildKey; rebuild dicts up to root.
 * pathSegments must be name-only (binding path). Returns the new root key.
 */
export async function replaceSubtreeAtPath(
  rootKey: string,
  pathSegments: PathSegment[],
  newChildKey: string,
  mergeCtx: MergeContext
): Promise<string> {
  const { getNode, makeDict, ctx } = mergeCtx;
  if (pathSegments.length === 0) {
    return newChildKey;
  }

  const parentKeys: string[] = [rootKey];
  for (let i = 0; i < pathSegments.length; i++) {
    const seg = pathSegments[i]!;
    if (seg.kind !== "name") throw new Error("replaceSubtreeAtPath requires name-only path");
    const parentKey = parentKeys[i]!;
    const node = await getNode(parentKey);
    if (!node) throw new Error(`Node not found: ${parentKey}`);
    if (node.kind !== "dict" || !node.childNames || !node.children) {
      throw new Error("Path segment must be dict node");
    }
    const idx = node.childNames.indexOf(seg.value);
    if (idx === -1) throw new Error(`Child not found: ${seg.value}`);
    const childKey = hashToKey(node.children[idx]!);
    parentKeys.push(childKey);
  }

  let replacedKey = newChildKey;
  for (let i = pathSegments.length - 1; i >= 0; i--) {
    const parentKey = parentKeys[i]!;
    const segmentName = pathSegments[i]!.value;
    const node = await getNode(parentKey);
    if (!node || node.kind !== "dict" || !node.childNames || !node.children) {
      throw new Error("Invalid parent dict");
    }
    const entries = node.childNames.map((name, j) => ({
      name,
      key: name === segmentName ? replacedKey : hashToKey(node.children![j]!),
    }));
    replacedKey = await makeDict(ctx, entries);
  }
  return replacedKey;
}
