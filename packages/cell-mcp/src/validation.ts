import type { ZodError } from "zod";

export function formatToolValidationError(toolName: string, error: ZodError): string {
  const lines = [`Tool '${toolName}' validation failed:`];
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    lines.push(`${path}: ${issue.message}`);
  }
  return lines.join("\n");
}
