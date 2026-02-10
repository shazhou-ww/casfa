#!/usr/bin/env bun
/**
 * CASFA Dev Data Cleanup Script
 *
 * Cleans up dev/test data from both S3 and DynamoDB.
 *
 * Usage:
 *   bun run backend/scripts/dev-clean.ts                  # Interactive: prompt before deleting
 *   bun run backend/scripts/dev-clean.ts --yes            # Auto-confirm (non-interactive)
 *   bun run backend/scripts/dev-clean.ts --s3-only        # Only clean S3
 *   bun run backend/scripts/dev-clean.ts --db-only        # Only clean DynamoDB
 *   bun run backend/scripts/dev-clean.ts --realm <id>     # Only clean a specific realm (userId)
 *   bun run backend/scripts/dev-clean.ts --dry-run        # Show what would be deleted
 *   bun run backend/scripts/dev-clean.ts --no-keep-roles  # Also delete user role records (admin, etc.)
 *
 * Environment variables (loaded from root .env):
 *   CAS_BUCKET          - S3 bucket name
 *   CAS_PREFIX           - S3 key prefix (default: dev/cas/blake3s/)
 *   CAS_REGION           - AWS region for S3
 *   AWS_PROFILE          - AWS SSO profile
 *   TOKENS_TABLE         - DynamoDB tokens table (default: cas-tokens)
 *   CAS_REALM_TABLE      - DynamoDB realm table (default: cas-realm)
 *   CAS_REFCOUNT_TABLE   - DynamoDB refcount table (default: cas-refcount)
 *   CAS_USAGE_TABLE      - DynamoDB usage table (default: cas-usage)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline";

// Load .env from monorepo root
const monorepoRoot = resolve(import.meta.dir, "../../../../");
const envPath = resolve(monorepoRoot, ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  BatchWriteItemCommand,
  DynamoDBClient,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { Command } from "commander";

// ============================================================================
// Config
// ============================================================================

const bucket = process.env.CAS_BUCKET ?? "cas-bucket";
const prefix = process.env.CAS_PREFIX ?? "dev/cas/blake3s/";
const s3Region = process.env.CAS_REGION || "us-west-2";
const dbRegion = process.env.AWS_REGION ?? process.env.COGNITO_REGION ?? "us-east-1";

const tokensTable = process.env.TOKENS_TABLE ?? "cas-tokens";
const realmTable = process.env.CAS_REALM_TABLE ?? "cas-realm";
const refCountTable = process.env.CAS_REFCOUNT_TABLE ?? "cas-refcount";
const usageTable = process.env.CAS_USAGE_TABLE ?? "cas-usage";

// ============================================================================
// Helpers
// ============================================================================

function createS3(): S3Client {
  return new S3Client({ region: s3Region });
}

function createDynamo(): DynamoDBClient {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  if (endpoint) {
    return new DynamoDBClient({
      region: dbRegion,
      endpoint,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
      },
    });
  }
  return new DynamoDBClient({ region: dbRegion });
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// ============================================================================
// S3 Cleanup
// ============================================================================

async function cleanS3(dryRun: boolean): Promise<number> {
  const s3 = createS3();
  let totalDeleted = 0;
  let continuationToken: string | undefined;

  console.log(`\n🪣 S3 Cleanup`);
  console.log(`   Bucket: ${bucket}`);
  console.log(`   Prefix: ${prefix}`);

  do {
    const listResult = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      })
    );

    const objects = listResult.Contents ?? [];
    if (objects.length === 0) break;

    if (dryRun) {
      for (const obj of objects) {
        console.log(`   [dry-run] Would delete: ${obj.Key}`);
      }
      totalDeleted += objects.length;
    } else {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: objects.map((o) => ({ Key: o.Key! })),
            Quiet: true,
          },
        })
      );
      totalDeleted += objects.length;
      process.stdout.write(`   Deleted ${totalDeleted} objects...\r`);
    }

    continuationToken = listResult.NextContinuationToken;
  } while (continuationToken);

  console.log(`   ✅ S3: ${totalDeleted} objects ${dryRun ? "would be " : ""}deleted`);
  return totalDeleted;
}

// ============================================================================
// DynamoDB Cleanup
// ============================================================================

interface ScanDeleteOptions {
  dryRun: boolean;
  /** Optional realm filter — only delete items belonging to this realm */
  realm?: string;
  /** Preserve user role records (USER#.../ROLE) — default true */
  keepRoles?: boolean;
}

/**
 * Scan an entire DynamoDB table and delete all (or filtered) items in batches.
 * Returns number of items deleted.
 */
