/**
 * Print configured MCP URL before starting serverless-offline.
 * Port from MCP_PORT env or default 7201 (must match serverless.yml custom.serverless-offline.httpPort).
 */
const port = process.env.MCP_PORT ?? "7201";
const url = `http://localhost:${port}`;
console.log("\nMCP URL:", url, "\n");
