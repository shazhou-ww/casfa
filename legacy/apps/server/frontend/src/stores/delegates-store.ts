/**
 * Delegates store — manages delegate list, detail, and creation state.
 */

import type { DelegateDetail, DelegateListItem } from "@casfa/protocol";
import { create } from "zustand";
import { getAppClient } from "../lib/client.ts";

// ============================================================================
// Types
// ============================================================================

type DelegatesState = {
  /** List of delegates (direct children of current delegate) */
  delegates: DelegateListItem[];
  /** Whether the list is loading */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Pagination cursor for next page */
  nextCursor?: string;
  /** Whether to include revoked delegates in the list */
  includeRevoked: boolean;

  /** Currently selected delegate detail */
  selectedDelegate: DelegateDetail | null;
  /** Whether the detail is loading */
  detailLoading: boolean;

  /** One-time token display after creation */
  createdTokens: {
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: number;
    delegateId: string;
  } | null;
};

type DelegatesActions = {
  /** Fetch the first page of delegates */
  fetchDelegates: () => Promise<void>;
  /** Fetch the next page of delegates */
  fetchMore: () => Promise<void>;
  /** Fetch a single delegate's detail */
  fetchDetail: (delegateId: string) => Promise<void>;
  /** Revoke a delegate; returns true on success */
  revokeDelegate: (delegateId: string) => Promise<boolean>;
  /** Toggle includeRevoked filter */
  setIncludeRevoked: (value: boolean) => void;
  /** Store one-time tokens after creation */
  setCreatedTokens: (tokens: DelegatesState["createdTokens"]) => void;
  /** Clear stored tokens */
  clearCreatedTokens: () => void;
  /** Reset store to initial state */
  reset: () => void;
};

export type DelegatesStore = DelegatesState & DelegatesActions;

// ============================================================================
// Initial state
// ============================================================================

const initialState: DelegatesState = {
  delegates: [],
  isLoading: false,
  error: null,
  nextCursor: undefined,
  includeRevoked: false,
  selectedDelegate: null,
  detailLoading: false,
  createdTokens: null,
};

// ============================================================================
// Store
// ============================================================================

export const useDelegatesStore = create<DelegatesStore>((set, get) => ({
  ...initialState,

  fetchDelegates: async () => {
    set({ isLoading: true, error: null });
    try {
      const client = await getAppClient();
      const result = await client.delegates.list({
        limit: 50,
        includeRevoked: get().includeRevoked,
      });
      if (result.ok) {
        set({
          delegates: result.data.delegates,
          nextCursor: result.data.nextCursor ?? undefined,
          isLoading: false,
        });
      } else {
        set({ error: result.error?.message ?? "Failed to fetch delegates", isLoading: false });
      }
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchMore: async () => {
    const { nextCursor, includeRevoked } = get();
    if (!nextCursor) return;
    set({ isLoading: true });
    try {
      const client = await getAppClient();
      const result = await client.delegates.list({
        limit: 50,
        cursor: nextCursor,
        includeRevoked,
      });
      if (result.ok) {
        set((state) => ({
          delegates: [...state.delegates, ...result.data.delegates],
          nextCursor: result.data.nextCursor ?? undefined,
          isLoading: false,
        }));
      } else {
        set({ error: result.error?.message ?? "Failed to fetch more", isLoading: false });
      }
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchDetail: async (_delegateId: string) => {
    set({ detailLoading: true });
    // Step 4
  },

  revokeDelegate: async (_delegateId: string) => {
    return false;
    // Step 5
  },

  setIncludeRevoked: (value: boolean) => {
    set({ includeRevoked: value });
  },

  setCreatedTokens: (tokens) => {
    set({ createdTokens: tokens });
  },

  clearCreatedTokens: () => {
    set({ createdTokens: null });
  },

  reset: () => {
    set(initialState);
  },
}));
