import { defineConfig } from "tsup";
import { baseConfig } from "../tsup.config.base";

export default defineConfig({
  ...baseConfig,
  external: [/^@casfa\/.*/, /^@mui\/.*/, "react", "react-dom", "react/jsx-runtime"],
});
