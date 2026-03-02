# server-next (casfa-next)

基于 Branch / Delegate / Realm 模型的 Casfa 全栈服务：**backend**（Lambda + API Gateway）、**frontend**（S3 + CloudFront）、DynamoDB、S3 blob、Cognito。单栈 Serverless，资源前缀 `casfa-next`。详见 [工程框架设计](../../docs/plans/2026-03-02-casfa-next-engineering-design.md)。

## 目录结构

| 目录 | 说明 |
|------|------|
| `backend/` | 服务端代码；Lambda handler：`backend/lambda.handler`；单元测试在 `backend/__tests__/` |
| `frontend/` | 前端 SPA，构建产物上传 S3 |
| `shared/` | 前后端共用的 schema、type、API 协议 |
| `tests/` | 仅 E2E 用例；`tests/setup.ts` 使用 `BASE_URL` |
| `scripts/` | 工程脚本：`dev.ts`、`dev-test.ts`、`e2e-offline.ts`、`deploy.ts` |

## 概念

- **Realm**：用户的命名空间，当前与用户 ID 1:1；其根由 BranchStore 中的 root 记录表示。
- **Branch**：任务型分支，由 server-next 的 BranchStore 管理（直接基于 CAS 与 DynamoDB）；通过 **Branch token** 以 Worker 身份访问。
- **Delegate**：长期授权，通过 `delegates/assign` 签发 JWT；权限包括 `file_read`、`file_write`、`branch_manage`、`delegate_manage`。

## 前置要求（Serverless v4）

```bash
bunx serverless login
```

**本地 `bun run dev` 需要 Java**：DynamoDB Local 官方实现是 Java JAR，本机需安装 **JRE 11+** 且 `java` 在 PATH 中。若未安装会报错 `spawn java ENOENT`。

本项目使用维护版插件 **serverless-dynamodb**（替代已停更的 serverless-dynamodb-local），其 `sls dynamodb install` 使用当前有效的下载地址，可避免 403。装好 Java 后，在 `apps/server-next` 下执行：

```bash
bunx serverless dynamodb install   # 首次
bun run dev
```

若不想装 Java，可用 **`bun run dev:bun`** 直起后端（端口 8802），并自行提供 DynamoDB/S3 端点（如真实 AWS 或 Docker 等）。

## 运行

### 本地开发（local-dev，端口 710x）

- **`bun run dev`**：mock 鉴权，API 在 http://localhost:7101。
- **`bun run dev:cognito`**：Cognito 鉴权，API 在 http://localhost:7101。

本地一律使用 **serverless-dynamodb-local**（DynamoDB 端口 7102）和 **serverless-s3-local**（S3 端口 4569）；首次需执行一次 `bunx serverless dynamodb install`。启动时用 `serverless offline start` 会自动拉起 DynamoDB 与 S3 本地服务。

**清理本地数据库**：若因旧数据导致报错（如 "key conditions were not unique"），可清空本地 DynamoDB 后重装并重启：

```bash
bun run clean:db
bunx serverless dynamodb install
bun run dev
```

**若出现 `NoClassDefFoundError: org/apache/commons/cli/ParseException`**：说明 DynamoDB Local 的 classpath 不完整（常见于 `clean:db` 后重装）。请务必在 **`apps/server-next` 目录下**执行 `bunx serverless dynamodb install`，确认 `.dynamodb` 内既有 `DynamoDBLocal.jar` 也有 `DynamoDBLocal_lib/` 目录。若仍报错，可改用 Docker 运行 DynamoDB Local：在 `serverless.yml` 的 `custom.serverless-dynamodb.start` 下取消注释 `docker: true`，并确保本机已安装 Docker。

### 本地测试环境（local-test，端口 711x）

```bash
bun run dev:test
```

启动 serverless-offline，API 在 http://localhost:7111；鉴权用 mock（`MOCK_JWT_SECRET`）。使用同一套 DynamoDB/S3 本地，通过 `--stage=local-test` 使用独立表名/桶名（`casfa-next-local-test-*`），与 dev 数据隔离。

