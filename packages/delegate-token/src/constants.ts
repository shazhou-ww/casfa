/**
 * Delegate Token constants
 *
 * Binary format: 128 bytes
 * Flags layout (low byte of u32 LE):
 *   Low nibble  (bits 0-3): type + permissions
 *     bit 0: is_refresh  (1 = Refresh Token, 0 = Access Token)
 *     bit 1: can_upload
 *     bit 2: can_manage_depot
 *     bit 3: reserved
 *   High nibble (bits 4-7): depth (0-15)
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
 * Maximum delegation depth (0-15, stored in high nibble)
 */
export const MAX_DEPTH = 15;

/**
 * Flags bit positions and masks
 *
 * Low nibble: type + permissions
 *   bit 0: is_refresh
 *   bit 1: can_upload
 *   bit 2: can_manage_depot
 *   bit 3: reserved
 * High nibble: depth (0-15)
 */
export const FLAGS = {
  /** Bit 0: Is this a Refresh Token (1) or Access Token (0) */
  IS_REFRESH: 0,
  /** Bit 1: Can upload nodes */
  CAN_UPLOAD: 1,
  /** Bit 2: Can manage depots */
  CAN_MANAGE_DEPOT: 2,
  /** Bit 3: Reserved */
  RESERVED: 3,
  /** Bits 4-7: Delegation depth (high nibble) */
  DEPTH_SHIFT: 4,
  /** Mask for depth bits (after shifting) */
  DEPTH_MASK: 0x0f,
  /** Mask for low nibble (type + permissions) */
  PERM_MASK: 0x0f,
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
