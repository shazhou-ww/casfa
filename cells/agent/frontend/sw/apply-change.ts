/**
 * Apply a Change to in-memory ModelState and persist to IndexedDB.
 * Used by the Service Worker only.
 */
import type { Change, ModelState, Message, StreamState } from "../lib/model-types.ts";
import * as idb from "./idb.ts";

export type ApplyChangeDeps = {
  putThreads: typeof idb.putThreads;
  putMessage: typeof idb.putMessage;
  deleteMessage: typeof idb.deleteMessage;
  replaceMessagesForThread: typeof idb.replaceMessagesForThread;
  putStreamState: typeof idb.putStreamState;
  deleteStreamState: typeof idb.deleteStreamState;
  putSetting: typeof idb.putSetting;
};

const defaultDeps: ApplyChangeDeps = {
  putThreads: idb.putThreads,
  putMessage: idb.putMessage,
  deleteMessage: idb.deleteMessage,
  replaceMessagesForThread: idb.replaceMessagesForThread,
  putStreamState: idb.putStreamState,
  deleteStreamState: idb.deleteStreamState,
  putSetting: idb.putSetting,
};

export async function applyChange(
  state: ModelState,
  change: Change,
  deps: ApplyChangeDeps = defaultDeps
): Promise<ModelState> {
  switch (change.kind) {
    case "threads.updated": {
      const threads = change.payload.threads;
      await deps.putThreads(threads);
      return { ...state, threads };
    }

    case "messages.append": {
      const { threadId, message } = change.payload;
      const list = state.messagesByThread[threadId] ?? [];
      const next = { ...state, messagesByThread: { ...state.messagesByThread, [threadId]: [...list, message] } };
      await deps.putMessage(message);
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
      await deps.putMessage(updated);
      return next;
    }

    case "messages.remove": {
      const { threadId, messageId } = change.payload;
      const list = (state.messagesByThread[threadId] ?? []).filter((m) => m.messageId !== messageId);
      const next = { ...state, messagesByThread: { ...state.messagesByThread, [threadId]: list } };
      await deps.deleteMessage(messageId);
      return next;
    }

    case "messages.replaced": {
      const { threadId, messages } = change.payload;
      const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
      const next = {
        ...state,
        messagesByThread: { ...state.messagesByThread, [threadId]: sorted },
      };
      await deps.replaceMessagesForThread(threadId, sorted);
      return next;
    }

    case "stream.status": {
      const { messageId, threadId, status, error } = change.payload;
      const prev = state.streamByMessageId[messageId];
      const stream: StreamState = prev
        ? { ...prev, status, error }
        : { messageId, threadId, status, chunks: [], error, startedAt: Date.now() };
      const next = { ...state, streamByMessageId: { ...state.streamByMessageId, [messageId]: stream } };
      await deps.putStreamState(messageId, stream);
      return next;
    }

    case "stream.chunk": {
      const { messageId, threadId, chunk } = change.payload;
      const prev = state.streamByMessageId[messageId];
      const stream: StreamState = prev
        ? { ...prev, chunks: [...prev.chunks, chunk] }
        : { messageId, threadId, status: "streaming", chunks: [chunk], startedAt: Date.now() };
      const next = { ...state, streamByMessageId: { ...state.streamByMessageId, [messageId]: stream } };
      await deps.putStreamState(messageId, stream);
      return next;
    }

    case "stream.reset": {
      const { messageId, threadId, status } = change.payload;
      const prev = state.streamByMessageId[messageId];
      if (!prev) return state;
      const stream: StreamState = { ...prev, threadId, status: status ?? prev.status, chunks: [] };
      const next = { ...state, streamByMessageId: { ...state.streamByMessageId, [messageId]: stream } };
      await deps.putStreamState(messageId, stream);
      return next;
    }

    case "stream.done": {
      const { messageId, threadId, message } = change.payload;
      const list = state.messagesByThread[threadId] ?? [];
      const existingIdx = list.findIndex((m) => m.messageId === message.messageId);
      const nextMessages =
        existingIdx === -1
          ? [...list, message]
          : list.map((m, idx) => (idx === existingIdx ? message : m));
      const next = {
        ...state,
        messagesByThread: { ...state.messagesByThread, [threadId]: nextMessages },
        streamByMessageId: (() => {
          const o = { ...state.streamByMessageId };
          delete o[messageId];
          return o;
        })(),
      };
      await deps.putMessage(message);
      await deps.deleteStreamState(messageId);
      return next;
    }

    case "stream.error": {
      const { messageId, threadId, error } = change.payload;
      const prev = state.streamByMessageId[messageId];
      const stream: StreamState = prev
        ? { ...prev, status: "error", error }
        : { messageId, threadId, status: "error", chunks: [], error, startedAt: Date.now() };
      const next = { ...state, streamByMessageId: { ...state.streamByMessageId, [messageId]: stream } };
      await deps.putStreamState(messageId, stream);
      return next;
    }

    case "settings.updated": {
      const { key, value } = change.payload;
      const settings = { ...state.settings, [key]: value };
      await deps.putSetting(key, value);
      return { ...state, settings };
    }

    case "response":
      return state;

    default:
      return state;
  }
}
