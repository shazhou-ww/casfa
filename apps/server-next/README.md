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

**本地 `bun run dev` 需要 Docker**：DynamoDB Local 与 MinIO（S3 兼容）通过 Docker 运行。dev 使用 `dynamodb`（端口 7102 持久化）和 `minio`（端口 7104）；local-test 使用 `dynamodb-test`（7112 in-memory），S3 同样使用 MinIO 7104、独立 bucket 每次启动前清空。未起容器时，`bun run dev` / `bun run dev:cognito` 会自动执行 `docker compose up -d dynamodb minio`；`bun run dev:test` 会拉齐 `dynamodb-test` 与 `minio` 并清空 test 用 bucket。请先安装并启动 Docker Desktop。

在 `apps/server-next` 下执行：

```bash
bun run dev          # 或 dev:cognito / dev:test
```

若不想用 Docker，可用 **`bun run dev:bun`** 直起后端（端口 8802），并自行提供 DynamoDB/S3 端点（如真实 AWS 或其它本地实例）。

## 运行

### 本地开发（local-dev，端口 710x）

- **`bun run dev`**：mock 鉴权，API 在 http://localhost:7101。
- **`bun run dev:cognito`**：Cognito 鉴权，API 在 http://localhost:7101。

本地使用 **Docker DynamoDB**（dev 端口 7102 持久化，local-test 端口 7112 in-memory）和 **Docker MinIO**（S3 兼容，端口 **7104**，dev 与 local-test 共用同一 MinIO 实例，通过不同 bucket 隔离：dev 用 `casfa-next-dev-blob` 持久化，local-test 用 `casfa-next-local-test-blob` 每次启动前清空）。启动 `bun run dev` / `dev:cognito` / `dev:test` 时会自动拉容器并执行 **检查与初始化 DynamoDB**（建表）及 **确保 S3 bucket 存在**；也可单独执行 `bun run dev:setup`（或 `bun run dev:setup -- --stage local-test`）仅做检查与建表、不启动服务。手动起容器：`docker compose up -d dynamodb minio`（dev）或 `docker compose up -d dynamodb-test minio`（local-test 需 dynamodb-test + minio）。

**清理本地数据库**：若需彻底清空 dev 数据，可 `docker compose down -v`（删除 DynamoDB volume）。曾用旧版 serverless-dynamodb 插件时若遗留 `.dynamodb` 目录，可执行 `bun run clean:db` 删除。

**为何 DynamoDB Local 经常要重启？** 常见原因：（1）**持久化到文件**（`inMemory: false` + `dbPath`）：异常退出或 Ctrl+C 后，SQLite 文件可能被锁或损坏，下次启动失败或表现异常；（2）**进程生命周期**：DynamoDB 随 `serverless offline` 作为子进程启动，杀掉 dev 时 Java 进程有时未正确退出，端口 7102 被占；（3）**Java 进程**：DynamoDB Local 是 JAR，偶发崩溃后插件不会自动重启。**缓解**：本地开发已默认改为 **`inMemory: true`**（每次启动全新 DB，无文件锁问题）；若需要保留数据，可改回 `inMemory: false` 并取消注释 `dbPath: ".dynamodb"`，遇到问题再执行 `bun run clean:db` 后重装并重启。

### 本地测试环境（local-test，端口 711x）

```bash
bun run dev:test
```

启动 serverless-offline，API 在 http://localhost:7111；鉴权用 mock（`MOCK_JWT_SECRET`）。使用 Docker **dynamodb-test**（7112 in-memory）与 **MinIO**（7104，bucket `casfa-next-local-test-blob` 每次启动前清空），通过 `--stage=local-test` 使用独立表名/桶名（`casfa-next-local-test-*`），与 dev 数据隔离。

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

