import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  target: "es2022",
  outDir: "dist",
  // Add shebang for CLI executable
  banner: {
    js: "#!/usr/bin/env node",
  },
  // External workspace dependencies
  skipNodeModulesBundle: true,
  external: [/^@casfa\/.*/],
});
