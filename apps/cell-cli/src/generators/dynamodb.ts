import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "./types.js";
import { toPascalCase } from "./types.js";

export function generateDynamoDB(config: ResolvedConfig): CfnFragment {
  const resources: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};

  for (const table of config.tables) {
    const logicalId = `${toPascalCase(table.key)}Table`;
    const keys = Object.entries(table.config.keys);

    const attrMap = new Map<string, string>();
    for (const [name, type] of keys) {
      attrMap.set(name, type);
    }
    if (table.config.gsi) {
      for (const gsi of Object.values(table.config.gsi)) {
        for (const [name, type] of Object.entries(gsi.keys)) {
          attrMap.set(name, type);
        }
      }
    }

    const properties: Record<string, unknown> = {
      TableName: table.tableName,
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

    if (table.config.gsi) {
      properties.GlobalSecondaryIndexes = Object.entries(table.config.gsi).map(
        ([indexName, gsi]) => ({
          IndexName: indexName,
          KeySchema: Object.entries(gsi.keys).map(([name], i) => ({
            AttributeName: name,
            KeyType: i === 0 ? "HASH" : "RANGE",
          })),
          Projection: { ProjectionType: gsi.projection },
        }),
      );
    }

    resources[logicalId] = {
      Type: "AWS::DynamoDB::Table",
      DeletionPolicy: "Retain",
      Properties: properties,
    };

    outputs[`${logicalId}Arn`] = {
      Value: { "Fn::GetAtt": [logicalId, "Arn"] },
    };
  }

  return { Resources: resources, Outputs: outputs };
}
