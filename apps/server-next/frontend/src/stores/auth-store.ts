import { create } from "zustand";

const AUTH_KEY = "casfa-next-auth";

export type User = {
  userId: string;
  name?: string;
  email?: string;
};

function loadStoredUser(): User | null {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as User;
    if (!data?.userId) return null;
    return data;
  } catch {
    return null;
  }
}

function saveStoredUser(user: User | null): void {
  if (user) {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(user));
  } else {
    sessionStorage.removeItem(AUTH_KEY);
  }
}

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
    const stored = loadStoredUser();
    if (stored) {
      set({
        user: stored,
        isLoggedIn: true,
        initialized: true,
        loading: false,
      });
    } else {
      set({
        initialized: true,
        loading: false,
        isLoggedIn: false,
        user: null,
      });
    }
  },

  logout: () => {
    saveStoredUser(null);
    set({ user: null, isLoggedIn: false });
  },

  setUser: (user) => {
    saveStoredUser(user);
    set({
      user,
      isLoggedIn: !!user,
      initialized: true,
      loading: false,
    });
  },
}));
