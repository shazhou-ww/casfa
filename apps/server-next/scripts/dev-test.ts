/**
 * Start local-test: serverless offline on 7111, mock auth (MOCK_JWT_SECRET), in-memory storage.
 * Used by test:e2e (script starts this then runs E2E against 7111).
 */
const PORT = 7111;
const appRoot = process.cwd();
Bun.spawn(
  ["bunx", "serverless", "offline", "--httpPort", String(PORT)],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      STORAGE_TYPE: "memory",
      MOCK_JWT_SECRET: process.env.MOCK_JWT_SECRET ?? "test-secret-e2e",
    },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }
);
