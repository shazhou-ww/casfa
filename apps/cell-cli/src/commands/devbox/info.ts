import {
  loadDevboxConfig,
  DEVBOX_CONFIG_PATH,
  DEVBOX_ROUTES_PATH,
  readDaemonPids,
} from "../../config/devbox-config.js";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function devboxInfoCommand(): Promise<void> {
  const devbox = loadDevboxConfig();
  if (!devbox) {
    console.error("No devbox config found. Run 'cell devbox prepare' first.");
    process.exit(1);
  }
  const routesPath = devbox.proxyRegistryPath ?? DEVBOX_ROUTES_PATH;
  console.log("Devbox config:", DEVBOX_CONFIG_PATH);
  console.log("  devboxName:   ", devbox.devboxName);
  console.log("  devRoot:      ", devbox.devRoot);
  console.log("  tunnelPort:   ", devbox.tunnelPort);
  console.log("  tunnelId:     ", devbox.tunnelId ?? "(not set)");
  console.log("  credentials:  ", devbox.credentialsPath ?? "(not set)");
  console.log("  routes file:  ", routesPath);
  console.log("  CF API token: ", devbox.cloudflareApiTokenPath ?? "(not set)");

  const pids = readDaemonPids();
  if (pids) {
    const proxyAlive = isProcessAlive(pids.proxy);
    const tunnelAlive = isProcessAlive(pids.tunnel);
    const running = proxyAlive && tunnelAlive;
    console.log("  daemon:       ", running ? "running" : "partial/stopped", "(proxy PID", pids.proxy, proxyAlive ? "✓" : "✗", "| tunnel PID", pids.tunnel, tunnelAlive ? "✓" : "✗", ")");
  } else {
    console.log("  daemon:       stopped (no PID file)");
  }

  console.log("");
  console.log("Start/stop:  cell devbox start | cell devbox stop | cell devbox status");
}
