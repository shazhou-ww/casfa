# Cell CLI 设计文档

## 概述

Cell 是对 casfa 全栈服务的统一抽象。每个 Cell 是一个 bun package，通过一个声明式的 `cell.yaml` 描述服务的所有资源和配置。`cell` CLI 工具基于此文件提供本地开发、测试、静态检查、构建和部署的完整工作流。

### 解决的问题

1. **线上线下不一致**：本地用 Docker DynamoDB + MinIO 模拟真实 AWS 资源，CLI 统一注入环境变量，消除手工配置差异
2. **重复搭建脚手架**：所有服务共用同一套 CLI，cell.yaml 描述差异，脚本逻辑零重复
3. **发布稳定性差**：CloudFormation 模板由 TypeScript 代码生成，可测试、可 diff、可审计，不依赖 Serverless Framework / SAM 的隐式行为
4. **手工云端设置**：域名、Secrets Manager 等操作全部由 CLI 命令完成

### 技术栈

- 运行时：Bun
- 后端框架：Hono（Lambda 适配器）
- 前端构建：Vite
- 后端构建：esbuild
- 基础设施：CloudFormation（CLI 直接生成模板，通过 AWS CLI 部署）
- 本地模拟：Docker（DynamoDB Local + MinIO）

---

## Stage 模型

| Stage | 环境 | DynamoDB | S3 | 用途 |
|-------|------|----------|-----|------|
| `dev` | 本地 | Docker，持久化，PORT_BASE+2 | MinIO，持久化，PORT_BASE+4 | 日常开发 |
| `test` | 本地 | Docker，in-memory，PORT_BASE+12 | MinIO，临时容器，PORT_BASE+14 | 测试，跑完清理 |
| `cloud` | AWS | DynamoDB 服务 | S3 服务 | 唯一的线上环境 |

端口分配由 `.env` 中的 `PORT_BASE` 决定（默认 7100）：

| 用途 | 偏移 | 示例（PORT_BASE=7100） |
|------|------|------------------------|
| HTTP dev server | +1 | 7101 |
| DynamoDB dev | +2 | 7102 |
| S3 dev (MinIO) | +4 | 7104 |
| HTTP test server | +11 | 7111 |
| DynamoDB test | +12 | 7112 |
| S3 test (MinIO) | +14 | 7114 |

如需 beta 环境，创建一个独立的 Cell（如 `name: casfa-next-beta`），拥有完全独立的资源和 stack。

---

## cell.yaml Schema

