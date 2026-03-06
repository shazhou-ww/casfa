/**
 * Cookie-only mode: getAuth() always null (token is HttpOnly).
 * User info from /api/me. subscribe() fires on logout().
 */
export type AuthClient = {
  getAuth(): null;
  setTokens(_token: string, _refreshToken: string | null): void;
  /** Returns a Promise so callers can await before redirecting (ensures cookies cleared). */
  logout(): Promise<void>;
  subscribe(fn: (auth: null) => void): () => void;
};
