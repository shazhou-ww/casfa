/**
 * Lazy-initialized @casfa/client singleton for the frontend.
 *
 * Because createClient is async (fetches /api/info), we expose a
 * getClient() that returns a Promise and caches the result.
 *
 * Token persistence: Uses localStorage to persist the two-tier token
 * state (User JWT, Root Delegate with RT/AT) across page reloads.
 */

import {
  type CasfaClient,
  createClient,
  type TokenState,
  type TokenStorageProvider,
} from "@casfa/client";

const TOKEN_STORAGE_KEY = "casfa_tokens";

/**
 * localStorage-based token persistence provider.
 */
const localStorageProvider: TokenStorageProvider = {
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

let clientPromise: Promise<CasfaClient> | null = null;

/**
 * Get or initialize the CASFA client singleton.
 * The baseUrl is "" (same origin) so Vite proxy (dev) or
 * static serving (prod) routes /api to the backend.
 *
 * The realm is resolved lazily from the user's ID (usr_xxx).
 * Token auto-issuance: The client's TokenSelector will automatically
 * create a Root Delegate (RT + AT) when needed using the User JWT,
 * and refresh the Access Token via RT rotation when it expires.
 */
export function getClient(): Promise<CasfaClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
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

      const client = await createClient({
        baseUrl: "",
        realm,
        tokenStorage: localStorageProvider,
        onAuthRequired: () => {
          // Token refresh failed — redirect to login
          window.location.href = "/login";
        },
      });

      // If realm was empty but we have a user now, re-create with correct realm
      const state = client.getState();
      if (!realm && state.user?.userId) {
        // Need to recreate client with the correct realm
        const newClient = await createClient({
          baseUrl: "",
          realm: state.user.userId,
          tokenStorage: localStorageProvider,
          onAuthRequired: () => {
            window.location.href = "/login";
          },
        });
        return newClient;
      }

      return client;
    })();
  }
  return clientPromise;
}

/**
 * Reset the client singleton (e.g. after logout).
 * Clears persisted tokens and the cached client promise.
 */
export function resetClient(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  clientPromise = null;
}

/**
 * Re-initialize the client singleton without clearing tokens.
 * Used after login to re-create the client with the correct realm.
 */
export function reinitClient(): void {
  clientPromise = null;
}
