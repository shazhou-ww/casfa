/**
 * <ImagePreview /> - Image file preview.
 * (Iter 4)
 */

import { Box } from "@mui/material";
import { useEffect, useMemo, useState } from "react";

type ImagePreviewProps = {
  blob: Blob;
  alt: string;
};

export function ImagePreview({ blob, alt }: ImagePreviewProps) {
  const [scale, setScale] = useState(1);
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);

  // Revoke ObjectURL on unmount to prevent memory leaks
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
