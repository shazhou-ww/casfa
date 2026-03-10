/**
 * IndexedDB-backed SyncQueueStore for persisting DepotSyncEntry items.
 *
 * Uses a dedicated `casfa-sync` database so it doesn't interfere with
 * the CAS node cache in `casfa-storage`.
 */

import type { DepotSyncEntry, SyncQueueStore } from "@casfa/explorer";

const DB_NAME = "casfa-sync";
const DB_VERSION = 1;
const STORE_NAME = "depot-queue";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "depotId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function createSyncQueueStore(): SyncQueueStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function getDB(): Promise<IDBDatabase> {
    if (!dbPromise) dbPromise = openDB();
    return dbPromise;
  }

  return {
    async loadAll(): Promise<DepotSyncEntry[]> {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as DepotSyncEntry[]);
        req.onerror = () => reject(req.error);
      });
    },

    async upsert(entry: DepotSyncEntry): Promise<void> {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(entry);
      await txComplete(tx);
    },

    async remove(depotId: string): Promise<void> {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(depotId);
      await txComplete(tx);
    },
  };
}
