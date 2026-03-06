/**
 * Entry for cell dev: exports Hono app. Same bootstrap as lambda.ts minus Lambda handler.
 */
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const app = createApp({ config });

export { app };
