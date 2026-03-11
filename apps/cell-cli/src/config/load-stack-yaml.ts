import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { StackDomainConfig, StackYaml } from "./stack-yaml-schema.js";

const STACK_FILE = "stack.yaml";

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateDomain(raw: unknown): StackDomainConfig | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const host = obj.host;
  if (typeof host !== "string" || !host) return undefined;
  const domain: StackDomainConfig = { host };
  if (obj.dns !== undefined) {
    if (obj.dns === "route53" || obj.dns === "cloudflare") {
      domain.dns = obj.dns;
    } else if (
      typeof obj.dns === "object" &&
      obj.dns !== null &&
      !Array.isArray(obj.dns)
    ) {
      const d = obj.dns as Record<string, unknown>;
      if (d.provider === "route53" || d.provider === "cloudflare") {
        domain.dns = {
          provider: d.provider as "route53" | "cloudflare",
          zone: typeof d.zone === "string" ? d.zone : undefined,
          zoneId: typeof d.zoneId === "string" ? d.zoneId : undefined,
          apiToken: typeof d.apiToken === "string" ? d.apiToken : undefined,
        };
      }
    }
  }
  if (typeof obj.certificate === "string") domain.certificate = obj.certificate;
  return domain;
}

/**
 * Load and parse stack.yaml from rootDir. Returns null if file does not exist
 * or shape is invalid (e.g. missing cells array).
 */
export function loadStackYaml(rootDir: string): StackYaml | null {
  const filePath = join(rootDir, STACK_FILE);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  const raw = parse(content) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const obj = raw as Record<string, unknown>;
  const cells = obj.cells;
  if (!isStringArray(cells) || cells.length === 0) return null;
  const result: StackYaml = { cells };
  const domain = validateDomain(obj.domain);
  if (domain) result.domain = domain;
  if (typeof obj.bucketNameSuffix === "string")
    result.bucketNameSuffix = obj.bucketNameSuffix;
  return result;
}
