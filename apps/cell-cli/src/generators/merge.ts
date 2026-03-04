import { stringify } from "yaml";
import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "./types.js";
import { generateDynamoDB } from "./dynamodb.js";
import { generateS3 } from "./s3.js";
import { generateLambda } from "./lambda.js";
import { generateApiGateway } from "./api-gateway.js";
import { generateCloudFront } from "./cloudfront.js";
import { generateDomain } from "./domain.js";

export function generateTemplate(config: ResolvedConfig): string {
  const fragments: CfnFragment[] = [
    generateDynamoDB(config),
    generateS3(config),
    generateLambda(config),
    generateApiGateway(config),
    generateCloudFront(config),
    generateDomain(config),
  ];

  const template: Record<string, unknown> = {
    AWSTemplateFormatVersion: "2010-09-09",
  };

  const resources: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};
  const conditions: Record<string, unknown> = {};

  for (const fragment of fragments) {
    Object.assign(resources, fragment.Resources);
    if (fragment.Outputs) Object.assign(outputs, fragment.Outputs);
    if (fragment.Conditions) Object.assign(conditions, fragment.Conditions);
  }

  if (Object.keys(conditions).length > 0) template.Conditions = conditions;
  template.Resources = resources;
  if (Object.keys(outputs).length > 0) template.Outputs = outputs;

  return stringify(template);
}
