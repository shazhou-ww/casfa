/**
 * AWS Lambda entry for SSO API. Normalizes path if API Gateway prepends stage.
 */
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { handle } from "hono/aws-lambda";

const config = loadConfig();
const app = createApp({ config });
// OAuth routes will be mounted in Task 5

const honoHandler = handle(app);

function normalizeEventPath(event: { rawPath?: string }): void {
  const raw = event.rawPath;
  if (!raw || !raw.startsWith("/")) return;
  const segments = raw.split("/").filter(Boolean);
  if (segments.length >= 2 && segments[0] !== "api" && segments[0] !== "oauth") {
    const second = segments[1];
    if (second === "api" || second === "oauth" || second === ".well-known") {
      (event as { rawPath: string }).rawPath = `/${segments.slice(1).join("/")}`;
    }
  }
}

export const handler = async (event: unknown, context: unknown) => {
  if (event && typeof event === "object" && "rawPath" in event) {
    normalizeEventPath(event as { rawPath: string });
  }
  return honoHandler(
    event as Parameters<typeof honoHandler>[0],
    context as Parameters<typeof honoHandler>[1]
  );
};
