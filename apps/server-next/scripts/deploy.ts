/**
 * Deploy server-next to AWS (beta/prod): build frontend, deploy stack, upload frontend to S3, invalidate CloudFront.
 * Reads AWS_PROFILE from .env in current directory and parent directories up to repo root.
 * Usage: bun run scripts/deploy.ts [--stage beta|prod]
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

const CWD = process.cwd();
const STACK_PREFIX = "casfa-next";

function findRepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return dir;
    dir = parent;
  }
}

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(filePath, "utf-8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      out[key] = val;
    }
  } catch {
    // ignore
  }
  return out;
}

function loadAwsProfile(): string | undefined {
  const repoRoot = findRepoRoot(CWD);
  const dirs: string[] = [];
  let d = resolve(CWD);
  while (true) {
    dirs.push(d);
    if (d === repoRoot) break;
    const parent = resolve(d, "..");
    if (parent === d) break;
    d = parent;
  }
  for (const dir of dirs) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) {
      const env = parseEnvFile(envPath);
      if (env.AWS_PROFILE != null && env.AWS_PROFILE.trim() !== "")
        return env.AWS_PROFILE.trim();
    }
  }
  return undefined;
}

/** Load .env and optionally .env.{stage} from CWD and parents up to repo root. Merges in order (later overrides). */
function loadEnvForDeploy(stage: string): Record<string, string> {
  const repoRoot = findRepoRoot(CWD);
  const dirs: string[] = [];
  let d = resolve(CWD);
  while (true) {
    dirs.push(d);
    if (d === repoRoot) break;
    const parent = resolve(d, "..");
    if (parent === d) break;
    d = parent;
  }
  const out: Record<string, string> = {};
  for (const dir of dirs) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) {
      Object.assign(out, parseEnvFile(envPath));
    }
  }
  for (const dir of dirs) {
    const stageEnvPath = join(dir, `.env.${stage}`);
    if (existsSync(stageEnvPath)) {
      Object.assign(out, parseEnvFile(stageEnvPath));
    }
  }
  return out;
}

function run(cmd: string[], env: Record<string, string | undefined>, opts?: { cwd?: string }): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const proc = Bun.spawn(cmd, {
      cwd: opts?.cwd ?? CWD,
      env: { ...process.env, ...env },
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    proc.exited.then((code) => resolvePromise(code)).catch(reject);
  });
}

