import { resolve } from "node:path";

export async function typecheckCommand(options?: { cellDir?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());

  const proc = Bun.spawn(["tsc", "--noEmit"], {
    cwd: cellDir,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  process.exit(exitCode);
}
