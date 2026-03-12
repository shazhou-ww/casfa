import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";
import type { OtaviaYaml } from "../config/otavia-yaml-schema.js";
import type { CellConfig } from "../config/cell-yaml-schema.js";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { resolveCellDir } from "../config/resolve-cell-dir.js";
import { mergeParams, resolveParams } from "../config/resolve-params.js";
import { loadEnvForCell } from "../utils/env.js";
import { tablePhysicalName, bucketPhysicalName } from "../config/resource-names.js";
import { generateDynamoDBTable } from "./dynamodb.js";
import { generateBucket, generateFrontendBucket } from "./s3.js";
import { generateLambdaFragment } from "./lambda.js";
import { generateHttpApi } from "./api-gateway.js";
import { generateCloudFrontDistribution } from "./cloudfront.js";
import type { CfnFragment } from "./types.js";
import { toPascalCase } from "./types.js";

/** Build ref map: short logical id -> prefixed logical id for a cell's fragments */
function buildRefMap(fragments: CfnFragment[], prefix: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fragments) {
    for (const key of Object.keys(f.Resources)) {
      map.set(key, prefix + key);
    }
  }
  return map;
}

/** Deep-replace Ref and Fn::GetAtt in a value using refMap */
function replaceRefsInValue(val: unknown, refMap: Map<string, string>): unknown {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map((item) => replaceRefsInValue(item, refMap));
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if ("Ref" in obj && typeof obj.Ref === "string" && refMap.has(obj.Ref)) {
      return { Ref: refMap.get(obj.Ref) };
    }
    if ("Fn::GetAtt" in obj && Array.isArray(obj["Fn::GetAtt"])) {
      const att = obj["Fn::GetAtt"] as string[];
      if (att.length >= 1 && typeof att[0] === "string" && refMap.has(att[0])) {
        return { "Fn::GetAtt": [refMap.get(att[0]), ...att.slice(1)] };
      }
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = replaceRefsInValue(v, refMap);
    }
    return out;
  }
  return val;
}

/** Prefix fragment keys and rewrite internal Ref/GetAtt to use prefixed names */
function prefixFragment(
  fragment: CfnFragment,
  prefix: string,
  refMap: Map<string, string>
): CfnFragment {
  const prefixKey = (key: string) => prefix + key;
  const resources: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fragment.Resources)) {
    resources[prefixKey(key)] = replaceRefsInValue(value, refMap);
  }
  const result: CfnFragment = { Resources: resources };
  if (fragment.Outputs) {
    result.Outputs = {};
    for (const [key, value] of Object.entries(fragment.Outputs)) {
      result.Outputs[prefixKey(key)] = replaceRefsInValue(value, refMap);
    }
  }
  if (fragment.Conditions) {
    result.Conditions = {};
    for (const [key, value] of Object.entries(fragment.Conditions)) {
      result.Conditions[prefixKey(key)] = replaceRefsInValue(value, refMap);
    }
  }
  return result;
}

function resolvedParamsToEnv(resolved: Record<string, string | unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(resolved)) {
    if (value === null || value === undefined) {
      env[key] = "";
    } else if (typeof value === "object") {
      env[key] = JSON.stringify(value);
    } else {
      env[key] = String(value);
    }
  }
  return env;
}

/**
 * Generate a single CloudFormation template (YAML) from OtaviaYaml + all cell configs + resolved params (cloud stage).
 * Resources: each cell's tables -> DynamoDB, buckets -> S3, backend entries -> Lambda + API Gateway HTTP API,
 * frontend -> single S3 bucket + CloudFront path behaviors for single domain.
 */
