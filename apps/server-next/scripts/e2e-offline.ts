/**
 * Start serverless-offline, wait for ready, run E2E tests with BASE_URL, then stop.
 * Run from apps/server-next (e.g. bun run scripts/e2e-offline.ts).
 */
const OFFLINE_PORT = 3000;
const BASE_URL = `http://localhost:${OFFLINE_PORT}`;
const HEALTH_URL = `${BASE_URL}/api/health`;
const WAIT_MS = 60_000;
const POLL_MS = 300;

async function waitForHealthy(): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`serverless-offline did not become healthy at ${HEALTH_URL} within ${WAIT_MS}ms`);
}

const appRoot = process.cwd();
const serverless = Bun.spawn(
  ["bunx", "serverless", "offline", "--httpPort", String(OFFLINE_PORT)],
  {
    cwd: appRoot,
    stdout: "pipe",
    stderr: "pipe",
  }
);

function killOffline(): void {
  try {
    serverless.kill();
  } catch {
    // ignore
  }
}

process.on("SIGINT", () => {
  killOffline();
  process.exit(130);
});
process.on("SIGTERM", () => {
  killOffline();
  process.exit(143);
});

try {
  await waitForHealthy();
  const testRun = Bun.spawn(["bun", "test", "tests/"], {
    cwd: appRoot,
    env: { ...process.env, BASE_URL },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await testRun.exited;
  killOffline();
  process.exit(exitCode);
} catch (err) {
  console.error(err);
  killOffline();
  process.exit(1);
}
