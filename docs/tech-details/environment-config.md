# 环境配置规范

## 概览

CASFA 定义四套标准环境，覆盖从本地测试到线上生产的完整生命周期。

| 维度 | test | dev | staging | prod |
|------|------|-----|---------|------|
| **用途** | 本地 E2E 测试 | 本地开发 | 线上预备 | 线上生产 |
| **Storage** | memory | fs (本地) | S3 (共享) | S3 (共享) |
| **DynamoDB** | 本地 in-memory | 本地持久化 | AWS (共享) | AWS (共享) |
| **Redis** | 本地 Docker | 本地 Docker | 禁用（初期） | 禁用（初期） |
| **Auth** | Mock JWT | Cognito | Cognito | Cognito |
| **Stack** | 本地 (Bun) | 本地 (SAM) | Lambda | Lambda |
| **Domain** | localhost:随机端口 | localhost:8901 | staging.casfa.shazhou.me | casfa.shazhou.me |

---

## §1 数据层 (Storage + DynamoDB)

### 1.1 CAS Storage

| 环境 | 后端 | 配置 | 数据持久性 |
|------|------|------|-----------|
| test | `@casfa/storage-memory` | 无需配置 | 进程结束即丢弃 |
| dev | `@casfa/storage-fs` | `STORAGE_FS_PATH=./.local-storage` | 持久化到本地磁盘 |
| staging | `@casfa/storage-s3` | 共用 prod 的 S3 Bucket | 持久化 |
| prod | `@casfa/storage-s3` | `CAS_BUCKET`, `CAS_PREFIX`, `CAS_REGION` | 持久化 |

> **staging 与 prod 共享同一个 S3 Bucket**。CAS 是内容寻址存储，相同 hash 指向相同内容，共享存储不会造成冲突，反而能让 staging 直接使用已有数据进行验证。

### 1.2 DynamoDB

| 环境 | 实例 | 端口 | 数据持久性 | 表名后缀 |
|------|------|------|-----------|---------|
| test | Docker `dynamodb-local` (`-inMemory`) | 8701 | 进程结束即丢弃 | 无后缀 |
| dev | Docker `dynamodb-local` (持久化卷) | 8700 | 持久化到 Docker volume | 无后缀 |
| staging | AWS DynamoDB | — | 持久化 | `-staging` |
| prod | AWS DynamoDB | — | 持久化 | `-prod` |

**表名规则**：

| 表 | 本地 (test/dev) | staging | prod |
|----|----------------|---------|------|
| Tokens | `cas-tokens` | `cas-tokens-staging` | `cas-tokens-prod` |
| Realm | `cas-realm` | `cas-realm-staging` | `cas-realm-prod` |
| RefCount | `cas-refcount` | `cas-refcount-staging` | `cas-refcount-prod` |
| Usage | `cas-usage` | `cas-usage-staging` | `cas-usage-prod` |

> **staging 与 prod 共享同一个 AWS 账号和区域下的 DynamoDB**，通过表名后缀隔离数据。

---

## §2 Redis

| 环境 | 实例 | 端口/地址 | 持久化 | Key 前缀 |
|------|------|----------|--------|---------|
| test | Docker `redis-test` | `localhost:6380` | 无 | `cas:test:` |
| dev | Docker `redis` | `localhost:6379` | AOF | `cas:` |
| staging | 禁用 | — | — | — |
| prod | 禁用 | — | — | — |

> **初期 staging/prod 不启用 Redis**。代码已支持 graceful degradation（`REDIS_ENABLED=false` 时自动跳过缓存，直连 DynamoDB）。启用 ElastiCache 需要将 Lambda 放入 VPC，引入冷启动增加和 NAT Gateway 成本（约 $30/月），待性能确实需要时再引入。

---

## §3 Auth

| 环境 | 方式 | User Pool | App Client |
|------|------|-----------|------------|
| test | Mock JWT | — | — |
| dev | Cognito | 共享 | dev 专用 Client |
| staging | Cognito | 共享 | staging/prod 共用 Client |
| prod | Cognito | 共享 | staging/prod 共用 Client |

