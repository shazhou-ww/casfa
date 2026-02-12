/**
 * Human-readable file-size formatting.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Format bytes into a human-readable string.
 *
 * @example formatSize(0) → "0 B"
 * @example formatSize(1536) → "1.5 KB"
 * @example formatSize(1048576) → "1.0 MB"
 */
export function formatSize(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null) return "\u2014";
  if (bytes === 0) return "0 B";
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(1)} ${UNITS[i]}`;
}
