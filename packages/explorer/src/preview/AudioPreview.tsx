/**
 * <AudioPreview /> - Audio file preview with HTML5 player.
 * (Iter 5)
 *
 * Uses /cas/:nodeKey URL directly as <audio src>. The Service Worker
 * intercepts the request, handles auth and multi-block reassembly.
 */

import { Box } from "@mui/material";
import { useEffect, useRef, useState } from "react";

type AudioPreviewProps = {
  casUrl?: string | null;
  blob?: Blob;
};

export function AudioPreview({ casUrl, blob }: AudioPreviewProps) {
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
      <audio controls src={src} style={{ width: "100%", maxWidth: 480 }} />
    </Box>
  );
}
