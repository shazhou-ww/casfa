# server-next

基于 Branch / Delegate / Realm 模型的 Casfa 服务端实现，提供 REST API 与 MCP 入口。使用 **Serverless Framework（方案 A）** 部署到 AWS Lambda + API Gateway HTTP API；本地开发与 E2E 通过 **serverless-offline** 模拟，与线上行为一致。

## 概念

- **Realm**：用户的命名空间，当前与用户 ID 1:1；其根由 root delegate（根 Branch）表示。
- **Branch**：任务型分支，对应 @casfa/realm 的 Delegate 实体；可在 realm 根下创建，或在某 Branch 下创建子 Branch；通过 **Branch token**（base64url(branchId)）以 Worker 身份访问。
- **Delegate**：长期授权（非 Branch），通过 `delegates/assign` 签发 JWT，用于客户端/Agent 长期访问某 realm；权限包括 `file_read`、`file_write`、`branch_manage`、`delegate_manage`。

## 前置要求（Serverless v4）

使用 `bun run dev` 或 `bunx serverless deploy` 前，需先登录 Serverless Framework（v4 起必须）：

```bash
bunx serverless login
```

个人与小团队免费；按提示在浏览器完成登录即可。之后本地 offline 与部署均可使用。

## 运行

### 本地开发（推荐：与线上一致）

```bash
bun run dev
```

启动 **serverless-offline**，在本地模拟 Lambda + HTTP API，默认 **http://localhost:3000**。

### 备用：Bun 直起

```bash
bun run dev:bun
```

使用 `Bun.serve` 直接起服务，默认端口 `8802`，可通过环境变量 `PORT` 覆盖。

## 测试

```bash
bun run test          # 单元测试 + E2E
bun run test:unit     # 仅单元测试
bun run test:e2e      # 自动启动 serverless-offline，对其跑 E2E 后退出
```

E2E 会先启动 serverless-offline，再对 http://localhost:3000 执行全部用例，与线上 Lambda 行为一致。

## 部署

```bash
bunx serverless deploy
```

需配置好 AWS 凭证；环境变量见 `serverless.yml` 的 `provider.environment`。

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | HTTP 端口（仅 `dev:bun`） | 8802 |
| `STORAGE_TYPE` | 存储类型：`memory` \| `fs` | memory |
| `STORAGE_FS_PATH` | 当 `STORAGE_TYPE=fs` 时的目录路径 | - |
| `MOCK_JWT_SECRET` | Mock JWT 校验密钥（开发用） | - |
| `MAX_BRANCH_TTL_MS` | Branch 最大 TTL（毫秒） | - |
| `COGNITO_*` | Cognito 用户池（生产鉴权） | - |

## API 设计

REST 与鉴权约定见：

- [server-next API 设计](../../docs/plans/2026-03-01-server-next-api-design.md)

主要端点摘要：

- 健康与信息：`GET /api/health`，`GET /api/info`
- 文件：`GET/PUT /api/realm/:realmId/files/*path`（list/stat/download/upload，单文件约 4MB）
- 文件系统：`POST /api/realm/:realmId/fs/mkdir|rm|mv|cp`
- Branch：`POST/GET /api/realm/:realmId/branches`，revoke/complete
- Delegate：`GET/POST /api/realm/:realmId/delegates`，assign，revoke
- Realm：`GET /api/realm/:realmId`，`/usage`，`POST /api/realm/:realmId/gc`
- MCP：`POST /api/mcp`（Bearer 鉴权，JSON-RPC 2.0）
