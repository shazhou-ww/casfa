import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";
import type { ResolvedConfig } from "../config/resolve-config.js";
import type { StackYaml } from "../config/stack-yaml-schema.js";
import { loadStackYaml } from "../config/load-stack-yaml.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { loadEnvFiles } from "../utils/env.js";
import { resolveConfig } from "../config/resolve-config.js";
import { generateApiGateway } from "./api-gateway.js";
import { generateCloudFrontPlatform } from "./cloudfront.js";
import { generateDomain } from "./domain.js";
import { generateDynamoDB } from "./dynamodb.js";
import { generateLambda } from "./lambda.js";
import { generateS3 } from "./s3.js";
import type { CfnFragment } from "./types.js";
import { toPascalCase } from "./types.js";

export interface PlatformCell {
  name: string;
  cellDir: string;
  pathPrefix: string;
  resolved: ResolvedConfig;
}

export interface MergePlatformOptions {
  rootDir: string;
  stack: StackYaml;
  stackName?: string;
}

/**
 * Load stack.yaml and all cell configs resolved with platformContext.
 * Returns null if stack has no domain.host.
 */
export function loadPlatformCells(rootDir: string, stack: StackYaml): PlatformCell[] {
  const domainHost = stack.domain?.host;
  if (!domainHost) {
    throw new Error("stack.yaml domain.host is required for platform deploy");
  }
  const origin = `https://${domainHost}`;

  const ssoPathPrefix = "/sso";
  const cells: PlatformCell[] = [];

  for (const cellName of stack.cells) {
    const cellDir = resolve(rootDir, "apps", cellName);
    if (!existsSync(resolve(cellDir, "cell.yaml"))) {
      console.warn(`Skipping ${cellName}: no cell.yaml in ${cellDir}`);
      continue;
    }
    const config = loadCellConfig(cellDir);
    const pathPrefixRaw = config.pathPrefix ?? "";
    const pathPrefix = pathPrefixRaw.startsWith("/") ? pathPrefixRaw : `/${pathPrefixRaw}`;
    if (!pathPrefix || pathPrefix === "/") {
      console.warn(`Skipping ${cellName}: pathPrefix required for platform (e.g. /sso, /agent)`);
      continue;
    }

    const envMap = loadEnvFiles(cellDir, { stage: "cloud" });
    const resolved = resolveConfig(config, envMap, "cloud", {
      platformContext: { origin, pathPrefix, ssoPathPrefix },
    });
    cells.push({ name: cellName, cellDir, pathPrefix, resolved });
  }

  return cells;
}

/** Build a ref map: short logical id -> prefixed logical id for a cell's fragments */
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

/** Generate S3 fragment with only FrontendBucket (for platform single bucket) */
function generatePlatformFrontendBucket(bucketName: string): CfnFragment {
  return {
    Resources: {
      FrontendBucket: {
        Type: "AWS::S3::Bucket",
        Properties: {
          BucketName: bucketName,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
        },
      },
    },
    Outputs: {
      FrontendBucketName: { Value: { Ref: "FrontendBucket" } },
      FrontendBucketArn: { Value: { "Fn::GetAtt": ["FrontendBucket", "Arn"] } },
    },
  };
}

