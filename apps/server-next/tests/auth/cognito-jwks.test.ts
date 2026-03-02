/**
 * Cognito JWKS verifier: empty token rejects; JWKS fetch 404 leads to reject.
 */
import { describe, expect, it, mock } from "bun:test";
import { createCognitoJwtVerifier } from "../../backend/auth/cognito-jwks.ts";

describe("createCognitoJwtVerifier", () => {
  it("rejects empty token", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(JSON.stringify({ keys: [] }), { status: 200 })));
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    const verifier = createCognitoJwtVerifier({
      region: "us-east-1",
      userPoolId: "us-east-1_abc",
    });
    await expect(verifier("")).rejects.toThrow();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  it("rejects when JWKS URL returns 404", async () => {
    const fetchMock = mock((url: string) =>
      Promise.resolve(new Response("Not Found", { status: 404 }))
    );
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    const verifier = createCognitoJwtVerifier({
      region: "us-east-1",
      userPoolId: "us-east-1_abc",
    });
    await expect(verifier("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.sig")).rejects.toThrow();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });
});
