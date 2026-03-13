import { afterEach, describe, expect, test } from "bun:test";
import { send } from "./sw-protocol.ts";
import type { OutgoingMessage } from "./model-types.ts";

const originalDocument = (globalThis as { document?: unknown }).document;

afterEach(() => {
  (globalThis as { document?: unknown }).document = originalDocument;
});

describe("sw protocol csrf forwarding", () => {
  test("send forwards latest csrf token from cookie", () => {
    let cookie = "csrf_token=token_a";
    (globalThis as { document?: unknown }).document = {
      get cookie() {
        return cookie;
      },
    };

    let captured: unknown;
    const port = {
      postMessage(message: unknown) {
        captured = message;
      },
    } as unknown as MessagePort;

    const message: OutgoingMessage = {
      type: "action",
      action: { kind: "sync.pull", payload: { scope: "settings" } },
    };

    send(port, message);
    expect((captured as { csrfToken?: string }).csrfToken).toBe("token_a");

    cookie = "csrf_token=token_b";
    send(port, message);
    expect((captured as { csrfToken?: string }).csrfToken).toBe("token_b");
  });
});
