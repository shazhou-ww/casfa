/**
 * CAS Node Validation (v2.1)
 *
 * Layered validation for server-side use:
 *
 * Layer 1 - Header Strong Validation:
 * - Magic bytes
 * - Flags reserved bits (16-31) are zero
 * - Length consistency: buffer.length == 16 + count * 16 + size
 * - Hash matches content
 *
 * Layer 2 - Payload Validation:
 * - f-node: size >= 64 (FileInfo), contentType charset
 * - d-node: names completeness, UTF-8 validity, sorted, unique
 * - s-node: no special validation
 *
 * NOT Validated:
 * - fileSize vs actual tree data (requires traversal)
 */

import {
  CONTENT_TYPE_MAX_LENGTH,
  FILEINFO_SIZE,
  FLAGS,
  HASH_SIZE,
  HEADER_SIZE,
  MAGIC_BYTES,
  NODE_TYPE,
} from "./constants.ts";
import { decodeHeader, getNodeType } from "./header.ts";
import type { HashProvider, NodeKind } from "./types.ts";
import { hashToKey } from "./utils.ts";

/**
 * Validation result
 */
export type ValidationResult = {
  valid: boolean;
  error?: string;
  kind?: NodeKind;
  size?: number;
  childKeys?: string[];
};

/**
 * Function to check if a key exists
 */
export type ExistsChecker = (key: string) => Promise<boolean>;

/**
 * Validate a Pascal string at the given offset
 * Pascal string format: u16 LE length + UTF-8 bytes
 * Returns [isValid, bytesConsumed, error?]
 */
function validatePascalString(
  buffer: Uint8Array,
  offset: number
): [valid: boolean, bytesConsumed: number, error?: string] {
  // Need at least 2 bytes for length
  if (offset + 2 > buffer.length) {
    return [false, 0, `Pascal string at ${offset}: not enough bytes for length`];
  }

  // Read u16 LE length
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const length = view.getUint16(offset, true);

  // Check if string data fits in buffer
  if (offset + 2 + length > buffer.length) {
    return [false, 0, `Pascal string at ${offset} exceeds buffer (length=${length})`];
  }

  // Validate UTF-8 by attempting decode
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decoder.decode(buffer.slice(offset + 2, offset + 2 + length));
    return [true, 2 + length];
  } catch {
    return [false, 0, `Invalid UTF-8 in Pascal string at ${offset}`];
  }
}

/**
 * Validate multiple Pascal strings starting at offset
 */
function _validatePascalStrings(
  buffer: Uint8Array,
  offset: number,
  count: number
): [valid: boolean, error?: string] {
  let currentOffset = offset;

  for (let i = 0; i < count; i++) {
    const [valid, bytesConsumed, error] = validatePascalString(buffer, currentOffset);
    if (!valid) {
      return [false, `Name ${i}: ${error}`];
    }

    // Move to next string
    currentOffset += bytesConsumed;
  }

  return [true];
}

/**
 * Validate multiple Pascal strings and return the decoded names
 */
function validatePascalStringsWithNames(
  buffer: Uint8Array,
  offset: number,
  count: number
): [valid: boolean, error?: string, names?: string[]] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const names: string[] = [];
  let currentOffset = offset;

  for (let i = 0; i < count; i++) {
    const [valid, bytesConsumed, error] = validatePascalString(buffer, currentOffset);
    if (!valid) {
      return [false, `Name ${i}: ${error}`];
    }

    // Decode the name
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const length = view.getUint16(currentOffset, true);
    try {
      const name = decoder.decode(buffer.slice(currentOffset + 2, currentOffset + 2 + length));
      names.push(name);
    } catch {
      return [false, `Name ${i}: Invalid UTF-8`];
    }

    // Move to next string
    currentOffset += bytesConsumed;
  }

  return [true, undefined, names];
}

/**
 * Compare two byte arrays lexicographically
 * Returns negative if a < b, 0 if equal, positive if a > b
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/**
 * Validate multiple Pascal strings starting at offset (no name extraction)
 */
