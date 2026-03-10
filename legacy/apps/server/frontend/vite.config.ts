import { resolve } from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";

/**
 * Vite plugin that adds `Service-Worker-Allowed: /` header to the SW script
 * response, allowing the SW registered from /src/sw/sw.ts to control scope "/".
 */
function swAllowedScope(): Plugin {
  return {
    name: "sw-allowed-scope",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/src/sw/")) {
          res.setHeader("Service-Worker-Allowed", "/");
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), swAllowedScope()],
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
      "/.well-known": {
        target: "http://localhost:8801",
        // Do NOT use changeOrigin here — preserve the original Host header
        // so the backend can construct correct URLs for OAuth metadata
      },
      "/cas": {
        target: "http://localhost:8801",
        changeOrigin: true,
      },
    },
  },
});
