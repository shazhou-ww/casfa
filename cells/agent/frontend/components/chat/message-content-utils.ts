import type { Message, MessageContentPart } from "../../lib/api.ts";

export type ToolCallBlock = {
  type: "tool";
  callId: string;
  name: string;
  request: string;
  response: string | null;
};

export type RenderBlock = { type: "text"; text: string } | ToolCallBlock;

function formatJsonIfPossible(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}

function findLatestPendingToolBlock(blocks: RenderBlock[]): number | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "tool" && block.response == null) return i;
  }
  return undefined;
}

export function groupContentParts(parts: MessageContentPart[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  const toolIndexByCallId = new Map<string, number>();

  for (const part of parts) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type === "tool-call") {
      const callId = part.callId.trim();
      const existingIdx = callId ? toolIndexByCallId.get(callId) : undefined;
      if (existingIdx !== undefined && blocks[existingIdx]?.type === "tool") {
        const existing = blocks[existingIdx] as ToolCallBlock;
        if (part.name) existing.name = part.name;
        if (part.arguments) existing.request = part.arguments;
        continue;
      }

      const pendingIdx = findLatestPendingToolBlock(blocks);
      if (pendingIdx !== undefined && blocks[pendingIdx]?.type === "tool") {
        const pending = blocks[pendingIdx] as ToolCallBlock;
        const nameMatches = !part.name || pending.name === "tool" || pending.name === part.name;
        if (nameMatches) {
          if (part.name) pending.name = part.name;
          if (part.arguments) pending.request = part.arguments;
          if (callId) {
            pending.callId = callId;
            toolIndexByCallId.set(callId, pendingIdx);
          }
          continue;
        }
      }

      const block: ToolCallBlock = {
        type: "tool",
        callId: callId || `tool-${blocks.length}`,
        name: part.name || "tool",
        request: part.arguments || "",
        response: null,
      };
      if (callId) toolIndexByCallId.set(callId, blocks.length);
      blocks.push(block);
      continue;
    }

    const callId = part.callId.trim();
    const existingIdx = callId ? toolIndexByCallId.get(callId) : undefined;
    const targetIdx = existingIdx ?? findLatestPendingToolBlock(blocks);
    if (targetIdx !== undefined && blocks[targetIdx]?.type === "tool") {
      const existing = blocks[targetIdx] as ToolCallBlock;
      existing.response = existing.response ? `${existing.response}\n\n${part.result}` : part.result;
      continue;
    }

    blocks.push({
      type: "tool",
      callId: callId || `result-${blocks.length}`,
      name: "tool",
      request: "",
      response: part.result,
    });
  }

  return blocks;
}

export function messageToCopyText(message: Message): string {
  const sections: string[] = [];
  const blocks = groupContentParts(message.content);
  for (const block of blocks) {
    if (block.type === "text") {
      if (block.text.trim()) sections.push(block.text.trim());
      continue;
    }
    sections.push(`tool request: ${block.name}`);
    if (block.request.trim()) sections.push(formatJsonIfPossible(block.request));
    if (block.response != null) {
      sections.push(`tool response: ${block.callId}`);
      if (block.response.trim()) sections.push(formatJsonIfPossible(block.response));
    }
  }
  return sections.join("\n\n");
}
