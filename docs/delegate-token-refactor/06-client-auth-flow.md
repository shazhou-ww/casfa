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
     │ 1. 生成 clientSecret (本地)   │                               │
     │                               │                               │
     │ 2. POST /tokens/requests      │                               │
     │    {clientName}               │                               │
     │──────────────────────────────>│                               │
     │                               │                               │
     │ 3. {requestId, displayCode,   │                               │
     │     authorizeUrl, expiresAt}  │                               │
     │<──────────────────────────────│                               │
     │                               │                               │
     │ 4. 构造完整 URL (添加 hash)   │                               │
     │    authorizeUrl#secret=xxx    │                               │
     │                               │                               │
     │ 5. 显示授权链接和验证码       │                               │
     │   "请打开链接并核对 ABCD-1234"│                               │
     │────────────────────────────────────────────────────────────>│
     │                               │                               │
     │                               │  6. 用户打开链接（浏览器）
     │                               │     浏览器 JS 读取 hash 中的 secret
     │                               │     GET /tokens/requests/:id
     │                               │     (获取详情展示，不含 secret)
     │                               │<──────────────────────────────│
     │                               │                               │
     │                               │  7. 用户选择 realm，设置权限并批准
     │                               │     POST /tokens/requests/:id/approve
     │                               │     {realm, scope, clientSecret...}
     │                               │     (前端从 hash 读取 secret 附加)
     │                               │<──────────────────────────────│
     │                               │                               │
     │                               │  8. 服务端签发 Token，用 clientSecret
     │                               │     加密后存储 encryptedToken
     │                               │     【不存储 clientSecret】
     │                               │                               │
     │ 9. GET /tokens/requests/:id/poll                               │
     │    (轮询)                     │                               │
     │──────────────────────────────>│                               │
     │                               │                               │
     │ 10. status: "approved"        │                               │
     │     encryptedToken            │                               │
     │<──────────────────────────────│                               │
     │                               │                               │
     │ 11. 用本地 clientSecret 解密  │                               │
     │     保存 Token 并使用         │                               │
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
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║  请打开以下链接完成授权                                   ║
║                                                           ║
║  https://casfa.app/authorize/req_xxxxx#secret=BASE64...   ║
║                                                           ║
║  验证码: ABCD-1234                                        ║
║  请核对验证码后批准此请求                                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

> **注意**：URL 中的 `#secret=xxx` 部分是 hash fragment，不会发送到服务器。

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
  "description": "AI 编程助手"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `clientName` | `string` | 是 | 客户端名称（1-64 字符） |
| `description` | `string` | 否 | 客户端描述（最多 256 字符） |

> **注意**：`clientSecret` 由客户端本地生成，不发送到服务端。客户端需自行构造完整的授权 URL（添加 hash）。

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
| `authorizeUrl` | `string` | 授权页面基础 URL（不含 hash），客户端需自行添加 `#secret=xxx` |
| `expiresAt` | `number` | 申请过期时间（Unix 毫秒），10 分钟 |
| `pollInterval` | `number` | 建议轮询间隔（秒） |

**客户端构造完整 URL**：

```
服务端返回: https://casfa.app/authorize/req_xxxxx
客户端添加: https://casfa.app/authorize/req_xxxxx#secret=BASE64_CLIENT_SECRET
```

> **安全说明**：
> - `requestId` 使用 128 位随机数，不可枚举
> - `clientSecret` 通过 URL hash 传递，hash 部分不会发送到服务端日志
> - 只有用户浏览器和客户端知道 `clientSecret`

**错误**：

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_CLIENT_NAME` | 400 | clientName 为空或过长 |
| `INVALID_CLIENT_SECRET` | 400 | clientSecret 格式无效 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |

---

### 3.2 轮询申请状态（客户端侧）

#### GET /api/tokens/requests/:requestId/poll

客户端轮询授权申请状态。此路由与用户侧查看详情的路由分开，以区分客户端和用户的访问场景。

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
  "clientSecret": "base64_encoded_128_bit_random",
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
| `clientSecret` | `string` | 是 | 从 URL hash 读取的客户端密钥（128 位随机数，Base64 编码） |
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

> **安全说明**：
> - `clientSecret` 由前端从 URL hash 读取，服务端仅在内存中使用，**不持久化存储**
> - Token 使用 `clientSecret` 加密后存储为 `encryptedToken`
> - 客户端通过轮询获取 `encryptedToken`，使用本地保存的 `clientSecret` 解密
> - 这确保即使数据库泄露，攻击者也无法解密 Token

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
| GET /api/tokens/requests/:id/poll | 60 次/分钟/IP |
| GET /api/tokens/requests/:id | 30 次/分钟/IP |

### 4.4 Token 传递安全

**clientSecret 传递机制**：

```
客户端 ──生成 clientSecret──> 本地保存
         │
         └──构造 URL──> authorizeUrl#secret=xxx
                              │
                              ▼
                       用户浏览器
                       (JS 读取 hash)
                              │
                              ▼
                       approve 请求
                       (HTTPS POST)
                              │
                              ▼
                       服务端内存
                       (加密后丢弃)
