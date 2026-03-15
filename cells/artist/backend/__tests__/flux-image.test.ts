import { afterEach, describe, expect, it } from "bun:test";
import { handleFluxImage } from "../index";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalBflApiKey = process.env.BFL_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  if (originalBflApiKey === undefined) {
    delete process.env.BFL_API_KEY;
  } else {
    process.env.BFL_API_KEY = originalBflApiKey;
  }
});

describe("handleFluxImage", () => {
  it("calls BFL generate and writes result to outputPath", async () => {
    process.env.BFL_API_KEY = "test-key";
    globalThis.setTimeout = ((cb: (...args: unknown[]) => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/v1/flux-2-pro")) {
        return Response.json({ polling_url: "https://bfl.test/poll/2" });
      }
      if (url === "https://bfl.test/poll/2") {
        return Response.json({ status: "Ready", result: { sample: "https://img.test/generated.jpg" } });
      }
      if (url === "https://img.test/generated.jpg") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      if (url.endsWith("/api/realm/me/files/images%2Fgenerated.jpg") && method === "PUT") {
        return Response.json({ path: "images/generated.jpg", key: "cas:key:generated" }, { status: 201 });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const result = await handleFluxImage({
      casfaBranchUrl: "http://localhost:7100/drive/branch/b1/v1",
      outputPath: "images/generated.jpg",
      prompt: "a cute dog cartoon",
      output_format: "jpeg",
    });

    expect(result).toEqual({
      key: "cas:key:generated",
    });
  });
});
