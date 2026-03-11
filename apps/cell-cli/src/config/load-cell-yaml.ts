import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { parseDocument, type SchemaOptions } from "yaml";
import type {
  CellConfig,
  EnvRef,
  RawParamValue,
  ResolvedParamValue,
  ResolvedValue,
  SecretRef,
} from "./cell-yaml-schema.js";
import { isEnvRef, isParamRef, isSecretRef } from "./cell-yaml-schema.js";
import { resolveParams } from "./resolve-params.js";

/** Instance name must be safe for filename: cell.<instance>.yaml */
const INSTANCE_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

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
 * Walk the raw parsed tree and throw if any value outside "params" (or root-level "cloudflare") is an EnvRef or SecretRef.
 * Only params may use !Env / !Secret; root-level cloudflare.apiToken may use !Secret.
 */
function assertEnvAndSecretOnlyInParams(
  raw: Record<string, unknown>,
  isUnderParams = false,
  atRoot = true
): void {
  for (const [key, value] of Object.entries(raw)) {
    const underAllowed =
      isUnderParams || key === "params" || (key === "cloudflare" && atRoot);
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          assertEnvAndSecretOnlyInParams(item as Record<string, unknown>, underAllowed, false);
        }
      }
      continue;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (!underAllowed) {
        if (isTerminalEnvRef(obj)) {
          throw new Error(
            "!Env and !Secret are only allowed under params. Move them to params and use !Param in other sections."
          );
        }
        if (isTerminalSecretRef(obj)) {
          throw new Error(
            "!Env and !Secret are only allowed under params. Move them to params and use !Param in other sections."
          );
        }
      }
      assertEnvAndSecretOnlyInParams(obj, underAllowed, false);
    }
  }
}

/**
 * Walk a plain JS object/array tree and replace any `{ $ref }` values
 * with their resolved counterparts from the resolved params map.
 * Param values may be objects (e.g. DnsConfig).
 */
function deepResolveRefs(
  node: unknown,
  resolved: Record<string, ResolvedParamValue>
): unknown {
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

  assertEnvAndSecretOnlyInParams(raw);

  function fillNullRefsInParams(obj: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "object" && !Array.isArray(value)) {
        const o = value as Record<string, unknown>;
        if (isTerminalSecretRef(o)) {
          if ((o as { secret: string | null }).secret === null) (o as { secret: string }).secret = key;
        } else if (isTerminalEnvRef(o)) {
          if ((o as { env: string | null }).env === null) (o as { env: string }).env = key;
        } else {
          fillNullRefsInParams(o);
        }
      }
    }
  }
  for (const [key, value] of Object.entries(params)) {
    if (isSecretRef(value) && value.secret === null) {
      (value as { secret: string | null }).secret = key;
    } else if (isEnvRef(value) && value.env === null) {
      (value as { env: string | null }).env = key;
    } else if (typeof value === "object" && value !== null && !Array.isArray(value) && !isParamRef(value)) {
      fillNullRefsInParams(value as Record<string, unknown>);
    }
  }

  const resolvedParams = resolveParams(params);
  const resolvedMap = resolvedParams as Record<string, ResolvedValue | Record<string, unknown>>;
  for (const key of Object.keys(resolvedParams)) {
    const v = resolvedParams[key];
    if (typeof v === "object" && v !== null && !Array.isArray(v) && !isEnvRef(v) && !isSecretRef(v)) {
      resolvedMap[key] = deepResolveRefs(v, resolvedParams) as Record<string, unknown>;
    }
  }
  raw.params = resolvedParams;

  const resolved = deepResolveRefs(raw, resolvedParams) as CellConfig;
  if (resolved.domain && "host" in resolved.domain) {
    throw new Error(
      "domain.host is removed; use domain.subdomain and params.DOMAIN_ROOT (see docs/plans/2026-03-11-devbox-subdomain-design.md)."
    );
  }
  if (resolved.domains) {
    for (const [alias, d] of Object.entries(resolved.domains)) {
      if (d && "host" in d) {
        throw new Error(
          `domains.${alias}.host is removed; use domain.subdomain and params.DOMAIN_ROOT.`
        );
      }
    }
  }
  return resolved;
}

/**
 * Instance override file: only "params" at top level; values can be string, !Env, !Secret, or object (e.g. DNS).
 */
export interface InstanceOverrides {
  params: Record<string, ResolvedParamValue>;
}

/**
 * Load cell.<instance>.yaml and return param overrides only.
 * Instance name must match [a-zA-Z0-9_-]+.
 * Throws if file not found or invalid (e.g. non-params keys).
 */
export function loadInstanceOverrides(
  cellDir: string,
  instanceName: string
): InstanceOverrides {
  if (!INSTANCE_NAME_REGEX.test(instanceName)) {
    throw new Error(
      `Invalid instance name "${instanceName}": only letters, digits, hyphen and underscore allowed (e.g. sso-prod, staging).`
    );
  }
  const filePath = resolvePath(cellDir, `cell.${instanceName}.yaml`);
  if (!existsSync(filePath)) {
    throw new Error(
      `Instance file not found: cell.${instanceName}.yaml\n  → Path: ${filePath}`
    );
  }
  const content = readFileSync(filePath, "utf-8");
  return parseInstanceYaml(content);
}

/**
 * Parse instance YAML string. Only top-level "params" is allowed; values are string | !Env | !Secret.
 */
export function parseInstanceYaml(content: string): InstanceOverrides {
  const doc = parseDocument(content, { customTags });
  const raw = doc.toJS() as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { params: {} };
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    return { params: {} };
  }
  if (keys.length > 1 || !("params" in raw)) {
    throw new Error(
      'Instance file may only contain a top-level "params" key (param overrides for this instance).'
    );
  }
  const params = (raw.params ?? {}) as Record<string, unknown>;
  const result: Record<string, ResolvedParamValue> = {};
  function parseParamValue(value: unknown): ResolvedParamValue {
    if (value === null || value === undefined) {
      throw new Error("Instance file param value cannot be null or undefined.");
    }
    if (typeof value === "string") return value;
    if (typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (isTerminalSecretRef(obj)) {
        return { secret: (obj as SecretRef).secret || "" };
      }
      if (isTerminalEnvRef(obj)) {
        return { env: (obj as EnvRef).env || "" };
      }
      const nested: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        nested[k] = parseParamValue(v);
      }
      return nested;
    }
    throw new Error("Instance file param value must be a string, !Env, !Secret, or an object.");
  }
  for (const [key, value] of Object.entries(params)) {
    result[key] = parseParamValue(value);
  }
  return { params: result };
}

/**
 * Load base cell.yaml and optionally merge param overrides from cell.<instance>.yaml.
 * Use -i/--instance to select an instance (e.g. cell deploy -i sso-prod).
 */
export function loadCellConfig(cellDir: string, instance?: string): CellConfig {
  const basePath = resolvePath(cellDir, "cell.yaml");
  const config = loadCellYaml(basePath);
  if (instance) {
    const overrides = loadInstanceOverrides(cellDir, instance);
    config.params = { ...config.params, ...overrides.params };
  }
  return config;
}
