/**
 * Local HTTP server (bun run backend/index.ts or cell dev uses dev-app.ts).
 */
import { app } from "./dev-app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
Bun.serve({ port: config.port, fetch: app.fetch });
