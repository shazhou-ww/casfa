/**
 * Extensions controller
 *
 * HTTP handlers for node extension derived data.
 * Provides batch queries for extension-generated metadata.
 */

import { nodeKeyToStorageKey, storageKeyToNodeKey } from "@casfa/protocol";
import type { Context } from "hono";
import type { ExtensionService } from "../services/extensions/index.ts";
import type { Env } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type ExtensionsController = {
  /** POST /:realmId/nodes/ext/:name/batch — batch-get derived data */
  batchGet: (c: Context<Env>) => Promise<Response>;
};

export type ExtensionsControllerDeps = {
  extensionService: ExtensionService;
};

// ============================================================================
// Factory
// ============================================================================

export const createExtensionsController = (
  deps: ExtensionsControllerDeps
): ExtensionsController => {
  const { extensionService } = deps;

  return {
    batchGet: async (c) => {
      const extensionName = c.req.param("name");
      if (!extensionName) {
        return c.json({ error: "Missing extension name" }, 400);
      }

      const body = (await c.req.json()) as { keys?: string[] };
      const nodeKeys = body.keys;
      if (!Array.isArray(nodeKeys) || nodeKeys.length === 0) {
        return c.json({ error: "Missing or empty keys array" }, 400);
      }

      // Limit batch size to prevent abuse
      const MAX_BATCH = 500;
      if (nodeKeys.length > MAX_BATCH) {
        return c.json({ error: `Batch size exceeds limit (max ${MAX_BATCH})` }, 400);
      }

      // Deduplicate & convert node keys to storage keys
      const storageKeys = [...new Set(nodeKeys)].map(nodeKeyToStorageKey);

      // Batch query
      const result = await extensionService.batchGetDerived(storageKeys, extensionName);

      // Convert back to node key format
      const data: Record<string, unknown> = {};
      for (const [storageKey, value] of result) {
        data[storageKeyToNodeKey(storageKey)] = value;
      }

      return c.json({ data });
    },
  };
};
