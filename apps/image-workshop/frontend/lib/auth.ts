const TOKEN_KEY = "iw_token";
const REFRESH_KEY = "iw_refresh";

type AuthState = {
  token: string;
  userId: string;
  email?: string;
};

let currentAuth: AuthState | null = null;
const listeners: Set<() => void> = new Set();

function notify() {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAuth(): AuthState | null {
  if (currentAuth) return currentAuth;
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return null;
  try {
    const parts = stored.split(".");
    const payload = JSON.parse(atob(parts[1]));
    currentAuth = { token: stored, userId: payload.sub, email: payload.email };
    return currentAuth;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

export function setTokens(token: string, refreshToken?: string) {
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  currentAuth = null;
  getAuth();
  notify();
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  currentAuth = null;
  notify();
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
