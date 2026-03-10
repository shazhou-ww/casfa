# Cell 配置参考

仅列 agent 可能查的细节；日常以 SKILL.md 为主。

## YAML 自定义标签（load-cell-yaml）

| 标签 | 含义 | 允许位置 |
|------|------|----------|
| `!Env VAR` | 值从环境变量 `VAR` 读取 | 仅 `params` |
| `!Env`（无参） | 等价于 `!Env <当前 param key>` | 仅 `params` |
| `!Secret name` | 值从 .env/Secrets Manager 的 key `name` 读取 | 仅 `params`（及顶层 cloudflare.apiToken） |
| `!Secret`（无参） | 等价于 `!Secret <当前 param key>` | 仅 `params` |
| `!Param KEY` | 引用已解析的 param `KEY`，可嵌套 | 任意段（如 domain、cognito） |

解析顺序：先解析 params（拓扑序处理 $ref），再对整棵树做 deepResolveRefs 把 `!Param` 换成值。

## Instance 文件

- 文件名：`cell.<instance>.yaml`，`<instance>` 仅允许 `[a-zA-Z0-9_-]+`。
- 内容：只允许顶层 `params`；值可为 string、`!Env`、`!Secret`、或对象（如 DNS）。
- 与 base 合并：`loadCellConfig(cellDir, instance)` 先读 `cell.yaml`，再读 `cell.<instance>.yaml`，用 instance 的 params 覆盖 base 的 params。

## resolve-config 注入的环境变量

- 所有 params 解析后按 key 注入。
- `DYNAMODB_TABLE_<KEY>`：每个 tables 条目。
- `S3_BUCKET_<KEY>`：每个 buckets 条目。
- `FRONTEND_BUCKET`：前端静态资源 bucket。
- `CELL_STAGE`：dev | test | cloud。
- `CELL_BASE_URL`：仅 cloud，https://<domain.host>。
- dev/test 阶段：`DYNAMODB_ENDPOINT`、`S3_ENDPOINT` 由 PORT_BASE 推算。

## BackendEntry（cell-yaml-schema）

- `handler`：Lambda handler 路径（相对 backend.dir）。
- `app`：Hono app 模块路径（cell dev 用）；不写则取 handler 同目录的 `app.ts`。
- `timeout`、`memory`、`routes`：Lambda 配置与路由前缀。

## DomainConfig

- `host`：主域名。
- `dns`：`"route53"` | `"cloudflare"` | 对象。Route53 需 `zone`；Cloudflare 需 `zoneId` + `apiToken`（或顶层 cloudflare.apiToken）。
- 多域用 `domains`（别名 → config），deploy 时用 `--domain <alias>`。

## 参考代码路径

- 加载与解析：`apps/cell-cli/src/config/load-cell-yaml.ts`
- 解析 params + 注入表/bucket/域名：`apps/cell-cli/src/config/resolve-config.ts`
- Schema 与类型：`apps/cell-cli/src/config/cell-yaml-schema.ts`
- .env 加载：`apps/cell-cli/src/utils/env.ts`
