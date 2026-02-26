/**
 * IndexedDB-backed store for custom viewer metadata.
 *
 * Uses a dedicated `casfa-viewers` database. Each entry represents a
 * user-added viewer with its CAS node key and content-type declarations.
 *
 * Built-in viewers are NOT stored here — they live in memory via
 * initBuiltinViewers(). This store is only for user-custom viewers.
 */

// ============================================================================
// Types
// ============================================================================

export interface CustomViewerEntry {
  /** Unique identifier (auto-generated UUID) */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Supported content type patterns (e.g. "image/*", "text/*") */
  contentTypes: string[];
  /** CAS node key of the viewer d-node (nod_XXX) */
  nodeKey: string;
  /** Timestamp when the viewer was added */
  createdAt: number;
}

export interface ViewerStore {
  /** Load all custom viewer entries */
  loadAll(): Promise<CustomViewerEntry[]>;
  /** Add or update a viewer entry */
  put(entry: CustomViewerEntry): Promise<void>;
  /** Remove a viewer by id */
  remove(id: string): Promise<void>;
  /** Get a single viewer by id */
  get(id: string): Promise<CustomViewerEntry | null>;
}

// ============================================================================
// Implementation
// ============================================================================

const DB_NAME = "casfa-viewers";
const DB_VERSION = 1;
const STORE_NAME = "custom-viewers";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
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

export function createViewerStore(): ViewerStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function getDB(): Promise<IDBDatabase> {
    if (!dbPromise) dbPromise = openDB();
    return dbPromise;
  }

  return {
    async loadAll(): Promise<CustomViewerEntry[]> {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as CustomViewerEntry[]);
        req.onerror = () => reject(req.error);
      });
    },

    async put(entry: CustomViewerEntry): Promise<void> {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(entry);
      await txComplete(tx);
    },

    async remove(id: string): Promise<void> {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      await txComplete(tx);
    },

    async get(id: string): Promise<CustomViewerEntry | null> {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as CustomViewerEntry) ?? null);
        req.onerror = () => reject(req.error);
      });
    },
  };
}
