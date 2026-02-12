/**
 * @casfa/client-bridge — RPC client
 *
 * Creates a stateful RPC function over a MessagePort. Matches responses
 * by auto-incrementing id. Handles timeout and automatic Transferable
 * extraction for Uint8Array / ArrayBuffer args.
 *
 * Internal module.
 */

import type { RPCCallable, RPCResponse } from "./_messages.ts";

/** Function type returned by createRPC. */
export type RPCFn = (msg: RPCCallable) => Promise<unknown>;

/**
 * Extract Transferable objects from RPC args.
 * After transfer, the source ArrayBuffer is detached (length → 0).
 */
function extractTransferables(args: unknown[]): Transferable[] {
  const transferables: Transferable[] = [];
  for (const arg of args) {
    if (arg instanceof ArrayBuffer) {
      transferables.push(arg);
    } else if (arg instanceof Uint8Array) {
      transferables.push(arg.buffer);
    }
  }
  return transferables;
}

/**
 * Create an RPC client over a MessagePort.
 *
 * Every message sent through the returned function gets a unique `id`.
 * The Promise resolves/rejects when a matching `rpc-response` arrives,
 * or rejects on timeout.
 */
export function createRPC(
  port: MessagePort,
  timeoutMs = 30_000,
): RPCFn {
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

  return function rpc(msg: RPCCallable): Promise<unknown> {
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