```yaml
name: casfa-next

# ── 后端 ──
# 每个 entry 对应一个独立的 Lambda 函数
backend:
  runtime: nodejs20.x
  entries:
    api:
      handler: backend/lambda.ts      # export handler
      timeout: 30
      memory: 1024
      routes: ["*"]                   # /api 下的子路由，"*" = 兜底

# ── 前端 ──
# 每个 entry 对应一个独立的 JS bundle，构建由 CLI 接管
frontend:
  dir: frontend
  entries:
    main:
      src: src/main.tsx
    sw:
      src: src/sw.ts

# ── 静态资源 ──
# 原样上传到 S3 frontend bucket 的对应路径
static:
  - src: static/.well-known
    dest: .well-known
  - src: static/assets
    dest: assets

# ── DynamoDB 表 ──
# 只声明 schema，CLI 自动处理命名和创建
tables:
  delegates:
    keys: { pk: S, sk: S }
    gsi:
      realm-index:
        keys: { gsi1pk: S, gsi1sk: S }
        projection: ALL
  grants:
    keys: { pk: S, sk: S }
    gsi:
      realm-hash-index:
        keys: { gsi1pk: S, gsi1sk: S }
        projection: ALL
      realm-refresh-index:
        keys: { gsi2pk: S, gsi2sk: S }
        projection: ALL

# ── S3 Buckets ──
buckets:
  blob: {}

# ── Params ──
# 所有 Lambda 环境变量的 single source of truth。
# key = 环境变量名（代码通过 process.env[key] 读取）。
# 字符串值 = 非敏感，直接写在这里。
# !Secret = 敏感值，本地从 .env 读取，线上从 Secrets Manager 读取。
# !Secret 无参数时 secret name = param key；!Secret custom-name 指定不同的 SM key。
params:
  COGNITO_REGION: us-east-1
  COGNITO_USER_POOL_ID: us-east-1_XxxYyy
  COGNITO_CLIENT_ID: abc123def456
  COGNITO_HOSTED_UI_URL: https://casfa.auth.us-east-1.amazoncognito.com
  ACM_CERTIFICATE_ARN: arn:aws:acm:us-east-1:123456789:certificate/xxx-yyy
  COGNITO_CLIENT_SECRET: !Secret
  MOCK_JWT_SECRET: !Secret

# ── Cognito ──
# 引用 params 中的值，CLI 组装 Lambda 环境变量时自动解析
cognito:
  region: !Param COGNITO_REGION
  userPoolId: !Param COGNITO_USER_POOL_ID
  clientId: !Param COGNITO_CLIENT_ID
  hostedUiUrl: !Param COGNITO_HOSTED_UI_URL
  clientSecret: !Param COGNITO_CLIENT_SECRET

# ── 自定义域名 ──
domain:
  zone: shazhou.me
  host: casfa.shazhou.me
  certificate: !Param ACM_CERTIFICATE_ARN

# ── 测试 ──
testing:
  unit: "**/__tests__/*.test.ts"       # 默认值
  e2e: "tests/*.test.ts"              # 默认值
```

### YAML 自定义指令

| 指令 | 语义 | 示例 |
|------|------|------|
| `!Secret` | 标记 param 为敏感值。本地从 `.env` 读取，线上从 Secrets Manager（key = `{name}/{param-key}`）读取 | `COGNITO_CLIENT_SECRET: !Secret` |
| `!Secret <name>` | 同上，但指定 Secrets Manager 中的 key 名 | `MY_KEY: !Secret custom-name` |
| `!Param <KEY>` | 引用 params 中另一个 key 的值。支持链式引用（A → B → C），不允许循环 | `region: !Param COGNITO_REGION` |

CLI 加载 cell.yaml 后做一次拓扑排序解析所有 `!Param` 引用。

### 自动生成的环境变量

除了 params 中声明的变量，CLI 还会自动注入以下环境变量到 Lambda：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DYNAMODB_TABLE_{TABLE_KEY}` | `{name}-{table-key}` | 每个 table 一个，如 `DYNAMODB_TABLE_DELEGATES=casfa-next-delegates` |
| `S3_BUCKET_{BUCKET_KEY}` | `{name}-{bucket-key}` | 每个 bucket 一个，如 `S3_BUCKET_BLOB=casfa-next-blob` |
| `FRONTEND_BUCKET` | `{name}-frontend` | 前端 bucket 名 |

本地 dev/test 时额外注入：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DYNAMODB_ENDPOINT` | `http://localhost:{port}` | 本地 DynamoDB 端点 |
| `S3_ENDPOINT` | `http://localhost:{port}` | 本地 MinIO 端点 |

---

## CLI 命令

包名 `@casfa/cell-cli`，位于 `apps/cell-cli`。所有命令在 Cell 目录（`cell.yaml` 所在目录）下执行。

