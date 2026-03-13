import fs from "node:fs";
import path from "node:path";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";
import { resolveCellDir } from "../config/resolve-cell-dir.js";

/**
 * Run biome check in each resolved cellDir. With fix: add --write; with unsafe: add --unsafe.
 * Aggregate exit codes; if any cell fails, exit(1). Cells without cell.yaml are skipped.
 * Cells should have biome in their dependencies, or the monorepo root may provide it.
 */
export async function lintCommand(
  rootDir: string,
  options?: { fix?: boolean; unsafe?: boolean }
): Promise<void> {
  const root = path.resolve(rootDir);
  const otavia = loadOtaviaYaml(root);
  let failed = false;

  const args = [
    "bun",
    "x",
    "biome",
    "check",
    ".",
    ...(options?.fix ? ["--write"] : []),
    ...(options?.unsafe ? ["--unsafe"] : []),
  ];

  for (const entry of otavia.cellsList) {
    const cellDir = resolveCellDir(root, entry.package);
    if (!fs.existsSync(path.join(cellDir, "cell.yaml"))) {
      console.warn(`Skipping ${entry.mount}: cell not found`);
      continue;
    }

    const proc = Bun.spawn(args, {
      cwd: cellDir,
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
}
