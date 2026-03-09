import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PAIRS: [string, string][] = [
  [".env.example", ".env"],
  [".env.local.example", ".env.local"],
];

export async function setupCommand(options?: { cellDir?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());

  for (const [srcName, destName] of ENV_PAIRS) {
    const srcPath = resolve(cellDir, srcName);
    const destPath = resolve(cellDir, destName);

    if (!existsSync(srcPath)) {
      console.log(`  Skip ${destName}: ${srcName} not found`);
      continue;
    }
    if (existsSync(destPath)) {
      console.log(`  Skip ${destName}: already exists`);
      continue;
    }

    copyFileSync(srcPath, destPath);
    console.log(`  Created ${destName} from ${srcName}`);
  }

  console.log("Setup done. Edit .env and .env.local as needed.");
}
