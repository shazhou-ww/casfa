import { createApp } from "./app.ts";

const port = Number(process.env.PORT) || 8802;
const config = { port, storage: { type: "memory" as const }, auth: {} };
const app = createApp(config);
Bun.serve({ port, fetch: app.fetch });
