import { create } from "zustand";

const AUTH_KEY = "casfa-next-auth";
const MOCK_TOKEN_KEY = "casfa-next-mock-token";

export type User = {
  userId: string;
  name?: string;
  email?: string;
};

export type AuthType = "mock" | "cognito" | null;

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

function loadStoredMockToken(): string | null {
  return sessionStorage.getItem(MOCK_TOKEN_KEY);
}

function saveStoredMockToken(token: string | null): void {
  if (token) {
    sessionStorage.setItem(MOCK_TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(MOCK_TOKEN_KEY);
  }
}

type AuthStore = {
  user: User | null;
  token: string | null;
  authType: AuthType;
  initialized: boolean;
  loading: boolean;
  isLoggedIn: boolean;
  initialize: () => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
  /** Internal: set token (e.g. after refresh); for mock also persists to sessionStorage */
  setToken: (token: string | null) => void;
  getToken: () => string | null;
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  token: null,
  authType: null,
  initialized: false,
  loading: true,
  isLoggedIn: false,

  getToken: () => get().token,

  setToken: (token) => {
    if (get().authType === "mock") saveStoredMockToken(token);
    set({ token });
  },

  initialize: async () => {
    set({ loading: true });
    try {
      const infoRes = await fetch("/api/info");
      if (!infoRes.ok) {
        set({ initialized: true, loading: false, isLoggedIn: false, user: null, authType: null });
        return;
      }
      const info = (await infoRes.json()) as { authType?: string };
      const authType = info.authType === "cognito" ? "cognito" : info.authType === "mock" ? "mock" : null;
      set({ authType });

      if (authType === "mock") {
        let token = get().token || loadStoredMockToken();
        if (!token) {
          const tokenRes = await fetch("/api/dev/mock-token");
          if (!tokenRes.ok) {
            set({ initialized: true, loading: false, isLoggedIn: false, user: null });
            return;
          }
          const tokenData = (await tokenRes.json()) as { token?: string };
          token = tokenData.token ?? null;
          if (token) {
            saveStoredMockToken(token);
            set({ token });
          }
        } else {
          set({ token });
        }
        if (!token) {
          set({ initialized: true, loading: false, isLoggedIn: false, user: null });
          return;
        }
        const meRes = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!meRes.ok) {
          saveStoredMockToken(null);
          set({ token: null, initialized: true, loading: false, isLoggedIn: false, user: null });
          return;
        }
        const me = (await meRes.json()) as { userId?: string; name?: string; email?: string };
        const user: User = {
          userId: me.userId ?? "unknown",
          name: me.name,
          email: me.email,
        };
        saveStoredUser(user);
        set({ user, isLoggedIn: true, initialized: true, loading: false });
        return;
      }

      if (authType === "cognito") {
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
        return;
      }

      set({ initialized: true, loading: false, isLoggedIn: false, user: null });
    } catch {
      set({ initialized: true, loading: false, isLoggedIn: false, user: null, authType: null });
    }
  },

  logout: () => {
    saveStoredUser(null);
    const authType = get().authType;
    if (authType === "mock") {
      saveStoredMockToken(null);
      set({ token: null });
    }
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
