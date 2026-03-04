import type { ResolvedValue } from "../config/cell-yaml-schema.js";

export type CfnFragment = {
  Resources: Record<string, unknown>;
  Outputs?: Record<string, unknown>;
  Conditions?: Record<string, unknown>;
};

export function toPascalCase(s: string): string {
  return s
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function cfnResolveValue(cellName: string, value: ResolvedValue): string {
  if (typeof value === "string") return value;
  return `{{resolve:secretsmanager:${cellName}/${value.secret}}}`;
}
