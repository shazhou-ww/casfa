import fs from "fs";
import path from "path";
import { parseDocument, type SchemaOptions } from "yaml";
import type { OtaviaYaml } from "./otavia-yaml-schema.js";
import { isEnvRef, isParamRef, isSecretRef } from "./cell-yaml-schema.js";

const CONFIG_FILENAME = "otavia.yaml";
const DEFAULT_SCOPE = "@casfa";

type CellRef = { mount: string; package: string; params?: Record<string, unknown> };

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
  {
    tag: "!Param",
    resolve(value: string) {
      return { param: value ?? "" };
    },
  },
];

function walkParamTree(
  value: unknown,
  pathLabel: string,
  visitor: (v: unknown, p: string) => void
): void {
  visitor(value, pathLabel);
  if (value == null || typeof value !== "object" || Array.isArray(value)) return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    walkParamTree(v, `${pathLabel}.${k}`, visitor);
  }
}

function packageToMount(packageName: string): string {
  const trimmed = packageName.trim();
  if (trimmed.length === 0) return trimmed;
  const parts = trimmed.split("/");
  return trimmed.startsWith("@") ? (parts[1] ?? "") : (parts[0] ?? "");
}

function normalizeParams(value: unknown, pathLabel: string): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseCells(data: unknown): { cells: Record<string, string>; cellsList: CellRef[] } {
  if (data == null) {
    throw new Error("otavia.yaml: missing cells");
  }
  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new Error("otavia.yaml: cells must be a non-empty array or object");
    }
    const cellsList: CellRef[] = [];
    for (let i = 0; i < data.length; i += 1) {
      const item = data[i];
      const itemPath = `otavia.yaml: cells[${i}]`;
      if (typeof item === "string") {
        const mount = item.trim();
        if (!mount) throw new Error(`${itemPath} must be a non-empty string`);
        cellsList.push({ mount, package: `${DEFAULT_SCOPE}/${mount}` });
        continue;
      }
      if (item == null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`${itemPath} must be a string or an object { package, mount?, params? }`);
      }
      const record = item as Record<string, unknown>;
      const packageName = typeof record.package === "string" ? record.package.trim() : "";
      if (!packageName) throw new Error(`${itemPath}.package must be a non-empty string`);
      const mount =
        typeof record.mount === "string" && record.mount.trim()
          ? record.mount.trim()
          : packageToMount(packageName);
      if (!mount) throw new Error(`${itemPath}.mount is required when package cannot infer mount`);
      const params = normalizeParams(record.params, `${itemPath}.params`);
      cellsList.push({ mount, package: packageName, params });
    }
    const cells = Object.fromEntries(cellsList.map((c) => [c.mount, c.package]));
    return { cells, cellsList };
  }
  if (typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) {
      throw new Error("otavia.yaml: cells object must have at least one entry");
    }
    const cellsList: CellRef[] = [];
    for (const [mountRaw, cellDef] of entries) {
      const mount = mountRaw.trim();
      if (typeof mount !== "string" || mount === "") {
        throw new Error("otavia.yaml: cells keys (mount) must be non-empty strings");
      }
      if (typeof cellDef === "string") {
        const packageName = cellDef.trim();
        if (!packageName) {
          throw new Error(`otavia.yaml: cells["${mount}"] must be a non-empty package name string`);
        }
        cellsList.push({ mount, package: packageName });
        continue;
      }
      if (cellDef == null || typeof cellDef !== "object" || Array.isArray(cellDef)) {
        throw new Error(
          `otavia.yaml: cells["${mount}"] must be a package string or object { package, params? }`
        );
      }
      const record = cellDef as Record<string, unknown>;
      const packageName = typeof record.package === "string" ? record.package.trim() : "";
      if (!packageName) {
        throw new Error(`otavia.yaml: cells["${mount}"].package must be a non-empty string`);
      }
      const params = normalizeParams(record.params, `otavia.yaml: cells["${mount}"].params`);
      cellsList.push({ mount, package: packageName, params });
    }
    const cells = Object.fromEntries(cellsList.map((c) => [c.mount, c.package]));
    return { cells, cellsList };
  }
  throw new Error("otavia.yaml: cells must be an array or an object");
}

export function loadOtaviaYaml(rootDir: string): OtaviaYaml {
  const configPath = path.resolve(rootDir, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    throw new Error("otavia.yaml not found");
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const doc = parseDocument(raw, { customTags });
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

  const { cells, cellsList } = parseCells(data.cells);
  let defaultCell: string | undefined;
  if (data.defaultCell != null) {
    if (typeof data.defaultCell !== "string") {
      throw new Error("otavia.yaml: defaultCell must be a string");
    }
    const normalized = data.defaultCell.trim();
    if (!normalized) {
      throw new Error("otavia.yaml: defaultCell must be a string");
    }
    const mountSet = new Set(cellsList.map((cell) => cell.mount));
    if (!mountSet.has(normalized)) {
      throw new Error(
        `otavia.yaml: defaultCell "${normalized}" must match one of configured cell mounts`
      );
    }
    defaultCell = normalized;
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
    defaultCell,
    cells,
    cellsList,
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
    walkParamTree(result.params, "otavia.yaml: params", (v, p) => {
      if (isParamRef(v)) {
        throw new Error(`${p} cannot use !Param; top-level params only allow plain values, !Env, !Secret`);
      }
    });
  }
  for (const cell of result.cellsList) {
    if (!cell.params) continue;
    walkParamTree(cell.params, `otavia.yaml: cells["${cell.mount}"].params`, (v, p) => {
      if (isEnvRef(v) || isSecretRef(v)) {
        throw new Error(`${p} cannot use !Env/!Secret; use !Param to reference top-level params`);
      }
    });
  }
  return result;
}
