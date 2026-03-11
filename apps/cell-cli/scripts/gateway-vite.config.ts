/**
 * Gateway Vite config template: used when serving a cell's frontend in platform dev.
 * Reads BASE_PATH, ROOT_DIR, VITE_PORT from env (set by gateway-dev when spawning).
 * Use with: bunx vite --config path/to/this/file, cwd = cell dir.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = process.env.BASE_PATH ?? "/";
const root = process.env.ROOT_DIR ?? ".";
const port = parseInt(process.env.VITE_PORT ?? "7100", 10);

export default defineConfig({
  base,
  root,
  plugins: [react()],
  resolve: {
    conditions: ["bun"],
  },
  server: {
    port,
    host: "0.0.0.0",
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
