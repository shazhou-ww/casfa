/**
 * Start local-dev with Cognito auth: serverless offline on 7101.
 * Does NOT set MOCK_JWT_SECRET so backend uses Cognito.
 * Frontend is started by the concurrently wrapper in dev:cognito script.
 */
const PORT = 7101;
const appRoot = process.cwd();
Bun.spawn(
  ["bunx", "serverless", "offline", "--httpPort", String(PORT)],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      STORAGE_TYPE: process.env.STORAGE_TYPE ?? "memory",
      DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:7102",
    },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }
);
