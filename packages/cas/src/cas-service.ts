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
import { bytesFromStream, streamFromBytes } from "./stream-util.ts";
import type { CasContext, CasInfo, CasNodeResult } from "./types.ts";

export type CasErrorCode = "ChildMissing" | "KeyMismatch";

export type CasError = {
  readonly name: "CasError";
  readonly code: CasErrorCode;
  message: string;
};

export function createCasError(code: CasErrorCode, message?: string): CasError {
  return { name: "CasError", code, message: message ?? code };
}

export function isCasError(x: unknown): x is CasError {
  return (
    typeof x === "object" &&
    x !== null &&
    "name" in x &&
    (x as CasError).name === "CasError" &&
    "code" in x
  );
}

/** Traverse from root keys via getNode (decoded) to collect all reachable keys. */
async function reachableKeys(
  getNodeDecoded: (key: string) => Promise<CasNode | null>,
  rootKeys: string[]
): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [...rootKeys];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = await getNodeDecoded(key);
    if (!node) continue;
    const childHashes = node.children ?? [];
    for (const h of childHashes) {
      queue.push(hashToKey(h));
    }
  }
  return seen;
}

/**
 * Creates a CAS facade for the given context.
 */
export function createCasFacade(ctx: CasContext) {
  return {
    async getNode(key: string): Promise<CasNodeResult | null> {
      const stream = await ctx.storage.get(key);
      if (stream === null) return null;
      return { key, body: stream };
    },

    async hasNode(key: string): Promise<boolean> {
      const stream = await ctx.storage.get(key);
      if (stream === null) return false;
      await stream.cancel();
      return true;
    },

    async putNode(nodeKey: string, body: ReadableStream<Uint8Array>): Promise<void> {
      const data = await bytesFromStream(body);
      const node = decodeNode(data);
      const childHashes = node.children ?? [];

      for (const childHash of childHashes) {
        const childKey = hashToKey(childHash);
        const exists = await this.hasNode(childKey);
        if (!exists) {
          throw createCasError("ChildMissing", `Child key ${childKey} does not exist`);
        }
      }

      const computedHash = await ctx.key.computeKey(data);
      const computedKey = hashToKey(computedHash);
      if (computedKey !== nodeKey) {
        throw createCasError(
          "KeyMismatch",
          `Node key ${nodeKey} does not match content hash ${computedKey}`
        );
      }

      await ctx.storage.put(nodeKey, streamFromBytes(data));

      const now = Date.now();
      await appendNewKey(ctx.storage, nodeKey);
      await setTime(ctx.storage, nodeKey, now);
    },

    async gc(nodeKeys: string[], cutOffTime: number): Promise<void> {
      const getNodeDecoded = async (key: string): Promise<CasNode | null> => {
        const result = await this.getNode(key);
        if (!result) return null;
        const bytes = await bytesFromStream(result.body);
        return decodeNode(bytes);
      };
      const R = await reachableKeys(getNodeDecoded, nodeKeys);
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
        const stream = await ctx.storage.get(k);
        if (stream !== null) {
          const bytes = await bytesFromStream(stream);
          totalBytes += bytes.length;
        }
      }
      return {
        lastGcTime: lastGcTime ?? null,
        nodeCount: allKeys.size,
        totalBytes,
      };
    },
  };
}

export type CasFacade = ReturnType<typeof createCasFacade>;
