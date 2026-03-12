import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { loadCellConfig } from "../load-cell-yaml.js";

function writeCellYaml(dir: string, content: string) {
  const filePath = path.join(dir, "cell.yaml");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("loadCellConfig", () => {
  test("returns correct structure for minimal valid cell.yaml", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
name: my-cell
`
      );
      const result = loadCellConfig(tmp);
      expect(result.name).toBe("my-cell");
      expect(result.backend).toBeUndefined();
      expect(result.frontend).toBeUndefined();
      expect(result.params).toBeUndefined();
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("returns backend and declared params when present", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
name: app-cell
backend:
  runtime: bun
  entries:
    api:
      handler: backend/handler.ts
      timeout: 30
      memory: 256
      routes:
        - /api/*
params:
  - DOMAIN_ROOT
  - SSO_BASE_URL
`
      );
      const result = loadCellConfig(tmp);
      expect(result.name).toBe("app-cell");
      expect(result.backend?.runtime).toBe("bun");
      expect(result.backend?.entries?.api?.handler).toBe("backend/handler.ts");
      expect(result.backend?.entries?.api?.routes).toEqual(["/api/*"]);
      expect(result.params).toEqual(["DOMAIN_ROOT", "SSO_BASE_URL"]);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when name is missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
backend:
  runtime: bun
  entries: {}
`
      );
      expect(() => loadCellConfig(tmp)).toThrow("cell.yaml: missing required field 'name'");
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when name is empty string", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
name: ""
`
      );
      expect(() => loadCellConfig(tmp)).toThrow("cell.yaml: 'name' must be a non-empty string");
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when params is not string array", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
name: secret-cell
params:
  API_KEY: value
`
      );
      expect(() => loadCellConfig(tmp)).toThrow("cell.yaml: 'params' must be an array of strings");
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when !Env or !Secret appears in cell.yaml", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
name: secret-cell
params:
  - API_KEY
runtimeParam: !Secret BFL_API_KEY
`
      );
      expect(() => loadCellConfig(tmp)).toThrow(
        "cell.yaml: !Env and !Secret are not supported; move refs to otavia.yaml params"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});
