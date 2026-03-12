import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";

const DEFAULT_UNIT_PATTERN = "**/__tests__/*.test.ts";
const CELL_YAML = "cell.yaml";

interface CellYamlTesting {
  unit?: string;
}

interface CellYaml {
  testing?: CellYamlTesting;
}

function loadCellYaml(appsDir: string, cellId: string): CellYaml | null {
  const cellPath = path.join(appsDir, cellId, CELL_YAML);
  if (!fs.existsSync(cellPath)) {
    return null;
  }
  const raw = fs.readFileSync(cellPath, "utf-8");
  const doc = parseDocument(raw);
  const data = doc.toJSON() as Record<string, unknown> | null | undefined;
  if (data == null || typeof data !== "object") {
    return {};
  }
  const testing = data.testing;
  if (testing == null || typeof testing !== "object" || Array.isArray(testing)) {
    return { testing: undefined };
  }
  const unit = (testing as Record<string, unknown>).unit;
  return {
    testing: {
      unit: typeof unit === "string" ? unit : undefined,
    },
  };
}

/**
 * Resolve glob patterns to detect if any test files exist under the given pattern.
 * - If pattern ends with "/", treat as directory and look for .test.ts and .spec.ts under it.
 * - Otherwise use pattern as-is (e.g. __tests__/*.test.ts).
 */
function getGlobPatterns(pattern: string): string[] {
  const p = pattern.trim();
  if (p.endsWith("/")) {
    return [p + "**/*.test.ts", p + "**/*.spec.ts"];
  }
  return [p];
}

async function hasTestFiles(cellDir: string, pattern: string): Promise<boolean> {
  const patterns = getGlobPatterns(pattern);
  const { Glob } = await import("bun");
  for (const p of patterns) {
    const glob = new Glob(p);
    for await (const _ of glob.scan({ cwd: cellDir, onlyFiles: true })) {
      return true;
    }
  }
  return false;
}

/**
 * Run unit tests for all cells: load otavia.yaml, for each cell load cell.yaml,
 * get testing.unit pattern (default: __tests__/*.test.ts), run bun test in apps/cellId.
 * If no test files found for a cell, skip and log. Aggregate exit codes; if any cell fails, exit(1).
 */
export async function testUnitCommand(rootDir: string): Promise<void> {
  const root = path.resolve(rootDir);
  const otavia = loadOtaviaYaml(root);
  const appsDir = path.join(root, "apps");
  const failedCells: string[] = [];

  for (const cellId of otavia.cells) {
    const cellDir = path.join(appsDir, cellId);
    if (!fs.existsSync(cellDir)) {
      console.warn(`Skipping ${cellId}: apps/${cellId} not found`);
      continue;
    }

    const cellConfig = loadCellYaml(appsDir, cellId);
    const pattern =
      cellConfig?.testing?.unit ?? DEFAULT_UNIT_PATTERN;

    const hasTests = await hasTestFiles(cellDir, pattern);
    if (!hasTests) {
      console.log(`Skipping ${cellId}: no unit tests`);
      continue;
    }

    const proc = Bun.spawn(["bun", "test", pattern], {
      cwd: cellDir,
      stdio: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      failedCells.push(cellId);
    }
  }

  if (failedCells.length > 0) {
    console.error(`Unit tests failed for: ${failedCells.join(", ")}`);
    process.exit(1);
  }
}

/**
 * E2E test command placeholder (Task 12).
 */
export async function testE2eCommand(_rootDir: string): Promise<void> {
  console.log("E2E not implemented");
  process.exit(0);
}
