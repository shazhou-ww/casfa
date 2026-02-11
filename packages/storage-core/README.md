# @casfa/storage-core

Core types and utilities for CAS storage providers.

## Installation

```bash
bun add @casfa/storage-core
```

## Overview

This package provides the foundational types and utilities for implementing CAS (Content-Addressable Storage) providers. It defines the `StorageProvider` interface and common utilities used by all storage backends.

## Usage

### Key Utilities

```typescript
import {
  toKey,
  isValidKey,
  toStoragePath,
  extractHash,
  bytesToHex,
  hexToBytes,
} from '@casfa/storage-core';

// Convert hash bytes to storage key
const key = toKey(hashBytes);  // "node:{hex-hash}"

// Validate key format
const valid = isValidKey(key);  // true/false

// Get storage path for sharding
const path = toStoragePath(key);  // "ab/cd/abcd1234..."

// Extract hash from key
const hash = extractHash(key);  // Uint8Array

// Hex conversion utilities
const hex = bytesToHex(bytes);
const bytes = hexToBytes(hex);
```

### LRU Cache

```typescript
import { createLRUCache, DEFAULT_CACHE_SIZE } from '@casfa/storage-core';

// Create cache with custom size
const cache = createLRUCache<Uint8Array>({
  maxSize: 1000,
  maxAge: 60000,  // 1 minute TTL
});

// Use cache
cache.set('key', data);
const value = cache.get('key');
cache.delete('key');
cache.clear();
```

### Implementing a Storage Provider

```typescript
import type { StorageProvider, StorageConfig } from '@casfa/storage-core';

class MyStorage implements StorageProvider {
  async get(key: string): Promise<Uint8Array | null> {
    // Retrieve data by key
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    // Store data
  }

  async has(key: string): Promise<boolean> {
    // Check if key exists
  }

  async delete(key: string): Promise<boolean> {
    // Delete data, return true if existed
  }
}
```

## API Reference

### Types

```typescript
interface StorageProvider {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
}

interface StorageConfig {
  // Base configuration for storage providers
}

interface KeyProvider {
  computeKey(data: Uint8Array): Promise<Uint8Array>;
}

interface LRUCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  size: number;
}
```

### Key Functions

- `toKey(hash)` - Convert hash bytes to key string
- `isValidKey(key)` - Validate key format
- `toStoragePath(key)` - Get sharded storage path
- `extractHash(key)` - Extract hash bytes from key
- `bytesToHex(bytes)` - Convert bytes to hex string
- `hexToBytes(hex)` - Convert hex string to bytes

### Cache Functions

- `createLRUCache(options)` - Create LRU cache instance
- `DEFAULT_CACHE_SIZE` - Default cache size constant

## Related Packages

- `@casfa/storage-fs` - File system storage provider
- `@casfa/storage-memory` - In-memory storage provider
- `@casfa/storage-s3` - S3 storage provider

## License

MIT