| 命令 | 作用 |
|------|------|
| `cell dev` | 启动本地开发环境 |
| `cell build` | 构建前后端产物 |
| `cell typecheck` | TypeScript 类型检查 |
| `cell lint [--fix]` | 代码检查（biome），`--fix` 自动修复 |
| `cell test` | 跑全部测试（先 unit 再 e2e） |
| `cell test:unit` | 只跑 unit test |
| `cell test:e2e` | 只跑 e2e test（启动 test 环境 → 跑测试 → 清理） |
| `cell deploy` | 部署到 cloud |
| `cell logs` | 查看 CloudWatch 日志 |
| `cell status` | 查看 CloudFormation stack 状态 |
| `cell secret set <KEY>` | 写入 Secrets Manager |
| `cell secret get <KEY>` | 读取 Secrets Manager 中的值 |
| `cell secret list` | 列出所有已配置的 secrets |
| `cell init` | 初始化新 Cell（生成 cell.yaml 骨架、.env.example 等） |

### cell dev

1. 解析 cell.yaml
2. 读取 `.env`，检查所有 `!Secret` 类 param 是否已配置，缺少则提示
3. 从 `.env` 读 `PORT_BASE`（默认 7100），计算各端口
4. 启动 Docker DynamoDB（PORT_BASE+2），等待就绪
5. 启动 MinIO（PORT_BASE+4），等待就绪
6. 根据 `tables` 配置创建本地 DynamoDB 表（已存在则跳过）
7. 确保本地 S3 bucket 存在
8. 启动后端 Bun dev server（PORT_BASE+1），注入所有环境变量
9. 启动前端 Vite dev server（带 HMR）
10. 统一输出所有进程日志

### cell test

先跑 `cell test:unit`，再跑 `cell test:e2e`。

### cell test:unit

直接执行 `bun test` + unit test glob，无需启动本地服务。

### cell test:e2e

1. 计算 test 端口（PORT_BASE+12 系列）
2. 启动临时 Docker DynamoDB（in-memory 模式，PORT_BASE+12）
3. 启动临时 MinIO 容器（PORT_BASE+14）
4. 创建表 + bucket
5. 启动后端 server
6. 执行 e2e tests
7. 停止并删除所有临时容器

### cell build

1. 后端：对每个 `backend.entries`，用 esbuild 打包（target node20, cjs），产物输出到 `.cell/build/{entry-name}/`
2. 前端：对 `frontend.entries`，用 vite 构建，产物输出到 `.cell/build/frontend/`

### cell deploy

1. 解析 cell.yaml
2. 读取 `.env` 获取 AWS_PROFILE
3. 校验配置完整性（cloud 不允许有 MOCK_JWT_SECRET）
4. `cell build`（构建前后端）
5. 生成 CloudFormation 模板到 `.cell/cfn.yaml`
6. 执行 `aws cloudformation deploy`（默认 changeset 模式，输出变更列表等确认；`--yes` 跳过）
7. 上传 `static` 映射的文件到前端 S3 bucket
8. 上传前端构建产物到前端 S3 bucket
9. 查询 stack outputs，获取 CloudFront distribution ID
10. 创建 CloudFront cache invalidation
11. 同步 Route 53 记录
12. 输出部署 URL

### cell secret set/get/list

通过 AWS SDK 直接操作 Secrets Manager，key = `{cell-name}/{PARAM_KEY}`。

---

## CloudFormation 模板生成

CLI 内部维护一组模板生成器（generator），每个负责一类资源。各 generator 接收解析后的 cell.yaml 配置，输出 CloudFormation Resources / Outputs 片段，最后合并为一个完整模板。

```
cell.yaml
   │
   ├─ HttpApiGenerator       → HttpApi + ApiFunction(s) + IAM Role
   ├─ DynamoDBGenerator      → DynamoDB Table(s)
   ├─ S3Generator            → Blob Bucket(s) + Frontend Bucket
   ├─ CloudFrontGenerator    → Distribution + OAC + Cache Policy + SPA Fallback
   └─ DomainGenerator        → Route 53 RecordSet
         │
         ▼
   .cell/cfn.yaml            → aws cloudformation deploy
```

### 资源清单

单一 stack `{name}`，包含所有资源：

