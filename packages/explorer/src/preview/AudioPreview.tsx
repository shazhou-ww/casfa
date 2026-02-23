/**
 * <AudioPreview /> - Audio file preview with HTML5 player.
 * (Iter 4)
 *
 * Uses /cas/:nodeKey URL when available; falls back to blob URL.
 */

import { Box } from "@mui/material";
import { useEffect, useState } from "react";

type AudioPreviewProps = {
  casUrl?: string | null;
  blob?: Blob;
};

export function AudioPreview({ casUrl, blob }: AudioPreviewProps) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (casUrl) {
      setUrl(casUrl);
      return;
    }
    if (blob) {
      const objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    setUrl("");
  }, [casUrl, blob]);

  if (!url) return null;

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flex: 1,
        p: 2,
      }}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: preview player, captions not applicable */}
      <audio controls src={url} style={{ width: "100%", maxWidth: 480 }} />
    </Box>
  );
}