> **dev / staging / prod 共用同一个 Cognito User Pool**，用户账号三环境通用。
>
> **App Client 分离**：dev 使用独立的 App Client（允许 `localhost` callback），staging/prod 共用另一个 App Client（仅允许线上域名 callback）。这避免了将 `localhost` 注册到生产 App Client 的 Callback URLs 中带来的安全风险。

### 3.1 Cognito App Clients

| App Client | 环境 | Allowed Callback URLs |
|------------|------|----------------------|
| dev client | dev | `http://localhost:8901/api/oauth/callback` |
| prod client | staging, prod | `https://staging.casfa.shazhou.me/api/oauth/callback`, `https://casfa.shazhou.me/api/oauth/callback` |

---

## §4 Stack / 运行方式

| 环境 | 运行时 | 入口 | 基础设施 |
|------|--------|------|---------|
| test | Bun (进程内) | `backend/server.ts` | 测试框架直接启动 |
| dev | Bun (本地) | `backend/server.ts` via `dev.ts` | Docker (DynamoDB + Redis) |
| staging | AWS Lambda (ARM64) | `backend/src/handler.ts` | SAM/CloudFormation |
| prod | AWS Lambda (ARM64) | `backend/src/handler.ts` | SAM/CloudFormation |

### 4.1 本地 Docker 服务 (test & dev)

`docker-compose.yml` 提供四个容器：

| 容器 | 端口 | 用途 |
|------|------|------|
| `dynamodb` | 8700 | dev 持久化 DynamoDB |
| `dynamodb-test` | 8701 | test 临时 DynamoDB |
| `redis` | 6379 | dev 持久化 Redis |
| `redis-test` | 6380 | test 临时 Redis |

### 4.2 SAM Stack (staging & prod)

两个独立的 CloudFormation stack，各自部署完整资源集合（除共享的 S3 Bucket 外）：

| 资源 | staging stack | prod stack |
|------|--------------|-----------|
| Stack 名称 | `casfa-staging` | `casfa-prod` |
| Lambda | 独立 Function | 独立 Function |
| API Gateway | 独立 HTTP API | 独立 HTTP API |
| DynamoDB 表 | 4 张（`-staging` 后缀） | 4 张（`-prod` 后缀） |
| S3 CAS Bucket | **共享**（引用外部 Bucket） | **共享**（引用外部 Bucket） |
| S3 Frontend Bucket | 独立 | 独立 |
| CloudFront | 独立分配 | 独立分配 |
| WAF | 独立 WebACL | 独立 WebACL |

> **S3 CAS Bucket 共享实现**：当前 `template.yaml` 中 `CasStorageBucket` 是 stack 内创建的资源（名称含 StageName），两个 stack 会各自创建独立 Bucket。要实现共享，需要将 CAS Bucket 改为**外部参数**——先由 prod stack 创建 Bucket，staging stack 通过 `CasBucketName` 参数引用同一 Bucket（不再自行创建）。
>
> **DynamoDB DeletionPolicy**：当前所有表均为 `Retain`。建议 staging 表改为 `Delete`，避免 stack 删除后产生孤儿资源。可通过 Condition 按 StageName 控制。

---

## §5 Domain / 网络

| 环境 | 域名 | HTTPS | 备注 |
|------|------|-------|------|
| test | `localhost:<random>` | 否 | 端口由测试框架随机分配 |
| dev | `localhost:8901` | 否 | 前端 Vite 代理到 8801 后端 |
| staging | `staging.casfa.shazhou.me` | 是 (ACM) | CloudFront + Route53 |
| prod | `casfa.shazhou.me` | 是 (ACM) | CloudFront + Route53 |

### 5.1 端口约定 (本地)

