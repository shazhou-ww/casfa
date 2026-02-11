import { defineConfig } from "tsup";
import { baseConfig } from "../tsup.config.base";

// JS bundling done by `bun build` (see package.json build:js script).
// tsup is only used for DTS generation (--dts-only).
export default defineConfig({
  ...baseConfig,
  external: [
    /^@casfa\/.*/,
    /^@mui\/.*/,
    "react",
    "react-dom",
    "react/jsx-runtime",
    "zod",
    "zustand",
  ],
});
