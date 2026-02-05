/**
 * CAS URI constants
 */

/**
 * Valid root type prefixes
 */
export const ROOT_TYPES = ["node", "depot", "ticket"] as const;

/**
 * Crockford Base32 regex pattern for 26 character IDs (128-bit)
 */
export const CROCKFORD_BASE32_26 = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

/**
 * Regex for valid path segment characters
 * Allowed: alphanumeric, -, _, .
 */
export const PATH_SEGMENT_REGEX = /^[a-zA-Z0-9_\-.]+$/;
