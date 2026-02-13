# @casfa/port-rpc

Type-safe request/response RPC over `MessagePort` with timeout, automatic `Transferable` extraction, and namespace proxying.

Designed for **Main Thread ↔ Service Worker** communication but works with any `MessagePort`-based channel (Worker, iframe, etc.).

## Features

- **Request/response matching** — auto-incrementing `id` with pending-map resolution
- **Timeout** — configurable per-client, defaults to 30 s
- **Transferable auto-extraction** — `ArrayBuffer` / `Uint8Array` args are automatically transferred (zero-copy)
- **Namespace proxy** — `Proxy`-based method routing for typed remote APIs
- **Handler utilities** — `respond()`, `respondError()`, `dispatchNamespaceRPC()` for the receiver side
- **Zero dependencies** — pure TypeScript, no runtime deps

## Usage

### Caller side (main thread)

```ts
import { createRPC, createNamespaceProxy } from "@casfa/port-rpc";

const { port1, port2 } = new MessageChannel();
port1.start();

// Send port2 to the service worker
sw.postMessage({ type: "connect" }, [port2]);

const rpc = createRPC(port1, { timeoutMs: 10_000 });

// Type-safe namespace proxy
type MathService = {
  add(a: number, b: number): Promise<number>;
  multiply(a: number, b: number): Promise<number>;
};

const math = createNamespaceProxy<MathService>(rpc, "math");
const sum = await math.add(1, 2); // → 3
```

### Handler side (service worker)

```ts
import { respond, respondError, dispatchNamespaceRPC } from "@casfa/port-rpc";

const mathService = {
  add: (a: number, b: number) => a + b,
  multiply: (a: number, b: number) => a * b,
};

port.onmessage = async (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "rpc":
      await dispatchNamespaceRPC({
        target: mathService,
        method: msg.method,
        args: msg.args,
        port,
        id: msg.id,
      });
      break;
    case "ping":
      respond(port, msg.id, "pong");
      break;
  }
};
```

## API

### `createRPC<TMsg>(port, options?)`

Create an RPC client. Returns `RPCFn<TMsg>` — a function that sends a message and returns a `Promise<unknown>`.

### `createNamespaceProxy<T>(rpc, namespace)`

Create a `Proxy` that routes method calls through RPC as `{ type: "rpc", target, method, args }` messages.

### `respond(port, id, result, transfers?)`

Send a successful RPC response.

### `respondError(port, id, code, err)`

Send an error RPC response.

### `dispatchNamespaceRPC(opts)`

Invoke `target[method](...args)`, await the result, and send the response. Auto-extracts `Transferable` buffers from `{ ok: true, data: Uint8Array }` result patterns.

### `extractTransferables(args)`

Extract `ArrayBuffer` / `Uint8Array.buffer` from an args array.

## Testing

```sh
bun test src/
```
