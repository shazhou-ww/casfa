# 单域多 Path 架构设计（Platform Gateway）

> 设计文档。实施计划见 `2026-03-11-single-domain-path-impl.md`。

## 目标与原则

- **目标**：从多子域（sso.casfa.shazhou.me、agent.casfa.shazhou.me …）改为单域多 path（casfa.shazhou.me/sso/、casfa.shazhou.me/agent/ …）；本地一个进程跑所有 cell；部署一个统一 stack；SSO Cookie 单域管理更简单。
- **原则**：`cell.yaml` 描述 cell 自身资源；`stack.yaml` 描述平台有哪些 cell 与全局配置；后端仍为每个 entry 一个 Lambda；cell-cli 的 dev/build/deploy 在顶层（stack.yaml 所在目录）执行。

---

## §1 路径约定与架构概览

**Path 约定**

- 单域：生产 `https://casfa.shazhou.me`；本地 `http://localhost:<port>`（如 8900）。
- 各 cell 占一个 path prefix，**带尾部斜杠**：`/sso/`、`/drive/`、`/agent/`、`/image-workshop/`（或 `/workshop/`）。
- 无尾部斜杠的 prefix 请求做 **301 重定向** 到带斜杠（如 `/sso` → `/sso/`）。
- 后端 API 在同一 prefix 下（如 `/sso/api/health`、`/agent/api/realm/me/threads`）；gateway 转发给各 cell 的 Hono 时 **去掉 pathPrefix**，cell 内部仍按根路径写路由。

**架构概览**

- **本地**：一个 Bun 进程运行 platform gateway，按 path prefix 分发到各 cell 的 Hono，并负责静态/前端（Vite 多页或按 path 代理）。
- **部署**：一个 CloudFormation stack：一个 CloudFront（单域）、path behaviors 指向各 cell 的 Lambda/API 与前端 S3 前缀；每个 backend entry 对应一个 Lambda。

**Cookie**

- 域：`casfa.shazhou.me`（生产）；本地可为 `localhost` 或不设。
- Path：`/`，全站共享。

---

## §2 stack.yaml 与 cell.yaml 职责、顶层 dev/build/deploy

**职责**

- **cell.yaml**：该 cell 的资源与配置（backend entries、frontend、tables、buckets、params、**pathPrefix** 等）；不写「在哪个 stack」。
- **stack.yaml**（顶层）：列出 cells、全局 domain/DNS/证书等；生成一个 CloudFormation stack。

**pathPrefix**

- 放在 **cell.yaml**，表示该 cell 在平台中的 path（如 `/sso`、`/agent`）。stack.yaml 不重复写每个 cell 的 path。

**cell-cli（均在顶层执行）**

- **cell dev**：读 stack.yaml → 按 pathPrefix 在一个进程挂载各 cell 的 Hono；前端由同一 Vite 多页或按 path 代理；`CELL_BASE_URL` / `SSO_BASE_URL` 由 CLI 按 origin + pathPrefix 注入。
- **cell build**：对 stack 中每个 cell 分别 build；前端产出到统一 dist 的 per-cell 子路径（如 `dist/sso/`、`dist/agent/`）。
- **cell deploy**：读 stack.yaml + 所有 cell.yaml → 生成一个 CloudFormation template（每 entry 一个 Lambda、CloudFront path behaviors、S3 按前缀存前端）→ 部署该 stack。

---

## stack.yaml example

Stack 列出 cell 名称；解析时通过 `apps/<name>/cell.yaml` 定位各 cell。例如 `cells: [sso, server-next, agent, image-workshop]` 对应 `apps/sso`、`apps/server-next`、`apps/agent`、`apps/image-workshop`。

```yaml
cells:
  - sso
  - server-next
  - agent
  - image-workshop
domain:
  host: casfa.shazhou.me
  dns:
    provider: cloudflare
    zone: casfa.shazhou.me
# optional: bucketNameSuffix for S3
```

---

## §3 cell.yaml 的 pathPrefix 与 env

**pathPrefix**

- 每个 cell 的 `cell.yaml` 增加 **pathPrefix**（platform 模式下必填）：以 `/` 开头、无尾部斜杠，如 `"/sso"`、`"/agent"`。

**CELL_BASE_URL**

- Platform 模式：`<origin><pathPrefix>`，无尾部斜杠（如 `https://casfa.shazhou.me/sso`，本地 `http://localhost:8900/sso`）。
- 非 platform 模式：与现有一致（子域或 localhost:port）。

**SSO_BASE_URL**

