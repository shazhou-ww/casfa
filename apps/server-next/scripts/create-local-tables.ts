#!/usr/bin/env bun
/**
 * Create server-next DynamoDB tables in local DynamoDB (Docker).
 *
 * Prerequisites:
 *   docker compose up -d dynamodb       # Port 7102 (dev, persistent)
 *   docker compose up -d dynamodb-test  # Port 7112 (local-test, in-memory)
 *
 * Usage:
 *   bun run scripts/create-local-tables.ts                    # dev @ 7102
 *   bun run scripts/create-local-tables.ts --stage local-test  # local-test @ 7112
 *   DYNAMODB_ENDPOINT=http://localhost:7112 bun run scripts/create-local-tables.ts --stage local-test
 *
 * Env:
 *   DYNAMODB_ENDPOINT  - default http://localhost:7102
 *   STAGE              - default dev (table prefix: casfa-next-${stage}-*)
 */
import {
  CreateTableCommand,
  type CreateTableCommandInput,
  DynamoDBClient,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";

function parseArgs(): { stage: string; endpoint: string } {
  const args = process.argv.slice(2);
  let stage = process.env.STAGE ?? "dev";
  let endpoint = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:7102";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stage" && args[i + 1]) {
      stage = args[++i] as string;
    } else if (args[i] === "--endpoint" && args[i + 1]) {
      endpoint = args[++i] as string;
    }
  }
  return { stage, endpoint };
}

export function createClient(endpoint: string): DynamoDBClient {
  return new DynamoDBClient({
    region: process.env.AWS_REGION ?? process.env.COGNITO_REGION ?? "us-east-1",
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
    },
  });
}

export async function isDynamoDBReady(endpoint: string): Promise<boolean> {
  try {
    const client = createClient(endpoint);
    await client.send(new ListTablesCommand({}));
    return true;
  } catch {
    return false;
  }
}

async function createTable(
  client: DynamoDBClient,
  input: CreateTableCommandInput
): Promise<void> {
  const name = input.TableName!;
  try {
    await client.send(new CreateTableCommand(input));
    console.log(`Created table: ${name}`);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "ResourceInUseException"
    ) {
      // already exists, skip
    } else {
      throw err;
    }
  }
}

export async function ensureTables(
  endpoint: string,
  stage: string
): Promise<void> {
  const client = createClient(endpoint);
  const delegatesTable = `casfa-next-${stage}-delegates`;
  const grantsTable = `casfa-next-${stage}-grants`;

  await createTable(client, {
    TableName: delegatesTable,
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
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
        IndexName: "realm-index",
        KeySchema: [
          { AttributeName: "gsi1pk", KeyType: "HASH" },
          { AttributeName: "gsi1sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  });

  await createTable(client, {
    TableName: grantsTable,
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
      { AttributeName: "gsi1pk", AttributeType: "S" },
      { AttributeName: "gsi1sk", AttributeType: "S" },
      { AttributeName: "gsi2pk", AttributeType: "S" },
      { AttributeName: "gsi2sk", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    BillingMode: "PAY_PER_REQUEST",
    GlobalSecondaryIndexes: [
      {
        IndexName: "realm-hash-index",
        KeySchema: [
          { AttributeName: "gsi1pk", KeyType: "HASH" },
          { AttributeName: "gsi1sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "realm-refresh-index",
        KeySchema: [
          { AttributeName: "gsi2pk", KeyType: "HASH" },
          { AttributeName: "gsi2sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  });
}

async function main(): Promise<void> {
  const { stage, endpoint } = parseArgs();
  console.log(`Creating tables for stage=${stage} at ${endpoint}...`);
  await ensureTables(endpoint, stage);
  console.log("Done.");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
