# Legacy 迁移实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将非 Cell 的 apps（server, cli）和 19 个老栈 packages 迁入 `legacy/apps`、`legacy/packages`，并收口根脚本与 tsconfig，使主线只构建/校验 cell 生态。

**Architecture:** 单 monorepo，根 workspaces 增加 `legacy/packages/*`、`legacy/apps/*`；根脚本（build/typecheck/test）只跑主仓 packages + cell apps；tsconfig paths 中迁出包指向 `./legacy/packages/xxx`。

**Tech Stack:** Bun workspaces、TypeScript、现有 scripts（rimraf、biome）。

**设计文档:** [docs/plans/2026-03-10-legacy-migration-design.md](2026-03-10-legacy-migration-design.md)

---

### Task 1: 创建 legacy 目录

**Files:**
- Create: `legacy/apps/.gitkeep`（或空目录由 git 保留）
- Create: `legacy/packages/.gitkeep`

**Step 1: 创建目录并保留在 git 中**

```bash
mkdir -p legacy/apps legacy/packages
touch legacy/apps/.gitkeep legacy/packages/.gitkeep
```

**Step 2: 提交**

```bash
git add legacy/
git commit -m "chore: add legacy/apps and legacy/packages directories"
```

---

### Task 2: 将 server、cli 迁入 legacy/apps

**Files:**
- Move: `apps/server` → `legacy/apps/server`
- Move: `apps/cli` → `legacy/apps/cli`

**Step 1: 移动目录**

```bash
git mv apps/server legacy/apps/server
git mv apps/cli legacy/apps/cli
```

**Step 2: 提交**

```bash
git add -A
git commit -m "chore: move server and cli to legacy/apps"
```

---

### Task 3: 将 19 个 packages 迁入 legacy/packages

**Files:**
- Move each: `packages/<name>` → `legacy/packages/<name>`

**包列表（按字母顺序执行 git mv）：**  
cas-uri, client, client-auth-crypto, client-bridge, client-sw, dag-diff, delegate, delegate-token, explorer, fs, oauth-consumer, oauth-provider, port-rpc, proof, protocol, realm, storage-cached, storage-http, storage-indexeddb

**Step 1: 批量移动**

在仓库根目录执行（可逐行或合并为一条）：

```bash
for p in cas-uri client client-auth-crypto client-bridge client-sw dag-diff delegate delegate-token explorer fs oauth-consumer oauth-provider port-rpc proof protocol realm storage-cached storage-http storage-indexeddb; do
  git mv packages/$p legacy/packages/$p
done
```

**Step 2: 提交**

```bash
git add -A
git commit -m "chore: move 19 legacy packages to legacy/packages"
```

---

### Task 4: 更新根 package.json workspaces 与 clean 脚本

**Files:**
- Modify: `package.json`

**Step 1: 扩展 workspaces**

将：

```json
"workspaces": [
  "packages/*",
  "apps/*"
]
```

改为：

```json
"workspaces": [
  "packages/*",
  "apps/*",
  "legacy/packages/*",
  "legacy/apps/*"
]
```

**Step 2: 更新 clean 脚本**

将：

```json
"clean": "rimraf packages/*/dist apps/*/dist apps/cli/dist apps/server/backend/dist apps/server/backend/public apps/server/.aws-sam"
```

改为（只清主仓）：

```json
"clean": "rimraf packages/*/dist apps/*/dist"
```

**Step 3: 提交**

```bash
git add package.json
git commit -m "chore: add legacy to workspaces, simplify clean script"
```

---

### Task 5: 重写 build:packages 只构建主仓 packages

**Files:**
- Modify: `package.json` 的 `build:packages` 脚本

**Step 1: 替换 build:packages**

将现有整行 `build:packages` 替换为仅主仓包（按依赖顺序）：

```json
"build:packages": "cd packages/encoding && bun run build && cd ../storage-core && bun run build && cd ../core && bun run build && cd ../cas && bun run build && cd ../storage-fs && bun run build && cd ../storage-memory && bun run build && cd ../storage-s3 && bun run build && cd ../cell-auth-server && bun run build && cd ../cell-delegates-server && bun run build && cd ../cell-auth-client && bun run build && cd ../cell-auth-webui && bun run build && cd ../cell-cognito-webui && bun run build && cd ../cell-cognito-server && bun run build && cd ../cell-delegates-webui && bun run build"
```

**Step 2: 提交**

```bash
git add package.json
git commit -m "chore: build:packages only builds mainline packages"
```

---

### Task 6: 更新 typecheck 与 test 脚本

**Files:**
- Modify: `package.json` 的 `typecheck`、`test:unit`、`test`、`test:e2e`

**Step 1: 更新 typecheck**

