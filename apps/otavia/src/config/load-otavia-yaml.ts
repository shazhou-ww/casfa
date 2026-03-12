import fs from "fs";
import path from "path";
import { parseDocument } from "yaml";
import type { OtaviaYaml } from "./otavia-yaml-schema.js";

const CONFIG_FILENAME = "otavia.yaml";

export function loadOtaviaYaml(rootDir: string): OtaviaYaml {
  const configPath = path.resolve(rootDir, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    throw new Error("otavia.yaml not found");
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const doc = parseDocument(raw);
  const data = doc.toJSON() as Record<string, unknown> | null | undefined;
  if (data == null || typeof data !== "object") {
    throw new Error("otavia.yaml: invalid YAML or empty document");
  }

  if (data.stackName == null || data.stackName === "") {
    throw new Error("otavia.yaml: missing stackName");
  }
  if (typeof data.stackName !== "string") {
    throw new Error("otavia.yaml: stackName must be a string");
  }

  if (data.cells == null) {
    throw new Error("otavia.yaml: missing cells");
  }
  if (!Array.isArray(data.cells)) {
    throw new Error("otavia.yaml: cells must be an array");
  }
  if (data.cells.length === 0) {
    throw new Error("otavia.yaml: cells must be a non-empty array");
  }
  if (!data.cells.every((c): c is string => typeof c === "string")) {
    throw new Error("otavia.yaml: cells must be an array of strings");
  }

  if (data.domain == null || typeof data.domain !== "object") {
    throw new Error("otavia.yaml: missing domain");
  }
  const domain = data.domain as Record<string, unknown>;
  if (domain.host == null || domain.host === "") {
    throw new Error("otavia.yaml: missing domain.host");
  }
  if (typeof domain.host !== "string") {
    throw new Error("otavia.yaml: domain.host must be a string");
  }

  const result: OtaviaYaml = {
    stackName: data.stackName as string,
    cells: data.cells as string[],
    domain: {
      host: domain.host as string,
      dns:
        domain.dns != null && typeof domain.dns === "object"
          ? {
              provider:
                (domain.dns as Record<string, unknown>).provider as
                  | string
                  | undefined,
              zone: (domain.dns as Record<string, unknown>).zone as
                | string
                | undefined,
              zoneId: (domain.dns as Record<string, unknown>).zoneId as
                | string
                | undefined,
            }
          : undefined,
    },
  };
  if (data.params != null && typeof data.params === "object" && !Array.isArray(data.params)) {
    result.params = data.params as Record<string, unknown>;
  }
  return result;
}
