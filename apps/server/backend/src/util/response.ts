/**
 * HTTP Response utilities
 */

import type { Context } from "hono";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};

/**
 * Create a JSON response with CORS headers
 */
export const jsonResponse = <T>(c: Context, status: number, body: T) => {
  return c.json(body, status as 200, CORS_HEADERS);
};

/**
 * Create an error response
 */
export const errorResponse = (c: Context, status: number, error: string, details?: unknown) => {
  return c.json({ error, details }, status as 400, CORS_HEADERS);
};

/**
 * Create a binary response
 */
export const binaryResponse = (
  c: Context,
  content: Uint8Array,
  contentType = "application/octet-stream",
  headers: Record<string, string> = {}
) => {
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(content.length),
      ...CORS_HEADERS,
      ...headers,
    },
  });
};

/**
 * CORS preflight response
 */
export const corsResponse = () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};
