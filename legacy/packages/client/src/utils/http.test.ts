/**
 * HTTP utilities tests.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  createErrorFromResponse,
  createNetworkError,
  fetchApi,
  fetchWithAuth,
  statusToErrorCode,
} from "./http.ts";

// Helper to create a mock fetch that satisfies the typeof fetch constraint
function mockFetch(fn: (...args: any[]) => any): typeof fetch {
  return mock(fn) as unknown as typeof fetch;
}

// ============================================================================
// statusToErrorCode Tests
// ============================================================================

describe("statusToErrorCode", () => {
  it("should return UNAUTHORIZED for 401", () => {
    expect(statusToErrorCode(401)).toBe("UNAUTHORIZED");
  });

  it("should return FORBIDDEN for 403", () => {
    expect(statusToErrorCode(403)).toBe("FORBIDDEN");
  });

  it("should return NOT_FOUND for 404", () => {
    expect(statusToErrorCode(404)).toBe("NOT_FOUND");
  });

  it("should return CONFLICT for 409", () => {
    expect(statusToErrorCode(409)).toBe("CONFLICT");
  });

  it("should return VALIDATION_ERROR for 400", () => {
    expect(statusToErrorCode(400)).toBe("VALIDATION_ERROR");
  });

  it("should return VALIDATION_ERROR for 422", () => {
    expect(statusToErrorCode(422)).toBe("VALIDATION_ERROR");
  });

  it("should return RATE_LIMITED for 429", () => {
    expect(statusToErrorCode(429)).toBe("RATE_LIMITED");
  });

  it("should return UNKNOWN for other status codes", () => {
    expect(statusToErrorCode(500)).toBe("UNKNOWN");
    expect(statusToErrorCode(502)).toBe("UNKNOWN");
    expect(statusToErrorCode(503)).toBe("UNKNOWN");
  });
});

// ============================================================================
// createErrorFromResponse Tests
// ============================================================================

describe("createErrorFromResponse", () => {
  it("should create error with correct code and status", async () => {
    const response = new Response(JSON.stringify({}), {
      status: 401,
      statusText: "Unauthorized",
    });

    const error = await createErrorFromResponse(response);

    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.status).toBe(401);
  });

  it("should extract message from JSON body", async () => {
    const response = new Response(JSON.stringify({ message: "Custom error message" }), {
      status: 400,
      statusText: "Bad Request",
    });

    const error = await createErrorFromResponse(response);

    expect(error.message).toBe("Custom error message");
  });

  it("should extract error field if message is not present", async () => {
    const response = new Response(JSON.stringify({ error: "Error from error field" }), {
      status: 400,
      statusText: "Bad Request",
    });

    const error = await createErrorFromResponse(response);

    expect(error.message).toBe("Error from error field");
  });

  it("should prefer message field over error when both present", async () => {
    const response = new Response(
      JSON.stringify({ message: "Message field", error: "Error field" }),
      {
        status: 400,
        statusText: "Bad Request",
      }
    );

    const error = await createErrorFromResponse(response);

    // message is preferred as it's more descriptive; error is often a code
    expect(error.message).toBe("Message field");
  });

  it("should use statusText when body is not JSON", async () => {
    const response = new Response("Not JSON", {
      status: 500,
      statusText: "Internal Server Error",
    });

    const error = await createErrorFromResponse(response);

    expect(error.message).toBe("Internal Server Error");
  });

  it("should include full body as details", async () => {
    const body = { message: "Error", extra: "data", code: "ERR001" };
    const response = new Response(JSON.stringify(body), {
      status: 400,
      statusText: "Bad Request",
    });

    const error = await createErrorFromResponse(response);

    expect(error.details).toEqual(body);
  });
});

// ============================================================================
// createNetworkError Tests
// ============================================================================

describe("createNetworkError", () => {
  it("should create error with NETWORK_ERROR code", () => {
    const error = createNetworkError(new Error("Connection failed"));

    expect(error.code).toBe("NETWORK_ERROR");
  });

  it("should use Error message", () => {
    const error = createNetworkError(new Error("Connection refused"));

    expect(error.message).toBe("Connection refused");
  });

  it("should handle non-Error objects", () => {
    const error = createNetworkError("string error");

    expect(error.message).toBe("Network request failed");
    expect(error.details).toBe("string error");
  });

  it("should include original error as details", () => {
    const originalError = new Error("Original");
    const error = createNetworkError(originalError);

    expect(error.details).toBe(originalError);
  });
});

// ============================================================================
// fetchApi Tests
// ============================================================================

describe("fetchApi", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should make GET request by default", async () => {
    let _capturedRequest: Request | undefined;
    globalThis.fetch = mockFetch(async (input: Request | URL) => {
      _capturedRequest = input as Request;
      return new Response(JSON.stringify({ data: "test" }), { status: 200 });
    });

    await fetchApi("https://api.example.com/data");

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("should return ok: true with data on success", async () => {
    globalThis.fetch = mockFetch(async () => {
      return new Response(JSON.stringify({ id: 1, name: "Test" }), { status: 200 });
    });

    const result = await fetchApi<{ id: number; name: string }>("https://api.example.com/data");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: 1, name: "Test" });
      expect(result.status).toBe(200);
    }
  });

  it("should return ok: false with error on failure", async () => {
    globalThis.fetch = mockFetch(async () => {
      return new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
        statusText: "Not Found",
      });
    });

    const result = await fetchApi("https://api.example.com/data");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.message).toBe("Not found");
    }
  });

  it("should handle network errors", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("Network failure");
    });

    const result = await fetchApi("https://api.example.com/data");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NETWORK_ERROR");
      expect(result.error.message).toBe("Network failure");
    }
  });

  it("should add Content-Type header for JSON body", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mockFetch(async (_, init) => {
      capturedInit = init as RequestInit;
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await fetchApi("https://api.example.com/data", {
      method: "POST",
      body: { test: "data" },
    });

    expect((capturedInit?.headers as Record<string, string>)?.["Content-Type"]).toBe(
      "application/json"
    );
  });

  it("should not override existing Content-Type header", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mockFetch(async (_, init) => {
      capturedInit = init as RequestInit;
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await fetchApi("https://api.example.com/data", {
      method: "POST",
      body: { test: "data" },
      headers: { "Content-Type": "text/plain" },
    });

    expect((capturedInit?.headers as Record<string, string>)?.["Content-Type"]).toBe("text/plain");
  });

  it("should stringify JSON body", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mockFetch(async (_, init) => {
      capturedInit = init as RequestInit;
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await fetchApi("https://api.example.com/data", {
      method: "POST",
      body: { key: "value" },
    });

    expect(capturedInit?.body).toBe('{"key":"value"}');
  });

  it("should handle blob response type", async () => {
    const blobContent = new Blob(["test content"], { type: "text/plain" });
    globalThis.fetch = mockFetch(async () => {
      return new Response(blobContent, { status: 200 });
    });

    const result = await fetchApi<Blob>("https://api.example.com/data", {
      responseType: "blob",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Blob);
    }
  });

  it("should handle text response type", async () => {
    globalThis.fetch = mockFetch(async () => {
      return new Response("plain text response", { status: 200 });
    });

    const result = await fetchApi<string>("https://api.example.com/data", {
      responseType: "text",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("plain text response");
    }
  });

  it("should handle none response type", async () => {
    globalThis.fetch = mockFetch(async () => {
      return new Response(null, { status: 204 });
    });

    const result = await fetchApi<void>("https://api.example.com/data", {
      responseType: "none",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeUndefined();
    }
  });

  it("should use correct HTTP methods", async () => {
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

    for (const method of methods) {
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = mockFetch(async (_, init) => {
        capturedInit = init as RequestInit;
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await fetchApi("https://api.example.com/data", { method });

      expect(capturedInit?.method).toBe(method);
    }
  });
});

// ============================================================================
// fetchWithAuth Tests
// ============================================================================

describe("fetchWithAuth", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should add Authorization header when authHeader is provided", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mockFetch(async (_, init) => {
      capturedInit = init as RequestInit;
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await fetchWithAuth("https://api.example.com/data", "Bearer test-token");

    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBe(
      "Bearer test-token"
    );
  });

  it("should not add Authorization header when authHeader is null", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mockFetch(async (_, init) => {
      capturedInit = init as RequestInit;
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await fetchWithAuth("https://api.example.com/data", null);

    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBeUndefined();
  });

  it("should merge auth header with other headers", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mockFetch(async (_, init) => {
      capturedInit = init as RequestInit;
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await fetchWithAuth("https://api.example.com/data", "Bearer token", {
      headers: { "X-Custom": "header" },
    });

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe("Bearer token");
    expect(headers?.["X-Custom"]).toBe("header");
  });

  it("should pass other options through to fetchApi", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mockFetch(async (_, init) => {
      capturedInit = init as RequestInit;
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await fetchWithAuth("https://api.example.com/data", "Bearer token", {
      method: "POST",
      body: { data: "test" },
    });

    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBe('{"data":"test"}');
  });
});
