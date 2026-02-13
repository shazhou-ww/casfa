/**
 * Tests for @casfa/port-rpc
 *
 * Uses real MessageChannel (available in Bun) for full integration testing
 * of the RPC client, handler, and namespace proxy.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import {
  createRPC,
  createNamespaceProxy,
  respond,
  respondError,
  dispatchNamespaceRPC,
  extractTransferables,
} from "./index.ts";
import type { RPCFn, RPCResponse, NamespaceRPCRequest } from "./index.ts";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a linked pair: rpc client on port1, handler on port2.
 */
function createPair(timeoutMs = 1_000) {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const rpc = createRPC(port1, { timeoutMs });
  return { rpc, port1, port2 };
}

/**
 * Wire a simple echo handler on port2: responds with the received message.
 */
function echoHandler(port: MessagePort) {
  port.onmessage = (e) => {
    const msg = e.data;
    if (msg?.id != null) {
      respond(port, msg.id, { echo: msg });
    }
  };
}

/**
 * Wire a handler that dispatches namespace-method RPCs to a target object.
 */
function namespaceHandler(
  port: MessagePort,
  namespaces: Record<string, unknown>,
) {
  port.onmessage = async (e) => {
    const msg = e.data;
    if (msg?.type === "rpc" && msg.id != null) {
      const target = namespaces[msg.target];
      if (!target) {
        respondError(port, msg.id, "unknown_namespace", new Error(`Unknown namespace: ${msg.target}`));
        return;
      }
      await dispatchNamespaceRPC({
        target,
        method: msg.method,
        args: msg.args,
        port,
        id: msg.id,
      });
    }
  };
}

// ============================================================================
// extractTransferables
// ============================================================================

