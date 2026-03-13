# Devbox + subdomain-only 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 devbox 子命令（prepare / info）、本地反向代理按 Host 分流、cell 仅用 domain.subdomain + DOMAIN_ROOT 拼 host，移除 domain.host，并迁移现有 cell/instance 配置。

**Architecture:** 本机全局配置 ~/.config/casfa/devbox.yaml 与 devbox-routes.json；单 tunnel 暴露 devboxName.devRoot → tunnelPort；本地代理监听 tunnelPort 读路由表转发；cell dev 启动/退出时登记/注销路由；resolve-config 在 dev 用 devbox 拼 host、在 cloud 用 subdomain + DOMAIN_ROOT 拼 host。

**Tech Stack:** Bun, cloudflared, cell-cli (YAML schema, resolve-config, dev command), 本地代理（Caddy 或 Bun 小脚本）。

---

## Task 1: Schema：domain.subdomain、dev.portBase、移除 domain.host

**Files:**
- Modify: `apps/cell-cli/src/config/cell-yaml-schema.ts`（DomainConfig、ResolvedDomainConfig、CellConfig）
- Modify: `apps/cell-cli/src/config/load-cell-yaml.ts`（若需校验 host 与 subdomain 互斥）
- Test: `apps/cell-cli/src/config/__tests__/load-cell-yaml.test.ts` 或 schema 相关 test

**Step 1:** 在 `DomainConfig` 中：删除 `host`；新增 `subdomain: ResolvedValue`。新增可选 `dev?: { portBase?: number }` 于 CellConfig 或 domain 下（设计 doc 为 dev.portBase，可放 cell 顶层 `dev.portBase`）。

**Step 2:** `ResolvedDomainConfig`：`host` 保留（由 resolve 阶段拼出），新增 `subdomain: string`（resolved）。若 domain 只有 subdomain，则 host 在 resolve-config 中拼出。

**Step 3:** 在 load 或 resolve 中：若存在 `domain.host` 则报错或弃用说明（设计为不再支持，建议直接报错 "domain.host is removed, use domain.subdomain and DOMAIN_ROOT"）。

**Step 4:** 为 subdomain-only 的 cell 添加/更新 fixture，跑 `bun test apps/cell-cli/src/config`，确认通过。

**Step 5:** Commit: `feat(cell-cli): schema domain.subdomain, dev.portBase, remove domain.host`

---

## Task 2: resolve-config：cloud 阶段用 subdomain + DOMAIN_ROOT 拼 host

**Files:**
- Modify: `apps/cell-cli/src/config/resolve-config.ts`（domain 解析、domains 循环）
- Test: `apps/cell-cli/src/config/__tests__/resolve-config.test.ts`

**Step 1:** 在 domain 解析处：若 `domain.subdomain` 存在，则从 params/env 解析 `DOMAIN_ROOT`，拼 `host = \`${subdomain}.${domainRoot}\``；若存在 `domain.host` 则报错 "domain.host is removed, use domain.subdomain and DOMAIN_ROOT"。写入 resolved.domain.host 与 resolved.domain.subdomain。

**Step 2:** 多域（domains）同理：每个 domain 若有 subdomain 则用 DOMAIN_ROOT（或该 domain 的 root param）拼 host。

**Step 3:** 为 resolve-config 增加用例：subdomain + DOMAIN_ROOT → host、CELL_BASE_URL；DOMAIN_ROOT 缺失时报错。调整现有使用 DOMAIN_HOST 的用例改为 DOMAIN_ROOT + subdomain。

**Step 4:** 运行 `bun test apps/cell-cli/src/config/__tests__/resolve-config.test.ts`，通过后 commit: `feat(cell-cli): resolve host from subdomain + DOMAIN_ROOT in cloud stage`

---

## Task 3: devbox 配置读取与类型

**Files:**
- Create: `apps/cell-cli/src/config/devbox-config.ts`（类型 DevboxConfig，路径常量，loadDevboxConfig()）
- Test: `apps/cell-cli/src/config/__tests__/devbox-config.test.ts`（可选）

**Step 1:** 定义 `DevboxConfig`: devboxName, devRoot, tunnelPort, tunnelId/name, credentialsPath, proxyRegistryPath。默认路径 `~/.config/casfa/devbox.yaml`，路由表 `~/.config/casfa/devbox-routes.json`。

**Step 2:** `loadDevboxConfig(): DevboxConfig | null` 读 YAML，不存在或无效返回 null。

**Step 3:** 导出 `getDevHost(subdomain: string, devbox: DevboxConfig): string` 即 `\`${subdomain}.${devbox.devboxName}.${devbox.devRoot}\``。

**Step 4:** Commit: `feat(cell-cli): devbox config load and getDevHost helper`

