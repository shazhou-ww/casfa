import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ResolvedConfig } from "../config/resolve-config.js";

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
          const { exitCode } = await awsCli(
            ["s3api", "head-bucket", "--bucket", name],
            awsEnv,
            { pipeStderr: true }
          );
          if (exitCode === 0) existing.push(name);
        }
        if (existing.length === 0) return;
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
              `  → Use a different domain.host in cell.yaml, or remove this CNAME from the other distribution.`,
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

  // 4. Route53 DNS record conflict (stale records from previous failed deploys)
  if (resolved.domain?.host) {
    checks.push({
      name: "Route53 DNS records available",
      run: async () => {
        if (!needsResourceChecks()) return;
        const host = resolved.domain!.host;
        const zone = resolved.domain!.zone;

        const { exitCode: hzCode, stdout: hzOut } = await awsCli(
          [
            "route53",
            "list-hosted-zones-by-name",
            "--dns-name",
            zone,
            "--max-items",
            "1",
            "--query",
            "HostedZones[0].[Id,Name]",
            "--output",
            "json",
          ],
          awsEnv,
          { pipeStderr: true }
        );
        if (hzCode !== 0 || !hzOut) return;
        const parsed = JSON.parse(hzOut) as string[];
        if (!parsed[1]?.startsWith(zone)) return;
        const hostedZoneId = parsed[0].replace("/hostedzone/", "");

        const { exitCode: rrCode, stdout: rrOut } = await awsCli(
          [
            "route53",
            "list-resource-record-sets",
            "--hosted-zone-id",
            hostedZoneId,
            "--query",
            `ResourceRecordSets[?Name=='${host}.']`,
            "--output",
            "json",
          ],
          awsEnv,
          { pipeStderr: true }
        );
        if (rrCode !== 0 || !rrOut) return;
        type R53Record = {
          Name: string;
          Type: string;
          AliasTarget?: {
            DNSName: string;
            HostedZoneId: string;
            EvaluateTargetHealth: boolean;
          };
          TTL?: number;
          ResourceRecords?: Array<{ Value: string }>;
        };
        const records = JSON.parse(rrOut) as R53Record[];
        const conflicting = records.filter(
          (r) => r.Type === "A" || r.Type === "AAAA"
        );
        if (conflicting.length === 0) return;

        const types = conflicting.map((r) => r.Type).join(", ");
        throw new PreDeployCheckError(
          `DNS record(s) for "${host}" already exist (${types}) and would block stack creation.\n` +
            `  → This often happens after a failed deploy: the stack was deleted but DNS records were retained.`,
          {
            description: `Delete the existing DNS record(s) for "${host}" (${types}) so this stack can create them.`,
            apply: async () => {
              const changeBatch = JSON.stringify({
                Changes: conflicting.map((r) => ({
                  Action: "DELETE",
                  ResourceRecordSet: r,
                })),
              });
              mkdirSync(resolve(cellDir, ".cell"), { recursive: true });
              const tmpPath = resolve(
                cellDir,
                ".cell/dns-delete-batch.json"
              );
              writeFileSync(tmpPath, changeBatch);
              try {
                const { exitCode: delCode } = await awsCli(
                  [
                    "route53",
                    "change-resource-record-sets",
                    "--hosted-zone-id",
                    hostedZoneId,
                    "--change-batch",
                    `file://${tmpPath}`,
                  ],
                  awsEnv
                );
                if (delCode !== 0)
                  throw new Error(
                    `Failed to delete DNS records for ${host}`
                  );
                console.log(
                  `  Deleted ${conflicting.length} DNS record(s) for ${host}`
                );
              } finally {
                if (existsSync(tmpPath)) unlinkSync(tmpPath);
              }
            },
          }
        );
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
