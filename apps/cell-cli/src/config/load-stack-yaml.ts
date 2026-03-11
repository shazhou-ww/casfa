import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { StackYaml } from "./stack-yaml-schema.js";

/**
 * Load and parse stack.yaml from rootDir.
 * Returns null if file does not exist; throws on invalid shape.
 */
export function loadStackYaml(rootDir: string): StackYaml | null {
  const filePath = resolve(rootDir, "stack.yaml");
  if (!existsSync(filePath)) {
    return null;
  }
  const content = readFileSync(filePath, "utf-8");
  const raw = parseYaml(content) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("stack.yaml must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const cells = obj.cells;
  if (!Array.isArray(cells) || !cells.every((c) => typeof c === "string")) {
    throw new Error("stack.yaml must have cells: string[]");
  }
  const result: StackYaml = {
    cells: cells as string[],
  };
  if (obj.domain != null && typeof obj.domain === "object" && !Array.isArray(obj.domain)) {
    const d = obj.domain as Record<string, unknown>;
    if (typeof d.host === "string") {
      result.domain = {
        host: d.host,
        dns: d.dns === "route53" || d.dns === "cloudflare" ? d.dns : undefined,
        certificate: typeof d.certificate === "string" ? d.certificate : undefined,
      };
    }
  }
  if (typeof obj.bucketNameSuffix === "string") {
    result.bucketNameSuffix = obj.bucketNameSuffix;
  }
  return result;
}
