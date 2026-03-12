import { resolve } from "node:path";
import { runGatewayDev } from "./dev/gateway.js";
import { startViteDev } from "./dev/vite-dev.js";

const DEFAULT_BACKEND_PORT = 8900;
const DEFAULT_VITE_PORT = 7100;

/**
 * Dev command: validate otavia.yaml, start backend gateway, then Vite dev server.
 * On SIGINT/SIGTERM stops both and exits.
 */
export async function devCommand(rootDir: string): Promise<void> {
  const root = resolve(rootDir);
  const backendPort = parseInt(process.env.PORT ?? String(DEFAULT_BACKEND_PORT), 10);
  const vitePort = parseInt(process.env.VITE_PORT ?? String(DEFAULT_VITE_PORT), 10);

  const server = await runGatewayDev(root, backendPort);
  const viteHandle = await startViteDev(root, backendPort, vitePort);

  const cleanup = () => {
    server.stop();
    viteHandle.stop();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  await new Promise(() => {});
}
