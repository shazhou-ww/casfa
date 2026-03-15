export function toMcpEndpoint(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/mcp")) return trimmed;
  return `${trimmed}/mcp`;
}
