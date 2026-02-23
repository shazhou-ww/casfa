/**
 * <ImagePreview /> - Image file preview.
 * (Iter 4)
 *
 * Uses /cas/:nodeKey URL directly when available (served with proper MIME
 * type, cached by SW).  Falls back to blob URL when casUrl is not provided.
 */

import { Box } from "@mui/material";
import { useEffect, useState } from "react";

type ImagePreviewProps = {
  /** CAS content URL — preferred source */
  casUrl?: string | null;
  /** Blob fallback (used when casUrl is not available) */
  blob?: Blob;
  alt: string;
};

export function ImagePreview({ casUrl, blob, alt }: ImagePreviewProps) {
  const [scale, setScale] = useState(1);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (casUrl) {
      setUrl(casUrl);
      return; // No cleanup needed — CAS URL is a stable server path
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
