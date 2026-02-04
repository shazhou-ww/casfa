# CASFA Client v2 架构评审报告

**评审日期**: 2026-02-04  
**评审人**: 高级系统架构师  
**评审对象**: `packages/casfa-client-v2`

---

## 〇、API 设计原则

在评审不一致项之前，先明确我们采用的设计原则：

1. **RESTful 资源导向** — 使用资源路径而非 RPC 风格
2. **camelCase JSON** — 现代 JavaScript/TypeScript 生态的主流约定
3. **语义化标识符** — 使用服务端分配的 ID，而非原始凭证
4. **类型安全** — 不同端点使用不同的响应类型
5. **SDK 友好** — 参数名清晰无歧义，便于 IDE 补全
6. **认证方式抽象** — CASFA 不感知 AWP/Agent 等特定客户端概念

---

## 〇.0 认证方式命名建议

**问题**: 当前命名绑定了特定使用场景

| 当前命名 | 问题 | 推荐命名 | 理由 |
|---------|------|----------|------|
| `AWP Client` | 绑定 "Agent Web Portal" 概念 | `Client` | 强调认证方式（P256 公钥），不限定使用场景 |
| `Agent Token` | 暗示只给 "Agent" 用 | `Token` 或 `ApiToken` | 通用 API 访问令牌 |
| `Ticket` | ✅ 已经是通用概念 | `Ticket` | 保持不变 |

**CASFA 的三种访问方式**:

| 类型 | 认证方式 | 适用场景（不绑定） |
|------|----------|-------------------|
| **Client** | P256 公钥签名 | 任何需要长期、可撤销的客户端身份 |
| **Token** | Bearer Token | 任何需要 API 访问的场景 |
| **Ticket** | Ticket ID | 任何需要受限、有时效访问的场景 |

**需要修改**:

| 组件 | 修改项 |
|------|--------|
| 路由 | `/api/auth/clients/*` ✅ (已经是 clients) |
| 路由 | 无需修改，当前已经是通用命名 |
| casfa-protocol | `AwpAuthInit` → `ClientAuthInit` |
| casfa-protocol | `AwpAuthComplete` → `ClientAuthComplete` |
| casfa-protocol | `CreateAgentToken` → `CreateToken` |
| SDK 类型 | `AwpAuthInitResponse` → `ClientInitResponse` |
| SDK 类型 | `AwpClientInfo` → `ClientInfo` |
| SDK 类型 | `AgentTokenInfo` → `TokenInfo` |
| 服务端 | `auth-clients.ts` 文件名保持，但去掉 AWP 前缀 |

---

## 〇.1 不一致项设计决策

### 决策清单

| 项目 | 当前状态 | 推荐设计 | 理由 |
|------|----------|----------|------|
| **命名抽象** | `AWP Client`, `Agent Token` | `Client`, `Token` | CASFA 不感知特定客户端类型 |
| **Init 字段名** | 服务端 `client_name`，SDK `name` | `clientName` (camelCase) | 符合 JSON 主流约定，语义明确 |
| **Poll 端点** | 服务端 `GET /status?pubkey=`，SDK `/clients/:id/poll` | `GET /clients/:clientId` | RESTful：获取资源状态就是 GET 资源本身 |
| **Client ID** | 服务端用 `pubkey`，SDK 用 `clientId` | `clientId = Blake3s(pubkey)` | 固定派生 ID，URL 更短，客户端可自行计算 |
| **Prepare Nodes 路径** | 服务端 `/prepare-nodes`，SDK `/nodes/prepare` | `POST /prepare-nodes` ✅ | 故意设计：与 `/nodes/:nodeId` 严格区分，避免路由冲突 |
| **OAuth Config 响应** | 服务端 `cognitoUserPoolId`，SDK `userPoolId` | 通用命名 `userPoolId` | 隐藏实现细节，便于更换 provider |
| **Login 响应** | 混用同一类型 | 区分 `OAuthTokenResponse` / `LoginResponse` | 不同端点不同响应，类型安全 |
| **返回类型命名** | 考虑加前缀如 `OAuthConfig` | 直接用 `Config` | 在 context 里已经足够明确 |

---

### 详细设计说明

#### 1. Client 相关字段命名

**推荐**: 全栈统一使用 camelCase，去掉 AWP 前缀

```typescript
// 请求体 (casfa-protocol + 服务端)
{
  pubkey: string;       // 保持 pubkey（已是约定俗成的缩写）
  clientName: string;   // 改为 camelCase
}

// Init 响应体
{
  clientId: string;     // Blake3s(pubkey)
  authUrl: string;
  displayCode: string;  // 改为 camelCase
  expiresIn: number;
}
```

