/**
 * @casfa/port-rpc — Wire protocol types
 *
 * Minimal, generic types for request/response RPC over MessagePort.
 * Business-specific message types should extend these.
 *
 * @packageDocumentation
 */

// ============================================================================
// Response envelope
// ============================================================================

/**
 * Generic RPC response. Sent back from handler → caller via MessagePort.
 * Matched by `id`. Carries either `result` or `error`, never both.
 */
export type RPCResponse<T = unknown> = {
  type: "rpc-response";
  id: number;
  result?: T;
  error?: RPCError;
};

/** Structured error payload. */
export type RPCError = {
  code: string;
  message: string;
};

// ============================================================================
// Request envelope
// ============================================================================

/**
 * Base constraint for any message that can be sent via `rpc()`.
 * Must have a `type` string discriminator. The `id` field is
 * injected automatically by the RPC client and stripped from the
 * caller-facing type.
 */
export type RPCMessage = {
  type: string;
  [key: string]: unknown;
};

/**
 * A generic namespace-method RPC request.
 * `createNamespaceProxy` produces messages of this shape.
 */
export type NamespaceRPCRequest = {
  type: "rpc";
  target: string;
  method: string;
  args: unknown[];
};
