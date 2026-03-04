import { resolve } from "node:path";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { loadEnvFiles } from "../utils/env.js";

export async function logsCommand(options?: {
  cellDir?: string;
  follow?: boolean;
}): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const envMap = loadEnvFiles(cellDir);

  const awsEnv: Record<string, string | undefined> = { ...process.env };
  if (envMap.AWS_PROFILE) awsEnv.AWS_PROFILE = envMap.AWS_PROFILE;
  if (envMap.AWS_REGION) awsEnv.AWS_REGION = envMap.AWS_REGION;

  const logGroupPrefix = `/aws/lambda/${config.name}`;

  const args = ["logs", "tail", logGroupPrefix, "--since", "1h"];
  if (options?.follow) args.push("--follow");

  const proc = Bun.spawn(["aws", ...args], {
    env: awsEnv,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
