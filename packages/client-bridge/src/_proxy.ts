/**
 * @casfa/client-bridge — namespace proxy
 *
 * Creates Proxy objects that route all method calls through RPC.
 * Used to build CasfaClient namespace objects (oauth, tokens, etc.)
 * that transparently invoke SW-side implementations.
 *
 * Internal module.
 */

import type { RPCFn } from "./_rpc.ts";

/**
 * Create a Proxy for a CasfaClient namespace (e.g. "oauth", "nodes").
 *
 * Every property access returns a function that sends an RPC request
 * with `target = namespace` and `method = property name`.
 *
 * @example
 *   const oauth = createNamespaceProxy<OAuthMethods>(rpc, "oauth");
 *   await oauth.getConfig();
 *   // → rpc({ type: "rpc", target: "oauth", method: "getConfig", args: [] })
 */
export function createNamespaceProxy<T extends object>(
  rpc: RPCFn,
  namespace: string,
): T {
  return new Proxy({} as T, {
    get(_, method: string) {
      return (...args: unknown[]) =>
        rpc({ type: "rpc", target: namespace, method, args });
    },
  });
}
