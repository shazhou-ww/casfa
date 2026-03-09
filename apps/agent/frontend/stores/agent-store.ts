import { create } from "zustand";
import * as api from "../lib/api.ts";

export type LLMProvider = {
  id: string;
  name?: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{ id: string; name?: string }>;
};

const LLM_PROVIDERS_KEY = "llm.providers";

function parseLlmProviders(value: unknown): LLMProvider[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is LLMProvider =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as LLMProvider).id === "string" &&
      typeof (p as LLMProvider).baseUrl === "string" &&
      Array.isArray((p as LLMProvider).models)
  );
}

type SettingsState = Record<string, { value: unknown; updatedAt: number }>;

type AgentState = {
  settings: SettingsState;
  threads: api.Thread[];
  currentThreadId: string | null;
  messagesByThread: Record<string, api.Message[]>;
  settingsLoading: boolean;
  threadsLoading: boolean;
  messagesLoading: Record<string, boolean>;
};

type AgentActions = {
  fetchSettings: () => Promise<void>;
  mergeSettings: (items: api.Setting[]) => void;
  setSetting: (key: string, value: unknown) => Promise<void>;
  getLlmProviders: () => LLMProvider[];
  fetchThreads: () => Promise<void>;
  mergeThreads: (threads: api.Thread[]) => void;
  setCurrentThreadId: (id: string | null) => void;
  fetchMessages: (threadId: string) => Promise<void>;
  mergeMessages: (threadId: string, messages: api.Message[]) => void;
  appendMessageLocal: (threadId: string, message: api.Message) => void;
  removeMessage: (threadId: string, messageId: string) => void;
  createThread: (body: { title: string }) => Promise<api.Thread>;
  deleteThread: (threadId: string) => Promise<void>;
  createMessage: (threadId: string, body: { role: api.Message["role"]; content: api.Message["content"] }) => Promise<api.Message>;
};

export const useAgentStore = create<AgentState & AgentActions>((set, get) => ({
  settings: {},
  threads: [],
  currentThreadId: null,
  messagesByThread: {},
  settingsLoading: false,
  threadsLoading: false,
  messagesLoading: {},

  fetchSettings: async () => {
    set({ settingsLoading: true });
    try {
      const { items } = await api.getSettings();
      get().mergeSettings(items);
    } finally {
      set({ settingsLoading: false });
    }
  },

  mergeSettings: (items) => {
    set((state) => {
      const next: SettingsState = { ...state.settings };
      for (const item of items) {
        const cur = next[item.key];
        if (!cur || item.updatedAt >= cur.updatedAt) {
          next[item.key] = { value: item.value, updatedAt: item.updatedAt };
        }
      }
      return { settings: next };
    });
  },

  setSetting: async (key, value) => {
    const result = await api.setSetting(key, value);
    set((state) => ({
      settings: {
        ...state.settings,
        [key]: { value: result.value, updatedAt: result.updatedAt },
      },
    }));
  },

  getLlmProviders: () => {
    const s = get().settings[LLM_PROVIDERS_KEY];
    return s ? parseLlmProviders(s.value) : [];
  },

  fetchThreads: async () => {
    set({ threadsLoading: true });
    try {
      const { threads } = await api.getThreads(100);
      get().mergeThreads(threads);
    } finally {
      set({ threadsLoading: false });
    }
  },

  mergeThreads: (threads) => {
    set((state) => {
      const byId = new Map(state.threads.map((t) => [t.threadId, t]));
      for (const t of threads) {
        const cur = byId.get(t.threadId);
        if (!cur || t.updatedAt >= cur.updatedAt) byId.set(t.threadId, t);
      }
      return { threads: Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt) };
    });
  },

  setCurrentThreadId: (id) => set({ currentThreadId: id }),

  fetchMessages: async (threadId) => {
    set((state) => ({
      messagesLoading: { ...state.messagesLoading, [threadId]: true },
    }));
    try {
      const { messages } = await api.getMessages(threadId, 200);
      get().mergeMessages(threadId, messages);
    } finally {
      set((state) => ({
        messagesLoading: { ...state.messagesLoading, [threadId]: false },
      }));
    }
  },

  mergeMessages: (threadId, messages) => {
    set((state) => {
      const existing = state.messagesByThread[threadId] ?? [];
      const byId = new Map(existing.map((m) => [m.messageId, m]));
      for (const m of messages) {
        byId.set(m.messageId, m);
      }
      const merged = Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
      return {
        messagesByThread: { ...state.messagesByThread, [threadId]: merged },
      };
    });
  },

  appendMessageLocal: (threadId, message) => {
    set((state) => {
      const list = state.messagesByThread[threadId] ?? [];
      return {
        messagesByThread: {
          ...state.messagesByThread,
          [threadId]: [...list, message],
        },
      };
    });
  },

  /** Remove one message by id (e.g. optimistic local_xxx) after server message is merged. */
  removeMessage: (threadId, messageId) => {
    set((state) => {
      const list = state.messagesByThread[threadId] ?? [];
      const next = list.filter((m) => m.messageId !== messageId);
      if (next.length === list.length) return state;
      return {
        messagesByThread: { ...state.messagesByThread, [threadId]: next },
      };
    });
  },

  createThread: async (body) => {
    const thread = await api.createThread(body);
    set((state) => ({
      threads: [thread, ...state.threads],
      currentThreadId: thread.threadId,
    }));
    return thread;
  },

  deleteThread: async (threadId) => {
    await api.deleteThread(threadId);
    set((state) => {
      const next = state.threads.filter((t) => t.threadId !== threadId);
      const nextMessages = { ...state.messagesByThread };
      delete nextMessages[threadId];
      return {
        threads: next,
        messagesByThread: nextMessages,
        currentThreadId: state.currentThreadId === threadId ? (next[0]?.threadId ?? null) : state.currentThreadId,
      };
    });
  },

  createMessage: async (threadId, body) => {
    const message = await api.createMessage(threadId, body);
    get().mergeMessages(threadId, [message]);
    return message;
  },
}));
