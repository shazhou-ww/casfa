import {
  readDaemonPids,
  removeDaemonPids,
} from "../../config/devbox-config.js";

/** Returns true if a process with the given PID is running. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcess(pid: number, label: string): void {
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
    console.log("Stopped", label, "(PID", pid + ")");
  } catch (e) {
    try {
      process.kill(pid, "SIGKILL");
      console.log("Killed", label, "(PID", pid + ")");
    } catch {
      console.warn("Could not stop", label, "PID", pid, e);
    }
  }
}

export async function devboxStopCommand(): Promise<void> {
  const pids = readDaemonPids();
  if (!pids) {
    console.log("Devbox is not running (no PID file).");
    return;
  }

  killProcess(pids.proxy, "proxy");
  killProcess(pids.tunnel, "tunnel");
  removeDaemonPids();
  console.log("Devbox stopped.");
}
