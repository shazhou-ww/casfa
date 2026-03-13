import { create } from "zustand";

type ExplorerStore = {
  currentPath: string;
  setCurrentPath: (path: string) => void;
};

export const useExplorerStore = create<ExplorerStore>((set) => ({
  currentPath: "/",
  setCurrentPath: (path) => set({ currentPath: path || "/" }),
}));
