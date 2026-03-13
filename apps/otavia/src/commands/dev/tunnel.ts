import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

type TunnelConfig = {
  ingress?: Array<{ hostname?: string }>;
};

export type TunnelHandle = {
  publicBaseUrl: string;
  stop: () => void;
};

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

export async function startTunnel(
  rootDir: string,
  options?: { tunnelConfigPath?: string; tunnelHost?: string }
): Promise<TunnelHandle> {
  const tunnelConfigPath = options?.tunnelConfigPath ?? defaultTunnelConfigPath(rootDir);
  if (!existsSync(tunnelConfigPath)) {
    throw new Error(
      `Tunnel config not found: ${tunnelConfigPath}. Run setup first or pass --tunnel-config.`
    );
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

  const child = Bun.spawn(["cloudflared", "tunnel", "--config", tunnelConfigPath, "run"], {
    cwd: rootDir,
    env: { ...process.env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.exited.then((code) => {
    if (code !== 0 && code !== null) {
      console.error(`[tunnel] cloudflared exited with code ${code}`);
    }
  });

  return {
    publicBaseUrl,
    stop: () => child.kill(),
  };
}
