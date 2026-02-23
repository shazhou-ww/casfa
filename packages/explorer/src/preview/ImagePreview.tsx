/**
 * <ImagePreview /> - Image file preview.
 * (Iter 4)
 *
 * Fetches image content from /cas/:nodeKey with auth headers via
 * useCasBlobUrl hook, then displays via blob: URL.  Falls back to
 * the blob prop when casUrl is unavailable.
 */

import { Box } from "@mui/material";
import { useState } from "react";
import { useCasBlobUrl } from "./use-cas-blob-url.ts";

type ImagePreviewProps = {
  /** CAS content URL — e.g. /cas/nod_XXX */
  casUrl?: string | null;
  /** Blob fallback (used when casUrl is not available) */
  blob?: Blob;
  alt: string;
};

export function ImagePreview({ casUrl, blob, alt }: ImagePreviewProps) {
  const [scale, setScale] = useState(1);
  const url = useCasBlobUrl(casUrl, blob);

  if (!url) return null;

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flex: 1,
        overflow: "auto",
        p: 2,
      }}
    >
      <Box
        component="img"
        src={url}
        alt={alt}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setScale((s) => Math.max(0.1, Math.min(5, s + (e.deltaY > 0 ? -0.1 : 0.1))));
          }
        }}
        sx={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          transform: `scale(${scale})`,
          transition: "transform 0.1s ease",
          cursor: scale !== 1 ? "zoom-out" : "zoom-in",
        }}
        onClick={() => setScale((s) => (s === 1 ? 2 : 1))}
      />
    </Box>
  );
}