**需要修改**:

- casfa-protocol: `client_name` → `clientName`，类型名 `AwpAuthInit` → `ClientInit`
- 服务端: 响应字段 `auth_url` → `authUrl`, `verification_code` → `displayCode` 等
- SDK: 类型名 `AwpAuthInitResponse` → `ClientInitResponse`

---

#### 2. Client Poll 端点设计

**推荐**: `GET /api/auth/clients/:clientId`

```typescript
// clientId = Blake3s(pubkey)，客户端可自行计算
// 格式: client:{26位Base32}

// SDK
export type GetClientParams = {
  clientId: string;  // 从 init 响应获取，或自行计算 Blake3s(pubkey)
};

// GET /api/auth/clients/:clientId
// 返回 { status: "pending" | "authorized" | "expired", ... }
```

**理由**：

- RESTful 设计中，获取资源状态就是 GET 该资源
- `clientId = Blake3s(pubkey)` 是固定派生，客户端也可自行计算
- URL 更短（26 字符 vs 长公钥字符串），且不暴露原始公钥

**需要修改**: 服务端 `GET /status?pubkey=` → `GET /:clientId`

---

#### 3. Prepare Nodes 路径

**推荐**: `POST /api/realm/:realmId/prepare-nodes` ✅ (保持当前服务端设计)

```typescript
// SDK 需要修改
`/api/realm/${realmId}/prepare-nodes`
```

**理由**：

- 故意与 `/nodes/:nodeId` 严格区分，避免路由冲突
- `/prepare-nodes` 是对批量 keys 的预检操作，不是单个 node 的子路径

**需要修改**: SDK `/nodes/prepare` → `/prepare-nodes`

---

#### 4. OAuth Config 响应

**推荐**: 使用通用命名，不暴露 provider 细节

```typescript
export type OAuthConfig = {
  userPoolId: string;
  clientId: string;
  authDomain: string;
  region?: string;
};
```

**需要修改**: 服务端响应字段名

---

#### 5. Login vs Token Exchange 响应类型

**推荐**: 区分两种不同的响应

```typescript
// POST /api/oauth/token - OAuth 标准响应 (snake_case 是 RFC 6749 规范)
export type OAuthTokenResponse = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
};

// POST /api/oauth/login - 应用层响应 (camelCase)
export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: UserInfo;
};
```

> 注：OAuth token endpoint 返回 snake_case 是 RFC 6749 规范要求，应保持。

---

## 〇.2 统一修改建议

### casfa-protocol 需要修改

| 文件 | 修改项 |
|------|--------|
| `auth.ts` | `AwpAuthInitSchema` → `ClientInitSchema` |
| `auth.ts` | `AwpAuthCompleteSchema` → `ClientCompleteSchema` |
| `auth.ts` | `CreateAgentTokenSchema` → `CreateTokenSchema` |
| `auth.ts` | 字段 `client_name` → `clientName`, `verification_code` → `verificationCode` |

### 服务端需要修改

| 文件 | 修改项 |
|------|--------|
| `router.ts` | `GET /clients/status` → `GET /clients/:clientId` |
| `router.ts` | `DELETE /clients/:pubkey` → `DELETE /clients/:clientId` |
| `auth-clients.ts` | 请求/响应字段改为 camelCase |
| `auth-clients.ts` | 用 `clientId = Blake3s(pubkey)` 作为资源标识 |
| `auth-tokens.ts` | 考虑重命名为 `tokens.ts`（去掉 auth 前缀） |
| `oauth.ts` | Config 响应字段改为通用命名 |

### SDK 需要修改

| 文件 | 修改项 |
|------|--------|
| `api/auth.ts` | `pollClient` 路径改为 `/clients/:clientId`，去掉 `/poll` 后缀 |
| `api/nodes.ts` | 路径 `/nodes/prepare` → `/prepare-nodes` |
| `types/api.ts` | `AwpAuthInitResponse` → `ClientInitResponse` |
| `types/api.ts` | `AwpClientInfo` → `ClientInfo` |
| `types/api.ts` | `AgentTokenInfo` → `TokenInfo` |
| `types/api.ts` | OAuth 响应类型拆分 |
| `types/auth.ts` | `P256AuthState` 等无需改，它描述的是认证方式 |

---

## 一、整体评价 ⭐⭐⭐⭐ (4/5)

### 亮点