/** Generate platform template: one CloudFront (path behaviors), one S3, one Lambda per entry, one API Gateway per cell */
export function generatePlatformTemplate(options: MergePlatformOptions): string {
  const { rootDir, stack, stackName: stackNameOpt } = options;
  const stackName = stackNameOpt ?? "casfa-platform";
  const bucketNameSuffix =
    stack.bucketNameSuffix ?? stack.domain?.host?.replace(/\./g, "-") ?? "platform";
  const frontendBucketName = `frontend-${stackName}-${bucketNameSuffix}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");

  const cells = loadPlatformCells(rootDir, stack);
  if (cells.length === 0) {
    throw new Error("No cells loaded from stack.yaml (check pathPrefix and cell.yaml)");
  }

  const resources: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};
  const conditions: Record<string, unknown> = {};

  const pathBehaviors: Array<{ pathPattern: string; originId: string }> = [];

  for (const cell of cells) {
    const prefix = toPascalCase(cell.name);
    const resolved = cell.resolved;

    if (resolved.tables.length > 0) {
      const frag = generateDynamoDB(resolved);
      const refMap = buildRefMap([frag], prefix);
      const prefixed = prefixFragment(frag, prefix, refMap);
      Object.assign(resources, prefixed.Resources);
      if (prefixed.Outputs) Object.assign(outputs, prefixed.Outputs);
    }

    if (resolved.buckets.length > 0) {
      const frag = generateS3(resolved);
      const bucketOnly: CfnFragment = {
        Resources: {},
        Outputs: frag.Outputs ? {} : undefined,
      };
      for (const [key, value] of Object.entries(frag.Resources)) {
        if (key !== "FrontendBucket" && key !== "FrontendBucketPolicy") {
          bucketOnly.Resources[key] = value;
        }
      }
      if (frag.Outputs) {
        for (const [key, value] of Object.entries(frag.Outputs)) {
          if (key !== "FrontendBucketName" && key !== "FrontendBucketArn") {
            bucketOnly.Outputs![key] = value;
          }
        }
      }
      if (Object.keys(bucketOnly.Resources).length > 0) {
        const refMap = buildRefMap([bucketOnly], prefix);
        const prefixed = prefixFragment(bucketOnly, prefix, refMap);
        Object.assign(resources, prefixed.Resources);
        if (prefixed.Outputs) Object.assign(outputs, prefixed.Outputs);
      }
    }

    if (resolved.backend) {
      const lambdaFrag = generateLambda(resolved);
      const apiFrag = generateApiGateway(resolved);
      const refMap = buildRefMap([lambdaFrag, apiFrag], prefix);
      const lambdaPrefixed = prefixFragment(lambdaFrag, prefix, refMap);
      const apiPrefixed = prefixFragment(apiFrag, prefix, refMap);
      Object.assign(resources, lambdaPrefixed.Resources);
      Object.assign(resources, apiPrefixed.Resources);
      if (lambdaPrefixed.Outputs) Object.assign(outputs, lambdaPrefixed.Outputs);
      if (apiPrefixed.Outputs) Object.assign(outputs, apiPrefixed.Outputs);

      for (const [entryKey] of Object.entries(resolved.backend.entries)) {
        const funcLogicalId = prefix + toPascalCase(entryKey) + "Function";
        const res = resources[funcLogicalId] as Record<string, unknown> | undefined;
        if (res?.Properties && typeof res.Properties === "object") {
          const props = res.Properties as Record<string, unknown>;
          if (props.Code && typeof props.Code === "object") {
            (props.Code as Record<string, string>).S3Key = `build/${cell.name}/${entryKey}/code.zip`;
          }
        }
      }

      const pathPattern = cell.pathPrefix.endsWith("/")
        ? `${cell.pathPrefix}*`
        : `${cell.pathPrefix}/*`;
      pathBehaviors.push({ pathPattern, originId: `${prefix}HttpApi` });
    }
  }

  const frontendFrag = generatePlatformFrontendBucket(frontendBucketName);
  Object.assign(resources, frontendFrag.Resources);
  if (frontendFrag.Outputs) Object.assign(outputs, frontendFrag.Outputs);

  const domainHost = stack.domain?.host ?? "";
  const cloudFrontFrag = generateCloudFrontPlatform({
    stackName,
    domainHost,
    pathBehaviors,
    hasCertificate: !!stack.domain?.certificate,
    hostedZoneId: (stack.domain as { hostedZoneId?: string })?.hostedZoneId,
    certificateArn: stack.domain?.certificate,
  });
  Object.assign(resources, cloudFrontFrag.Resources);
  if (cloudFrontFrag.Outputs) Object.assign(outputs, cloudFrontFrag.Outputs);
  if (cloudFrontFrag.Conditions) Object.assign(conditions, cloudFrontFrag.Conditions);

  const firstWithDomain = cells[0];
  if (firstWithDomain?.resolved.domain && stack.domain?.host) {
    const domainConfig = { ...firstWithDomain.resolved.domain, host: stack.domain.host };
    const domainFrag = generateDomain({ ...firstWithDomain.resolved, domain: domainConfig });
    Object.assign(resources, domainFrag.Resources);
  }

  const template: Record<string, unknown> = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: `Platform stack ${stackName}: single CloudFront, path-based APIs`,
    Resources: resources,
    Outputs: outputs,
  };
  if (Object.keys(conditions).length > 0) template.Conditions = conditions;

  return stringify(template);
}
