import type { CasNode } from "@casfa/core";
import { decodeNode, hashToKey } from "@casfa/core";
import {
  appendNewKey,
  clearNewKeys,
  readKeysToRetain,
  readLastGcTime,
  readNewKeys,
  readTimes,
  setTime,
  writeKeysToRetain,
  writeLastGcTime,
  writeTimes,
} from "./cas-meta.ts";
import type { CasContext, CasInfo } from "./types.ts";

export type CasErrorCode = "ChildMissing" | "KeyMismatch";

export class CasError extends Error {
  readonly code: CasErrorCode;
  constructor(code: CasErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CasError";
    this.code = code;
    Object.setPrototypeOf(this, CasError.prototype);
  }
}

/** Traverse from root keys via getNode to collect all reachable keys. */
async function reachableKeys(
  getNode: (key: string) => Promise<CasNode | null>,
  rootKeys: string[]
): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [...rootKeys];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = await getNode(key);
    if (!node) continue;
    const childHashes = node.children ?? [];
    for (const h of childHashes) {
      queue.push(hashToKey(h));
    }
  }
  return seen;
}

/**
 * Creates a CAS service for the given context.
 */
export function createCasService(ctx: CasContext) {
  return {
    async getNode(key: string): Promise<CasNode | null> {
      const data = await ctx.storage.get(key);
      if (data === null) return null;
      return decodeNode(data);
    },

    async hasNode(key: string): Promise<boolean> {
      const data = await ctx.storage.get(key);
      return data !== null;
    },

    async putNode(nodeKey: string, data: Uint8Array): Promise<void> {
      const node = decodeNode(data);
      const childHashes = node.children ?? [];

      for (const childHash of childHashes) {
        const childKey = hashToKey(childHash);
        const exists = await this.hasNode(childKey);
        if (!exists) {
          throw new CasError("ChildMissing", `Child key ${childKey} does not exist`);
        }
      }

      const computedHash = await ctx.key.computeKey(data);
      const computedKey = hashToKey(computedHash);
      if (computedKey !== nodeKey) {
        throw new CasError(
          "KeyMismatch",
          `Node key ${nodeKey} does not match content hash ${computedKey}`
        );
      }

      await ctx.storage.put(nodeKey, data);

      const now = Date.now();
      await appendNewKey(ctx.storage, nodeKey);
      await setTime(ctx.storage, nodeKey, now);
    },

    async gc(nodeKeys: string[], cutOffTime: number): Promise<void> {
      const R = await reachableKeys((key) => this.getNode(key), nodeKeys);
      const retained = await readKeysToRetain(ctx.storage);
      const newKeys = await readNewKeys(ctx.storage);
      const allKeys = new Set<string>([...retained, ...newKeys]);
      const times = await readTimes(ctx.storage);

      const toDelete: string[] = [];
      for (const k of allKeys) {
        if (R.has(k)) continue;
        const t = times[k];
        if (t !== undefined && t < cutOffTime) toDelete.push(k);
      }
      for (const k of toDelete) {
        await ctx.storage.del(k);
      }

      await writeKeysToRetain(ctx.storage, [...R]);
      await clearNewKeys(ctx.storage);
      const timesRetained: Record<string, number> = {};
      for (const k of R) {
        if (times[k] !== undefined) timesRetained[k] = times[k];
      }
      await writeTimes(ctx.storage, timesRetained);
      await writeLastGcTime(ctx.storage, Date.now());
    },

    async info(): Promise<CasInfo> {
      const lastGcTime = await readLastGcTime(ctx.storage);
      const retained = await readKeysToRetain(ctx.storage);
      const newKeys = await readNewKeys(ctx.storage);
      const allKeys = new Set<string>([...retained, ...newKeys]);
      let totalBytes = 0;
      for (const k of allKeys) {
        const data = await ctx.storage.get(k);
        if (data) totalBytes += data.length;
      }
      return {
        lastGcTime,
        nodeCount: allKeys.size,
        totalBytes,
      };
    },
  };
}

export type CasService = ReturnType<typeof createCasService>;
