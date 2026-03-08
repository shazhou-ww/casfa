import { resolve } from "node:path";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { resolveConfig } from "../config/resolve-config.js";
import { loadEnvFiles } from "../utils/env.js";

/**
 * List configured domain hosts from cell.yaml.
 * Use these values with `cell deploy --domain <host>`.
 */
export async function domainListCommand(opts?: { cellDir?: string }): Promise<void> {
  const cellDir = resolve(opts?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const envMap = loadEnvFiles(cellDir, { stage: "cloud" });
  const resolved = resolveConfig(config, envMap, "cloud");

  if (!resolved.domains?.length) {
    console.log("No custom domains configured.");
    return;
  }

  for (const d of resolved.domains) {
    console.log(d.host);
  }
}
