/**
 * <AudioPreview /> - Audio file preview with HTML5 player.
 * (Iter 4)
 *
 * Fetches content from /cas/:nodeKey with auth headers via useCasBlobUrl.
 */

import { Box } from "@mui/material";
import { useCasBlobUrl } from "./use-cas-blob-url.ts";

type AudioPreviewProps = {
  casUrl?: string | null;
  blob?: Blob;
};

export function AudioPreview({ casUrl, blob }: AudioPreviewProps) {
  const url = useCasBlobUrl(casUrl, blob);

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
