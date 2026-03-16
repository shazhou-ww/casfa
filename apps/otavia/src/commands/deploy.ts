import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { build } from "esbuild";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { resolveCellDir } from "../config/resolve-cell-dir.js";
import { assertDeclaredParamsProvided, mergeParams, resolveParams } from "../config/resolve-params.js";
import { loadEnvForCell } from "../utils/env.js";
import { generateTemplate } from "../deploy/template.js";
import { ensureAcmCertificateWithCloudflare, createCloudFrontDnsRecord } from "../deploy/cloudflare-dns.js";

const OTAVIA_BUILD = ".otavia/build";
const OTAVIA_DIST = ".otavia/dist";

interface AwsCliResult {
  exitCode: number;
  stdout: string;
}

async function awsCli(
  args: string[],
  env: Record<string, string | undefined>,
  opts?: { cwd?: string; inheritStdio?: boolean; pipeStderr?: boolean }
): Promise<AwsCliResult> {
  const proc = Bun.spawn(["aws", ...args], {
    cwd: opts?.cwd ?? process.cwd(),
    env: { ...process.env, ...env },
    stdout: opts?.inheritStdio ? "inherit" : "pipe",
    stderr: opts?.pipeStderr ? "pipe" : "inherit",
  });
  const stdout = opts?.inheritStdio ? "" : await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout: stdout.trim() };
}

async function ensureS3Bucket(
  bucketName: string,
  env: Record<string, string | undefined>
): Promise<void> {
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
  const regionArgs = region ? ["--region", region] : [];
  const { exitCode } = await awsCli(
    ["s3api", "head-bucket", "--bucket", bucketName, ...regionArgs],
    env
  );
  if (exitCode !== 0) {
    console.log(`Creating deploy artifacts bucket: ${bucketName}`);
    const { exitCode: createCode } = await awsCli(
      ["s3", "mb", `s3://${bucketName}`, ...regionArgs],
      env
    );
    if (createCode !== 0) {
      throw new Error(`Failed to create S3 bucket: ${bucketName}`);
    }
  }
}

