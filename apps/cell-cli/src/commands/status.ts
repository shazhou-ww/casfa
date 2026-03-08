import { resolve } from "node:path";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { loadEnvFiles } from "../utils/env.js";

export async function statusCommand(options?: { cellDir?: string; instance?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellConfig(cellDir, options?.instance);
  const envMap = loadEnvFiles(cellDir);
  const stackName = options?.instance ? `${config.name}-${options.instance}` : config.name;

  const awsEnv: Record<string, string | undefined> = { ...process.env };
  if (envMap.AWS_PROFILE) awsEnv.AWS_PROFILE = envMap.AWS_PROFILE;
  if (envMap.AWS_REGION) awsEnv.AWS_REGION = envMap.AWS_REGION;

  const proc = Bun.spawn(
    ["aws", "cloudformation", "describe-stacks", "--stack-name", stackName, "--output", "json"],
    {
      env: awsEnv,
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.log(`Stack "${stackName}" does not exist or is not accessible.`);
    return;
  }

  const data = JSON.parse(stdout);
  const stack = data.Stacks?.[0];
  if (!stack) {
    console.log(`Stack "${stackName}" not found.`);
    return;
  }

  console.log(`\nStack: ${stackName}`);
  console.log(`Status: ${stack.StackStatus}`);
  if (stack.LastUpdatedTime) {
    console.log(`Last Updated: ${stack.LastUpdatedTime}`);
  } else if (stack.CreationTime) {
    console.log(`Created: ${stack.CreationTime}`);
  }

  const outputs = stack.Outputs as Array<{ OutputKey: string; OutputValue: string }> | undefined;
  if (outputs && outputs.length > 0) {
    console.log("\nOutputs:");
    for (const { OutputKey, OutputValue } of outputs) {
      console.log(`  ${OutputKey}: ${OutputValue}`);
    }
  }
  console.log();
}