### 备用：Bun 直起

```bash
bun run dev:bun
```

`Bun.serve` 直起，默认端口 `8802`。需已设置 `DYNAMODB_ENDPOINT`、`S3_ENDPOINT`、`S3_BUCKET`（或使用默认表名/桶名）。

## 测试

```bash
bun run test          # 单元测试 + E2E
bun run test:unit     # 仅单元测试（backend/__tests__）
bun run test:e2e      # 先启动 dev:test（7111），再对 http://localhost:7111 跑 E2E
```

## 部署

当前部署包含 **API**（Lambda + HTTP API）与 **前端**（S3 + CloudFront）。`bun run deploy` 会依次：构建 frontend、部署 stack、上传 frontend 到 S3、使 CloudFront 缓存失效。前端访问地址为 CloudFront 的 URL（部署结束会打印）；`/api` 请求由 CloudFront 转发到 API Gateway。

### 部署 API（beta / prod）

在 `apps/server-next` 下执行（需已配置 AWS 凭证，如 SSO 登录后）：

```bash
bun run deploy              # 默认 stage=beta
bun run deploy -- --stage prod
```

脚本会从**当前目录**起向上逐级查找 `.env`，直到**仓库根目录**，读取第一个出现的 `AWS_PROFILE` 并用其执行 `serverless deploy`。若未找到则使用当前环境已有的 AWS 凭证。**注意**：须在 `apps/server-next` 目录下执行 `bun run deploy`，以便 serverless 找到 `serverless.yml`。

**示例**：在 `apps/server-next` 或项目根目录放置 `.env`，内容为：

```
AWS_PROFILE=AdministratorAccess-914369185440
```

### 前端在哪里、如何访问？

- **线上**：执行 `bun run deploy` 后，前端会部署到 S3 并通过 CloudFront 分发；部署结束会打印 `Frontend: https://xxx.cloudfront.net`。同一 CloudFront 下 `/api` 会转发到 API Gateway，前端无需单独配置 API 地址。
- **本地**：在 `apps/server-next` 下执行 `bun run dev`，浏览器打开 **http://localhost:7100**。

## 环境变量（统一名称，各环境取值不同）

- **DB / Blob**：不再使用进程内 memory；**DB 统一 DynamoDB，Blob 统一 S3**。本地开发用 serverless-dynamodb-local 和 serverless-s3-local。

| 变量 | 说明 |
|------|------|
| `PORT` | HTTP 端口（dev:bun） |
| `MOCK_JWT_SECRET` | 设则 mock 鉴权，不设则 Cognito |
| `COGNITO_*` | Cognito 配置 |
| `DYNAMODB_ENDPOINT` | 本地 DynamoDB 地址（如 http://localhost:7102）；不设则用 AWS |
| `DYNAMODB_TABLE_DELEGATES` / `DYNAMODB_TABLE_GRANTS` | 表名（默认 `casfa-next-<stage>-delegates/grants`） |
| `S3_BUCKET` | CAS blob 桶名（默认 `casfa-next-<stage>-blob`） |
| `S3_ENDPOINT` | 本地 S3 地址（如 http://localhost:4569）；不设则用 AWS |
| `STAGE` / `SLS_STAGE` | 用于默认表名/桶名（dev / local-test / beta / prod） |
| `LOG_LEVEL` | 可选 |
| `AWS_PROFILE` | 仅用于本地/CI 部署时指定 AWS profile（可写在 `.env`，由 `bun run deploy` 读取） |

## API 设计

- [server-next API 设计](../../docs/plans/2026-03-01-server-next-api-design.md)

主要端点：`GET /api/health`、`GET /api/info`；`/api/realm/:realmId/files`、`/api/realm/:realmId/fs/*`、`/api/realm/:realmId/branches`、`/api/realm/:realmId/delegates`、`POST /api/mcp` 等。
