import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
