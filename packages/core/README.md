# @casfa/core

CAS (Content-Addressable Storage) binary format encoding/decoding library.

## Installation

```bash
bun add @casfa/core
```

## Overview

This package implements the core binary format for CAS nodes. All nodes use a unified 32-byte header followed by variable-length body sections.

## Node Types

### Chunk (File Data)

Chunks use a self-similar B-Tree structure where each node contains:
- **data**: Raw file bytes (up to `nodeLimit - header - children*32`)
- **children**: References to child chunks (for large files)

This design ensures deterministic tree topology: given a file size and node limit, the tree structure is uniquely determined.

### Dict (Directory)

Dicts contain:
- **children**: References to child nodes (chunks or dicts)
- **names**: Names for each child entry
- **contentType**: Optional MIME type (typically `inode/directory`)

## Binary Format

```
┌─────────────────────────────────────────────────────────────┐
│                         HEADER (32 bytes)                    │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ magic(4) │ flags(4) │ count(4) │ size(8)  │ offsets(12)     │
└──────────┴──────────┴──────────┴──────────┴─────────────────┘
│                         CHILDREN (N × 32 bytes)              │
├─────────────────────────────────────────────────────────────┤
│                         NAMES (Pascal strings)               │  ← dict only
├─────────────────────────────────────────────────────────────┤
│                         CONTENT-TYPE (Pascal string)         │
├─────────────────────────────────────────────────────────────┤
│                         DATA (raw bytes)                     │  ← chunk only
└─────────────────────────────────────────────────────────────┘
```

### Header Fields

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | magic | `0x01534143` ("CAS\x01" LE) |
| 4 | 4 | flags | Bit flags (hasNames, hasType, hasData) |
| 8 | 4 | count | Number of children |
| 12 | 8 | size | Logical size (file size for chunks) |
| 20 | 4 | namesOffset | Offset to NAMES section (0 if none) |
| 24 | 4 | typeOffset | Offset to CONTENT-TYPE section (0 if none) |
| 28 | 4 | dataOffset | Offset to DATA section (0 if none) |

### Flags

| Bit | Name | Description |
|-----|------|-------------|
| 0 | hasNames | Has NAMES section (dict) |
| 1 | hasType | Has CONTENT-TYPE section |
| 2 | hasData | Has DATA section (chunk) |

## B-Tree Capacity Formula

For a node limit `L` (usable space = L - 32 bytes header):

```
C(d) = L^d / 32^(d-1)
```

Where `d` is the tree depth:
- C(1) ≈ 1 MB (leaf node)
- C(2) ≈ 32 GB (2-level tree)
- C(3) ≈ 1 PB (3-level tree)

## Usage

```typescript
import {
  encodeFileNode,
  encodeDictNode,
  decodeNode,
  computeDepth,
  computeLayout,
} from "@casfa/core";

// Encode a small file
const data = new Uint8Array([1, 2, 3, 4]);
const file = await encodeFileNode({ data, contentType: "application/octet-stream" }, hashProvider);

// Decode any node
const node = decodeNode(file.bytes);
console.log(node.kind); // "file"
console.log(node.size); // 4

// Compute tree structure for large file
const depth = computeDepth(1024 * 1024 * 100, 1024 * 1024); // 100MB file, 1MB limit
const layout = computeLayout(1024 * 1024 * 100, 1024 * 1024);
```

## License

MIT
