import { resolve } from "node:path";

export async function lintCommand(options?: {
  fix?: boolean;
  unsafe?: boolean;
  cellDir?: string;
}): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());

  const args = ["bunx", "biome", "check"];
  if (options?.fix) args.push("--write");
  if (options?.unsafe) args.push("--unsafe");
  args.push(".");

  const proc = Bun.spawn(args, {
    cwd: cellDir,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  process.exit(exitCode);
}
