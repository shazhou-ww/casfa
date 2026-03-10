/**
 * Agent store: ModelState mirror (threads, messagesByThread, streamByMessageId, settings)
 * updated via applyChange from SW; UI sends Actions via sendAction(port from setSwPort).
 */
import { create } from "zustand";
import type {
  Action,
  Change,
  Message,
  MessageContent,
  ModelState,
  StreamState,
  Thread,
} from "../lib/model-types.ts";
import { connectToSW, getCsrfTokenFromCookie, send, subscribeToChangeBroadcast } from "../lib/sw-protocol.ts";
import { MCP_SERVERS_SETTINGS_KEY, parseMcpServers } from "../lib/mcp-types.ts";
import type { MCPServerConfig, MCPServerDiscovery } from "../lib/mcp-types.ts";

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

type AgentState = ModelState & {
  currentThreadId: string | null;
  settingsLoading: boolean;
  threadsLoading: boolean;
  messagesLoading: Record<string, boolean>;
  swPort: MessagePort | null;
  /** MCP capabilities discovery result per server (in-memory, not synced). */
  mcpDiscoveryByServerId: Record<string, MCPServerDiscovery>;
};

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

type AgentActions = {
  setSwPort: (port: MessagePort | null) => void;
  applyChange: (change: Change) => void;
  sendAction: (action: Action, id?: string) => Promise<unknown>;
  getLlmProviders: () => LLMProvider[];
  getMcpServers: () => MCPServerConfig[];
  setMcpServers: (configs: MCPServerConfig[]) => Promise<void>;
  getMcpDiscovery: (serverId: string) => MCPServerDiscovery | undefined;
  setMcpDiscovery: (serverId: string, discovery: MCPServerDiscovery | null) => void;
  setCurrentThreadId: (id: string | null) => void;
  fetchSettings: () => Promise<void>;
  fetchThreads: () => Promise<void>;
  fetchMessages: (threadId: string) => Promise<void>;
  createThread: (body: { title: string }) => Promise<Thread>;
  deleteThread: (threadId: string) => Promise<void>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  sendMessage: (threadId: string, content: MessageContent[], modelId?: string) => Promise<void>;
  cancelStream: (messageId: string) => void;
};

const pendingById = new Map<string, Pending>();
const ACTION_RESPONSE_TIMEOUT_MS = 15000;

function clearPending(id: string): void {
  pendingById.delete(id);
}

