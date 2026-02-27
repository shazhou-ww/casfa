#!/usr/bin/env bun
/**
 * Deploy script that loads AWS_PROFILE from root .env
 *
 * Usage:
 *   bun run backend/scripts/deploy.ts frontend          # Deploy frontend only
 *   bun run backend/scripts/deploy.ts frontend staging  # Deploy staging frontend
 *   bun run backend/scripts/deploy.ts all               # Full deploy (backend + frontend)
 *   bun run backend/scripts/deploy.ts all staging       # Full staging deploy
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env from monorepo root (Bun auto-loads from cwd, but we need root)
const rootEnvPath = resolve(import.meta.dir, "../../../../.env");
if (existsSync(rootEnvPath)) {
  const envContent = await Bun.file(rootEnvPath).text();
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        process.env[key] = valueParts.join("=");
      }
    }
  }
}

const profile = process.env.AWS_PROFILE;
if (!profile) {
  console.error("Error: AWS_PROFILE not set. Add it to the root .env file.");
  process.exit(1);
}

console.log(`Using AWS_PROFILE: ${profile}`);

// Ensure SSO session is valid
try {
  await $`aws sts get-caller-identity --profile ${profile}`.quiet();
} catch {
  console.log("AWS session expired. Running aws sso login...");
  await $`aws sso login --profile ${profile}`;
}

const [action, env = "prod"] = process.argv.slice(2);
const stackName = env === "staging" ? "casfa-staging" : "casfa-prod";

async function deployFrontend() {
  console.log(`\nDeploying frontend to ${stackName}...`);

  // Get bucket name
  const bucketResult =
    await $`aws cloudformation describe-stacks --stack-name ${stackName} --query "Stacks[0].Outputs[?OutputKey==\`FrontendBucketName\`].OutputValue" --output text --profile ${profile}`.text();
  const bucket = bucketResult.trim();

  if (!bucket) {
    throw new Error(`Failed to get FrontendBucketName from stack ${stackName}`);
  }

  // Get CloudFront distribution ID
  const distIdResult =
    await $`aws cloudformation describe-stacks --stack-name ${stackName} --query "Stacks[0].Outputs[?OutputKey==\`CloudFrontDistributionId\`].OutputValue" --output text --profile ${profile}`.text();
  const distributionId = distIdResult.trim();

  if (!distributionId) {
    throw new Error(
      `Failed to get CloudFrontDistributionId from stack ${stackName}`
    );
  }

  console.log(`  Bucket: ${bucket}`);
  console.log(`  Distribution: ${distributionId}`);

  // Sync to S3 (excluding .mjs files for separate handling)
  console.log("\n  Syncing to S3...");
  await $`aws s3 sync backend/public/ s3://${bucket} --delete --exclude "*.mjs" --profile ${profile}`;

  // Sync .mjs files with correct MIME type (S3 defaults to text/plain which breaks ES modules)
  await $`aws s3 sync backend/public/ s3://${bucket} --exclude "*" --include "*.mjs" --content-type "application/javascript" --profile ${profile}`;

  // Invalidate CloudFront
  console.log("\n  Invalidating CloudFront cache...");
  await $`aws cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*" --profile ${profile}`;

  console.log("\n✓ Frontend deployed successfully");
}

async function deployBackend() {
  console.log(`\nDeploying backend to ${stackName}...`);

  // Build
  await $`bun run sam:build`;

  // Deploy with SAM
  const configEnv = env === "staging" ? "--config-env staging" : "";
  try {
    await $`sam deploy ${configEnv} --profile ${profile}`.nothrow();
  } catch {
    console.log("SAM deploy completed (may have had no changes)");
  }

  console.log("\n✓ Backend deployed");
}

// Main
switch (action) {
  case "frontend":
    await deployFrontend();
    break;
  case "backend":
    await deployBackend();
    break;
  case "all":
    await deployBackend();
    await deployFrontend();
    break;
  default:
    console.log(`
Usage:
  bun run backend/scripts/deploy.ts <action> [env]

Actions:
  frontend  - Deploy frontend to S3 + invalidate CloudFront
  backend   - Build and deploy SAM stack
  all       - Deploy backend + frontend

Environment:
  prod (default)
  staging
`);
    process.exit(1);
}
