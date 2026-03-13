import { resolve } from "node:path";
import { checkAwsCredentials } from "./aws-auth.js";
import { runGatewayDev } from "./dev/gateway.js";
import { startViteDev } from "./dev/vite-dev.js";
import { startTunnel } from "./dev/tunnel.js";

const DEFAULT_BACKEND_PORT = 8900;
const DEFAULT_VITE_PORT = 7100;

/**
 * Dev command: validate otavia.yaml, start backend gateway, then Vite dev server.
 * When OTAVIA_DEV_GATEWAY_ONLY=1 (e.g. for e2e), only run gateway with PORT and optional
 * DYNAMODB_ENDPOINT/S3_ENDPOINT overrides; do not start Vite.
 * On SIGINT/SIGTERM stops and exits.
 */
export async function devCommand(
  rootDir: string,
  options?: { tunnel?: boolean; tunnelHost?: string; tunnelConfig?: string }
): Promise<void> {
  const root = resolve(rootDir);
  const aws = await checkAwsCredentials(root);
  if (!aws.ok) {
    console.error(
      `AWS credentials are invalid or expired for profile "${aws.profile}".`
    );
    console.error("Run: bun run otavia aws login");
    process.exit(1);
  }
  const backendPort = parseInt(process.env.PORT ?? String(DEFAULT_BACKEND_PORT), 10);
  const gatewayOnly = process.env.OTAVIA_DEV_GATEWAY_ONLY === "1";
  const overrides: { dynamoEndpoint?: string; s3Endpoint?: string } | undefined = gatewayOnly
    ? (process.env.DYNAMODB_ENDPOINT || process.env.S3_ENDPOINT
        ? {
            dynamoEndpoint: process.env.DYNAMODB_ENDPOINT,
            s3Endpoint: process.env.S3_ENDPOINT,
          }
        : undefined)
    : undefined;

  let tunnelHandle: { publicBaseUrl: string; stop: () => void } | undefined;
  let publicBaseUrl: string | undefined;
  if (options?.tunnel) {
    tunnelHandle = await startTunnel(root, {
      tunnelConfigPath: options.tunnelConfig,
      tunnelHost: options.tunnelHost,
    });
    publicBaseUrl = tunnelHandle.publicBaseUrl;
    console.log(`[tunnel] Started. Public base URL: ${publicBaseUrl}`);
  }

  const server = await runGatewayDev(root, backendPort, overrides, { publicBaseUrl });

  if (gatewayOnly) {
    process.on("SIGINT", () => {
      tunnelHandle?.stop();
      server.stop();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      tunnelHandle?.stop();
      server.stop();
      process.exit(0);
    });
    await new Promise(() => {});
  }

  const vitePort = parseInt(process.env.VITE_PORT ?? String(DEFAULT_VITE_PORT), 10);
  const viteHandle = await startViteDev(root, backendPort, vitePort, publicBaseUrl);

  const cleanup = () => {
    tunnelHandle?.stop();
    server.stop();
    viteHandle.stop();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  await new Promise(() => {});
}
