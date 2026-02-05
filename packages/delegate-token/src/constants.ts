/**
 * Delegate Token constants
 */

/**
 * Total size of a Delegate Token in bytes
 */
export const DELEGATE_TOKEN_SIZE = 128;

/**
 * Magic number for Delegate Token format
 * Bytes: 0x44, 0x4C, 0x54, 0x01 ("DLT\x01" ASCII)
 * u32 LE value: 0x01544C44
 */
export const MAGIC_NUMBER = 0x01544c44;

/**
 * Prefix for Token ID string format
 */
export const TOKEN_ID_PREFIX = "dlt1_";

/**
 * Maximum delegation depth (0-15)
 */
export const MAX_DEPTH = 15;

/**
 * Flags bit positions and masks
 */
export const FLAGS = {
  /** Bit 0: Is this a delegation token (1) or access token (0) */
  IS_DELEGATE: 0,
  /** Bit 1: Was this token issued by user (1) or delegated (0) */
  IS_USER_ISSUED: 1,
  /** Bit 2: Can upload nodes */
  CAN_UPLOAD: 2,
  /** Bit 3: Can manage depots */
  CAN_MANAGE_DEPOT: 3,
  /** Bits 4-7: Delegation depth (shifted) */
  DEPTH_SHIFT: 4,
  /** Mask for depth bits */
  DEPTH_MASK: 0x0f,
} as const;

/**
 * Field offsets in the 128-byte token
 */
export const OFFSETS = {
  /** Magic number (u32 LE) */
  MAGIC: 0,
  /** Flags (u32 LE) */
  FLAGS: 4,
  /** TTL - expiration timestamp (u64 LE, epoch ms) */
  TTL: 8,
  /** Quota (u64 LE, reserved) */
  QUOTA: 16,
  /** Salt (u64 LE, random) */
  SALT: 24,
  /** Issuer ID (32 bytes) */
  ISSUER: 32,
  /** Realm ID (32 bytes) */
  REALM: 64,
  /** Scope hash (32 bytes) */
  SCOPE: 96,
} as const;

/**
 * Field sizes in bytes
 */
export const SIZES = {
  MAGIC: 4,
  FLAGS: 4,
  TTL: 8,
  QUOTA: 8,
  SALT: 8,
  ISSUER: 32,
  REALM: 32,
  SCOPE: 32,
} as const;
