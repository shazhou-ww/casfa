/**
 * @casfa/port-rpc — Namespace proxy
 *
 * Creates Proxy objects that route all method calls through RPC.
 * Each property access returns a function that sends a generic
 * `{ type: "rpc", target, method, args }` message.
 *
 * Business-agnostic — works with any namespace/method combination.
 *
 * @packageDocumentation
 */

import type { RPCFn } from "./rpc.ts";

/**
 * Create a Proxy for a remote namespace.
 *
 * Every property access returns a function that sends an RPC request
 * with `target = namespace` and `method = property name`.
 *
 * @example
 * ```ts
 * type MathService = { add(a: number, b: number): Promise<number> };
 * const math = createNamespaceProxy<MathService>(rpc, "math");
 * const sum = await math.add(1, 2);
 * // → rpc({ type: "rpc", target: "math", method: "add", args: [1, 2] })
 * ```
 */
export function createNamespaceProxy<T extends object>(rpc: RPCFn, namespace: string): T {
  return new Proxy({} as T, {
    get(_, method: string) {
      return (...args: unknown[]) => rpc({ type: "rpc", target: namespace, method, args });
    },
  });
}
