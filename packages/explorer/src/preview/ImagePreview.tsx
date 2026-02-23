/**
 * <ImagePreview /> - Image file preview.
 * (Iter 4)
 */

import { Box } from "@mui/material";
import { useEffect, useState } from "react";

type ImagePreviewProps = {
  blob: Blob;
  alt: string;
};

export function ImagePreview({ blob, alt }: ImagePreviewProps) {
  const [scale, setScale] = useState(1);
  const [url, setUrl] = useState("");

  // Create and revoke ObjectURL in the same effect to avoid StrictMode
  // double-invoke race: useMemo runs once but useEffect cleanup runs twice,
  // revoking the URL before the image can load.
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