| 端口 | 用途 |
|------|------|
| 8700 | DynamoDB Local (dev 持久化) |
| 8701 | DynamoDB Local (test 临时) |
| 8801 | 后端 API 服务 |
| 8901 | 前端 Vite 开发服务器 |
| 6379 | Redis (dev 持久化) |
| 6380 | Redis (test 临时) |

---

## §6 环境变量映射

### 6.1 完整变量表

| 变量 | test | dev | staging | prod |
|------|------|-----|---------|------|
| `STORAGE_TYPE` | `memory` | `fs` | `s3` | `s3` |
| | | | *(Lambda 模板中为 `CAS_STORAGE_TYPE`，需统一)* | |
| `STORAGE_FS_PATH` | — | `./.local-storage` | — | — |
| `CAS_BUCKET` | — | — | `casfa-storage-prod` | `casfa-storage-prod` |
| `CAS_PREFIX` | — | — | `cas/v1/` | `cas/v1/` |
| `CAS_REGION` | — | — | `us-east-1` | `us-east-1` |
| `DYNAMODB_ENDPOINT` | `http://localhost:8701` | `http://localhost:8700` | — (AWS 默认) | — (AWS 默认) |
| `TOKENS_TABLE` | `cas-tokens` | `cas-tokens` | `cas-tokens-staging` | `cas-tokens-prod` |
| `CAS_REALM_TABLE` | `cas-realm` | `cas-realm` | `cas-realm-staging` | `cas-realm-prod` |
| `CAS_REFCOUNT_TABLE` | `cas-refcount` | `cas-refcount` | `cas-refcount-staging` | `cas-refcount-prod` |
| `CAS_USAGE_TABLE` | `cas-usage` | `cas-usage` | `cas-usage-staging` | `cas-usage-prod` |
| `REDIS_ENABLED` | `true` | `true` | `false` | `false` |
| `REDIS_URL` | `redis://localhost:6380` | `redis://localhost:6379` | — | — |
| `REDIS_KEY_PREFIX` | `cas:test:` | `cas:` | — | — |
| `MOCK_JWT_SECRET` | `test-secret-key-for-e2e` | — | — | — |
| `COGNITO_USER_POOL_ID` | — | 统一值 | 统一值 | 统一值 |
| `CASFA_COGNITO_CLIENT_ID` | — | dev 专用 Client ID | prod Client ID | prod Client ID |
| `COGNITO_REGION` | — | `us-east-1` | `us-east-1` | `us-east-1` |
| `COGNITO_HOSTED_UI_URL` | — | Cognito 域名 | Cognito 域名 | Cognito 域名 |
| `PORT` | 随机 | `8801` | — (Lambda) | — (Lambda) |
| `BASE_URL` | `http://localhost:<port>` | `http://localhost:8901` | `https://staging.casfa.shazhou.me` | `https://casfa.shazhou.me` |

---

## §7 Preset 映射（dev.ts CLI）

当前 `dev.ts` 中的 preset 名称与新规范的对应关系：

| 新环境名 | 当前 preset | `--db` | `--storage` | `--auth` |
|---------|------------|--------|------------|---------|
| test (`e2e`) | `e2e` | `memory` | `memory` | `mock` |
| dev (`local`) | `local` | `persistent` | `fs` | `cognito` |

> staging / prod 不使用本地 `dev.ts`，而是通过 `sam deploy` 部署。

建议将 preset 名称统一为 `test` 和 `dev`，与环境名称保持一致：

```
bun run dev -- --preset test    # 原 e2e
bun run dev -- --preset dev     # 原 local（默认）
```

---

## §8 `samconfig.toml` 配置

```toml
[default.deploy.parameters]           # prod
stack_name = "casfa-prod"
parameter_overrides = [
  "StageName=prod",
  "CognitoUserPoolId=...",
  "CognitoClientId=...",
  "DomainName=casfa.shazhou.me",
  "CertificateArn=...",
  "HostedZoneId=...",
  "LambdaMemorySize=512",
]

[staging.deploy.parameters]           # staging
stack_name = "casfa-staging"
parameter_overrides = [
  "StageName=staging",
  "CognitoUserPoolId=...",           # 与 prod 相同
  "CognitoClientId=...",             # 与 prod 相同（staging/prod 共用 prod App Client）
  "DomainName=staging.casfa.shazhou.me",
  "CertificateArn=...",
  "HostedZoneId=...",
  "LambdaMemorySize=512",             # 与 prod 保持一致
]
```

