#!/usr/bin/env bun
/**
 * Set user role to admin in DynamoDB
 *
 * This script directly accesses DynamoDB to set a user as admin.
 * Useful for initial setup when there's no admin yet.
 *
 * Usage:
 *   # Local DynamoDB (uses DYNAMODB_ENDPOINT from .env)
 *   bun run backend/scripts/set-admin.ts <user-id>
 *
 *   # AWS DynamoDB (ignores DYNAMODB_ENDPOINT)
 *   bun run backend/scripts/set-admin.ts --aws <user-id>
 *
 *   # List current admins
 *   bun run backend/scripts/set-admin.ts --list
 *   bun run backend/scripts/set-admin.ts --list --aws
 *
 *   # Revoke admin (set to unauthorized)
 *   bun run backend/scripts/set-admin.ts --revoke <user-id>
 *
 *   # Migrate UUID format to user:base32 format
 *   bun run backend/scripts/set-admin.ts --migrate
 *   bun run backend/scripts/set-admin.ts --migrate --aws
 *
 * User ID Format:
 *   Accepts both UUID format (340804d8-50d1-7022-08cc-c93a7198cc99)
 *   and user:base32 format (user:A6JCHNMFWRT90AXMYWHJ8HKS90).
 *   UUIDs are automatically converted to user:base32 format.
 *
 * Environment:
 *   TOKENS_TABLE - DynamoDB table name (default: cas-tokens)
 *   DYNAMODB_ENDPOINT - Local DynamoDB endpoint (ignored with --aws)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createUserRolesDb } from "../src/db/user-roles.ts";
import { normalizeUserId } from "../src/util/encoding.ts";

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

// Parse arguments
const args = process.argv.slice(2);
const useAws = args.includes("--aws");
const listOnly = args.includes("--list");
const revoke = args.includes("--revoke");
const migrate = args.includes("--migrate");

// Filter out flags to get user ID input
const userIdInput = args.filter((arg) => !arg.startsWith("--"))[0];

if (!listOnly && !migrate && !userIdInput) {
  console.error("Usage:");
  console.error("  bun run backend/scripts/set-admin.ts <user-id>           # Set admin (local)");
  console.error("  bun run backend/scripts/set-admin.ts --aws <user-id>     # Set admin (AWS)");
  console.error("  bun run backend/scripts/set-admin.ts --list              # List admins");
  console.error("  bun run backend/scripts/set-admin.ts --revoke <user-id>  # Revoke admin");
  console.error(
    "  bun run backend/scripts/set-admin.ts --migrate           # Migrate UUIDs to user:base32"
  );
  console.error("");
  console.error("User ID can be:");
  console.error("  - UUID format: 340804d8-50d1-7022-08cc-c93a7198cc99");
  console.error("  - User ID format: user:A6JCHNMFWRT90AXMYWHJ8HKS90");
  process.exit(1);
}

// Normalize user ID (convert UUID to user:base32 format if needed)
let userId: string | undefined;
if (userIdInput) {
  try {
    userId = normalizeUserId(userIdInput);
    if (userId !== userIdInput) {
      console.log(`Normalized user ID: ${userIdInput} -> ${userId}`);
    }
  } catch (e) {
    console.error(`Invalid user ID format: ${userIdInput}`);
    console.error((e as Error).message);
    process.exit(1);
  }
}

// Configure DynamoDB client
const tableName = process.env.TOKENS_TABLE ?? "cas-tokens";
const endpoint = useAws ? undefined : process.env.DYNAMODB_ENDPOINT;

console.log("=".repeat(60));
console.log("CASFA v2 - Set Admin");
console.log("=".repeat(60));
console.log();
console.log(`Table:    ${tableName}`);
console.log(`Database: ${endpoint ? `Local (${endpoint})` : "AWS"}`);
console.log();

// Create DynamoDB client
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-1",
  ...(endpoint && { endpoint }),
});

const docClient = DynamoDBDocumentClient.from(ddbClient);
const userRolesDb = createUserRolesDb({ tableName, client: docClient });

async function main() {
  if (migrate) {
    // Migrate UUID format to user:base32 format
    console.log("Migrating user IDs from UUID to user:base32 format...\n");
    const roles = await userRolesDb.listRoles();

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let migratedCount = 0;

    for (const { userId: oldUserId, role } of roles) {
      if (uuidPattern.test(oldUserId)) {
        const newUserId = normalizeUserId(oldUserId);
        console.log(`Migrating: ${oldUserId} -> ${newUserId}`);

        // Set new format
        await userRolesDb.setRole(newUserId, role);
        // Remove old format
        await userRolesDb.revoke(oldUserId);
        migratedCount++;
      } else if (oldUserId.startsWith("user:")) {
        console.log(`Already migrated: ${oldUserId}`);
      } else {
        console.log(`Unknown format (skipped): ${oldUserId}`);
      }
    }

    console.log(`\n✓ Migrated ${migratedCount} user(s)`);
    return;
  }

  if (listOnly) {
    // List all users with roles
    console.log("Listing users with roles...\n");
    const roles = await userRolesDb.listRoles();

    if (roles.length === 0) {
      console.log("No users with assigned roles found.");
    } else {
      console.log(`${"User ID".padEnd(40)}Role`);
      console.log("-".repeat(50));
      for (const { userId, role } of roles) {
        console.log(`${userId.padEnd(40)}${role}`);
      }
    }
    return;
  }

  if (revoke) {
    // Revoke user role
    console.log(`Revoking role for user: ${userId}`);
    await userRolesDb.revoke(userId!);
    console.log("\n✓ User role revoked (now unauthorized)");
    return;
  }

  // Set user as admin
  console.log(`Setting user as admin: ${userId}`);

  // Check current role
  const currentRole = await userRolesDb.getRole(userId!);
  console.log(`Current role: ${currentRole}`);

  if (currentRole === "admin") {
    console.log("\n✓ User is already an admin");
    return;
  }

  // Set admin role
  await userRolesDb.setRole(userId!, "admin");
  console.log("\n✓ User is now an admin");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nError:", err.message);
    process.exit(1);
  });
