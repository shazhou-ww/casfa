/**
 * <TextPreview /> - Text/code file preview with line numbers.
 * (Iter 4)
 *
 * Prefers fetching from casUrl (/cas/:nodeKey) when available,
 * which benefits from SW caching. Falls back to reading from blob.
 */

import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";

type TextPreviewProps = {
  casUrl?: string | null;
  blob?: Blob;
  maxLines?: number;
};

export function TextPreview({ casUrl, blob, maxLines = 200 }: TextPreviewProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const processText = (text: string) => {
      if (cancelled) return;
      const allLines = text.split("\n");
      if (allLines.length > maxLines) {
        setLines(allLines.slice(0, maxLines));
        setTruncated(true);
      } else {
        setLines(allLines);
        setTruncated(false);
      }
    };

    if (casUrl) {
      fetch(casUrl)
        .then((r) => r.text())
        .then(processText)
        .catch(() => {
          if (!cancelled) setLines(["Failed to load content"]);
        });
    } else if (blob) {
      blob.text().then(processText);
    }

    return () => { cancelled = true; };
  }, [casUrl, blob, maxLines]);

  const gutterWidth = String(lines.length).length;

  return (
    <Box
      sx={{
        flex: 1,
        overflow: "auto",
        fontFamily: "monospace",
        fontSize: "0.8125rem",
        lineHeight: 1.6,
        p: 1,
      }}
    >
      <Box component="pre" sx={{ m: 0 }}>
        {lines.map((line, i) => (
          <Box
            // biome-ignore lint/suspicious/noArrayIndexKey: stable line order
            key={i}
            sx={{
              display: "flex",
              "&:hover": { backgroundColor: "action.hover" },
            }}
          >
            <Box
              component="span"
              sx={{
                width: `${gutterWidth + 1}ch`,
                minWidth: "3ch",
                textAlign: "right",
                pr: 1.5,
                mr: 1.5,
                color: "text.disabled",
                userSelect: "none",
                borderRight: 1,
                borderColor: "divider",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </Box>
            <Box component="span" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-all", flex: 1 }}>
              {line || "\u00A0"}
            </Box>
          </Box>
        ))}
      </Box>
      {truncated && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          … (showing first {maxLines} lines)
        </Typography>
      )}
    </Box>
  );
}
