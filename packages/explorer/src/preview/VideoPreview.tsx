/**
 * <VideoPreview /> - Video file preview with HTML5 player.
 * (Iter 4)
 */

import { Box } from "@mui/material";
import { useEffect, useMemo } from "react";

type VideoPreviewProps = {
  blob: Blob;
};

export function VideoPreview({ blob }: VideoPreviewProps) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

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
