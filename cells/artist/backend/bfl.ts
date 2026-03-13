/**
 * BFL (Black Forest Labs) API client for FLUX text-to-image.
 * Uses async flow: POST → poll polling_url until Ready → download image from result URL.
 */
export type BflFluxOptions = {
  /** API key from BFL Dashboard (x-key header). */
  apiKey: string;
  /** Base URL, e.g. https://api.bfl.ai */
  baseUrl?: string;
  /** Model path, e.g. /v1/flux-2-pro (default flux-2-pro). */
  modelPath?: string;
};

export type BflGenerateParams = {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  safety_tolerance?: number;
  output_format?: "jpeg" | "png";
};

type BflSubmitResponse = {
  id?: string;
  polling_url: string;
  cost?: number;
  input_mp?: number;
  output_mp?: number;
};

type BflPollResponse = {
  status: "Pending" | "Ready" | "Failed";
  result?: { sample?: string };
  error?: string;
};

const DEFAULT_BASE = "https://api.bfl.ai";
const DEFAULT_MODEL = "/v1/flux-2-pro";

function getEnv(name: string): string | undefined {
  if (typeof Bun !== "undefined" && Bun.env) return Bun.env[name];
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

export function createBflClient(options?: Partial<BflFluxOptions>) {
  const apiKey = options?.apiKey ?? getEnv("BFL_API_KEY");
  const baseUrl = (options?.baseUrl ?? getEnv("BFL_BASE_URL") ?? DEFAULT_BASE).replace(/\/$/, "");
  const modelPath = options?.modelPath ?? DEFAULT_MODEL;
  const endpoint = `${baseUrl}${modelPath}`;

  return {
    /**
     * Generate image from text prompt: submit → poll until Ready → download image bytes.
     * Throws on missing API key or API/poll failure.
     */
    async generateImage(params: BflGenerateParams): Promise<Uint8Array> {
      if (!apiKey) {
        throw new Error("BFL_API_KEY is not set (env or options.apiKey)");
      }
      const body: Record<string, unknown> = {
        prompt: params.prompt,
        width: params.width ?? 1024,
        height: params.height ?? 1024,
      };
      if (params.seed !== undefined) body.seed = params.seed;
      if (params.safety_tolerance !== undefined) body.safety_tolerance = params.safety_tolerance;
      if (params.output_format) body.output_format = params.output_format;

      const submitRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          "x-key": apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!submitRes.ok) {
        const text = await submitRes.text();
        throw new Error(`BFL submit failed ${submitRes.status}: ${text}`);
      }
      const submitJson = (await submitRes.json()) as BflSubmitResponse;
      const pollingUrl = submitJson.polling_url;
      if (!pollingUrl) {
        throw new Error("BFL response missing polling_url");
      }

      let pollRes: BflPollResponse;
      let attempts = 0;
      const maxAttempts = 120;
      const intervalMs = 1000;
      do {
        await new Promise((r) => setTimeout(r, intervalMs));
        const poll = await fetch(pollingUrl, {
          method: "GET",
          headers: { accept: "application/json", "x-key": apiKey },
        });
        if (!poll.ok) {
          throw new Error(`BFL poll failed ${poll.status}: ${await poll.text()}`);
        }
        pollRes = (await poll.json()) as BflPollResponse;
        attempts++;
        if (pollRes.status === "Failed") {
          throw new Error(`BFL generation failed: ${pollRes.error ?? "unknown"}`);
        }
        if (pollRes.status === "Ready") break;
      } while (attempts < maxAttempts);

      if (pollRes.status !== "Ready" || !pollRes.result?.sample) {
        throw new Error("BFL generation did not complete with image URL");
      }
      const imageUrl = pollRes.result.sample;
      const imageRes = await fetch(imageUrl);
      if (!imageRes.ok) {
        throw new Error(`BFL image download failed ${imageRes.status}`);
      }
      const buf = await imageRes.arrayBuffer();
      return new Uint8Array(buf);
    },
  };
}

export type BflClient = ReturnType<typeof createBflClient>;
