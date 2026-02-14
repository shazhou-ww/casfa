# @casfa/encoding

Shared encoding utilities for the CASFA ecosystem.

## Features

- **Crockford Base32** — `encodeCB32` / `decodeCB32` / `isValidCB32`
- **Base64URL** (RFC 4648 §5) — `base64urlEncode` / `base64urlDecode`
- **Hex** — `bytesToHex` / `hexToBytes`
- **Formatting** — `formatSize` (human-readable byte sizes)

## Usage

```typescript
import {
  encodeCB32,
  decodeCB32,
  base64urlEncode,
  bytesToHex,
  formatSize,
} from "@casfa/encoding";

// Crockford Base32
const encoded = encodeCB32(new Uint8Array([0x48, 0x65])); // "91GM"
const decoded = decodeCB32("91GM"); // Uint8Array [0x48, 0x65]

// Base64URL
const b64 = base64urlEncode(new Uint8Array([1, 2, 3])); // "AQID"

// Hex
const hex = bytesToHex(new Uint8Array([0xff, 0x00])); // "ff00"

// Formatting
formatSize(1536); // "1.5 KB"
formatSize(1536, { precision: 2 }); // "1.50 KB"
formatSize(null); // "—"
```

## Design

This package has **zero runtime dependencies** and is designed as the
lowest-level encoding layer in the CASFA dependency graph. Both
`@casfa/core` and `@casfa/protocol` import from this package, avoiding
any circular dependency between them.
