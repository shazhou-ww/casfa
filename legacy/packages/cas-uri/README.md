# @casfa/cas-uri

CAS URI parsing and formatting for content-addressable storage.

## Installation

```bash
bun add @casfa/cas-uri
```

## Overview

This package provides utilities for parsing and formatting CAS URIs, which uniquely identify content in the CASFA system.

### CAS URI Format

```
{root}[/segment...]
```

Segments can be:
- **Name segments**: regular path names (e.g., `src`, `main.ts`)
- **Index segments**: prefixed with `~` (e.g., `~0`, `~1`, `~2`)

Where `root` can be:
- `nod_{hash}` - Direct reference to a CAS node (26-char Crockford Base32)
- `dpt_{id}` - Reference to a depot

### Examples

```
nod_A6JCHNMFWRT90AXMYWHJ8HKS90             # root only
nod_A6JCHNMFWRT90AXMYWHJ8HKS90/src/main.ts # name path
dpt_01HQXK5V8N3Y7M2P4R6T9W0ABC/~0/~1/~2    # index path
dpt_01HQXK5V8N3Y7M2P4R6T9W0ABC/src/~0/~1   # mixed: name then index
dpt_01HQXK5V8N3Y7M2P4R6T9W0ABC/~1/utils    # mixed: index then name
```

## Usage

### Parsing URIs

```typescript
import { parseCasUri, parseCasUriOrThrow } from '@casfa/cas-uri';

// Safe parsing (returns result object)
const result = parseCasUri('nod_A6JCHNMFWRT90AXMYWHJ8HKS90/src/~0/~1');
if (result.ok) {
  console.log(result.uri.root);      // { type: 'nod', hash: 'A6JCHNMFWRT90AXMYWHJ8HKS90' }
  console.log(result.uri.segments);  // [{ kind: 'name', value: 'src' }, { kind: 'index', value: 0 }, { kind: 'index', value: 1 }]
}

// Throwing variant
const uri = parseCasUriOrThrow('dpt_01HQXK5V8N3Y7M2P4R6T9W0ABC/data');
```

### Creating URIs

```typescript
import { nodeUri, depotUri, createCasUri, formatCasUri, nameSegment, indexSegment } from '@casfa/cas-uri';

// Create URIs with helpers
const node = nodeUri('A6JCHNMFWRT90AXMYWHJ8HKS90', ['src', 'main.ts']);
const depot = depotUri('01HQXK5V8N3Y7M2P4R6T9W0ABC');
const indexed = nodeUri('A6JCHNMFWRT90AXMYWHJ8HKS90', ['src'], [0, 1]);

// Or use the generic function with explicit segments
const uri = createCasUri(
  { type: 'nod', hash: 'A6JCHNMFWRT90AXMYWHJ8HKS90' },
  [nameSegment('src'), indexSegment(0), nameSegment('utils')]
);

// Format to string
formatCasUri(indexed);  // "nod_A6JCHNMFWRT90AXMYWHJ8HKS90/src/~0/~1"
```

### Path Operations

```typescript
import {
  appendPath,
  appendIndex,
  parentUri,
  rootUri,
  basename,
  resolvePath,
  isAncestorOf,
  uriEquals,
  getNamePath,
  getIndexPath,
} from '@casfa/cas-uri';

const uri = parseCasUriOrThrow('nod_A6JCHNMFWRT90AXMYWHJ8HKS90/a/b/c');

// Navigate paths
const parent = parentUri(uri);       // nod_.../a/b
const root = rootUri(uri);           // nod_...
const name = basename(uri);          // 'c'

// Modify paths
const extended = appendPath(uri, 'd', 'e');   // nod_.../a/b/c/d/e
const indexed = appendIndex(uri, 0, 1);       // nod_.../a/b/c/~0/~1
const resolved = resolvePath(uri, '../x');     // nod_.../a/b/x

// Compare URIs
isAncestorOf(parent!, uri);  // true
uriEquals(uri, uri);         // true

// Extract name/index segments separately (bridge to legacy APIs)
getNamePath(uri);   // ['a', 'b', 'c']
getIndexPath(uri);  // []
```

## API Reference

### Types

- `CasUri` - Parsed CAS URI structure
- `CasUriRoot` - Root identifier (nod or dpt)
- `CasUriRootType` - Union type: `'nod' | 'dpt'`
- `PathSegment` - A path segment: `{ kind: 'name', value: string } | { kind: 'index', value: number }`
- `CasUriParseResult` - Result type for parsing operations
- `CasUriParseError` - Error type for parsing failures

### Constants

- `ROOT_TYPES` - Valid root type strings
- `CROCKFORD_BASE32_26` - Regex for 26-char Crockford Base32
- `PATH_SEGMENT_REGEX` - Valid path segment pattern
- `INDEX_SEGMENT_PREFIX` - The `~` prefix character for index segments
- `INDEX_SEGMENT_REGEX` - Regex matching `~N` index segments

## License

MIT
