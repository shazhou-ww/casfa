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
