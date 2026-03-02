/**
 * Start local-dev: serverless offline on 7101, mock auth (MOCK_JWT_SECRET).
 * Uses serverless-dynamodb-local (7102) and serverless-s3-local (4569). Run: sls dynamodb install (once).
 */
const PORT = 7101;
const appRoot = process.cwd();
Bun.spawn(
  ["bunx", "serverless", "offline", "start", "--httpPort", String(PORT)],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      MOCK_JWT_SECRET: process.env.MOCK_JWT_SECRET ?? "dev-mock-secret",
      DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:7102",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:4569",
      S3_BUCKET: process.env.S3_BUCKET ?? "casfa-next-dev-blob",
    },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }
);
