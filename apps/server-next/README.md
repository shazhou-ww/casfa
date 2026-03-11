# server-next (casfa-next)

基于 Branch / Delegate / Realm 模型的 Casfa 全栈服务：**backend**（Cell API）、**frontend**（S3 + CloudFront）、DynamoDB 表（realms、grants）、S3 blob、Cognito。由 **Cell** 编排开发、测试与部署。详见 [工程框架设计](../../docs/plans/2026-03-02-casfa-next-engineering-design.md)。

## 目录结构

| 目录 | 说明 |
|------|------|
| `backend/` | 服务端代码；API handler：`backend/lambda.ts`；单元测试在 `backend/__tests__/` |
| `frontend/` | 前端 SPA，构建产物由 Cell 上传 S3 |
| `shared/` | 前后端共用的 schema、type、API 协议 |
| `tests/` | E2E 用例；`tests/setup.ts` 使用 `BASE_URL` |

## 概念

- **Realm**：用户的命名空间，当前与用户 ID 1:1；其根由 BranchStore 中的 root 记录表示。
- **Branch**：任务型分支，由 server-next 的 BranchStore 管理（直接基于 CAS 与 DynamoDB）；通过 **Branch token** 以 Worker 身份访问。
- **Delegate**：长期授权，通过 `delegates/assign` 签发 JWT；权限包括 `file_read`、`file_write`、`branch_manage`、`delegate_manage`。

## Branch 访问 URL（path-based）

创建 branch 时若配置了 `CELL_BASE_URL`，响应会包含 **accessUrlPrefix**（如 `https://drive.example.com/branch/{branchId}/{verification}`）。服务端调用（如 image-workshop、MCP）可直接用该 URL 作为 base，请求 `GET {accessUrlPrefix}/api/realm/me/files` 等，**无需再带 Authorization: Bearer**。verification 为 128 位 Crockford Base32（26 字符），与 branch 绑定且有过期时间；branch 最大 TTL 为 10 分钟（`MAX_BRANCH_TTL_MS` 默认 600_000）。**安全**：不要将完整 URL 写入日志；revoke/complete 后该链接立即失效。详见 [Branch 访问 URL 设计](../../docs/plans/2026-03-11-branch-presigned-url-design.md)。

## 运行

配置规则见 [Cell 配置规则](../../docs/cell-config-rules.md)。**cell.yaml** 中写死非敏感且本地/线上一致的项（如 COGNITO_REGION、COGNITO_USER_POOL_ID、MAX_BRANCH_TTL_MS）；仅 **LOG_LEVEL**、**SSO_BASE_URL** 为 `!Env`，须在 `.env` 中提供。`CELL_BASE_URL`、`CELL_STAGE`、表名等由 cell-cli 自动注入。

- 复制 **`.env.example`** 为 `.env`，填写 `LOG_LEVEL`、`SSO_BASE_URL`。
- 本地开发需覆盖时：复制 **`.env.local.example`** 为 `.env.local`，填写 `PORT_BASE`、`SSO_BASE_URL`（本地 SSO 地址）、`LOG_LEVEL` 等。

在 `apps/server-next` 下执行：

- **本地开发**：`cell dev` — 启动 API 与前端，端口由 PORT_BASE 推算（如 7100/7101）。
- **本地测试**：`cell test` — 单元测试与 E2E。
- **部署**：`cell deploy` — 部署 API、前端与基础设施。

**生产域名**：`drive.casfa.shazhou.me`（在 `cell.yaml` 的 `domain` 中配置）。

## 环境变量（Cell 参数）

| 来源 | 变量 | 说明 |
|------|------|------|
| **cell.yaml 写死** | COGNITO_REGION, COGNITO_USER_POOL_ID, MAX_BRANCH_TTL_MS | 非敏感、本地与线上一致 |
| **.env 必填** | LOG_LEVEL | 日志级别（推荐 info） |
| **.env 必填** | SSO_BASE_URL | SSO cell 的 base URL（如 https://auth.casfa.shazhou.me） |
| **.env.local 覆盖** | PORT_BASE, SSO_BASE_URL, LOG_LEVEL | 见 .env.local.example |

表名、DYNAMODB_ENDPOINT、S3_ENDPOINT 等由 Cell 根据 `cell.yaml` 与 stage 自动管理。

## API 设计

- [server-next API 设计](../../docs/plans/2026-03-01-server-next-api-design.md)

主要端点：`GET /api/health`、`GET /api/info`；`/api/realm/:realmId/files`、`/api/realm/:realmId/fs/*`、`/api/realm/:realmId/branches`、`/api/realm/:realmId/delegates`、`POST /api/mcp` 等。