---

## §9 Bun Scripts（`apps/server/package.json`）

所有常用的开发、测试、构建、部署命令统一收录为 bun script，避免记忆裸 CLI 命令。

### 9.1 现有 Scripts

| 命令 | 环境 | 说明 |
|------|------|------|
| `bun run dev` | dev | 交互式本地开发（preset 选择器，自动启动 Docker） |
| `bun run dev -- --preset test` | test | 以 test preset 启动（原 `e2e`） |
| `bun run dev:simple` | — | 直接启动 `backend/server.ts`（不管理 Docker） |
| `bun run test:unit` | — | 单元测试 |
| `bun run test:e2e` | test | E2E 测试（自动管理容器和表） |
| `bun run test:e2e:debug` | test | E2E 调试模式（不清理容器） |
| `bun run build` | — | 构建前端 + 后端 |
| `bun run sam:build` | — | 构建 + SAM build |
| `bun run sam:deploy` | prod | `sam deploy`（使用 default config） |
| `bun run deploy:frontend` | prod | 同步前端到 S3 + CloudFront 缓存失效 |
| `bun run deploy:all` | prod | build + deploy backend + deploy frontend |
| `bun run db:create` | dev | 创建本地 DynamoDB 表（port 8700） |
| `bun run db:create:test` | test | 创建测试 DynamoDB 表（port 8701） |
| `bun run db:delete` | dev | 删除本地 DynamoDB 表 |
| `bun run dev:clean` | dev/aws | 清理孤儿 S3 对象 |
| `bun run set-admin` | dev | 本地设置管理员 |
| `bun run set-admin:aws` | prod | AWS 设置管理员 |
| `bun run check` | — | typecheck + lint |

### 9.2 需要新增的 Scripts

| 命令 | 说明 | 实际命令 |
|------|------|---------|
| `bun run deploy:staging` | 部署到 staging | `sam deploy --config-env staging` |
| `bun run deploy:staging:all` | 构建 + 部署 staging（后端 + 前端） | build + sam deploy staging + 前端同步到 staging S3 |
| `bun run deploy:frontend:staging` | 仅部署 staging 前端 | S3 sync + CloudFront invalidation（staging stack） |
| `bun run logs` | 查看 prod Lambda 日志 | `sam logs -n CasfaFunction --stack-name casfa-prod --tail` |
| `bun run logs:staging` | 查看 staging Lambda 日志 | `sam logs -n CasfaFunction --stack-name casfa-staging --tail` |
| `bun run status` | 查看 prod stack 状态 | `aws cloudformation describe-stacks --stack-name casfa-prod` |
| `bun run status:staging` | 查看 staging stack 状态 | `aws cloudformation describe-stacks --stack-name casfa-staging` |

### 9.3 命名约定

```
<action>                     → 默认操作 prod 环境
<action>:staging             → 操作 staging 环境
<action>:test                → 操作 test 环境

deploy:all                   → 全量部署（build + backend + frontend）
deploy:frontend              → 仅前端
deploy:staging               → 仅后端（staging）
deploy:staging:all           → 全量（staging）

logs / logs:staging          → 实时日志
status / status:staging      → stack 状态
```

---

## §10 数据共享关系图

