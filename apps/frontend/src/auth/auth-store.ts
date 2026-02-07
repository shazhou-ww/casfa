import { create } from "zustand";

type AuthTokens = {
  jwt: string | null;
  refreshToken: string | null;
  delegateToken: string | null;
  delegateTokenId: string | null;
  accessToken: string | null;
  accessTokenId: string | null;
};

type AuthState = AuthTokens & {
  setJwt: (jwt: string, refreshToken: string) => void;
  setDelegateToken: (tokenId: string, tokenBase64: string) => void;
  setAccessToken: (tokenId: string, tokenBase64: string) => void;
  clearTokens: () => void;
  /** Load tokens from localStorage on init */
  hydrate: () => void;
};

const STORAGE_KEYS = {
  jwt: "casfa_jwt",
  refreshToken: "casfa_refresh",
  delegateToken: "casfa_delegate",
  delegateTokenId: "casfa_delegate_id",
  accessToken: "casfa_access",
  accessTokenId: "casfa_access_id",
} as const;

export const useAuthStore = create<AuthState>((set) => ({
  jwt: null,
  refreshToken: null,
  delegateToken: null,
  delegateTokenId: null,
  accessToken: null,
  accessTokenId: null,

  setJwt: (jwt, refreshToken) => {
    localStorage.setItem(STORAGE_KEYS.jwt, jwt);
    localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
    set({ jwt, refreshToken });
  },

  setDelegateToken: (tokenId, tokenBase64) => {
    localStorage.setItem(STORAGE_KEYS.delegateTokenId, tokenId);
    localStorage.setItem(STORAGE_KEYS.delegateToken, tokenBase64);
    set({ delegateTokenId: tokenId, delegateToken: tokenBase64 });
  },

  setAccessToken: (tokenId, tokenBase64) => {
    localStorage.setItem(STORAGE_KEYS.accessTokenId, tokenId);
    localStorage.setItem(STORAGE_KEYS.accessToken, tokenBase64);
    set({ accessTokenId: tokenId, accessToken: tokenBase64 });
  },

  clearTokens: () => {
    for (const key of Object.values(STORAGE_KEYS)) {
      localStorage.removeItem(key);
    }
    set({
      jwt: null,
      refreshToken: null,
      delegateToken: null,
      delegateTokenId: null,
      accessToken: null,
      accessTokenId: null,
    });
  },

  hydrate: () => {
    set({
      jwt: localStorage.getItem(STORAGE_KEYS.jwt),
      refreshToken: localStorage.getItem(STORAGE_KEYS.refreshToken),
      delegateToken: localStorage.getItem(STORAGE_KEYS.delegateToken),
      delegateTokenId: localStorage.getItem(STORAGE_KEYS.delegateTokenId),
      accessToken: localStorage.getItem(STORAGE_KEYS.accessToken),
      accessTokenId: localStorage.getItem(STORAGE_KEYS.accessTokenId),
    });
  },
}));
