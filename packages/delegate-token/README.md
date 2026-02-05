# @casfa/delegate-token

Delegate Token encoding/decoding for CASFA authorization system.

## Installation

```bash
bun add @casfa/delegate-token
```

## Overview

This package implements the 128-byte binary format for Delegate Tokens in the CASFA authorization system. Delegate Tokens enable hierarchical permission delegation with cryptographic chain verification.

### Token Structure

```
┌─────────────────────────────────────────────────────────────┐
│                    DELEGATE TOKEN (128 bytes)                │
├──────────────────────────────────────────────────────────────┤
│ Magic (4)     │ Version (1) │ Flags (1) │ Depth (1) │ Res (1)│
├──────────────────────────────────────────────────────────────┤
│ Issued At (8)            │ Expires At (8)                    │
├──────────────────────────────────────────────────────────────┤
│ Issuer ID (16)                                               │
├──────────────────────────────────────────────────────────────┤
│ Subject ID (16)                                              │
├──────────────────────────────────────────────────────────────┤
│ Resource ID (16)                                             │
├──────────────────────────────────────────────────────────────┤
│ Parent Hash (16)                                             │
├──────────────────────────────────────────────────────────────┤
│ Signature (32)                                               │
└──────────────────────────────────────────────────────────────┘
```

## Usage

### Encoding Tokens

```typescript
import { encodeDelegateToken } from '@casfa/delegate-token';

const token = encodeDelegateToken({
  issuerId: new Uint8Array(16),   // 128-bit issuer ID
  subjectId: new Uint8Array(16),  // 128-bit subject ID
  resourceId: new Uint8Array(16), // 128-bit resource ID
  issuedAt: Date.now(),
  expiresAt: Date.now() + 3600000,
  flags: {
    canDelegate: true,
    canRead: true,
    canWrite: false,
  },
  depth: 1,
  parentHash: new Uint8Array(16), // Parent token hash (or zeros for root)
}, signingKey);

// token is Uint8Array(128)
```

### Decoding Tokens

```typescript
import { decodeDelegateToken } from '@casfa/delegate-token';

const decoded = decodeDelegateToken(tokenBytes);
if (decoded) {
  console.log(decoded.issuerId);
  console.log(decoded.subjectId);
  console.log(decoded.flags);
  console.log(decoded.depth);
}
```

### Token ID

```typescript
import {
  computeTokenId,
  formatTokenId,
  parseTokenId,
  isValidTokenIdFormat,
} from '@casfa/delegate-token';

// Compute token ID from bytes
const tokenId = computeTokenId(tokenBytes);

// Format as string
const idString = formatTokenId(tokenId);
// Returns: "dtkn:{base32-encoded-id}"

// Parse token ID string
const parsed = parseTokenId(idString);
// Returns: Uint8Array or null

// Validate format
const isValid = isValidTokenIdFormat(idString);
```

### Validation

```typescript
import { validateToken, validateTokenBytes } from '@casfa/delegate-token';

// Validate decoded token
const result = validateToken(decodedToken, {
  now: Date.now(),
  verifySignature: true,
  parentToken: parentTokenBytes,
});

if (result.valid) {
  // Token is valid
} else {
  console.error(result.errors);
}

// Validate raw bytes
const bytesResult = validateTokenBytes(tokenBytes);
```

## API Reference

### Constants

- `DELEGATE_TOKEN_SIZE` - Token size in bytes (128)
- `MAGIC_NUMBER` - Magic bytes for format identification
- `FLAGS` - Flag bit definitions
- `MAX_DEPTH` - Maximum delegation depth
- `TOKEN_ID_PREFIX` - Token ID prefix ("dtkn:")

### Types

```typescript
interface DelegateToken {
  issuerId: Uint8Array;      // 16 bytes
  subjectId: Uint8Array;     // 16 bytes
  resourceId: Uint8Array;    // 16 bytes
  issuedAt: number;          // Unix timestamp (ms)
  expiresAt: number;         // Unix timestamp (ms)
  flags: DelegateTokenFlags;
  depth: number;             // 0-255
  parentHash: Uint8Array;    // 16 bytes
  signature: Uint8Array;     // 32 bytes
}

interface DelegateTokenFlags {
  canDelegate: boolean;
  canRead: boolean;
  canWrite: boolean;
}

interface DelegateTokenInput {
  issuerId: Uint8Array;
  subjectId: Uint8Array;
  resourceId: Uint8Array;
  issuedAt: number;
  expiresAt: number;
  flags: DelegateTokenFlags;
  depth: number;
  parentHash: Uint8Array;
}

type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };
```

### Functions

- `encodeDelegateToken(input, key)` - Encode and sign token
- `decodeDelegateToken(bytes)` - Decode token bytes
- `computeTokenId(bytes)` - Compute token ID hash
- `formatTokenId(id)` - Format ID as string
- `parseTokenId(str)` - Parse ID string
- `isValidTokenIdFormat(str)` - Validate ID format
- `validateToken(token, options)` - Validate decoded token
- `validateTokenBytes(bytes)` - Validate token bytes

## License

MIT
