import { app } from "../backend/dev-app";

const port = parseInt(process.env.PORT || "7101", 10);
console.log(`Listening on http://localhost:${port}`);
Bun.serve({ port, fetch: app.fetch });
