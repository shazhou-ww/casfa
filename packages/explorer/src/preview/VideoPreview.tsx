/**
 * <VideoPreview /> - Video file preview with HTML5 player.
 * (Iter 4)
 *
 * Uses /cas/:nodeKey URL when available; falls back to blob URL.
 */

import { Box } from "@mui/material";
import { useEffect, useState } from "react";

type VideoPreviewProps = {
  casUrl?: string | null;
  blob?: Blob;
};

export function VideoPreview({ casUrl, blob }: VideoPreviewProps) {
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
      <video
        controls
        src={url}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />
    </Box>
  );
}