function _validatePascalStringsNoExtract(
  buffer: Uint8Array,
  offset: number,
  count: number
): [valid: boolean, error?: string] {
  let currentOffset = offset;

  for (let i = 0; i < count; i++) {
    const [valid, bytesConsumed, error] = validatePascalString(buffer, currentOffset);
    if (!valid) {
      return [false, `Name ${i}: ${error}`];
    }

    // Move to next string
    currentOffset += bytesConsumed;
  }

  return [true];
}

/**
 * Validate a CAS node strictly
 *
 * Checks:
 * 1. Magic bytes
 * 2. Header structure and offsets
 * 3. Hash matches expectedKey
 * 4. Pascal strings are valid (names, contentType)
 * 5. All children exist (if existsChecker provided)
 * 6. For dicts: size equals sum of children sizes
 *
 * @param bytes - Raw node bytes
 * @param expectedKey - Expected hash key (blake3s:...)
 * @param hashProvider - Hash provider for verification
 * @param existsChecker - Optional function to check child existence
 * @param getSize - Optional function to get child size for dict validation
 */
export async function validateNode(
  bytes: Uint8Array,
  expectedKey: string,
  hashProvider: HashProvider,
  existsChecker?: ExistsChecker,
  getSize?: (key: string) => Promise<number | null>
): Promise<ValidationResult> {
  // 1. Check minimum size
  if (bytes.length < HEADER_SIZE) {
    return { valid: false, error: "Buffer too small for header" };
  }

  // 2. Check magic
  if (
    bytes[0] !== MAGIC_BYTES[0] ||
    bytes[1] !== MAGIC_BYTES[1] ||
    bytes[2] !== MAGIC_BYTES[2] ||
    bytes[3] !== MAGIC_BYTES[3]
  ) {
    return { valid: false, error: "Invalid magic bytes" };
  }

  // 3. Parse header
  let header;
  try {
    header = decodeHeader(bytes);
  } catch (e: any) {
    return { valid: false, error: `Header decode failed: ${e.message}` };
  }

  const nodeType = getNodeType(header.flags);
  let kind: NodeKind;
  switch (nodeType) {
    case NODE_TYPE.SET:
      kind = "set";
      break;
    case NODE_TYPE.DICT:
      kind = "dict";
      break;
    case NODE_TYPE.SUCCESSOR:
      kind = "successor";
      break;
    case NODE_TYPE.FILE:
      kind = "file";
      break;
    default:
      return { valid: false, error: `Unknown node type: ${nodeType}` };
  }

  const isSet = nodeType === NODE_TYPE.SET;
  const isDict = nodeType === NODE_TYPE.DICT;
  const isFile = nodeType === NODE_TYPE.FILE;

  // 4. Validate flags reserved bits are zero (bits 16-31)
  if ((header.flags & FLAGS.RESERVED_MASK) !== 0) {
    return {
      valid: false,
      error: `Flags has reserved bits set: 0x${header.flags.toString(16)}`,
    };
  }

  // 5. Validate length consistency: buffer.length == 16 + count * 16 + size
  const expectedLength = HEADER_SIZE + header.count * HASH_SIZE + header.size;
  if (bytes.length !== expectedLength) {
    return {
      valid: false,
      error: `Length mismatch: expected ${expectedLength} (${HEADER_SIZE} + ${header.count} * ${HASH_SIZE} + ${header.size}), actual=${bytes.length}`,
    };
  }

  // 6. Validate children section is within bounds
  const childrenEnd = HEADER_SIZE + header.count * HASH_SIZE;
  if (childrenEnd > bytes.length) {
    return {
      valid: false,
      error: `Children section exceeds buffer (need ${childrenEnd}, have ${bytes.length})`,
    };
  }

  // 7. Extract child keys
  const childKeys: string[] = [];
  for (let i = 0; i < header.count; i++) {
    const offset = HEADER_SIZE + i * HASH_SIZE;
    const hashBytes = bytes.slice(offset, offset + HASH_SIZE);
    childKeys.push(hashToKey(hashBytes));
  }

  // 8. Validate set-node constraints
  if (isSet) {
    // Set node requires at least 2 children
    if (header.count < 2) {
      return {
        valid: false,
        error: `Set node requires at least 2 children, got ${header.count}`,
      };
    }
    // Set node must have no payload (size = 0)
    if (header.size !== 0) {
      return {
        valid: false,
        error: `Set node size must be 0, got ${header.size}`,
      };
    }
    // Validate children are sorted by hash and unique
    for (let i = 0; i < header.count - 1; i++) {
      const current = bytes.subarray(
        HEADER_SIZE + i * HASH_SIZE,
        HEADER_SIZE + (i + 1) * HASH_SIZE
      );
      const next = bytes.subarray(
        HEADER_SIZE + (i + 1) * HASH_SIZE,
        HEADER_SIZE + (i + 2) * HASH_SIZE
      );
      const cmp = compareBytes(current, next);
      if (cmp === 0) {
        return {
          valid: false,
          error: `Set node has duplicate child hash at index ${i}`,
        };
      }
      if (cmp > 0) {
        return {
          valid: false,
          error: `Set node children not sorted at index ${i}`,
        };
      }
    }
  }

  // 9. Validate f-node FileInfo section (64 bytes: fileSize + contentType)
  if (isFile) {
    // f-node size must be at least FILEINFO_SIZE (64 bytes)
    if (header.size < FILEINFO_SIZE) {
      return {
        valid: false,
        error: `f-node size too small for FileInfo: ${header.size} < ${FILEINFO_SIZE}`,
      };
    }

    // Validate contentType in FileInfo (bytes 8-63 of payload, which is at childrenEnd)
    const ctStart = childrenEnd + 8; // skip fileSize (8 bytes)
    const ctSlice = bytes.subarray(ctStart, ctStart + CONTENT_TYPE_MAX_LENGTH);

    // Find actual content-type length (first null or max length)
    let actualCtLen = ctSlice.indexOf(0);
    if (actualCtLen === -1) actualCtLen = CONTENT_TYPE_MAX_LENGTH;

    // Validate content-type contains only printable ASCII (0x20-0x7E)
    for (let i = 0; i < actualCtLen; i++) {
      const b = ctSlice[i]!;
      if (b < 0x20 || b > 0x7e) {
        return {
          valid: false,
          error: `Content-type contains invalid character at offset ${i} (value=${b})`,
        };
      }
    }

    // Validate all padding bytes are zero (from actualCtLen to CONTENT_TYPE_MAX_LENGTH)
    for (let i = actualCtLen; i < CONTENT_TYPE_MAX_LENGTH; i++) {
      if (ctSlice[i] !== 0) {
        return {
          valid: false,
          error: `Content-type padding not zero at offset ${i} (value=${ctSlice[i]})`,
        };
      }
    }
  }

  // 9. Validate Pascal strings for d-node names
  let childNames: string[] = [];
  if (isDict && header.count > 0) {
    // Names section starts right after children
    const namesOffset = childrenEnd;
    const [valid, error, names] = validatePascalStringsWithNames(bytes, namesOffset, header.count);
    if (!valid) {
      return { valid: false, error: `Invalid names: ${error}` };
    }
    childNames = names!;
  }

  // 10. Validate d-node children are sorted by name (UTF-8 byte order) and no duplicates
  if (isDict && childNames.length > 1) {
    const textEncoder = new TextEncoder();
    for (let i = 0; i < childNames.length - 1; i++) {
      const current = textEncoder.encode(childNames[i]!);
      const next = textEncoder.encode(childNames[i + 1]!);
      const cmp = compareBytes(current, next);
      if (cmp === 0) {
        return {
          valid: false,
          error: `Duplicate child name: "${childNames[i]}"`,
        };
      }
      if (cmp > 0) {
        return {
          valid: false,
          error: `Dict children not sorted: "${childNames[i]}" should come before "${childNames[i + 1]}"`,
        };
      }
    }
  }

  // 11. Verify hash
  const actualHash = await hashProvider.hash(bytes);
  const actualKey = hashToKey(actualHash);
  if (actualKey !== expectedKey) {
    return {
      valid: false,
      error: `Hash mismatch: expected ${expectedKey}, got ${actualKey}`,
    };
  }

  // 12. Check children exist (if checker provided)
  if (existsChecker && childKeys.length > 0) {
    const missing: string[] = [];
    for (const key of childKeys) {
      const exists = await existsChecker(key);
      if (!exists) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing children: ${missing.join(", ")}`,
        kind,
        size: header.size,
        childKeys,
      };
    }
  }

  // 13. Validate dict node size (sum of children sizes)
  if (isDict && getSize && childKeys.length > 0) {
    let expectedSize = 0;
    for (const key of childKeys) {
      const childSize = await getSize(key);
      if (childSize === null) {
        return {
          valid: false,
          error: `Cannot get size for child: ${key}`,
          kind,
          size: header.size,
          childKeys,
        };
      }
      expectedSize += childSize;
    }
    if (header.size !== expectedSize) {
      return {
        valid: false,
        error: `Dict size mismatch: header=${header.size}, computed=${expectedSize}`,
        kind,
        size: header.size,
        childKeys,
      };
    }
  }

  return {
    valid: true,
    kind,
    size: header.size,
    childKeys,
  };
}

/**
 * Quick validation without async checks
 * Only validates structure, not hash or children
 */
export function validateNodeStructure(bytes: Uint8Array): ValidationResult {
  // 1. Check minimum size
  if (bytes.length < HEADER_SIZE) {
    return { valid: false, error: "Buffer too small for header" };
  }

  // 2. Check magic
  if (
    bytes[0] !== MAGIC_BYTES[0] ||
    bytes[1] !== MAGIC_BYTES[1] ||
    bytes[2] !== MAGIC_BYTES[2] ||
    bytes[3] !== MAGIC_BYTES[3]
  ) {
    return { valid: false, error: "Invalid magic bytes" };
  }

  // 3. Parse header
  let header;
  try {
    header = decodeHeader(bytes);
  } catch (e: any) {
    return { valid: false, error: `Header decode failed: ${e.message}` };
  }

  const nodeType = getNodeType(header.flags);
  let kind: NodeKind;
  switch (nodeType) {
    case NODE_TYPE.SET:
      kind = "set";
      break;
    case NODE_TYPE.DICT:
      kind = "dict";
      break;
    case NODE_TYPE.SUCCESSOR:
      kind = "successor";
      break;
    case NODE_TYPE.FILE:
      kind = "file";
      break;
    default:
      return { valid: false, error: `Unknown node type: ${nodeType}` };
  }

  const isSet = nodeType === NODE_TYPE.SET;
  const isDict = nodeType === NODE_TYPE.DICT;
  const isFile = nodeType === NODE_TYPE.FILE;

  // 4. Validate flags reserved bits are zero (bits 16-31)
  if ((header.flags & FLAGS.RESERVED_MASK) !== 0) {
    return {
      valid: false,
      error: `Flags has reserved bits set: 0x${header.flags.toString(16)}`,
    };
  }

  // 5. Validate length consistency: buffer.length == 16 + count * 16 + size
  const expectedLength = HEADER_SIZE + header.count * HASH_SIZE + header.size;
  if (bytes.length !== expectedLength) {
    return {
      valid: false,
      error: `Length mismatch: expected ${expectedLength} (${HEADER_SIZE} + ${header.count} * ${HASH_SIZE} + ${header.size}), actual=${bytes.length}`,
    };
  }

  // 6. Validate children section
  const childrenEnd = HEADER_SIZE + header.count * HASH_SIZE;
  if (childrenEnd > bytes.length) {
    return { valid: false, error: "Children section exceeds buffer" };
  }

  // 7. Extract child keys
  const childKeys: string[] = [];
  for (let i = 0; i < header.count; i++) {
    const offset = HEADER_SIZE + i * HASH_SIZE;
    const hashBytes = bytes.slice(offset, offset + HASH_SIZE);
    childKeys.push(hashToKey(hashBytes));
  }

  // 8. Validate set-node constraints
  if (isSet) {
    // Set node requires at least 2 children
    if (header.count < 2) {
      return {
        valid: false,
        error: `Set node requires at least 2 children, got ${header.count}`,
      };
    }
    // Set node must have no payload (size = 0)
    if (header.size !== 0) {
      return {
        valid: false,
        error: `Set node size must be 0, got ${header.size}`,
      };
    }
    // Validate children are sorted by hash and unique
    for (let i = 0; i < header.count - 1; i++) {
      const current = bytes.subarray(
        HEADER_SIZE + i * HASH_SIZE,
        HEADER_SIZE + (i + 1) * HASH_SIZE
      );
      const next = bytes.subarray(
        HEADER_SIZE + (i + 1) * HASH_SIZE,
        HEADER_SIZE + (i + 2) * HASH_SIZE
      );
      const cmp = compareBytes(current, next);
      if (cmp === 0) {
        return {
          valid: false,
          error: `Set node has duplicate child hash at index ${i}`,
        };
      }
      if (cmp > 0) {
        return {
          valid: false,
          error: `Set node children not sorted at index ${i}`,
        };
      }
    }
  }

  // 9. Validate f-node FileInfo section
  if (isFile) {
    if (header.size < FILEINFO_SIZE) {
      return {
        valid: false,
        error: `f-node size too small for FileInfo: ${header.size} < ${FILEINFO_SIZE}`,
      };
    }

    // Validate contentType charset
    const ctStart = childrenEnd + 8;
    const ctSlice = bytes.subarray(ctStart, ctStart + CONTENT_TYPE_MAX_LENGTH);

    let actualCtLen = ctSlice.indexOf(0);
    if (actualCtLen === -1) actualCtLen = CONTENT_TYPE_MAX_LENGTH;

    for (let i = 0; i < actualCtLen; i++) {
      const b = ctSlice[i]!;
      if (b < 0x20 || b > 0x7e) {
        return {
          valid: false,
          error: `Content-type contains invalid character at offset ${i} (value=${b})`,
        };
      }
    }

    for (let i = actualCtLen; i < CONTENT_TYPE_MAX_LENGTH; i++) {
      if (ctSlice[i] !== 0) {
        return {
          valid: false,
          error: `Content-type padding not zero at offset ${i} (value=${ctSlice[i]})`,
        };
      }
    }
  }

  // 9. Validate Pascal strings for d-node names and check sorting
  if (isDict && header.count > 0) {
    const namesOffset = childrenEnd;
    const [valid, error, names] = validatePascalStringsWithNames(bytes, namesOffset, header.count);
    if (!valid) {
      return { valid: false, error: `Invalid names: ${error}` };
    }

    // Validate d-node children are sorted by name (UTF-8 byte order) and no duplicates
    if (names!.length > 1) {
      const textEncoder = new TextEncoder();
      for (let i = 0; i < names!.length - 1; i++) {
        const current = textEncoder.encode(names![i]!);
        const next = textEncoder.encode(names![i + 1]!);
        const cmp = compareBytes(current, next);
        if (cmp === 0) {
          return {
            valid: false,
            error: `Duplicate child name: "${names![i]}"`,
          };
        }
        if (cmp > 0) {
          return {
            valid: false,
            error: `Dict children not sorted: "${names![i]}" should come before "${names![i + 1]}"`,
          };
        }
      }
    }
  }

  return {
    valid: true,
    kind,
    size: header.size,
    childKeys,
  };
}
