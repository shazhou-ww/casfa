import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { resolveConfig } from "../config/resolve-config.js";
import { loadEnvFiles } from "../utils/env.js";
import { generateTemplate } from "../generators/merge.js";
import { buildCommand } from "./build.js";

interface AwsCliResult {
  exitCode: number;
  stdout: string;
}

async function awsCli(
  args: string[],
  env: Record<string, string | undefined>,
  opts?: { cwd?: string; inheritStdio?: boolean },
): Promise<AwsCliResult> {
  const proc = Bun.spawn(["aws", ...args], {
    cwd: opts?.cwd ?? process.cwd(),
    env: { ...process.env, ...env },
    stdout: opts?.inheritStdio ? "inherit" : "pipe",
    stderr: "inherit",
  });
  const stdout = opts?.inheritStdio
    ? ""
    : await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout: stdout.trim() };
}

async function ensureS3Bucket(
  bucketName: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const { exitCode } = await awsCli(
    ["s3api", "head-bucket", "--bucket", bucketName],
    env,
  );
  if (exitCode !== 0) {
    console.log(`Creating deploy artifacts bucket: ${bucketName}`);
    const { exitCode: createCode } = await awsCli(
      ["s3", "mb", `s3://${bucketName}`],
      env,
    );
    if (createCode !== 0) {
      throw new Error(`Failed to create S3 bucket: ${bucketName}`);
    }
  }
}

async function zipDirectory(
  sourceDir: string,
  outputPath: string,
): Promise<void> {
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  const proc = Bun.spawn(["zip", "-r", "-j", outputPath, sourceDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`zip failed: ${stderr}`);
  }
}

async function fileHash(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await file.arrayBuffer());
  return hasher.digest("hex").slice(0, 12);
}

