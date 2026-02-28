import type { CasContext, CasInfo } from "./types.ts";

/**
 * Creates a CAS service for the given context.
 * Placeholder: methods are no-op or throw until implemented in later tasks.
 */
export function createCasService(_ctx: CasContext) {
  return {
    getNode(_key: string): Promise<Uint8Array | null> {
      throw new Error("getNode not implemented");
    },
    putNode(_nodeKey: string, _data: Uint8Array): Promise<void> {
      throw new Error("putNode not implemented");
    },
    hasNode(_key: string): Promise<boolean> {
      throw new Error("hasNode not implemented");
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
