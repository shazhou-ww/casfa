# Legacy 迁移设计：非 Cell 应用与包迁入 legacy/

- 日期：2026-03-10
- 目标：将「不用 cell」的 apps/packages 整块迁到 `legacy/apps`、`legacy/packages`，主仓只保留 cell 生态与共享基础库。

## 1. 目录与清单

### 1.1 新建目录

- `legacy/apps/` — 迁出的应用
- `legacy/packages/` — 迁出的包

### 1.2 迁入 legacy/apps 的 App（2 个）

| 现路径     | 迁入路径           |
|------------|--------------------|
| apps/server | legacy/apps/server |
| apps/cli    | legacy/apps/cli    |

保留在 `apps/`：agent、image-workshop、server-next、sso、cell-cli。

### 1.3 迁入 legacy/packages 的 Package（19 个）

老栈整块迁出，主仓不再构建/typecheck 这些包。

| 包名 | 说明 |
|------|------|
| cas-uri | 仅 legacy 使用 |
| port-rpc | client-bridge 依赖 |
| protocol | 仅被迁出包使用 |
| client-auth-crypto | cli、oauth-provider 等 |
| delegate-token | client 等 |
| client | server、cli、client-bridge 等 |
| dag-diff | realm、explorer 等 |
| realm | 老栈 Level 1，server-next 已弃用 |
| delegate | server 等 |
| proof | server、storage-http 等 |
| fs | explorer、server 等 |
| explorer | client-bridge、server 等 |
| client-bridge | server 等 |
| client-sw | server 等 |
| storage-cached | storage-indexeddb、server 等 |
| storage-http | server 等 |
| storage-indexeddb | server 等 |
| oauth-consumer | 老栈 OAuth |
| oauth-provider | 老栈 OAuth |

### 1.4 保留在主仓 packages/ 的 Package

- 共享基础：encoding、storage-core、core、cas、storage-fs、storage-memory、storage-s3
- Cell 生态：cell-cognito-server、cell-auth-server、cell-auth-client、cell-auth-webui、cell-cognito-webui、cell-delegates-server、cell-delegates-webui

## 2. Workspaces、根脚本与 tsconfig

### 2.1 Workspaces（根 package.json）

```json
"workspaces": [
  "packages/*",
  "apps/*",
  "legacy/packages/*",
  "legacy/apps/*"
]
```

### 2.2 根脚本（只跑主线）

- **clean**：仅主仓。`rimraf packages/*/dist apps/*/dist`，去掉对 apps/cli、apps/server 的显式路径。
- **build:packages**：只构建主仓 packages（按依赖顺序）：encoding → storage-core → core → cas → storage-fs → storage-memory → storage-s3 → cell-*（按依赖顺序）。不再构建迁出的包与 apps/cli。
- **typecheck**：只跑主仓 packages + apps/server-next（可选加上 agent、sso、image-workshop、cell-cli）。
- **test:unit**：同上，只跑主仓 packages + server-next（及需要时的其他 cell apps）。
- **test**：默认只跑 test:unit。e2e 改为可选：`test:e2e:legacy`，在 legacy 下或通过显式路径跑。
- **release**：不变，`bun run build:packages && changeset publish`。

可选：`build:legacy`、`typecheck:legacy`、`test:legacy` 在根目录用路径或 `cd legacy` 跑 legacy。

### 2.3 tsconfig.json paths

- 已迁到 legacy 的包：路径由 `./packages/xxx` 改为 `./legacy/packages/xxx`。
- 保留在主仓的包：保持 `./packages/xxx`。

### 2.4 其他

- .changeset：已 ignore @casfa/server；可按需 ignore @casfa/cli 或整块 legacy。
- Biome：若需只 lint 主线，可排除 legacy；否则保持 `biome check .`。

## 3. 迁移顺序与验收

1. **创建目录**：`legacy/apps`、`legacy/packages`。
2. **迁 apps**：移动 server、cli 到 legacy/apps，避免改包名或 workspace 引用（仍为 @casfa/server、@casfa/cli）。
3. **迁 packages**：按依赖顺序移动 19 个包到 legacy/packages（先移无/少依赖的：protocol、cas-uri、port-rpc、client-auth-crypto、delegate-token、client、dag-diff、realm、delegate、proof、fs、explorer、client-bridge、client-sw、storage-cached、storage-http、storage-indexeddb、oauth-consumer、oauth-provider）。
4. **更新根配置**：workspaces、clean/build/typecheck/test 脚本、tsconfig paths。
5. **验证**：根目录 `bun install`、`bun run build`、`bun run typecheck`、`bun run test:unit` 通过；可选在 legacy 下或通过 `test:e2e:legacy` 跑一次 legacy e2e。

## 4. 策略选择（已定）

- **Packages 范围**：方案 B — 整块迁走老栈相关 packages，主仓只留 cell 生态 + 共享基础库。
- **Workspace**：单 monorepo，根 workspaces 包含 legacy，根脚本只跑主线；可选脚本跑 legacy。
