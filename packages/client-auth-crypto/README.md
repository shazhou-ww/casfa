# @casfa/client-auth-crypto

Client authentication cryptography for CASFA.

## Installation

```bash
bun add @casfa/client-auth-crypto
```

## Overview

This package implements cryptographic utilities for CASFA client authentication:
- **PKCE** (Proof Key for Code Exchange) for OAuth flows
- **Client Secret** generation and validation
- **Display Codes** for user-friendly secret verification
- **Token Encryption** using AES-GCM

## Usage

### PKCE (OAuth 2.0 Code Exchange)

```typescript
import {
  generatePkceChallenge,
  verifyPkceChallenge,
} from '@casfa/client-auth-crypto';

// Generate PKCE challenge for authorization request
const pkce = await generatePkceChallenge();
console.log(pkce.verifier);   // Random verifier (stored client-side)
console.log(pkce.challenge);  // SHA256 hash (sent to server)
console.log(pkce.method);     // 'S256'

// Server-side verification
const isValid = await verifyPkceChallenge(
  receivedVerifier,
  storedChallenge,
  'S256'
);
```

### Client Secret

```typescript
import {
  generateClientSecret,
  parseClientSecret,
  generateDisplayCode,
  verifyDisplayCode,
} from '@casfa/client-auth-crypto';

// Generate a new client secret
const secret = generateClientSecret();
// Format: {version}.{random-bytes-base64url}

// Parse and validate format
const parsed = parseClientSecret(secret);
if (parsed) {
  console.log(parsed.version);  // 1
  console.log(parsed.bytes);    // Uint8Array
}

// Generate display code for user verification
const displayCode = generateDisplayCode(secret);
// Returns a short, human-readable code

// Verify display code matches secret
const matches = verifyDisplayCode(secret, userInputCode);
```

### Token Encryption

```typescript
import {
  encryptToken,
  decryptToken,
  deriveKey,
  formatEncryptedToken,
  parseEncryptedToken,
} from '@casfa/client-auth-crypto';

// Derive encryption key from secret
const key = await deriveKey(clientSecret, salt);

// Encrypt a token
const encrypted = await encryptToken(tokenString, key);
const formatted = formatEncryptedToken(encrypted);
// Format: {nonce-base64url}.{ciphertext-base64url}

// Decrypt a token
const parsed = parseEncryptedToken(formatted);
const decrypted = await decryptToken(parsed, key);
```

### Low-level AES-GCM

```typescript
import { encryptAesGcm, decryptAesGcm } from '@casfa/client-auth-crypto';

// Encrypt data
const { nonce, ciphertext } = await encryptAesGcm(plaintext, key);

// Decrypt data
const plaintext = await decryptAesGcm(ciphertext, key, nonce);
```

## API Reference

### Types

- `PkceChallenge` - PKCE verifier and challenge pair
- `ClientSecret` - Parsed client secret structure
- `DisplayCode` - Human-readable verification code
- `EncryptedToken` - Encrypted token with nonce

### PKCE Functions

- `generatePkceChallenge()` - Generate PKCE challenge
- `generateCodeVerifier()` - Generate random verifier
- `generateCodeChallenge(verifier)` - Hash verifier to challenge
- `verifyPkceChallenge(verifier, challenge, method)` - Verify PKCE

### Client Secret Functions

- `generateClientSecret()` - Generate new secret
- `parseClientSecret(secret)` - Parse secret string
- `generateDisplayCode(secret)` - Create display code
- `verifyDisplayCode(secret, code)` - Verify display code

### Encryption Functions

- `deriveKey(secret, salt)` - Derive AES key
- `encryptToken(token, key)` - Encrypt token
- `decryptToken(encrypted, key)` - Decrypt token
- `encryptAesGcm(plaintext, key)` - Low-level encrypt
- `decryptAesGcm(ciphertext, key, nonce)` - Low-level decrypt

## License

MIT
