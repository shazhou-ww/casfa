/**
 * CAS URI constants
 */

/**
 * Valid root type prefixes (use underscore separator)
 */
export const ROOT_TYPES = ["nod", "dpt"] as const;

/**
 * Crockford Base32 regex pattern for 26 character IDs (128-bit)
 */
export const CROCKFORD_BASE32_26 = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

/**
 * Regex for valid path segment characters
 * Allowed: alphanumeric, -, _, .
 */
export const PATH_SEGMENT_REGEX = /^[a-zA-Z0-9_\-.]+$/;

/**
 * Prefix character for index segments in the URI path
 */
export const INDEX_SEGMENT_PREFIX = "~";

/**
 * Regex for index segments: ~ followed by one or more digits
 */
export const INDEX_SEGMENT_REGEX = /^~(\d+)$/;
