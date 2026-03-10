# @casfa/client-auth-crypto

CASFA 客户端认证加密工具库。

## 安装

```bash
bun add @casfa/client-auth-crypto
```

## 概述

本包实现了 CASFA 客户端认证所需的加密工具：
- **PKCE**（Proof Key for Code Exchange）用于 OAuth 流程
- **客户端密钥** 生成与校验
- **显示码** 用于用户友好的密钥验证
- **令牌加密** 使用 AES-GCM

## 使用方法

### PKCE（OAuth 2.0 授权码交换）

```typescript
import {
  generatePkceChallenge,
  verifyPkceChallenge,
} from '@casfa/client-auth-crypto';

// 为授权请求生成 PKCE 挑战
const pkce = await generatePkceChallenge();
console.log(pkce.verifier);   // 随机验证码（客户端存储）
console.log(pkce.challenge);  // SHA256 哈希（发送到服务端）
console.log(pkce.method);     // 'S256'

// 服务端验证
const isValid = await verifyPkceChallenge(
  receivedVerifier,
  storedChallenge,
  'S256'
);
```

### 客户端密钥

```typescript
import {
  generateClientSecret,
  parseClientSecret,
  generateDisplayCode,
  verifyDisplayCode,
} from '@casfa/client-auth-crypto';

// 生成新的客户端密钥
const secret = generateClientSecret();
// 格式: {version}.{random-bytes-base64url}

// 解析并校验格式
const parsed = parseClientSecret(secret);
if (parsed) {
  console.log(parsed.version);  // 1
  console.log(parsed.bytes);    // Uint8Array
}

// 生成显示码供用户验证
const displayCode = generateDisplayCode(secret);
// 返回简短的、人类可读的验证码

// 验证显示码是否匹配密钥
const matches = verifyDisplayCode(secret, userInputCode);
```

### 令牌加密

```typescript
import {
  encryptToken,
  decryptToken,
  deriveKey,
  formatEncryptedToken,
  parseEncryptedToken,
} from '@casfa/client-auth-crypto';

// 从密钥派生加密密钥
const key = await deriveKey(clientSecret, salt);

// 加密令牌
const encrypted = await encryptToken(tokenString, key);
const formatted = formatEncryptedToken(encrypted);
// 格式: {nonce-base64url}.{ciphertext-base64url}

// 解密令牌
const parsed = parseEncryptedToken(formatted);
const decrypted = await decryptToken(parsed, key);
```

### 底层 AES-GCM

```typescript
import { encryptAesGcm, decryptAesGcm } from '@casfa/client-auth-crypto';

// 加密数据
const { nonce, ciphertext } = await encryptAesGcm(plaintext, key);

// 解密数据
const plaintext = await decryptAesGcm(ciphertext, key, nonce);
```

## API 参考

### 类型

- `PkceChallenge` - PKCE 验证码和挑战对
- `ClientSecret` - 解析后的客户端密钥结构
- `DisplayCode` - 人类可读的验证码
- `EncryptedToken` - 带 nonce 的加密令牌

### PKCE 函数

- `generatePkceChallenge()` - 生成 PKCE 挑战
- `generateCodeVerifier()` - 生成随机验证码
- `generateCodeChallenge(verifier)` - 将验证码哈希为挑战值
- `verifyPkceChallenge(verifier, challenge, method)` - 验证 PKCE

### 客户端密钥函数

- `generateClientSecret()` - 生成新密钥
- `parseClientSecret(secret)` - 解析密钥字符串
- `generateDisplayCode(secret)` - 创建显示码
- `verifyDisplayCode(secret, code)` - 验证显示码

### 加密函数

- `deriveKey(secret, salt)` - 派生 AES 密钥
- `encryptToken(token, key)` - 加密令牌
- `decryptToken(encrypted, key)` - 解密令牌
- `encryptAesGcm(plaintext, key)` - 底层加密
- `decryptAesGcm(ciphertext, key, nonce)` - 底层解密

## 许可证

MIT
