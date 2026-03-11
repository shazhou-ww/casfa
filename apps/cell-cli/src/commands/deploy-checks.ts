import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ResolvedConfig } from "../config/resolve-config.js";
import { toPascalCase } from "../generators/types.js";

/** Thrown when a pre-deploy check fails. May include an optional resolution the user can apply. */
export class PreDeployCheckError extends Error {
  constructor(
    message: string,
    public readonly resolution?: {
      description: string;
      apply: () => Promise<void>;
    }
  ) {
    super(message);
    this.name = "PreDeployCheckError";
  }
}

type AwsCliFn = (
  args: string[],
  env: Record<string, string | undefined>,
  opts?: { pipeStderr?: boolean }
) => Promise<{ exitCode: number; stdout: string }>;


/** Poll head-bucket until 404 (bucket name really gone) or timeout. */
async function waitForBucketGone(
  name: string,
  awsCli: AwsCliFn,
  awsEnv: Record<string, string | undefined>,
  maxWaitMs: number
): Promise<void> {
  const stepMs = 2000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const { exitCode } = await awsCli(
      ["s3api", "head-bucket", "--bucket", name],
      awsEnv,
      { pipeStderr: true }
    );
    if (exitCode !== 0) return;
    process.stderr.write(`  Waiting for S3 bucket "${name}" to be gone… (${Math.round((deadline - Date.now()) / 1000)}s left)\n`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new PreDeployCheckError(
    `Bucket "${name}" was deleted but still appears to exist after ${maxWaitMs / 1000}s. S3 eventual consistency may need more time.\n` +
      `  → Wait 1–2 minutes and run deploy again.`
  );
}

const UNHEALTHY_STACK_STATUSES = new Set([
  "ROLLBACK_COMPLETE",
  "ROLLBACK_FAILED",
  "CREATE_FAILED",
  "DELETE_FAILED",
  "REVIEW_IN_PROGRESS",
]);

async function getStackStatus(
  stackName: string,
  awsCli: AwsCliFn,
  awsEnv: Record<string, string | undefined>
): Promise<string | null> {
  const { exitCode, stdout } = await awsCli(
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stackName,
      "--query",
      "Stacks[0].StackStatus",
      "--output",
      "text",
    ],
    awsEnv,
    { pipeStderr: true }
  );
  if (exitCode !== 0 || !stdout?.trim()) return null;
  return stdout.trim();
}

