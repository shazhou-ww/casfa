import { describe, expect, test } from "bun:test";
import type { ResolvedConfig } from "../../config/resolve-config.js";
import { generateDynamoDB } from "../dynamodb.js";

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    name: "test-app",
    envVars: {},
    secretRefs: {},
    tables: [],
    buckets: [],
    frontendBucketName: "test-app-frontend",
    ...overrides,
  };
}

describe("generateDynamoDB", () => {
  test("single table with pk/sk", () => {
    const config = makeConfig({
      tables: [
        {
          key: "users",
          tableName: "test-app-users",
          config: { keys: { pk: "S", sk: "S" } },
        },
      ],
    });
    const result = generateDynamoDB(config);
    const table = result.Resources.UsersTable as any;
    expect(table.Type).toBe("AWS::DynamoDB::Table");
    expect(table.Properties.TableName).toBe("test-app-users");
    expect(table.Properties.BillingMode).toBe("PAY_PER_REQUEST");
    expect(table.Properties.KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
    expect(table.Properties.AttributeDefinitions).toEqual([
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
    ]);
  });

  test("table with GSI", () => {
    const config = makeConfig({
      tables: [
        {
          key: "delegates",
          tableName: "test-app-delegates",
          config: {
            keys: { pk: "S", sk: "S" },
            gsi: {
              "realm-index": {
                keys: { gsi1pk: "S", gsi1sk: "S" },
                projection: "ALL",
              },
            },
          },
        },
      ],
    });
    const result = generateDynamoDB(config);
    const table = result.Resources.DelegatesTable as any;
    expect(table.Properties.GlobalSecondaryIndexes).toHaveLength(1);
    expect(table.Properties.GlobalSecondaryIndexes[0]).toEqual({
      IndexName: "realm-index",
      KeySchema: [
        { AttributeName: "gsi1pk", KeyType: "HASH" },
        { AttributeName: "gsi1sk", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    });
    expect(table.Properties.AttributeDefinitions).toHaveLength(4);
  });

  test("multiple tables", () => {
    const config = makeConfig({
      tables: [
        {
          key: "users",
          tableName: "test-app-users",
          config: { keys: { pk: "S" } },
        },
        {
          key: "orders",
          tableName: "test-app-orders",
          config: { keys: { pk: "S", sk: "S" } },
        },
      ],
    });
    const result = generateDynamoDB(config);
    expect(Object.keys(result.Resources)).toHaveLength(2);
    expect(result.Resources.UsersTable).toBeDefined();
    expect(result.Resources.OrdersTable).toBeDefined();
  });

  test("DeletionPolicy is Retain", () => {
    const config = makeConfig({
      tables: [
        {
          key: "data",
          tableName: "test-app-data",
          config: { keys: { pk: "S" } },
        },
      ],
    });
    const result = generateDynamoDB(config);
    expect((result.Resources.DataTable as any).DeletionPolicy).toBe("Retain");
  });

  test("output ARNs generated", () => {
    const config = makeConfig({
      tables: [
        {
          key: "users",
          tableName: "test-app-users",
          config: { keys: { pk: "S" } },
        },
      ],
    });
    const result = generateDynamoDB(config);
    expect(result.Outputs).toBeDefined();
    expect(result.Outputs!.UsersTableArn).toEqual({
      Value: { "Fn::GetAtt": ["UsersTable", "Arn"] },
    });
  });
});