---

## Task 4: resolve-config dev 阶段：devbox + subdomain 拼 host

**Files:**
- Modify: `apps/cell-cli/src/config/resolve-config.ts`（stage === "dev" 时若 domain.subdomain 存在则读 devbox 拼 host）
- Test: `apps/cell-cli/src/config/__tests__/resolve-config.test.ts`

**Step 1:** 当 stage === "dev" 且 resolved domain 有 subdomain 时，调用 loadDevboxConfig()；若为 null 则后续 cell dev 报错（在 dev 命令里处理）；若存在则拼 devHost，可放在 resolved 的扩展字段或 envVars.CELL_BASE_URL（dev）= `https://<devHost>`。

**Step 2:** dev 端口：优先 cell 的 dev.portBase，否则 env PORT_BASE，否则默认 7100。

**Step 3:** 单元测试：mock devbox 存在时 dev stage 得到正确 devHost。Commit: `feat(cell-cli): resolve dev host from devbox + subdomain`

---

## Task 5: devbox-routes.json 的读写与 cell dev 登记/注销

**Files:**
- Create: `apps/cell-cli/src/local/devbox-routes.ts`（readRoutes, writeRoutes, registerRoute, unregisterRoute）
- Modify: `apps/cell-cli/src/commands/dev.ts`（启动时 registerRoute(devHost, port)，退出时 unregisterRoute(devHost)）

**Step 1:** readRoutes(): 读 JSON 文件，不存在则返回 {}。writeRoutes(routes): 写回。registerRoute(host, port): 读→改 key→写。unregisterRoute(host): 读→delete key→写。

**Step 2:** cell dev 启动时：若使用 devbox（有 dev host），则 registerRoute(devHost, frontendPort)；退出时在 cleanup 里 unregisterRoute(devHost)。

**Step 3:** 确保 devbox 配置存在再登记；若不存在则报错 "Run cell devbox prepare first"。

**Step 4:** Commit: `feat(cell-cli): devbox route registration in cell dev`

---

## Task 6: 本地反向代理（Bun 脚本）

**Files:**
- Create: `apps/cell-cli/src/local/devbox-proxy.ts` 或 独立脚本（监听 tunnelPort，读 devbox-routes.json，按 Host 转发到 localhost:port）

**Step 1:** 实现小型 HTTP 代理：监听 port（从 devbox.yaml 或 env 读），周期或 watch 读取 devbox-routes.json，按 Host 头转发到对应 localhost:port；无匹配返回 404。

**Step 2:** prepare 时写入代理脚本路径或启动说明到 devbox.yaml。Commit: `feat(cell-cli): devbox local reverse proxy script`

---

## Task 7: devbox prepare 与 info 命令

**Files:**
- Create: `apps/cell-cli/src/commands/devbox/prepare.ts`、`info.ts`
- Modify: `apps/cell-cli` 命令注册（devbox prepare / devbox info）

**Step 1:** prepare：检查 bun、Docker（必须）；cloudflared tunnel login；提示 devRoot、devboxName；创建 tunnel、route dns；写 credentials 与 devbox.yaml；初始化 devbox-routes.json。

**Step 2:** info：读 devbox.yaml 并打印。Commit: `feat(cell-cli): devbox prepare and info commands`

---

## Task 8: 迁移现有 cell.yaml 与 instance 配置

**Files:**
- Modify: `apps/server-next/cell.yaml`、`apps/sso/cell.yaml`、`apps/image-workshop/cell.yaml`、`apps/agent/cell.yaml` 及其 cell.symbiont.yaml
- Modify: `apps/cell-cli` 中 fixture 与测试

**Step 1:** 每个 cell：domain.subdomain + params.DOMAIN_ROOT，删除 domain.host 与 DOMAIN_HOST；dev.portBase 按现有端口区段设置。

**Step 2:** 更新所有引用 domain.host/DOMAIN_HOST 的测试与 snapshot。Commit: `chore: migrate to domain.subdomain + DOMAIN_ROOT`

---

## Task 9: 移除 domain.host / DOMAIN_HOST 引用并更新文档

**Files:**
- Grep 并修改: cell-cli 中 deploy、build、cognito 等
- Modify: docs 与 reference.md

**Step 1:** 全量移除 domain.host、DOMAIN_HOST，统一用 resolved.domain.host。文档更新为 subdomain + DOMAIN_ROOT。Commit: `refactor(cell-cli): remove domain.host, docs update`

---

## Execution Handoff

Plan saved to `docs/plans/2026-03-11-devbox-impl-plan.md`.

**Options:** 1) Subagent-Driven (this session). 2) Parallel session with executing-plans. Which approach?