```
┌─────────────────────────────────────────────────────────┐
│                     AWS Account                         │
│                                                         │
│  ┌──────────────┐              ┌──────────────┐         │
│  │ casfa-staging│              │  casfa-prod  │         │
│  │    stack     │              │    stack     │         │
│  └──────┬───────┘              └──────┬───────┘         │
│         │                             │                 │
│  ┌──────▼───────┐              ┌──────▼───────┐         │
│  │  DynamoDB    │              │  DynamoDB    │         │
│  │  *-staging   │              │   *-prod     │         │
│  └──────────────┘              └──────────────┘         │
│                                                         │
│         │              ┌──────────────┐       │         │
│         └──────────────►  S3 Bucket   ◄───────┘         │
│                        │  (共享 CAS)  │                 │
│                        └──────────────┘                 │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Cognito User Pool (共享)                           │   │
│  │    ├── dev App Client (localhost callback)         │   │
│  │    └── prod App Client (staging + prod callback)  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  [初期无 Redis；REDIS_ENABLED=false，待需要时引入 ElastiCache]  │
└─────────────────────────────────────────────────────────┘
```

---

## §11 与现状的差异 & 迁移步骤

### 11.1 需要变更的部分

| 项目 | 现状 | 目标 | 改动 |
|------|------|------|------|
| Preset 命名 | `e2e` / `local` / `dev` | `test` / `dev` | 重命名 `dev.ts` 中的 preset |
| S3 共享 | 每个 stack 创建独立 Bucket | staging 引用 prod Bucket | `template.yaml` 改 CAS Bucket 为外部参数；`samconfig.toml` 传入 Bucket 名 |
| ElastiCache | 未配置 | 初期不启用（`REDIS_ENABLED=false`） | 待性能需要时再引入 ElastiCache + VPC |
| Redis 环境变量 | 模板中未传入 | 需传入 Lambda | `template.yaml` 添加 `REDIS_ENABLED`, `REDIS_URL`, `REDIS_KEY_PREFIX` |
| `STORAGE_TYPE` 命名 | 本地用 `STORAGE_TYPE`，模板用 `CAS_STORAGE_TYPE` | 统一 | 二选一并同步更新代码和模板 |
| 域名 (staging) | 无 | `staging.casfa.shazhou.me` | Route53 / ACM / samconfig 添加 |
| Cognito App Client | dev/staging/prod 共用 1 个 Client | dev 独立 Client + staging/prod 共用 Client | Cognito 创建新 App Client，`samconfig.toml` 填入参数 |
| Redis key prefix | 全部 `cas:` | 按环境区分 | 更新 config 默认值或 env var |
| test Redis prefix | `cas:` | `cas:test:` | 更新 e2e setup |
| staging DeletionPolicy | 全部 `Retain` | staging 表改 `Delete` | `template.yaml` 添加 Condition |
| staging Lambda 内存 | 256MB | 512MB（与 prod 一致） | `samconfig.toml` 更新 `LambdaMemorySize` |
| 部署/运维 Scripts | 缺少 staging 部署和日志命令 | 统一 bun script | `package.json` 新增 §9.2 中的 scripts |

### 11.2 无需变更的部分

- Docker Compose 容器结构（已正确分离 test/dev）
- Storage 选择逻辑（已支持 memory/fs/s3）
- Auth 分支逻辑（已支持 mock/cognito）
- DynamoDB 表结构
- Lambda handler 入口
- 本地 server 入口

---

## §12 文件索引

| 文件 | 职责 |
|------|------|
| `apps/server/docker-compose.yml` | 本地 Docker 服务 (DynamoDB + Redis) |
| `apps/server/samconfig.toml` | SAM 部署参数 (staging / prod) |
| `apps/server/template.yaml` | CloudFormation 模板 |
| `apps/server/.env.example` | 环境变量文档 |
| `apps/server/backend/scripts/dev.ts` | 本地开发 CLI (preset 管理) |
| `apps/server/backend/scripts/integration-test.ts` | E2E 测试运行器 |
| `apps/server/backend/server.ts` | 本地 Bun 服务入口 |
| `apps/server/backend/src/handler.ts` | Lambda 入口 |
| `apps/server/backend/src/config.ts` | 配置类型与加载 |
| `apps/server/backend/src/bootstrap.ts` | 依赖注入工厂 |
| `apps/server/backend/e2e/setup.ts` | E2E 测试 setup |
