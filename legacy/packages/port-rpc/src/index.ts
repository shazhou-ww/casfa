/**
 * @casfa/port-rpc
 *
 * Type-safe request/response RPC over MessagePort with timeout,
 * Transferable auto-extraction, and namespace proxying.
 *
 * Designed for Main Thread ↔ Service Worker communication but works
 * with any MessagePort-based channel (Worker, iframe, etc.).
 *
 * ## Caller side (main thread)
 *
 * ```ts
 * import { createRPC, createNamespaceProxy } from "@casfa/port-rpc";
 *
 * const rpc = createRPC(port);
 * const math = createNamespaceProxy<MathService>(rpc, "math");
 * const sum = await math.add(1, 2);
 * ```
 *
 * ## Handler side (service worker)
 *
 * ```ts
 * import { respond, respondError, dispatchNamespaceRPC } from "@casfa/port-rpc";
 *
 * port.onmessage = async (e) => {
 *   const msg = e.data;
 *   switch (msg.type) {
 *     case "rpc":
 *       await dispatchNamespaceRPC({
 *         target: services[msg.target],
 *         method: msg.method,
 *         args: msg.args,
 *         port, id: msg.id,
 *       });
 *       break;
 *     case "ping":
 *       respond(port, msg.id, "pong");
 *       break;
 *   }
 * };
 * ```
 *
 * @packageDocumentation
 */

export type { DispatchOptions } from "./handler.ts";
// ── Handler side ──
export {
  dispatchNamespaceRPC,
  respond,
  respondError,
} from "./handler.ts";

export { createNamespaceProxy } from "./proxy.ts";
export type { CreateRPCOptions, RPCFn } from "./rpc.ts";
// ── Caller side ──
export { createRPC, extractTransferables } from "./rpc.ts";

// ── Wire types ──
export type {
  NamespaceRPCRequest,
  RPCError,
  RPCMessage,
  RPCResponse,
} from "./types.ts";
