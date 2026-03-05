import type { RawParamValue, ResolvedValue } from "./cell-yaml-schema.js";
import { isEnvRef, isParamRef, isSecretRef } from "./cell-yaml-schema.js";

/**
 * Resolve all `{ $ref }` references in a params map via topological sort.
 * After resolution, only `string`, `SecretRef`, and `EnvRef` values remain.
 */
export function resolveParams(
  params: Record<string, RawParamValue>
): Record<string, ResolvedValue> {
  const resolved = new Map<string, ResolvedValue>();
  const visiting = new Set<string>();

  function resolve(key: string, chain: string[]): ResolvedValue {
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
    let result: ResolvedValue;

    if (isParamRef(value)) {
      result = resolve(value.$ref, [...chain, key]);
    } else if (isSecretRef(value)) {
      result = value;
    } else if (isEnvRef(value)) {
      result = value;
    } else {
      result = value;
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
