# Casfa-Dev Tunnel 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现本地多微服务通过 Cloudflare Tunnel 子域名（*.casfa-dev.shazhou.work）互访：固定端口区段、env 示例、cell dev 尊重 CELL_BASE_URL 并用于 Cognito 回调、文档更新。

**Architecture:** 一个 Named Tunnel + 多 ingress（已有 .cloudflared/config.yml.example）。各 app 通过 .env 设置 PORT_BASE 与 base URL；cell dev 在 env 已提供 CELL_BASE_URL 时不覆盖，并将该 origin 用于 Cognito 回调注册；提供 .env.casfa-dev.example 与文档。

**Tech Stack:** cloudflared, cell-cli (Bun), Cognito, Hono/Vite.

---

## Task 1: cell dev 使用 env 中的 CELL_BASE_URL（若已设置）

**Files:**
- Modify: `apps/cell-cli/src/commands/dev.ts`（约 279–285 行，env 构造与 264 行 ensureCognitoDevCallbackUrl 的 localCallbackUrl）

**Step 1: 确定当前行为**

在 `dev.ts` 中，`resolved.envVars` 来自 `resolveConfig`，但随后写死了 `CELL_BASE_URL: \`http://localhost:${frontendPort}\``。若各 app 的 `.env` 里有 `CELL_BASE_URL`，应优先使用（tunnel 模式）。同时，`ensureCognitoDevCallbackUrl` 的 `localCallbackUrl` 当前为 `http://localhost:${frontendPort}/oauth/callback`，tunnel 模式下应使用 env 中的 `CELL_BASE_URL` 的 origin + `/oauth/callback`。

**Step 2: 实现逻辑**

- 在构造 backend 与 frontend 的 `env` 之前，定义 `const cellBaseUrl = envMap.CELL_BASE_URL?.trim() || \`http://localhost:${frontendPort}\`;`。
- 将传给子进程的 env 中的 `CELL_BASE_URL` 设为 `cellBaseUrl`（不再写死 localhost）。
- 将 `ensureCognitoDevCallbackUrl` 的第二个参数从 `http://localhost:${frontendPort}/oauth/callback` 改为 `\${cellBaseUrl.replace(/\/$/, '')}/oauth/callback`。

**Step 3: 运行相关测试**

Run: `cd apps/cell-cli && bun test src/commands/dev.ts`（若有）；或 `bun run test:unit` 从仓库根目录。  
Expected: 无回归。

**Step 4: Commit**

```bash
git add apps/cell-cli/src/commands/dev.ts
git commit -m "feat(cell-cli): respect CELL_BASE_URL from env in dev and use for Cognito callback"
```

---

## Task 2: 根目录 .env.casfa-dev.example 与 gitignore

**Files:**
- Create: `.env.casfa-dev.example`（仓库根）
- Modify: `.gitignore`（添加 `.env.casfa-dev`）

**Step 1: 创建 .env.casfa-dev.example**

内容列出四服务的 PORT_BASE 与 base URL，并注明「复制为 .env.casfa-dev 或在各 app 的 .env 中设置」：

```bash
# Casfa-Dev Tunnel 本地多服务 env 示例
# 复制为 .env.casfa-dev 或合并到各 app 的 .env。各 app 只需本 app 的 PORT_BASE 及依赖的 base URL。

# SSO (apps/sso)
PORT_BASE=7100
CELL_BASE_URL=https://sso.casfa-dev.shazhou.work
AUTH_COOKIE_DOMAIN=.casfa-dev.shazhou.work

# server-next / drive (apps/server-next)
PORT_BASE=7120
CELL_BASE_URL=https://drive.casfa-dev.shazhou.work
SSO_BASE_URL=https://sso.casfa-dev.shazhou.work

# image-workshop (apps/image-workshop)
PORT_BASE=7140
CELL_BASE_URL=https://drive.casfa-dev.shazhou.work
SSO_BASE_URL=https://sso.casfa-dev.shazhou.work

# agent (apps/agent)
PORT_BASE=7160
SSO_BASE_URL=https://sso.casfa-dev.shazhou.work
```

**Step 2: 添加 .gitignore**

在 .gitignore 中增加一行：`.env.casfa-dev`。

**Step 3: Commit**

```bash
git add .env.casfa-dev.example .gitignore
git commit -m "chore: add .env.casfa-dev.example for tunnel dev, ignore .env.casfa-dev"
```

---

## Task 3: 更新 docs/cloudflare-tunnel-dev.md（casfa-dev 多服务节）

**Files:**
- Modify: `docs/cloudflare-tunnel-dev.md`

**Step 1: 在文档末尾或「多应用 / 多端口」之后增加一节「Casfa-Dev 多服务子域名」**

内容包含：
- 子域名与端口区段表（sso 7100, drive 7120, workshop 7140, agent 7160）。
- 使用 `.env.casfa-dev.example`：复制为 `.env.casfa-dev` 或合并到各 app 的 `.env`，设置 `PORT_BASE` 与 `SSO_BASE_URL` / `CELL_BASE_URL`。
- SSO 必须设置 `AUTH_COOKIE_DOMAIN=.casfa-dev.shazhou.work`。
- 启动顺序：先 `cloudflared tunnel run --config .cloudflared/config.yml`，再在各 app 目录执行 `cell dev`（各终端设置对应 env）。
- Cognito：若使用 env 中的 `CELL_BASE_URL`（https），`cell dev` 会自动将该 origin 的 `/oauth/callback` 注册到 Cognito。
- 引用设计文档 `docs/plans/2026-03-11-casfa-dev-tunnel-design.md`。

**Step 2: Commit**

```bash
git add docs/cloudflare-tunnel-dev.md
git commit -m "docs: add casfa-dev multi-service tunnel section"
```

---

## Task 4: 各 app .env.example 中注明 casfa-dev 可选配置（可选）

**Files:**
- Modify: `apps/server-next/.env.example`、`apps/sso/.env.example`、`apps/image-workshop/.env.example`、`apps/agent/.env.example`（若存在）

**Step 1: 在每个 .env.example 顶部或末尾增加注释**

例如：

```bash
# --- Casfa-Dev Tunnel (可选) ---
# 多服务子域名开发时：PORT_BASE 见 .env.casfa-dev.example，并设置 SSO_BASE_URL / CELL_BASE_URL。
# 详见 docs/cloudflare-tunnel-dev.md 与 docs/plans/2026-03-11-casfa-dev-tunnel-design.md
```

**Step 2: Commit**

```bash
git add apps/server-next/.env.example apps/sso/.env.example apps/image-workshop/.env.example apps/agent/.env.example
git commit -m "docs: mention casfa-dev tunnel in app .env.example"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-11-casfa-dev-tunnel-plan.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** – 按任务派发子 agent，每任务后 review，快速迭代。

**2. Parallel Session (separate)** – 在新会话中用 executing-plans 按检查点批量执行。

Which approach?
