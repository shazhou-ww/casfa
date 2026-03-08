import type { RawParamValue, ResolvedParamValue, ResolvedValue } from "./cell-yaml-schema.js";
import { isEnvRef, isParamRef, isSecretRef } from "./cell-yaml-schema.js";

/** True if value is a plain object (e.g. DnsConfig), not EnvRef/SecretRef/ParamRef */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !isEnvRef(v) &&
    !isSecretRef(v) &&
    !isParamRef(v)
  );
}

/**
 * Resolve all `{ $ref }` references in a params map via topological sort.
 * Param values may be objects (e.g. DNS: { provider, zoneId?, apiToken? }); they are kept as-is.
 */
export function resolveParams(
  params: Record<string, RawParamValue>
): Record<string, ResolvedParamValue> {
  const resolved = new Map<string, ResolvedParamValue>();
  const visiting = new Set<string>();

  function resolve(key: string, chain: string[]): ResolvedParamValue {
    if (resolved.has(key)) return resolved.get(key)!;

    if (!(key in params)) {
      throw new Error(
        `Param reference to non-existent key "${key}" (referenced from: ${chain.join(" → ")})`
      );
    }

    if (visiting.has(key)) {
      const cycleStart = chain.indexOf(key);
      const cyclePath = [...chain.slice(cycleStart), key].join(" → ");
      throw new Error(`Circular param reference detected: ${cyclePath}`);
    }

    visiting.add(key);

    const value = params[key];
    let result: ResolvedParamValue;

    if (isParamRef(value)) {
      result = resolve(value.$ref, [...chain, key]);
    } else if (isSecretRef(value)) {
      result = value;
    } else if (isEnvRef(value)) {
      result = value;
    } else if (isPlainObject(value)) {
      result = value;
    } else {
      result = value as ResolvedValue;
    }

    visiting.delete(key);
    resolved.set(key, result);
    return result;
  }

  for (const key of Object.keys(params)) {
    resolve(key, []);
  }

  return Object.fromEntries(resolved);
}
