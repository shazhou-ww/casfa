/**
 * <AudioPreview /> - Audio file preview with HTML5 player.
 * (Iter 4)
 */

import { Box } from "@mui/material";
import { useEffect, useState } from "react";

type AudioPreviewProps = {
  blob: Blob;
};

export function AudioPreview({ blob }: AudioPreviewProps) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

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
