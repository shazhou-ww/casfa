import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument, type SchemaOptions } from "yaml";
import type { CellConfig } from "./cell-yaml-schema.js";

const customTags: SchemaOptions["customTags"] = [
  {
    tag: "!Secret",
    resolve(value: string) {
      return { secret: value ?? "" };
    },
  },
  {
    tag: "!Env",
    resolve(value: string) {
      return { env: value ?? "" };
    },
  },
];

/**
 * Load and parse cell.yaml from cellDir. Uses custom !Env and !Secret tags.
 * Does NOT resolve params (no merge with stack, no env lookup).
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

  const doc = parseDocument(content, { customTags });
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

  return raw as unknown as CellConfig;
}
