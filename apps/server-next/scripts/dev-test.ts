/**
 * Start local-test: serverless offline on 7111 (API) and 7113 (lambda), mock auth.
 * Uses same serverless-dynamodb-local and serverless-s3-local (stage=local-test, separate tables/buckets).
 */
const HTTP_PORT = 7111;
const LAMBDA_PORT = 7113;
const appRoot = process.cwd();
Bun.spawn(
  [
    "bunx",
    "serverless",
    "offline",
    "start",
    "--httpPort",
    String(HTTP_PORT),
    "--lambdaPort",
    String(LAMBDA_PORT),
    "--stage",
    "local-test",
  ],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      STAGE: "local-test",
      MOCK_JWT_SECRET: process.env.MOCK_JWT_SECRET ?? "test-secret-e2e",
      DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:7102",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:4569",
      S3_BUCKET: process.env.S3_BUCKET ?? "casfa-next-local-test-blob",
    },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }
);
