# server-next 工程框架设计（casfa-next 全栈 Serverless）

## 目标

将 server-next 做成基于 Serverless 的全栈服务：前端 S3+CloudFront，后端 Lambda，数据库 DynamoDB，Blob 存储 S3，账号 Cognito，日志 CloudWatch，密钥 Secrets Manager。单栈、统一资源命名前缀 `casfa-next`；线上 beta/prod 共用数据与账号，本地 local-dev / local-test 通过两条明确命令与统一环境变量支持。

## 已确认的约束与选择

- **前端位置**：前端代码在 server-next 内（`frontend/`），与后端同一 Serverless 项目一起部署。
- **本地环境**：两条明确命令 —— `bun run dev` = local-dev（710x），`bun run dev:test` = local-test（711x）；`bun run test:e2e` 先启动 `dev:test` 再对服务跑 E2E。
- **本地数据**：不依赖 Docker；DynamoDB 用插件/文件或内存 mock，S3 用本地目录或内存。
- **beta/prod**：一个 Serverless 项目两个 stage；DynamoDB、S3 blob、Cognito 共用（命名无 stage）；仅 Lambda、API、CloudFront、前端桶、日志按 stage 区分。
- **命名前缀**：所有资源使用 `casfa-next`（如 `casfa-next-blob`、`casfa-next-frontend-${stage}`）。
- **鉴权**：不设 `AUTH_MODE`；有 `MOCK_JWT_SECRET` 即 mock 鉴权，无则 Cognito。所有 stage 使用同一套环境变量名，仅值不同。

---

## 第一节：架构与服务栈

- **前端**：静态资源构建后上传 S3（`casfa-next-frontend-${stage}`），CloudFront 分发。
- **后端**：Lambda + API Gateway HTTP API，按 stage 部署；共用 DynamoDB 表与 S3 blob 桶。
- **数据库**：DynamoDB，表名 `casfa-next-<table>`，无 stage，beta/prod 共用。
- **Blob**：S3 桶 `casfa-next-blob`，共用。
- **账号**：Cognito 用户池/Client 共用；密钥走 Secrets Manager。
- **日志**：CloudWatch，Log Group 随 Lambda 名按 stage 区分。
- **密钥**：Secrets Manager；Lambda 用 IAM 读取，本地用 .env 或脚本注入。

**资源命名约定**

| 类型           | 命名                           | 说明         |
|----------------|--------------------------------|--------------|
| DynamoDB 表    | `casfa-next-<table>`           | 共用，无 stage |
| S3 blob 桶     | `casfa-next-blob`              | 共用         |
| S3 前端桶      | `casfa-next-frontend-${stage}` | 每 stage 一个 |
| Lambda/API/CF  | 名含 `${stage}`                | 每 stage 一套 |
| CloudWatch     | 随 Lambda 名                   | 按 stage 分开 |

---

## 第二节：环境与端口

| 环境        | 用途     | 鉴权       | 数据存储           | 端口区段 |
|-------------|----------|------------|--------------------|----------|
| local-dev   | 本地开发 | Cognito    | 持久化本地         | 710x     |
| local-test  | 本地 E2E | mock token | 内存/临时，跑完清空 | 711x     |
| beta        | 线上预发 | Cognito    | DynamoDB + S3 共用 | —        |
| prod        | 线上生产 | Cognito    | DynamoDB + S3 共用 | —        |

**端口分配**

| 偏移 | 服务     | local-dev | local-test |
|------|----------|-----------|------------|
| +0   | 前端     | 7100      | 7110       |
| +1   | API      | 7101      | 7111       |
| +2   | DynamoDB | 7102      | 7112       |
| +3   | S3（若单独） | 7103   | 7113       |
| +4～+9 | 预留  | 7104–7109 | 7114–7119  |

本地不通过 Serverless stage 区分环境，由 `dev` / `dev:test` 脚本写死端口与存储/鉴权模式。

---

## 第三节：目录结构

