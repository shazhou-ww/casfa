# server-next (casfa-next)

基于 Branch / Delegate / Realm 模型的 Casfa 全栈服务：**backend**（Lambda + API Gateway）、**frontend**（S3 + CloudFront）、DynamoDB、S3 blob、Cognito。单栈 Serverless，资源前缀 `casfa-next`。详见 [工程框架设计](../../docs/plans/2026-03-02-casfa-next-engineering-design.md)。

## 目录结构

| 目录 | 说明 |
|------|------|
| `backend/` | 服务端代码；Lambda handler：`backend/lambda.handler`；单元测试在 `backend/__tests__/` |
| `frontend/` | 前端 SPA，构建产物上传 S3 |
| `shared/` | 前后端共用的 schema、type、API 协议 |
| `tests/` | 仅 E2E 用例；`tests/setup.ts` 使用 `BASE_URL` |
| `scripts/` | 工程脚本：`dev.ts`、`dev-test.ts`、`e2e-offline.ts` |

## 概念

- **Realm**：用户的命名空间，当前与用户 ID 1:1；其根由 root delegate（根 Branch）表示。
- **Branch**：任务型分支，对应 @casfa/realm 的 Delegate 实体；通过 **Branch token** 以 Worker 身份访问。
- **Delegate**：长期授权，通过 `delegates/assign` 签发 JWT；权限包括 `file_read`、`file_write`、`branch_manage`、`delegate_manage`。

## 前置要求（Serverless v4）

```bash
bunx serverless login
```

## 运行

### 本地开发（local-dev，端口 710x）

```bash
bun run dev
```

启动 serverless-offline，API 在 **http://localhost:7101**；鉴权用 Cognito（不设 `MOCK_JWT_SECRET`）。

### 本地测试环境（local-test，端口 711x）

```bash
bun run dev:test
```

启动 serverless-offline，API 在 **http://localhost:7111**；鉴权用 mock（`MOCK_JWT_SECRET`），存储为内存。

### 备用：Bun 直起

```bash
bun run dev:bun
```

`Bun.serve` 直起，默认端口 `8802`。

## 测试

```bash
bun run test          # 单元测试 + E2E
bun run test:unit     # 仅单元测试（backend/__tests__）
bun run test:e2e      # 先启动 dev:test（7111），再对 http://localhost:7111 跑 E2E
```

## 部署

```bash
bunx serverless deploy --stage beta
bunx serverless deploy --stage prod
```

环境变量见 `serverless.yml` 的 `provider.environment`；各 stage 变量名统一，仅值不同，见设计文档。

## 环境变量（统一名称，各环境取值不同）

| 变量 | 说明 |
|------|------|
| `PORT` | HTTP 端口（dev:bun） |
| `STORAGE_TYPE` | `memory` \| `fs` |
| `STORAGE_FS_PATH` | fs 时的路径 |
| `MOCK_JWT_SECRET` | 设则 mock 鉴权，不设则 Cognito |
| `COGNITO_REGION` / `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` | Cognito |
| `DYNAMODB_ENDPOINT` | 本地 DynamoDB 地址（如 http://localhost:7102） |
| `S3_BUCKET` / `LOG_LEVEL` | 可选 |

## API 设计

- [server-next API 设计](../../docs/plans/2026-03-01-server-next-api-design.md)

主要端点：`GET /api/health`、`GET /api/info`；`/api/realm/:realmId/files`、`/api/realm/:realmId/fs/*`、`/api/realm/:realmId/branches`、`/api/realm/:realmId/delegates`、`POST /api/mcp` 等。
