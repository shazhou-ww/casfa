/**
 * CloudFormation fragment types for Otavia deploy.
 */

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
