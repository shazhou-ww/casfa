/**
 * Entry for cell dev: exports Hono app for Bun.serve.
 */
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const app = createApp({ config });

export { app };