- ✅ 函数式设计清晰，工厂函数模式合理
- ✅ `FetchResult<T>` 的 discriminated union 设计优秀，类型安全
- ✅ 权限检查集中管理（`permissions.ts`）
- ✅ Context 模式统一 API 层参数传递
- ✅ SDK 使用 camelCase 命名（正确方向）

### 需要改进

- ⚠️ 服务端/protocol 使用 snake_case，需统一为 camelCase
- ⚠️ AWP 相关端点路径设计需要优化
- ⚠️ 部分响应类型需要拆分
- ⚠️ 错误处理机制可进一步增强

---

## 二、SDK 当前问题

### 2.1 AWP Poll 端点

**当前 SDK**: `GET /api/auth/clients/:clientId/poll`  
**推荐**: `GET /api/auth/clients/:clientId`

SDK 当前设计接近正确，只需去掉 `/poll` 后缀。

---

### 2.2 OAuth Config 响应类型

**当前 SDK**:

```typescript
export type CognitoConfig = {
  userPoolId: string;
  clientId: string;
  domain: string;
  region: string;
};
```

**推荐**:

```typescript
export type OAuthConfig = {
  userPoolId: string;
  clientId: string;
  authDomain: string;
  region?: string;
};
```

---

### 2.3 Login 和 Token Exchange 响应类型

**推荐**: 拆分为两种类型（见上文 5）

---

## 三、设计建议 (提升易用性)

### 3.1 改进 `FetchResult` 的错误处理

当前 `FetchResult<T>` 设计良好，建议添加辅助函数：

```typescript
export const unwrap = <T>(result: FetchResult<T>): T => {
  if (!result.ok) throw result.error;
  return result.data;
};

export const unwrapOr = <T>(result: FetchResult<T>, defaultValue: T): T => {
  return result.ok ? result.data : defaultValue;
};

// 使用示例
const info = unwrap(await client.getInfo());
```

---

### 3.2 添加类型守卫

```typescript
export const isUserAuth = (state: AuthState): state is UserAuthState => 
  state.type === "user";

export const isTicketAuth = (state: AuthState): state is TicketAuthState => 
  state.type === "ticket";
```

---

### 3.3 P256 Auth 完整流程

`src/auth/p256.ts` 的 `initialize` 方法只处理了密钥加载/生成，建议添加完整的认证流程辅助函数：

1. 加载/生成密钥
2. 调用 `/api/auth/clients/init`
3. 轮询 `/api/auth/clients/:clientId`
4. 获取用户授权确认

---

### 3.4 缺失字段

- `CreateDepotParams` 缺少 `description` 字段
- `CreateTicketParams` 考虑添加 `label` 字段

---

## 四、修复优先级

| 优先级 | 修复项 | 修改范围 | 工作量 |
|--------|--------|---------|--------|
| **P0** | 去掉 AWP/Agent 前缀，使用通用命名 | protocol + server + SDK | 中 |
| **P0** | casfa-protocol: snake_case → camelCase | protocol + server | 中 |
| **P0** | 服务端: Client 端点用 `clientId = Blake3s(pubkey)` | server | 小 |
| **P0** | SDK: Prepare Nodes 路径 `/nodes/prepare` → `/prepare-nodes` | SDK | 小 |
| **P1** | SDK: 拆分 `OAuthTokenResponse` / `LoginResponse` | SDK | 小 |
| **P1** | 服务端: OAuth Config 改为通用命名 | server + SDK | 小 |
| **P2** | SDK: 添加 `unwrap` 辅助函数 | SDK | 小 |
| **P2** | SDK: 添加类型守卫 | SDK | 小 |
| **P3** | SDK: 添加缺失字段 | SDK | 小 |

---

## 五、总结

`casfa-client-v2` 的整体架构设计是优秀的，函数式风格统一，类型系统完备。

**主要问题**集中在 **三方（protocol、服务端、SDK）的命名和路径不一致** 上。好消息是：这三个组件都还未上线，可以一起调整到最佳设计。

**核心建议**：

1. **CASFA 不感知 AWP/Agent** — 三种访问方式（Client/Token/Ticket）是通用抽象
2. **全栈统一 camelCase** — 现代 TypeScript 生态的标准约定
3. **使用 clientId = Blake3s(pubkey)** — 固定派生 ID，客户端可自行计算，URL 更短
4. **保持 `/prepare-nodes` 路径** — 故意设计，与 `/nodes/:nodeId` 严格区分
5. **返回类型命名简洁** — 在 context 里已经足够明确，无需加前缀
6. **OAuth token 端点保持 snake_case** — 遵循 RFC 6749 规范

**预计修复工作量**：全栈统一约 3-4 小时。
