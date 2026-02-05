# @casfa/storage-fs

File system storage provider for CAS.

## Installation

```bash
bun add @casfa/storage-fs
```

## Overview

A file system-backed storage provider for CAS (Content-Addressable Storage). Stores content in a sharded directory structure for efficient file system performance.

### Storage Structure

```
{basePath}/
├── ab/
│   └── cd/
│       └── abcd1234...  (full hash)
├── ef/
│   └── 01/
│       └── ef012345...
└── ...
```

## Usage

### Basic Usage

```typescript
import { createFsStorage } from '@casfa/storage-fs';

const storage = createFsStorage({
  basePath: '/var/cas/data',
});

// Store data
await storage.put('node:abcd1234...', data);

// Retrieve data
const data = await storage.get('node:abcd1234...');

// Check existence
const exists = await storage.has('node:abcd1234...');

// Delete
const deleted = await storage.delete('node:abcd1234...');
```

### With LRU Cache

```typescript
import { createFsStorageWithCache } from '@casfa/storage-fs';

const storage = createFsStorageWithCache({
  basePath: '/var/cas/data',
  cacheSize: 1000,      // Max items in cache
  cacheMaxAge: 60000,   // TTL in milliseconds
});

// Cache is automatically managed
const data = await storage.get('node:abcd1234...');  // May hit cache
```

## Configuration

```typescript
interface FsStorageConfig {
  // Required: Base directory for storage
  basePath: string;
  
  // Optional: File permissions (default: 0o644)
  fileMode?: number;
  
  // Optional: Directory permissions (default: 0o755)
  dirMode?: number;
}
```

### Cache Options

```typescript
interface FsStorageWithCacheConfig extends FsStorageConfig {
  // Max items in LRU cache (default: 1000)
  cacheSize?: number;
  
  // Cache TTL in milliseconds (default: 60000)
  cacheMaxAge?: number;
}
```

## API Reference

### Functions

- `createFsStorage(config)` - Create storage without cache
- `createFsStorageWithCache(config)` - Create storage with LRU cache

### StorageProvider Interface

```typescript
interface StorageProvider {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
}
```

## Performance Tips

1. **Use caching** for read-heavy workloads
2. **Use SSD storage** for better random access performance
3. **Monitor disk space** as CAS data is append-only by nature
4. Consider **separate partitions** for CAS data to prevent filling system disk

## Related Packages

- `@casfa/storage-core` - Core types and utilities
- `@casfa/storage-memory` - In-memory storage (for testing)
- `@casfa/storage-s3` - S3 storage (for cloud deployment)

## License

MIT