async function scanAndDelete(
  dynamo: DynamoDBClient,
  tableName: string,
  hashKey: string,
  rangeKey: string,
  options: ScanDeleteOptions
): Promise<number> {
  let totalDeleted = 0;
  let totalSkippedRoles = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  // Build filter expression for realm-scoped cleanup
  const filterExpression = options.realm
    ? `#pk = :realm`
    : undefined;
  const expressionNames = options.realm
    ? { "#pk": hashKey }
    : undefined;
  const expressionValues = options.realm
    ? { ":realm": { S: options.realm } }
    : undefined;

  do {
    const scanResult = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        // Only fetch the keys we need
        ProjectionExpression: `#hk, #rk`,
        ExpressionAttributeNames: {
          "#hk": hashKey,
          "#rk": rangeKey,
          ...expressionNames,
        },
        ...(filterExpression
          ? {
              FilterExpression: filterExpression,
              ExpressionAttributeValues: expressionValues,
            }
          : {}),
        ExclusiveStartKey: lastEvaluatedKey as Record<string, { S: string }>,
      })
    );

    const items = scanResult.Items ?? [];
    if (items.length === 0) {
      lastEvaluatedKey = scanResult.LastEvaluatedKey as Record<string, unknown> | undefined;
      if (!lastEvaluatedKey) break;
      continue;
    }

    // Filter out role records if keepRoles is set
    const filteredItems = options.keepRoles
      ? items.filter((item) => {
          const sk = item[rangeKey]?.S ?? "";
          const pk = item[hashKey]?.S ?? "";
          if (sk === "ROLE" && pk.startsWith("USER#")) {
            return false; // preserve role records
          }
          return true;
        })
      : items;

    const skippedCount = items.length - filteredItems.length;
    if (skippedCount > 0) {
      totalSkippedRoles += skippedCount;
    }

    if (options.dryRun) {
      for (const item of filteredItems) {
        const pk = item[hashKey]?.S ?? "?";
        const sk = item[rangeKey]?.S ?? item[rangeKey]?.N ?? "?";
        console.log(`   [dry-run] ${tableName}: ${pk} / ${sk}`);
      }
      totalDeleted += filteredItems.length;
    } else {
      // BatchWriteItem supports max 25 items per call
      for (let i = 0; i < filteredItems.length; i += 25) {
        const batch = filteredItems.slice(i, i + 25);
        if (batch.length === 0) continue;
        await dynamo.send(
          new BatchWriteItemCommand({
            RequestItems: {
              [tableName]: batch.map((item) => ({
                DeleteRequest: {
                  Key: {
                    [hashKey]: item[hashKey]!,
                    [rangeKey]: item[rangeKey]!,
                  },
                },
              })),
            },
          })
        );
        totalDeleted += batch.length;
        process.stdout.write(`   ${tableName}: deleted ${totalDeleted} items...\r`);
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  if (totalSkippedRoles > 0) {
    console.log(`   ⏭️  ${tableName}: kept ${totalSkippedRoles} user role record(s)`);
  }

  return totalDeleted;
}

/**
 * For cas-tokens table, when filtering by realm we need a different approach:
 * realm is not a primary key — it's stored as an attribute or in GSI1.
 * We scan with a filter on the `realm` attribute.
 */
async function scanAndDeleteTokensByRealm(
  dynamo: DynamoDBClient,
  tableName: string,
  realm: string,
  dryRun: boolean
): Promise<number> {
  let totalDeleted = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const scanResult = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: "pk, sk",
        FilterExpression: "#r = :realm OR begins_with(pk, :realmPrefix)",
        ExpressionAttributeNames: { "#r": "realm" },
        ExpressionAttributeValues: {
          ":realm": { S: realm },
          ":realmPrefix": { S: `OWN#${realm}#` },
        },
        ExclusiveStartKey: lastEvaluatedKey as Record<string, { S: string }>,
      })
    );

    const items = scanResult.Items ?? [];
    if (items.length > 0) {
      if (dryRun) {
        for (const item of items) {
          console.log(`   [dry-run] ${tableName}: ${item.pk?.S} / ${item.sk?.S}`);
        }
        totalDeleted += items.length;
      } else {
        for (let i = 0; i < items.length; i += 25) {
          const batch = items.slice(i, i + 25);
          await dynamo.send(
            new BatchWriteItemCommand({
              RequestItems: {
                [tableName]: batch.map((item) => ({
                  DeleteRequest: {
                    Key: { pk: item.pk!, sk: item.sk! },
                  },
                })),
              },
            })
          );
          totalDeleted += batch.length;
          process.stdout.write(`   ${tableName}: deleted ${totalDeleted} items...\r`);
        }
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return totalDeleted;
}

async function cleanDynamoDB(options: ScanDeleteOptions): Promise<number> {
  const dynamo = createDynamo();
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? "AWS (default)";

  console.log(`\n📦 DynamoDB Cleanup`);
  console.log(`   Endpoint: ${endpoint}`);
  if (options.realm) {
    console.log(`   Realm filter: ${options.realm}`);
  } else {
    console.log(`   Scope: ALL items in all tables`);
  }
  console.log(`   Tables: ${tokensTable}, ${realmTable}, ${refCountTable}, ${usageTable}`);

  let total = 0;

  if (options.keepRoles) {
    console.log(`   🛡️  Preserving user role records (use --no-keep-roles to delete them too)`);
  }

  // cas-tokens (pk/sk) — special handling for realm filter
  if (options.realm) {
    const count = await scanAndDeleteTokensByRealm(dynamo, tokensTable, options.realm, options.dryRun);
    console.log(`   ${tokensTable}: ${count} items ${options.dryRun ? "would be " : ""}deleted`);
    total += count;
  } else {
    const count = await scanAndDelete(dynamo, tokensTable, "pk", "sk", options);
    console.log(`   ${tokensTable}: ${count} items ${options.dryRun ? "would be " : ""}deleted`);
    total += count;
  }

  // cas-realm (realm/key)
  const realmCount = await scanAndDelete(dynamo, realmTable, "realm", "key", options);
  console.log(`   ${realmTable}: ${realmCount} items ${options.dryRun ? "would be " : ""}deleted`);
  total += realmCount;

  // cas-refcount (pk/sk) — pk is the realm when filtering
  if (options.realm) {
    const count = await scanAndDelete(dynamo, refCountTable, "pk", "sk", {
      ...options,
      realm: options.realm,
    });
    console.log(`   ${refCountTable}: ${count} items ${options.dryRun ? "would be " : ""}deleted`);
    total += count;
  } else {
    const count = await scanAndDelete(dynamo, refCountTable, "pk", "sk", options);
    console.log(`   ${refCountTable}: ${count} items ${options.dryRun ? "would be " : ""}deleted`);
    total += count;
  }

  // cas-usage (pk/sk)
  if (options.realm) {
    // Usage items have pk = realm or pk = QUOTA#realm
    const count = await scanAndDelete(dynamo, usageTable, "pk", "sk", options);
    console.log(`   ${usageTable}: ${count} items ${options.dryRun ? "would be " : ""}deleted`);
    total += count;
  } else {
    const count = await scanAndDelete(dynamo, usageTable, "pk", "sk", options);
    console.log(`   ${usageTable}: ${count} items ${options.dryRun ? "would be " : ""}deleted`);
    total += count;
  }

  console.log(`   ✅ DynamoDB: ${total} total items ${options.dryRun ? "would be " : ""}deleted`);
  return total;
}

// ============================================================================
// Main
// ============================================================================

const program = new Command();

program
  .name("dev-clean")
  .description("Clean up dev/test data from S3 and DynamoDB")
  .option("--yes, -y", "Auto-confirm without prompting")
  .option("--dry-run", "Show what would be deleted without actually deleting")
  .option("--s3-only", "Only clean S3 objects")
  .option("--db-only", "Only clean DynamoDB tables")
  .option("--realm <id>", "Only clean data for a specific realm (userId)")
  .option("--no-keep-roles", "Also delete user role records (admin/authorized)")
  .action(async (options) => {
    const dryRun = !!options.dryRun;
    const autoYes = !!options.yes;
    const s3Only = !!options.s3Only;
    const dbOnly = !!options.dbOnly;
    const realm = options.realm as string | undefined;
    const keepRoles = options.keepRoles !== false;

    console.log("=".repeat(60));
    console.log("CASFA Dev Data Cleanup");
    console.log("=".repeat(60));

    if (dryRun) {
      console.log("\n🔍 DRY RUN — no data will be deleted\n");
    }

    // Summary
    const targets: string[] = [];
    if (!dbOnly) targets.push(`S3 (s3://${bucket}/${prefix}*)`);
    if (!s3Only) {
      const tables = `DynamoDB (${[tokensTable, realmTable, refCountTable, usageTable].join(", ")})`;
      targets.push(realm ? `${tables} [realm: ${realm}]` : tables);
    }
    console.log("Targets:");
    for (const t of targets) console.log(`  • ${t}`);

    if (!dryRun && !autoYes) {
      console.log();
      const confirmed = await promptYesNo("⚠️  This will permanently delete data. Continue?");
      if (!confirmed) {
        console.log("Aborted.");
        process.exit(0);
      }
    }

    let s3Count = 0;
    let dbCount = 0;

    if (!dbOnly) {
      s3Count = await cleanS3(dryRun);
    }

    if (!s3Only) {
      dbCount = await cleanDynamoDB({ dryRun, realm, keepRoles });
    }

    console.log("\n" + "=".repeat(60));
    console.log(
      `Done. ${dryRun ? "Would delete" : "Deleted"}: ${s3Count} S3 objects, ${dbCount} DynamoDB items`
    );
    console.log("=".repeat(60));
  });

program.parse();
