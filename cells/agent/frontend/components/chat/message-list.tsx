import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import { Box, IconButton, Paper, Tooltip, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message, MessageContentPart } from "../../lib/api.ts";
import { useAgentStore } from "../../stores/agent-store.ts";

type ToolCallBlock = {
  type: "tool";
  callId: string;
  name: string;
  request: string;
  response: string | null;
};

type RenderBlock = { type: "text"; text: string } | ToolCallBlock;

function parseJsonSafely(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function formatJsonIfPossible(raw: string): string {
  const parsed = parseJsonSafely(raw);
  if (parsed === null) return raw;
  return JSON.stringify(parsed, null, 2);
}

function primitiveToYaml(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function primitiveColor(value: string | number | boolean | null): string {
  if (value === null) return "error.main";
  if (typeof value === "string") return "success.main";
  if (typeof value === "number") return "info.main";
  return "warning.main";
}

function CollapseSign({ open }: { open: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: open ? "1px solid" : "none",
        borderColor: "grey.400",
        bgcolor: open ? "transparent" : "grey.400",
        mr: 0.4,
        flexShrink: 0,
      }}
    />
  );
}

function PlaceholderDot() {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: "7px",
        height: "7px",
        borderRadius: "50%",
        border: "1px solid",
        borderColor: "grey.500",
        mr: 0.4,
        verticalAlign: "middle",
      }}
    />
  );
}

function toFunctionSafeName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function formatToolDisplayName(
  rawName: string,
  serverNameBySafeId: Map<string, string>
): string {
  if (!rawName.startsWith("mcp__")) return rawName;
  const parts = rawName.split("__");
  if (parts.length < 4) return rawName;
  const safeServerId = parts[1] ?? "";
  const serverName = serverNameBySafeId.get(safeServerId) ?? safeServerId.replace(/_/g, "-");
  const toolName = parts[2]?.replace(/_/g, "-") ?? rawName;
  return `${serverName}/${toolName}`;
}

function isArrayIndexKey(keyName?: string): boolean {
  if (!keyName) return false;
  return /^\[\d+\]$/.test(keyName);
}

function toolBubbleBg(mode: "light" | "dark"): string {
  return mode === "dark" ? "#1f1f1f" : "#f1f3f5";
}

function toolBubbleHoverBg(mode: "light" | "dark"): string {
  return mode === "dark" ? "#2a2a2a" : "#e5e9ee";
}

