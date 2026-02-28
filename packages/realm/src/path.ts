import type { PathSegment } from "@casfa/cas-uri";
import type { CasNode } from "@casfa/core";
import { hashToKey } from "@casfa/core";
import type { RealmError } from "./errors.ts";

export type GetNode = (key: string) => Promise<CasNode | null>;

/**
 * Resolve path from root; returns final node key or RealmError.
 * Supports name segments (d-node) and index segments (any node with children).
 * Returns InvalidPath if target is a successor (cannot bind to s-node).
 */
export async function resolvePath(
  rootKey: string,
  segments: PathSegment[],
  getNode: GetNode
): Promise<{ key: string } | RealmError> {
  let currentKey = rootKey;
  for (const seg of segments) {
    const node = await getNode(currentKey);
    if (!node) return { code: "NotFound", message: `Node not found: ${currentKey}` };

    if (seg.kind === "name") {
      if (node.kind !== "dict" || !node.childNames || !node.children) {
        return { code: "InvalidPath", message: "Name segment requires dict node" };
      }
      const idx = node.childNames.indexOf(seg.value);
      if (idx === -1) return { code: "NotFound", message: `Child not found: ${seg.value}` };
      const childHash = node.children[idx]!;
      currentKey = hashToKey(childHash);
    } else {
      if (!node.children || node.children.length === 0) {
        return { code: "NotFound", message: "Index segment requires node with children" };
      }
      const i = seg.value;
      if (i < 0 || i >= node.children.length) {
        return { code: "NotFound", message: `Index out of range: ${i}` };
      }
      currentKey = hashToKey(node.children[i]!);
    }
  }

  const final = await getNode(currentKey);
  if (!final) return { code: "NotFound", message: `Node not found: ${currentKey}` };
  if (final.kind === "successor") {
    return { code: "InvalidPath", message: "Cannot bind to successor node" };
  }

  return { key: currentKey };
}

/**
 * Validate that segments are name-only (no index). For binding / createChildDelegate.
 * Returns RealmError InvalidPath if any segment is index; else null.
 */
export function validateNameOnlyPath(segments: PathSegment[]): RealmError | null {
  for (const seg of segments) {
    if (seg.kind === "index") {
      return { code: "InvalidPath", message: "Index segments not allowed for binding path" };
    }
  }
  return null;
}
