import { describe, expect, test } from "bun:test";
import { buildCreateTableInput } from "../dynamodb-local.js";
import type { TableConfig } from "../../config/cell-yaml-schema.js";

describe("buildCreateTableInput", () => {
  test("simple table with pk and sk", () => {
    const config: TableConfig = {
      keys: { pk: "S", sk: "S" },
    };
    const input = buildCreateTableInput("test-table", config);

    expect(input.TableName).toBe("test-table");
    expect(input.KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
    expect(input.AttributeDefinitions).toContainEqual({
      AttributeName: "pk",
      AttributeType: "S",
    });
    expect(input.AttributeDefinitions).toContainEqual({
      AttributeName: "sk",
      AttributeType: "S",
    });
  });

  test("table with one GSI", () => {
    const config: TableConfig = {
      keys: { pk: "S", sk: "S" },
      gsi: {
        byEmail: {
          keys: { gsi1pk: "S", gsi1sk: "S" },
          projection: "ALL",
        },
      },
    };
    const input = buildCreateTableInput("test-table", config);

    expect(input.GlobalSecondaryIndexes).toHaveLength(1);
    expect(input.GlobalSecondaryIndexes![0].IndexName).toBe("byEmail");
    expect(input.GlobalSecondaryIndexes![0].KeySchema).toEqual([
      { AttributeName: "gsi1pk", KeyType: "HASH" },
      { AttributeName: "gsi1sk", KeyType: "RANGE" },
    ]);
    expect(input.GlobalSecondaryIndexes![0].Projection).toEqual({
      ProjectionType: "ALL",
    });

    expect(input.AttributeDefinitions).toContainEqual({
      AttributeName: "gsi1pk",
      AttributeType: "S",
    });
    expect(input.AttributeDefinitions).toContainEqual({
      AttributeName: "gsi1sk",
      AttributeType: "S",
    });
  });

  test("table with multiple GSIs", () => {
    const config: TableConfig = {
      keys: { pk: "S", sk: "S" },
      gsi: {
        byEmail: {
          keys: { gsi1pk: "S", gsi1sk: "S" },
          projection: "ALL",
        },
        byDate: {
          keys: { gsi2pk: "S", gsi2sk: "S" },
          projection: "KEYS_ONLY",
        },
      },
    };
    const input = buildCreateTableInput("test-table", config);

    expect(input.GlobalSecondaryIndexes).toHaveLength(2);
    const names = input.GlobalSecondaryIndexes!.map((g) => g.IndexName);
    expect(names).toContain("byEmail");
    expect(names).toContain("byDate");
  });

  test("BillingMode is always PAY_PER_REQUEST", () => {
    const config: TableConfig = { keys: { pk: "S" } };
    const input = buildCreateTableInput("any-table", config);
    expect(input.BillingMode).toBe("PAY_PER_REQUEST");
  });

  test("first key is HASH, second is RANGE", () => {
    const config: TableConfig = { keys: { id: "S", sortKey: "N" } };
    const input = buildCreateTableInput("t", config);

    expect(input.KeySchema![0]).toEqual({
      AttributeName: "id",
      KeyType: "HASH",
    });
    expect(input.KeySchema![1]).toEqual({
      AttributeName: "sortKey",
      KeyType: "RANGE",
    });
    expect(input.AttributeDefinitions).toContainEqual({
      AttributeName: "sortKey",
      AttributeType: "N",
    });
  });

  test("no GSI field when gsi is undefined", () => {
    const config: TableConfig = { keys: { pk: "S" } };
    const input = buildCreateTableInput("t", config);
    expect(input.GlobalSecondaryIndexes).toBeUndefined();
  });
});
