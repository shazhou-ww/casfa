import { resolve } from "node:path";
import { rimrafSync } from "rimraf";

export interface CleanOptions {
  cellDir?: string;
}

export function cleanCommand(options?: CleanOptions): void {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const dirs = [resolve(cellDir, ".cell"), resolve(cellDir, ".esbuild")];
  for (const dir of dirs) {
    rimrafSync(dir);
  }
  console.log("Cleaned .cell and .esbuild");
}
