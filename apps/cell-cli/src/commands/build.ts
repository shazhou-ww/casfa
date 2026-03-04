import { resolve, relative, dirname } from "node:path";
import { mkdirSync, existsSync, cpSync } from "node:fs";
import { build } from "esbuild";
import { build as viteBuild, mergeConfig, defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { ensureIndexHtml } from "../utils/frontend.js";

export async function buildCommand(options?: {
  cellDir?: string;
}): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const buildDir = resolve(cellDir, ".cell/build");

  const outputs: string[] = [];

  if (config.backend) {
    for (const [name, entry] of Object.entries(config.backend.entries)) {
      const handlerPath = resolve(cellDir, entry.handler);
      const outfile = resolve(buildDir, name, "index.cjs");
      mkdirSync(dirname(outfile), { recursive: true });

      console.log(`Building backend [${name}]...`);
      await build({
        entryPoints: [handlerPath],
        bundle: true,
        platform: "node",
        target: "node20",
        format: "cjs",
        outfile,
        sourcemap: true,
        external: ["@aws-sdk/*"],
      });
      const rel = relative(cellDir, outfile);
      console.log(`  → ${rel}`);
      outputs.push(rel);
    }
  }

  if (config.frontend) {
    const frontendDir = resolve(cellDir, config.frontend.dir);
    ensureIndexHtml(frontendDir, config);

    const baseConfig: UserConfig = defineConfig({
      plugins: [react()],
    });

    let finalConfig: UserConfig;
    const userConfigPath = resolve(frontendDir, "vite.config.ts");
    if (existsSync(userConfigPath)) {
      const userMod = await import(userConfigPath);
      const userConfig = userMod.default ?? userMod;
      finalConfig = mergeConfig(userConfig, baseConfig);
    } else {
      finalConfig = baseConfig;
    }

    console.log("Building frontend...");
    await viteBuild({
      ...finalConfig,
      root: frontendDir,
      configFile: false,
    });

    const viteDist = resolve(frontendDir, "dist");
    const frontendBuildDir = resolve(buildDir, "frontend");
    if (existsSync(viteDist)) {
      mkdirSync(frontendBuildDir, { recursive: true });
      cpSync(viteDist, frontendBuildDir, { recursive: true });
      const rel = relative(cellDir, frontendBuildDir);
      console.log(`  → ${rel}`);
      outputs.push(rel);
    }
  }

  console.log("\nBuild complete!");
  if (outputs.length > 0) {
    console.log("Outputs:");
    for (const o of outputs) {
      console.log(`  ${o}`);
    }
  }
}
