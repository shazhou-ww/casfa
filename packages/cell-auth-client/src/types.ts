export type ClientAuth = {
  token: string;
  userId: string;
  email: string;
  refreshToken: string | null;
};

export type AuthSubscriber = (auth: ClientAuth | null) => void;

export type AuthClient = {
  getAuth(): ClientAuth | null;
  setTokens(token: string, refreshToken: string | null): void;
  logout(): void;
  subscribe(fn: AuthSubscriber): () => void;
};
