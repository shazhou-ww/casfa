import { create } from "zustand";

export type User = {
  userId: string;
  name?: string;
  email?: string;
};

type AuthStore = {
  user: User | null;
  initialized: boolean;
  loading: boolean;
  isLoggedIn: boolean;
  initialize: () => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  initialized: false,
  loading: true,
  isLoggedIn: false,

  initialize: async () => {
    set({ loading: true });
    // Phase A: mock — no backend yet; treat as logged out until Login sets user
    set({ initialized: true, loading: false, isLoggedIn: false, user: null });
  },

  logout: () => {
    set({ user: null, isLoggedIn: false });
  },

  setUser: (user) => {
    set({
      user,
      isLoggedIn: !!user,
      initialized: true,
      loading: false,
    });
  },
}));
