import fs from "node:fs";
import path from "node:path";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";
import { resolveCellDir } from "../config/resolve-cell-dir.js";

/**
 * Run tsc --noEmit in each resolved cellDir. Aggregate exit codes; if any cell
 * fails, exit(1). Cells without cell.yaml are skipped with a warning.
 * Uses bun x tsc so each cell's node_modules/.bin/tsc is used when present.
 */
export async function typecheckCommand(rootDir: string): Promise<void> {
  const root = path.resolve(rootDir);
  const otavia = loadOtaviaYaml(root);
  let failed = false;

  for (const entry of otavia.cellsList) {
    const cellDir = resolveCellDir(root, entry.package);
    if (!fs.existsSync(path.join(cellDir, "cell.yaml"))) {
      console.warn(`Skipping ${entry.mount}: cell not found`);
      continue;
    }

    const proc = Bun.spawn(["bun", "x", "tsc", "--noEmit"], {
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
