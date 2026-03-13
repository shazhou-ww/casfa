/**
 * Agent Service Worker — ModelState in memory + IDB; action handlers including messages.send + streaming.
 */
declare const self: ServiceWorkerGlobalScope;

import type { ModelState } from "./lib/model-types.ts";
import { applyChange } from "./sw/apply-change.ts";
import { handleAction } from "./sw/actions.ts";
import { setCsrfToken } from "./sw/api.ts";
import { hydrate } from "./sw/idb.ts";
import {
  runMessagesSend,
  runStreamCancel,
} from "./sw/streaming.ts";

let modelState: ModelState = {
  threads: [],
  messagesByThread: {},
  streamByMessageId: {},
  settings: {},
};

const clientPorts = new Set<MessagePort>();
const streamAbortControllers = new Map<string, AbortController>();
const BROADCAST_CHANNEL_NAME = "agent-sw-changes";

function broadcast(changes: { type: "change"; changes: import("./lib/model-types.ts").Change[] }): void {
  let sent = 0;
  for (const port of clientPorts) {
    try {
      port.postMessage(changes);
      sent++;
    } catch {
      clientPorts.delete(port);
    }
  }
  try {
    const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    bc.postMessage(changes);
    bc.close();
  } catch {
    /* BroadcastChannel not available */
  }
}

async function applyAndBroadcast(change: import("./lib/model-types.ts").Change): Promise<void> {
  modelState = await applyChange(modelState, change);
  broadcast({ type: "change", changes: [change] });
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.clients.claim().then(() =>
      hydrate().then((s) => {
        modelState = s;
      })
    )
  );
});

const CLIENT_PORT_TYPE = "AGENT_SW_PORT";

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const port = event.ports?.[0];
  if (!port || event.data?.type !== CLIENT_PORT_TYPE) return;

  const data = event.data as { type: string; csrfToken?: string };
  if (typeof data.csrfToken === "string") setCsrfToken(data.csrfToken);

  clientPorts.clear();
  clientPorts.add(port);
  port.onmessage = async (e: MessageEvent) => {
    const msg = e.data;
    if (msg?.type !== "action") return;
    if (typeof msg.csrfToken === "string") setCsrfToken(msg.csrfToken);
    const id = msg.id as string | undefined;
    const action = msg.action;

    if (action.kind === "messages.send") {
      let responded = false;
      const maybeRespond = (
        opts: { result?: unknown } | { error: { code: string; message: string } }
      ) => {
        if (id == null || responded) return;
        responded = true;
        if ("error" in opts) {
          broadcast({
            type: "change",
            changes: [{ kind: "response", payload: { id, error: opts.error } }],
          });
        } else {
          broadcast({
            type: "change",
            changes: [{ kind: "response", payload: { id, result: opts.result } }],
          });
        }
      };
      runMessagesSend(
        action.payload.threadId,
        action.payload.content,
        action.payload.modelId,
        modelState,
        applyAndBroadcast,
        (mid, ctrl) => { streamAbortControllers.set(mid, ctrl); },
        (mid) => { streamAbortControllers.delete(mid); },
        () => maybeRespond({ result: undefined })
      ).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        maybeRespond({ error: { code: "ERROR", message } });
      });
      return;
    }

    if (action.kind === "stream.cancel") {
      const stream = modelState.streamByMessageId[action.payload.messageId];
      await runStreamCancel(
        action.payload.messageId,
        stream?.threadId ?? "",
        (mid) => streamAbortControllers.get(mid),
        applyAndBroadcast
      );
      if (id != null) broadcast({ type: "change", changes: [{ kind: "response", payload: { id, result: undefined } }] });
      return;
    }

    try {
      const changes = await handleAction(action, modelState);
      for (const change of changes) {
        modelState = await applyChange(modelState, change);
      }
      if (changes.length) broadcast({ type: "change", changes });
      if (id != null) {
        broadcast({ type: "change", changes: [{ kind: "response", payload: { id, result: undefined } }] });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (id != null) {
        broadcast({
          type: "change",
          changes: [{ kind: "response", payload: { id, error: { code: "ERROR", message } } }],
        });
      }
    }
  };
});
