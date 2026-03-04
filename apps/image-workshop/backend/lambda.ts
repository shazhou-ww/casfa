/**
 * AWS Lambda entry for Image Workshop MCP (Streamable HTTP).
 * Uses HTTP API with $default stage (no stage prefix stripping needed).
 */
import { handle } from "hono/aws-lambda";
import { app } from "./app";

export const handler = handle(app);
