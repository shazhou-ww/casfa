import { resolve } from "node:path";
import { checkAwsCredentials } from "./aws-auth.js";
import { runGatewayDev } from "./dev/gateway.js";
import { startViteDev } from "./dev/vite-dev.js";
import { startTunnel } from "./dev/tunnel.js";

const DEFAULT_BACKEND_PORT = 8900;
const DEFAULT_VITE_PORT = 7100;

export function resolveDevPublicBaseUrl(options: {
  tunnelEnabled?: boolean;
  tunnelPublicBaseUrl?: string;
  gatewayOnly: boolean;
  vitePort: number;
}): string | undefined {
  if (options.tunnelEnabled) return options.tunnelPublicBaseUrl;
  if (options.gatewayOnly) return undefined;
  return `http://localhost:${options.vitePort}`;
}

/**
 * Dev command: validate otavia.yaml, start backend gateway, then Vite dev server.
 * When OTAVIA_DEV_GATEWAY_ONLY=1 (e.g. for e2e), only run gateway with PORT and optional
 * DYNAMODB_ENDPOINT/S3_ENDPOINT overrides; do not start Vite.
 * On SIGINT/SIGTERM stops and exits.
 */
export async function devCommand(
  rootDir: string,
  options?: { tunnel?: boolean; tunnelHost?: string; tunnelConfig?: string; tunnelProtocol?: string }
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
  const vitePort = parseInt(process.env.VITE_PORT ?? String(DEFAULT_VITE_PORT), 10);
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
      tunnelProtocol: options.tunnelProtocol,
    });
    publicBaseUrl = tunnelHandle.publicBaseUrl;
    console.log(`[tunnel] Started. Public base URL: ${publicBaseUrl}`);
  }

  const effectivePublicBaseUrl = resolveDevPublicBaseUrl({
    tunnelEnabled: options?.tunnel,
    tunnelPublicBaseUrl: publicBaseUrl,
    gatewayOnly,
    vitePort,
  });
  const server = await runGatewayDev(root, backendPort, overrides, { publicBaseUrl: effectivePublicBaseUrl });

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

  const viteHandle = await startViteDev(root, backendPort, vitePort, effectivePublicBaseUrl);

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
