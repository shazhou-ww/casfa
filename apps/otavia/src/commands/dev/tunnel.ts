import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import concurrently from "concurrently";
import { parse as parseYaml } from "yaml";

type TunnelConfig = {
  ingress?: Array<{ hostname?: string }>;
};

export type TunnelHandle = {
  publicBaseUrl: string;
  stop: () => void;
};

const TUNNEL_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
type TunnelLogLevel = (typeof TUNNEL_LOG_LEVELS)[number];
const DEFAULT_TUNNEL_LOG_LEVEL: TunnelLogLevel = "warn";
const TUNNEL_PROTOCOLS = ["auto", "quic", "http2"] as const;
type TunnelProtocol = (typeof TUNNEL_PROTOCOLS)[number];
const DEFAULT_TUNNEL_PROTOCOL: TunnelProtocol = "quic";

export function extractTunnelHostFromConfig(configContent: string): string | null {
  const parsed = parseYaml(configContent) as TunnelConfig | null;
  const ingress = parsed?.ingress;
  if (!Array.isArray(ingress)) return null;
  for (const rule of ingress) {
    const host = rule?.hostname?.trim();
    if (!host) continue;
    if (host.startsWith("*.")) continue;
    return host;
  }
  return null;
}

export function normalizeTunnelPublicBaseUrl(hostOrUrl: string): string {
  const trimmed = hostOrUrl.trim().replace(/\/$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function defaultTunnelConfigPath(rootDir: string): string {
  const fromEnv = process.env.OTAVIA_TUNNEL_CONFIG?.trim();
  if (fromEnv) return fromEnv;
  const projectPath = resolve(rootDir, ".otavia", "tunnel", "config.yml");
  if (existsSync(projectPath)) return projectPath;
  const globalConfig = resolve(homedir(), ".config", "otavia", "config.yml");
  if (existsSync(globalConfig)) return globalConfig;
  const legacyGlobalConfig = resolve(homedir(), ".config", "otavia", "tunnel.yaml");
  return legacyGlobalConfig;
}

export function resolveTunnelLogLevel(level?: string): TunnelLogLevel {
  const normalized = (level ?? process.env.OTAVIA_TUNNEL_LOG_LEVEL ?? DEFAULT_TUNNEL_LOG_LEVEL)
    .trim()
    .toLowerCase();
  if (TUNNEL_LOG_LEVELS.includes(normalized as TunnelLogLevel)) {
    return normalized as TunnelLogLevel;
  }
  throw new Error(
    `Invalid tunnel log level "${normalized}". Expected one of: ${TUNNEL_LOG_LEVELS.join(", ")}.`
  );
}

export function resolveTunnelProtocol(protocol?: string): TunnelProtocol {
  const normalized = (protocol ?? process.env.OTAVIA_TUNNEL_PROTOCOL ?? DEFAULT_TUNNEL_PROTOCOL)
    .trim()
    .toLowerCase();
  if (TUNNEL_PROTOCOLS.includes(normalized as TunnelProtocol)) {
    return normalized as TunnelProtocol;
  }
  throw new Error(
    `Invalid tunnel protocol "${normalized}". Expected one of: ${TUNNEL_PROTOCOLS.join(", ")}.`
  );
}

export function buildCloudflaredTunnelCommand(
  tunnelConfigPath: string,
  tunnelLogLevel: TunnelLogLevel,
  tunnelProtocol: TunnelProtocol
): string {
  return `cloudflared tunnel --loglevel ${tunnelLogLevel} --protocol ${tunnelProtocol} --config ${JSON.stringify(tunnelConfigPath)} run`;
}

export async function startTunnel(
  rootDir: string,
  options?: {
    tunnelConfigPath?: string;
    tunnelHost?: string;
    tunnelLogLevel?: string;
    tunnelProtocol?: string;
  }
): Promise<TunnelHandle> {
  const tunnelConfigPath = options?.tunnelConfigPath ?? defaultTunnelConfigPath(rootDir);
  if (!existsSync(tunnelConfigPath)) {
    console.log("[tunnel] No tunnel config found. Running auto-setup...");
    // Set OTAVIA_TUNNEL_DEV_ROOT from otavia.yaml dns.zone if not already set
    const { loadOtaviaYaml } = await import("../../config/load-otavia-yaml.js");
    if (!process.env.OTAVIA_TUNNEL_DEV_ROOT) {
      const otavia = loadOtaviaYaml(rootDir);
      const zone = otavia.domain?.dns?.zone;
      if (zone) {
        process.env.OTAVIA_TUNNEL_DEV_ROOT = zone;
      }
    }
    const { setupCommand } = await import("../setup.js");
    await setupCommand(rootDir, { tunnel: true });
    if (!existsSync(tunnelConfigPath)) {
      throw new Error(
        `Tunnel config not found after auto-setup: ${tunnelConfigPath}. Run setup manually or pass --tunnel-config.`
      );
    }
  }
  const cloudflaredExit = await Bun.spawn(["cloudflared", "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  }).exited;
  if (cloudflaredExit !== 0) {
    throw new Error(
      "cloudflared not found. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
    );
  }

  const configText = await Bun.file(tunnelConfigPath).text();
  const host =
    options?.tunnelHost?.trim() ||
    process.env.OTAVIA_TUNNEL_HOST?.trim() ||
    extractTunnelHostFromConfig(configText);
  if (!host) {
    throw new Error(
      `Cannot find tunnel hostname in ${tunnelConfigPath}. Add ingress.hostname or pass --tunnel-host.`
    );
  }
  const publicBaseUrl = normalizeTunnelPublicBaseUrl(host);
  const tunnelLogLevel = resolveTunnelLogLevel(options?.tunnelLogLevel);
  const tunnelProtocol = resolveTunnelProtocol(options?.tunnelProtocol);
  const tunnelCommand = buildCloudflaredTunnelCommand(tunnelConfigPath, tunnelLogLevel, tunnelProtocol);
  const { commands, result } = concurrently(
    [
      {
        command: tunnelCommand,
        name: "tunnel",
        cwd: rootDir,
        env: { ...process.env },
      },
    ],
    {
      prefix: "[{name}]",
      prefixColors: ["cyan"],
      raw: false,
      handleInput: false,
      killOthersOn: ["failure"],
    }
  );
  let stopped = false;
  result.catch((events) => {
    if (stopped) return;
    const tunnelEvent = Array.isArray(events) ? events.find((event) => event.command.name === "tunnel") : null;
    const exitCode = tunnelEvent?.exitCode;
    console.error(`[tunnel] cloudflared exited with code ${exitCode ?? "unknown"}`);
  });
  result.then(() => {
    if (stopped) return;
    console.error("[tunnel] cloudflared exited.");
  });

  return {
    publicBaseUrl,
    stop: () => {
      stopped = true;
      commands[0]?.kill("SIGTERM");
    },
  };
}
