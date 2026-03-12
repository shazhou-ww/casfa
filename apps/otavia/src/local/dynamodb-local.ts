import {
  type AttributeDefinition,
  CreateTableCommand,
  type CreateTableCommandInput,
  DynamoDBClient,
  type GlobalSecondaryIndex,
  type KeySchemaElement,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import type { TableConfig } from "../config/cell-yaml-schema.js";

function attrType(t: string): "S" | "N" | "B" {
  const upper = t.toUpperCase();
  if (upper === "S" || upper === "N" || upper === "B") return upper;
  return "S";
}

export function buildCreateTableInput(
  tableName: string,
  config: TableConfig
): CreateTableCommandInput {
  const keyEntries = Object.entries(config.keys);
  const keySchema: KeySchemaElement[] = keyEntries.map(([name], i) => ({
    AttributeName: name,
    KeyType: i === 0 ? "HASH" : "RANGE",
  }));

  const attrSet = new Map<string, string>();
  for (const [name, type] of keyEntries) {
    attrSet.set(name, attrType(type));
  }

  const gsiList: GlobalSecondaryIndex[] = [];
  if (config.gsi) {
    for (const [gsiName, gsiConfig] of Object.entries(config.gsi)) {
      const gsiKeyEntries = Object.entries(gsiConfig.keys);
      const gsiKeySchema: KeySchemaElement[] = gsiKeyEntries.map(([name], i) => ({
        AttributeName: name,
        KeyType: i === 0 ? "HASH" : "RANGE",
      }));

      for (const [name, type] of gsiKeyEntries) {
        attrSet.set(name, attrType(type));
      }

      gsiList.push({
        IndexName: gsiName,
        KeySchema: gsiKeySchema,
        Projection: {
          ProjectionType: (gsiConfig.projection?.toUpperCase() as "ALL" | "KEYS_ONLY") || "ALL",
        },
      });
    }
  }

  const attributeDefinitions: AttributeDefinition[] = [...attrSet.entries()].map(
    ([name, type]) => ({
      AttributeName: name,
      AttributeType: type as "S" | "N" | "B",
    })
  );

  const input: CreateTableCommandInput = {
    TableName: tableName,
    KeySchema: keySchema,
    AttributeDefinitions: attributeDefinitions,
    BillingMode: "PAY_PER_REQUEST",
  };

  if (gsiList.length > 0) {
    input.GlobalSecondaryIndexes = gsiList;
  }

  return input;
}

function makeClient(endpoint: string): DynamoDBClient {
  return new DynamoDBClient({
    endpoint,
    region: "local",
    credentials: {
      accessKeyId: "local",
      secretAccessKey: "local",
    },
  });
}

export async function isDynamoDBReady(endpoint: string): Promise<boolean> {
  const client = makeClient(endpoint);
  try {
    await client.send(new ListTablesCommand({}));
    return true;
  } catch {
    return false;
  } finally {
    client.destroy();
  }
}

export interface LocalTableEntry {
  tableName: string;
  config: TableConfig;
}

export async function ensureLocalTables(
  endpoint: string,
  tables: LocalTableEntry[]
): Promise<void> {
  const client = makeClient(endpoint);
  try {
    for (const table of tables) {
      const input = buildCreateTableInput(table.tableName, table.config);
      try {
        await client.send(new CreateTableCommand(input));
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e.name === "ResourceInUseException") continue;
        throw err;
      }
    }
  } finally {
    client.destroy();
  }
}
