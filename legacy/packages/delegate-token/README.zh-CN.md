# @casfa/delegate-token

CASFA 授权系统的委托令牌编解码库。

## 安装

```bash
bun add @casfa/delegate-token
```

## 概述

本包实现了 CASFA 授权系统中委托令牌的 128 字节二进制格式。委托令牌支持层级化的权限委托，并提供加密链验证。

### 令牌结构

```
+-------------------------------------------------------------+
|                    DELEGATE TOKEN (128 bytes)                |
+--------------------------------------------------------------+
| Magic (4)     | Version (1) | Flags (1) | Depth (1) | Res (1)|
+--------------------------------------------------------------+
| Issued At (8)            | Expires At (8)                    |
+--------------------------------------------------------------+
| Issuer ID (16)                                               |
+--------------------------------------------------------------+
| Subject ID (16)                                              |
+--------------------------------------------------------------+
| Resource ID (16)                                             |
+--------------------------------------------------------------+
| Parent Hash (16)                                             |
+--------------------------------------------------------------+
| Signature (32)                                               |
+--------------------------------------------------------------+
```

## 使用方法

### 编码令牌

```typescript
import { encodeDelegateToken } from '@casfa/delegate-token';

const token = encodeDelegateToken({
  issuerId: new Uint8Array(16),   // 128 位签发者 ID
  subjectId: new Uint8Array(16),  // 128 位主体 ID
  resourceId: new Uint8Array(16), // 128 位资源 ID
  issuedAt: Date.now(),
  expiresAt: Date.now() + 3600000,
  flags: {
    canDelegate: true,
    canRead: true,
    canWrite: false,
  },
  depth: 1,
  parentHash: new Uint8Array(16), // 父令牌哈希（根令牌为全零）
}, signingKey);

// token 为 Uint8Array(128)
```

### 解码令牌

```typescript
import { decodeDelegateToken } from '@casfa/delegate-token';

const decoded = decodeDelegateToken(tokenBytes);
if (decoded) {
  console.log(decoded.issuerId);
  console.log(decoded.subjectId);
  console.log(decoded.flags);
  console.log(decoded.depth);
}
```

### 令牌 ID

```typescript
import {
  computeTokenId,
  formatTokenId,
  parseTokenId,
  isValidTokenIdFormat,
} from '@casfa/delegate-token';

// 从字节计算令牌 ID
const tokenId = computeTokenId(tokenBytes);

// 格式化为字符串
const idString = formatTokenId(tokenId);
// 返回: "dtkn:{base32-encoded-id}"

// 解析令牌 ID 字符串
const parsed = parseTokenId(idString);
// 返回: Uint8Array 或 null

// 校验格式
const isValid = isValidTokenIdFormat(idString);
```

### 校验

```typescript
import { validateToken, validateTokenBytes } from '@casfa/delegate-token';

// 校验已解码的令牌
const result = validateToken(decodedToken, {
  now: Date.now(),
  verifySignature: true,
  parentToken: parentTokenBytes,
});

if (result.valid) {
  // 令牌有效
} else {
  console.error(result.errors);
}

// 校验原始字节
const bytesResult = validateTokenBytes(tokenBytes);
```

## API 参考

### 常量

- `DELEGATE_TOKEN_SIZE` - 令牌字节大小（128）
- `MAGIC_NUMBER` - 格式标识魔数
- `FLAGS` - 标志位定义
- `MAX_DEPTH` - 最大委托深度
- `TOKEN_ID_PREFIX` - 令牌 ID 前缀（"dtkn:"）

### 类型

```typescript
interface DelegateToken {
  issuerId: Uint8Array;      // 16 bytes
  subjectId: Uint8Array;     // 16 bytes
  resourceId: Uint8Array;    // 16 bytes
  issuedAt: number;          // Unix 时间戳 (ms)
  expiresAt: number;         // Unix 时间戳 (ms)
  flags: DelegateTokenFlags;
  depth: number;             // 0-255
  parentHash: Uint8Array;    // 16 bytes
  signature: Uint8Array;     // 32 bytes
}

interface DelegateTokenFlags {
  canDelegate: boolean;
  canRead: boolean;
  canWrite: boolean;
}

interface DelegateTokenInput {
  issuerId: Uint8Array;
  subjectId: Uint8Array;
  resourceId: Uint8Array;
  issuedAt: number;
  expiresAt: number;
  flags: DelegateTokenFlags;
  depth: number;
  parentHash: Uint8Array;
}

type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };
```

### 函数

- `encodeDelegateToken(input, key)` - 编码并签名令牌
- `decodeDelegateToken(bytes)` - 解码令牌字节
- `computeTokenId(bytes)` - 计算令牌 ID 哈希
- `formatTokenId(id)` - 格式化 ID 为字符串
- `parseTokenId(str)` - 解析 ID 字符串
- `isValidTokenIdFormat(str)` - 校验 ID 格式
- `validateToken(token, options)` - 校验已解码的令牌
- `validateTokenBytes(bytes)` - 校验令牌字节

## 许可证

MIT
