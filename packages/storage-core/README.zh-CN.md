# @casfa/storage-core

CAS 存储提供者的核心类型与工具。

## 安装

```bash
bun add @casfa/storage-core
```

## 概述

本包为实现 CAS（内容寻址存储）提供者提供基础类型和工具。定义了 `StorageProvider` 接口以及所有存储后端共用的通用工具函数。

## 使用方法

### Key 工具

```typescript
import {
  toKey,
  isValidKey,
  toStoragePath,
  extractHash,
  bytesToHex,
  hexToBytes,
} from '@casfa/storage-core';

// 将哈希字节转换为存储键
const key = toKey(hashBytes);  // "node:{hex-hash}"

// 校验键格式
const valid = isValidKey(key);  // true/false

// 获取分片存储路径
const path = toStoragePath(key);  // "ab/cd/abcd1234..."

// 从键中提取哈希
const hash = extractHash(key);  // Uint8Array

// 十六进制转换工具
const hex = bytesToHex(bytes);
const bytes = hexToBytes(hex);
```

### LRU 缓存

```typescript
import { createLRUCache, DEFAULT_CACHE_SIZE } from '@casfa/storage-core';

// 创建自定义大小的缓存
const cache = createLRUCache<Uint8Array>({
  maxSize: 1000,
  maxAge: 60000,  // 1 分钟 TTL
});

// 使用缓存
cache.set('key', data);
const value = cache.get('key');
cache.delete('key');
cache.clear();
```

### 实现存储提供者

```typescript
import type { StorageProvider, StorageConfig } from '@casfa/storage-core';

class MyStorage implements StorageProvider {
  async get(key: string): Promise<Uint8Array | null> {
    // 按键检索数据
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    // 存储数据
  }

  async has(key: string): Promise<boolean> {
    // 检查键是否存在
  }

  async delete(key: string): Promise<boolean> {
    // 删除数据，如果存在则返回 true
  }
}
```

## API 参考

### 类型

```typescript
interface StorageProvider {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
}

interface StorageConfig {
  // 存储提供者的基础配置
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

### Key 函数

- `toKey(hash)` - 将哈希字节转换为键字符串
- `isValidKey(key)` - 校验键格式
- `toStoragePath(key)` - 获取分片存储路径
- `extractHash(key)` - 从键中提取哈希字节
- `bytesToHex(bytes)` - 字节转十六进制字符串
- `hexToBytes(hex)` - 十六进制字符串转字节

### 缓存函数

- `createLRUCache(options)` - 创建 LRU 缓存实例
- `DEFAULT_CACHE_SIZE` - 默认缓存大小常量

## 相关包

- `@casfa/storage-fs` - 文件系统存储提供者
- `@casfa/storage-memory` - 内存存储提供者
- `@casfa/storage-s3` - S3 存储提供者

## 许可证

MIT
