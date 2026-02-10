/**
 * Token store - manages the two-tier token state.
 *
 * Provides a closure-based store for token state management with
 * automatic persistence and change notifications.
 */

import type {
  OnAuthRequiredCallback,
  OnTokenChangeCallback,
  TokenStorageProvider,
} from "../types/client.ts";
import type { StoredRootDelegate, StoredUserToken, TokenState } from "../types/tokens.ts";
import { emptyTokenState } from "../types/tokens.ts";

// ============================================================================
// Store Types
// ============================================================================

export type TokenStore = {
  /** Get current token state (immutable snapshot) */
  getState: () => TokenState;

  /** Set user JWT token */
  setUser: (token: StoredUserToken | null) => void;

  /** Set root delegate (RT + AT pair) */
  setRootDelegate: (delegate: StoredRootDelegate | null) => void;

  /** Clear all tokens */
  clear: () => void;

  /** Initialize from storage provider */
  initialize: () => Promise<void>;
};

export type TokenStoreConfig = {
  storage?: TokenStorageProvider;
  onTokenChange?: OnTokenChangeCallback;
  onAuthRequired?: OnAuthRequiredCallback;
};

// ============================================================================
// Store Factory
// ============================================================================

/**
 * Create a token store instance.
 */
export const createTokenStore = (config: TokenStoreConfig = {}): TokenStore => {
  const { storage, onTokenChange } = config;

  // Internal mutable state
  let state: TokenState = emptyTokenState();

  // Notify change and persist
  const notifyAndPersist = () => {
    onTokenChange?.(state);
    storage?.save(state).catch((err) => {
      console.error("[TokenStore] Failed to persist state:", err);
    });
  };

  return {
    getState: () => ({ ...state }),

    setUser: (token) => {
      state = { ...state, user: token };
      notifyAndPersist();
    },

    setRootDelegate: (delegate) => {
      state = { ...state, rootDelegate: delegate };
      notifyAndPersist();
    },

    clear: () => {
      state = emptyTokenState();
      notifyAndPersist();
      storage?.clear().catch((err) => {
        console.error("[TokenStore] Failed to clear storage:", err);
      });
    },

    initialize: async () => {
      if (!storage) return;

      try {
        const loaded = await storage.load();
        if (loaded) {
          state = loaded;
          // Don't notify on initial load to avoid side effects
        }
      } catch (err) {
        console.error("[TokenStore] Failed to load from storage:", err);
      }
    },
  };
};