```

**安全保障**：

| 环节 | 安全措施 |
|------|----------|
| URL hash | 不发送到服务器日志，仅浏览器可见 |
| approve 请求 | HTTPS 加密传输 |
| 服务端处理 | 仅在内存中使用，不持久化 |
| 数据库存储 | 只存 encryptedToken，无密钥 |
| 客户端解密 | 使用本地保存的 clientSecret |

**密钥派生**：

由于 `clientSecret` 为 128 位，AES-256-GCM 需要 256 位密钥，采用 SHA-256 派生：

```typescript
const key = createHash('sha256').update(clientSecret).digest();
```

**其他安全措施**：

- Token 仅通过 HTTPS 传输
- `encryptedToken` 仅在首次轮询到 approved 状态时返回
- 服务端不存储明文 Token，只存储 Token ID (hash) 和 encryptedToken

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
  // 注意：不存储 clientSecret 或其 hash，密钥仅在 approve 时通过请求传入
  
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
  clientSecret: string;   // 从 URL hash 读取
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
import { randomBytes, createDecipheriv, createHash } from 'crypto';

async function requestAuthorization(): Promise<string> {
  // 1. 生成 clientSecret (128 位随机数) - 本地保存，不发送到服务端
  const clientSecret = randomBytes(16);
  const clientSecretBase64 = clientSecret.toString('base64');
  
  // 2. 发起申请（不发送 clientSecret）
  const initRes = await fetch("https://api.casfa.app/tokens/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientName: "My CLI Tool",
      description: "命令行工具"
    })
  });
  
  if (!initRes.ok) {
    const error = await initRes.json();
    throw new Error(`创建授权申请失败: ${error.code}`);
  }
  
  const { requestId, displayCode, authorizeUrl, expiresAt, pollInterval } = await initRes.json();
  
  // 3. 构造完整 URL（添加 hash 传递 clientSecret）
  const fullAuthorizeUrl = `${authorizeUrl}#secret=${encodeURIComponent(clientSecretBase64)}`;
  
  // 4. 显示授权链接和验证码
  console.log(`\n请打开以下链接完成授权：`);
  console.log(`${fullAuthorizeUrl}\n`);
  console.log(`验证码: ${displayCode}`);
  console.log(`请核对验证码后批准此请求\n`);
  
  // 5. 轮询状态
  while (Date.now() < expiresAt) {
    await sleep(pollInterval * 1000);
    
    const statusRes = await fetch(`https://api.casfa.app/tokens/requests/${requestId}/poll`);
    
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
        // 6. 解密 Token
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
  
  // 使用 SHA-256 派生 256 位密钥
  const key = createHash('sha256').update(clientSecret).digest();
  
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
    
    // 1. 生成 clientSecret (128 位随机数) - 本地保存，不发送到服务端
    let mut client_secret = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut client_secret);
    let client_secret_base64 = BASE64.encode(&client_secret);
    
    // 2. 发起申请（不发送 clientSecret）
    let init_res = client
        .post("https://api.casfa.app/tokens/requests")
        .json(&serde_json::json!({
            "clientName": "My CLI Tool",
            "description": "命令行工具"
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
    
    // 3. 构造完整 URL（添加 hash 传递 clientSecret）
    let full_authorize_url = format!("{}#secret={}", authorize_url, urlencoding::encode(&client_secret_base64));
    
    // 4. 显示授权链接和验证码
    println!("\n请打开以下链接完成授权：");
    println!("{}\n", full_authorize_url);
    println!("验证码: {}", display_code);
    println!("请核对验证码后批准此请求\n");
    
    // 5. 轮询状态
    loop {
        if chrono::Utc::now().timestamp_millis() >= expires_at {
            return Err("授权请求超时".into());
        }
        
        sleep(Duration::from_secs(poll_interval)).await;
        
        let status_res = client
            .get(&format!("https://api.casfa.app/tokens/requests/{}/poll", request_id))
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
                // 6. 解密 Token
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
