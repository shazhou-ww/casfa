/**
 * CAS internal meta blobs: keysToRetain, new keys since GC, key→timestamp, lastGcTime.
 * Uses only storage get/put/del; format is JSON.
 */
import { bytesFromStream, streamFromBytes } from "./stream-util.ts";
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

async function getBytes(storage: CasStorage, key: string): Promise<Uint8Array | null> {
  const stream = await storage.get(key);
  if (stream === null) return null;
  return bytesFromStream(stream);
}

function putBytes(storage: CasStorage, key: string, bytes: Uint8Array): Promise<void> {
  return storage.put(key, streamFromBytes(bytes));
}

export async function readKeysToRetain(storage: CasStorage): Promise<string[]> {
  const buf = await getBytes(storage, BLOB_KEYS.RETAINED);
  const arr = decodeJson<string[]>(buf);
  return Array.isArray(arr) ? arr : [];
}

export async function writeKeysToRetain(storage: CasStorage, keys: string[]): Promise<void> {
  await putBytes(storage, BLOB_KEYS.RETAINED, encodeJson(keys));
}

export async function readNewKeys(storage: CasStorage): Promise<string[]> {
  const buf = await getBytes(storage, BLOB_KEYS.NEW_KEYS);
  const arr = decodeJson<string[]>(buf);
  return Array.isArray(arr) ? arr : [];
}

export async function appendNewKey(storage: CasStorage, key: string): Promise<void> {
  const keys = await readNewKeys(storage);
  if (keys.includes(key)) return;
  keys.push(key);
  await putBytes(storage, BLOB_KEYS.NEW_KEYS, encodeJson(keys));
}

export async function clearNewKeys(storage: CasStorage): Promise<void> {
  await putBytes(storage, BLOB_KEYS.NEW_KEYS, encodeJson([]));
}

export async function readTimes(storage: CasStorage): Promise<Record<string, number>> {
  const buf = await getBytes(storage, BLOB_KEYS.TIMES);
  const obj = decodeJson<Record<string, number>>(buf);
  return obj && typeof obj === "object" ? obj : {};
}

export async function writeTimes(
  storage: CasStorage,
  times: Record<string, number>
): Promise<void> {
  await putBytes(storage, BLOB_KEYS.TIMES, encodeJson(times));
}

export async function setTime(storage: CasStorage, key: string, time: number): Promise<void> {
  const times = await readTimes(storage);
  times[key] = time;
  await writeTimes(storage, times);
}

export async function readLastGcTime(storage: CasStorage): Promise<number | null> {
  const buf = await getBytes(storage, BLOB_KEYS.META);
  const obj = decodeJson<{ lastGcTime?: number }>(buf);
  return obj?.lastGcTime ?? null;
}

export async function writeLastGcTime(storage: CasStorage, lastGcTime: number): Promise<void> {
  const buf = await getBytes(storage, BLOB_KEYS.META);
  const obj = decodeJson<{ lastGcTime?: number }>(buf) ?? {};
  obj.lastGcTime = lastGcTime;
  await putBytes(storage, BLOB_KEYS.META, encodeJson(obj));
}
