/**
 * CAS Node Encoding/Decoding (v2.1)
 *
 * Node types:
 * - d-node (dict): Header + Children + Names (Pascal strings)
 * - s-node (successor): Header + Children + Data
 * - f-node (file): Header + Children + FileInfo (64 bytes) + Data
 *
 * All reserved/padding bytes MUST be 0 for hash stability.
 */

import {
  CONTENT_TYPE_MAX_LENGTH,
  FILEINFO_SIZE,
  HASH_SIZE,
  HEADER_SIZE,
  NODE_TYPE,
} from "./constants.ts";
import {
  createDictHeader,
  createFileHeader,
  createSetHeader,
  createSuccessorHeader,
  decodeHeader,
  encodeHeader,
  getNodeType,
} from "./header.ts";
import type {
  CasNode,
  DictNodeInput,
  EncodedNode,
  FileInfo,
  FileNodeInput,
  KeyProvider,
  NodeKind,
  SetNodeInput,
  SuccessorNodeInput,
} from "./types.ts";
import { concatBytes, decodePascalStrings, encodePascalStrings } from "./utils.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encode FileInfo (64 bytes): fileSize (u64 LE) + contentType (56 bytes, null-padded)
 */
function encodeFileInfo(fileSize: number, contentType: string | undefined): Uint8Array {
  const buffer = new ArrayBuffer(FILEINFO_SIZE);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // fileSize as u64 LE
  const sizeLow = fileSize >>> 0;
  const sizeHigh = Math.floor(fileSize / 0x100000000) >>> 0;
  view.setUint32(0, sizeLow, true);
  view.setUint32(4, sizeHigh, true);

  // contentType (56 bytes, null-padded ASCII)
  if (contentType) {
    const ctBytes = textEncoder.encode(contentType);
    if (ctBytes.length > CONTENT_TYPE_MAX_LENGTH) {
      throw new Error(
        `Content-type too long: ${ctBytes.length} bytes (max ${CONTENT_TYPE_MAX_LENGTH})`
      );
    }
    bytes.set(ctBytes, 8);
  }

  return bytes;
}

/**
 * Decode FileInfo from buffer
 */
function decodeFileInfo(buffer: Uint8Array, offset: number): FileInfo {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, FILEINFO_SIZE);

  // fileSize as u64 LE
  const sizeLow = view.getUint32(0, true);
  const sizeHigh = view.getUint32(4, true);
  const fileSize = sizeLow + sizeHigh * 0x100000000;

  // contentType (56 bytes, null-terminated)
  const ctSlice = buffer.subarray(offset + 8, offset + FILEINFO_SIZE);
  let end = ctSlice.indexOf(0);
  if (end === -1) end = CONTENT_TYPE_MAX_LENGTH;
  const contentType = textDecoder.decode(ctSlice.subarray(0, end));

  return { fileSize, contentType };
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
 * Sort children by name (UTF-8 byte order) for d-node
 * Returns sorted [names, children] arrays
 */
function sortChildrenByName(
  names: string[],
  children: Uint8Array[]
): { sortedNames: string[]; sortedChildren: Uint8Array[] } {
  const pairs = names.map((name, i) => ({ name, child: children[i]! }));
  pairs.sort((a, b) => {
    const aBuf = textEncoder.encode(a.name);
    const bBuf = textEncoder.encode(b.name);
    return compareBytes(aBuf, bBuf);
  });
  return {
    sortedNames: pairs.map((p) => p.name),
    sortedChildren: pairs.map((p) => p.child),
  };
}

/**
 * Sort and deduplicate children by hash (byte order) for set-node
 * Returns sorted unique children array
 * @throws Error if duplicate hashes are found
 */
function sortChildrenByHash(children: Uint8Array[]): Uint8Array[] {
  const sorted = [...children].sort(compareBytes);
  // Check for duplicates
  for (let i = 0; i < sorted.length - 1; i++) {
    if (compareBytes(sorted[i]!, sorted[i + 1]!) === 0) {
      throw new Error("Set node children must be unique (duplicate hash found)");
    }
  }
  return sorted;
}

/**
 * Encode a set node - pure set of children sorted by hash
 * Used for authorization scope
 * @throws Error if children count < 2 or duplicate hashes
 */
