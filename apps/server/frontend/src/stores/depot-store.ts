/**
 * Depot store — manages depot listing and selection for the Web UI.
 *
 * Uses @casfa/client to interact with the depot API.
 * The client's TokenSelector auto-issues Access Tokens when needed.
 */

import type { DepotListItem } from "@casfa/protocol";
import { create } from "zustand";
import { getClient } from "../lib/client.ts";

// ============================================================================
// Types
// ============================================================================

type DepotState = {
  /** All depots for the current user */
  depots: DepotListItem[];
  /** Currently selected depot */
  currentDepot: DepotListItem | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Whether a create/delete operation is in progress */
  operating: boolean;
};

type DepotActions = {
  /** Fetch depot list from server */
  fetchDepots: () => Promise<void>;
  /** Select a depot */
  selectDepot: (depot: DepotListItem) => void;
  /** Create a new depot */
  createDepot: (title: string) => Promise<DepotListItem | null>;
  /** Delete a depot */
  deleteDepot: (depotId: string) => Promise<boolean>;
  /** Clear state */
  reset: () => void;
};

export type DepotStore = DepotState & DepotActions;

// ============================================================================
// Store
// ============================================================================

export const useDepotStore = create<DepotStore>((set, get) => ({
  depots: [],
  currentDepot: null,
  loading: false,
  error: null,
  operating: false,

  fetchDepots: async () => {
    set({ loading: true, error: null });

    try {
      const client = await getClient();
      const result = await client.depots.list({ limit: 100 });

      if (result.ok) {
        const depots = result.data.depots;
        set({ depots, loading: false });

        // Auto-select first depot if none selected
        if (!get().currentDepot && depots.length > 0) {
          set({ currentDepot: depots[0] });
        }
      } else {
        set({
          loading: false,
          error: result.error.message || "Failed to fetch depots",
        });
      }
    } catch {
      set({ loading: false, error: "Failed to connect to server" });
    }
  },

  selectDepot: (depot) => {
    set({ currentDepot: depot });
  },

  createDepot: async (title: string) => {
    set({ operating: true, error: null });

    try {
      const client = await getClient();
      const result = await client.depots.create({ title, maxHistory: 20 });

      if (result.ok) {
        // Refresh the depot list
        await get().fetchDepots();
        set({ operating: false });

        // Find the newly created depot in the refreshed list
        const newDepot = get().depots.find((d) => d.depotId === result.data.depotId);
        return newDepot ?? null;
      }

      set({
        operating: false,
        error: result.error.message || "Failed to create depot",
      });
      return null;
    } catch {
      set({ operating: false, error: "Failed to create depot" });
      return null;
    }
  },

  deleteDepot: async (depotId: string) => {
    set({ operating: true, error: null });

    try {
      const client = await getClient();
      const result = await client.depots.delete(depotId);

      if (result.ok) {
        // If we deleted the current depot, deselect it
        if (get().currentDepot?.depotId === depotId) {
          set({ currentDepot: null });
        }
        // Refresh depot list
        await get().fetchDepots();
        set({ operating: false });
        return true;
      }

      set({
        operating: false,
        error: result.error.message || "Failed to delete depot",
      });
      return false;
    } catch {
      set({ operating: false, error: "Failed to delete depot" });
      return false;
    }
  },

  reset: () => {
    set({
      depots: [],
      currentDepot: null,
      loading: false,
      error: null,
      operating: false,
    });
  },
}));
