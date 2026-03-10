---
name: cell-development
description: Develop and deploy casfa Cell services. Use when working with cell.yaml, cell-cli, Cell app structure, params/env, instance overrides, or deploying Cell apps to AWS.
---

# Cell 开发

Cell 是 casfa 全栈服务的统一抽象：一个 bun package + 声明式 `cell.yaml`，由 `cell` CLI 提供本地开发、构建、测试和部署。

## 核心概念

| 概念 | 说明 |
|------|------|
| **Cell** | 一个带 `cell.yaml` 的应用目录；描述 backend/frontend、tables、buckets、params、domain 等 |
| **Stage** | `dev`（本地 Docker）、`test`（本地测试）、`cloud`（AWS） |
| **Params** | 环境变量的单一来源；在 `cell.yaml` 的 `params` 中声明，通过 `!Env` / `!Secret` 从 .env 或 Secrets Manager 解析 |
| **Instance** | 同一 cell 的不同部署配置；通过 `cell.<instance>.yaml` 覆盖 `params`，用 `-i <instance>` 选择 |

**端口约定**（由 `PORT_BASE` 决定，默认 7100）：

- Frontend: PORT_BASE+0
- Backend: PORT_BASE+1
- DynamoDB (dev): PORT_BASE+2
- MinIO (S3): PORT_BASE+4  
- Test 阶段: Backend PORT_BASE+11, DynamoDB PORT_BASE+12, MinIO PORT_BASE+14

## 文件结构

```
<cell-dir>/
├── cell.yaml              # 主配置（必填，提交）
├── cell.<instance>.yaml   # 实例覆盖，仅 params（可选，提交）
├── .env.example           # 部署/共享 env 模板 + 推荐值（提交）
├── .env.local.example     # 本地覆盖模板 + 推荐值（提交）
├── .env                   # 实际配置（不提交）
├── .env.local             # 本地覆盖（不提交）
├── backend/
│   ├── lambda.ts          # Lambda handler
│   ├── dev-app.ts         # 或 app.ts，Hono app（cell dev 用）
│   └── ...
├── frontend/
│   ├── index.html
│   ├── vite.config.ts     # 可选
│   └── ...
└── .cell/                 # CLI 生成（gitignore）
```

- **cell.yaml**：写死非敏感、本地与线上一致、不随实例变的配置；敏感或随实例变的用 `!Env` / `!Secret`。
- **cell.\<instance>.yaml**：只允许顶层 `params`，用于覆盖默认 params（如不同域名、不同 Cognito、Cloudflare DNS）。
- **.env 加载顺序**（后者覆盖）：根目录 .env（如有）→ cell 的 .env → cell 的 .env.local；cloud 阶段不读 .env.local。

## 配置规则（cell-config-rules）

- 每个 `!Env` / `!Secret` 必须在 .env（或 .env.local）中提供，否则报 MissingParamsError。
- 非 secret 的必填项要在 `.env.example` 和 `.env.local.example` 里写推荐值并提交。
- 不在 cell.yaml 里写「可选」env；声明了就要在 example 里给齐。

## CLI 用法

在 cell 目录下执行（或通过 monorepo 的 `bun run cell` 转发）：

| 命令 | 说明 |
|------|------|
| `cell init [name]` | 新建 cell，生成 cell.yaml、.env.example、.gitignore |
| `cell setup` | 复制 .env.example→.env，.env.local.example→.env.local |
| `cell dev` | 启动本地开发（Docker DynamoDB + MinIO、后端 Bun、前端 Vite），需 .env |
| `cell build` | 构建 frontend + backend 产物 |
| `cell deploy` | 部署到 AWS；多域名时用 `--domain <alias>`（先 `cell domain list`） |
| `cell test` / `cell test:unit` / `cell test:e2e` | 跑测试 |
| `cell logs` | 查看 CloudWatch 日志 |
| `cell status` | 查看 CloudFormation stack 状态 |
| `cell secret set/get/list` | Secrets Manager 读写 |
| `cell domain list` | 列出配置的域名别名（配合 deploy --domain 使用） |
| `cell aws login` / `cell aws logout` | AWS SSO（用 .env 的 AWS_PROFILE） |

**实例选择**：需要某套 params 时加 `-i <instance>`，例如：

- `cell dev -i symbiont`
- `cell deploy -i symbiont`
- `cell domain list -i symbiont`

CLI 会加载 `cell.yaml` 再合并 `cell.<instance>.yaml` 的 `params`。

## cell.yaml 要点

- **name**：cell 名，用于资源命名（表名、bucket 名等）。
- **bucketNameSuffix**：cloud 部署且用 frontend/buckets 时必填，避免 S3 全局命名冲突（如 `casfa-shazhou-me`）。
- **backend.entries**：每个 entry 一个 Lambda；需 `handler`、`app`（或同目录 `app.ts`）、`timeout`、`memory`、`routes`。
- **frontend.entries**：每个 entry 一个构建产物；`entry` 如 `index.html`，`routes` 如 `["/*"]`。
- **tables**：DynamoDB 表声明（keys、gsi）；CLI 自动建表并注入 `DYNAMODB_TABLE_<KEY>`。
- **buckets**：S3 bucket 声明；CLI 注入 `S3_BUCKET_<KEY>`。
- **params**：环境变量；字面量、`!Env VAR`、`!Secret`（无参时 key 即 secret 名）、或对象（如 DNS）。其他段用 `!Param KEY` 引用 params。
- **domain**（单域）或 **domains**（多域）：host、dns（route53/cloudflare 或对象）；Cloudflare 需 zoneId + apiToken（或顶层 cloudflare.apiToken）。
- **cognito**：可选；用 `!Param` 引用 COGNITO_* params；`cell dev` 会为本地 callback URL 注册 Cognito。

## 新建 Cell 清单

1. 在应用目录执行 `cell init [name]`。
2. 编辑 `cell.yaml`：backend/frontend/tables/buckets/params/domain 等。
3. 在 params 中只对「敏感或随环境/实例变化」的项使用 `!Env` / `!Secret`；其余写死。
4. 维护 `.env.example` 和 `.env.local.example`，列出所有需在 .env 提供的 key 及推荐值。
5. 运行 `cell setup`，编辑 `.env` / `.env.local`。
6. 运行 `cell dev` 验证；需要多实例时添加 `cell.<instance>.yaml` 并用 `-i <instance>`。

## 参考

- 配置规则详解：项目根目录 [docs/cell-config-rules.md](docs/cell-config-rules.md)。
- 设计文档：`docs/plans/2026-03-04-cell-cli-design.md`。
- 实现与 schema：`apps/cell-cli/src/config/`（load-cell-yaml、resolve-config、cell-yaml-schema）。
- 示例 cell：`apps/sso`、`apps/server-next`、`apps/agent`、`apps/image-workshop`。