async function zipDirectory(sourceDir: string, outputPath: string): Promise<void> {
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

async function stackExists(
  stackName: string,
  awsEnv: Record<string, string | undefined>
): Promise<boolean> {
  const { exitCode } = await awsCli(
    ["cloudformation", "describe-stacks", "--stack-name", stackName, "--max-items", "1"],
    awsEnv,
    { pipeStderr: true }
  );
  return exitCode === 0;
}

/** Load otavia + all cells and resolve params for cloud; throws if missing !Env/!Secret. */
function loadOtaviaAndResolveParams(rootDir: string) {
  const otavia = loadOtaviaYaml(rootDir);
  const cells: { mount: string; cellDir: string; config: ReturnType<typeof loadCellConfig> }[] = [];

  for (const entry of otavia.cellsList) {
    const cellDir = resolveCellDir(rootDir, entry.package);
    if (!existsSync(resolve(cellDir, "cell.yaml"))) continue;
    const config = loadCellConfig(cellDir);
    const envMap = loadEnvForCell(rootDir, cellDir, { stage: "deploy" });
    const merged = mergeParams(otavia.params, entry.params) as Record<string, unknown>;
    assertDeclaredParamsProvided(config.params, merged, entry.mount);
    resolveParams(merged, envMap, { onMissingParam: "throw" });
    cells.push({ mount: entry.mount, cellDir, config });
  }

  return { otavia, cells };
}

/**
 * Build backend: for each cell with backend.entries, esbuild handler to
 * .otavia/build/<mount>/<entryKey>/index.js, then zip to .otavia/build/<mount>-<entryKey>.zip.
 * Returns map: "mount/entryKey" -> hash (first 12 chars SHA256 of zip).
 */
async function buildBackends(
  rootDir: string,
  cells: { mount: string; cellDir: string; config: ReturnType<typeof loadCellConfig> }[]
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  const buildRoot = resolve(rootDir, OTAVIA_BUILD);

  for (const { mount, cellDir, config } of cells) {
    if (!config.backend?.entries) continue;
    const backendDir = resolve(cellDir, config.backend.dir ?? "backend");

    for (const [entryKey, entry] of Object.entries(config.backend.entries)) {
      const handlerPath = resolve(backendDir, entry.handler);
      const outDir = resolve(buildRoot, mount, entryKey);
      const outfile = resolve(outDir, "index.js");
      mkdirSync(dirname(outfile), { recursive: true });

      console.log(`  Building backend [${mount}/${entryKey}]...`);
      await build({
        entryPoints: [handlerPath],
        bundle: true,
        platform: "node",
        target: "node20",
        format: "cjs",
        outfile,
        sourcemap: true,
        external: ["@aws-sdk/*"],
        loader: { ".md": "text" },
      });

      const zipPath = resolve(buildRoot, `${mount}-${entryKey}.zip`);
      await zipDirectory(outDir, zipPath);
      const hash = await fileHash(zipPath);
      hashes.set(`${mount}/${entryKey}`, hash);
    }
  }

  return hashes;
}

/**
 * Build frontend: for each cell with frontend, run vite build in cellDir
 * with outDir .otavia/dist/<mount> and base /<mount>/.
 */
async function buildFrontends(
  rootDir: string,
  cells: { mount: string; cellDir: string; config: ReturnType<typeof loadCellConfig> }[]
): Promise<void> {
  for (const { mount, cellDir, config } of cells) {
    if (!config.frontend) continue;
    const outDir = resolve(rootDir, OTAVIA_DIST, mount);
    const frontendDir = resolve(cellDir, config.frontend.dir ?? "frontend");
    mkdirSync(outDir, { recursive: true });

    console.log(`  Building frontend [${mount}]...`);
    const proc = Bun.spawn(
      ["bun", "x", "vite", "build", "--logLevel", "error", "--outDir", outDir, "--base", `/${mount}/`],
      {
        cwd: frontendDir,
        stdout: "inherit",
        stderr: "inherit",
        env: { ...process.env },
      }
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Vite build failed for ${mount} (exit code ${exitCode})`);
    }

    // Build non-HTML frontend entries (e.g. service worker) to explicit route targets.
    for (const [entryKey, frontendEntry] of Object.entries(config.frontend.entries ?? {})) {
      const entryFile = frontendEntry.entry ?? "";
      if (entryFile.endsWith(".html")) continue;
      const route = frontendEntry.routes?.[0];
      if (!route || !route.startsWith("/") || route.includes("*")) continue;
      const outFile = resolve(outDir, route.slice(1));
      mkdirSync(dirname(outFile), { recursive: true });
      console.log(`    Building frontend entry [${mount}/${entryKey}] -> ${route}`);
      await build({
        entryPoints: [resolve(frontendDir, entryFile)],
        bundle: true,
        platform: "browser",
        format: "esm",
        target: "es2020",
        outfile: outFile,
        sourcemap: true,
        loader: { ".md": "text" },
      });
    }
  }
}

export async function deployCommand(
  rootDir: string,
  options?: { yes?: boolean }
): Promise<void> {
  const awsEnv: Record<string, string | undefined> = {};
  try {
    const rootEnv = resolve(rootDir, ".env");
    if (existsSync(rootEnv)) {
      const content = await Bun.file(rootEnv).text();
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
          val = val.slice(1, -1);
        awsEnv[key] = val;
      }
    }
  } catch {
    // ignore
  }
  if (awsEnv.AWS_PROFILE) awsEnv.AWS_PROFILE = awsEnv.AWS_PROFILE;
  if (awsEnv.AWS_REGION) awsEnv.AWS_REGION = awsEnv.AWS_REGION;

  const { exitCode: stsCode } = await awsCli(
    ["sts", "get-caller-identity", "--output", "json"],
    awsEnv,
    { pipeStderr: true }
  );
  if (stsCode !== 0) {
    console.error("AWS credentials are not valid. Run: aws sso login (or set AWS_PROFILE/AWS_REGION in .env)");
    process.exit(1);
  }

  let otavia: ReturnType<typeof loadOtaviaYaml>;
  let cells: { mount: string; cellDir: string; config: ReturnType<typeof loadCellConfig> }[];

  try {
    const loaded = loadOtaviaAndResolveParams(rootDir);
    otavia = loaded.otavia;
    cells = loaded.cells;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const stackName = otavia.stackName;
  const deployBucketName = `${stackName}-deploy-artifacts`;

  console.log("\n=== Building backend ===");
  let lambdaHashes: Map<string, string>;
  try {
    lambdaHashes = await buildBackends(rootDir, cells);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const hasFrontend = cells.some((c) => c.config.frontend);
  if (hasFrontend) {
    console.log("\n=== Building frontend ===");
    try {
      await buildFrontends(rootDir, cells);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  console.log("\n=== Ensuring deploy bucket ===");
  try {
    await ensureS3Bucket(deployBucketName, awsEnv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log("\n=== Uploading Lambda zips ===");
  const s3KeyReplacements: { placeholder: string; s3Key: string }[] = [];
  const buildRoot = resolve(rootDir, OTAVIA_BUILD);

  for (const { mount, config } of cells) {
    if (!config.backend?.entries) continue;
    for (const entryKey of Object.keys(config.backend.entries)) {
      const key = `${mount}/${entryKey}`;
      const hash = lambdaHashes.get(key);
      if (!hash) continue;
      const zipPath = resolve(buildRoot, `${mount}-${entryKey}.zip`);
      const s3Key = `lambda/${mount}/${entryKey}-${hash}.zip`;
      console.log(`  Uploading ${s3Key}...`);
      const { exitCode } = await awsCli(
        ["s3", "cp", zipPath, `s3://${deployBucketName}/${s3Key}`],
        awsEnv
      );
      if (exitCode !== 0) {
        console.error(`Failed to upload ${s3Key}`);
        process.exit(1);
      }
      s3KeyReplacements.push({
        placeholder: `build/${mount}/${entryKey}/code.zip`,
        s3Key,
      });
    }
  }

  // Cloudflare DNS: request ACM certificate before template generation
  let certificateArn: string | undefined;
  const dnsProvider = otavia.domain?.dns?.provider;
  const isCloudflare = dnsProvider === "cloudflare";
  if (isCloudflare && otavia.domain?.host && otavia.domain?.dns?.zoneId) {
    console.log("\n=== Cloudflare DNS: Ensuring ACM certificate ===");
    const cfToken =
      awsEnv.CLOUDFLARE_API_TOKEN?.trim() ||
      awsEnv.CF_API_TOKEN?.trim() ||
      process.env.CLOUDFLARE_API_TOKEN?.trim() ||
      process.env.CF_API_TOKEN?.trim();
    if (!cfToken) {
      console.error("Cloudflare API token required. Set CLOUDFLARE_API_TOKEN in .env or environment.");
      process.exit(1);
    }
    try {
      certificateArn = await ensureAcmCertificateWithCloudflare({
        domainHost: otavia.domain.host,
        zoneId: otavia.domain.dns.zoneId,
        cloudflareToken: cfToken,
        awsEnv,
        awsCli,
        region: awsEnv.AWS_REGION ?? "us-east-1",
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  console.log("\n=== Generating CloudFormation template ===");
  let template: string;
  try {
    template = generateTemplate(rootDir, { certificateArn });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  template = template.replace(/S3Bucket: PLACEHOLDER/g, `S3Bucket: ${deployBucketName}`);
  for (const { placeholder, s3Key } of s3KeyReplacements) {
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    template = template.replace(new RegExp(`S3Key: ${escaped}`), `S3Key: ${s3Key}`);
  }

  const cfnDir = resolve(rootDir, ".otavia");
  mkdirSync(cfnDir, { recursive: true });
  const packagedPath = resolve(cfnDir, "cfn-packaged.yaml");
  writeFileSync(packagedPath, template);
  console.log(`  → .otavia/cfn-packaged.yaml`);

  if (!options?.yes) {
    const canPromptForConfirm = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!canPromptForConfirm) {
      console.log("Non-interactive terminal detected, continue without prompt (same as --yes).");
    } else {
      process.stdout.write(`About to deploy stack ${stackName}. Continue? (y/N) `);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((res) => rl.question("", res));
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log("Deploy cancelled.");
        process.exit(0);
      }
    }
  }

  console.log("\n=== Deploying CloudFormation stack ===");
  console.log("  Streaming CloudFormation deploy output...");
  const regionArgs = awsEnv.AWS_REGION ? ["--region", awsEnv.AWS_REGION] : [];
  const deployProc = Bun.spawn(
    [
      "aws",
      "cloudformation",
      "deploy",
      "--template-file",
      packagedPath,
      "--stack-name",
      stackName,
      "--s3-bucket",
      deployBucketName,
      "--s3-prefix",
      "cloudformation",
      "--capabilities",
      "CAPABILITY_IAM",
      "CAPABILITY_AUTO_EXPAND",
      "--no-fail-on-empty-changeset",
      ...regionArgs,
    ],
    {
      cwd: rootDir,
      env: { ...process.env, ...awsEnv },
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  const deployExitCode = await deployProc.exited;
  if (deployExitCode !== 0) {
    console.error("CloudFormation deploy failed");
    process.exit(1);
  }

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
      ...regionArgs,
    ],
    awsEnv
  );
  if (descCode !== 0) {
    console.error("Failed to get stack outputs");
    process.exit(1);
  }

  const outputsArr = (JSON.parse(descOut || "[]") as Array<{ OutputKey: string; OutputValue: string }>);
  const outputs: Record<string, string> = {};
  for (const { OutputKey, OutputValue } of outputsArr) {
    outputs[OutputKey] = OutputValue;
    console.log(`  ${OutputKey}: ${OutputValue}`);
  }

  const frontendBucket = outputs.FrontendBucketName;
  const distributionId = outputs.FrontendDistributionId;

  if (frontendBucket && hasFrontend) {
    console.log("\n=== Uploading frontend ===");
    for (const { mount } of cells) {
      const srcDir = resolve(rootDir, OTAVIA_DIST, mount);
      if (!existsSync(srcDir)) continue;
      console.log(`  Syncing ${mount} → s3://${frontendBucket}/${mount}/`);
      const { exitCode: syncCode } = await awsCli(
        ["s3", "sync", srcDir, `s3://${frontendBucket}/${mount}/`, "--delete"],
        awsEnv
      );
      if (syncCode !== 0) {
        console.error(`Failed to sync frontend for ${mount}`);
        process.exit(1);
      }
    }
  }

  if (distributionId) {
    console.log("\n=== Invalidating CloudFront ===");
    const { exitCode: invCode } = await awsCli(
      ["cloudfront", "create-invalidation", "--distribution-id", distributionId, "--paths", "/*"],
      awsEnv
    );
    if (invCode !== 0) {
      console.error("CloudFront invalidation failed");
      process.exit(1);
    }
    console.log("  Invalidation created");
  }

  // Cloudflare DNS: create CNAME pointing domain to CloudFront
  if (isCloudflare && otavia.domain?.host && otavia.domain?.dns?.zoneId && outputs.FrontendUrl) {
    console.log("\n=== Cloudflare DNS: Creating domain record ===");
    const cfToken =
      awsEnv.CLOUDFLARE_API_TOKEN?.trim() ||
      awsEnv.CF_API_TOKEN?.trim() ||
      process.env.CLOUDFLARE_API_TOKEN?.trim() ||
      process.env.CF_API_TOKEN?.trim();
    if (cfToken) {
      try {
        // Extract CloudFront domain from the URL output
        const cfDomain = outputs.FrontendUrl.replace("https://", "").replace(/\/$/, "");
        await createCloudFrontDnsRecord({
          domainHost: otavia.domain.host,
          cloudFrontDomain: cfDomain,
          zoneId: otavia.domain.dns.zoneId,
          cloudflareToken: cfToken,
        });
      } catch (err) {
        console.warn(`  Warning: DNS record creation failed: ${err instanceof Error ? err.message : err}`);
        console.warn(`  You may need to manually create a CNAME: ${otavia.domain.host} → CloudFront domain`);
      }
    }
  }

  console.log("\n=== Deploy complete! ===");
  if (outputs.FrontendUrl) {
    console.log(`  CloudFront URL: ${outputs.FrontendUrl}`);
  }
  if (otavia.domain?.host) {
    console.log(`  Domain: https://${otavia.domain.host}`);
  }
}