export const useAgentStore = create<AgentState & AgentActions>((set, get) => ({
  threads: [],
  messagesByThread: {},
  streamByMessageId: {},
  settings: {},
  currentThreadId: null,
  settingsLoading: false,
  threadsLoading: false,
  messagesLoading: {},
  swPort: null,
  mcpDiscoveryByServerId: {},

  setSwPort(port) {
    const prev = get().swPort;
    if (prev === port) return;
    if (prev) {
      try {
        prev.close();
      } catch {
        /* ignore */
      }
    }
    set({ swPort: port });
    if (port) {
      subscribeToChangeBroadcast((msg) => {
        for (const change of msg.changes) {
          get().applyChange(change);
        }
      });
    }
  },

  applyChange(change) {
    switch (change.kind) {
      case "threads.updated":
        set((s) => {
          const threadIds = new Set(change.payload.threads.map((t) => t.threadId));
          const nextMessages: Record<string, Message[]> = {};
          for (const id of Object.keys(s.messagesByThread)) {
            if (threadIds.has(id)) nextMessages[id] = s.messagesByThread[id];
          }
          return {
            threads: change.payload.threads,
            messagesByThread: nextMessages,
            currentThreadId: s.currentThreadId && threadIds.has(s.currentThreadId) ? s.currentThreadId : change.payload.threads[0]?.threadId ?? null,
          };
        });
        break;
      case "messages.append": {
        const { threadId, message } = change.payload;
        set((s) => {
          const list = s.messagesByThread[threadId] ?? [];
          return {
            messagesByThread: { ...s.messagesByThread, [threadId]: [...list, message] },
          };
        });
        break;
      }
      case "messages.patch": {
        const { threadId, messageId, patch } = change.payload;
        set((s) => {
          const list = s.messagesByThread[threadId] ?? [];
          const idx = list.findIndex((m) => m.messageId === messageId);
          if (idx === -1) return s;
          const next = list.slice(0);
          next[idx] = { ...next[idx], ...patch };
          return { messagesByThread: { ...s.messagesByThread, [threadId]: next } };
        });
        break;
      }
      case "messages.remove": {
        const { threadId, messageId } = change.payload;
        set((s) => ({
          messagesByThread: {
            ...s.messagesByThread,
            [threadId]: (s.messagesByThread[threadId] ?? []).filter((m) => m.messageId !== messageId),
          },
        }));
        break;
      }
      case "messages.replaced": {
        const { threadId, messages } = change.payload;
        const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
        set((s) => ({
          messagesByThread: { ...s.messagesByThread, [threadId]: sorted },
        }));
        break;
      }
      case "stream.status":
        set((s) => {
          const { messageId, threadId, status, error } = change.payload;
          const prev = s.streamByMessageId[messageId];
          const stream: StreamState = prev
            ? { ...prev, status, error }
            : { messageId, threadId, status, chunks: [], error, startedAt: Date.now() };
          return { streamByMessageId: { ...s.streamByMessageId, [messageId]: stream } };
        });
        break;
      case "stream.chunk":
        set((s) => {
          const { messageId, threadId, chunk } = change.payload;
          const prev = s.streamByMessageId[messageId];
          const stream: StreamState = prev
            ? { ...prev, chunks: [...prev.chunks, chunk] }
            : { messageId, threadId, status: "streaming", chunks: [chunk], startedAt: Date.now() };
          return { streamByMessageId: { ...s.streamByMessageId, [messageId]: stream } };
        });
        break;
      case "stream.done": {
        const { messageId, threadId, message } = change.payload;
        set((s) => {
          const list = s.messagesByThread[threadId] ?? [];
          const nextStreams = { ...s.streamByMessageId };
          delete nextStreams[messageId];
          return {
            messagesByThread: { ...s.messagesByThread, [threadId]: [...list, message] },
            streamByMessageId: nextStreams,
          };
        });
        break;
      }
      case "stream.error":
        set((s) => {
          const { messageId, threadId, error } = change.payload;
          const prev = s.streamByMessageId[messageId];
          const stream: StreamState = prev
            ? { ...prev, status: "error", error }
            : { messageId, threadId, status: "error", chunks: [], error, startedAt: Date.now() };
          return { streamByMessageId: { ...s.streamByMessageId, [messageId]: stream } };
        });
        break;
      case "settings.updated":
        set((s) => ({
          settings: { ...s.settings, [change.payload.key]: change.payload.value },
        }));
        break;
      case "response": {
        const { id, result, error } = change.payload;
        const p = pendingById.get(id);
        if (p) {
          clearPending(id);
          if (error) p.reject(new Error(error.message));
          else p.resolve(result);
        }
        break;
      }
    }
  },

  sendAction(action, id) {
    const port = get().swPort;
    if (!port) return Promise.reject(new Error("SW not connected"));
    if (id != null) {
      return new Promise<unknown>((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          timeoutId = null;
          if (pendingById.has(id)) {
            clearPending(id);
            reject(new Error("SW response timeout"));
          }
        }, ACTION_RESPONSE_TIMEOUT_MS);
        pendingById.set(id, {
          resolve: (v) => {
            if (timeoutId != null) clearTimeout(timeoutId);
            resolve(v);
          },
          reject: (e) => {
            if (timeoutId != null) clearTimeout(timeoutId);
            reject(e);
          },
        });
        send(port, { type: "action", id, action });
      });
    }
    send(port, { type: "action", action });
    return Promise.resolve();
  },

  getLlmProviders() {
    const raw = get().settings[LLM_PROVIDERS_KEY];
    return parseLlmProviders(raw);
  },

  getMcpServers() {
    const raw = get().settings[MCP_SERVERS_SETTINGS_KEY];
    return parseMcpServers(raw);
  },

  setMcpServers: async (configs) => {
    await get().setSetting(MCP_SERVERS_SETTINGS_KEY, configs);
  },

  getMcpDiscovery(serverId) {
    return get().mcpDiscoveryByServerId[serverId];
  },

  setMcpDiscovery(serverId, discovery) {
    set((s) => {
      const next = { ...s.mcpDiscoveryByServerId };
      if (discovery == null) delete next[serverId];
      else next[serverId] = discovery;
      return { mcpDiscoveryByServerId: next };
    });
  },

  setCurrentThreadId: (id) => set({ currentThreadId: id }),

  fetchSettings: async () => {
    set({ settingsLoading: true });
    try {
      await get().sendAction({ kind: "sync.pull", payload: { scope: "settings" } }, crypto.randomUUID());
    } finally {
      set({ settingsLoading: false });
    }
  },

  fetchThreads: async () => {
    set({ threadsLoading: true });
    try {
      await get().sendAction({ kind: "sync.pull", payload: { scope: "threads" } }, crypto.randomUUID());
    } finally {
      set({ threadsLoading: false });
    }
  },

  fetchMessages: async (threadId) => {
    set((s) => ({ messagesLoading: { ...s.messagesLoading, [threadId]: true } }));
    try {
      await get().sendAction({ kind: "sync.pull" }, crypto.randomUUID());
    } finally {
      set((s) => ({ messagesLoading: { ...s.messagesLoading, [threadId]: false } }));
    }
  },

  createThread: async (body) => {
    const prevIds = get().threads.map((t) => t.threadId);
    await get().sendAction({ kind: "threads.create", payload: body }, crypto.randomUUID());
    const next = get().threads;
    const added = next.find((t) => !prevIds.includes(t.threadId));
    if (added) set({ currentThreadId: added.threadId });
    if (!added) throw new Error("Create thread failed");
    return added;
  },

  deleteThread: async (threadId) => {
    await get().sendAction({ kind: "threads.delete", payload: { threadId } }, crypto.randomUUID());
  },

  setSetting: async (key, value) => {
    await get().sendAction({ kind: "settings.update", payload: { key, value } }, crypto.randomUUID());
  },

  sendMessage: async (threadId, content, modelId) => {
    await get().sendAction(
      { kind: "messages.send", payload: { threadId, content, modelId } },
      crypto.randomUUID()
    );
  },

  cancelStream(messageId) {
    get().sendAction({ kind: "stream.cancel", payload: { messageId } });
  },
}));
