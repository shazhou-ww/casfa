/**
 * Start dev:test (Docker dynamodb-test + serverless offline on 7111), wait for ready,
 * run E2E with BASE_URL=http://localhost:7111, then stop dev:test and dynamodb-test container.
 * Run from apps/server-next (e.g. bun run test:e2e).
 */
import { spawnSync } from "node:child_process";

const OFFLINE_PORT = 7111;
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
const devTestProcess = Bun.spawn(["bun", "run", "scripts/dev-test.ts"], {
  cwd: appRoot,
  env: { ...process.env },
  stdout: "pipe",
  stderr: "pipe",
});

function killDevTest(): void {
  try {
    devTestProcess.kill();
  } catch {
    // ignore
  }
}

/** Stop DynamoDB test container after e2e so dev:test is not left running. */
function stopDynamoDBTest(): void {
  spawnSync("docker", ["compose", "stop", "dynamodb-test"], {
    cwd: appRoot,
    encoding: "utf-8",
    shell: true,
    stdio: "pipe",
  });
}

process.on("SIGINT", () => {
  killDevTest();
  stopDynamoDBTest();
  process.exit(130);
});
process.on("SIGTERM", () => {
  killDevTest();
  stopDynamoDBTest();
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
  killDevTest();
  stopDynamoDBTest();
  process.exit(exitCode);
} catch (err) {
  console.error(err);
  killDevTest();
  stopDynamoDBTest();
  process.exit(1);
}
