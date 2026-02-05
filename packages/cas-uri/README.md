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
{root}[/path...][#index-path]
```

Where `root` can be:
- `node:{hash}` - Direct reference to a CAS node (53-char hex)
- `depot:{ulid}` - Reference to a depot
- `ticket:{ulid}` - Reference to a ticket

## Usage

### Parsing URIs

```typescript
import { parseCasUri, parseCasUriOrThrow } from '@casfa/cas-uri';

// Safe parsing (returns result object)
const result = parseCasUri('node:abc123.../path/to/file');
if (result.success) {
  console.log(result.value.root);  // { type: 'node', id: 'abc123...' }
  console.log(result.value.path);  // ['path', 'to', 'file']
}

// Throwing variant
const uri = parseCasUriOrThrow('depot:01HQXK5V8N3Y7M2P4R6T9W0ABC/data');
```

### Creating URIs

```typescript
import { nodeUri, depotUri, ticketUri, formatCasUri } from '@casfa/cas-uri';

// Create URIs with helpers
const node = nodeUri('abc123...', ['path', 'to', 'file']);
const depot = depotUri('01HQXK5V8N3Y7M2P4R6T9W0ABC');
const ticket = ticketUri('01HQXK5V8N3Y7M2P4R6T9W0ABC', ['subpath']);

// Or use the generic function
const uri = formatCasUri({
  root: { type: 'node', id: 'abc123...' },
  path: ['path', 'to', 'file'],
});
```

### Path Operations

```typescript
import {
  appendPath,
  parentUri,
  rootUri,
  basename,
  resolvePath,
  isAncestorOf,
  uriEquals,
  withIndexPath,
} from '@casfa/cas-uri';

const uri = parseCasUriOrThrow('node:abc123.../a/b/c');

// Navigate paths
const parent = parentUri(uri);       // node:abc123.../a/b
const root = rootUri(uri);           // node:abc123...
const name = basename(uri);          // 'c'

// Modify paths
const extended = appendPath(uri, ['d', 'e']);  // node:abc123.../a/b/c/d/e
const resolved = resolvePath(uri, '../x');      // node:abc123.../a/b/x

// Compare URIs
isAncestorOf(parent, uri);  // true
uriEquals(uri, uri);        // true

// Index paths (for dict lookups)
const indexed = withIndexPath(uri, ['meta', 'info']);  // node:abc123.../a/b/c#meta/info
```

## API Reference

### Types

- `CasUri` - Parsed CAS URI structure
- `CasUriRoot` - Root identifier (node, depot, or ticket)
- `CasUriRootType` - Union type: `'node' | 'depot' | 'ticket'`
- `CasUriParseResult` - Result type for parsing operations
- `CasUriParseError` - Error type for parsing failures

### Constants

- `ROOT_TYPES` - Valid root type strings
- `CROCKFORD_BASE32_26` - Regex for 26-char Crockford Base32
- `PATH_SEGMENT_REGEX` - Valid path segment pattern

## License

MIT
