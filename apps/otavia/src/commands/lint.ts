import fs from "node:fs";
import path from "node:path";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";

/**
 * Run biome check in each apps/<cellId>. With fix: add --write; with unsafe: add --unsafe.
 * Aggregate exit codes; if any cell fails, exit(1). Cells without apps/<cellId> are skipped.
 * Cells should have biome in their dependencies, or the monorepo root may provide it.
 */
export async function lintCommand(
  rootDir: string,
  options?: { fix?: boolean; unsafe?: boolean }
): Promise<void> {
  const root = path.resolve(rootDir);
  const otavia = loadOtaviaYaml(root);
  const appsDir = path.join(root, "apps");
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

  for (const cellId of otavia.cells) {
    const cellDir = path.join(appsDir, cellId);
    if (!fs.existsSync(cellDir)) {
      console.warn(`Skipping ${cellId}: apps/${cellId} not found`);
      continue;
    }

    const proc = Bun.spawn(args, {
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
