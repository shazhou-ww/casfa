# @casfa/storage-memory

In-memory storage provider for CAS.

## Installation

```bash
bun add @casfa/storage-memory
```

## Overview

An in-memory storage provider for CAS (Content-Addressable Storage). Ideal for testing, development, and temporary storage needs.

> ⚠️ **Warning**: Data is not persisted and will be lost when the process exits. Use only for testing and development.

## Usage

### Basic Usage

```typescript
import { createMemoryStorage } from '@casfa/storage-memory';

const storage = createMemoryStorage();

// Store data
await storage.put('node:abcd1234...', data);

// Retrieve data
const data = await storage.get('node:abcd1234...');
```

### With Inspection (Testing)

```typescript
import { createMemoryStorageWithInspection } from '@casfa/storage-memory';

const { storage, inspect } = createMemoryStorageWithInspection();

// Use storage normally
await storage.put('node:abcd1234...', data);

// Inspect internal state (useful for tests)
console.log(inspect.size());       // Number of items
console.log(inspect.keys());       // All stored keys
console.log(inspect.totalBytes()); // Total bytes stored
inspect.clear();                   // Clear all data
```

### With Size Limit

```typescript
import { createMemoryStorage } from '@casfa/storage-memory';

const storage = createMemoryStorage({
  maxSize: 100 * 1024 * 1024,  // 100MB limit
});
```

## Configuration

```typescript
interface MemoryStorageConfig {
  // Optional: Maximum storage size in bytes
  // When exceeded, oldest items may be evicted
  maxSize?: number;
  
  // Optional: Maximum number of items
  maxItems?: number;
}
```

## API Reference

### Functions

- `createMemoryStorage(config?)` - Create basic memory storage
- `createMemoryStorageWithInspection(config?)` - Create storage with inspection utilities

### StorageProvider Interface

```typescript
interface StorageProvider {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
}
```

### Inspection Interface

```typescript
interface StorageInspection {
  size(): number;           // Number of items
  keys(): string[];         // All keys
  totalBytes(): number;     // Total storage used
  clear(): void;            // Clear all data
}
```

## Use Cases

- **Unit Testing**: Fast, isolated storage for tests
- **Integration Testing**: Predictable storage behavior
- **Development**: Quick iteration without file system overhead
- **Caching Layer**: Combine with persistent storage

## Example: Testing

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { createMemoryStorageWithInspection } from '@casfa/storage-memory';

describe('MyService', () => {
  let storage: StorageProvider;
  let inspect: StorageInspection;

  beforeEach(() => {
    const result = createMemoryStorageWithInspection();
    storage = result.storage;
    inspect = result.inspect;
  });

  it('should store data', async () => {
    const service = new MyService(storage);
    await service.saveData('test');
    
    expect(inspect.size()).toBe(1);
  });
});
```

## Related Packages

- `@casfa/storage-core` - Core types and utilities
- `@casfa/storage-fs` - File system storage (for production)
- `@casfa/storage-s3` - S3 storage (for cloud deployment)

## License

MIT
