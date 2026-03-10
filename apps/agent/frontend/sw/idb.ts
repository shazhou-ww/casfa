/**
 * IndexedDB schema and helpers for Agent ModelState in the Service Worker.
 * DB: cell-agent. Stores: threads, messages, stream_state, settings.
 */
import type { Message, ModelState, StreamState, Thread } from "../lib/model-types.ts";

const DB_NAME = "cell-agent";
const DB_VERSION = 1;
const STORE_THREADS = "threads";
const STORE_MESSAGES = "messages";
const STORE_STREAM_STATE = "stream_state";
const STORE_SETTINGS = "settings";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_THREADS)) {
        const s = db.createObjectStore(STORE_THREADS, { keyPath: "threadId" });
        s.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const s = db.createObjectStore(STORE_MESSAGES, { keyPath: "messageId" });
        s.createIndex("threadId", "threadId", { unique: false });
        s.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_STREAM_STATE)) {
        db.createObjectStore(STORE_STREAM_STATE, { keyPath: "messageId" });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
      }
    };
  });
}

export async function getThreads(): Promise<Thread[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_THREADS, "readonly");
    const req = tx.objectStore(STORE_THREADS).getAll();
    req.onsuccess = () => {
      const list = (req.result as Thread[]).sort((a, b) => a.updatedAt - b.updatedAt);
      db.close();
      resolve(list);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function putThreads(threads: Thread[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_THREADS, "readwrite");
    const store = tx.objectStore(STORE_THREADS);
    store.clear();
    for (const t of threads) store.put(t);
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

export async function getMessages(threadId: string): Promise<Message[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, "readonly");
    const index = tx.objectStore(STORE_MESSAGES).index("threadId");
    const req = index.getAll(IDBKeyRange.only(threadId));
    req.onsuccess = () => {
      const list = (req.result as Message[]).sort((a, b) => a.createdAt - b.createdAt);
      db.close();
      resolve(list);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function putMessage(message: Message): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, "readwrite");
    tx.objectStore(STORE_MESSAGES).put(message);
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

/** Replace all messages for a thread (used by sync.pull to avoid duplicate appends). */
export async function replaceMessagesForThread(threadId: string, messages: Message[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, "readwrite");
    const store = tx.objectStore(STORE_MESSAGES);
    const index = store.index("threadId");
    const req = index.getAllKeys(IDBKeyRange.only(threadId));
    req.onsuccess = () => {
      const keysToDelete = req.result as string[];
      for (const k of keysToDelete) store.delete(k);
      for (const m of messages) store.put(m);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function deleteMessage(messageId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, "readwrite");
    tx.objectStore(STORE_MESSAGES).delete(messageId);
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

export async function getStreamState(messageId: string): Promise<StreamState | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STREAM_STATE, "readonly");
    const req = tx.objectStore(STORE_STREAM_STATE).get(messageId);
    req.onsuccess = () => {
      db.close();
      resolve(req.result);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function putStreamState(messageId: string, state: StreamState): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STREAM_STATE, "readwrite");
    tx.objectStore(STORE_STREAM_STATE).put(state);
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

export async function deleteStreamState(messageId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STREAM_STATE, "readwrite");
    tx.objectStore(STORE_STREAM_STATE).delete(messageId);
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

export async function getStreamStates(): Promise<Record<string, StreamState>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STREAM_STATE, "readonly");
    const req = tx.objectStore(STORE_STREAM_STATE).getAll();
    req.onsuccess = () => {
      const list = req.result as StreamState[];
      db.close();
      resolve(Object.fromEntries(list.map((s) => [s.messageId, s])));
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function getSettings(): Promise<Record<string, unknown>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readonly");
    const req = tx.objectStore(STORE_SETTINGS).getAll();
    req.onsuccess = () => {
      const entries = (req.result as { key: string; value?: unknown }[]).map((r) => [
        r.key,
        r.value,
      ]);
      db.close();
      resolve(Object.fromEntries(entries));
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/** Settings store shape: { key: string, value?: unknown } */
export async function putSetting(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readwrite");
    tx.objectStore(STORE_SETTINGS).put({ key, value });
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

/** Load full ModelState from IndexedDB (call on SW activate or first use). */
export async function hydrate(): Promise<ModelState> {
  const [threads, streamByMessageId, settings] = await Promise.all([
    getThreads(),
    getStreamStates(),
    getSettings(),
  ]);
  const messagesByThread: Record<string, Message[]> = {};
  for (const t of threads) {
    messagesByThread[t.threadId] = await getMessages(t.threadId);
  }
  return { threads, messagesByThread, streamByMessageId, settings };
}
