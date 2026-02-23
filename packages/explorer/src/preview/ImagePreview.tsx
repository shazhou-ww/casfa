/**
 * <ImagePreview /> - Image file preview.
 * (Iter 5)
 *
 * Uses /cas/:nodeKey URL directly as <img src>. The Service Worker
 * intercepts the request, handles auth and multi-block reassembly.
 * Falls back to blob: URL when casUrl is unavailable.
 */

import { Box } from "@mui/material";
import { useEffect, useRef, useState } from "react";

type ImagePreviewProps = {
  /** CAS content URL — e.g. /cas/nod_XXX */
  casUrl?: string | null;
  /** Blob fallback (used when casUrl is not available) */
  blob?: Blob;
  alt: string;
};

export function ImagePreview({ casUrl, blob, alt }: ImagePreviewProps) {
  const [scale, setScale] = useState(1);
  const blobUrlRef = useRef("");

  // Create blob URL only when casUrl is unavailable
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
        overflow: "auto",
        p: 2,
      }}
    >
      <Box
        component="img"
        src={src}
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
