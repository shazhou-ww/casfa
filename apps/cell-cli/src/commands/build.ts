import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "esbuild";
import { defineConfig, mergeConfig, type UserConfig, build as viteBuild } from "vite";
import type { CellConfig } from "../config/cell-yaml-schema.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { loadStackYaml } from "../config/load-stack-yaml.js";
import type { ResolvedConfig } from "../config/resolve-config.js";
import { MissingParamsError, resolveConfig } from "../config/resolve-config.js";
import { loadEnvFiles } from "../utils/env.js";
import { getWorkspaceAlias } from "../utils/vite-config.js";

/** Options for platform build: output under root dist/<pathPrefix> with base path. */
interface PlatformFrontendOverrides {
  base: string;
  outDir: string;
}

async function buildFrontend(
  cellDir: string,
  config: CellConfig,
  resolved: ResolvedConfig,
  opts: {
    copyToCellBuild: boolean;
    platformOverrides?: PlatformFrontendOverrides;
  }
): Promise<string[]> {
  if (!config.frontend) return [];
  const outputs: string[] = [];
  const frontendDir = resolve(cellDir, config.frontend.dir);
  const entries = config.frontend.entries;
  const buildDir = resolve(cellDir, ".cell/build");

  const rollupInput: Record<string, string> = {};
  for (const [name, fe] of Object.entries(entries)) {
    rollupInput[name] = resolve(frontendDir, fe.entry);
  }

  const entryFileNamesForRoutes = (chunkInfo: { name: string }): string => {
    const ent = entries[chunkInfo.name];
    if (ent?.routes[0] && !ent.entry.toLowerCase().endsWith(".html")) {
      return ent.routes[0].replace(/^\//, "");
    }
    return "assets/[name]-[hash].js";
  };

  const baseFromEnv = process.env.BASE_PATH;
  const outDirFromEnv = process.env.OUT_DIR;
  const platform = opts.platformOverrides;
  const base = platform?.base ?? baseFromEnv ?? undefined;
  const outDirOverride = platform?.outDir ?? (outDirFromEnv ? resolve(outDirFromEnv) : undefined);

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
        build: {
          outDir: outDirOverride ?? "dist",
          emptyOutDir: true,
          rollupOptions: {
            input: rollupInput,
            output: { entryFileNames: entryFileNamesForRoutes },
          },
        },
      });

  let finalConfig: UserConfig;
  if (existsSync(userConfigPath)) {
    const userMod = await import(userConfigPath);
    const userConfig = userMod.default ?? userMod;
    finalConfig = mergeConfig(userConfig, baseConfig);
    finalConfig = mergeConfig(finalConfig, {
      build: {
        rollupOptions: {
          input: rollupInput,
          output: { entryFileNames: entryFileNamesForRoutes },
        },
      },
    });
  } else {
    finalConfig = baseConfig;
  }

  if (base !== undefined) {
    finalConfig = mergeConfig(finalConfig, { base });
  }
  if (outDirOverride !== undefined) {
    finalConfig = mergeConfig(finalConfig, { build: { outDir: outDirOverride } });
  }

  await viteBuild({
    ...finalConfig,
    root: frontendDir,
    configFile: false,
  });

  const effectiveOutDir = outDirOverride ?? resolve(frontendDir, "dist");

  if (config.cognito && resolved.domain?.host) {
    const issuer = `https://${resolved.domain.host}`;
    const wellKnown = resolve(effectiveOutDir, ".well-known", "oauth-authorization-server");
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

  if (opts.copyToCellBuild) {
    const frontendBuildDir = resolve(buildDir, "frontend");
    if (existsSync(effectiveOutDir)) {
      mkdirSync(frontendBuildDir, { recursive: true });
      cpSync(effectiveOutDir, frontendBuildDir, { recursive: true });
      const rel = relative(cellDir, frontendBuildDir);
      outputs.push(rel);
    }
  } else if (platform) {
    const rel = relative(cellDir, effectiveOutDir);
    outputs.push(rel);
  }

  return outputs;
}

