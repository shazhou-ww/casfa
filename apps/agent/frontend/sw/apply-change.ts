/**
 * Apply a Change to in-memory ModelState and persist to IndexedDB.
 * Used by the Service Worker only.
 */
import type { Change, ModelState, Message, StreamState } from "../lib/model-types.ts";
import * as idb from "./idb.ts";

export async function applyChange(state: ModelState, change: Change): Promise<ModelState> {
  switch (change.kind) {
    case "threads.updated": {
      const threads = change.payload.threads;
      await idb.putThreads(threads);
      return { ...state, threads };
    }

    case "messages.append": {
      const { threadId, message } = change.payload;
      const list = state.messagesByThread[threadId] ?? [];
      const next = { ...state, messagesByThread: { ...state.messagesByThread, [threadId]: [...list, message] } };
      await idb.putMessage(message);
      return next;
    }

    case "messages.patch": {
      const { threadId, messageId, patch } = change.payload;
      const list = state.messagesByThread[threadId] ?? [];
      const idx = list.findIndex((m) => m.messageId === messageId);
      if (idx === -1) return state;
      const prev = list[idx];
      const updated: Message = { ...prev, ...patch };
      const newList = list.slice(0);
      newList[idx] = updated;
      const next = { ...state, messagesByThread: { ...state.messagesByThread, [threadId]: newList } };
      await idb.putMessage(updated);
      return next;
    }

    case "messages.remove": {
      const { threadId, messageId } = change.payload;
      const list = (state.messagesByThread[threadId] ?? []).filter((m) => m.messageId !== messageId);
      const next = { ...state, messagesByThread: { ...state.messagesByThread, [threadId]: list } };
      await idb.deleteMessage(messageId);
      return next;
    }

    case "stream.status": {
      const { messageId, threadId, status, error } = change.payload;
      const prev = state.streamByMessageId[messageId];
      const stream: StreamState = prev
        ? { ...prev, status, error }
        : { messageId, threadId, status, chunks: [], error, startedAt: Date.now() };
      const next = { ...state, streamByMessageId: { ...state.streamByMessageId, [messageId]: stream } };
      await idb.putStreamState(messageId, stream);
      return next;
    }

    case "stream.chunk": {
      const { messageId, threadId, chunk } = change.payload;
      const prev = state.streamByMessageId[messageId];
      const stream: StreamState = prev
        ? { ...prev, chunks: [...prev.chunks, chunk] }
        : { messageId, threadId, status: "streaming", chunks: [chunk], startedAt: Date.now() };
      const next = { ...state, streamByMessageId: { ...state.streamByMessageId, [messageId]: stream } };
      await idb.putStreamState(messageId, stream);
      return next;
    }

    case "stream.done": {
      const { messageId, threadId, message } = change.payload;
      const list = state.messagesByThread[threadId] ?? [];
      const next = {
        ...state,
        messagesByThread: { ...state.messagesByThread, [threadId]: [...list, message] },
        streamByMessageId: (() => {
          const o = { ...state.streamByMessageId };
          delete o[messageId];
          return o;
        })(),
      };
      await idb.putMessage(message);
      await idb.deleteStreamState(messageId);
      return next;
    }

    case "stream.error": {
      const { messageId, threadId, error } = change.payload;
      const prev = state.streamByMessageId[messageId];
      const stream: StreamState = prev
        ? { ...prev, status: "error", error }
        : { messageId, threadId, status: "error", chunks: [], error, startedAt: Date.now() };
      const next = { ...state, streamByMessageId: { ...state.streamByMessageId, [messageId]: stream } };
      await idb.putStreamState(messageId, stream);
      return next;
    }

    case "settings.updated": {
      const { key, value } = change.payload;
      const settings = { ...state.settings, [key]: value };
      await idb.putSetting(key, value);
      return { ...state, settings };
    }

    case "response":
      return state;

    default:
      return state;
  }
}
