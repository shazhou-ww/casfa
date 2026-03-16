export function formatLoadedToolDisplayName(
  rawName: string,
  serverNameBySafeId: Map<string, string>
): string {
  if (!rawName.startsWith("mcp__")) return rawName;
  const encoded = rawName.slice("mcp__".length);
  const delimiterIdx = encoded.indexOf("__");
  if (delimiterIdx <= 0 || delimiterIdx >= encoded.length - 2) return rawName;
  const safeServerId = encoded.slice(0, delimiterIdx);
  const rawToolName = encoded.slice(delimiterIdx + 2);
  const serverName = serverNameBySafeId.get(safeServerId) ?? safeServerId.replace(/_/g, "-");
  const toolName = rawToolName.replace(/_/g, "-");
  return `${serverName}/${toolName}`;
}
