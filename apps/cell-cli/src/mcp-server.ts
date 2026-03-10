/**
 * Cell CLI MCP server — stdio transport.
 * Exposes cell commands as MCP tools so agents can run cell dev, build, deploy, etc.
 *
 * Run: bun run apps/cell-cli/src/mcp-server.ts (from repo root)
 * Or:  cd apps/cell-cli && bun run mcp-server
 *
 * Configure in .cursor/mcp.json:
 *   "cell-cli": {
 *     "command": "bun",
 *     "args": ["run", "mcp-server", "--cwd", "${workspaceFolder}"]
 *   }
 * (Cursor may use workspaceFolder when launching; adjust args if your cell-cli is elsewhere.)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "node:path";

const cellRunInputSchema = z.object({
  command: z
    .enum([
      "dev",
      "build",
      "deploy",
      "test",
      "test:unit",
      "test:e2e",
      "lint",
      "typecheck",
      "status",
      "logs",
      "setup",
      "clean",
      "domain list",
      "secret list",
      "init",
      "aws login",
      "aws logout",
    ])
    .describe(
      "Cell subcommand to run (e.g. dev, build, deploy). Use 'domain list' or 'secret list' with a space."
    ),
  cellDir: z
    .string()
    .optional()
    .describe(
      "Path to the cell directory (relative to workspace or absolute). Omit to use current working directory."
    ),
  instance: z
    .string()
    .optional()
    .describe(
      "Instance name for -i/--instance (e.g. symbiont). Used by dev, build, deploy, etc."
    ),
  deployYes: z
    .boolean()
    .optional()
    .describe("For deploy: skip confirmation (--yes)."),
  domains: z
    .array(z.string())
    .optional()
    .describe("For deploy: list of domain aliases (--domain <alias>). Run 'cell domain list' for aliases."),
  extraArgs: z
    .array(z.string())
    .optional()
    .describe("Extra CLI arguments (e.g. ['--fix'] for lint)."),
});

type CellRunArgs = z.infer<typeof cellRunInputSchema>;

function parseCommand(cmd: string): string[] {
  if (cmd === "domain list") return ["domain", "list"];
  if (cmd === "secret list") return ["secret", "list"];
  if (cmd === "secret get") return ["secret", "get"];
  if (cmd === "secret set") return ["secret", "set"];
  if (cmd === "aws login") return ["aws", "login"];
  if (cmd === "aws logout") return ["aws", "logout"];
  return [cmd];
}

async function runCell(args: CellRunArgs): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cwd = args.cellDir ? resolve(process.cwd(), args.cellDir) : process.cwd();
  const baseArgs = parseCommand(args.command);
  const fullArgs = [
    ...baseArgs,
    ...(args.instance ? ["-i", args.instance] : []),
    ...(args.command === "deploy" && args.deployYes ? ["--yes"] : []),
    ...(args.command === "deploy" && args.domains?.length
      ? args.domains.flatMap((d) => ["--domain", d])
      : []),
    ...(args.extraArgs ?? []),
  ];

  const cellCliPath = resolve(import.meta.dir, "cli.ts");
  const proc = Bun.spawn(["bun", cellCliPath, ...fullArgs], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

function createCellMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "cell-cli",
      version: "0.1.0",
    },
    {}
  );

  server.registerTool(
    "cell_run",
    {
      description:
        "Run a cell CLI command (dev, build, deploy, test, status, logs, domain list, secret list, init, etc.). " +
        "Use cellDir to target a specific cell (e.g. apps/sso). Use instance for -i (e.g. symbiont). " +
        "For deploy you can pass deployYes and domains.",
      inputSchema: cellRunInputSchema,
    },
    async (args: CellRunArgs) => {
      try {
        const result = await runCell(args);
        const text = [
          result.stdout.trim(),
          result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        return {
          content: [
            {
              type: "text" as const,
              text: [
                text || "(no output)",
                `\nExit code: ${result.exitCode}`,
              ].join("\n"),
            },
          ],
          isError: result.exitCode !== 0,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    }
  );

  return server;
}

async function main(): Promise<void> {
  const server = createCellMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("cell-cli MCP server error:", err);
  process.exit(1);
});
