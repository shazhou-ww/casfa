export type ServerOAuthState = {
  serverId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

export type ServerOAuthStateStore = {
  get(userId: string, serverId: string): Promise<ServerOAuthState | null>;
  set(userId: string, state: ServerOAuthState): Promise<void>;
  remove(userId: string, serverId: string): Promise<boolean>;
  list(userId: string): Promise<ServerOAuthState[]>;
};

export function createMemoryServerOAuthStateStore(): ServerOAuthStateStore {
  const rows = new Map<string, Map<string, ServerOAuthState>>();

  function getUserMap(userId: string): Map<string, ServerOAuthState> {
    const current = rows.get(userId);
    if (current) return current;
    const created = new Map<string, ServerOAuthState>();
    rows.set(userId, created);
    return created;
  }

  return {
    async get(userId, serverId) {
      return getUserMap(userId).get(serverId) ?? null;
    },
    async set(userId, state) {
      getUserMap(userId).set(state.serverId, state);
    },
    async remove(userId, serverId) {
      return getUserMap(userId).delete(serverId);
    },
    async list(userId) {
      return [...getUserMap(userId).values()].sort((a, b) => a.serverId.localeCompare(b.serverId));
    },
  };
}