async function runPlatformBuild(rootDir: string): Promise<void> {
  const stack = loadStackYaml(rootDir);
  if (!stack) return;

  const outputs: string[] = [];
  for (const cellName of stack.cells) {
    const cellDir = resolve(rootDir, "apps", cellName);
    if (!existsSync(resolve(cellDir, "cell.yaml"))) {
      console.warn(`Skipping ${cellName}: no cell.yaml in ${cellDir}`);
      continue;
    }
    const config = loadCellConfig(cellDir);
    if (!config.frontend) continue;
    if (!config.pathPrefix) {
      console.warn(`Skipping ${cellName}: pathPrefix required for platform frontend build`);
      continue;
    }
    const pathPrefix = config.pathPrefix.startsWith("/") ? config.pathPrefix : `/${config.pathPrefix}`;
    const outDir = resolve(rootDir, "dist", pathPrefix.replace(/^\//, ""));
    const base = pathPrefix.endsWith("/") ? pathPrefix : `${pathPrefix}/`;

    const envMap = loadEnvFiles(cellDir, { stage: "cloud" });
    let resolved: ResolvedConfig;
    try {
      resolved = resolveConfig(config, envMap, "cloud");
    } catch (err) {
      if (err instanceof MissingParamsError) {
        resolved = {
          name: config.name,
          envVars: {},
          secretRefs: {},
          tables: [],
          buckets: [],
          frontendBucketName: "",
          frontend: config.frontend,
        };
      } else {
        throw err;
      }
    }

    console.log(`Building frontend [${cellName}] base=${base} → ${relative(rootDir, outDir)}`);
    const envRestore: Record<string, string | undefined> = {};
    const prevBase = process.env.BASE_PATH;
    const prevOut = process.env.OUT_DIR;
    process.env.BASE_PATH = base;
    process.env.OUT_DIR = outDir;
    try {
      const cellOutputs = await buildFrontend(cellDir, config, resolved, {
        copyToCellBuild: false,
        platformOverrides: { base, outDir },
      });
      outputs.push(...cellOutputs);
    } finally {
      if (prevBase !== undefined) process.env.BASE_PATH = prevBase;
      else delete process.env.BASE_PATH;
      if (prevOut !== undefined) process.env.OUT_DIR = prevOut;
      else delete process.env.OUT_DIR;
    }
  }

  console.log("\nPlatform build complete!");
  if (outputs.length > 0) {
    console.log("Outputs:");
    for (const o of outputs) {
      console.log(`  ${o}`);
    }
  }
}

export async function buildCommand(options?: { cellDir?: string; instance?: string }): Promise<void> {
  const cwd = process.cwd();
  if (loadStackYaml(cwd)) {
    await runPlatformBuild(cwd);
    return;
  }

  const cellDir = resolve(options?.cellDir ?? cwd);
  const config = loadCellConfig(cellDir, options?.instance);
  const envMap = loadEnvFiles(cellDir, { stage: "cloud" });
  const resolved = resolveConfig(config, envMap, "cloud");
  const buildDir = resolve(cellDir, ".cell/build");

  const outputs: string[] = [];

  if (config.backend) {
    const backendDir = resolve(cellDir, config.backend.dir ?? ".");
    for (const [name, entry] of Object.entries(config.backend.entries)) {
      const handlerPath = resolve(backendDir, entry.handler);
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
        loader: { ".md": "text" },
      });
      const rel = relative(cellDir, outfile);
      console.log(`  → ${rel}`);
      outputs.push(rel);
    }
  }

  if (config.frontend) {
    console.log("Building frontend...");
    const frontendOutputs = await buildFrontend(cellDir, config, resolved, {
      copyToCellBuild: true,
    });
    outputs.push(...frontendOutputs);
    for (const o of frontendOutputs) {
      console.log(`  → ${o}`);
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
