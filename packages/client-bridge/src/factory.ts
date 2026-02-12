/**
 * AppClient factory functions.
 *
 * Phase 1: createAppClient = createDirectClient (no SW).
 * Phase 2: createAppClient will auto-detect SW availability.
 */

import type { AppClient, AppClientConfig } from "./types.ts";

/**
 * Create a direct-mode AppClient (main-thread CasfaClient + SyncManager).
 */
export async function createDirectClient(
  config: AppClientConfig,
): Promise<AppClient> {
  const { createDirectClient: impl } = await import("./direct-client.ts");
  return impl(config);
}

/**
 * Create an AppClient with automatic mode selection.
 *
 * Phase 1: Always uses direct mode.
 * Phase 2: Will try SW mode first, falling back to direct.
 */
export async function createAppClient(
  config: AppClientConfig,
): Promise<AppClient> {
  // Phase 2: uncomment to enable SW mode
  // if ("serviceWorker" in navigator) {
  //   try {
  //     const { createSWClient } = await import("./sw-client.ts");
  //     return await createSWClient(config);
  //   } catch {
  //     console.warn("SW registration failed, falling back to direct mode");
  //   }
  // }
  return createDirectClient(config);
}