```
apps/server-next/
├── serverless.yml
├── package.json
├── backend/                 # 服务端（原 src 移入）
│   ├── app.ts, lambda.ts, config.ts
│   ├── db/, controllers/, middleware/, ...
│   └── __tests__/           # 单元测试，xxx.test.ts
├── frontend/
│   ├── package.json, 构建配置
│   └── __tests__/
├── shared/                  # 前后端共用 schema、type、API 协议
├── tests/                   # 仅 E2E
│   ├── setup.ts
│   └── *.test.ts
├── scripts/
│   ├── e2e-offline.ts       # 起 dev:test + 跑 E2E
│   ├── dev.ts               # 起 local-dev
│   └── dev-test.ts          # 起 local-test
└── .local-storage/          # local-dev 持久化（gitignore）
```

- 单元测试：与代码同层 `__tests__/`，文件 `xxx.test.ts`。
- E2E：顶层 `tests/`；`tests/setup.ts` 使用 `BASE_URL` 等。
- serverless.yml 中 Lambda handler 指向 `backend/lambda.handler`。

---

## 第四节：本地 dev / test 流程

- **`bun run dev`**：启动 local-dev（前端 7100、API 7101、DynamoDB 7102）；持久化存储；**默认设 `MOCK_JWT_SECRET`，使用 mock 鉴权**。
- **`bun run dev:cognito`**：同一条命令同时起前端与 API，**不设 `MOCK_JWT_SECRET`，使用 Cognito**；端口与其余约定不变。
- **`bun run dev:test`**：启动 local-test（API 7111，可选前端 7110）；内存/临时存储；设 `MOCK_JWT_SECRET`，mock 鉴权；不跑测试。
- **`bun run test:e2e`**：先启动 `bun run dev:test`，就绪后对 `http://localhost:7111` 跑 E2E，结束后退出。

鉴权：有 `MOCK_JWT_SECRET` 即 mock，无则 Cognito；不设 `AUTH_MODE`。

**环境变量统一**：local-dev、local-test、beta、prod 使用同一套变量名，仅值不同（见下表示例）。

| 变量名               | local-dev        | local-test     | beta/prod   |
|----------------------|------------------|----------------|-------------|
| MOCK_JWT_SECRET      | 设（默认 mock）  | 固定值         | 不设或空    |
| COGNITO_*            | 同线上           | 可不设        | 同线上      |
| DYNAMODB_ENDPOINT    | http://localhost:7102 | 不设（内存） | 不设        |
| S3/STORAGE_*         | 本地路径         | 内存/临时     | 真实桶/配置 |

DynamoDB local-dev：serverless-dynamodb-local 或可执行，端口 7102。local-test：backend 注入内存 store，不启独立进程。S3 local-dev：本地目录；local-test：内存或临时目录。

---

## 第五节：部署与构建

- 部署：`bunx serverless deploy --stage beta` | `--stage prod`。
- 后端：serverless-esbuild 打包 `backend/`，handler `backend/lambda.handler`。
- 前端：deploy 前或 hook 内 `frontend` build，产物上传 `casfa-next-frontend-${stage}`。
- CloudFront：每 stage 一个 distribution；前端 origin 为对应前端桶；API 可同域转发或前端直连 API URL。
- 日志：Lambda Log Group 按 stage 自动区分。
- Secrets：Cognito 等密钥放 Secrets Manager；Lambda IAM 读取；本地同名单一变量由 .env/脚本注入。

---

## 第六节：错误处理与测试

- 错误：沿用 Hono `onError`/`notFound`，统一 JSON；不在响应中泄露敏感信息，仅打日志。
- 单元测试：`__tests__/` 下 `xxx.test.ts`；`bun run test:unit` 扫描 backend（及可选 frontend）。
- E2E：顶层 `tests/`，`bun run test:e2e` 先起 dev:test 再跑；无 Docker。

---

## 实施状态

Phase 1–4（目录迁移、统一配置、本地 dev/dev:test 与端口、文档）已完成。后续：DynamoDB/S3 真实实现与 beta/prod 部署（含 CloudFront、前端 build 上传）。
