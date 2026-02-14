# @casfa/storage-fs

基于文件系统的 CAS 存储提供者。

## 安装

```bash
bun add @casfa/storage-fs
```

## 概述

基于文件系统的 CAS（内容寻址存储）存储提供者。采用分片目录结构存储内容，以获得更好的文件系统性能。

### 存储结构

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

## 使用方法

### 基本用法

```typescript
import { createFsStorage } from '@casfa/storage-fs';

const storage = createFsStorage({
  basePath: '/var/cas/data',
});

// 存储数据
await storage.put('node:abcd1234...', data);

// 检索数据
const data = await storage.get('node:abcd1234...');
```

## 配置

```typescript
interface FsStorageConfig {
  // 必需：存储基础目录
  basePath: string;
  
  // 可选：文件权限（默认: 0o644）
  fileMode?: number;
  
  // 可选：目录权限（默认: 0o755）
  dirMode?: number;
}
```

## API 参考

### 函数

- `createFsStorage(config)` - 创建文件系统存储

### StorageProvider 接口

```typescript
interface StorageProvider {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
}
```

## 性能建议

1. **使用缓存** 以应对读密集型工作负载
2. **使用 SSD 存储** 以获得更好的随机访问性能
3. **监控磁盘空间**，因为 CAS 数据本质上是只追加的
4. 考虑为 CAS 数据使用**独立分区**，防止占满系统磁盘

## 相关包

- `@casfa/storage-core` - 核心类型与工具
- `@casfa/storage-memory` - 内存存储（用于测试）
- `@casfa/storage-s3` - S3 存储（用于云端部署）

## 许可证

MIT