export async function encodeSetNode(
  input: SetNodeInput,
  keyProvider: KeyProvider
): Promise<EncodedNode> {
  const { children } = input;

  // Validate minimum children count
  if (children.length < 2) {
    throw new Error(`Set node requires at least 2 children, got ${children.length}`);
  }

  // Sort children by hash and check for duplicates
  const sortedChildren = sortChildrenByHash(children);

  // Encode sections
  const childrenBytes = concatBytes(...sortedChildren);

  // Create header (size = 0, no payload)
  const header = createSetHeader(children.length);
  const headerBytes = encodeHeader(header);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes);

  // Compute key
  const hash = await keyProvider.computeKey(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Encode a dict node (d-node) - directory with sorted children
 */
export async function encodeDictNode(
  input: DictNodeInput,
  keyProvider: KeyProvider
): Promise<EncodedNode> {
  const { children, childNames } = input;

  if (children.length !== childNames.length) {
    throw new Error(
      `Children count mismatch: ${children.length} hashes vs ${childNames.length} names`
    );
  }

  // Sort children by name (UTF-8 byte order)
  const { sortedNames, sortedChildren } = sortChildrenByName(childNames, children);

  // Encode sections
  const childrenBytes = concatBytes(...sortedChildren);
  const namesBytes = encodePascalStrings(sortedNames);

  // Create header (size = names payload size)
  const header = createDictHeader(namesBytes.length, children.length);
  const headerBytes = encodeHeader(header);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes, namesBytes);

  // Compute key
  const hash = await keyProvider.computeKey(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Encode a successor node (s-node) - file continuation chunk
 */
export async function encodeSuccessorNode(
  input: SuccessorNodeInput,
  keyProvider: KeyProvider
): Promise<EncodedNode> {
  const { data, children = [] } = input;

  // Encode sections
  const childrenBytes = concatBytes(...children);

  // Create header (size = data size)
  const header = createSuccessorHeader(data.length, children.length);
  const headerBytes = encodeHeader(header);

  // Combine all sections (no padding needed - Header and Children are 16-byte aligned)
  const nodeBytes = concatBytes(headerBytes, childrenBytes, data);

  // Compute key
  const hash = await keyProvider.computeKey(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Encode a file node (f-node) - top-level file with FileInfo
 */
export async function encodeFileNode(
  input: FileNodeInput,
  keyProvider: KeyProvider
): Promise<EncodedNode> {
  const { data, contentType, fileSize, children = [] } = input;

  // Encode sections
  const childrenBytes = concatBytes(...children);
  const fileInfoBytes = encodeFileInfo(fileSize, contentType);

  // Create header (size = FileInfo + data)
  const payloadSize = FILEINFO_SIZE + data.length;
  const header = createFileHeader(payloadSize, children.length);
  const headerBytes = encodeHeader(header);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes, fileInfoBytes, data);

  // Compute key
  const hash = await keyProvider.computeKey(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Decode a CAS node from bytes
 */
export function decodeNode(buffer: Uint8Array): CasNode {
  const header = decodeHeader(buffer);
  const nodeType = getNodeType(header.flags);

  // Parse children
  const children: Uint8Array[] = [];
  let offset = HEADER_SIZE;
  for (let i = 0; i < header.count; i++) {
    children.push(buffer.slice(offset, offset + HASH_SIZE));
    offset += HASH_SIZE;
  }

  // Parse based on node type
  switch (nodeType) {
    case NODE_TYPE.SET: {
      // set-node: pure set of children (no payload)
      return {
        kind: "set",
        size: header.size,
        children: children.length > 0 ? children : undefined,
      };
    }

    case NODE_TYPE.DICT: {
      // d-node: parse names
      const childNames = decodePascalStrings(buffer, offset, header.count);
      return {
        kind: "dict",
        size: header.size,
        children: children.length > 0 ? children : undefined,
        childNames,
      };
    }

    case NODE_TYPE.SUCCESSOR: {
      // s-node: parse data (no padding in v2.1)
      const data = buffer.slice(offset);
      return {
        kind: "successor",
        size: header.size,
        children: children.length > 0 ? children : undefined,
        data,
      };
    }

    case NODE_TYPE.FILE: {
      // f-node: parse FileInfo and data
      const fileInfo = decodeFileInfo(buffer, offset);
      offset += FILEINFO_SIZE;
      const data = buffer.slice(offset);
      return {
        kind: "file",
        size: header.size,
        fileInfo,
        children: children.length > 0 ? children : undefined,
        data,
      };
    }

    default:
      throw new Error(`Unknown node type: ${nodeType}`);
  }
}

/**
 * Check if a buffer is a valid CAS node (has correct magic)
 */
export function isValidNode(buffer: Uint8Array): boolean {
  if (buffer.length < HEADER_SIZE) {
    return false;
  }

  try {
    decodeHeader(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get node kind from buffer without full decode
 */
export function getNodeKind(buffer: Uint8Array): NodeKind | null {
  if (buffer.length < HEADER_SIZE) {
    return null;
  }

  try {
    const header = decodeHeader(buffer);
    const nodeType = getNodeType(header.flags);
    switch (nodeType) {
      case NODE_TYPE.SET:
        return "set";
      case NODE_TYPE.DICT:
        return "dict";
      case NODE_TYPE.SUCCESSOR:
        return "successor";
      case NODE_TYPE.FILE:
        return "file";
      default:
        return null;
    }
  } catch {
    return null;
  }
}
