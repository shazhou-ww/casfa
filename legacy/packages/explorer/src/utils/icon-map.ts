/**
 * Content-type to MUI icon name mapping.
 *
 * Used by FileGrid (and optionally FileList) to display richer icons
 * based on the MIME type of files.
 */

/**
 * Icon category derived from content-type or file properties.
 */
export type IconCategory =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "code"
  | "archive"
  | "spreadsheet"
  | "presentation"
  | "document"
  | "file";

/**
 * Determine the icon category for a file.
 */
export function getIconCategory(isDirectory: boolean, contentType?: string | null): IconCategory {
  if (isDirectory) return "folder";
  if (!contentType) return "file";

  const ct = contentType.toLowerCase();

  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  if (ct === "application/pdf") return "pdf";

  // Archives
  if (
    ct === "application/zip" ||
    ct === "application/x-tar" ||
    ct === "application/gzip" ||
    ct === "application/x-7z-compressed" ||
    ct === "application/x-rar-compressed"
  ) {
    return "archive";
  }

  // Spreadsheets
  if (
    ct === "application/vnd.ms-excel" ||
    ct === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ct === "text/csv"
  ) {
    return "spreadsheet";
  }

  // Presentations
  if (
    ct === "application/vnd.ms-powerpoint" ||
    ct === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "presentation";
  }

  // Word documents
  if (
    ct === "application/msword" ||
    ct === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "document";
  }

  // Code / markup
  if (
    ct === "application/json" ||
    ct === "application/javascript" ||
    ct === "application/typescript" ||
    ct === "application/xml" ||
    ct === "text/html" ||
    ct === "text/css" ||
    ct === "text/xml" ||
    ct === "text/javascript" ||
    ct === "application/x-yaml" ||
    ct === "text/x-python" ||
    ct === "text/x-rust" ||
    ct === "text/x-go" ||
    ct === "text/x-c" ||
    ct === "text/x-java"
  ) {
    return "code";
  }

  // Generic text
  if (ct.startsWith("text/")) return "text";

  return "file";
}

/**
 * Hex color for each icon category — designed to pop against a neutral B&W UI.
 */
export const ICON_COLORS: Record<IconCategory, string> = {
  folder: "#f59e0b", // amber-500
  image: "#8b5cf6", // violet-500
  video: "#ef4444", // red-500
  audio: "#06b6d4", // cyan-500
  pdf: "#ef4444", // red-500
  code: "#3b82f6", // blue-500
  archive: "#f97316", // orange-500
  spreadsheet: "#22c55e", // green-500
  presentation: "#f97316", // orange-500
  document: "#3b82f6", // blue-500
  text: "#71717a", // zinc-500
  file: "#a1a1aa", // zinc-400
};

/**
 * Get a color hint for the icon category (MUI palette key).
 * @deprecated Use ICON_COLORS[category] for hex values instead.
 */
export function getIconColor(
  category: IconCategory
): "primary" | "secondary" | "action" | "error" | "warning" | "info" | "success" {
  switch (category) {
    case "folder":
      return "primary";
    case "image":
      return "secondary";
    case "video":
      return "error";
    case "audio":
      return "info";
    case "pdf":
      return "error";
    case "archive":
      return "warning";
    case "code":
      return "info";
    case "spreadsheet":
      return "success";
    case "presentation":
      return "warning";
    case "document":
      return "primary";
    case "text":
      return "action";
    default:
      return "action";
  }
}
