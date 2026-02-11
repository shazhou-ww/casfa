/**
 * Auth store — manages user authentication state for the Web UI.
 *
 * Wraps @casfa/client to provide reactive state for React components.
 * Handles login detection, user info fetching, and logout.
 */

import { create } from "zustand";
import { getClient, resetClient } from "../lib/client.ts";
import { resetStorage } from "../lib/storage.ts";

// ============================================================================
// Types
// ============================================================================

export type UserInfo = {
  userId: string;
  email: string;
  name?: string;
  role: string;
};

type AuthState = {
  /** Whether auth state has been checked */
  initialized: boolean;
  /** Whether the user is logged in */
  isLoggedIn: boolean;
  /** User info (null if not logged in) */
  user: UserInfo | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
};

type AuthActions = {
  /** Initialize auth state — check if user is logged in */
  initialize: () => Promise<void>;
  /** Logout and redirect to login page */
  logout: () => void;
};

export type AuthStore = AuthState & AuthActions;

// ============================================================================
// Store
// ============================================================================

export const useAuthStore = create<AuthStore>((set, get) => ({
  initialized: false,
  isLoggedIn: false,
  user: null,
  loading: true,
  error: null,

  initialize: async () => {
    if (get().initialized) return;

    set({ loading: true, error: null });

    try {
      const client = await getClient();
      const state = client.getState();

      if (!state.user) {
        set({ initialized: true, isLoggedIn: false, loading: false });
        return;
      }

      // Fetch user info
      const result = await client.oauth.getMe();
      if (result.ok) {
        set({
          initialized: true,
          isLoggedIn: true,
          user: result.data as UserInfo,
          loading: false,
        });
      } else {
        set({
          initialized: true,
          isLoggedIn: false,
          loading: false,
          error: "Failed to fetch user info",
        });
      }
    } catch {
      set({
        initialized: true,
        isLoggedIn: false,
        loading: false,
        error: "Failed to connect to server",
      });
    }
  },

  logout: () => {
    (async () => {
      try {
        const client = await getClient();
        client.logout();
      } catch {
        // ignore
      }
      resetClient();
      await resetStorage();
      set({
        initialized: false,
        isLoggedIn: false,
        user: null,
        loading: false,
        error: null,
      });
      window.location.href = "/login";
    })();
  },
}));
