import { createHash } from "node:crypto";

const S3_BUCKET_MAX_LENGTH = 63;
const HASH_SUFFIX_LENGTH = 8;

/**
 * Normalize a segment for use in physical resource names: lowercase, hyphens only.
 * S3 bucket names allow only lowercase, digits, and hyphens (no underscore).
 */
function normalizeSegment(s: string): string {
  return s.toLowerCase().replace(/_/g, "-");
}

/**
 * Build the base physical name: `<stackName>-<cellId>-<key>` normalized.
 */
function basePhysicalName(
  stackName: string,
  cellId: string,
  key: string,
): string {
  const s = `${normalizeSegment(stackName)}-${normalizeSegment(cellId)}-${normalizeSegment(key)}`;
  return s;
}

/**
 * Table physical name for DynamoDB: `<stackName>-<cellId>-<tableKey>`.
 * Normalized to lowercase with hyphens (any uppercase or underscore is normalized).
 */
export function tablePhysicalName(
  stackName: string,
  cellId: string,
  tableKey: string,
): string {
  return basePhysicalName(stackName, cellId, tableKey);
}

/**
 * Bucket physical name for S3: same pattern as table, but length must be ≤63.
 * S3 rules: only lowercase, digits, hyphens (no underscore).
 *
 * Truncation rule when length > 63: take the first (63 - 1 - 8) = 54 characters
 * of the full normalized name (so we truncate proportionally across stackName,
 * cellId, and bucketKey), then append a hyphen and the first 8 hex chars of
 * SHA256(full normalized string) so the result is unique and deterministic.
 */
export function bucketPhysicalName(
  stackName: string,
  cellId: string,
  bucketKey: string,
): string {
  const full = basePhysicalName(stackName, cellId, bucketKey);
  if (full.length <= S3_BUCKET_MAX_LENGTH) {
    return full;
  }
  const truncateTo = S3_BUCKET_MAX_LENGTH - 1 - HASH_SUFFIX_LENGTH; // 54
  const truncated = full.slice(0, truncateTo);
  const hash = createHash("sha256").update(full).digest("hex").slice(0, HASH_SUFFIX_LENGTH);
  return `${truncated}-${hash}`;
}
