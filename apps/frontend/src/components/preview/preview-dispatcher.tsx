import { Box, CircularProgress, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { filesystemApi } from "../../api/filesystem";
import { BinaryPreview } from "./binary-preview";
import { ImagePreview } from "./image-preview";
import { MarkdownPreview } from "./markdown-preview";
import { TextPreview } from "./text-preview";

type PreviewDispatcherProps = {
  realm: string;
  root: string;
  path: string;
  name: string;
  contentType?: string;
  size?: number;
  onDownload: () => void;
};

function isTextType(ct?: string): boolean {
  if (!ct) return false;
  if (ct.startsWith("text/")) return true;
  if (ct.includes("json") || ct.includes("xml") || ct.includes("javascript")) return true;
  if (ct.includes("yaml") || ct.includes("toml")) return true;
  return false;
}

function isImageType(ct?: string): boolean {
  if (!ct) return false;
  return ct.startsWith("image/");
}

function isMarkdown(ct?: string, name?: string): boolean {
  if (ct === "text/markdown") return true;
  if (name?.endsWith(".md") || name?.endsWith(".mdx")) return true;
  return false;
}

export function PreviewDispatcher({
  realm,
  root,
  path,
  name,
  contentType,
  size,
  onDownload,
}: PreviewDispatcherProps) {
  const [loading, setLoading] = useState(true);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTextContent(null);
    setBlobUrl(null);

    (async () => {
      try {
        const response = await filesystemApi.read(realm, root, path);
        if (cancelled) return;

        if (isTextType(contentType) || isMarkdown(contentType, name)) {
          const text = await (response as unknown as Response).text();
          if (!cancelled) setTextContent(text);
        } else if (isImageType(contentType)) {
          const blob = await (response as unknown as Response).blob();
          if (!cancelled) setBlobUrl(URL.createObjectURL(blob));
        } else {
          // Binary — no content loaded, just show download button
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realm, root, path, contentType, name, blobUrl]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  if (isMarkdown(contentType, name) && textContent != null) {
    return <MarkdownPreview content={textContent} />;
  }

  if (isTextType(contentType) && textContent != null) {
    return <TextPreview content={textContent} />;
  }

  if (isImageType(contentType) && blobUrl) {
    return <ImagePreview blobUrl={blobUrl} name={name} />;
  }

  return (
    <BinaryPreview name={name} size={size} contentType={contentType} onDownload={onDownload} />
  );
}
