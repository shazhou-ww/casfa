# casfa-next 工程框架实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按设计文档 `docs/plans/2026-03-02-casfa-next-engineering-design.md` 将 server-next 调整为 backend/frontend/shared/tests/scripts 结构，统一环境变量与端口，并接入 DynamoDB/S3/Cognito/CloudWatch/Secrets 的配置与本地 mock，为全栈 Serverless 部署做准备。

**Architecture:** 单栈 serverless.yml，资源前缀 casfa-next；本地 dev / dev:test 两条命令对应 710x/711x 端口；鉴权由 MOCK_JWT_SECRET 有无决定；所有 stage 使用同一套环境变量名。

**Tech Stack:** Serverless Framework v4, Node 20, Hono, serverless-offline, serverless-esbuild, Bun (本地脚本与测试)。

---

## Phase 1：目录与引用迁移

### Task 1: 创建 backend 并迁移 src

**Files:**
- Create: `apps/server-next/backend/` (目录)
- Move: `apps/server-next/src/*` → `apps/server-next/backend/`
- Modify: `apps/server-next/serverless.yml` (handler 与 esbuild 路径)
- Modify: `apps/server-next/package.json` (scripts 若有引用 src)

**Step 1:** 在 server-next 下创建 `backend`，将现有 `src` 下所有文件与子目录移动到 `backend/`（保持 backend 内结构与原 src 一致）。

**Step 2:** 更新 `serverless.yml`：`functions.api.handler` 改为 `backend/lambda.handler`；若 custom.esbuild 有 entry/packagePath 等指向 src，改为指向 backend。

**Step 3:** 更新 `package.json`：`dev:bun` 若为 `bun run src/index.ts`，改为 `bun run backend/index.ts`。检查 tsconfig 的 include，若含 `src/**` 改为 `backend/**`。

**Step 4:** 运行 `bun run typecheck` 与 `bun run test:unit`（单元测试路径若仍为 `tests/`，暂不改动，下一阶段再迁入 __tests__）。确认通过。

**Step 5:** Commit

```bash
git add apps/server-next/
git commit -m "refactor(server-next): move src to backend for casfa-next layout"
```

---

### Task 2: 将 E2E 迁入顶层 tests，并修正引用 backend

**Files:**
- Create: `apps/server-next/tests/` (若不存在)
- Move: `apps/server-next/e2e/*` → `apps/server-next/tests/`
- Modify: `apps/server-next/tests/setup.ts` 中 import 路径（如 `../src/` → `../backend/`）
- Modify: `apps/server-next/package.json` 的 test:e2e 与 scripts/e2e-offline.ts 的 e2e 路径

**Step 1:** 将 `e2e/` 下所有文件移动到 `tests/`；删除空目录 `e2e/`。

**Step 2:** 在 `tests/setup.ts` 中，把对 `../src/` 的 import 改为 `../backend/`（如 loadConfig, createApp, createCasFacade 等）。

**Step 3:** 在 `scripts/e2e-offline.ts` 中，将 `bun test e2e/` 改为 `bun test tests/`。在 `package.json` 中若有 `test:e2e": "bun test e2e/"` 改为 `"bun run scripts/e2e-offline.ts"` 或保持调用 e2e-offline 脚本且脚本内写 `bun test tests/`。

**Step 4:** 运行 `bun run test:e2e`（需已 `serverless login` 且依赖当前 serverless offline 端口；若 e2e-offline 仍用 3000，后续 Task 会改为 7111）。确认 E2E 通过或仅端口/路径相关失败待后续修。

**Step 5:** Commit

```bash
git add apps/server-next/
git commit -m "refactor(server-next): move e2e to top-level tests, fix backend imports"
```

---

### Task 3: 单元测试迁入 backend/__tests__

**Files:**
- Create: `apps/server-next/backend/__tests__/` 及子目录（auth, controllers, services 等，按现有 tests 结构）
- Move: `apps/server-next/tests/auth/*` → `backend/__tests__/auth/`，`tests/controllers/*` → `backend/__tests__/controllers/`，`tests/services/*` → `backend/__tests__/services/`，`tests/middleware/*` → `backend/__tests__/middleware/`
- Modify: 每个迁入的 test 文件中的 import 路径（如 `../../src/` → `../../` 或相对 backend 根）
- Modify: `package.json` 的 test:unit 为扫描 backend 的 __tests__（如 `bun test backend/` 或 `bun test 'backend/**/*.test.ts'`）