| 资源 | CloudFormation 类型 | 命名 |
|------|---------------------|------|
| **DynamoDB** | | |
| 每个 table entry | `AWS::DynamoDB::Table` | `{name}-{table-key}` |
| **S3** | | |
| 每个 bucket entry | `AWS::S3::Bucket` | `{name}-{bucket-key}` |
| Frontend bucket | `AWS::S3::Bucket` | `{name}-frontend` |
| Frontend bucket policy | `AWS::S3::BucketPolicy` | — |
| **Lambda** | | |
| 每个 backend entry | `AWS::Lambda::Function` | — |
| Lambda 执行角色 | `AWS::IAM::Role` | — |
| **API Gateway** | | |
| HTTP API | `AWS::ApiGatewayV2::Api` | — |
| Integration + Route | `AWS::ApiGatewayV2::Integration/Route` | — |
| **CloudFront** | | |
| Distribution | `AWS::CloudFront::Distribution` | — |
| OAC | `AWS::CloudFront::OriginAccessControl` | — |
| API Cache Policy | `AWS::CloudFront::CachePolicy` | — |
| SPA Fallback (Lambda@Edge) | `AWS::Lambda::Function` + `Version` + `IAM::Role` | — |
| **DNS** | | |
| Route 53 Record | `AWS::Route53::RecordSet` | 条件创建 |

### CloudFront 路由规则（自动生成）

| 路径 | Origin | 说明 |
|------|--------|------|
| `/api/*` | API Gateway | 转发 Authorization header，TTL=1 |
| `/oauth/callback` | API Gateway | Cognito OAuth 回调 |
| `/.well-known/*` | S3 Frontend | 静态资源 |
| `/*`（默认） | S3 Frontend | 前端 SPA + 静态资源 |

SPA fallback 由 Lambda@Edge origin-response 处理：非 `/api` 路径的 403/404 返回 `index.html`。

### 部署安全措施

1. **DeletionPolicy: Retain**：DynamoDB 表和 blob S3 bucket 设置 Retain，stack 删除不丢数据
2. **部署前 diff**：默认 changeset 模式，输出变更列表等用户确认后再执行（`--yes` 跳过）
3. **Secrets 不入模板**：通过 `{{resolve:secretsmanager:{name}/{key}}}` 动态引用
4. **模板快照测试**：generator 输出可做 snapshot 测试

---

## 项目结构

```
apps/cell-cli/
├── package.json
├── src/
│   ├── cli.ts                    # 入口，commander 命令注册
│   ├── config/
│   │   ├── load-cell-yaml.ts     # 解析 cell.yaml（含 !Param / !Secret tag）
│   │   └── resolve-params.ts     # 拓扑排序解析 !Param 引用
│   ├── commands/
│   │   ├── dev.ts
│   │   ├── test.ts
│   │   ├── build.ts
│   │   ├── deploy.ts
│   │   ├── lint.ts
│   │   ├── typecheck.ts
│   │   ├── logs.ts
│   │   ├── status.ts
│   │   ├── secret.ts
│   │   └── init.ts
│   ├── generators/               # CloudFormation 模板生成器
│   │   ├── dynamodb.ts
│   │   ├── s3.ts
│   │   ├── lambda.ts
│   │   ├── api-gateway.ts
│   │   ├── cloudfront.ts
│   │   ├── domain.ts
│   │   └── merge.ts              # 合并所有 generator 输出
│   ├── local/                    # 本地开发环境管理
│   │   ├── docker.ts             # Docker 容器生命周期
│   │   ├── dynamodb-local.ts     # 本地 DynamoDB 表创建
│   │   └── minio-local.ts        # 本地 MinIO bucket 创建
│   └── utils/
│       ├── aws.ts                # AWS SDK 封装
│       ├── env.ts                # .env 文件读取
│       └── exec.ts               # 子进程执行
```

构建产物和中间文件统一放在 Cell 目录下的 `.cell/`，加入 `.gitignore`。