- Platform 模式：`<origin><ssoPathPrefix>`，由 cell-cli 注入；.env 可覆盖。
- 非 platform 模式：沿用现有推导或 .env。

**Cookie / Cognito**

- AUTH_COOKIE_DOMAIN：生产 `casfa.shazhou.me`；本地可空。AUTH_COOKIE_PATH：`/`。
- Cognito callback：`https://casfa.shazhou.me/sso/oauth/callback`；本地 `http://localhost:8900/sso/oauth/callback`。

---

## §4 本地 gateway 请求流

**路由顺序**

1. 根 `/`：重定向到 `/sso/` 或简单导航页（可选）。
2. 带 pathPrefix 的 API：匹配 backend routes → 转发给对应 cell 的 Hono，**path 已去掉 pathPrefix**（如 `/sso/api/health` → Hono 收到 `/api/health`）。
3. 带 pathPrefix 的静态/前端：未命中 API 的 → 由 Vite 多页或 dist 按 prefix 提供。

**Prefix 剥离**

- path = `/<pathPrefix>/<rest>`；转发时 pathname = `"/" + rest`，query/headers 原样。

**前端 base**

- 各 cell 的 Vite 在 platform dev 下 `base: '/sso/'`、`base: '/agent/'` 等；构建产出到 `dist/sso/`、`dist/agent/`，引用带 prefix。

**重定向**

- `GET /sso`、`GET /agent` 等 → 301 到 `/sso/`、`/agent/`。

---

## §5 部署结构（CloudFront、Lambda、S3）

**CloudFront**

- 单 distribution，别名 `casfa.shazhou.me`。
- **Path behaviors**（按优先级从具体到默认）：
  - `/sso/*` → SSO 的 API 源（见下）+ 或与前端共行为（API 优先）。
  - `/drive/*`、`/agent/*`、`/image-workshop/*` 同理。
  - 默认行为：S3 前端 bucket（或 / 重定向到 /sso/）。
- 每个 behavior 的 API 源：对应 cell 的 API Gateway HTTP API 或 Lambda Function URL；请求 path 需与 Lambda 预期一致（若 Lambda 收到的是去掉 prefix 的 path，则需在 CloudFront 或 API Gateway 做 path 重写，或 Lambda 从 event 中取带 prefix 的 path 再自己剥掉，视当前 generator 而定）。

**Lambda**

- **每个 backend entry 一个 Lambda**（与现有 cell 一致）；每个 cell 可有多个 entries（如 api、worker），每个 entry 一个 Lambda。
- Lambda 触发：通过 API Gateway HTTP API（或 Function URL）的 path 映射到对应 entry；path 传入 Lambda 时可为 `/sso/oauth/...` 或已剥离为 `/oauth/...`，由 generator 与 Lambda adapter 统一约定（建议剥离后传入，与本地 gateway 一致）。

**S3 前端**

- 一个 bucket；按 path prefix 存各 cell 的构建产物：`sso/`、`drive/`、`agent/`、`image-workshop/`（与 Vite base 一致）。
- CloudFront 默认行为或对应 path 行为指向该 bucket；SPA 回退到各 prefix 下 index.html。

**DNS / 证书**

- stack.yaml 中全局 domain（如 `casfa.shazhou.me`）、DNS（Route53/Cloudflare）、ACM 证书；单域单证书。

---

## §6 错误处理与测试

**错误处理**

- Gateway 层：未知 pathPrefix → 404。某 cell 的 Hono 抛错 → 原样返回该 cell 的 status/body。
- 部署：Lambda 超时/5xx 由 API Gateway 与 CloudFront 按现有策略返回；前端 404 由 S3/CloudFront 回退到 prefix 下 index.html（SPA 自处理）。

**测试**

- **单元**：各 cell 的 Hono 仍按「根 path」测；pathPrefix 剥离逻辑在 gateway 与 deploy 层测。
- **集成 / E2E**：从顶层启动 `cell dev`，用真实 path 访问（如 `http://localhost:8900/sso/oauth/authorize`、`/agent/api/...`），断言 301、cookie、SSO 跳转与 API 响应。
- **Deploy 后**：冒烟测试 `https://casfa.shazhou.me/sso/`、`/agent/` 等可访问且 SSO 登录与 cookie 共享正常。

---

## 文档与后续

- 实施计划：`docs/plans/2026-03-11-single-domain-path-impl.md`。
- 参考：现有 `apps/cell-cli` 的 resolve-config、dev、deploy、generators（cloudfront、merge）；各 cell 的 cell.yaml 与 backend routes。
