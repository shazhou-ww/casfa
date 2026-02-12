/**
 * Built-in preview providers for common content types.
 * (Iter 4)
 *
 * Custom providers passed via `previewProviders` prop take priority
 * over these built-in ones.
 */

import type { PreviewProvider } from "../types.ts";
import { AudioPreview } from "./AudioPreview.tsx";
import { ImagePreview } from "./ImagePreview.tsx";
import { TextPreview } from "./TextPreview.tsx";
import { VideoPreview } from "./VideoPreview.tsx";

/** Max file size for automatic preview (10 MB) */
export const MAX_PREVIEW_SIZE = 10 * 1024 * 1024;

export const builtinProviders: PreviewProvider[] = [
  {
    match: (contentType: string) => contentType.startsWith("image/"),
    render: ({ item, blob }) => <ImagePreview blob={blob} alt={item.name} />,
  },
  {
    match: (contentType: string) => contentType.startsWith("text/"),
    render: ({ blob }) => <TextPreview blob={blob} maxLines={200} />,
  },
  {
    match: (contentType: string) =>
      contentType === "application/json" ||
      contentType === "application/javascript" ||
      contentType === "application/typescript" ||
      contentType === "application/xml" ||
      contentType === "application/x-yaml",
    render: ({ blob }) => <TextPreview blob={blob} maxLines={200} />,
  },
  {
    match: (contentType: string) => contentType.startsWith("audio/"),
    render: ({ blob }) => <AudioPreview blob={blob} />,
  },
  {
    match: (contentType: string) => contentType.startsWith("video/"),
    render: ({ blob }) => <VideoPreview blob={blob} />,
  },
];

/**
 * Find the first matching preview provider.
 * Custom providers are checked first, then built-in ones.
 */
export function findPreviewProvider(
  contentType: string,
  customProviders?: PreviewProvider[]
): PreviewProvider | null {
  if (customProviders) {
    for (const p of customProviders) {
      if (p.match(contentType)) return p;
    }
  }
  for (const p of builtinProviders) {
    if (p.match(contentType)) return p;
  }
  return null;
}
