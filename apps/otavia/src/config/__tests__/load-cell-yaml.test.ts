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

  test("accepts minimal oauth config", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
name: oauth-cell
oauth:
  enabled: true
  role: resource_server
  scopes:
    - use_mcp
`
      );
      const result = loadCellConfig(tmp);
      expect(result.oauth).toEqual({
        enabled: true,
        role: "resource_server",
        scopes: ["use_mcp"],
      });
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when oauth enabled but scopes is empty", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
name: oauth-cell
oauth:
  enabled: true
  role: both
  scopes: []
`
      );
      expect(() => loadCellConfig(tmp)).toThrow(
        "cell.yaml: 'oauth.scopes' must be a non-empty array of strings when oauth.enabled is true"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when oauth uses unsupported v1 fields", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
name: oauth-cell
oauth:
  enabled: true
  role: authorization_server
  scopes:
    - use_mcp
  issuerPath: /agent
`
      );
      expect(() => loadCellConfig(tmp)).toThrow(
        "cell.yaml: 'oauth.issuerPath' is not supported in v1; issuer path is derived from mount"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when oauth role is invalid", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
name: oauth-cell
oauth:
  enabled: true
  role: invalid_role
  scopes:
    - use_mcp
`
      );
      expect(() => loadCellConfig(tmp)).toThrow(
        "cell.yaml: 'oauth.role' must be one of: resource_server, authorization_server, both"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when oauth.discovery is present in v1", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-cell-"));
    try {
      writeCellYaml(
        tmp,
        `
name: oauth-cell
oauth:
  enabled: true
  role: authorization_server
  scopes:
    - use_mcp
  discovery:
    enabled: false
`
      );
      expect(() => loadCellConfig(tmp)).toThrow(
        "cell.yaml: 'oauth.discovery' is not supported in v1; discovery is automatic for oauth-enabled cells"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});
