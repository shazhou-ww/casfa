import { readFileSync } from "node:fs";
import { parseDocument, type SchemaOptions } from "yaml";
import type {
  CellConfig,
  EnvRef,
  RawParamValue,
  ResolvedValue,
  SecretRef,
} from "./cell-yaml-schema.js";
import { isEnvRef, isParamRef, isSecretRef } from "./cell-yaml-schema.js";
import { resolveParams } from "./resolve-params.js";

const customTags: SchemaOptions["customTags"] = [
  {
    tag: "!Secret",
    resolve(value: string) {
      return { secret: value || null };
    },
  },
  {
    tag: "!Param",
    resolve(value: string) {
      if (!value) throw new Error("!Param requires a key argument");
      return { $ref: value };
    },
  },
  {
    tag: "!Env",
    resolve(value: string) {
      return { env: value || null };
    },
  },
];

/** A fully-formed SecretRef: exactly `{ secret: "<string>" }` with no other keys */
function isTerminalSecretRef(node: unknown): node is SecretRef {
  return (
    typeof node === "object" &&
    node !== null &&
    "secret" in node &&
    typeof (node as Record<string, unknown>).secret === "string" &&
    Object.keys(node).length === 1
  );
}

/** A fully-formed EnvRef: exactly `{ env: "<string>" }` with no other keys */
function isTerminalEnvRef(node: unknown): node is EnvRef {
  return (
    typeof node === "object" &&
    node !== null &&
    "env" in node &&
    typeof (node as Record<string, unknown>).env === "string" &&
    Object.keys(node).length === 1
  );
}

/**
 * Walk a plain JS object/array tree and replace any `{ $ref }` values
 * with their resolved counterparts from the resolved params map.
 */
function deepResolveRefs(node: unknown, resolved: Record<string, ResolvedValue>): unknown {
  if (node === null || node === undefined) return node;
  if (isParamRef(node)) {
    const val = resolved[node.$ref];
    if (val === undefined) {
      throw new Error(`Unresolved param reference: ${node.$ref}`);
    }
    return val;
  }
  if (Array.isArray(node)) {
    return node.map((item) => deepResolveRefs(item, resolved));
  }
  if (typeof node === "object") {
    if (isTerminalSecretRef(node)) return node;
    if (isTerminalEnvRef(node)) return node;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      result[k] = deepResolveRefs(v, resolved);
    }
    return result;
  }
  return node;
}

/**
 * Load and parse a cell.yaml file with custom `!Param`, `!Secret`, and `!Env` tags.
 *
 * Resolution flow:
 * 1. Parse YAML with custom tags
 * 2. Post-process params: fill `{ secret: null }` with their param key name
 * 3. Resolve all `{ $ref }` via topological sort
 * 4. Walk entire config tree replacing remaining `{ $ref }` with resolved values
 * 5. Return fully resolved CellConfig
 */
export function loadCellYaml(filePath: string): CellConfig {
  const content = readFileSync(filePath, "utf-8");
  return parseCellYaml(content);
}

/** Parse cell.yaml from a string (useful for testing) */
export function parseCellYaml(content: string): CellConfig {
  const doc = parseDocument(content, { customTags });
  const raw = doc.toJS() as Record<string, unknown>;

  const params = (raw.params ?? {}) as Record<string, RawParamValue>;

  for (const [key, value] of Object.entries(params)) {
    if (isSecretRef(value) && value.secret === null) {
      (value as { secret: string | null }).secret = key;
    } else if (isEnvRef(value) && value.env === null) {
      (value as { env: string | null }).env = key;
    }
  }

  const resolvedParams = resolveParams(params);
  raw.params = resolvedParams;

  const resolved = deepResolveRefs(raw, resolvedParams) as CellConfig;
  return resolved;
}
