import fs from "node:fs";
import path from "node:path";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";
import { resolveCellDir } from "../config/resolve-cell-dir.js";

function removeDirIfExists(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Clean command: remove temp dirs (.cell, .esbuild, .otavia) from root and from each cell directory.
 * Does NOT delete .env or .env.local.
 */
export function cleanCommand(rootDir: string): void {
  const otavia = loadOtaviaYaml(rootDir);

  // Root-level temp dirs
  removeDirIfExists(path.join(rootDir, ".cell"));
  removeDirIfExists(path.join(rootDir, ".esbuild"));
  removeDirIfExists(path.join(rootDir, ".otavia"));

  // Per-cell temp dirs
  for (const entry of otavia.cellsList) {
    const cellDir = resolveCellDir(rootDir, entry.package);
    removeDirIfExists(path.join(cellDir, ".cell"));
    removeDirIfExists(path.join(cellDir, ".esbuild"));
  }

  console.log("Cleaned .cell, .esbuild, .otavia");
}
