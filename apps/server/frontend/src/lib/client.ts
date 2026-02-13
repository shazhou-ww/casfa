/**
 * Lazy-initialized AppClient singleton for the frontend.
 *
 * Uses createAppClient which auto-detects SW mode (if /sw.js registered)
 * or falls back to direct mode (main-thread SyncManager).
 *
 * In direct mode, storage and queueStore are provided for the built-in
 * SyncManager. In SW mode they are ignored — the SW creates its own.
 *
 * Token persistence: Uses localStorage to persist the two-tier token
 * state (User JWT, Root Delegate metadata) across page reloads.
 */

import type { TokenState, TokenStorageProvider } from "@casfa/client";
import {
  type AppClient,
  createAppClient as createAppClientFactory,
  createDirectClient,
} from "@casfa/client-bridge";
import { flushStorage, getStorage } from "./storage.ts";
import { createSyncQueueStore } from "./sync-queue-store.ts";

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

      const create = import.meta.env.DEV ? createDirectClient : createAppClientFactory;

      return create({
        baseUrl: "",
        realm,
        tokenStorage: localStorageProvider,
        onAuthRequired: () => {
          window.location.href = "/login";
        },
        // Direct-mode sync: proxy that lazily resolves the real CachedStorageProvider
        storage: {
          flush: () => flushStorage(),
          syncTree: async (rootKey: string) => {
            const s = await getStorage();
            return s.syncTree(rootKey);
          },
        },
        queueStore: createSyncQueueStore(),
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