async function getStackOutputs(
  stackName: string,
  env: Record<string, string | undefined>
): Promise<Record<string, string>> {
  const proc = Bun.spawn(
    [
      "aws",
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stackName,
      "--query",
      "Stacks[0].Outputs[?OutputKey==`FrontendBucketName` || OutputKey==`FrontendDistributionId` || OutputKey==`FrontendUrl`].{Key:OutputKey,Value:OutputValue}",
      "--output",
      "json",
    ],
    {
      cwd: CWD,
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "inherit",
    }
  );
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`aws describe-stacks failed: ${code}`);
  const arr = JSON.parse(out) as Array<{ Key: string; Value: string }>;
  const result: Record<string, string> = {};
  for (const { Key, Value } of arr) result[Key] = Value;
  return result;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const stageIdx = args.findIndex((a) => a === "--stage");
  const stage = stageIdx >= 0 && args[stageIdx + 1] ? args[stageIdx + 1]! : "beta";
  const serverlessArgs = args.filter((_, i) => i !== stageIdx && i !== stageIdx + 1);

  const profile = loadAwsProfile();
  const deployEnv = loadEnvForDeploy(stage);
  const env: Record<string, string | undefined> = { ...process.env, ...deployEnv };
  if (profile) env.AWS_PROFILE = profile;

  // Production (beta/prod): use Cognito only — do not pass MOCK_JWT_SECRET so Lambda never uses mock auth.
  const isProdLike = stage !== "dev" && stage !== "local-test";
  if (isProdLike) {
    delete env.MOCK_JWT_SECRET;
    const cognitoPoolId = env.COGNITO_USER_POOL_ID?.trim();
    if (!cognitoPoolId) {
      console.error(
        `[${stage}] COGNITO_USER_POOL_ID is required. Set it in .env or .env.${stage} (see .env.example).`
      );
      return 1;
    }
    if (!env.COGNITO_CLIENT_ID?.trim() || !env.COGNITO_HOSTED_UI_URL?.trim()) {
      console.error(
        `[${stage}] COGNITO_CLIENT_ID and COGNITO_HOSTED_UI_URL are required. Set them in .env or .env.${stage}.`
      );
      return 1;
    }
  }

  // Custom domain for CloudFront: beta -> beta.casfa.shazhou.me, prod -> casfa.shazhou.me (prod DNS 暂不覆盖旧版)
  const stageDomains: Record<string, string> = {
    beta: "beta.casfa.shazhou.me",
    prod: "casfa.shazhou.me",
  };
  const domain = stageDomains[stage];
  if (domain) {
    const certArn = env.ACM_CERTIFICATE_ARN?.trim();
    if (certArn) {
      env.CLOUDFRONT_ALIAS = domain;
      env.ACM_CERTIFICATE_ARN = certArn;
    }
  }

  // 1. Build frontend
  const frontendDir = join(CWD, "frontend");
  if (!existsSync(frontendDir)) {
    console.error("frontend/ not found in cwd");
    return 1;
  }
  const buildCode = await run(["bun", "run", "build"], env, { cwd: frontendDir });
  if (buildCode !== 0) {
    console.error("Frontend build failed");
    return buildCode;
  }
  const distDir = join(frontendDir, "dist");
  if (!existsSync(distDir)) {
    console.error("frontend/dist not found after build");
    return 1;
  }

  // 2. Deploy stack (API + S3 + CloudFront)
  const deployCode = await run(
    ["bunx", "serverless", "deploy", "--stage", stage, ...serverlessArgs],
    env
  );
  if (deployCode !== 0) {
    console.error("serverless deploy failed");
    return deployCode;
  }

  const stackName = `${STACK_PREFIX}-${stage}`;
  let outputs: Record<string, string>;
  try {
    outputs = await getStackOutputs(stackName, env);
  } catch (e) {
    console.error("Failed to get stack outputs:", e);
    return 1;
  }

  const bucket = outputs.FrontendBucketName;
  const distributionId = outputs.FrontendDistributionId;
  const frontendUrl = outputs.FrontendUrl;

  if (!bucket || !distributionId) {
    console.error("Stack missing FrontendBucketName or FrontendDistributionId");
    return 1;
  }

  // 2b. Fix S3 bucket policy: CloudFormation may serialize Condition key as lowercase (aws:SourceArn),
  //     which S3 rejects. Re-apply policy with AWS:SourceArn via CLI so CloudFront can access the bucket.
  const accountIdProc = Bun.spawn(
    ["aws", "sts", "get-caller-identity", "--query", "Account", "--output", "text"],
    { cwd: CWD, env: { ...process.env, ...env }, stdout: "pipe", stderr: "inherit" }
  );
  const accountId = (await new Response(accountIdProc.stdout).text()).trim();
  const accountIdCode = await accountIdProc.exited;
  if (accountIdCode !== 0 || !accountId) {
    console.error("Failed to get AWS account ID for bucket policy");
    return 1;
  }
  const bucketPolicy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowCloudFrontOAC",
        Effect: "Allow",
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "s3:GetObject",
        Resource: `arn:aws:s3:::${bucket}/*`,
        Condition: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${accountId}:distribution/${distributionId}`,
          },
        },
      },
    ],
  };
  const policyProc = Bun.spawn(
    ["aws", "s3api", "put-bucket-policy", "--bucket", bucket, "--policy", JSON.stringify(bucketPolicy)],
    { cwd: CWD, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" }
  );
  const policyCode = await policyProc.exited;
  if (policyCode !== 0) {
    console.error("put-bucket-policy failed");
    return 1;
  }

  // 3. Upload frontend to S3
  const syncCode = await run(
    ["aws", "s3", "sync", distDir, `s3://${bucket}`, "--delete"],
    env
  );
  if (syncCode !== 0) {
    console.error("s3 sync failed");
    return syncCode;
  }

  // 4. Invalidate CloudFront
  const invalCode = await run(
    ["aws", "cloudfront", "create-invalidation", "--distribution-id", distributionId, "--paths", "/*"],
    env
  );
  if (invalCode !== 0) {
    console.error("cloudfront create-invalidation failed");
    return invalCode;
  }
  return 0;
}

main().then((code) => process.exit(code));