**Step 1:** 按现有 `tests/` 结构在 `backend/__tests__/` 下建立对应子目录；将各 test 文件移入并重命名为 `xxx.test.ts`（若尚未是）。

**Step 2:** 修正每个 test 文件内对 backend 代码的 import（从 `../src/xxx` 或 `../../src/xxx` 改为相对 backend 根的路径，如 `../config`、`../app`）。

**Step 3:** 更新 `package.json`：`"test:unit": "bun test backend/"`（或等价模式），确保只跑 backend 下 __tests__ 中的单测。

**Step 4:** 删除原 `tests/` 下已迁走的单测文件（仅保留 E2E 用的 tests/setup.ts 与 *.test.ts）。运行 `bun run test:unit`，全部通过。

**Step 5:** Commit

```bash
git add apps/server-next/
git commit -m "refactor(server-next): move unit tests into backend/__tests__"
```

---

### Task 4: 创建 shared 与 frontend 占位

**Files:**
- Create: `apps/server-next/shared/package.json`（或仅 README 说明用途）
- Create: `apps/server-next/shared/README.md` 说明此处放前后端共用的 schema、type、API 协议
- Create: `apps/server-next/frontend/package.json`（name: @casfa-next/frontend, private: true）
- Create: `apps/server-next/frontend/README.md` 说明前端为 SPA，build 产物将上传 S3

**Step 1:** 创建 `shared/` 与 `frontend/` 目录；在 shared 与 frontend 下各放 README 说明用途，frontend 可加最小 package.json 以便后续装构建工具。

**Step 2:** 若有 monorepo workspace，在根 `package.json` 的 workspaces 中已包含 `apps/*` 则无需改；否则确保 apps/server-next 下 frontend 可作为子包被识别（若需要）。

**Step 3:** Commit

```bash
git add apps/server-next/shared apps/server-next/frontend
git commit -m "chore(server-next): add shared and frontend placeholders"
```

---

## Phase 2：配置与 serverless 资源

### Task 5: 统一环境变量与 config 支持多环境

**Files:**
- Modify: `apps/server-next/backend/config.ts`
- Modify: `apps/server-next/serverless.yml` 的 provider.environment

**Step 1:** 在 `backend/config.ts` 中定义并导出一份「所有 stage 共用」的环境变量名列表（类型或常量）：如 PORT, STORAGE_TYPE, STORAGE_FS_PATH, MOCK_JWT_SECRET, COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, DYNAMODB_ENDPOINT, S3_BUCKET, LOG_LEVEL 等；loadConfig() 从 process.env 读取这些名字，不新增 AUTH_MODE；若存在 MOCK_JWT_SECRET（非空）则 auth 使用 mock，否则使用 Cognito 配置。

**Step 2:** 在 `serverless.yml` 的 provider.environment 中，用同一套变量名，值用 ${env:VAR, ''} 或 SSM/Secrets 引用（beta/prod 可先用 env 占位）；确保 Lambda 运行时能拿到与 config 一致的名字。

**Step 3:** 运行 typecheck 与单测，确认 config 无回归。

**Step 4:** Commit

```bash
git add apps/server-next/backend/config.ts apps/server-next/serverless.yml
git commit -m "feat(server-next): unified env vars and config, MOCK_JWT_SECRET implies mock auth"
```

---

### Task 6: serverless.yml 更名与基础资源占位

**Files:**
- Modify: `apps/server-next/serverless.yml`

**Step 1:** 将 service 名改为 `casfa-next`（原 casfa-server-next）。

**Step 2:** 在 serverless.yml 中增加 resources 占位（或注释）：DynamoDB 表名 `casfa-next-<table>`、S3 桶 `casfa-next-blob` 与 `casfa-next-frontend-${sls:stage}` 的说明或占位资源；本任务可只做注释/CloudFormation 骨架，具体表结构与桶策略在后续 Task 实现。若已有插件（如 serverless-dynamodb-local）的配置，可在此加上端口 7102/7112 的说明。

**Step 3:** 确认 `bunx serverless print` 或 `serverless package` 无语法错误。

**Step 4:** Commit