describe("extractTransferables", () => {
  it("should extract ArrayBuffer", () => {
    const buf = new ArrayBuffer(8);
    const result = extractTransferables([buf]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(buf);
  });

  it("should extract Uint8Array.buffer", () => {
    const arr = new Uint8Array([1, 2, 3]);
    const result = extractTransferables([arr]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(arr.buffer);
  });

  it("should skip non-transferable args", () => {
    const result = extractTransferables(["hello", 42, null, { a: 1 }]);
    expect(result).toHaveLength(0);
  });

  it("should extract multiple transferables from mixed args", () => {
    const buf = new ArrayBuffer(4);
    const arr = new Uint8Array([5, 6]);
    const result = extractTransferables(["prefix", buf, arr, 99]);
    expect(result).toHaveLength(2);
  });
});

// ============================================================================
// createRPC — basic request/response
// ============================================================================

describe("createRPC", () => {
  it("should send a message and receive a response", async () => {
    const { rpc, port2 } = createPair();
    echoHandler(port2);

    const result = await rpc({ type: "ping" });
    expect(result).toBeDefined();
    expect((result as any).echo.type).toBe("ping");
  });

  it("should match responses by id correctly", async () => {
    const { rpc, port2 } = createPair();

    // Respond with the `id` doubled as the result
    port2.onmessage = (e) => {
      const msg = e.data;
      if (msg?.id != null) {
        respond(port2, msg.id, msg.id * 10);
      }
    };

    // Send multiple concurrently
    const [r1, r2, r3] = await Promise.all([
      rpc({ type: "a" }),
      rpc({ type: "b" }),
      rpc({ type: "c" }),
    ]);

    // Each should get its own id * 10
    expect(r1).toBe(10);
    expect(r2).toBe(20);
    expect(r3).toBe(30);
  });

  it("should reject on timeout", async () => {
    const { rpc } = createPair(50); // 50ms timeout
    // No handler — will never respond

    await expect(rpc({ type: "void" })).rejects.toThrow("RPC timeout");
  });

  it("should reject when handler returns an error", async () => {
    const { rpc, port2 } = createPair();

    port2.onmessage = (e) => {
      const msg = e.data;
      if (msg?.id != null) {
        respondError(port2, msg.id, "test_error", new Error("Something went wrong"));
      }
    };

    await expect(rpc({ type: "fail" })).rejects.toThrow("Something went wrong");
  });

  it("should handle rapid sequential calls", async () => {
    const { rpc, port2 } = createPair();

    port2.onmessage = (e) => {
      const msg = e.data;
      if (msg?.id != null) {
        respond(port2, msg.id, msg.count);
      }
    };

    const results: unknown[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(await rpc({ type: "count", count: i }));
    }

    expect(results).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it("should transfer Uint8Array args efficiently", async () => {
    const { rpc, port2 } = createPair();

    let receivedData: Uint8Array | null = null;
    port2.onmessage = (e) => {
      const msg = e.data;
      if (msg?.id != null) {
        receivedData = msg.args?.[0];
        respond(port2, msg.id, "ok");
      }
    };

    const data = new Uint8Array([10, 20, 30, 40, 50]);
    await rpc({ type: "upload", args: [data] });

    expect(receivedData).toBeDefined();
    expect(new Uint8Array(receivedData!)).toEqual(new Uint8Array([10, 20, 30, 40, 50]));
  });

  it("should ignore non-rpc-response messages", async () => {
    const { rpc, port2 } = createPair();

    port2.onmessage = (e) => {
      const msg = e.data;
      if (msg?.id != null) {
        // Send a non-rpc message first, then the real response
        port2.postMessage({ type: "noise", data: "ignored" });
        respond(port2, msg.id, "real");
      }
    };

    const result = await rpc({ type: "test" });
    expect(result).toBe("real");
  });
});

// ============================================================================
// respond / respondError
// ============================================================================

describe("respond", () => {
  it("should send a well-formed rpc-response", async () => {
    const { port1, port2 } = new MessageChannel();
    port1.start();
    port2.start();

    const received = new Promise<RPCResponse>((resolve) => {
      port1.onmessage = (e) => resolve(e.data);
    });

    respond(port2, 42, { greeting: "hello" });

    const msg = await received;
    expect(msg.type).toBe("rpc-response");
    expect(msg.id).toBe(42);
    expect(msg.result).toEqual({ greeting: "hello" });
    expect(msg.error).toBeUndefined();
  });

  it("should send with transferables when provided", async () => {
    const { port1, port2 } = new MessageChannel();
    port1.start();
    port2.start();

    const received = new Promise<RPCResponse>((resolve) => {
      port1.onmessage = (e) => resolve(e.data);
    });

    const buf = new ArrayBuffer(8);
    respond(port2, 1, buf, [buf]);

    const msg = await received;
    expect(msg.type).toBe("rpc-response");
    expect(msg.result).toBeDefined();
  });
});

describe("respondError", () => {
  it("should send a well-formed error response", async () => {
    const { port1, port2 } = new MessageChannel();
    port1.start();
    port2.start();

    const received = new Promise<RPCResponse>((resolve) => {
      port1.onmessage = (e) => resolve(e.data);
    });

    respondError(port2, 7, "not_found", new Error("Resource not found"));

    const msg = await received;
    expect(msg.type).toBe("rpc-response");
    expect(msg.id).toBe(7);
    expect(msg.error).toEqual({
      code: "not_found",
      message: "Resource not found",
    });
    expect(msg.result).toBeUndefined();
  });

  it("should handle non-Error objects", async () => {
    const { port1, port2 } = new MessageChannel();
    port1.start();
    port2.start();

    const received = new Promise<RPCResponse>((resolve) => {
      port1.onmessage = (e) => resolve(e.data);
    });

    respondError(port2, 1, "string_err", "plain string error");

    const msg = await received;
    expect(msg.error?.message).toBe("plain string error");
  });
});

// ============================================================================
// createNamespaceProxy
// ============================================================================

describe("createNamespaceProxy", () => {
  it("should route method calls through RPC", async () => {
    const { rpc, port2 } = createPair();

    // Handler that responds with method + args
    port2.onmessage = (e) => {
      const msg = e.data;
      if (msg?.id != null && msg.type === "rpc") {
        respond(port2, msg.id, {
          target: msg.target,
          method: msg.method,
          args: msg.args,
        });
      }
    };

    type MathService = {
      add(a: number, b: number): Promise<{ target: string; method: string; args: number[] }>;
    };

    const math = createNamespaceProxy<MathService>(rpc, "math");
    const result = await math.add(3, 4);

    expect(result.target).toBe("math");
    expect(result.method).toBe("add");
    expect(result.args).toEqual([3, 4]);
  });

  it("should support multiple namespaces", async () => {
    const { rpc, port2 } = createPair();

    port2.onmessage = (e) => {
      const msg = e.data;
      if (msg?.id != null && msg.type === "rpc") {
        respond(port2, msg.id, `${msg.target}.${msg.method}`);
      }
    };

    type NS = { doStuff(): Promise<string> };
    const alpha = createNamespaceProxy<NS>(rpc, "alpha");
    const beta = createNamespaceProxy<NS>(rpc, "beta");

    const [a, b] = await Promise.all([alpha.doStuff(), beta.doStuff()]);

    expect(a).toBe("alpha.doStuff");
    expect(b).toBe("beta.doStuff");
  });

  it("should forward arguments correctly", async () => {
    const { rpc, port2 } = createPair();

    port2.onmessage = (e) => {
      const msg = e.data;
      if (msg?.id != null) {
        respond(port2, msg.id, msg.args);
      }
    };

    type Svc = {
      process(a: string, b: number, c: boolean): Promise<unknown[]>;
    };
    const svc = createNamespaceProxy<Svc>(rpc, "svc");
    const args = await svc.process("hello", 42, true);

    expect(args).toEqual(["hello", 42, true]);
  });
});

// ============================================================================
// dispatchNamespaceRPC
// ============================================================================

describe("dispatchNamespaceRPC", () => {
  it("should invoke method on target and respond", async () => {
    const { rpc, port2 } = createPair();

    const calculator = {
      add(a: number, b: number) {
        return a + b;
      },
    };

    namespaceHandler(port2, { calc: calculator });

    const math = createNamespaceProxy<typeof calculator>(rpc, "calc");
    const sum = await math.add(10, 20);

    expect(sum).toBe(30);
  });

  it("should handle async methods", async () => {
    const { rpc, port2 } = createPair();

    const service = {
      async fetch(url: string) {
        await new Promise((r) => setTimeout(r, 10));
        return { url, status: 200 };
      },
    };

    namespaceHandler(port2, { svc: service });

    const svc = createNamespaceProxy<typeof service>(rpc, "svc");
    const result = await svc.fetch("https://example.com");

    expect(result).toEqual({ url: "https://example.com", status: 200 });
  });

  it("should respond with error if method does not exist", async () => {
    const { rpc, port2 } = createPair();

    namespaceHandler(port2, { svc: {} });

    type Svc = { nonexistent(): Promise<void> };
    const svc = createNamespaceProxy<Svc>(rpc, "svc");

    await expect(svc.nonexistent()).rejects.toThrow("Not a function");
  });

  it("should respond with error if method throws", async () => {
    const { rpc, port2 } = createPair();

    const service = {
      fail() {
        throw new Error("Intentional failure");
      },
    };

    namespaceHandler(port2, { svc: service });

    const svc = createNamespaceProxy<typeof service>(rpc, "svc");
    await expect(svc.fail()).rejects.toThrow("Intentional failure");
  });

  it("should respond with error for unknown namespace", async () => {
    const { rpc, port2 } = createPair();
    namespaceHandler(port2, {});

    type Svc = { anything(): Promise<void> };
    const svc = createNamespaceProxy<Svc>(rpc, "missing");

    await expect(svc.anything()).rejects.toThrow("Unknown namespace");
  });

  it("should auto-transfer Uint8Array in { ok, data } result pattern", async () => {
    const { rpc, port2 } = createPair();

    const storage = {
      get(_key: string) {
        return { ok: true, data: new Uint8Array([1, 2, 3, 4]) };
      },
    };

    namespaceHandler(port2, { storage });

    const proxy = createNamespaceProxy<typeof storage>(rpc, "storage");
    const result = await proxy.get("key1");

    expect(result.ok).toBe(true);
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});

// ============================================================================
// End-to-end integration
// ============================================================================

describe("end-to-end", () => {
  it("should support a full multi-namespace service", async () => {
    const { rpc, port2 } = createPair();

    const users = {
      getById(id: string) {
        return { id, name: `User ${id}` };
      },
      list() {
        return [{ id: "1" }, { id: "2" }];
      },
    };

    const posts = {
      async create(title: string, body: string) {
        return { id: "post-1", title, body, createdAt: Date.now() };
      },
    };

    namespaceHandler(port2, { users, posts });

    const usersProxy = createNamespaceProxy<typeof users>(rpc, "users");
    const postsProxy = createNamespaceProxy<typeof posts>(rpc, "posts");

    const user = await usersProxy.getById("42");
    expect(user).toEqual({ id: "42", name: "User 42" });

    const list = await usersProxy.list();
    expect(list).toHaveLength(2);

    const post = await postsProxy.create("Hello", "World");
    expect(post.title).toBe("Hello");
    expect(post.body).toBe("World");
  });

  it("should handle concurrent calls across namespaces", async () => {
    const { rpc, port2 } = createPair();

    const alpha = {
      async slow() {
        await new Promise((r) => setTimeout(r, 50));
        return "alpha-done";
      },
    };

    const beta = {
      fast() {
        return "beta-done";
      },
    };

    namespaceHandler(port2, { alpha, beta });

    const aProxy = createNamespaceProxy<typeof alpha>(rpc, "alpha");
    const bProxy = createNamespaceProxy<typeof beta>(rpc, "beta");

    const [a, b] = await Promise.all([aProxy.slow(), bProxy.fast()]);

    expect(a).toBe("alpha-done");
    expect(b).toBe("beta-done");
  });

  it("should handle mixed success and error calls", async () => {
    const { rpc, port2 } = createPair();

    const svc = {
      ok() {
        return "success";
      },
      fail() {
        throw new Error("fail!");
      },
    };

    namespaceHandler(port2, { svc });

    const proxy = createNamespaceProxy<typeof svc>(rpc, "svc");

    const okResult = await proxy.ok();
    expect(okResult).toBe("success");

    await expect(proxy.fail()).rejects.toThrow("fail!");

    // Verify RPC still works after an error
    const okAgain = await proxy.ok();
    expect(okAgain).toBe("success");
  });

  it("should support custom message types alongside namespace RPC", async () => {
    const { rpc, port2 } = createPair();

    // Handler that supports both custom messages and namespace RPC
    port2.onmessage = async (e) => {
      const msg = e.data;
      if (!msg?.id) return;

      if (msg.type === "ping") {
        respond(port2, msg.id, "pong");
      } else if (msg.type === "rpc") {
        const target = { greet: (name: string) => `Hello, ${name}!` };
        await dispatchNamespaceRPC({
          target,
          method: msg.method,
          args: msg.args,
          port: port2,
          id: msg.id,
        });
      }
    };

    // Custom message
    const pong = await rpc({ type: "ping" });
    expect(pong).toBe("pong");

    // Namespace proxy
    type Greeter = { greet(name: string): Promise<string> };
    const greeter = createNamespaceProxy<Greeter>(rpc, "greeter");
    const greeting = await greeter.greet("World");
    expect(greeting).toBe("Hello, World!");
  });
});
