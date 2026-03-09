/**
 * Client-side protocol to connect to the Agent Service Worker and send Actions / receive Changes.
 * Wire format: OutgoingMessage (action) → SW; IncomingMessage (changes) ← SW.
 */
import type { OutgoingMessage, IncomingMessage } from "./model-types.ts";

const SW_CONNECT_TYPE = "AGENT_SW_PORT";

/** Read CSRF token from cookie so the SW can send it with mutating requests. */
export function getCsrfTokenFromCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(/csrf_token=([^;]+)/);
  return m ? decodeURIComponent(m[1].trim()) : undefined;
}

function getController(): Promise<ServiceWorker> {
  return navigator.serviceWorker.ready.then(() => {
    if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
    return new Promise<ServiceWorker>((resolve) => {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => resolve(navigator.serviceWorker.controller!),
        { once: true }
      );
    });
  });
}

/**
 * Establish a MessagePort connection to the Service Worker.
 * Pass csrfToken (e.g. from getCsrfTokenFromCookie()) so the SW can call the API with CSRF header.
 */
export function connectToSW(csrfToken?: string): Promise<MessagePort> {
  return getController().then((controller) => {
    const channel = new MessageChannel();
    controller.postMessage({ type: SW_CONNECT_TYPE, csrfToken }, [channel.port2]);
    return channel.port1;
  });
}

/**
 * Send an action to the SW over the given port.
 */
export function send(port: MessagePort, message: OutgoingMessage): void {
  port.postMessage(message);
}

/**
 * Subscribe to changes broadcast by the SW via BroadcastChannel (more reliable than MessagePort in some environments).
 */
const BROADCAST_CHANNEL_NAME = "agent-sw-changes";

export function subscribeToChangeBroadcast(onMessage: (msg: IncomingMessage) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  const handler = (event: MessageEvent) => {
    const data = event.data;
    if (data && typeof data === "object" && data.type === "change" && Array.isArray(data.changes)) {
      onMessage(data as IncomingMessage);
    }
  };
  channel.addEventListener("message", handler);
  return () => channel.close();
}
