import { create } from "zustand";

const AUTH_KEY = "casfa-next-auth";
const MOCK_TOKEN_KEY = "casfa-next-mock-token";
const COGNITO_TOKEN_KEY = "casfa-next-cognito-token";

export type User = {
  userId: string;
  name?: string;
  email?: string;
};

export type AuthType = "mock" | "cognito" | null;

function loadStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
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
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
}

function loadStoredMockToken(): string | null {
  return localStorage.getItem(MOCK_TOKEN_KEY);
}

function saveStoredMockToken(token: string | null): void {
  if (token) {
    localStorage.setItem(MOCK_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(MOCK_TOKEN_KEY);
  }
}

function loadStoredCognitoToken(): string | null {
  return localStorage.getItem(COGNITO_TOKEN_KEY);
}

function saveStoredCognitoToken(token: string | null): void {
  if (token) {
    localStorage.setItem(COGNITO_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(COGNITO_TOKEN_KEY);
  }
}

/** Sync read from localStorage so new tab has isLoggedIn on first paint. */
function getInitialAuthFromStorage() {
  try {
    const storedUser = loadStoredUser();
    const cognitoToken = loadStoredCognitoToken();
    const mockToken = loadStoredMockToken();
    if (storedUser && cognitoToken) {
      return {
        user: storedUser,
        token: cognitoToken,
        authType: "cognito" as const,
        isLoggedIn: true,
        initialized: true,
        loading: false,
      };
    }
    if (storedUser && mockToken) {
      return {
        user: storedUser,
        token: mockToken,
        authType: "mock" as const,
        isLoggedIn: true,
        initialized: true,
        loading: false,
      };
    }
  } catch (e) {
    console.error("[auth-store] getInitialAuthFromStorage error", e);
  }
  return {
    user: null,
    token: null,
    authType: null,
    initialized: false,
    loading: true,
    isLoggedIn: false,
  };
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
  /** Set authType (e.g. "cognito" in OAuth callback so setToken persists). */
  setAuthType: (authType: AuthType) => void;
  /** Internal: set token (e.g. after refresh); for mock/cognito also persists to localStorage */
  setToken: (token: string | null) => void;
  getToken: () => string | null;
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  ...getInitialAuthFromStorage(),
  getToken: () => get().token,

  setAuthType: (authType) => set({ authType }),

  setToken: (token) => {
    const authType = get().authType;
    if (authType === "mock") saveStoredMockToken(token);
    if (authType === "cognito") saveStoredCognitoToken(token);
    set({ token });
  },

  initialize: async () => {
    if (get().initialized && get().isLoggedIn) {
      return;
    }
    if (!get().initialized) set({ loading: true });

    const storedUser = loadStoredUser();
    const cognitoToken = loadStoredCognitoToken();
    const mockToken = loadStoredMockToken();
    if (storedUser && cognitoToken) {
      set({
        user: storedUser,
        token: cognitoToken,
        authType: "cognito",
        isLoggedIn: true,
        initialized: true,
        loading: false,
      });
      return;
    }
    if (storedUser && mockToken) {
      set({
        user: storedUser,
        token: mockToken,
        authType: "mock",
        isLoggedIn: true,
        initialized: true,
        loading: false,
      });
      return;
    }

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
        const storedUser = loadStoredUser();
        const storedToken = loadStoredCognitoToken();
        if (storedUser && storedToken) {
          set({
            user: storedUser,
            token: storedToken,
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
            token: null,
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
    if (authType === "mock") saveStoredMockToken(null);
    if (authType === "cognito") saveStoredCognitoToken(null);
    set({ user: null, token: null, isLoggedIn: false });
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
