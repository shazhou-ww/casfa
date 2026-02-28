import { decodeNode, hashToKey } from "@casfa/core";
import type { CasNode } from "@casfa/core";
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

/**
 * Creates a CAS service for the given context.
 */
export function createCasService(ctx: CasContext) {
  const keyToTime = new Map<string, number>();
  const newKeysSinceGc = new Set<string>();

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
        throw new CasError("KeyMismatch", `Node key ${nodeKey} does not match content hash ${computedKey}`);
      }

      await ctx.storage.put(nodeKey, data);

      const now = Date.now();
      keyToTime.set(nodeKey, now);
      newKeysSinceGc.add(nodeKey);
    },

    gc(): Promise<void> {
      throw new Error("gc not implemented");
    },

    info(): Promise<CasInfo> {
      throw new Error("info not implemented");
    },
  };
}

export type CasService = ReturnType<typeof createCasService>;
