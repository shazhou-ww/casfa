/**
 * <AudioPreview /> - Audio file preview with HTML5 player.
 * (Iter 4)
 */

import { Box } from "@mui/material";
import { useEffect, useMemo } from "react";

type AudioPreviewProps = {
  blob: Blob;
};

export function AudioPreview({ blob }: AudioPreviewProps) {
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
      <audio controls src={url} style={{ width: "100%", maxWidth: 480 }} />
    </Box>
  );
}
