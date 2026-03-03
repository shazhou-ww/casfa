/**
 * AWS Lambda entry for Image Workshop MCP (Streamable HTTP).
 * Strips leading /{stage}/ from path when present (serverless-offline / API Gateway).
 */
import { handle } from "hono/aws-lambda";
import { app } from "./app";

function normalizeEventPath(event: { rawPath?: string }): void {
  const raw = event.rawPath;
  if (!raw || !raw.startsWith("/")) return;
  const segments = raw.split("/").filter(Boolean);
  if (segments.length >= 2 && segments[0] !== "api" && segments[1] !== "mcp") {
    (event as { rawPath: string }).rawPath = "/" + segments.slice(1).join("/");
  }
}

const honoHandler = handle(app);

export const handler = async (event: unknown, context: unknown) => {
  if (event && typeof event === "object" && "rawPath" in event) {
    normalizeEventPath(event as { rawPath: string });
  }
  return honoHandler(event as Parameters<typeof honoHandler>[0], context as Parameters<typeof honoHandler>[1]);
};
