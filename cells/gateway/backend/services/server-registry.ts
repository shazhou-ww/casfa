export type RegisteredServer = {
  id: string;
  name: string;
  url: string;
};

export type ServerRegistry = {
  list(userId: string): Promise<RegisteredServer[]>;
  search(userId: string, query: string): Promise<RegisteredServer[]>;
  add(userId: string, server: RegisteredServer): Promise<void>;
  remove(userId: string, serverId: string): Promise<boolean>;
  get(userId: string, serverId: string): Promise<RegisteredServer | null>;
};

export function createMemoryServerRegistry(): ServerRegistry {
  const rows = new Map<string, Map<string, RegisteredServer>>();

  function getUserMap(userId: string): Map<string, RegisteredServer> {
    const current = rows.get(userId);
    if (current) return current;
    const created = new Map<string, RegisteredServer>();
    rows.set(userId, created);
    return created;
  }

  return {
    async list(userId) {
      return [...getUserMap(userId).values()].sort((a, b) => a.id.localeCompare(b.id));
    },
    async search(userId, query) {
      const q = query.trim().toLowerCase();
      if (!q) return this.list(userId);
      return (await this.list(userId)).filter(
        (server) =>
          server.id.toLowerCase().includes(q) ||
          server.name.toLowerCase().includes(q) ||
          server.url.toLowerCase().includes(q)
      );
    },
    async add(userId, server) {
      getUserMap(userId).set(server.id, server);
    },
    async remove(userId, serverId) {
      return getUserMap(userId).delete(serverId);
    },
    async get(userId, serverId) {
      return getUserMap(userId).get(serverId) ?? null;
    },
  };
}
