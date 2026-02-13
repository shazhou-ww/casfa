/**
 * @casfa/port-rpc — RPC client
 *
 * Creates a stateful RPC function over a MessagePort. Matches responses
 * by auto-incrementing `id`. Handles timeout and automatic Transferable
 * extraction for Uint8Array / ArrayBuffer args.
 *
 * Business-agnostic — works with any message type that has a `type` field.
 *
 * @packageDocumentation
 */

import type { RPCMessage, RPCResponse } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * A function that sends an RPC message over a MessagePort and returns
 * a Promise that resolves with the response result.
 *
 * The message is augmented with a unique `id` before sending.
 * A matching `rpc-response` with the same `id` resolves the Promise.
 */
export type RPCFn<TMsg extends RPCMessage = RPCMessage> = (
  msg: TMsg,
) => Promise<unknown>;

/** Options for createRPC. */
export type CreateRPCOptions = {
  /** Timeout in milliseconds. Default: 30_000 (30s). */
  timeoutMs?: number;
};

// ============================================================================
// Transferable extraction
// ============================================================================

/**
 * Extract Transferable objects from RPC args.
 * After transfer, the source ArrayBuffer is detached (length → 0).
 */
export function extractTransferables(args: unknown[]): Transferable[] {
  const transferables: Transferable[] = [];
  for (const arg of args) {
    if (arg instanceof ArrayBuffer) {
      transferables.push(arg);
    } else if (arg instanceof Uint8Array) {
      transferables.push(arg.buffer as ArrayBuffer);
    }
  }
  return transferables;
}

// ============================================================================
// RPC client factory
// ============================================================================

/**
 * Create an RPC client over a MessagePort.
 *
 * Every message sent through the returned function gets a unique `id`.
 * The Promise resolves/rejects when a matching `rpc-response` arrives,
 * or rejects on timeout.
 *
 * @example
 * ```ts
 * const port = channel.port1;
 * port.start();
 * const rpc = createRPC(port);
 *
 * const result = await rpc({ type: "greet", name: "world" });
 * ```
 */
export function createRPC<TMsg extends RPCMessage = RPCMessage>(
  port: MessagePort,
  options: CreateRPCOptions = {},
): RPCFn<TMsg> {
  const { timeoutMs = 30_000 } = options;

  let nextId = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  port.addEventListener("message", (e: MessageEvent) => {
    const data = e.data as RPCResponse | undefined;
    if (data?.type !== "rpc-response") return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.error) {
      entry.reject(new Error(data.error.message));
    } else {
      entry.resolve(data.result);
    }
  });

  return function rpc(msg: TMsg): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC timeout (${timeoutMs}ms): ${msg.type}`));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timer });

      const transferables =
        "args" in msg && Array.isArray(msg.args)
          ? extractTransferables(msg.args)
          : [];

      port.postMessage({ ...msg, id }, transferables);
    });
  };
}
