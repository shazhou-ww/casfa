/**
 * <VideoPreview /> - Video file preview with HTML5 player.
 * (Iter 4)
 *
 * Fetches content from /cas/:nodeKey with auth headers via useCasBlobUrl.
 */

import { Box } from "@mui/material";
import { useCasBlobUrl } from "./use-cas-blob-url.ts";

type VideoPreviewProps = {
  casUrl?: string | null;
  blob?: Blob;
};

export function VideoPreview({ casUrl, blob }: VideoPreviewProps) {
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
      <video
        controls
        src={url}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />
    </Box>
  );
}
