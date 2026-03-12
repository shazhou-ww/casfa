# Otavia 工具链设计

> 设计文档。实施计划由 writing-plans 产出。

## 命名由来

Otavia 取自古生物 **Otavia antiqua**（已知最古老的动物化石之一，前寒武纪）。与「Cell」并列：Cell 为生命的基本单元，Otavia 为最早期的简单有机体，均喻指「基础构建单元」——用于命名管理 cells 的单一 stack、path 路由工具链。

---

## §1 目标与范围

- **目标**：提供替代 cell-cli 的 otavia 工具链，采用单 stack、单域 path 路由，配置收敛到顶层 `otavia.yaml` 与各 cell 的 `cell.yaml`。
- **范围**：
  - 新 CLI 位于 `apps/otavia`，与 cell-cli 并存；cell-cli 仅作参考，不为其做兼容。
  - 所有命令在**仓库根**（存在 `otavia.yaml` 的目录）执行。
- **成功标准**：新 clone 上 `otavia setup` → `otavia dev` 可本地跑全 stack；`otavia test` 跑单测 + 非持久 Docker 的 e2e；`otavia deploy` 生成并部署单份 CloudFormation；typecheck/lint 覆盖所有 cell 的前后端与测试代码。

---

## §2 配置文件

### 2.1 otavia.yaml（仓库根）

| 字段 | 必填 | 说明 |
|------|------|------|
| **stackName** | 是 | CloudFormation stack 名；用于资源命名前缀 `<stackName>-<cellId>-<resourceKey>`。 |
| **cells** | 是 | 字符串数组，每项为 cell 标识，对应目录 `apps/<id>`，path 为 `/<id>/`。 |
| **domain** | 是 | 单域：`host`（如 `casfa.shazhou.me`）、可选 `dns`（provider、zone 等）。 |
| **params** | 否 | key-value，值可为字符串或对象；stack 级默认，各 cell 的 params 可覆盖（top-level key 覆盖，不做 deep merge）。 |

### 2.2 cell.yaml（各 app 目录，如 apps/server-next/cell.yaml）

| 字段 | 必填 | 说明 |
|------|------|------|
| **name** | 是 | cell 显示/逻辑名；资源命名使用 **cellId**（目录名），不用 name。 |
| **backend** | 否 | `dir`、`runtime`、`entries`。entry：`handler`、`app`、`timeout`、`memory`、`routes`。routes 为相对 cell 根路径的子路由（如 `/api/*`）。 |
| **frontend** | 否 | `dir`、`entries`。entry：`entry`、`routes`，相对 cell 路径。 |
| **testing** | 否 | `unit`（如 `backend/`）、`e2e`（如 `tests/*.test.ts`）。 |
| **tables** | 否 | DynamoDB 表声明；物理表名 `<stackName>-<cellId>-<key>`。 |
| **buckets** | 否 | S3 桶声明；物理桶名 `<stackName>-<cellId>-<bucketKey>`，超 63 字符则截断+hash 保证唯一。 |
| **params** | 否 | 覆盖或补充 otavia.yaml 的 params（同 key 时 cell 优先）。 |

**移除的字段**：pathPrefix、bucketNameSuffix、dev（portBase）、domain（subdomain/dns）。不兼容 cell-cli 的 cell.yaml。

**params 解析**：支持 `!Env VAR`、`!Secret`；先合并 stack params 与 cell params（cell 覆盖），再对合并结果做 env/secret 解析。.env 加载顺序：根目录 .env → cell 的 .env → cell 的 .env.local。

---

## §3 子命令行为

**约定**：所有命令在仓库根执行；未找到 `otavia.yaml` 则报错退出。

### setup

- 检查：bun 可用、存在且可解析 `otavia.yaml`、cells 指向的目录存在且含 `cell.yaml`。
- 对每个 cell：若 `apps/<cellId>/.env` 不存在，则从 `apps/<cellId>/.env.example` 复制；无 `.env.example` 则跳过。
- 可选：校验 params 中 `!Env`/`!Secret` 在 .env 中是否有提供，缺则打印并提示，不阻塞。
- **`otavia setup --tunnel`**：在上述通过后，创建/更新 tunnel 配置（如 cloudflared + 本地 proxy）；写入固定目录（如 `~/.config/otavia/` 或 `.otavia/`），并输出如何启动 tunnel。
- With --tunnel, otavia writes tunnel config and prints instructions; starting the daemon is manual or a future otavia tunnel start.