function YamlNode({
  keyName,
  value,
  depth,
  baseIndent = 0,
  emphasizeRootKey = false,
  reserveMarkerSpace = false,
}: {
  keyName?: string;
  value: unknown;
  depth: number;
  baseIndent?: number;
  emphasizeRootKey?: boolean;
  reserveMarkerSpace?: boolean;
}) {
  const [open, setOpen] = useState(depth < 1);
  const indent = baseIndent + depth * 12;
  const keyPrefix = keyName !== undefined ? `${keyName}: ` : "";
  const isEmphasizedRoot = emphasizeRootKey && depth === 0 && keyName !== undefined;
  const arrayIndexKey = isArrayIndexKey(keyName);

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return (
      <Typography
        component="div"
        sx={{
          pl: `${indent}px`,
          py: 0.1,
          pr: 0.4,
          bgcolor: (theme) => toolBubbleBg(theme.palette.mode),
          borderRadius: 0.5,
          fontFamily: "monospace",
          fontSize: "0.72rem",
          lineHeight: 1.35,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <PlaceholderDot />
        <Box
          component="span"
          sx={{
            color: isEmphasizedRoot ? "text.primary" : "text.secondary",
            fontStyle: isEmphasizedRoot ? "italic" : "normal",
            fontSize: arrayIndexKey ? "0.66rem" : "0.72rem",
            ...(arrayIndexKey ? { color: "text.disabled" } : {}),
          }}
        >
          {keyPrefix}
        </Box>
        <Box component="span" sx={{ color: primitiveColor(value) }}>
          {primitiveToYaml(value)}
        </Box>
      </Typography>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((item, idx) => [String(idx), item] as const)
    : Object.entries(value as Record<string, unknown>);
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;
  const emptySummary = isArray ? "[]" : "{}";

  if (entries.length === 0) {
    return (
      <Typography
        component="div"
        sx={{
          pl: `${indent}px`,
          py: 0.1,
          pr: 0.4,
          bgcolor: (theme) => toolBubbleBg(theme.palette.mode),
          borderRadius: 0.5,
          fontFamily: "monospace",
          fontSize: "0.72rem",
          lineHeight: 1.35,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <PlaceholderDot />
        <Box
          component="span"
          sx={{
            color: isEmphasizedRoot ? "text.primary" : "text.secondary",
            fontStyle: isEmphasizedRoot ? "italic" : "normal",
          }}
        >
          {keyPrefix}
        </Box>
        <Box component="span" sx={{ color: "text.disabled" }}>
          {emptySummary}
        </Box>
      </Typography>
    );
  }

  return (
    <Box>
      <Box
        onClick={() => setOpen((v) => !v)}
        role="button"
        sx={{
          pl: `${indent}px`,
          py: 0.15,
          pr: 0.4,
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          userSelect: "none",
          borderRadius: 0.5,
          position: "sticky",
          top: `${depth * 18}px`,
          zIndex: Math.max(1, 40 - depth),
          bgcolor: (theme) => toolBubbleBg(theme.palette.mode),
          transition: "background-color 0.12s ease",
          "&:hover": {
            bgcolor: (theme) => toolBubbleHoverBg(theme.palette.mode),
          },
        }}
      >
        <CollapseSign open={open} />
        <Typography
          component="span"
          sx={{
            color: isEmphasizedRoot ? "text.primary" : "text.secondary",
            fontStyle: isEmphasizedRoot ? "italic" : "normal",
            fontFamily: "monospace",
            fontSize: arrayIndexKey ? "0.66rem" : "0.72rem",
            ...(arrayIndexKey ? { color: "text.disabled" } : {}),
            mr: 0.25,
          }}
        >
          {keyPrefix}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography
          component="span"
          sx={{
            color: "text.disabled",
            fontFamily: "monospace",
            fontSize: "0.67rem",
            textAlign: "right",
          }}
        >
          {summary}
        </Typography>
      </Box>
      {open &&
        entries.map(([childKey, childValue], idx) => (
          <YamlNode
            key={`${keyName ?? "root"}-${childKey}-${depth}-${idx}`}
            keyName={isArray ? `[${childKey}]` : childKey}
            value={childValue}
            depth={depth + 1}
            baseIndent={baseIndent}
            emphasizeRootKey={emphasizeRootKey}
            reserveMarkerSpace={reserveMarkerSpace}
          />
        ))}
    </Box>
  );
}

function YamlTreeView({ raw, rootLabel }: { raw: string; rootLabel: string }) {
  const parsed = parseJsonSafely(raw);
  if (parsed === null) {
    return (
      <Box sx={{ overflow: "auto", maxHeight: 260 }}>
        <Typography
          component="div"
          sx={{
            pl: "8px",
            pr: 0.4,
            bgcolor: (theme) => toolBubbleBg(theme.palette.mode),
            borderRadius: 0.5,
            fontFamily: "monospace",
            fontSize: "0.72rem",
            lineHeight: 1.35,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          <PlaceholderDot />
          <Box component="span" sx={{ color: "text.secondary" }}>
            <Box component="span" sx={{ fontStyle: "italic", color: "text.primary" }}>
              {rootLabel}:
            </Box>{" "}
          </Box>
          <Box component="span" sx={{ color: "warning.main" }}>
            {raw}
          </Box>
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 0,
        maxHeight: 260,
        overflow: "auto",
      }}
    >
      <YamlNode keyName={rootLabel} value={parsed} depth={0} baseIndent={8} emphasizeRootKey reserveMarkerSpace />
    </Box>
  );
}

function groupContentParts(parts: MessageContentPart[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  const toolIndexByCallId = new Map<string, number>();

  for (const part of parts) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type === "tool-call") {
      const callId = part.callId || `tool-${blocks.length}`;
      const existingIdx = toolIndexByCallId.get(callId);
      if (existingIdx !== undefined && blocks[existingIdx]?.type === "tool") {
        const existing = blocks[existingIdx] as ToolCallBlock;
        if (part.name) existing.name = part.name;
        existing.request = part.arguments || existing.request;
      } else {
        const block: ToolCallBlock = {
          type: "tool",
          callId,
          name: part.name || "tool",
          request: part.arguments || "",
          response: null,
        };
        toolIndexByCallId.set(callId, blocks.length);
        blocks.push(block);
      }
      continue;
    }

    const existingIdx = part.callId ? toolIndexByCallId.get(part.callId) : undefined;
    if (existingIdx !== undefined && blocks[existingIdx]?.type === "tool") {
      const existing = blocks[existingIdx] as ToolCallBlock;
      existing.response = existing.response ? `${existing.response}\n\n${part.result}` : part.result;
    } else {
      blocks.push({
        type: "tool",
        callId: part.callId || `result-${blocks.length}`,
        name: "tool",
        request: "",
        response: part.result,
      });
    }
  }

  return blocks;
}

function MessageMarkdown({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <Box
      sx={{
        fontSize: "0.82rem",
        lineHeight: 1.4,
        "& p": { m: 0, mb: 0.75, fontSize: "0.82rem", lineHeight: 1.4 },
        "& p:last-of-type": { mb: 0 },
        "& ul, & ol": { my: 0.4, pl: 2.5, fontSize: "0.82rem" },
        "& li": { mb: 0.15 },
        "& table": {
          width: "100%",
          borderCollapse: "collapse",
          border: "1px solid",
          borderColor: "divider",
          my: 0.6,
          fontSize: "0.78rem",
        },
        "& thead": {
          bgcolor: "action.selected",
        },
        "& th, & td": {
          border: "1px solid",
          borderColor: "divider",
          px: 0.8,
          py: 0.45,
          textAlign: "left",
          verticalAlign: "top",
        },
        "& th": {
          fontWeight: 600,
        },
        "& pre": {
          mt: 0.4,
          mb: 0.4,
          p: 0.75,
          bgcolor: "action.hover",
          borderRadius: 1,
          overflow: "auto",
          fontSize: "0.72rem",
          lineHeight: 1.35,
        },
        "& code": {
          fontFamily: "monospace",
          fontSize: "0.72rem",
          bgcolor: "action.hover",
          px: 0.35,
          borderRadius: 0.5,
        },
        "& pre code": {
          p: 0,
          bgcolor: "transparent",
        },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </Box>
  );
}

function ToolCallCard({
  block,
  serverNameBySafeId,
}: {
  block: ToolCallBlock;
  serverNameBySafeId: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const displayName = formatToolDisplayName(block.name, serverNameBySafeId);
  const toolCopyText = toolBlockToCopyText(block, displayName);
  return (
    <Box
      sx={{
        position: "relative",
        borderRadius: 1,
        overflow: "hidden",
        bgcolor: (theme) => toolBubbleBg(theme.palette.mode),
        "& .tool-copy-btn": {
          opacity: 0,
          pointerEvents: "none",
          transition: "opacity 0.2s ease",
        },
        "&:hover .tool-copy-btn": {
          opacity: 1,
          pointerEvents: "auto",
        },
      }}
    >
      <Box
        onClick={() => setOpen((v) => !v)}
        role="button"
        sx={{
          position: "relative",
          px: 0.75,
          py: 0.5,
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          userSelect: "none",
          gap: 0.5,
          borderRadius: 1,
          pr: 3.8,
          transition: "background-color 0.12s ease",
          "&:hover": {
            bgcolor: (theme) => toolBubbleHoverBg(theme.palette.mode),
          },
        }}
      >
        <HoverCopyButton className="tool-copy-btn" text={toolCopyText} top={13} right={6} centerY />
        <CollapseSign open={open} />
        <Typography variant="caption" sx={{ fontFamily: "monospace", fontSize: "0.72rem" }}>
          {displayName}
        </Typography>
      </Box>
      {open && (
        <Box sx={{ p: 0.75 }}>
          <ToolIoBubble label="request" raw={block.request} />
          <Box sx={{ mt: 0.35 }}>
            <ToolIoBubble label="response" raw={block.response ?? ""} />
          </Box>
        </Box>
      )}
    </Box>
  );
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function HoverCopyButton({
  className,
  text,
  light = false,
  top = 6,
  right = 6,
  centerY = false,
}: {
  className: string;
  text: string;
  light?: boolean;
  top?: number;
  right?: number;
  centerY?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Box
      className={className}
      sx={{
        position: "absolute",
        top,
        right,
        zIndex: 2,
        ...(centerY ? { transform: "translateY(-50%)" } : {}),
      }}
    >
      <Tooltip title={copied ? "已复制" : "复制"}>
        <IconButton
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            void copyText(text).then(() => setCopied(true));
          }}
          sx={{
            width: 22,
            height: 22,
            color: light ? "primary.contrastText" : "text.primary",
            bgcolor: light ? "rgba(255,255,255,0.16)" : "action.hover",
            "&:hover": {
              bgcolor: light ? "rgba(255,255,255,0.24)" : "action.selected",
            },
          }}
        >
          <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function toolBlockToCopyText(block: ToolCallBlock, displayName: string): string {
  return [
    `tool call: ${displayName}`,
    `request:\n${formatJsonIfPossible(block.request)}`,
    `response:\n${formatJsonIfPossible(block.response ?? "")}`,
  ].join("\n\n");
}

function ToolIoBubble({ label, raw }: { label: "request" | "response"; raw: string }) {
  return (
    <Box
      sx={{
        borderRadius: 0.75,
        px: 0.25,
        py: 0.25,
      }}
    >
      <YamlTreeView raw={raw} rootLabel={label} />
    </Box>
  );
}

function messageToCopyText(message: Message): string {
  const sections: string[] = [];
  for (const part of message.content) {
    if (part.type === "text") {
      if (part.text.trim()) sections.push(part.text.trim());
      continue;
    }
    if (part.type === "tool-call") {
      sections.push(`tool request: ${part.name}`, formatJsonIfPossible(part.arguments));
      continue;
    }
    if (part.type === "tool-result") {
      sections.push(`tool response: ${part.callId || "result"}`, formatJsonIfPossible(part.result));
    }
  }
  return sections.join("\n\n");
}

export function MessageList({ messages }: { messages: Message[] }) {
  const getMcpServers = useAgentStore((s) => s.getMcpServers);
  const mcpServers = getMcpServers();
  const serverNameBySafeId = new Map(
    mcpServers.map((server) => [toFunctionSafeName(server.id), server.name ?? server.id] as const)
  );

  if (messages.length === 0) {
    return (
      <Box flex={1} display="flex" alignItems="center" justifyContent="center" p={2}>
        <Typography color="text.secondary">No messages yet. Send one below.</Typography>
      </Box>
    );
  }
  return (
    <Box flex={1} overflow="auto" display="flex" flexDirection="column" gap={1} p={2}>
      {messages.map((m) => (
        (() => {
          const isUser = m.role === "user";
          const blocks = groupContentParts(m.content);
          return (
            <Paper
              key={m.messageId}
              variant="outlined"
              sx={{
                position: "relative",
                p: 1.5,
                alignSelf: isUser ? "flex-end" : "flex-start",
                maxWidth: "85%",
                bgcolor: isUser ? "primary.main" : "background.paper",
                color: isUser ? "primary.contrastText" : "text.primary",
                "& .message-toolbar": {
                  opacity: 0,
                  pointerEvents: "none",
                  transition: "opacity 0.2s ease",
                },
                "&:hover .message-toolbar": {
                  opacity: 1,
                  pointerEvents: "auto",
                },
              }}
            >
              <HoverCopyButton className="message-toolbar" text={messageToCopyText(m)} light={isUser} top={15} right={10} centerY />
              <Typography variant="caption" sx={{ opacity: 0.8, display: "block", mb: 0.5 }}>
                {m.role}
              </Typography>
              {blocks.map((block, i) => {
                const prev = i > 0 ? blocks[i - 1] : null;
                const mt =
                  !prev
                    ? 0
                    : block.type === "text" && prev.type === "tool"
                      ? 1.35
                      : block.type === "tool" && prev.type === "text"
                        ? 1.15
                        : block.type === "tool"
                          ? 1
                          : 0.6;
                const mb = block.type === "tool" ? 0.7 : 0;

                return (
                  <Box key={block.type === "tool" ? `tool-${block.callId}-${i}` : `text-${i}`} sx={{ mt, mb }}>
                    {block.type === "text" ? (
                      <MessageMarkdown text={block.text} />
                    ) : (
                      <ToolCallCard block={block} serverNameBySafeId={serverNameBySafeId} />
                    )}
                  </Box>
                );
              })}
            </Paper>
          );
        })()
      ))}
    </Box>
  );
}
