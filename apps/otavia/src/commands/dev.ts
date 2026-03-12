import { resolve } from "node:path";
import { runGatewayDev } from "./dev/gateway.js";

const DEFAULT_PORT = 8900;

/**
 * Dev command: validate otavia.yaml, start gateway, keep process alive.
 * On SIGINT/SIGTERM stops the server.
 */
export async function devCommand(rootDir: string): Promise<void> {
  const root = resolve(rootDir);
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const server = await runGatewayDev(root, port);
  const cleanup = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  await new Promise(() => {});
}
