import { loadDevboxConfig, readDaemonPids } from "../../config/devbox-config.js";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function devboxStatusCommand(): Promise<void> {
  const devbox = loadDevboxConfig();
  if (!devbox) {
    console.log("No devbox config. Run 'cell devbox prepare' first.");
    return;
  }

  const pids = readDaemonPids();
  if (!pids) {
    console.log("Devbox: stopped (no PID file)");
    console.log("  Run 'cell devbox start' to start proxy and tunnel.");
    return;
  }

  const proxyAlive = isProcessAlive(pids.proxy);
  const tunnelAlive = isProcessAlive(pids.tunnel);
  const running = proxyAlive && tunnelAlive;

  console.log("Devbox:", running ? "running" : "partial (see below)");
  console.log("  proxy:  PID", pids.proxy, proxyAlive ? "(running)" : "(not running)", "- port", devbox.tunnelPort);
  console.log("  tunnel: PID", pids.tunnel, tunnelAlive ? "(running)" : "(not running)");
  if (!running) {
    console.log("");
    console.log("Run 'cell devbox stop' then 'cell devbox start' to clean up.");
  }
}
