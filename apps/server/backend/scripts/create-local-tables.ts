#!/usr/bin/env bun
/**
 * Create CASFA v2 DynamoDB tables in local DynamoDB.
 *
 * Prerequisites:
 *   docker compose up -d dynamodb       # Port 8700 (persistent)
 *   docker compose up -d dynamodb-test  # Port 8701 (in-memory)
 *
 * Usage:
 *   bun run backend/scripts/create-local-tables.ts              # Default port 8700
 *   bun run backend/scripts/create-local-tables.ts --port 8701  # Test DB
 *   bun run backend/scripts/create-local-tables.ts --delete     # Delete tables
 *
 * Env:
 *   DYNAMODB_ENDPOINT  - default http://localhost:8700
 *   TOKENS_TABLE       - default cas-tokens
 *   CAS_REALM_TABLE    - default cas-realm
 *   CAS_REFCOUNT_TABLE - default cas-refcount
 *   CAS_USAGE_TABLE    - default cas-usage
 */

import {
  CreateTableCommand,
  type CreateTableCommandInput,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";

// Parse --port argument
function parsePortArg(): number | undefined {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf("--port");
  if (portIndex !== -1 && args[portIndex + 1] !== undefined) {
    return Number.parseInt(args[portIndex + 1] as string, 10);
  }
  return undefined;
}

// Build endpoint from port or environment
function getEndpoint(portOverride?: number): string {
  if (portOverride) {
    return `http://localhost:${portOverride}`;
  }
  return process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8700";
}

const tokensTable = process.env.TOKENS_TABLE ?? "cas-tokens";
const realmTable = process.env.CAS_REALM_TABLE ?? "cas-realm";
const refCountTable = process.env.CAS_REFCOUNT_TABLE ?? "cas-refcount";
const usageTable = process.env.CAS_USAGE_TABLE ?? "cas-usage";

// Create a DynamoDB client for a specific endpoint
export function createClient(endpoint: string): DynamoDBClient {
  return new DynamoDBClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
    },
  });
}

// Default client (for backward compatibility)
const portArg = parsePortArg();
const endpoint = getEndpoint(portArg);
const client = createClient(endpoint);

async function createTable(
  dbClient: DynamoDBClient,
  input: CreateTableCommandInput
): Promise<void> {
  const name = input.TableName!;
  try {
    await dbClient.send(new CreateTableCommand(input));
    console.log(`Created table: ${name}`);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "ResourceInUseException"
    ) {
      console.log(`Table already exists: ${name}`);
    } else {
      throw err;
    }
  }
}

async function deleteTable(dbClient: DynamoDBClient, tableName: string): Promise<void> {
  try {
    await dbClient.send(new DeleteTableCommand({ TableName: tableName }));
    console.log(`Deleted table: ${tableName}`);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "ResourceNotFoundException"
    ) {
      // Table doesn't exist, ignore
    } else {
      throw err;
    }
  }
}

export async function listTables(dbClient: DynamoDBClient = client): Promise<string[]> {
  const result = await dbClient.send(new ListTablesCommand({}));
  return result.TableNames ?? [];
}

export async function createAllTables(dbClient: DynamoDBClient = client): Promise<void> {
  console.log(`Creating tables...\n`);

  // Tokens table (users, agents, tickets, roles, awp-pending, awp-pubkeys)
  // Uses composite key (pk, sk) to support different entity types in one table
  await createTable(dbClient, {
    TableName: tokensTable,
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "N" },
      { AttributeName: "gsi1pk", AttributeType: "S" },
      { AttributeName: "gsi1sk", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    BillingMode: "PAY_PER_REQUEST",
    GlobalSecondaryIndexes: [
      {
        IndexName: "userId-index",
        KeySchema: [
          { AttributeName: "userId", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "gsi1",
        KeySchema: [
          { AttributeName: "gsi1pk", KeyType: "HASH" },
          { AttributeName: "gsi1sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  });

  // Realm table (ownership, commits, depots)
  await createTable(dbClient, {
    TableName: realmTable,
    AttributeDefinitions: [
      { AttributeName: "realm", AttributeType: "S" },
      { AttributeName: "key", AttributeType: "S" },
      { AttributeName: "gsi1pk", AttributeType: "S" },
      { AttributeName: "gsi1sk", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "realm", KeyType: "HASH" },
      { AttributeName: "key", KeyType: "RANGE" },
    ],
    BillingMode: "PAY_PER_REQUEST",
    GlobalSecondaryIndexes: [
      {
        IndexName: "by-key",
        KeySchema: [
          { AttributeName: "key", KeyType: "HASH" },
          { AttributeName: "realm", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "KEYS_ONLY" },
      },
      {
        IndexName: "gsi1",
        KeySchema: [
          { AttributeName: "gsi1pk", KeyType: "HASH" },
          { AttributeName: "gsi1sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  });

  // Reference count table for GC and usage tracking
  await createTable(dbClient, {
    TableName: refCountTable,
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
      { AttributeName: "gcStatus", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "N" },
    ],
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    BillingMode: "PAY_PER_REQUEST",
    GlobalSecondaryIndexes: [
      {
        IndexName: "by-gc-status",
        KeySchema: [
          { AttributeName: "gcStatus", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "by-key",
        KeySchema: [
          { AttributeName: "sk", KeyType: "HASH" },
          { AttributeName: "pk", KeyType: "RANGE" },
        ],
        Projection: {
          ProjectionType: "INCLUDE",
          NonKeyAttributes: ["count"],
        },
      },
    ],
  });

  // Usage table for quota management
  await createTable(dbClient, {
    TableName: usageTable,
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    BillingMode: "PAY_PER_REQUEST",
  });
}

export async function deleteAllTables(dbClient: DynamoDBClient = client): Promise<void> {
  console.log(`Deleting tables...\n`);
  await deleteTable(dbClient, tokensTable);
  await deleteTable(dbClient, realmTable);
  await deleteTable(dbClient, refCountTable);
  await deleteTable(dbClient, usageTable);
}

// Run if executed directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const shouldDelete = args.includes("--delete");

  if (shouldDelete) {
    deleteAllTables()
      .then(() => {
        console.log("\nAll tables deleted.");
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else {
    createAllTables()
      .then(() => {
        console.log("\nDone. Set in .env:");
        console.log(`  DYNAMODB_ENDPOINT=${endpoint}`);
        console.log(`  TOKENS_TABLE=${tokensTable}`);
        console.log(`  CAS_REALM_TABLE=${realmTable}`);
        console.log(`  CAS_REFCOUNT_TABLE=${refCountTable}`);
        console.log(`  CAS_USAGE_TABLE=${usageTable}`);
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  }
}
