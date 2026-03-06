/**
 * Cookie-only mode: getAuth() always returns null (token is HttpOnly).
 * User info comes from /api/me. subscribe() still fires on logout().
 */
export type AuthClient = {
  getAuth(): null;
  setTokens(_token: string, _refreshToken: string | null): void;
  logout(): void;
  subscribe(fn: (auth: null) => void): () => void;
};