async function runPreDeployChecks(
  resolved: ResolvedConfig,
  awsCli: AwsCliFn,
  awsEnv: Record<string, string | undefined>,
  stackExists: boolean,
  cellDir: string
): Promise<void> {
  const checks: Array<{ name: string; run: () => Promise<void> }> = [];

  // 1. Check stack state: unhealthy stacks (ROLLBACK_COMPLETE, REVIEW_IN_PROGRESS, etc.) must be deleted first
  let stackIsUnhealthy = false;
  if (stackExists) {
    checks.push({
      name: "CloudFormation stack state",
      run: async () => {
        const status = await getStackStatus(resolved.name, awsCli, awsEnv);
        if (!status || !UNHEALTHY_STACK_STATUSES.has(status)) return;
        stackIsUnhealthy = true;
        throw new PreDeployCheckError(
          `The stack "${resolved.name}" is in ${status} state and cannot be updated.\n` +
            `  → This usually happens after a failed deploy. The stack must be deleted before you can deploy again.`,
          {
            description: `Delete the stack "${resolved.name}" (${status}) and then continue with a fresh deploy.`,
            apply: async () => {
              const { exitCode: delCode } = await awsCli(
                ["cloudformation", "delete-stack", "--stack-name", resolved.name],
                awsEnv
              );
              if (delCode !== 0) {
                throw new Error(`Failed to delete stack: ${resolved.name}`);
              }
              console.log("  Waiting for stack deletion to complete...");
              const { exitCode: waitCode } = await awsCli(
                ["cloudformation", "wait", "stack-delete-complete", "--stack-name", resolved.name],
                awsEnv
              );
              if (waitCode !== 0) {
                throw new Error("Stack deletion did not complete in time or failed.");
              }
            },
          }
        );
      },
    });
  }

  // 2. Resource existence checks: run when stack doesn't exist OR is in an unhealthy state
  //    (both cases cause CloudFormation to CREATE resources, triggering ResourceExistenceCheck)
  const needsResourceChecks = () => !stackExists || stackIsUnhealthy;

  const bucketNames = [
    ...resolved.buckets.map((b) => b.bucketName),
    resolved.frontendBucketName,
  ].filter(Boolean);

  if (bucketNames.length > 0) {
    checks.push({
      name: "S3 bucket names available",
      run: async () => {
        if (!needsResourceChecks()) return;
        const existing: string[] = [];
        for (const name of bucketNames) {
          const { exitCode: headCode } = await awsCli(
            ["s3api", "head-bucket", "--bucket", name],
            awsEnv,
            { pipeStderr: true }
          );
          if (headCode === 0) {
            existing.push(name);
          }
        }
        if (existing.length > 0) {
          throw new PreDeployCheckError(
            `The following S3 bucket(s) already exist and would block stack creation: ${existing.join(", ")}.\n` +
              `  → This often happens after a failed deploy: the stack was deleted but buckets were retained.`,
            {
              description: `Empty and delete the existing bucket(s) (${existing.join(", ")}) so this stack can create them.`,
              apply: async () => {
                for (const bucket of existing) {
                  console.log(`  Emptying and deleting bucket: ${bucket}`);
                  const { exitCode: rmCode } = await awsCli(
                    ["s3", "rm", `s3://${bucket}`, "--recursive"],
                    awsEnv
                  );
                  if (rmCode !== 0) throw new Error(`Failed to empty bucket: ${bucket}`);
                  const { exitCode: delCode } = await awsCli(
                    ["s3api", "delete-bucket", "--bucket", bucket],
                    awsEnv
                  );
                  if (delCode !== 0) throw new Error(`Failed to delete bucket: ${bucket}`);
                  await waitForBucketGone(bucket, awsCli, awsEnv, 90_000);
                }
              },
            }
          );
        }
      },
    });
  }

  // 2b. S3 bucket replacement check: when bucket names change on an existing healthy stack,
  //     CloudFormation will replace the bucket (create new, delete old). Old non-empty buckets
  //     cause DELETE_FAILED. Detect this and offer to empty them before deploy.
  if (stackExists && !stackIsUnhealthy) {
    checks.push({
      name: "S3 bucket replacements",
      run: async () => {
        const expectedBuckets = new Map<string, string>();
        for (const bucket of resolved.buckets) {
          expectedBuckets.set(`${toPascalCase(bucket.key)}Bucket`, bucket.bucketName);
        }
        expectedBuckets.set("FrontendBucket", resolved.frontendBucketName);

        const { exitCode, stdout } = await awsCli(
          [
            "cloudformation",
            "describe-stack-resources",
            "--stack-name",
            resolved.name,
            "--query",
            "StackResources[?ResourceType=='AWS::S3::Bucket'].[LogicalResourceId,PhysicalResourceId]",
            "--output",
            "json",
          ],
          awsEnv,
          { pipeStderr: true }
        );
        if (exitCode !== 0 || !stdout) return;

        const currentBuckets = JSON.parse(stdout) as [string, string][];
        const bucketsToEmpty: { logicalId: string; oldName: string; newName: string | null }[] = [];

        for (const [logicalId, physicalId] of currentBuckets) {
          const expectedName = expectedBuckets.get(logicalId);
          if (expectedName === undefined) {
            bucketsToEmpty.push({ logicalId, oldName: physicalId, newName: null });
          } else if (expectedName !== physicalId) {
            bucketsToEmpty.push({ logicalId, oldName: physicalId, newName: expectedName });
          }
        }

        if (bucketsToEmpty.length === 0) return;

        const nonEmpty: typeof bucketsToEmpty = [];
        for (const b of bucketsToEmpty) {
          const { exitCode: lsCode, stdout: lsOut } = await awsCli(
            ["s3api", "list-objects-v2", "--bucket", b.oldName, "--max-keys", "1", "--query", "KeyCount", "--output", "text"],
            awsEnv,
            { pipeStderr: true }
          );
          if (lsCode === 0 && lsOut?.trim() !== "0") {
            nonEmpty.push(b);
          }
        }

        if (nonEmpty.length === 0) return;

        const details = nonEmpty
          .map((b) =>
            b.newName
              ? `${b.logicalId}: ${b.oldName} → ${b.newName}`
              : `${b.logicalId}: ${b.oldName} (will be removed)`
          )
          .join("\n  ");
        const oldNames = nonEmpty.map((b) => b.oldName);

        throw new PreDeployCheckError(
          `The following S3 bucket(s) will be replaced/removed and are not empty:\n  ${details}\n` +
            `  → CloudFormation cannot delete non-empty S3 buckets. They must be emptied first.`,
          {
            description: `Empty the old bucket(s) (${oldNames.join(", ")}) so CloudFormation can delete them during deployment.`,
            apply: async () => {
              for (const bucket of nonEmpty) {
                console.log(`  Emptying bucket: ${bucket.oldName}`);
                const { exitCode: rmCode } = await awsCli(
                  ["s3", "rm", `s3://${bucket.oldName}`, "--recursive"],
                  awsEnv
                );
                if (rmCode !== 0) throw new Error(`Failed to empty bucket: ${bucket.oldName}`);
              }
            },
          }
        );
      },
    });
  }

  if (resolved.tables.length > 0) {
    checks.push({
      name: "DynamoDB table names available",
      run: async () => {
        if (!needsResourceChecks()) return;
        const existing: string[] = [];
        for (const table of resolved.tables) {
          const { exitCode } = await awsCli(
            ["dynamodb", "describe-table", "--table-name", table.tableName],
            awsEnv,
            { pipeStderr: true }
          );
          if (exitCode === 0) existing.push(table.tableName);
        }
        if (existing.length === 0) return;
        throw new PreDeployCheckError(
          `The following DynamoDB table(s) already exist and would block stack creation: ${existing.join(", ")}.\n` +
            `  → This often happens after a failed deploy: the stack was deleted but tables were retained.`,
          {
            description: `Delete the existing table(s) (${existing.join(", ")}) so this stack can create them.`,
            apply: async () => {
              for (const tableName of existing) {
                console.log(`  Deleting table: ${tableName}`);
                const { exitCode: delCode } = await awsCli(
                  ["dynamodb", "delete-table", "--table-name", tableName],
                  awsEnv
                );
                if (delCode !== 0) throw new Error(`Failed to delete table: ${tableName}`);
              }
              console.log("  Waiting for table deletion to complete...");
              for (const tableName of existing) {
                const { exitCode: waitCode } = await awsCli(
                  ["dynamodb", "wait", "table-not-exists", "--table-name", tableName],
                  awsEnv
                );
                if (waitCode !== 0) throw new Error(`Table ${tableName} did not delete in time.`);
              }
            },
          }
        );
      },
    });
  }

  // 3. CloudFront CNAME conflict
  if (resolved.domain?.host) {
    checks.push({
      name: "CloudFront CNAME conflict",
      run: async () => {
        const { exitCode, stdout } = await awsCli(
          [
            "cloudfront",
            "list-distributions",
            "--query",
            "DistributionList.Items[*].{Id:Id,Aliases:Aliases.Items}",
            "--output",
            "json",
          ],
          awsEnv,
          { pipeStderr: true }
        );
        if (exitCode !== 0) return;
        type DistItem = { Id?: string; Aliases?: string[] };
        const items = (JSON.parse(stdout || "[]") ?? []) as DistItem[];
        const host = resolved.domain!.host;
        let ourDistributionId: string | null = null;
        if (stackExists && !stackIsUnhealthy) {
          const { exitCode: resCode, stdout: resOut } = await awsCli(
            [
              "cloudformation",
              "describe-stack-resources",
              "--stack-name",
              resolved.name,
              "--query",
              "StackResources[?LogicalResourceId=='FrontendCloudFront'].PhysicalResourceId",
              "--output",
              "text",
            ],
            awsEnv,
            { pipeStderr: true }
          );
          if (resCode === 0 && resOut?.trim()) ourDistributionId = resOut.trim();
        }
        for (const item of items) {
          const aliases = Array.isArray(item.Aliases) ? item.Aliases : [];
          if (!aliases.includes(host)) continue;
          if (ourDistributionId && item.Id === ourDistributionId) continue;
          const distributionId = item.Id ?? "unknown";
          throw new PreDeployCheckError(
            `The CNAME "${host}" is already used by another CloudFront distribution (Id: ${distributionId}).\n` +
              `  → Use a different domain (subdomain + DOMAIN_ROOT) in cell.yaml, or remove this CNAME from the other distribution.`,
            {
              description: `Remove the CNAME "${host}" from distribution ${distributionId} so this stack can use it.`,
              apply: async () => {
                const { exitCode: getCode, stdout: getOut } = await awsCli(
                  ["cloudfront", "get-distribution-config", "--id", distributionId, "--output", "json"],
                  awsEnv,
                  { pipeStderr: true }
                );
                if (getCode !== 0 || !getOut) {
                  throw new Error(`Failed to get distribution config: ${distributionId}`);
                }
                const { ETag, DistributionConfig } = JSON.parse(getOut) as {
                  ETag?: string;
                  DistributionConfig?: {
                    Aliases?: { Quantity?: number; Items?: string[] };
                    [k: string]: unknown;
                  };
                };
                if (!ETag || !DistributionConfig) {
                  throw new Error("Invalid get-distribution-config response");
                }
                const newItems = (DistributionConfig.Aliases?.Items ?? []).filter((a) => a !== host);
                const configOut = {
                  ...DistributionConfig,
                  Aliases: { Quantity: newItems.length, Items: newItems },
                };
                mkdirSync(resolve(cellDir, ".cell"), { recursive: true });
                const configPath = resolve(cellDir, ".cell/cf-distribution-config-temp.json");
                writeFileSync(configPath, JSON.stringify(configOut));
                try {
                  const { exitCode: updateCode } = await awsCli(
                    [
                      "cloudfront",
                      "update-distribution",
                      "--id",
                      distributionId,
                      "--if-match",
                      ETag,
                      "--distribution-config",
                      `file://${configPath}`,
                    ],
                    awsEnv
                  );
                  if (updateCode !== 0) throw new Error(`Failed to update distribution ${distributionId}`);
                } finally {
                  if (existsSync(configPath)) unlinkSync(configPath);
                }
              },
            }
          );
        }
      },
    });
  }

  // 4. DNS record conflict checks (delegated to provider)
  if (resolved.domain?.host) {
    checks.push({
      name: "DNS records available",
      run: async () => {
        if (!needsResourceChecks()) return;
        // Only Route53 needs conflict checks — Cloudflare uses upsert (idempotent)
        const dnsType = resolved.domain!.dns ?? "route53";
        if (dnsType !== "route53") return;

        const { Route53Provider } = await import("../dns/route53-provider.js");
        const provider = new Route53Provider();
        await provider.preDeployChecks(resolved, awsCli, awsEnv, stackExists, cellDir);
      },
    });
  }

  for (const check of checks) {
    await check.run();
  }
}

export async function runPreDeployChecksFromDeploy(
  resolved: ResolvedConfig,
  awsCliFn: AwsCliFn,
  awsEnv: Record<string, string | undefined>,
  stackExists: boolean,
  cellDir: string
): Promise<void> {
  await runPreDeployChecks(resolved, awsCliFn, awsEnv, stackExists, cellDir);
}
