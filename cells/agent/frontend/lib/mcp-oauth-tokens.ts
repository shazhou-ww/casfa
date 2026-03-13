/**
 * MCP OAuth tokens stored in IndexedDB (by serverId).
 * Only used in the main window; not sent to the backend.
 */

const DB_NAME = "cell-agent-mcp-oauth";
const DB_VERSION = 1;
const STORE_NAME = "tokens";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "serverId" });
      }
    };
  });
}

export type MCPOAuthTokenEntry = {
  serverId: string;
  access_token: string;
  expires_at: number; // ms since epoch
  refresh_token?: string;
  updatedAt: number;
};

export async function getMCPToken(serverId: string): Promise<MCPOAuthTokenEntry | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(serverId);
    req.onsuccess = () => {
      db.close();
      const entry = req.result as MCPOAuthTokenEntry | undefined;
      if (!entry?.access_token) {
        console.log("[MCP OAuth] getMCPToken: serverId=%s -> null (no token or expired)", serverId);
        resolve(null);
        return;
      }
      if (entry.expires_at && entry.expires_at <= Date.now() + 60_000) {
        console.log("[MCP OAuth] getMCPToken: serverId=%s -> null (expired)", serverId);
        resolve(null);
        return;
      }
      console.log("[MCP OAuth] getMCPToken: serverId=%s -> has token", serverId);
      resolve(entry);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function setMCPToken(entry: MCPOAuthTokenEntry): Promise<void> {
  console.log("[MCP OAuth] setMCPToken: serverId=%s", entry.serverId);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({
      ...entry,
      updatedAt: Date.now(),
    });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function removeMCPToken(serverId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(serverId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function hasMCPToken(serverId: string): Promise<boolean> {
  const entry = await getMCPToken(serverId);
  return entry != null;
}