### dev

- **进程模型**：两个 Bun 进程。
  - **后端进程**：单端口（如 8900），运行 gateway（Hono），按 path 挂载各 cell 的 backend；需要时连接 Docker 中的 DynamoDB Local 与 MinIO。
  - **前端进程**：共用一个 Vite dev server（多 root 或按 path），另一端口（如 7100）；Vite 将后端请求代理到后端进程（如 `proxy → http://localhost:8900`），浏览器只连 Vite。
- **本地数据**：Docker 中 DynamoDB Local 与 MinIO 使用**与线上相同的资源名**（`<stackName>-<cellId>-<resourceKey>`），仅 endpoint 不同。
- 注入 `CELL_BASE_URL`、`SSO_BASE_URL`（sso 为 cells 列表第一个或显式标记）。

### test

- `otavia test`：先 test:unit，再 test:e2e；任一步失败则非 0。
- **test:unit**：对每个 cell 在 `apps/<cellId>` 下按 `testing.unit` 执行 `bun test <pattern>`；汇总退出码。
- **test:e2e**：非持久 Docker（DynamoDB Local + MinIO，--rm、不挂 volume）；启动 gateway 或单 cell 后端，注入测试 env；在对应 cell 下执行 e2e；结束后停容器与进程。

### deploy

- 读 otavia.yaml 与所有 cell.yaml；解析 params（cloud）；生成单份 CloudFormation（Lambda、API、DynamoDB、S3、CloudFront path behaviors、DNS 等）；打包上传 backend、构建上传 frontend；create/update stack。资源命名见 §4。

### typecheck

- 对每个 cell 在 `apps/<cellId>` 下执行 `tsc --noEmit`（或该 cell 的 tsconfig）；覆盖前后端与测试。汇总退出码。

### lint

- 对每个 cell 在 `apps/<cellId>` 下执行 linter（如 biome check）；支持 `--fix`、`--unsafe`。汇总退出码。

### aws login / aws logout

- 使用根目录或当前环境的 `.env` 中 `AWS_PROFILE`（缺省 `default`），执行 `aws sso login/logout --profile <profile>`；stdio inherit，退出码与 aws 一致。

### clean

- 删除仓库根及所有 cell 下的临时目录（如 `.cell`、`.esbuild`、`.otavia`）；**不**删除 `.env`/`.env.local`。

---

## §4 资源命名与 S3 长度

- **DynamoDB 表名**：`<stackName>-<cellId>-<tableKey>`，全小写连字符；cellId 为目录名。
- **S3 桶名**：`<stackName>-<cellId>-<bucketKey>`；总长 ≤63。若超 63：截断并加短 hash 保证唯一（实现时约定截断顺序，如先缩 key 再 cellId）。
- **前端静态桶**（若有）：如 `frontend-<stackName>-<suffix>`，suffix 来自 domain 或配置，总长 ≤63。

---

## §5 错误处理与测试

- **错误处理**：缺 otavia.yaml、解析失败、cell 目录/cell.yaml 缺失 → 明确报错并退出非 0。params 未提供 `!Env`/`!Secret` → MissingParamsError 列出缺失 key。deploy 失败 → 透传 AWS/CloudFormation 错误并退出非 0。
- **单元测试**：各 cell 的 Hono 按根 path 测；path 剥离在 gateway 层。
- **E2E**：非持久 Docker；表/桶名与线上一致；可启动完整 dev 形态（Vite + gateway + DynamoDB Local + MinIO）或仅后端+本地 DB/S3，对真实 path 发请求。

---

## 参考

- 单域 path 架构：`docs/plans/2026-03-11-single-domain-path-design.md`
- 现有实现参考：`apps/cell-cli`（gateway-dev、resolve-config、generators、local）
