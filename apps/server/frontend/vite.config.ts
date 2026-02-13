import { resolve } from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    // Resolve workspace packages to TypeScript source (via the "bun" export
    // condition) so we skip their dist builds which may inline transitive deps.
    conditions: ["bun"],
  },
  build: {
    outDir: "../backend/public",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        sw: resolve(__dirname, "src/sw/sw.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  server: {
    port: 8901,
    proxy: {
      "/api": {
        target: "http://localhost:8801",
        changeOrigin: true,
      },
    },
  },
});