```bash
git add apps/server-next/serverless.yml
git commit -m "chore(server-next): rename service to casfa-next, add resource placeholders"
```

---

## Phase 3：本地 dev / dev:test 与端口

### Task 7: serverless-offline 端口按环境区分

**Files:**
- Modify: `apps/server-next/serverless.yml` 的 custom.serverless-offline
- Create or Modify: `apps/server-next/scripts/dev.ts`、`apps/server-next/scripts/dev-test.ts`

**Step 1:** 在 serverless.yml 的 custom.serverless-offline 中，默认 httpPort 保留为 7101（local-dev）。为 local-test 单独起服务时需 7111，可通过单独配置文件或脚本传参实现（如 `--httpPort 7111`）；本任务先保证 dev 使用 7101，dev:test 使用 7111 的约定写进 README 或脚本注释。

**Step 2:** 创建 `scripts/dev.ts`：启动 DynamoDB local（若使用 serverless-dynamodb-local，则先 sls dynamodb start 端口 7102）、然后启动 serverless offline --httpPort 7101；环境变量注入 APP_ENV=local-dev、DYNAMODB_ENDPOINT=http://localhost:7102，不设 MOCK_JWT_SECRET。若暂无 DynamoDB local，脚本内仅启动 serverless offline 并注入端口与 COGNITO_*。

**Step 3:** 创建 `scripts/dev-test.ts`：启动 serverless offline --httpPort 7111；环境变量注入 MOCK_JWT_SECRET=test-secret-e2e（或与 tests/setup.ts 一致），不启 DynamoDB 独立进程（后端用内存 store）。

**Step 4:** 在 package.json 中：`"dev": "bun run scripts/dev.ts"`，`"dev:test": "bun run scripts/dev-test.ts"`。运行 `bun run dev:test` 与 `bun run test:e2e`，确认 E2E 针对 7111 通过。

**Step 5:** Commit

```bash
git add apps/server-next/serverless.yml apps/server-next/scripts/ apps/server-next/package.json
git commit -m "feat(server-next): dev on 7101, dev:test on 7111, scripts dev and dev-test"
```

---

### Task 8: test:e2e 先起 dev:test 再跑 E2E

**Files:**
- Modify: `apps/server-next/scripts/e2e-offline.ts`
- Modify: `apps/server-next/tests/setup.ts`

**Step 1:** 在 `scripts/e2e-offline.ts` 中：将启动命令改为调用 dev:test（即启动 serverless offline 的 7111 端口），健康检查 URL 改为 `http://localhost:7111/api/health`；子进程运行 `bun run dev:test`（或直接 spawn serverless offline 并传入 7111 与 MOCK_JWT_SECRET 等 env）。

**Step 2:** 在 E2E 运行时设置 `BASE_URL=http://localhost:7111`，传给 `bun test tests/` 的环境。

**Step 3:** 确认 `tests/setup.ts` 在 BASE_URL 存在时使用该 URL；local-test 下固定使用 7111。

**Step 4:** 运行 `bun run test:e2e`，完整通过。

**Step 5:** Commit

```bash
git add apps/server-next/scripts/e2e-offline.ts apps/server-next/tests/setup.ts
git commit -m "feat(server-next): test:e2e starts dev:test then runs E2E on 7111"
```

---

## Phase 4：文档与收尾

### Task 9: 更新 README 与设计文档引用

**Files:**
- Modify: `apps/server-next/README.md`
- Modify: `docs/plans/2026-03-02-casfa-next-engineering-design.md`（若有需补充的“已实现”说明）

**Step 1:** 在 README 中更新目录说明：backend、frontend、shared、tests、scripts；说明 `bun run dev`（local-dev, 710x）、`bun run dev:test`（local-test, 711x）、`bun run test:e2e`（先起 dev:test 再测）；环境变量统一表指向设计文档或本 README 一小节。

**Step 2:** 在设计文档末尾添加“实施状态”：Phase 1–4 已完成，后续为 DynamoDB/S3 真实实现与 beta/prod 部署。

**Step 3:** Commit

```bash
git add apps/server-next/README.md docs/plans/2026-03-02-casfa-next-engineering-design.md
git commit -m "docs(server-next): README and design doc updates for casfa-next layout"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-02-casfa-next-engineering-impl.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints.

Which approach do you prefer?
