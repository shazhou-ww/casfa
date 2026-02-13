/**
 * @casfa/port-rpc — RPC handler (receiver side)
 *
 * Utilities for building a message handler on the receiving end
 * (e.g. in a Service Worker). Provides response helpers and a
 * generic namespace dispatch function.
 *
 * Business-agnostic — the caller defines their own message types
 * and routing logic; this module provides the plumbing.
 *
 * @packageDocumentation
 */

import { extractTransferables } from "./rpc.ts";
import type { RPCError, RPCResponse } from "./types.ts";

// ============================================================================
// Response helpers
// ============================================================================

/**
 * Send a successful RPC response.
 *
 * @param port     MessagePort to respond on
 * @param id       Request id to match
 * @param result   Serializable result payload
 * @param transfers Optional Transferable list for zero-copy
 */
export function respond(
  port: MessagePort,
  id: number,
  result: unknown,
  transfers?: Transferable[],
): void {
  const msg: RPCResponse = { type: "rpc-response", id, result };
  if (transfers && transfers.length > 0) {
    port.postMessage(msg, transfers);
  } else {
    port.postMessage(msg);
  }
}

/**
 * Send an error RPC response.
 *
 * @param port MessagePort to respond on
 * @param id   Request id to match
 * @param code Machine-readable error code
 * @param err  Error (or anything with a `.message`)
 */
export function respondError(
  port: MessagePort,
  id: number,
  code: string,
  err: unknown,
): void {
  const error: RPCError = {
    code,
    message: err instanceof Error ? err.message : String(err),
  };
  const msg: RPCResponse = { type: "rpc-response", id, error };
  port.postMessage(msg);
}

// ============================================================================
// Namespace dispatch
// ============================================================================

/** Options for dispatchNamespaceRPC. */
export type DispatchOptions = {
  /** The target object that owns the method. */
  target: unknown;
  /** Method name to invoke. */
  method: string;
  /** Arguments to pass to the method. */
  args: unknown[];
  /** MessagePort to respond on. */
  port: MessagePort;
  /** Request id. */
  id: number;
  /**
   * Optional: extract Transferable objects from the result.
   * Receives the method return value; should return a list of Transferable.
   * Default: auto-detect Uint8Array `.buffer` in `result.data`.
   */
  extractResultTransferables?: (result: unknown) => Transferable[];
};

/**
 * Default result Transferable extractor.
 * Detects `{ ok: true, data: Uint8Array }` result pattern.
 */
function defaultExtractResultTransferables(result: unknown): Transferable[] {
  if (
    result &&
    typeof result === "object" &&
    "ok" in result &&
    (result as Record<string, unknown>).ok &&
    "data" in result &&
    (result as Record<string, unknown>).data instanceof Uint8Array
  ) {
    return [
      ((result as Record<string, unknown>).data as Uint8Array)
        .buffer as ArrayBuffer,
    ];
  }
  return [];
}

/**
 * Dispatch a namespace-method RPC call.
 *
 * Invokes `target[method](...args)`, awaits the result, and responds
 * on `port` with the matched `id`. Automatically extracts Transferable
 * buffers from the result for zero-copy transfer.
 *
 * @example
 * ```ts
 * // In a message handler:
 * case "rpc": {
 *   const target = getNamespace(msg.target);
 *   await dispatchNamespaceRPC({
 *     target, method: msg.method, args: msg.args,
 *     port, id: msg.id,
 *   });
 *   break;
 * }
 * ```
 */
export async function dispatchNamespaceRPC(
  opts: DispatchOptions,
): Promise<void> {
  const {
    target,
    method,
    args,
    port,
    id,
    extractResultTransferables = defaultExtractResultTransferables,
  } = opts;

  try {
    const obj = target as Record<string, unknown>;
    const fn = obj[method];

    if (typeof fn !== "function") {
      throw new Error(`Not a function: ${method}`);
    }

    const result = await (fn as Function).apply(target, args);
    const transferables = extractResultTransferables(result);
    respond(port, id, result, transferables);
  } catch (err) {
    respondError(port, id, "rpc_error", err);
  }
}
