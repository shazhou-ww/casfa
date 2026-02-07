import { defineConfig, type Options } from "tsup";

export const baseConfig: Options = {
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  target: "es2022",
  outDir: "dist",
  // Skip bundling node_modules and workspace dependencies
  skipNodeModulesBundle: true,
  // External packages for dts generation
  external: [/^@casfa\/.*/],
};

export default defineConfig(baseConfig);