脚本会从**当前目录**起向上逐级查找 `.env`，直到**仓库根目录**，读取第一个出现的 `AWS_PROFILE` 并用其执行 `serverless deploy`。同时会加载 `.env` 和 `.env.{stage}`（如 `.env.prod`）中的变量并传给 Lambda；**线上（beta/prod）必须配置 Cognito**：在 `.env` 或 `.env.prod` 中设置 `COGNITO_USER_POOL_ID`、`COGNITO_CLIENT_ID`、`COGNITO_HOSTED_UI_URL`（及可选 `COGNITO_REGION`），且**不要**设置 `MOCK_JWT_SECRET`（部署脚本在非 dev 阶段会主动忽略该变量）。若未配置 Cognito 即部署 prod，脚本会报错并退出。若未找到则使用当前环境已有的 AWS 凭证。**注意**：须在 `apps/server-next` 目录下执行 `bun run deploy`，以便 serverless 找到 `serverless.yml`。

**自定义域名**：beta 使用 `beta.casfa.shazhou.me`，prod 使用 `casfa.shazhou.me`。部署前在 `.env` 或 `.env.{stage}` 中设置 `ACM_CERTIFICATE_ARN`（须为 **us-east-1** 的 ACM 证书，如 `*.casfa.shazhou.me`）。部署完成后在 DNS 中添加 CNAME：`<域名>` → CloudFront 分配域名（部署结束会打印）。

**示例**：在 `apps/server-next` 或项目根目录放置 `.env`，内容为：

```
AWS_PROFILE=AdministratorAccess-914369185440
```

### 前端在哪里、如何访问？

- **线上**：执行 `bun run deploy` 后，前端会部署到 S3 并通过 CloudFront 分发；部署结束会打印 `Frontend: https://xxx.cloudfront.net`。同一 CloudFront 下 `/api` 会转发到 API Gateway，前端无需单独配置 API 地址。
- **本地**：在 `apps/server-next` 下执行 `bun run dev`，浏览器打开 **http://localhost:7100**。

## 环境变量（统一名称，各环境取值不同）

- **DB / Blob**：不再使用进程内 memory；**DB 统一 DynamoDB，Blob 统一 S3**。本地开发用 Docker DynamoDB（7102 dev / 7112 local-test）和 Docker MinIO（**7104**，dev 与 local-test 共用；dev 持久化 bucket，local-test 每次清空 bucket）。

| 变量 | 说明 |
|------|------|
| `PORT` | HTTP 端口（dev:bun） |
| `MOCK_JWT_SECRET` | 设则 mock 鉴权；**线上（beta/prod）部署时不要设**，部署脚本会忽略 |
| `COGNITO_*` | Cognito 配置 |
| `DYNAMODB_ENDPOINT` | 本地 DynamoDB 地址（dev: http://localhost:7102，local-test: http://localhost:7112）；不设则用 AWS。由 dev 脚本自动传入。 |
| `DYNAMODB_TABLE_DELEGATES` / `DYNAMODB_TABLE_GRANTS` | 表名（默认 `casfa-next-<stage>-delegates/grants`） |
| `S3_BUCKET` | CAS blob 桶名（默认 `casfa-next-<stage>-blob`） |
| `S3_ENDPOINT` | 本地 S3 地址（dev / local-test 均为 http://localhost:7104，MinIO）；不设则用 AWS |
| `STAGE` / `SLS_STAGE` | 用于默认表名/桶名（dev / local-test / beta / prod） |
| `LOG_LEVEL` | 可选 |
| `AWS_PROFILE` | 仅用于本地/CI 部署时指定 AWS profile（可写在 `.env`，由 `bun run deploy` 读取） |
| `ACM_CERTIFICATE_ARN` | 部署 beta/prod 时自定义域名用；须为 **us-east-1** 的 ACM 证书 ARN（如 `*.casfa.shazhou.me`） |

## API 设计

- [server-next API 设计](../../docs/plans/2026-03-01-server-next-api-design.md)

主要端点：`GET /api/health`、`GET /api/info`；`/api/realm/:realmId/files`、`/api/realm/:realmId/fs/*`、`/api/realm/:realmId/branches`、`/api/realm/:realmId/delegates`、`POST /api/mcp` 等。