改为只跑主仓 packages + server-next（及可选 cell-cli/agent/sso/image-workshop）。示例（仅 server-next）：

```json
"typecheck": "cd packages/storage-core && bun run typecheck && cd ../core && bun run typecheck && cd ../storage-fs && bun run typecheck && cd ../storage-memory && bun run typecheck && cd ../storage-s3 && bun run typecheck && cd ../../apps/server-next && bun run typecheck"
```

**Step 2: 更新 test:unit**

只跑主仓 packages + server-next，移除对 legacy 的引用。示例：

```json
"test:unit": "cd packages/core && bun run test:unit && cd ../cas && bun run test:unit && cd ../../apps/server-next && bun run test:unit"
```

（若其他主仓包有 test:unit，按需追加；设计文档允许只保留必要子集。）

**Step 3: 更新 test 与 test:e2e**

```json
"test": "bun run test:unit",
"test:e2e": "echo 'Run e2e in legacy: cd legacy && ... or use test:e2e:legacy'",
"test:e2e:legacy": "cd legacy/packages/storage-http && bun run test:e2e && cd ../../apps/cli && bun run test:e2e && cd ../server && bun run test:e2e"
```

（test:e2e:legacy 路径为 `legacy/apps/cli`、`legacy/apps/server`，需根据实际路径修正为 `legacy/apps/cli`、`legacy/apps/server`。）

修正为：

```json
"test:e2e:legacy": "cd legacy/packages/storage-http && bun run test:e2e && cd ../../apps/cli && bun run test:e2e && cd ../server && bun run test:e2e"
```

**Step 4: 提交**

```bash
git add package.json
git commit -m "chore: typecheck and test scripts run mainline only; add test:e2e:legacy"
```

---

### Task 7: 更新 tsconfig.json paths 中迁出包路径

**Files:**
- Modify: `tsconfig.json` 的 `compilerOptions.paths`

**Step 1: 将以下键的路径从 `./packages/xxx` 改为 `./legacy/packages/xxx`**

- @casfa/cas-uri
- @casfa/client
- @casfa/client-auth-crypto
- @casfa/client-bridge
- @casfa/client-sw
- @casfa/dag-diff
- @casfa/delegate
- @casfa/delegate-token
- @casfa/explorer
- @casfa/fs
- @casfa/oauth-consumer
- @casfa/oauth-provider
- @casfa/port-rpc
- @casfa/proof
- @casfa/protocol
- @casfa/realm
- @casfa/storage-cached
- @casfa/storage-http
- @casfa/storage-indexeddb

例如：`"@casfa/client": ["./packages/client/src/index.ts"]` → `"@casfa/client": ["./legacy/packages/client/src/index.ts"]`。子路径如 `@casfa/explorer/core/sync-manager` 同理改为 `./legacy/packages/explorer/...`。

**Step 2: 提交**

```bash
git add tsconfig.json
git commit -m "chore: point tsconfig paths for moved packages to legacy/packages"
```

---

### Task 8: 安装依赖并验证主线构建与测试

**Step 1: 安装**

```bash
bun install --no-cache
```

Expected: 无报错，workspace 解析含 legacy。

**Step 2: 清理并构建**

```bash
bun run clean
bun run build
```

Expected: 仅主仓 packages 构建成功。

**Step 3: 类型检查**

```bash
bun run typecheck
```

Expected: 通过。

**Step 4: 单元测试**

```bash
bun run test:unit
```

Expected: 通过。

**Step 5: 提交（若有未提交的修复）**

若前序步骤为通过验收而修改了脚本或配置，补一次提交并注明修复内容。

---

### Task 9: （可选）.changeset 与 Biome

**Files:**
- Modify: `.changeset/config.json`（若需 ignore @casfa/cli）
- 根 `package.json` 的 lint 脚本（若需排除 legacy）

**Step 1: 若需在 changeset 中忽略 legacy 发布**

在 `.changeset/config.json` 的 `ignore` 中加入 `"@casfa/cli"`（若尚未包含）。

**Step 2: 若需 lint 排除 legacy**

将 `"lint": "biome check ."` 改为仅主仓，例如：`"lint": "biome check packages apps"`。否则保持 `biome check .`。

**Step 3: 提交（若有修改）**

```bash
git add .changeset/config.json package.json
git commit -m "chore: changeset ignore legacy app; optional lint scope"
```

---

## 执行选项

计划已保存到 `docs/plans/2026-03-10-legacy-migration-impl.md`。

**两种执行方式：**

1. **Subagent-Driven（本会话）** — 按任务派发子 agent，每步审查后再进行下一步，迭代快。
2. **Parallel Session（另开会话）** — 在新会话中用 executing-plans skill，在独立 worktree 中按检查点批量执行。

你选哪种？
