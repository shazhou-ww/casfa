# @casfa/storage-s3

S3 storage provider for CAS.

## Installation

```bash
bun add @casfa/storage-s3
```

## Overview

An S3-backed storage provider for CAS (Content-Addressable Storage). Suitable for cloud deployments with high availability and durability requirements.

## Usage

### Basic Usage

```typescript
import { createS3Storage } from '@casfa/storage-s3';

const storage = createS3Storage({
  bucket: 'my-cas-bucket',
  region: 'us-east-1',
  prefix: 'cas/',  // Optional key prefix
});

// Store data
await storage.put('node:abcd1234...', data);

// Retrieve data
const data = await storage.get('node:abcd1234...');
```

### With Custom S3 Client

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

## Configuration

```typescript
interface S3StorageConfig {
  // Required: S3 bucket name
  bucket: string;
  
  // AWS region (required if not using custom client)
  region?: string;
  
  // Optional: Key prefix for all objects
  prefix?: string;
  
  // Optional: Custom S3 client
  client?: S3Client;
  
  // Optional: Storage class for new objects
  storageClass?: 'STANDARD' | 'STANDARD_IA' | 'GLACIER' | 'DEEP_ARCHIVE';
}
```

## S3 Key Structure

Objects are stored with sharded prefixes for better S3 performance:

```
{prefix}ab/cd/abcd1234...
```

Where `ab` and `cd` are the first 4 characters of the hash, providing good distribution across S3 partitions.

## API Reference

### Functions

- `createS3Storage(config)` - Create S3 storage

### StorageProvider Interface

```typescript
interface StorageProvider {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
}
```

## AWS Permissions

Required IAM permissions for the S3 bucket:

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

## Performance Tips

1. **Use caching** to reduce S3 API calls and latency
2. **Use S3 Transfer Acceleration** for global access
3. **Choose appropriate storage class** based on access patterns
4. **Enable S3 Intelligent-Tiering** for cost optimization
5. **Use regional endpoints** to minimize latency

## Cost Considerations

- CAS data is immutable, so versioning is not needed
- Consider S3 Intelligent-Tiering for infrequently accessed data
- Monitor PUT/GET request costs for high-throughput workloads

## Related Packages

- `@casfa/storage-core` - Core types and utilities
- `@casfa/storage-fs` - File system storage (for local deployment)
- `@casfa/storage-memory` - In-memory storage (for testing)

## License

MIT
