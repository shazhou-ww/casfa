import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { loadEnvForCell } from "./env.js";

function write(path: string, content: string): void {
  writeFileSync(path, content.trim() + "\n", "utf-8");
}

describe("loadEnvForCell", () => {
  test("deploy stage uses .env + .env.deploy and skips .env.local", () => {
    const root = mkdtempSync(join(tmpdir(), "otavia-env-deploy-"));
    try {
      const cellDir = join(root, "apps", "demo");
      mkdirSync(cellDir, { recursive: true });
      write(join(root, ".env"), "SSO_BASE_URL=http://localhost:7100/sso\nSHARED=base");
      write(join(root, ".env.deploy"), "SSO_BASE_URL=https://beta.casfa.shazhou.me/sso");
      write(join(root, ".env.local"), "SSO_BASE_URL=http://local-override.invalid/sso");
      write(join(cellDir, ".env"), "CELL_ONLY=1");
      write(join(cellDir, ".env.deploy"), "DEPLOY_ONLY=1");
      write(join(cellDir, ".env.local"), "CELL_LOCAL_ONLY=1");

      const env = loadEnvForCell(root, "demo", { stage: "deploy" });
      expect(env.SSO_BASE_URL).toBe("https://beta.casfa.shazhou.me/sso");
      expect(env.SHARED).toBe("base");
      expect(env.CELL_ONLY).toBe("1");
      expect(env.DEPLOY_ONLY).toBe("1");
      expect(env.CELL_LOCAL_ONLY).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dev stage applies .env.dev and .env.local overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "otavia-env-dev-"));
    try {
      const cellDir = join(root, "apps", "demo");
      mkdirSync(cellDir, { recursive: true });
      write(join(root, ".env"), "SSO_BASE_URL=http://localhost:7100/sso\nLOG_LEVEL=info");
      write(join(root, ".env.dev"), "LOG_LEVEL=debug");
      write(join(root, ".env.local"), "LOG_LEVEL=trace");
      write(join(cellDir, ".env"), "LOG_LEVEL=warn");
      write(join(cellDir, ".env.dev"), "LOG_LEVEL=error");
      write(join(cellDir, ".env.local"), "LOG_LEVEL=fatal");

      const env = loadEnvForCell(root, cellDir, { stage: "dev" });
      expect(env.SSO_BASE_URL).toBe("http://localhost:7100/sso");
      expect(env.LOG_LEVEL).toBe("fatal");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("test stage applies .env.test and skips .env.local", () => {
    const root = mkdtempSync(join(tmpdir(), "otavia-env-test-"));
    try {
      const cellDir = join(root, "apps", "demo");
      mkdirSync(cellDir, { recursive: true });
      write(join(root, ".env"), "A=base");
      write(join(root, ".env.test"), "A=test");
      write(join(root, ".env.local"), "A=local");
      write(join(cellDir, ".env"), "B=cell");
      write(join(cellDir, ".env.test"), "B=cell-test");
      write(join(cellDir, ".env.local"), "B=cell-local");

      const env = loadEnvForCell(root, "demo", { stage: "test" });
      expect(env.A).toBe("test");
      expect(env.B).toBe("cell-test");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
