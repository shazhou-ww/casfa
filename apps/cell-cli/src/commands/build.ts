import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "esbuild";
import { defineConfig, mergeConfig, type UserConfig, build as viteBuild } from "vite";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { getWorkspaceAlias } from "../utils/vite-config.js";

export async function buildCommand(options?: { cellDir?: string }): Promise<void> {
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

    const userConfigPath = resolve(frontendDir, "vite.config.ts");
    const baseConfig: UserConfig = existsSync(userConfigPath)
      ? {}
      : defineConfig({
          plugins: [react()],
          resolve: (() => {
            const alias = getWorkspaceAlias(frontendDir, cellDir);
            return {
              ...(Object.keys(alias).length > 0 ? { alias } : undefined),
              conditions: ["bun"],
            };
          })(),
          build: { outDir: "dist", emptyOutDir: true },
        });

    let finalConfig: UserConfig;
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

    if (config.cognito && config.domain?.host) {
      const issuer = `https://${config.domain.host}`;
      const wellKnown = resolve(frontendDir, "dist", ".well-known", "oauth-authorization-server");
      mkdirSync(dirname(wellKnown), { recursive: true });
      writeFileSync(
        wellKnown,
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/oauth/authorize`,
          token_endpoint: `${issuer}/oauth/token`,
          registration_endpoint: `${issuer}/oauth/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        }),
        "utf8"
      );
    }

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
