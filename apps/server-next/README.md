# server-next

基于 Branch / Delegate / Realm 模型的 Casfa 服务端实现，提供 REST API 与 MCP 入口。

## 概念

- **Realm**：用户的命名空间，当前与用户 ID 1:1；其根由 root delegate（根 Branch）表示。
- **Branch**：任务型分支，对应 @casfa/realm 的 Delegate 实体；可在 realm 根下创建，或在某 Branch 下创建子 Branch；通过 **Branch token**（base64url(branchId)）以 Worker 身份访问。
- **Delegate**：长期授权（非 Branch），通过 `delegates/assign` 签发 JWT，用于客户端/Agent 长期访问某 realm；权限包括 `file_read`、`file_write`、`branch_manage`、`delegate_manage`。

## 运行

```bash
bun run dev
```

默认端口 `8802`，可通过环境变量覆盖。

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | HTTP 端口 | 8802 |
| `STORAGE_TYPE` | 存储类型：`memory` \| `fs` | memory |
| `STORAGE_FS_PATH` | 当 `STORAGE_TYPE=fs` 时的目录路径 | - |
| `MOCK_JWT_SECRET` | Mock JWT 校验密钥（开发用） | - |
| `MAX_BRANCH_TTL_MS` | Branch 最大 TTL（毫秒） | - |

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
