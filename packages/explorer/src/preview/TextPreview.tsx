/**
 * <TextPreview /> - Text/code file preview with line numbers.
 * (Iter 5)
 *
 * Fetches text from /cas/:nodeKey. The Service Worker intercepts the
 * request and handles auth + multi-block reassembly.
 * Falls back to reading from blob prop.
 */

import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";

type TextPreviewProps = {
  casUrl?: string | null;
  blob?: Blob;
  maxLines?: number;
};

/** Fetch text from casUrl (SW handles auth), falling back to blob.text(). */
function useCasText(
  casUrl: string | null | undefined,
  fallbackBlob: Blob | undefined
): string | null {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (casUrl) {
        try {
          const res = await fetch(casUrl);
          if (cancelled) return;
          if (res.ok) {
            const t = await res.text();
            if (!cancelled) setText(t);
            return;
          }
        } catch {
          if (cancelled) return;
        }
      }
      // Fallback to blob
      if (fallbackBlob) {
        const t = await fallbackBlob.text();
        if (!cancelled) setText(t);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [casUrl, fallbackBlob]);

  return text;
}

export function TextPreview({ casUrl, blob, maxLines = 200 }: TextPreviewProps) {
  const rawText = useCasText(casUrl, blob);
  const [lines, setLines] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (rawText === null) return;
    const allLines = rawText.split("\n");
    if (allLines.length > maxLines) {
      setLines(allLines.slice(0, maxLines));
      setTruncated(true);
    } else {
      setLines(allLines);
      setTruncated(false);
    }
  }, [rawText, maxLines]);

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
