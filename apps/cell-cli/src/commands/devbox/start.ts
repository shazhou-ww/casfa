import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEVBOX_CONFIG_DIR,
  loadDevboxConfig,
  readDaemonPids,
  writeDaemonPids,
} from "../../config/devbox-config.js";

/** Returns true if a process with the given PID is running (or we can send signal 0). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Path to devbox-proxy script relative to this file (works when cell-cli is global or local). */
function getProxyScriptPath(): string {
  return join(import.meta.dir, "..", "..", "local", "devbox-proxy.ts");
}

export async function devboxStartCommand(): Promise<void> {
  const devbox = loadDevboxConfig();
  if (!devbox) {
    console.error("No devbox config. Run 'cell devbox prepare' first.");
    process.exit(1);
  }

  const existing = readDaemonPids();
  if (existing) {
    const proxyAlive = isProcessAlive(existing.proxy);
    const tunnelAlive = isProcessAlive(existing.tunnel);
    if (proxyAlive || tunnelAlive) {
      console.log("Devbox is already running.");
      console.log("  proxy:  PID", existing.proxy, proxyAlive ? "(running)" : "(not running)");
      console.log("  tunnel: PID", existing.tunnel, tunnelAlive ? "(running)" : "(not running)");
      if (!proxyAlive || !tunnelAlive) {
        console.log("Run 'cell devbox stop' then 'cell devbox start' to clean up.");
      }
      return;
    }
  }

  const proxyScript = getProxyScriptPath();
  if (!existsSync(proxyScript)) {
    console.error("Proxy script not found:", proxyScript);
    process.exit(1);
  }

  const cloudflaredConfigPath = join(DEVBOX_CONFIG_DIR, "config.yml");
  if (!existsSync(cloudflaredConfigPath)) {
    console.error("Cloudflared config not found:", cloudflaredConfigPath, "- run 'cell devbox prepare' first.");
    process.exit(1);
  }

  const proxyProc = Bun.spawn(["bun", "run", proxyScript], {
    cwd: undefined,
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  proxyProc.unref();

  const tunnelProc = Bun.spawn(
    ["cloudflared", "tunnel", "run", "--config", cloudflaredConfigPath],
    {
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    }
  );
  tunnelProc.unref();

  const pids = { proxy: proxyProc.pid!, tunnel: tunnelProc.pid! };
  writeDaemonPids(pids);

  console.log("Devbox started.");
  console.log("  proxy:  PID", pids.proxy, "(port", devbox.tunnelPort + ")");
  console.log("  tunnel: PID", pids.tunnel);
  console.log("");
  console.log("Run 'cell dev' in any cell with domain; routes will be registered automatically.");
}
