/**
 * Start local-dev: serverless offline on 7101, Cognito auth, persistent local storage.
 * Optionally start DynamoDB local on 7102 (when used); this script only starts offline.
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
