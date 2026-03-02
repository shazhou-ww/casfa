import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 7100,
    proxy: {
      "/api": {
        target: "http://localhost:7101",
        changeOrigin: true,
      },
    },
  },
});
