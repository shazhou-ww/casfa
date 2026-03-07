import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { resolveConfig } from "../config/resolve-config.js";
import { generateTemplate } from "../generators/merge.js";
import { loadEnvFiles } from "../utils/env.js";
import { PreDeployCheckError, runPreDeployChecksFromDeploy } from "./deploy-checks.js";
import { buildCommand } from "./build.js";

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
  const { exitCode } = await awsCli(["s3api", "head-bucket", "--bucket", bucketName], env);
  if (exitCode !== 0) {
    console.log(`Creating deploy artifacts bucket: ${bucketName}`);
    const { exitCode: createCode } = await awsCli(["s3", "mb", `s3://${bucketName}`], env);
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

async function getLatestEventTimestamp(
  stackName: string,
  awsEnv: Record<string, string | undefined>
): Promise<string> {
  const { exitCode, stdout } = await awsCli(
    [
      "cloudformation",
      "describe-stack-events",
      "--stack-name",
      stackName,
      "--max-items",
      "1",
      "--query",
      "StackEvents[0].Timestamp",
      "--output",
      "text",
    ],
    awsEnv
  );
  if (exitCode === 0 && stdout) return stdout.trim();
  return new Date().toISOString();
}

const SLOW_RESOURCE_HINTS: Record<string, string> = {
  FrontendCloudFront: "typically 15-25 min for new distributions",
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

let _waitingLineShown = false;

function clearWaitingLine(): void {
  if (_waitingLineShown) {
    process.stdout.write("\r\x1b[K");
    _waitingLineShown = false;
  }
}

function showWaitingLine(inProgress: Map<string, number>): void {
  if (inProgress.size === 0) return;
  let oldest = "";
  let oldestStart = Infinity;
  for (const [id, start] of inProgress) {
    if (start < oldestStart) {
      oldestStart = start;
      oldest = id;
    }
  }
  if (!oldest) return;
  const elapsed = Math.max(0, Date.now() - oldestStart);
  const timeStr = formatElapsed(elapsed);
  const hint = SLOW_RESOURCE_HINTS[oldest];
  const extra =
    inProgress.size > 1 ? ` (+${inProgress.size - 1} more)` : "";
  const label = `  \u23f3 ${oldest}${extra}`;
  const suffix = hint
    ? `${timeStr}  \x1b[2m(${hint})\x1b[0m`
    : timeStr;
  const suffixLen = hint
    ? timeStr.length + 2 + `(${hint})`.length
    : timeStr.length;
  const COL = 72;
  const gap = Math.max(2, COL - label.length - suffixLen);
  process.stdout.write(`\r\x1b[K${label}${" ".repeat(gap)}${suffix}`);
  _waitingLineShown = true;
}

async function fetchNewEvents(
  stackName: string,
  awsEnv: Record<string, string | undefined>,
  seenEvents: Set<string>,
  since: string,
  inProgress: Map<string, number>
): Promise<void> {
  try {
    const { exitCode, stdout } = await awsCli(
      [
        "cloudformation",
        "describe-stack-events",
        "--stack-name",
        stackName,
        "--query",
        "StackEvents[*].[EventId,Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]",
        "--output",
        "json",
      ],
      awsEnv,
      { pipeStderr: true }
    );
    if (exitCode !== 0 || !stdout) return;
    const events = (JSON.parse(stdout) as (string | null)[][]).reverse();
    for (const [id, timestamp, logicalId, status, reason] of events) {
      if (!id || seenEvents.has(id)) continue;
      seenEvents.add(id);
      if (!timestamp || timestamp <= since) continue;

      if (status?.includes("IN_PROGRESS")) {
        if (logicalId && !inProgress.has(logicalId)) {
          inProgress.set(logicalId, new Date(timestamp).getTime());
        }
        continue;
      }

      const startTime = logicalId ? inProgress.get(logicalId) : undefined;
      if (logicalId) inProgress.delete(logicalId);

      const isStackRollbackComplete =
        logicalId === stackName && status === "ROLLBACK_COMPLETE";
      const isBad =
        !isStackRollbackComplete &&
        (status?.includes("FAILED") || status?.includes("ROLLBACK"));
      const icon = isBad
        ? "\x1b[31m\u2717\x1b[0m"
        : "\x1b[32m\u2713\x1b[0m";
      let prefix = `  ${icon} ${logicalId} \u2014 ${status}`;
      if (reason) prefix += `  (${reason})`;

      clearWaitingLine();

      if (startTime) {
        const elapsed =
          new Date(timestamp).getTime() - startTime;
        const timeStr = formatElapsed(elapsed);
        const visLen = stripAnsi(prefix).length;
        const COL = 72;
        const gap = Math.max(2, COL - visLen - timeStr.length);
        console.log(
          `${prefix}${" ".repeat(gap)}\x1b[2m${timeStr}\x1b[0m`
        );
      } else {
        console.log(prefix);
      }
    }
  } catch {}
}

export async function deployCommand(options?: { cellDir?: string; yes?: boolean }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const envMap = loadEnvFiles(cellDir, { stage: "cloud" });
  const resolved = resolveConfig(config, envMap, "cloud");

  // Validate: MOCK_JWT_SECRET should NOT be set for cloud
  if (resolved.envVars.MOCK_JWT_SECRET) {
    console.warn(
      "⚠ WARNING: MOCK_JWT_SECRET is set in envVars. This should NOT be used for cloud deployment!"
    );
  }

  const awsEnv: Record<string, string | undefined> = {};
  if (envMap.AWS_PROFILE) {
    awsEnv.AWS_PROFILE = envMap.AWS_PROFILE;
  }
  if (envMap.AWS_REGION) {
    awsEnv.AWS_REGION = envMap.AWS_REGION;
  }

  // 0. Verify AWS credentials early so auth issues surface before build
  {
    const { exitCode, stdout } = await awsCli(
      ["sts", "get-caller-identity", "--output", "json"],
      awsEnv,
      { pipeStderr: true }
    );
    if (exitCode !== 0) {
      const profile = awsEnv.AWS_PROFILE;
      const profileHint = profile ? ` (profile: ${profile})` : "";
      const loginCmd = profile ? `aws sso login --profile ${profile}` : "aws sso login";
      throw new Error(
        `AWS credentials are not valid${profileHint}.\n` +
          `  This usually means your SSO session has expired.\n` +
          `  → Run: ${loginCmd}`
      );
    }
    try {
      const identity = JSON.parse(stdout) as { Account?: string; Arn?: string };
      console.log(`AWS account: ${identity.Account ?? "unknown"} (${identity.Arn ?? "unknown"})`);
    } catch {}
  }

  // 1. Build
  console.log("\n=== Building ===");
  await buildCommand({ cellDir });

  // 2. Resolve hosted zone ID for auto-certificate
  if (resolved.domain && !resolved.domain.certificate) {
    const { exitCode: hzCode, stdout: hzOut } = await awsCli(
      [
        "route53",
        "list-hosted-zones-by-name",
        "--dns-name",
        resolved.domain.zone,
        "--max-items",
        "1",
        "--query",
        "HostedZones[0].[Id,Name]",
        "--output",
        "json",
      ],
      awsEnv
    );
    if (hzCode !== 0) {
      throw new Error(`Failed to look up Route53 hosted zone for "${resolved.domain.zone}"`);
    }
    const [zoneId, zoneName] = JSON.parse(hzOut || "[]") as string[];
    if (!zoneName || !zoneName.startsWith(resolved.domain.zone)) {
      throw new Error(
        `Route53 hosted zone "${resolved.domain.zone}" not found. Create it or provide a certificate ARN.`
      );
    }
    resolved.domain.hostedZoneId = zoneId.replace("/hostedzone/", "");
    console.log(`  Route53 zone: ${resolved.domain.zone} → ${resolved.domain.hostedZoneId}`);
  }

  // 3. Generate CloudFormation template
  console.log("\n=== Generating CloudFormation template ===");
  const cfnDir = resolve(cellDir, ".cell");
  mkdirSync(cfnDir, { recursive: true });
  const cfnTemplate = generateTemplate(resolved);
  const cfnPath = resolve(cfnDir, "cfn.yaml");
  writeFileSync(cfnPath, cfnTemplate);
  console.log(`  → .cell/cfn.yaml`);

  // 4. Package Lambda code and upload to S3
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
        awsEnv
      );
      if (exitCode !== 0) {
        throw new Error(`Failed to upload ${s3Key} to S3`);
      }

      template = template.replace(/S3Bucket: PLACEHOLDER/, `S3Bucket: ${artifactBucket}`);
      template = template.replace(new RegExp(`S3Key: build/${name}/code\\.zip`), `S3Key: ${s3Key}`);
    }

    const packagedPath = resolve(cfnDir, "cfn-packaged.yaml");
    writeFileSync(packagedPath, template);
    console.log(`  → .cell/cfn-packaged.yaml`);
  }

  // 4. Ensure Secrets Manager secrets
  if (Object.keys(resolved.secretRefs).length > 0) {
    console.log("\n=== Syncing secrets ===");
    for (const [, secretName] of Object.entries(resolved.secretRefs)) {
      const smName = `${resolved.name}/${secretName}`;
      const value = envMap[secretName];
      if (!value) {
        throw new Error(
          `Secret "${secretName}" is defined as !Secret in cell.yaml but not found in .env`
        );
      }
      const { exitCode: descCode } = await awsCli(
        ["secretsmanager", "describe-secret", "--secret-id", smName],
        awsEnv,
        { pipeStderr: true }
      );
      if (descCode !== 0) {
        const { exitCode: createCode } = await awsCli(
          ["secretsmanager", "create-secret", "--name", smName, "--secret-string", value],
          awsEnv
        );
        if (createCode !== 0) throw new Error(`Failed to create secret: ${smName}`);
        console.log(`  Created ${smName}`);
      } else {
        await awsCli(
          ["secretsmanager", "put-secret-value", "--secret-id", smName, "--secret-string", value],
          awsEnv
        );
        console.log(`  Updated ${smName}`);
      }
    }
  }

  // 6. Pre-deploy checks (e.g. CloudFront CNAME conflict, stack in ROLLBACK state)
  const stackName = resolved.name;
  let stackAlreadyExists = await stackExists(stackName, awsEnv);
  console.log("\n=== Pre-deploy checks ===");
  const runChecks = (stackExistsFlag: boolean) =>
    runPreDeployChecksFromDeploy(
      resolved,
      (args, env, opts) => awsCli(args, env, opts),
      awsEnv,
      stackExistsFlag,
      cellDir
    );
  for (;;) {
    stackAlreadyExists = await stackExists(stackName, awsEnv);
    try {
      await runChecks(stackAlreadyExists);
      break;
    } catch (e) {
      if (e instanceof PreDeployCheckError && e.resolution) {
        console.error("\n  ✗ Pre-deploy check failed\n");
        console.error("  " + e.message.replace(/\n/g, "\n  "));
        console.log("\n  Resolution: " + e.resolution.description);
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        const answer = await new Promise<string>((res) =>
          rl.question("\n  Apply this resolution? [y/N] ", res)
        );
        rl.close();
        if (/^y(es)?$/i.test(answer.trim())) {
          try {
            await e.resolution.apply();
            console.log("  Resolution applied. Re-running pre-deploy checks...\n");
          } catch (applyErr) {
            const applyMsg = applyErr instanceof Error ? applyErr.message : String(applyErr);
            console.error("\n  Failed to apply resolution: " + applyMsg + "\n");
            process.exit(1);
          }
        } else {
          console.error("\n  Exiting without deploying.\n");
          process.exit(1);
        }
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("\n  ✗ Pre-deploy check failed\n");
        console.error("  " + msg.replace(/\n/g, "\n  "));
        console.error("\n  Exiting without deploying.\n");
        process.exit(1);
      }
    }
  }
  console.log("  All checks passed.");

  // 7. Deploy CloudFormation stack
  console.log("\n=== Deploying CloudFormation stack ===");
  if (!stackAlreadyExists) {
    console.log("  Stack does not exist yet, creating new stack.");
  }
  const templateFile = resolved.backend ? resolve(cfnDir, "cfn-packaged.yaml") : cfnPath;

  const seenEvents = new Set<string>();
  const sinceTimestamp = stackAlreadyExists
    ? await getLatestEventTimestamp(stackName, awsEnv)
    : new Date().toISOString();

  const deployProc = Bun.spawn(
    [
      "aws",
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
    {
      cwd: cellDir,
      env: { ...process.env, ...awsEnv },
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const inProgress = new Map<string, number>();
  let deployDone = false;
  deployProc.exited.then(() => {
    deployDone = true;
  });

  let lastPollAt = 0;
  while (!deployDone) {
    const now = Date.now();
    if (now - lastPollAt >= 3000) {
      await fetchNewEvents(
        stackName,
        awsEnv,
        seenEvents,
        sinceTimestamp,
        inProgress
      );
      lastPollAt = Date.now();
    }
    showWaitingLine(inProgress);
    await Bun.sleep(1000);
  }
  clearWaitingLine();
  await fetchNewEvents(
    stackName,
    awsEnv,
    seenEvents,
    sinceTimestamp,
    inProgress
  );

  const deployExitCode = await deployProc.exited;
  if (deployExitCode !== 0) {
    const stderr = await new Response(deployProc.stderr).text();
    const useful = stderr.split("\n").filter((l) => !l.includes("Waiting for") && l.trim());
    if (useful.length) console.error(useful.join("\n"));
    const isEarlyValidation = /EarlyValidation|ResourceExistenceCheck/i.test(stderr);
    if (isEarlyValidation) {
      const { exitCode: csListCode, stdout: csListOut } = await awsCli(
        [
          "cloudformation",
          "list-change-sets",
          "--stack-name",
          stackName,
          "--query",
          "Summaries | sort_by(@, &CreationTime) | [-1].ChangeSetName",
          "--output",
          "text",
        ],
        awsEnv,
        { pipeStderr: true }
      );
      let changeSetName: string | null = null;
      if (csListCode === 0 && csListOut?.trim()) changeSetName = csListOut.trim();
      if (!changeSetName && csListCode !== 0) {
        console.error("\n  (Could not list change sets; run: aws cloudformation list-change-sets --stack-name " + stackName + ")");
      }
      if (changeSetName) {
        const { exitCode: descCsCode, stdout: descCsOut } = await awsCli(
          [
            "cloudformation",
            "describe-change-set",
            "--stack-name",
            stackName,
            "--change-set-name",
            changeSetName,
            "--query",
            "{Status:Status,StatusReason:StatusReason}",
            "--output",
            "json",
          ],
          awsEnv,
          { pipeStderr: true }
        );
        if (descCsCode === 0 && descCsOut) {
          try {
            const { Status } = JSON.parse(descCsOut) as { Status?: string };
            if (Status === "FAILED") {
              const { exitCode: evCode, stdout: evOut } = await awsCli(
                [
                  "cloudformation",
                  "describe-events",
                  "--stack-name",
                  stackName,
                  "--change-set-name",
                  changeSetName,
                  "--filters",
                  "FailedEvents=true",
                  "--max-items",
                  "25",
                  "--output",
                  "json",
                ],
                awsEnv,
                { pipeStderr: true }
              );
              if (evCode === 0 && evOut) {
                try {
                  const out = JSON.parse(evOut) as {
                    OperationEvents?: Array<{
                      EventType?: string;
                      LogicalResourceId?: string;
                      ResourceType?: string;
                      ValidationStatusReason?: string;
                      ResourceStatusReason?: string;
                      HookStatusReason?: string;
                    }>;
                  };
                  const events = out.OperationEvents ?? [];
                  const failed = events.filter(
                    (e) =>
                      e.EventType === "VALIDATION_ERROR" ||
                      e.EventType === "HOOK_INVOCATION_ERROR"
                  );
                  if (failed.length > 0) {
                    console.error("\n  Resource(s) that failed validation (from CloudFormation DescribeEvents API):");
                    for (const e of failed) {
                      const reason =
                        e.ValidationStatusReason ??
                        e.ResourceStatusReason ??
                        e.HookStatusReason ??
                        "no detail";
                      console.error(
                        `    ${e.LogicalResourceId ?? "?"} (${e.ResourceType ?? "?"}): ${reason}`
                      );
                    }
                    const s3Conflict = failed.find(
                      (e) =>
                        e.ResourceType === "AWS::S3::Bucket" &&
                        (e.ValidationStatusReason?.includes("already exists") ||
                          e.ResourceStatusReason?.includes("already exists"))
                    );
                    if (s3Conflict) {
                      console.error(
                        "\n  Tip: If you just deleted this bucket, wait 1–2 minutes (S3 eventual consistency) then retry."
                      );
                      console.error(
                        "  If you use a non-default AWS profile (e.g. in .env), delete the bucket with that profile:"
                      );
                      console.error(
                        "    AWS_PROFILE=yourprofile aws s3 rb s3://<bucket-name> --force"
                      );
                    }
                  } else {
                    console.error(
                      "\n  (No event detail; run: aws cloudformation describe-events --stack-name " +
                        stackName +
                        " --change-set-name " +
                        changeSetName +
                        " --filters FailedEvents=true)"
                    );
                  }
                } catch {
                  console.error(
                    "\n  (Run for detail: aws cloudformation describe-events --stack-name " +
                      stackName +
                      " --change-set-name " +
                      changeSetName +
                      " --filters FailedEvents=true)"
                  );
                }
              }
            }
          } catch {
            // ignore
          }
        }
      } else if (!changeSetName && csListCode === 0) {
        console.error("\n  (No change set found for stack " + stackName + "; run: aws cloudformation list-change-sets --stack-name " + stackName + ")");
      }
    }
    if (!isEarlyValidation) {
      const { exitCode: evCode, stdout: evOut } = await awsCli(
        [
          "cloudformation",
          "describe-stack-events",
          "--stack-name",
          stackName,
          "--max-items",
          "15",
          "--query",
          "StackEvents[*].{Reason:ResourceStatusReason,Resource:LogicalResourceId}",
          "--output",
          "json",
        ],
        awsEnv,
        { pipeStderr: true }
      );
      if (evCode === 0 && evOut) {
        try {
          const events = JSON.parse(evOut) as Array<{ Reason?: string; Resource?: string }>;
          const withReason = events.filter(
            (e) =>
              e.Reason &&
              (e.Reason.includes("EarlyValidation") ||
                e.Reason.includes("ResourceExistence") ||
                e.Reason.includes("FAILED"))
          );
          if (withReason.length > 0) {
            console.error("\n  Detail from stack events:");
            for (const e of withReason.slice(0, 3)) {
              console.error("    " + (e.Reason ?? "").replace(/\n/g, "\n    "));
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    }
    console.error("\nCloudFormation deploy failed");
    process.exit(1);
  }

  // 8. Get stack outputs
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
    awsEnv
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

  // 9. Sync Cognito callback URLs
  if (config.cognito && resolved.domain) {
    const userPoolId =
      typeof config.cognito.userPoolId === "string" ? config.cognito.userPoolId : "";
    const clientId = typeof config.cognito.clientId === "string" ? config.cognito.clientId : "";
    const cognitoRegion =
      typeof config.cognito.region === "string" ? config.cognito.region : undefined;

    if (userPoolId && clientId) {
      console.log("\n=== Syncing Cognito callback URLs ===");
      const domainCallback = `https://${resolved.domain.host}/oauth/callback`;
      const cognitoEnv = {
        ...awsEnv,
        ...(cognitoRegion ? { AWS_DEFAULT_REGION: cognitoRegion } : {}),
      };

      const { exitCode: descCode, stdout: clientJson } = await awsCli(
        [
          "cognito-idp",
          "describe-user-pool-client",
          "--user-pool-id",
          userPoolId,
          "--client-id",
          clientId,
          "--query",
          "UserPoolClient",
          "--output",
          "json",
        ],
        cognitoEnv
      );

      if (descCode === 0 && clientJson) {
        const client = JSON.parse(clientJson) as Record<string, unknown>;
        const callbacks = (client.CallbackURLs as string[]) ?? [];
        const logouts = (client.LogoutURLs as string[]) ?? [];
        const domainLogout = `https://${resolved.domain.host}`;

        let changed = false;
        if (!callbacks.includes(domainCallback)) {
          callbacks.push(domainCallback);
          changed = true;
        }
        if (!logouts.includes(domainLogout)) {
          logouts.push(domainLogout);
          changed = true;
        }

        if (changed) {
          delete client.ClientSecret;
          delete client.LastModifiedDate;
          delete client.CreationDate;
          client.CallbackURLs = callbacks;
          client.LogoutURLs = logouts;

          const tmpFile = resolve(cellDir, ".cell/cognito-client-update.json");
          writeFileSync(tmpFile, JSON.stringify(client));
          const { exitCode: updateCode } = await awsCli(
            ["cognito-idp", "update-user-pool-client", "--cli-input-json", `file://${tmpFile}`],
            cognitoEnv
          );
          if (updateCode !== 0) {
            console.error("  Failed to update Cognito callback URLs");
          } else {
            console.log(`  Added callback: ${domainCallback}`);
            console.log(`  Added logout:   ${domainLogout}`);
          }
        } else {
          console.log("  Callback URLs already configured");
        }
      }
    }
  }

  // 10. Upload static files
  if (resolved.static && resolved.static.length > 0 && frontendBucket) {
    console.log("\n=== Uploading static files ===");
    for (const mapping of resolved.static) {
      const srcDir = resolve(cellDir, mapping.src);
      const dest = mapping.dest.startsWith("/") ? mapping.dest.slice(1) : mapping.dest;
      console.log(`  Syncing ${mapping.src} → s3://${frontendBucket}/${dest}`);
      const { exitCode } = await awsCli(
        ["s3", "sync", srcDir, `s3://${frontendBucket}/${dest}`],
        awsEnv
      );
      if (exitCode !== 0) {
        console.error(`Failed to sync static files from ${mapping.src}`);
        process.exit(1);
      }
    }
  }

  // 11. Upload frontend build
  if (resolved.frontend && frontendBucket) {
    console.log("\n=== Uploading frontend ===");
    const frontendBuildDir = resolve(cellDir, ".cell/build/frontend");
    console.log(`  Syncing .cell/build/frontend → s3://${frontendBucket}/`);
    const { exitCode } = await awsCli(
      ["s3", "sync", frontendBuildDir, `s3://${frontendBucket}`, "--delete"],
      awsEnv
    );
    if (exitCode !== 0) {
      console.error("Failed to sync frontend to S3");
      process.exit(1);
    }
  }

  // 12. Invalidate CloudFront
  if (distributionId) {
    console.log("\n=== Invalidating CloudFront ===");
    const { exitCode, stdout: invOut } = await awsCli(
      [
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        distributionId,
        "--paths",
        "/*",
        "--output",
        "json",
      ],
      awsEnv
    );
    if (exitCode !== 0) {
      console.error("CloudFront invalidation failed");
      process.exit(1);
    }
    try {
      const inv = JSON.parse(invOut || "{}") as {
        Invalidation?: { Id?: string; Status?: string };
      };
      const id = inv.Invalidation?.Id ?? "unknown";
      const status = inv.Invalidation?.Status ?? "unknown";
      console.log(`  Invalidation ${id} created (${status})`);
    } catch {
      console.log("  Invalidation created");
    }
  }

  // 13. Print URLs
  console.log("\n=== Deploy complete! ===");
  if (resolved.domain) {
    console.log(`  Domain: https://${resolved.domain.host}`);
  }
  const cfUrl = outputs.FrontendUrl || outputs.CloudFrontUrl;
  if (cfUrl) {
    console.log(`  CloudFront URL: ${cfUrl}`);
  }
}
