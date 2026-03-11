# @casfa/cell-mcp

Builder-style MCP server for Cell apps: HTTP transport (POST /mcp), optional auth hook, and Zod-based tool input validation.

## Usage

```ts
import { createCellMcpServer } from "@casfa/cell-mcp";
import { z } from "zod";

const cellMcp = createCellMcpServer({
  name: "my-cell",
  version: "0.1.0",
  authCheck: async (c) => !!c.get("auth"),
  onUnauthorized: (c) => c.json({ error: "Unauthorized" }, 401),
});

const schema = z.object({ prompt: z.string(), width: z.number().optional() });
cellMcp.registerTool(
  "my_tool",
  { description: "Do something", inputSchema: schema },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(args) }],
  })
);

// Mount on your Hono app
const mcpRoute = cellMcp.getRoute();
app.route("/", mcpRoute); // POST /mcp
```

## Design

See [docs/plans/2026-03-11-cell-mcp-package-design.md](../../docs/plans/2026-03-11-cell-mcp-package-design.md).

## Exports

- `createCellMcpServer(options)` — builder with `registerTool`, `registerResource`, `registerPrompt`, `getRoute()`
- `ToolResult`, `CellMcpServerOptions` — types
- `formatToolValidationError` — optional helper for custom validation messages
