/**
 * CAS internal meta blobs: keysToRetain, new keys since GC, key→timestamp, lastGcTime.
 * Uses only storage get/put/del; format is JSON.
 */
import type { CasStorage } from "./types.ts";

export const BLOB_KEYS = {
  /** Last GC: set of keys to retain (JSON array of strings) */
  RETAINED: "__cas_retained__",
  /** New keys since last GC (JSON array of strings) */
  NEW_KEYS: "__cas_new_keys__",
  /** key → timestamp (ms) (JSON object) */
  TIMES: "__cas_times__",
  /** { lastGcTime?: number } (JSON object) */
  META: "__cas_meta__",
} as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeJson(obj: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(obj));
}

function decodeJson<T>(buf: Uint8Array | null): T | null {
  if (buf === null || buf.length === 0) return null;
  return JSON.parse(decoder.decode(buf)) as T;
}

export async function readKeysToRetain(storage: CasStorage): Promise<string[]> {
  const buf = await storage.get(BLOB_KEYS.RETAINED);
  const arr = decodeJson<string[]>(buf);
  return Array.isArray(arr) ? arr : [];
}

export async function writeKeysToRetain(storage: CasStorage, keys: string[]): Promise<void> {
  await storage.put(BLOB_KEYS.RETAINED, encodeJson(keys));
}

export async function readNewKeys(storage: CasStorage): Promise<string[]> {
  const buf = await storage.get(BLOB_KEYS.NEW_KEYS);
  const arr = decodeJson<string[]>(buf);
  return Array.isArray(arr) ? arr : [];
}

export async function appendNewKey(storage: CasStorage, key: string): Promise<void> {
  const keys = await readNewKeys(storage);
  if (keys.includes(key)) return;
  keys.push(key);
  await storage.put(BLOB_KEYS.NEW_KEYS, encodeJson(keys));
}

export async function clearNewKeys(storage: CasStorage): Promise<void> {
  await storage.put(BLOB_KEYS.NEW_KEYS, encodeJson([]));
}

export async function readTimes(storage: CasStorage): Promise<Record<string, number>> {
  const buf = await storage.get(BLOB_KEYS.TIMES);
  const obj = decodeJson<Record<string, number>>(buf);
  return obj && typeof obj === "object" ? obj : {};
}

export async function writeTimes(
  storage: CasStorage,
  times: Record<string, number>
): Promise<void> {
  await storage.put(BLOB_KEYS.TIMES, encodeJson(times));
}

export async function setTime(storage: CasStorage, key: string, time: number): Promise<void> {
  const times = await readTimes(storage);
  times[key] = time;
  await writeTimes(storage, times);
}

export async function readLastGcTime(storage: CasStorage): Promise<number | undefined> {
  const buf = await storage.get(BLOB_KEYS.META);
  const obj = decodeJson<{ lastGcTime?: number }>(buf);
  return obj?.lastGcTime;
}

export async function writeLastGcTime(storage: CasStorage, lastGcTime: number): Promise<void> {
  const buf = await storage.get(BLOB_KEYS.META);
  const obj = decodeJson<{ lastGcTime?: number }>(buf) ?? {};
  obj.lastGcTime = lastGcTime;
  await storage.put(BLOB_KEYS.META, encodeJson(obj));
}
