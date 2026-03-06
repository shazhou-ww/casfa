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

## 运行

环境变量通过 **Cell 参数**（见 `cell.yaml` 的 `params`）配置。使用 **SSO** 时只需 `COGNITO_REGION`、`COGNITO_USER_POOL_ID`（用于校验 JWT）；未使用 SSO 时还需 `COGNITO_CLIENT_ID`、`COGNITO_HOSTED_UI_URL` 等。`CELL_BASE_URL` 和 `CELL_STAGE` 由 cell-cli 自动注入。  
数据表为 **realms** 与 **grants**（由 Cell 根据 `cell.yaml` 的 `tables` 创建与管理）。

在 `apps/server-next` 下执行：

- **本地开发**：`cell dev` — 启动 API 与前端，默认端口由 Cell 分配（如 7101 / 7100）。
- **本地测试**：`cell test` — 运行单元测试与 E2E（E2E 会启动临时实例）。
- **部署**：`cell deploy` — 部署 API、前端与基础设施（DynamoDB 表、S3、CloudFront 等）。

**生产域名**：`beta.casfa.shazhou.me`（在 `cell.yaml` 的 `domain` 中配置）。

## 环境变量（Cell 参数）

首次可复制 `.env.example` 为 `.env`。将所需变量写在 `.env`（或 Cell 支持的其他方式），与 `cell.yaml` 的 `params` 对齐。使用 Cognito 时在 `.env` 中设置 `AWS_PROFILE`，需要时执行 `aws sso login`。

| 变量 | 说明 |
|------|------|
| `PORT_BASE` | 端口基数（可选，Cell 用于分配端口） |
| `COGNITO_REGION` | Cognito 区域（**SSO 与 Legacy 均需**，用于 JWT 验签） |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID（**SSO 与 Legacy 均需**） |
| `COGNITO_CLIENT_ID` | 仅 **未使用 SSO** 时需要（本 cell 自管 OAuth 时） |
| `COGNITO_HOSTED_UI_URL` | 仅 **未使用 SSO** 时需要 |
| `COGNITO_CLIENT_SECRET` | 可选；未用 SSO 且未用 PKCE 时需填 |
| `SSO_BASE_URL` | 使用 SSO 时填 SSO cell 的 base URL（如 `https://auth.example.com`） |
| `MOCK_JWT_SECRET` | 设则 mock 鉴权；**生产不要设** |
| `MAX_BRANCH_TTL_MS` | 可选；Branch 最大 TTL（毫秒） |
| `LOG_LEVEL` | 可选；日志级别 |

表名由 Cell 根据 `tables`（realms、grants）自动管理，无需单独配置表名变量。

## API 设计

- [server-next API 设计](../../docs/plans/2026-03-01-server-next-api-design.md)

主要端点：`GET /api/health`、`GET /api/info`；`/api/realm/:realmId/files`、`/api/realm/:realmId/fs/*`、`/api/realm/:realmId/branches`、`/api/realm/:realmId/delegates`、`POST /api/mcp` 等。
