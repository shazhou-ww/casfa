# @casfa/storage-memory

基于内存的 CAS 存储提供者。

## 安装

```bash
bun add @casfa/storage-memory
```

## 概述

基于内存的 CAS（内容寻址存储）存储提供者。适用于测试、开发和临时存储场景。

> ⚠️ **警告**：数据不会持久化，进程退出后将丢失。仅用于测试和开发。

## 使用方法

### 基本用法

```typescript
import { createMemoryStorage } from '@casfa/storage-memory';

const storage = createMemoryStorage();

// 存储数据
await storage.put('node:abcd1234...', data);

// 检索数据
const data = await storage.get('node:abcd1234...');

// 检查是否存在
const exists = await storage.has('node:abcd1234...');

// 删除
const deleted = await storage.delete('node:abcd1234...');
```

### 带检查功能（测试用）

```typescript
import { createMemoryStorageWithInspection } from '@casfa/storage-memory';

const { storage, inspect } = createMemoryStorageWithInspection();

// 正常使用存储
await storage.put('node:abcd1234...', data);

// 检查内部状态（测试时很有用）
console.log(inspect.size());       // 条目数量
console.log(inspect.keys());       // 所有已存储的键
console.log(inspect.totalBytes()); // 已存储的总字节数
inspect.clear();                   // 清除所有数据
```

### 设置大小限制

```typescript
import { createMemoryStorage } from '@casfa/storage-memory';

const storage = createMemoryStorage({
  maxSize: 100 * 1024 * 1024,  // 100MB 限制
});
```

## 配置

```typescript
interface MemoryStorageConfig {
  // 可选：最大存储字节数
  // 超出时可能淘汰最旧的条目
  maxSize?: number;
  
  // 可选：最大条目数
  maxItems?: number;
}
```

## API 参考

### 函数

- `createMemoryStorage(config?)` - 创建基本内存存储
- `createMemoryStorageWithInspection(config?)` - 创建带检查工具的存储

### StorageProvider 接口

```typescript
interface StorageProvider {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
}
```

### Inspection 接口

```typescript
interface StorageInspection {
  size(): number;           // 条目数量
  keys(): string[];         // 所有键
  totalBytes(): number;     // 已使用的总存储量
  clear(): void;            // 清除所有数据
}
```

## 使用场景

- **单元测试**：快速、隔离的测试存储
- **集成测试**：可预测的存储行为
- **开发环境**：无需文件系统即可快速迭代
- **缓存层**：与持久化存储组合使用

## 示例：测试

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

## 相关包

- `@casfa/storage-core` - 核心类型与工具
- `@casfa/storage-fs` - 文件系统存储（用于生产环境）
- `@casfa/storage-s3` - S3 存储（用于云端部署）

## 许可证

MIT
