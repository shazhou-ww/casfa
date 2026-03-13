import { isEnvRef, isParamRef, isSecretRef } from "./cell-yaml-schema.js";

/** Thrown when a required !Env or !Secret is missing from envMap and onMissingParam is "throw". */
export class MissingParamsError extends Error {
  readonly missingKeys: string[];

  constructor(missingKeys: string[]) {
    const message = [
      "",
      "Missing required params:",
      ...missingKeys.map((k) => `  ${k}`),
      "",
      "Add them to your .env files, then retry.",
      "",
    ].join("\n");
    super(message);
    this.name = "MissingParamsError";
    this.missingKeys = missingKeys;
  }
}

/** Thrown when a cell declares required params but otavia.yaml does not provide values. */
export class MissingDeclaredParamsError extends Error {
  readonly missingKeys: string[];

  constructor(missingKeys: string[], context?: string) {
    const header = context ? `Missing required params for ${context}:` : "Missing required params:";
    const message = ["", header, ...missingKeys.map((k) => `  ${k}`), ""].join("\n");
    super(message);
    this.name = "MissingDeclaredParamsError";
    this.missingKeys = missingKeys;
  }
}

/** True if value is a plain object (nested config), not EnvRef/SecretRef. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !isEnvRef(v) &&
    !isSecretRef(v)
  );
}

/**
 * Merge stack and cell params; top-level key override: cell wins over stack.
 */
export function mergeParams(
  stackParams?: Record<string, unknown>,
  cellParams?: Record<string, unknown>
): Record<string, unknown> {
  const stack = stackParams ?? {};
  const cell = cellParams ?? {};

  function resolveCellValue(value: unknown): unknown {
    if (isParamRef(value)) {
      return stack[value.param];
    }
    if (Array.isArray(value)) {
      return value.map((v) => resolveCellValue(v));
    }
    if (typeof value === "object" && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = resolveCellValue(v);
      }
      return out;
    }
    return value;
  }

  const resolvedCell: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cell)) {
    resolvedCell[k] = resolveCellValue(v);
  }
  return { ...stack, ...resolvedCell };
}

/**
 * Validate that all declared param keys exist in provided params.
 * Value `undefined` is treated as missing.
 */
export function assertDeclaredParamsProvided(
  declaredParams: string[] | undefined,
  providedParams: Record<string, unknown>,
  context?: string
): void {
  if (!declaredParams || declaredParams.length === 0) return;
  const missing: string[] = [];
  for (const key of declaredParams) {
    if (!Object.prototype.hasOwnProperty.call(providedParams, key) || providedParams[key] === undefined) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new MissingDeclaredParamsError(missing, context);
  }
}

const PLACEHOLDER = "[missing]";

/**
 * Resolve !Env and !Secret in merged params using envMap.
 * Recurses into nested objects; only leaf EnvRef/SecretRef are replaced.
 * - onMissingParam "throw": throw MissingParamsError with list of missing keys.
 * - onMissingParam "placeholder": use PLACEHOLDER for missing values.
 */
export function resolveParams(
  mergedParams: Record<string, unknown>,
  envMap: Record<string, string>,
  options?: { onMissingParam?: "throw" | "placeholder" }
): Record<string, string | unknown> {
  const onMissing = options?.onMissingParam ?? "throw";
  const missingKeys: string[] = [];

  function resolveValue(value: unknown): string | unknown {
    if (isEnvRef(value)) {
      const v = envMap[value.env];
      if (v === undefined) {
        if (onMissing === "throw") {
          missingKeys.push(value.env);
          return value;
        }
        return PLACEHOLDER;
      }
      return v;
    }
    if (isSecretRef(value)) {
      const v = envMap[value.secret];
      if (v === undefined) {
        if (onMissing === "throw") {
          missingKeys.push(value.secret);
          return value;
        }
        return PLACEHOLDER;
      }
      return v;
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = resolveValue(v);
      }
      return out;
    }
    return value;
  }

  const result: Record<string, string | unknown> = {};
  for (const [key, value] of Object.entries(mergedParams)) {
    result[key] = resolveValue(value);
  }

  if (onMissing === "throw" && missingKeys.length > 0) {
    throw new MissingParamsError([...new Set(missingKeys)]);
  }

  return result;
}
