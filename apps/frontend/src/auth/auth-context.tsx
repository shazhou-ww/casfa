import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { authApi } from "../api/auth";
import { http } from "../api/http";
import type { CreateTokenResponse, UserInfo } from "../api/types";
import { useAuthStore } from "./auth-store";

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: UserInfo | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Setup the full token chain: JWT -> delegate token -> access token */
async function setupTokenChain(
  jwt: string,
  realm: string,
  store: ReturnType<typeof useAuthStore.getState>
) {
  // 1. Create delegate token
  const delegateRes = await http.post<CreateTokenResponse>(
    "/api/tokens",
    {
      realm,
      name: "frontend-delegate",
      type: "delegate",
      expiresIn: 86400 * 7, // 7 days
      canUpload: true,
      canManageDepot: true,
      scope: ["cas://depot:*"],
    },
    { token: jwt }
  );

  store.setDelegateToken(delegateRes.tokenId, delegateRes.tokenBase64);

  // 2. Create access token from delegate
  const accessRes = await http.post<CreateTokenResponse>(
    "/api/tokens/delegate",
    {
      name: "frontend-access",
      type: "access",
      expiresIn: 86400, // 1 day
      canUpload: true,
      canManageDepot: true,
      scope: ["."],
    },
    {
      token: delegateRes.tokenBase64,
    }
  );

  store.setAccessToken(accessRes.tokenId, accessRes.tokenBase64);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const jwt = useAuthStore((s) => s.jwt);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate tokens from localStorage on mount (run once)
  useEffect(() => {
    useAuthStore.getState().hydrate();
    const storedJwt = useAuthStore.getState().jwt;
    if (storedJwt) {
      authApi
        .me(storedJwt)
        .then((u) => setUser(u))
        .catch(() => {
          useAuthStore.getState().clearTokens();
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    useAuthStore.getState().setJwt(res.accessToken, res.refreshToken);
    const me = await authApi.me(res.accessToken);
    setUser(me);
    await setupTokenChain(res.accessToken, me.realm, useAuthStore.getState());
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const res = await authApi.register(email, password, name);
    useAuthStore.getState().setJwt(res.accessToken, res.refreshToken);
    const me = await authApi.me(res.accessToken);
    setUser(me);
    await setupTokenChain(res.accessToken, me.realm, useAuthStore.getState());
  }, []);

  const logout = useCallback(() => {
    useAuthStore.getState().clearTokens();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: !!jwt && !!user,
      isLoading,
      user,
      login,
      register,
      logout,
    }),
    [jwt, user, isLoading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
