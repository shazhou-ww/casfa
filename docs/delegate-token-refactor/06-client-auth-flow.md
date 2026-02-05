# 客户端授权申请流程

> 版本: 1.0  
> 日期: 2026-02-05

---

## 目录

1. [概述](#1-概述)
2. [流程设计](#2-流程设计)
3. [API 定义](#3-api-定义)
4. [安全考量](#4-安全考量)
5. [数据模型](#5-数据模型)

---

## 1. 概述

### 1.1 设计目标

客户端授权申请流程允许桌面/CLI 应用向用户申请 Delegate Token，无需用户手动复制粘贴 Token。

**核心特点**：
- 客户端主动发起申请，生成授权链接引导用户审批
- 用户审批时指定 Token 权限（realm, scope, expiresIn 等）
- 客户端通过轮询获取加密的 Token
- 验证码机制防止钓鱼攻击

### 1.2 适用场景

| 场景 | 说明 |
|------|------|
| IDE 插件 | Cursor、VS Code 等编辑器插件 |
| CLI 工具 | 命令行工具的首次认证 |
| 桌面应用 | 原生桌面客户端 |

---

## 2. 流程设计

### 2.1 时序图

```
┌──────────┐                    ┌──────────┐                    ┌──────────┐
│  Client  │                    │  Server  │                    │   User   │
└────┬─────┘                    └────┬─────┘                    └────┬─────┘
     │                               │                               │
     │ 1. POST /tokens/requests      │                               │
     │    {clientName, clientSecret} │                               │
     │──────────────────────────────>│                               │
     │                               │                               │
     │ 2. {requestId, displayCode,   │                               │
     │     authorizeUrl, expiresAt}  │                               │
     │<──────────────────────────────│                               │
     │                               │                               │
     │ 3. 显示授权链接和验证码       │                               │
     │   "请打开链接并核对 ABCD-1234"│                               │
     │────────────────────────────────────────────────────────────>│
     │                               │                               │
     │                               │  4. 用户打开链接，登录并核对验证码
     │                               │<──────────────────────────────│
     │                               │                               │
     │                               │  5. 选择 realm，设置权限并批准
     │                               │     POST /tokens/requests/:id/approve
     │                               │     {realm, scope, expiresIn...}
     │                               │<──────────────────────────────│
     │                               │                               │
     │ 6. GET /tokens/requests/:id   │                               │
     │    (轮询)                     │                               │
     │──────────────────────────────>│                               │
     │                               │                               │
     │ 7. status: "approved"         │                               │
     │    encryptedToken (用 clientSecret 加密)                      │
     │<──────────────────────────────│                               │
     │                               │                               │
     │ 8. 解密 Token，保存并使用     │                               │
     │                               │                               │
```

### 2.2 状态流转

```
                ┌─────────┐
                │ pending │
                └────┬────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
         ▼           ▼           ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐
    │approved │ │rejected │ │ expired │
    └─────────┘ └─────────┘ └─────────┘
```

| 状态 | 说明 | 触发条件 |
|------|------|----------|
| `pending` | 等待用户审批 | 初始状态 |
| `approved` | 已批准 | 用户调用 approve API |
| `rejected` | 已拒绝 | 用户调用 reject API |
| `expired` | 已过期 | 超过 10 分钟未处理 |

### 2.3 验证码设计

验证码用于防止钓鱼攻击，确保用户审批的是正确的客户端请求。

**格式**：`XXXX-YYYY`（8 字符，Crockford Base32 字符集）

**Crockford Base32 字符集**：`0123456789ABCDEFGHJKMNPQRSTVWXYZ`（排除 I, L, O, U 避免混淆）

**显示要求**：
- 客户端必须清晰展示验证码和授权链接
- Web 端审批时显示验证码供核对
- 建议使用大字体、高对比度

**示例**：
```
╔════════════════════════════════════════╗
║                                        ║
║  请打开以下链接完成授权                ║
║                                        ║
║  https://casfa.app/authorize/req_xxxxx ║
║                                        ║
║  验证码: ABCD-1234                     ║
║  请核对验证码后批准此请求              ║
║                                        ║
╚════════════════════════════════════════╝
```

---

## 3. API 定义

### 3.1 发起授权申请

#### POST /api/tokens/requests

客户端发起 Token 授权申请。

**认证**：无（公开端点）

**请求**：
```json
{
  "clientName": "Cursor IDE",
  "description": "AI 编程助手",
  "clientSecret": "base64_encoded_128_bit_random"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `clientName` | `string` | 是 | 客户端名称（1-64 字符） |
| `description` | `string` | 否 | 客户端描述（最多 256 字符） |
| `clientSecret` | `string` | 是 | 客户端生成的 128 位随机数（Base64 编码），用于加密返回的 Token |

**响应**：
```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "displayCode": "ABCD-1234",
  "authorizeUrl": "https://casfa.app/authorize/req_xxxxx",
  "expiresAt": 1738498200000,
  "pollInterval": 5
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `requestId` | `string` | 申请 ID，128 位随机数（Base64 编码），前缀 `req_` |
| `displayCode` | `string` | 验证码，`XXXX-YYYY` 格式（Crockford Base32） |
| `authorizeUrl` | `string` | 授权页面 URL，客户端应引导用户打开 |
| `expiresAt` | `number` | 申请过期时间（Unix 毫秒），10 分钟 |
| `pollInterval` | `number` | 建议轮询间隔（秒） |

> **安全说明**：`requestId` 使用 128 位随机数，不可枚举，只有知道 requestId 的客户端才能轮询状态。

**错误**：

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_CLIENT_NAME` | 400 | clientName 为空或过长 |
| `INVALID_CLIENT_SECRET` | 400 | clientSecret 格式无效 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |

---

### 3.2 轮询申请状态

#### GET /api/tokens/requests/:requestId

轮询授权申请状态。

**认证**：无（通过 requestId 的随机性保证安全）

**响应（等待中）**：
```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "pending",
  "clientName": "Cursor IDE",
  "displayCode": "ABCD-1234",
  "requestExpiresAt": 1738498200000
}
```

**响应（已批准）**：
```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "approved",
  "tokenId": "dlt1_4xzrt7y2m5k9bqwp3fnhjc6d",
  "encryptedToken": "base64_encrypted_token...",
  "tokenExpiresAt": 1741089600000
}
```

> **安全说明**：
> - `encryptedToken` 是使用 `clientSecret` 加密的完整 Token（AES-256-GCM）
> - 仅在首次轮询到 `approved` 状态时返回，后续轮询不再返回
> - 客户端需使用创建时提供的 `clientSecret` 解密

**响应（已拒绝）**：
```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "rejected"
}
```

**响应（已过期）**：
```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "expired"
}
```

**错误**：

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REQUEST_NOT_FOUND` | 404 | 申请不存在 |

---

### 3.3 查看授权申请详情（用户侧）

#### GET /api/tokens/requests/:requestId

用户通过授权链接打开页面时，获取申请详情用于展示。

**认证**：`Bearer {jwt}` (User Token)

**响应**：
```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "clientName": "Cursor IDE",
  "description": "AI 编程助手",
  "displayCode": "ABCD-1234",
  "createdAt": 1738497600000,
  "requestExpiresAt": 1738498200000,
  "status": "pending"
}
```

> **注意**：授权申请不可枚举，用户只能通过客户端提供的 `authorizeUrl` 访问特定申请。

**错误**：

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REQUEST_NOT_FOUND` | 404 | 申请不存在 |
| `REQUEST_EXPIRED` | 400 | 申请已过期 |

---

### 3.4 批准授权申请（用户侧）

#### POST /api/tokens/requests/:requestId/approve

批准授权申请并签发 Delegate Token。

**认证**：`Bearer {jwt}` (User Token)

**请求**：
```json
{
  "realm": "usr_abc123",
  "name": "Cursor IDE Token",
  "expiresIn": 2592000,
  "canUpload": true,
  "canManageDepot": true,
  "scope": ["cas://depot:MAIN"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `realm` | `string` | 是 | 授权的 Realm ID（用户可选择自己拥有的 realm） |
| `name` | `string` | 否 | Token 名称，默认使用 clientName |
| `expiresIn` | `number` | 否 | 有效期（秒），默认 30 天 |
| `canUpload` | `boolean` | 否 | 是否允许上传，默认 `false` |
| `canManageDepot` | `boolean` | 否 | 是否允许管理 Depot，默认 `false` |
| `scope` | `string[]` | 否 | 授权范围（相对于 realm），默认全部 |

> **注意**：客户端授权申请只能签发 Delegate Token（可再授权），不支持 Access Token。

**响应**：
```json
{
  "success": true,
  "tokenId": "dlt1_4xzrt7y2m5k9bqwp3fnhjc6d"
}
```

> **安全说明**：Token 不在此响应中返回，而是加密后由客户端通过轮询获取，确保 Token 只传递给发起申请的客户端。

**错误**：

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REQUEST_NOT_FOUND` | 404 | 申请不存在 |
| `REQUEST_EXPIRED` | 400 | 申请已过期 |
| `REQUEST_ALREADY_PROCESSED` | 400 | 申请已被处理 |
| `INVALID_REALM` | 400 | 无权访问指定的 Realm |

---

### 3.5 拒绝授权申请（用户侧）

#### POST /api/tokens/requests/:requestId/reject

拒绝授权申请。

**认证**：`Bearer {jwt}` (User Token)

**响应**：
```json
{
  "success": true
}
```

**错误**：

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REQUEST_NOT_FOUND` | 404 | 申请不存在 |
| `REQUEST_ALREADY_PROCESSED` | 400 | 申请已被处理 |

---

## 4. 安全考量

### 4.1 防钓鱼

**风险**：攻击者发起授权申请，诱导用户在 Web 端批准。

**缓解措施**：
1. 验证码机制：用户必须核对客户端显示的验证码与 Web 端一致
2. 显著提示：Web 端明确提示用户核对验证码
3. 短有效期：申请 10 分钟后自动过期

### 4.2 防枚举攻击

**风险**：攻击者尝试枚举 requestId 获取他人的 Token。

**缓解措施**：
1. requestId 使用 128 位随机数，碰撞概率极低
2. 授权申请不可列表查询，只能通过精确 requestId 访问
3. Token 使用 clientSecret 加密，即使获取也无法解密

### 4.3 速率限制

| 端点 | 限制 |
|------|------|
| POST /api/tokens/requests | 10 次/分钟/IP |
| GET /api/tokens/requests/:id | 60 次/分钟/IP |

### 4.4 Token 传递安全

- Token 仅通过 HTTPS 传输
- Token 使用客户端提供的 `clientSecret` 进行 AES-256-GCM 加密存储和传输
- `encryptedToken` 仅在首次轮询到 approved 状态时返回
- 服务端不存储明文 Token，只存储 Token ID (hash) 和加密后的 Token

### 4.5 申请清理

- pending 状态申请 10 分钟后自动过期
- expired/rejected 状态记录 24 小时后清理
- approved 状态记录在 Token 被获取后 1 小时清理

---

## 5. 数据模型

### 5.1 TokenRequest 记录

```typescript
interface TokenRequestRecord {
  // 主键
  pk: string;              // "TOKEN_REQUEST#{requestId}"
  sk: string;              // "META"
  
  // 基本信息
  requestId: string;       // 128 位随机数，Base64 编码，前缀 req_
  clientName: string;      // 客户端名称
  description?: string;    // 客户端描述
  displayCode: string;     // ABCD-1234 (Crockford Base32)
  clientSecretHash: string; // clientSecret 的 hash，用于验证
  
  // 状态
  status: "pending" | "approved" | "rejected" | "expired";
  
  // 关联
  userId?: string;         // 审批用户 ID（approved/rejected 时设置）
  realm?: string;          // 授权的 Realm ID（approved 时设置）
  tokenId?: string;        // 签发的 Token ID（approved 时设置）
  encryptedToken?: string; // 使用 clientSecret 加密的 Token（临时存储，客户端获取后删除）
  
  // 时间戳
  createdAt: number;
  expiresAt: number;       // 申请过期时间
  processedAt?: number;    // 处理时间
  
  // TTL
  ttl: number;             // DynamoDB TTL
}
```

### 5.2 索引设计

| 索引 | 分区键 | 排序键 | 用途 |
|------|--------|--------|------|
| 主键 | `TOKEN_REQUEST#{requestId}` | `META` | 通过 requestId 精确查询 |

> **注意**：授权申请不可枚举，无需用户列表索引。过期清理通过 DynamoDB TTL 自动处理。

### 5.3 TypeScript 类型定义

```typescript
// 创建申请请求
type CreateTokenRequestInput = {
  clientName: string;
  description?: string;
  clientSecret: string;  // 128 位随机数，Base64 编码
};

// 创建申请响应
type CreateTokenRequestOutput = {
  requestId: string;
  displayCode: string;
  authorizeUrl: string;
  expiresAt: number;
  pollInterval: number;
};

// 轮询响应（客户端侧）
type TokenRequestPollResponse = 
  | { status: "pending"; requestId: string; clientName: string; displayCode: string; requestExpiresAt: number }
  | { status: "approved"; requestId: string; tokenId: string; encryptedToken: string; tokenExpiresAt: number }
  | { status: "rejected"; requestId: string }
  | { status: "expired"; requestId: string };

// 申请详情（用户侧）
type TokenRequestDetail = {
  requestId: string;
  clientName: string;
  description?: string;
  displayCode: string;
  createdAt: number;
  requestExpiresAt: number;
  status: "pending" | "approved" | "rejected" | "expired";
};

// 审批请求
type ApproveTokenRequestInput = {
  realm: string;
  name?: string;
  expiresIn?: number;
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope?: string[];
};
```

---

## 附录 A: 客户端实现示例

### TypeScript/Node.js

```typescript
import { randomBytes, createDecipheriv } from 'crypto';

async function requestAuthorization(): Promise<string> {
  // 1. 生成 clientSecret (128 位随机数)
  const clientSecret = randomBytes(16);
  const clientSecretBase64 = clientSecret.toString('base64');
  
  // 2. 发起申请
  const initRes = await fetch("https://api.casfa.app/tokens/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientName: "My CLI Tool",
      description: "命令行工具",
      clientSecret: clientSecretBase64
    })
  });
  
  if (!initRes.ok) {
    const error = await initRes.json();
    throw new Error(`创建授权申请失败: ${error.code}`);
  }
  
  const { requestId, displayCode, authorizeUrl, expiresAt, pollInterval } = await initRes.json();
  
  // 3. 显示授权链接和验证码
  console.log(`\n请打开以下链接完成授权：`);
  console.log(`${authorizeUrl}\n`);
  console.log(`验证码: ${displayCode}`);
  console.log(`请核对验证码后批准此请求\n`);
  
  // 4. 轮询状态
  while (Date.now() < expiresAt) {
    await sleep(pollInterval * 1000);
    
    const statusRes = await fetch(`https://api.casfa.app/tokens/requests/${requestId}`);
    
    if (!statusRes.ok) {
      if (statusRes.status === 404) {
        throw new Error("授权请求不存在");
      }
      continue; // 网络错误，继续轮询
    }
    
    const status = await statusRes.json();
    
    switch (status.status) {
      case "approved":
        console.log("授权成功！");
        // 5. 解密 Token
        const tokenBase64 = decryptToken(status.encryptedToken, clientSecret);
        return tokenBase64;
      case "rejected":
        throw new Error("用户拒绝了授权请求");
      case "expired":
        throw new Error("授权请求已过期");
      case "pending":
        // 继续轮询
        break;
    }
  }
  
  throw new Error("授权请求超时");
}

function decryptToken(encryptedToken: string, clientSecret: Buffer): string {
  // AES-256-GCM 解密
  const encrypted = Buffer.from(encryptedToken, 'base64');
  const iv = encrypted.subarray(0, 12);
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(12, encrypted.length - 16);
  
  // 使用 clientSecret 派生 256 位密钥
  const key = crypto.createHash('sha256').update(clientSecret).digest();
  
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('base64');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Rust

```rust
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use aes_gcm::aead::Aead;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use rand::RngCore;
use sha2::{Sha256, Digest};
use std::time::Duration;
use tokio::time::sleep;

async fn request_authorization() -> Result<String, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    
    // 1. 生成 clientSecret (128 位随机数)
    let mut client_secret = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut client_secret);
    let client_secret_base64 = BASE64.encode(&client_secret);
    
    // 2. 发起申请
    let init_res = client
        .post("https://api.casfa.app/tokens/requests")
        .json(&serde_json::json!({
            "clientName": "My CLI Tool",
            "description": "命令行工具",
            "clientSecret": client_secret_base64
        }))
        .send()
        .await?;
    
    if !init_res.status().is_success() {
        return Err(format!("创建授权申请失败: {}", init_res.status()).into());
    }
    
    let init_data: serde_json::Value = init_res.json().await?;
    let request_id = init_data["requestId"].as_str().unwrap();
    let display_code = init_data["displayCode"].as_str().unwrap();
    let authorize_url = init_data["authorizeUrl"].as_str().unwrap();
    let expires_at = init_data["expiresAt"].as_i64().unwrap();
    let poll_interval = init_data["pollInterval"].as_u64().unwrap();
    
    // 3. 显示授权链接和验证码
    println!("\n请打开以下链接完成授权：");
    println!("{}\n", authorize_url);
    println!("验证码: {}", display_code);
    println!("请核对验证码后批准此请求\n");
    
    // 4. 轮询状态
    loop {
        if chrono::Utc::now().timestamp_millis() >= expires_at {
            return Err("授权请求超时".into());
        }
        
        sleep(Duration::from_secs(poll_interval)).await;
        
        let status_res = client
            .get(&format!("https://api.casfa.app/tokens/requests/{}", request_id))
            .send()
            .await;
        
        let status_res = match status_res {
            Ok(res) => res,
            Err(_) => continue, // 网络错误，继续轮询
        };
        
        if status_res.status() == 404 {
            return Err("授权请求不存在".into());
        }
        
        let status: serde_json::Value = status_res.json().await?;
        
        match status["status"].as_str().unwrap() {
            "approved" => {
                println!("授权成功！");
                // 5. 解密 Token
                let encrypted_token = status["encryptedToken"].as_str().unwrap();
                let token = decrypt_token(encrypted_token, &client_secret)?;
                return Ok(token);
            }
            "rejected" => return Err("用户拒绝了授权请求".into()),
            "expired" => return Err("授权请求已过期".into()),
            "pending" => continue,
            _ => return Err("未知状态".into()),
        }
    }
}

fn decrypt_token(encrypted_token: &str, client_secret: &[u8]) -> Result<String, Box<dyn std::error::Error>> {
    let encrypted = BASE64.decode(encrypted_token)?;
    
    // 提取 IV (12 bytes), ciphertext, authTag (16 bytes)
    let iv = &encrypted[..12];
    let auth_tag = &encrypted[encrypted.len() - 16..];
    let ciphertext = &encrypted[12..encrypted.len() - 16];
    
    // 使用 clientSecret 派生 256 位密钥
    let mut hasher = Sha256::new();
    hasher.update(client_secret);
    let key: [u8; 32] = hasher.finalize().into();
    
    // AES-256-GCM 解密
    let cipher = Aes256Gcm::new_from_slice(&key)?;
    let nonce = Nonce::from_slice(iv);
    
    let mut ciphertext_with_tag = ciphertext.to_vec();
    ciphertext_with_tag.extend_from_slice(auth_tag);
    
    let decrypted = cipher.decrypt(nonce, ciphertext_with_tag.as_ref())?;
    Ok(BASE64.encode(&decrypted))
}
```
