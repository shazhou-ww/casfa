import fs from "node:fs";
import path from "node:path";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";

/**
 * Run tsc --noEmit in each apps/<cellId>. Aggregate exit codes; if any cell
 * fails, exit(1). Cells without apps/<cellId> are skipped with a warning.
 * Uses bun x tsc so each cell's node_modules/.bin/tsc is used when present.
 */
export async function typecheckCommand(rootDir: string): Promise<void> {
  const root = path.resolve(rootDir);
  const otavia = loadOtaviaYaml(root);
  const appsDir = path.join(root, "apps");
  let failed = false;

  for (const cellId of otavia.cells) {
    const cellDir = path.join(appsDir, cellId);
    if (!fs.existsSync(cellDir)) {
      console.warn(`Skipping ${cellId}: apps/${cellId} not found`);
      continue;
    }

    const proc = Bun.spawn(["bun", "x", "tsc", "--noEmit"], {
      cwd: cellDir,
      stdio: "inherit",
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
