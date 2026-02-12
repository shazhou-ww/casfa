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
  // Try SW mode if service workers are available
  if ("serviceWorker" in navigator) {
    try {
      const { createSWClient } = await import("./sw-client.ts");
      return await createSWClient(config);
    } catch (e) {
      console.warn("[casfa] SW mode unavailable, using direct mode:", e);
    }
  }
  return createDirectClient(config);
}
