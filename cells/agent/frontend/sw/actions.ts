/**
 * Action handlers: call API from SW and return Changes to apply and broadcast.
 */
import type { Action, Change, Message, ModelState, Thread } from "../lib/model-types.ts";
import * as api from "./api.ts";

export async function handleAction(action: Action, state: ModelState): Promise<Change[]> {
  switch (action.kind) {
    case "threads.create": {
      const thread = await api.createThread(action.payload.title);
      const t: Thread = {
        threadId: thread.threadId,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      };
      const next = [...state.threads, t].sort((a, b) => b.updatedAt - a.updatedAt);
      return [{ kind: "threads.updated", payload: { threads: next } }];
    }

    case "threads.delete": {
      await api.deleteThread(action.payload.threadId);
      const next = state.threads.filter((t) => t.threadId !== action.payload.threadId);
      return [{ kind: "threads.updated", payload: { threads: next } }];
    }

    case "settings.update": {
      await api.setSetting(action.payload.key, action.payload.value);
      return [{ kind: "settings.updated", payload: { key: action.payload.key, value: action.payload.value } }];
    }

    case "sync.pull": {
      const scope = action.payload?.scope;
      const targetThreadId = action.payload?.threadId;
      const changes: Change[] = [];
      let threads = state.threads;

      if (scope === undefined || scope === "threads") {
        const res = await api.listThreads();
        threads = res.threads;
        changes.push({ kind: "threads.updated", payload: { threads } });
      }

      if (scope === undefined || scope === "settings") {
        const { items } = await api.listSettings();
        for (const { key, value } of items) {
          changes.push({ kind: "settings.updated", payload: { key, value } });
        }
      }

      if (scope === "messages" || scope === undefined) {
        const threadIdsToFetch =
          scope === "messages" && targetThreadId
            ? [targetThreadId]
            : threads.map((t) => t.threadId);
        for (const threadId of threadIdsToFetch) {
          const { messages } = await api.listMessages(threadId);
          const list = messages as Message[];
          changes.push({ kind: "messages.replaced", payload: { threadId, messages: list } });
        }
      }

      return changes;
    }

    case "messages.send":
    case "stream.cancel":
      return [];
    default:
      return [];
  }
}