export function generateTemplate(rootDir: string): string {
  const otavia = loadOtaviaYaml(rootDir);
  const stackName = otavia.stackName;
  const domainHost = otavia.domain?.host ?? "";
  const bucketSuffix =
    domainHost.replace(/\./g, "-").toLowerCase().replace(/[^a-z0-9-]/g, "-") || "platform";
  const frontendBucketName = `frontend-${stackName}-${bucketSuffix}`.toLowerCase();

  const resources: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};
  const conditions: Record<string, unknown> = {};
  const pathBehaviors: Array<{ pathPattern: string; originId: string; isApi?: boolean }> = [];
  const firstMount = otavia.cellsList[0]?.mount ?? "";
  const origin = domainHost ? `https://${domainHost}` : "";

  for (const cellEntry of otavia.cellsList) {
    const cellDir = resolveCellDir(rootDir, cellEntry.package);
    if (!existsSync(resolve(cellDir, "cell.yaml"))) {
      continue;
    }
    const config = loadCellConfig(cellDir);
    const envMap = loadEnvForCell(rootDir, cellDir, { stage: "cloud" });
    const merged = mergeParams(
      mergeParams(otavia.params, config.params),
      cellEntry.params
    ) as Record<string, unknown>;
    const resolved = resolveParams(merged, envMap, { onMissingParam: "throw" });
    const envVars = resolvedParamsToEnv(resolved);
    const pathPrefix = `/${cellEntry.mount}`;
    envVars.CELL_BASE_URL = origin ? `${origin}${pathPrefix}` : "";
    if (firstMount) {
      envVars.SSO_BASE_URL = origin ? `${origin}/${firstMount}` : "";
    }
    envVars.CELL_STAGE = "cloud";

    const prefix = toPascalCase(cellEntry.mount);

    if (config.tables) {
      for (const [tableKey, tableConfig] of Object.entries(config.tables)) {
        const tableName = tablePhysicalName(stackName, cellEntry.mount, tableKey);
        const frag = generateDynamoDBTable(tableName, tableKey, tableConfig);
        const refMap = buildRefMap([frag], prefix);
        const prefixed = prefixFragment(frag, prefix, refMap);
        Object.assign(resources, prefixed.Resources);
        if (prefixed.Outputs) Object.assign(outputs, prefixed.Outputs);
      }
    }

    if (config.buckets) {
      for (const [bucketKey] of Object.entries(config.buckets)) {
        const bucketName = bucketPhysicalName(stackName, cellEntry.mount, bucketKey);
        const frag = generateBucket(bucketKey, bucketName);
        const refMap = buildRefMap([frag], prefix);
        const prefixed = prefixFragment(frag, prefix, refMap);
        Object.assign(resources, prefixed.Resources);
        if (prefixed.Outputs) Object.assign(outputs, prefixed.Outputs);
      }
    }

    if (config.backend) {
      const tableLogicalIds = config.tables
        ? Object.keys(config.tables).map((k) => `${prefix}${toPascalCase(k)}Table`)
        : [];
      const bucketLogicalIds = config.buckets
        ? Object.keys(config.buckets).map((k) => `${prefix}${toPascalCase(k)}Bucket`)
        : [];
      const apiRoutes: Array<{ functionLogicalId: string }> = [];

      for (const [entryKey, entry] of Object.entries(config.backend.entries)) {
        const frag = generateLambdaFragment(entryKey, prefix, {
          handlerPath: `build/${cellEntry.mount}/${entryKey}/code.zip`,
          runtime: config.backend.runtime,
          timeout: entry.timeout,
          memory: entry.memory,
          envVars,
          tableLogicalIds: tableLogicalIds.length > 0 ? tableLogicalIds : undefined,
          bucketLogicalIds: bucketLogicalIds.length > 0 ? bucketLogicalIds : undefined,
        });
        Object.assign(resources, frag.Resources);
        const funcLogicalId = `${prefix}${toPascalCase(entryKey)}Function`;
        apiRoutes.push({ functionLogicalId: funcLogicalId });
      }

      const apiFrag = generateHttpApi(prefix, `${stackName}-${cellEntry.mount}-api`, apiRoutes);
      Object.assign(resources, apiFrag.Resources);
      if (apiFrag.Outputs) Object.assign(outputs, apiFrag.Outputs);

      const pathPattern = pathPrefix.endsWith("/") ? `${pathPrefix}*` : `${pathPrefix}/*`;
      pathBehaviors.push({
        pathPattern,
        originId: `${prefix}HttpApi`,
        isApi: true,
      });
    }
  }

  const frontendFrag = generateFrontendBucket(frontendBucketName);
  Object.assign(resources, frontendFrag.Resources);
  if (frontendFrag.Outputs) Object.assign(outputs, frontendFrag.Outputs);

  const cloudFrontFrag = generateCloudFrontDistribution({
    stackName,
    domainHost,
    defaultOriginId: "S3Frontend",
    frontendBucketRef: "FrontendBucket",
    pathBehaviors,
    hostedZoneId: otavia.domain?.dns?.zoneId,
    certificateArn: undefined,
  });
  Object.assign(resources, cloudFrontFrag.Resources);
  if (cloudFrontFrag.Outputs) Object.assign(outputs, cloudFrontFrag.Outputs);
  if (cloudFrontFrag.Conditions) Object.assign(conditions, cloudFrontFrag.Conditions);

  const template: Record<string, unknown> = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: `Otavia stack ${stackName}: single CloudFormation`,
    Resources: resources,
    Outputs: outputs,
  };
  if (Object.keys(conditions).length > 0) {
    template.Conditions = conditions;
  }

  return stringify(template);
}
