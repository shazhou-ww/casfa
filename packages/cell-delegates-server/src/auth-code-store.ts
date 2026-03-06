export type AuthCodeEntry = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  createdAt: number;
  /** Set when creating the auth code from authorize; returned as client_id in token response for refresh. */
  delegateId?: string;
};

export type AuthCodeStore = {
  set(code: string, entry: AuthCodeEntry): void | Promise<void>;
  get(code: string): AuthCodeEntry | null | Promise<AuthCodeEntry | null>;
  delete(code: string): void | Promise<void>;
};

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export function createMemoryAuthCodeStore(): AuthCodeStore {
  const map = new Map<string, AuthCodeEntry>();
  function clean() {
    const now = Date.now();
    for (const [k, v] of map) {
      if (now - v.createdAt > AUTH_CODE_TTL_MS) map.delete(k);
    }
  }
  return {
    set(code, entry) {
      clean();
      map.set(code, entry);
    },
    get(code) {
      clean();
      const e = map.get(code);
      if (!e || Date.now() - e.createdAt > AUTH_CODE_TTL_MS) return null;
      return e;
    },
    delete(code) {
      map.delete(code);
    },
  };
}
