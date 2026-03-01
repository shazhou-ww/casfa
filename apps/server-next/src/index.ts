import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const app = createApp(config);
Bun.serve({ port: config.port, fetch: app.fetch });
