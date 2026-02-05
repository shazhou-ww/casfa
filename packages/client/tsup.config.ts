import { defineConfig } from "tsup";
import { baseConfig } from "../tsup.config.base";

export default defineConfig({
  ...baseConfig,
  entry: {
    index: "src/index.ts",
    "types/index": "src/types/index.ts",
    "api/index": "src/api/index.ts",
  },
});
