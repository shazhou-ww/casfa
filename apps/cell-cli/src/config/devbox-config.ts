import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/** Directory for casfa devbox config (e.g. ~/.config/casfa). */
export const DEVBOX_CONFIG_DIR = join(homedir(), ".config", "casfa");

/** Default path to devbox.yaml. */
export const DEVBOX_CONFIG_PATH = join(DEVBOX_CONFIG_DIR, "devbox.yaml");

/** Default path to devbox routes JSON (host -> port map). */
export const DEVBOX_ROUTES_PATH = join(DEVBOX_CONFIG_DIR, "devbox-routes.json");

/** Path where prepare can save Cloudflare API token (mode 0600). Used for zone list + deploy DNS. */
export const CLOUDFLARE_API_TOKEN_PATH = join(DEVBOX_CONFIG_DIR, "cloudflare-api-token");

/** Path to JSON file storing PIDs of proxy and tunnel started by `cell devbox start`. */
export const DEVBOX_DAEMON_PIDS_PATH = join(DEVBOX_CONFIG_DIR, "devbox-daemon.json");

export interface DevboxDaemonPids {
  proxy: number;
  tunnel: number;
}

export function readDaemonPids(): DevboxDaemonPids | null {
  if (!existsSync(DEVBOX_DAEMON_PIDS_PATH)) return null;
  try {
    const raw = readFileSync(DEVBOX_DAEMON_PIDS_PATH, "utf-8");
    const data = JSON.parse(raw) as { proxy?: number; tunnel?: number };
    if (typeof data?.proxy !== "number" || typeof data?.tunnel !== "number") return null;
    return { proxy: data.proxy, tunnel: data.tunnel };
  } catch {
    return null;
  }
}

export function writeDaemonPids(pids: DevboxDaemonPids): void {
  writeFileSync(DEVBOX_DAEMON_PIDS_PATH, JSON.stringify(pids, null, 2), "utf-8");
}

export function removeDaemonPids(): void {
  if (existsSync(DEVBOX_DAEMON_PIDS_PATH)) unlinkSync(DEVBOX_DAEMON_PIDS_PATH);
}

export interface DevboxConfig {
  /** Machine identifier used in dev host (e.g. my-mbp). */
  devboxName: string;
  /** Dev root domain (e.g. example.com). Dev host = <subdomain>.<devboxName>.<devRoot>. */
  devRoot: string;
  /** Local port the tunnel and proxy listen on (e.g. 8443). */
  tunnelPort: number;
  /** Cloudflare tunnel name or id (for reference / re-auth). */
  tunnelId?: string;
  /** Path to cloudflared credentials file. */
  credentialsPath?: string;
  /** Path to devbox-routes.json. Defaults to DEVBOX_ROUTES_PATH when not set. */
  proxyRegistryPath?: string;
  /** Path to file containing Cloudflare API token (Edit zone DNS). Used for zone list + cell deploy DNS. */
  cloudflareApiTokenPath?: string;
}

/**
 * Load devbox config from ~/.config/casfa/devbox.yaml.
 * Returns null if file does not exist or is invalid.
 */
export function loadDevboxConfig(customPath?: string): DevboxConfig | null {
  const path = customPath ?? DEVBOX_CONFIG_PATH;
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const data = parseYaml(raw) as Record<string, unknown>;
    if (!data || typeof data.devboxName !== "string" || typeof data.devRoot !== "string")
      return null;
    const tunnelPort = Number(data.tunnelPort);
    if (!Number.isInteger(tunnelPort) || tunnelPort <= 0) return null;
    const config: DevboxConfig = {
      devboxName: data.devboxName as string,
      devRoot: data.devRoot as string,
      tunnelPort,
    };
    if (typeof data.tunnelId === "string") config.tunnelId = data.tunnelId;
    if (typeof data.credentialsPath === "string") config.credentialsPath = data.credentialsPath;
    if (typeof data.proxyRegistryPath === "string") config.proxyRegistryPath = data.proxyRegistryPath;
    if (typeof data.cloudflareApiTokenPath === "string") config.cloudflareApiTokenPath = data.cloudflareApiTokenPath;
    return config;
  } catch {
    return null;
  }
}

/**
 * Build dev host for a cell: <subdomain>.<devboxName>.<devRoot>
 * e.g. getDevHost("sso.casfa", devbox) => "sso.casfa.my-mbp.example.com"
 */
export function getDevHost(subdomain: string, devbox: DevboxConfig): string {
  return `${subdomain}.${devbox.devboxName}.${devbox.devRoot}`;
}

/**
 * Get Cloudflare API token for zone list and deploy DNS.
 * Order: env CLOUDFLARE_API_TOKEN/CF_API_TOKEN → envMap → file at devbox.cloudflareApiTokenPath.
 */
export function getCloudflareApiToken(opts?: {
  devbox?: DevboxConfig | null;
  envMap?: Record<string, string>;
}): string | null {
  const fromEnv =
    process.env.CLOUDFLARE_API_TOKEN ??
    process.env.CF_API_TOKEN ??
    opts?.envMap?.CLOUDFLARE_API_TOKEN ??
    opts?.envMap?.CF_API_TOKEN;
  if (fromEnv?.trim()) return fromEnv.trim();
  const path = opts?.devbox?.cloudflareApiTokenPath;
  if (path && existsSync(path)) {
    try {
      const t = readFileSync(path, "utf-8").trim();
      if (t) return t;
    } catch {
      /* ignore */
    }
  }
  return null;
}
