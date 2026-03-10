# @casfa/client

CASFA 客户端库，提供统一的授权策略。

## 安装

```bash
bun add @casfa/client
```

## 概述

一个有状态的客户端，管理三层令牌体系：

1. **用户 JWT** - OAuth 登录令牌，最高权限
2. **委托令牌（Delegate Token）** - 可再委托的令牌，能够签发子令牌
3. **访问令牌（Access Token）** - 数据访问令牌，用于 CAS 操作

## 快速开始

```typescript
import { createClient } from '@casfa/client';

const client = createClient({
  baseUrl: 'https://api.casfa.example.com',
  onAuthRequired: async () => {
    // 处理认证（例如跳转到登录页面）
  },
  onTokenChange: (state) => {
    // 持久化令牌状态
    localStorage.setItem('casfa-tokens', JSON.stringify(state));
  },
});

// 使用已保存的令牌初始化
const stored = localStorage.getItem('casfa-tokens');
if (stored) {
  client.tokens.restore(JSON.parse(stored));
}
```

## 功能特性

### OAuth 认证

```typescript
// 发起 OAuth 流程
const { authUrl, state, codeVerifier } = await client.oauth.startAuth({
  redirectUri: 'https://myapp.com/callback',
});

// 处理回调
const tokens = await client.oauth.handleCallback({
  code: authCode,
  codeVerifier,
  redirectUri: 'https://myapp.com/callback',
});
```

### 令牌管理

```typescript
// 检查令牌状态
const hasValidTokens = client.tokens.hasValidTokens();
const userToken = client.tokens.getUserToken();
const delegateToken = client.tokens.getDelegateToken();
const accessToken = client.tokens.getAccessToken();

// 刷新令牌
await client.tokens.refresh();

// 清除所有令牌（登出）
client.tokens.clear();
```

### Depot 操作

```typescript
// 列出 depot
const depots = await client.depots.list();

// 创建 depot
const depot = await client.depots.create({
  name: 'my-depot',
  description: 'My storage depot',
});

// 获取 depot 信息
const info = await client.depots.get(depotId);
```

### Ticket 操作

```typescript
// 创建访问 ticket
const ticket = await client.tickets.create({
  depotId: 'depot:...',
  permissions: ['read', 'write'],
  expiresIn: 3600,
});

// 列出 ticket
const tickets = await client.tickets.list({ depotId: 'depot:...' });

// 撤销 ticket
await client.tickets.revoke(ticketId);
```

### 节点操作（CAS）

```typescript
// 读取节点数据
const data = await client.nodes.get('node:abc123...');

// 写入节点数据
const key = await client.nodes.put(data);

// 检查节点是否存在
const exists = await client.nodes.has('node:abc123...');

// 准备上传（用于大文件）
const { uploadUrl } = await client.nodes.prepare({
  size: fileSize,
  hash: computedHash,
});
```

## 配置

```typescript
interface ClientConfig {
  // 必需
  baseUrl: string;
  
  // 回调函数
  onAuthRequired?: () => void | Promise<void>;
  onTokenChange?: (state: TokenState) => void;
  
  // 可选的存储提供者（用于 CAS 操作）
  storage?: StorageProvider;
  
  // 超时和重试
  timeout?: number;
  retries?: number;
}
```

## 令牌存储

客户端包含一个完善的令牌存储，支持：

- 过期前自动刷新令牌
- 令牌层级校验
- 签发链追踪
- 并发刷新保护

```typescript
import {
  createTokenStore,
  createRefreshManager,
  isTokenValid,
  isTokenExpiringSoon,
} from '@casfa/client';

// 创建独立的令牌存储
const store = createTokenStore();

// 创建刷新管理器
const refreshManager = createRefreshManager(store, {
  refreshThreshold: 5 * 60 * 1000, // 过期前 5 分钟刷新
});
```

## API 模块

如需高级用法，可直接访问底层 API 函数：

```typescript
import { api } from '@casfa/client';

// 直接调用 API
const result = await api.createTicket(baseUrl, token, params);
```

## 类型

```typescript
import type {
  CasfaClient,
  ClientConfig,
  ClientError,
  TokenState,
  StoredUserToken,
  StoredDelegateToken,
  StoredAccessToken,
} from '@casfa/client';
```

## 许可证

MIT
