import { create } from "zustand";

type ViewMode = "list" | "grid";
type SortField = "name" | "size" | "type";
type SortOrder = "asc" | "desc";

type FileBrowserState = {
  currentDepotId: string | null;
  currentRoot: string | null;
  currentPath: string;
  viewMode: ViewMode;
  sortField: SortField;
  sortOrder: SortOrder;
  selection: Set<string>;

  setDepot: (depotId: string, root: string) => void;
  setRoot: (root: string) => void;
  setPath: (path: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setSort: (field: SortField, order: SortOrder) => void;
  toggleSelect: (name: string) => void;
  selectAll: (names: string[]) => void;
  clearSelection: () => void;
};

export const useFileBrowserStore = create<FileBrowserState>((set) => ({
  currentDepotId: null,
  currentRoot: null,
  currentPath: "/",
  viewMode: "list",
  sortField: "name",
  sortOrder: "asc",
  selection: new Set<string>(),

  setDepot: (depotId, root) =>
    set({ currentDepotId: depotId, currentRoot: root, currentPath: "/" }),
  setRoot: (root) => set({ currentRoot: root }),
  setPath: (path) => set({ currentPath: path, selection: new Set() }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSort: (field, order) => set({ sortField: field, sortOrder: order }),
  toggleSelect: (name) =>
    set((state) => {
      const next = new Set(state.selection);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { selection: next };
    }),
  selectAll: (names) => set({ selection: new Set(names) }),
  clearSelection: () => set({ selection: new Set() }),
}));
