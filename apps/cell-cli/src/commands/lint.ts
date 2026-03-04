import { resolve } from "node:path";

export async function lintCommand(options?: { fix?: boolean; cellDir?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());

  const args = options?.fix
    ? ["bunx", "biome", "check", "--write", "."]
    : ["bunx", "biome", "check", "."];

  const proc = Bun.spawn(args, {
    cwd: cellDir,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  process.exit(exitCode);
}
