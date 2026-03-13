import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import type { StackYaml } from "./stack-yaml-schema.js";

/**
 * Load and parse stack.yaml from rootDir.
 * Returns null if file does not exist or is invalid.
 */
export function loadStackYaml(rootDir: string): StackYaml | null {
  const filePath = resolve(rootDir, "stack.yaml");
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, "utf-8");
    const doc = parseDocument(content);
    const raw = doc.toJS() as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const cells = raw.cells;
    if (!Array.isArray(cells) || cells.length === 0) return null;
    if (!cells.every((c) => typeof c === "string")) return null;
    const domain = raw.domain;
    const domainConfig =
      domain && typeof domain === "object" && !Array.isArray(domain) && domain !== null
        ? (domain as { host?: string })
        : undefined;
    return {
      cells: cells as string[],
      ...(domainConfig?.host && { domain: domainConfig as StackYaml["domain"] }),
      ...(typeof raw.bucketNameSuffix === "string" && { bucketNameSuffix: raw.bucketNameSuffix }),
    };
  } catch {
    return null;
  }
}
