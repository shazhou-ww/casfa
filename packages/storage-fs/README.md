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

## API Reference

### Functions

- `createFsStorage(config)` - Create file-system storage

### StorageProvider Interface

```typescript
interface StorageProvider {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
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
