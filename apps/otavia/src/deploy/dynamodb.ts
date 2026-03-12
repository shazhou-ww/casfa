import type { TableConfig } from "../config/cell-yaml-schema.js";
import type { CfnFragment } from "./types.js";
import { toPascalCase } from "./types.js";

/**
 * Generate a single DynamoDB table fragment.
 * Uses KeySchema, AttributeDefinitions, BillingMode PAY_PER_REQUEST, GSI if present.
 */
export function generateDynamoDBTable(
  tableName: string,
  tableKey: string,
  config: TableConfig
): CfnFragment {
  const logicalId = `${toPascalCase(tableKey)}Table`;
  const keys = Object.entries(config.keys);

  const attrMap = new Map<string, string>();
  for (const [name, type] of keys) {
    attrMap.set(name, type);
  }
  if (config.gsi) {
    for (const gsi of Object.values(config.gsi)) {
      for (const [name, type] of Object.entries(gsi.keys)) {
        attrMap.set(name, type);
      }
    }
  }

  const properties: Record<string, unknown> = {
    TableName: tableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [...attrMap.entries()].map(([name, type]) => ({
      AttributeName: name,
      AttributeType: type,
    })),
    KeySchema: keys.map(([name], i) => ({
      AttributeName: name,
      KeyType: i === 0 ? "HASH" : "RANGE",
    })),
  };

  if (config.gsi) {
    properties.GlobalSecondaryIndexes = Object.entries(config.gsi).map(
      ([indexName, gsi]) => ({
        IndexName: indexName,
        KeySchema: Object.entries(gsi.keys).map(([name], i) => ({
          AttributeName: name,
          KeyType: i === 0 ? "HASH" : "RANGE",
        })),
        Projection: { ProjectionType: gsi.projection },
      })
    );
  }

  return {
    Resources: {
      [logicalId]: {
        Type: "AWS::DynamoDB::Table",
        Properties: properties,
      },
    },
    Outputs: {
      [`${logicalId}Arn`]: {
        Value: { "Fn::GetAtt": [logicalId, "Arn"] },
      },
    },
  };
}
