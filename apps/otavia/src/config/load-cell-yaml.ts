import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import type { CellConfig } from "./cell-yaml-schema.js";

/**
 * Load and parse cell.yaml from cellDir.
 * cell.yaml should only declare required param keys; !Env/!Secret are not supported here.
 */
export function loadCellConfig(cellDir: string): CellConfig {
  const filePath = path.join(cellDir, "cell.yaml");
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read cell.yaml: ${message}`);
  }

  if (/(^|[\s:[{,])!(Env|Secret)\b/m.test(content)) {
    throw new Error("cell.yaml: !Env and !Secret are not supported; move refs to otavia.yaml params");
  }

  const doc = parseDocument(content);
  const raw = doc.toJS() as Record<string, unknown> | null | undefined;

  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("cell.yaml: invalid YAML or empty document");
  }

  const name = raw.name;
  if (name == null) {
    throw new Error("cell.yaml: missing required field 'name'");
  }
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("cell.yaml: 'name' must be a non-empty string");
  }

  if (raw.params != null) {
    if (!Array.isArray(raw.params)) {
      throw new Error("cell.yaml: 'params' must be an array of strings");
    }
    for (let i = 0; i < raw.params.length; i += 1) {
      if (typeof raw.params[i] !== "string" || raw.params[i].trim() === "") {
        throw new Error(`cell.yaml: params[${i}] must be a non-empty string`);
      }
    }
  }

  return raw as unknown as CellConfig;
}
