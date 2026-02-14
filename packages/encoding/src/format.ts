/**
 * Human-readable formatting utilities
 */

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Format bytes into a human-readable string.
 *
 * @param bytes - Number of bytes (or null/undefined)
 * @param options - Formatting options
 * @param options.precision - Decimal places (default: 1)
 * @param options.nullFallback - String to return for null/undefined (default: "—")
 * @returns Formatted string, e.g. "1.5 KB"
 *
 * @example formatSize(0) → "0 B"
 * @example formatSize(1536) → "1.5 KB"
 * @example formatSize(1048576) → "1.0 MB"
 * @example formatSize(1536, { precision: 2 }) → "1.50 KB"
 * @example formatSize(null) → "—"
 */
export function formatSize(
  bytes: number | undefined | null,
  options?: { precision?: number; nullFallback?: string }
): string {
  if (bytes === undefined || bytes === null) return options?.nullFallback ?? "\u2014";
  if (bytes === 0) return "0 B";

  const precision = options?.precision ?? 1;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** i;

  return `${i === 0 ? value : value.toFixed(precision)} ${SIZE_UNITS[i]}`;
}
