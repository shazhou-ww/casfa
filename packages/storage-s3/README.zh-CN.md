# @casfa/storage-s3

基于 S3 的 CAS 存储提供者。

## 安装

```bash
bun add @casfa/storage-s3
```

## 概述

基于 S3 的 CAS（内容寻址存储）存储提供者。适用于对高可用性和数据持久性有要求的云端部署。

## 使用方法

### 基本用法

```typescript
import { createS3Storage } from '@casfa/storage-s3';

const storage = createS3Storage({
  bucket: 'my-cas-bucket',
  region: 'us-east-1',
  prefix: 'cas/',  // 可选的键前缀
});

// 存储数据
await storage.put('node:abcd1234...', data);

// 检索数据
const data = await storage.get('node:abcd1234...');
```

### 使用自定义 S3 客户端

```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { createS3Storage } from '@casfa/storage-s3';

const s3Client = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'AKIA...',
    secretAccessKey: '...',
  },
});

const storage = createS3Storage({
  bucket: 'my-cas-bucket',
  client: s3Client,
});
```

## 配置

```typescript
interface S3StorageConfig {
  // 必需：S3 桶名称
  bucket: string;
  
  // AWS 区域（不使用自定义客户端时必需）
  region?: string;
  
  // 可选：所有对象的键前缀
  prefix?: string;
  
  // 可选：自定义 S3 客户端
  client?: S3Client;
  
  // 可选：新对象的存储类别
  storageClass?: 'STANDARD' | 'STANDARD_IA' | 'GLACIER' | 'DEEP_ARCHIVE';
}
```

### 缓存选项

```typescript
interface S3StorageWithCacheConfig extends S3StorageConfig {
  // LRU 缓存最大条目数（默认: 1000）
  cacheSize?: number;
  
  // 缓存 TTL，单位毫秒（默认: 60000）
  cacheMaxAge?: number;
}
```

## S3 键结构

对象使用分片前缀存储，以获得更好的 S3 性能：

```
{prefix}ab/cd/abcd1234...
```

其中 `ab` 和 `cd` 是哈希的前 4 个字符，可在 S3 分区间提供良好的分布。

## API 参考

### 函数

- `createS3Storage(config)` - 创建 S3 存储

### StorageProvider 接口

```typescript
interface StorageProvider {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
}
```

## AWS 权限

S3 桶所需的 IAM 权限：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:HeadObject"
      ],
      "Resource": "arn:aws:s3:::my-cas-bucket/*"
    }
  ]
}
```

## 性能建议

1. **使用缓存** 以减少 S3 API 调用和延迟
2. **使用 S3 Transfer Acceleration** 以实现全球访问
3. **根据访问模式选择合适的存储类别**
4. **启用 S3 Intelligent-Tiering** 以优化成本
5. **使用区域端点** 以最小化延迟

## 成本考虑

- CAS 数据是不可变的，因此不需要版本控制
- 对于不常访问的数据，考虑使用 S3 Intelligent-Tiering
- 对于高吞吐量工作负载，注意监控 PUT/GET 请求费用

## 相关包

- `@casfa/storage-core` - 核心类型与工具
- `@casfa/storage-fs` - 文件系统存储（用于本地部署）
- `@casfa/storage-memory` - 内存存储（用于测试）

## 许可证

MIT
