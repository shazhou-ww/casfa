/**
 * Lazy-initialized AppClient singleton for the frontend.
 *
 * Phase 1: Uses createAppClient (direct mode) as a drop-in replacement
 * for the old getClient(). AppClient ⊇ CasfaClient, so all existing
 * call sites work unchanged. SyncManager is still wired externally
 * in ExplorerPage — it moves into AppClient in Phase 2.
 *
 * Token persistence: Uses localStorage to persist the two-tier token
 * state (User JWT, Root Delegate metadata) across page reloads.
 */

import type { TokenState, TokenStorageProvider } from "@casfa/client";
import {
  type AppClient,
  createAppClient as createAppClientFactory,
} from "@casfa/client-bridge";

const TOKEN_STORAGE_KEY = "casfa_tokens";

/**
 * localStorage-based token persistence provider.
 */
export const localStorageProvider: TokenStorageProvider = {
  load: async () => {
    try {
      const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as TokenState;
    } catch {
      return null;
    }
  },
  save: async (state: TokenState) => {
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage might be full or disabled
    }
  },
  clear: async () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  },
};

// ============================================================================
// AppClient singleton
// ============================================================================

let appClientPromise: Promise<AppClient> | null = null;

/**
 * Get or initialize the AppClient singleton.
 *
 * The baseUrl is "" (same origin) so Vite proxy (dev) or
 * static serving (prod) routes /api to the backend.
 *
 * The realm is resolved lazily from the user's ID.
 */
export function getAppClient(): Promise<AppClient> {
  if (!appClientPromise) {
    appClientPromise = (async () => {
      // Try to recover realm from persisted tokens
      const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
      let realm = "";
      if (raw) {
        try {
          const state = JSON.parse(raw) as TokenState;
          if (state.user?.userId) {
            realm = state.user.userId;
          }
        } catch {
          // ignore
        }
      }

      return createAppClientFactory({
        baseUrl: "",
        realm,
        tokenStorage: localStorageProvider,
        onAuthRequired: () => {
          window.location.href = "/login";
        },
      });
    })();
  }
  return appClientPromise;
}

/**
 * Reset the AppClient singleton (e.g. after logout).
 * Clears persisted tokens and the cached client promise.
 */
export function resetAppClient(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  if (appClientPromise) {
    appClientPromise.then((c) => c.dispose()).catch(() => {});
  }
  appClientPromise = null;
}

/**
 * Re-initialize the AppClient singleton without clearing tokens.
 * Used after login to re-create the client with the correct realm.
 */
export function reinitAppClient(): void {
  if (appClientPromise) {
    appClientPromise.then((c) => c.dispose()).catch(() => {});
  }
  appClientPromise = null;
}

// ============================================================================
// Backward compatibility — remove after full migration
// ============================================================================

/** @deprecated Use `getAppClient()` instead. */
export const getClient = getAppClient;

/** @deprecated Use `resetAppClient()` instead. */
export const resetClient = resetAppClient;

/** @deprecated Use `reinitAppClient()` instead. */
export const reinitClient = reinitAppClient;
