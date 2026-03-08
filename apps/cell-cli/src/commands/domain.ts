import { resolve } from "node:path";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { resolveConfig } from "../config/resolve-config.js";
import { loadEnvFiles } from "../utils/env.js";

/**
 * List configured domain aliases and hosts from cell.yaml.
 * Use alias with deploy: cell deploy --domain <alias>.
 * Missing params are shown as <PARAM_NAME>; add them to .env for resolved values.
 */
export async function domainListCommand(opts?: { cellDir?: string; instance?: string }): Promise<void> {
  const cellDir = resolve(opts?.cellDir ?? process.cwd());
  const config = loadCellConfig(cellDir, opts?.instance);
  const envMap = loadEnvFiles(cellDir, { stage: "cloud" });
  const resolved = resolveConfig(config, envMap, "cloud", {
    onMissingParam: "placeholder",
  });

  if (!resolved.domains?.length) {
    console.log("No custom domains configured.");
    return;
  }

  const hasPlaceholder = resolved.domains.some(
    (d) => typeof d.host === "string" && d.host.startsWith("<") && d.host.endsWith(">")
  );
  for (const d of resolved.domains) {
    console.log(`${d.alias}\t${d.host}`);
  }
  if (hasPlaceholder) {
    console.log("");
    console.log("Set missing params in .env to see resolved host names.");
  }
}
