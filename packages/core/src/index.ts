/**
 * @casfa/core
 *
 * CAS binary format encoding/decoding library (v2.1)
 *
 * Node types:
 * - set-node: set of children sorted by hash (for authorization scope)
 * - d-node (dict): directory with sorted children by name
 * - s-node (successor): file continuation chunk
 * - f-node (file): file top-level node with FileInfo
 */

// Constants
export {
  CONTENT_TYPE_MAX_LENGTH,
  DEFAULT_NODE_LIMIT,
  FILEINFO_SIZE,
  FLAGS,
  HASH_ALGO,
  HASH_SIZE,
  HEADER_SIZE,
  MAGIC,
  MAGIC_BYTES,
  MAX_SAFE_SIZE,
  NODE_TYPE,
} from "./constants.ts";
// Controller - Functional API
export {
  // Types
  type CasContext,
  type DictEntry,
  // Functions
  getChunk,
  getNode,
  getNodeLimit,
  getTree,
  has,
  makeDict,
  openFileStream,
  putFileNode,
  readFile,
  type TreeNodeInfo,
  type TreeResponse,
  type WriteResult,
  writeFile,
} from "./controller.ts";

// Header encoding/decoding
export {
  buildDictFlags,
  buildFileFlags,
  buildSetFlags,
  buildSuccessorFlags,
  createDictHeader,
  createFileHeader,
  createSetHeader,
  createSuccessorHeader,
  decodeHeader,
  encodeHeader,
  getBlockSizeLimit,
  getExtensionCount,
  getHashAlgo,
  getNodeType,
  setBlockSizeLimit,
  setExtensionCount,
  setHashAlgo,
} from "./header.ts";
// Node encoding/decoding
export {
  decodeNode,
  encodeDictNode,
  encodeFileNode,
  encodeSetNode,
  encodeSuccessorNode,
  getNodeKind,
  isValidNode,
} from "./node.ts";
// Topology algorithms
export {
  computeCapacity,
  computeDepth,
  computeLayout,
  computeLayoutSize,
  computeUsableSpace,
  countLayoutNodes,
  validateLayout,
} from "./topology.ts";
// Types
export type {
  CasHeader,
  CasNode,
  DictNodeInput,
  EncodedNode,
  FileInfo,
  FileNodeInput,
  HashProvider,  KeyProvider,  LayoutNode,
  NodeKind,
  SetNodeInput,
  StorageProvider,
  SuccessorNodeInput,
} from "./types.ts";
// Utility functions
export {
  bytesToHex,
  computeSizeFlagByte,
  concatBytes,
  decodeCB32,
  decodePascalString,
  decodePascalStrings,
  decodeSizeFlagByte,
  encodeCB32,
  encodePascalString,
  encodePascalStrings,
  hashToKey,
  hexToBytes,
  keyToHash,
} from "./utils.ts";

// Validation
export {
  type ExistsChecker,
  type ValidationResult,
  validateNode,
  validateNodeStructure,
} from "./validation.ts";

// Well-known keys and data
export {
  EMPTY_DICT_BYTES,
  EMPTY_DICT_KEY,
  getWellKnownNodeData,
  isWellKnownNode,
  WELL_KNOWN_KEYS,
  WELL_KNOWN_NODES,
} from "./well-known.ts";