export async function deployCommand(options?: {
  cellDir?: string;
  yes?: boolean;
}): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const envMap = loadEnvFiles(cellDir);
  const resolved = resolveConfig(config, envMap, "cloud");

  // Validate: MOCK_JWT_SECRET should NOT be set for cloud
  if (resolved.envVars.MOCK_JWT_SECRET) {
    console.warn(
      "⚠ WARNING: MOCK_JWT_SECRET is set in envVars. This should NOT be used for cloud deployment!",
    );
  }

  const awsEnv: Record<string, string | undefined> = {};
  if (envMap.AWS_PROFILE) {
    awsEnv.AWS_PROFILE = envMap.AWS_PROFILE;
  }
  if (envMap.AWS_REGION) {
    awsEnv.AWS_REGION = envMap.AWS_REGION;
  }

  // 1. Build
  console.log("\n=== Building ===");
  await buildCommand({ cellDir });

  // 2. Generate CloudFormation template
  console.log("\n=== Generating CloudFormation template ===");
  const cfnDir = resolve(cellDir, ".cell");
  mkdirSync(cfnDir, { recursive: true });
  const cfnTemplate = generateTemplate(resolved);
  const cfnPath = resolve(cfnDir, "cfn.yaml");
  writeFileSync(cfnPath, cfnTemplate);
  console.log(`  → .cell/cfn.yaml`);

  // 3. Package Lambda code and upload to S3
  const artifactBucket = `${resolved.name}-deploy-artifacts`;
  await ensureS3Bucket(artifactBucket, awsEnv);

  let template = cfnTemplate;

  if (resolved.backend) {
    console.log("\n=== Packaging Lambda code ===");
    const pkgDir = resolve(cellDir, ".cell/pkg");
    mkdirSync(pkgDir, { recursive: true });

    for (const [name] of Object.entries(resolved.backend.entries)) {
      const buildDir = resolve(cellDir, `.cell/build/${name}`);
      const zipPath = resolve(pkgDir, `${name}.zip`);

      console.log(`  Zipping ${name}...`);
      await zipDirectory(buildDir, zipPath);

      const hash = await fileHash(zipPath);
      const s3Key = `${name}-${hash}.zip`;

      console.log(`  Uploading ${s3Key} to s3://${artifactBucket}/...`);
      const { exitCode } = await awsCli(
        ["s3", "cp", zipPath, `s3://${artifactBucket}/${s3Key}`],
        awsEnv,
      );
      if (exitCode !== 0) {
        throw new Error(`Failed to upload ${s3Key} to S3`);
      }

      template = template.replace(
        /S3Bucket: PLACEHOLDER/,
        `S3Bucket: ${artifactBucket}`,
      );
      template = template.replace(
        new RegExp(`S3Key: build/${name}/code\\.zip`),
        `S3Key: ${s3Key}`,
      );
    }

    const packagedPath = resolve(cfnDir, "cfn-packaged.yaml");
    writeFileSync(packagedPath, template);
    console.log(`  → .cell/cfn-packaged.yaml`);
  }

  // 4. Deploy CloudFormation stack
  console.log("\n=== Deploying CloudFormation stack ===");
  const stackName = resolved.name;
  const templateFile = resolved.backend
    ? resolve(cfnDir, "cfn-packaged.yaml")
    : cfnPath;

  const deployResult = await awsCli(
    [
      "cloudformation",
      "deploy",
      "--template-file",
      templateFile,
      "--stack-name",
      stackName,
      "--capabilities",
      "CAPABILITY_IAM",
      "CAPABILITY_AUTO_EXPAND",
      "--no-fail-on-empty-changeset",
    ],
    awsEnv,
    { cwd: cellDir, inheritStdio: true },
  );
  if (deployResult.exitCode !== 0) {
    console.error("CloudFormation deploy failed");
    process.exit(1);
  }

  // 5. Get stack outputs
  console.log("\n=== Getting stack outputs ===");
  const { exitCode: descCode, stdout: descOut } = await awsCli(
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stackName,
      "--query",
      "Stacks[0].Outputs",
      "--output",
      "json",
    ],
    awsEnv,
  );
  if (descCode !== 0) {
    console.error("Failed to get stack outputs");
    process.exit(1);
  }

  const outputsArr = JSON.parse(descOut || "[]") as Array<{
    OutputKey: string;
    OutputValue: string;
  }>;
  const outputs: Record<string, string> = {};
  for (const { OutputKey, OutputValue } of outputsArr) {
    outputs[OutputKey] = OutputValue;
    console.log(`  ${OutputKey}: ${OutputValue}`);
  }

  const frontendBucket = outputs.FrontendBucketName;
  const distributionId = outputs.FrontendDistributionId;

  // 6. Upload static files
  if (resolved.static && resolved.static.length > 0 && frontendBucket) {
    console.log("\n=== Uploading static files ===");
    for (const mapping of resolved.static) {
      const srcDir = resolve(cellDir, mapping.src);
      const dest = mapping.dest.startsWith("/")
        ? mapping.dest.slice(1)
        : mapping.dest;
      console.log(`  Syncing ${mapping.src} → s3://${frontendBucket}/${dest}`);
      const { exitCode } = await awsCli(
        ["s3", "sync", srcDir, `s3://${frontendBucket}/${dest}`],
        awsEnv,
      );
      if (exitCode !== 0) {
        console.error(`Failed to sync static files from ${mapping.src}`);
        process.exit(1);
      }
    }
  }

  // 7. Upload frontend build
  if (resolved.frontend && frontendBucket) {
    console.log("\n=== Uploading frontend ===");
    const frontendBuildDir = resolve(cellDir, ".cell/build/frontend");
    console.log(
      `  Syncing .cell/build/frontend → s3://${frontendBucket}/`,
    );
    const { exitCode } = await awsCli(
      ["s3", "sync", frontendBuildDir, `s3://${frontendBucket}`, "--delete"],
      awsEnv,
    );
    if (exitCode !== 0) {
      console.error("Failed to sync frontend to S3");
      process.exit(1);
    }
  }

  // 8. Invalidate CloudFront
  if (distributionId) {
    console.log("\n=== Invalidating CloudFront ===");
    const { exitCode } = await awsCli(
      [
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        distributionId,
        "--paths",
        "/*",
      ],
      awsEnv,
      { inheritStdio: true },
    );
    if (exitCode !== 0) {
      console.error("CloudFront invalidation failed");
      process.exit(1);
    }
  }

  // 9. Print URLs
  console.log("\n=== Deploy complete! ===");
  if (resolved.domain) {
    console.log(`  Domain: https://${resolved.domain.host}`);
  }
  const cfUrl = outputs.FrontendUrl || outputs.CloudFrontUrl;
  if (cfUrl) {
    console.log(`  CloudFront URL: ${cfUrl}`);
  }
}
