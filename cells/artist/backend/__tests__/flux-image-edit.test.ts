import { afterEach, describe, expect, it } from "bun:test";
import { handleFluxImageEdit } from "../index";

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

describe("handleFluxImageEdit", () => {
  it("calls BFL kontext and writes result to outputPath", async () => {
    process.env.BFL_API_KEY = "test-key";
    const calls: Array<{ url: string; method: string; bodyText?: string }> = [];
    globalThis.setTimeout = ((cb: (...args: unknown[]) => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      let bodyText: string | undefined;
      if (typeof init?.body === "string") bodyText = init.body;
      calls.push({ url, method, bodyText });

      if (url.endsWith("/branches/me/restricted-file-access")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.endsWith("/v1/flux-kontext-pro")) {
        return Response.json({ polling_url: "https://bfl.test/poll/1" });
      }
      if (url === "https://bfl.test/poll/1") {
        return Response.json({ status: "Ready", result: { sample: "https://img.test/out.png" } });
      }
      if (url === "https://img.test/out.png") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      if (
        url ===
          "http://localhost:7100/drive/branch/b1/v1/files/inputs/source%20image.png" &&
        method === "GET"
      ) {
        return new Response(new Uint8Array([9, 8, 7]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      if (url.endsWith("/api/realm/me/files/outputs%2Fedited.png") && method === "PUT") {
        return Response.json({ path: "outputs/edited.png", key: "cas:key:new" }, { status: 201 });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const result = await handleFluxImageEdit({
      casfaBranchUrl: "http://localhost:7100/drive/branch/b1/v1",
      inputImagePath: "inputs/source image.png",
      outputPath: "outputs/edited.png",
      prompt: "make it watercolor style",
      output_format: "png",
    });

    expect(result).toEqual({
      key: "cas:key:new",
    });

    const kontextCall = calls.find(
      (call) => call.url.endsWith("/v1/flux-kontext-pro") && call.method === "POST"
    );
    expect(kontextCall).toBeDefined();
    const kontextPayload = JSON.parse(kontextCall!.bodyText ?? "{}") as { input_image?: string };
    expect(kontextPayload.input_image).toBe(
      "http://localhost:7100/drive/branch/b1/v1/files/inputs/source%20image.png"
    );
  });

  it("fails fast when input image preflight is unauthorized", async () => {
    process.env.BFL_API_KEY = "test-key";
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.endsWith("/branches/me/restricted-file-access")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url === "http://localhost:7100/drive/branch/b1/v1/files/inputs/source%20image.png") {
        return Response.json(
          { error: "UNAUTHORIZED", message: "Invalid or expired branch access" },
          { status: 401 }
        );
      }
      if (url.endsWith("/v1/flux-kontext-pro")) {
        return Response.json({ polling_url: "https://bfl.test/poll/1" });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    await expect(
      handleFluxImageEdit({
        casfaBranchUrl: "http://localhost:7100/drive/branch/b1/v1",
        inputImagePath: "inputs/source image.png",
        outputPath: "outputs/edited.png",
        prompt: "make it watercolor style",
        output_format: "png",
      })
    ).rejects.toThrow("inputImageUrl preflight failed 401");

    const kontextCall = calls.find((call) => call.url.endsWith("/v1/flux-kontext-pro"));
    expect(kontextCall).toBeUndefined();
  });
});
