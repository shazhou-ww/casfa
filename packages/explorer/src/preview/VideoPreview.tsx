/**
 * <VideoPreview /> - Video file preview with HTML5 player.
 * (Iter 5)
 *
 * Uses /cas/:nodeKey URL directly as <video src>. The Service Worker
 * intercepts the request, handles auth and multi-block reassembly.
 */

import { Box } from "@mui/material";
import { useEffect, useRef, useState } from "react";

type VideoPreviewProps = {
  casUrl?: string | null;
  blob?: Blob;
};

export function VideoPreview({ casUrl, blob }: VideoPreviewProps) {
  const blobUrlRef = useRef("");
  const [fallbackUrl, setFallbackUrl] = useState("");

  useEffect(() => {
    if (casUrl || !blob) {
      setFallbackUrl("");
      return;
    }
    const u = URL.createObjectURL(blob);
    blobUrlRef.current = u;
    setFallbackUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      blobUrlRef.current = "";
    };
  }, [casUrl, blob]);

  const src = casUrl || fallbackUrl;
  if (!src) return null;

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
        src={src}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />
    </Box>
  );
}
