# server-next 本地 DynamoDB 改为 Docker 模式迁移计划

## 背景与目标

- **现状**：`apps/server-next` 使用 **serverless-dynamodb** 插件在本地启动 DynamoDB（Java JAR，端口 7102），与 serverless-offline 同进程。插件不稳定，易出现文件锁、进程未退出、需频繁重启等问题。
- **参考**：`apps/server` 已采用 **Docker** 运行 DynamoDB Local：dev 用持久化实例（8700），test 用 in-memory 实例（8701），由 dev 脚本检测并拉容器，无需 Java、无插件子进程。
- **目标**：将 server-next 本地 DynamoDB 改为 Docker 模式，与 server 一致：**dev 用持久化实例，test 用 in-memory 实例**，并移除 serverless-dynamodb 插件依赖。

## 端口与实例约定

| 环境       | 用途         | 端口 | 容器名        | 持久化     |
|------------|--------------|------|---------------|------------|
| dev        | 日常开发     | 7102 | dynamodb      | 是（volume） |
| local-test | E2E / dev:test | 7112 | dynamodb-test | 否（in-memory） |

说明：server-next 使用 7102/7112，与 server 的 8700/8701 错开，避免同时跑两套 app 时端口冲突。

## 实施步骤

### 1. 新增 `apps/server-next/docker-compose.yml`

- **dynamodb**（持久化）  
  - image: `amazon/dynamodb-local:latest`  
  - 端口：`7102:8000`  
  - command: `-jar DynamoDBLocal.jar -sharedDb -dbPath /data`  
  - volumes: `dynamodb-data:/data`  
  - restart: `unless-stopped`

- **dynamodb-test**（in-memory）  
  - image: `amazon/dynamodb-local:latest`  
  - 端口：`7112:8000`  
  - command: `-jar DynamoDBLocal.jar -sharedDb -inMemory`  
  - restart: `no`

- 仅定义 volumes: `dynamodb-data`（server-next 不需要 Redis，不复制 server 的 redis 服务）。

### 2. 移除 serverless-dynamodb 插件

- 在 `serverless.yml` 的 `plugins` 中删除 `serverless-dynamodb`。
- 删除 `custom.serverless-dynamodb` 整段配置。
- 不再依赖 Java、不再使用 `.dynamodb` 目录或插件内建 migrate。

### 3. 本地表创建脚本 `scripts/create-local-tables.ts`

- **职责**：在本地 DynamoDB（Docker）中创建 server-next 所需的两张表，与 `serverless.yml` 中 CloudFormation 定义一致。
- **表名**：  
  - `casfa-next-${stage}-delegates`  
  - `casfa-next-${stage}-grants`
- **入参 / 环境变量**：  
  - `DYNAMODB_ENDPOINT`（如 `http://localhost:7102` 或 `http://localhost:7112`）  
  - `STAGE` 或 `--stage`（默认 `dev`），用于拼表名。
- **表结构**：从当前 `serverless.yml` 的 `DelegatesTable`、`DelegateGrantsTable` 抄写 AttributeDefinitions、KeySchema、GlobalSecondaryIndexes，用 AWS SDK `CreateTableCommand` 创建；若已存在（ResourceInUseException）则跳过。
- **可执行方式**：`bun run scripts/create-local-tables.ts`，支持 `--stage local-test`、`--endpoint http://localhost:7112` 等，便于 dev 与 test 共用同一脚本。

### 4. 修改 `scripts/dev.ts`（dev，mock 鉴权）

- 加载 `.env`（保持现有逻辑）。
- 检测 Docker 是否可用（如 `docker info` 或 `docker compose version`）；若不可用则报错并退出。
- 若 DynamoDB 未在 7102 就绪：  
  - 执行 `docker compose up -d dynamodb`（cwd: `apps/server-next`）。  
  - 轮询等待 DynamoDB 可连接（如 ListTables），超时与重试次数可参考 server 的 dev.ts。
- 调用本地表创建：`DYNAMODB_ENDPOINT=http://localhost:7102`、stage=dev，执行 create-local-tables（可 spawn 或 import 调用）。
- 设置环境变量：`DYNAMODB_ENDPOINT=http://localhost:7102`、`S3_ENDPOINT`、`S3_BUCKET` 等（与现有一致），**不再**依赖插件传入。
- 启动 `serverless offline start --httpPort 7101`（不再启动 DynamoDB 插件）。

### 5. 修改 `scripts/dev-cognito.ts`（dev，Cognito 鉴权）

- 与 dev.ts 相同：加载根目录 `.env`（Cognito 等）、检测 Docker、启动/等待 dynamodb 容器（7102）、创建本地表、设置 `DYNAMODB_ENDPOINT` 等，再启动 serverless offline。
- 不启动 serverless-dynamodb，不传任何插件相关 env。

### 6. 修改 `scripts/dev-test.ts`（local-test，E2E 用）

- 使用 **dynamodb-test** 容器，端口 **7112**。
- 检测 Docker；若 7112 未就绪则 `docker compose up -d dynamodb-test`，再等待 DynamoDB 就绪。
- 创建表：`DYNAMODB_ENDPOINT=http://localhost:7112`、stage=local-test。
- 环境变量：`STAGE=local-test`、`DYNAMODB_ENDPOINT=http://localhost:7112`、`S3_ENDPOINT`、`S3_BUCKET=casfa-next-local-test-blob`，以及 mock auth（`MOCK_JWT_SECRET`）。
- 启动 serverless offline：`--httpPort 7111`、`--lambdaPort 7113`、`--stage local-test`（端口与现有一致）。

### 7. 修改 `scripts/e2e-offline.ts`

- 当前逻辑：启动 dev:test（serverless offline + local-test stage），等健康后跑 E2E。
- 变更：dev:test 已改为“先起 dynamodb-test + 建表，再起 serverless offline”，因此 e2e-offline 只需确保调用的是更新后的 dev:test 流程；若 e2e 脚本内部直接 spawn serverless offline，则需在 spawn 前增加“启动 dynamodb-test + 建表”的步骤，并与 dev-test.ts 保持一致（7112、local-test）。
- 建议：e2e-offline 通过 `bun run dev:test` 或等价方式在后台启动一进程（包含 Docker + 建表 + offline），再 waitForHealthy；这样只需维护 dev-test 一处“test 环境”的启动逻辑。

### 8. 依赖与清理

- **package.json**：移除 `serverless-dynamodb` 依赖。
- **clean:db**：当前为 `rimraf .dynamodb`。改为 Docker 后可选：  
  - 保留并注明“仅当曾用插件时遗留目录才需要”；或  
  - 改为 `docker compose down -v`（仅 server-next 的 compose）以清理 dynamodb volume；或两者并存（clean:db 执行 rimraf + 可选 docker compose down -v）。建议 README 中说明“彻底清空 dev 数据可 `docker compose down -v`”。

### 9. 文档与 .env.example

- **README.md**  
  - 本地开发前置：从“需要 Java、`bunx serverless dynamodb install`”改为“需要 Docker”；首次或未起容器时执行 `docker compose up -d dynamodb`（或由 dev 脚本自动拉起）。  
  - 端口说明：7102 = dev 持久化 DynamoDB，7112 = local-test in-memory。  
  - 移除 serverless-dynamodb、NoClassDefFoundError、clean:db 与 Java 相关的故障排查，改为“若 DynamoDB 未就绪请先启动 Docker 并运行 `docker compose up -d dynamodb` 或 `dynamodb-test`”。  
  - “为何 DynamoDB Local 经常要重启”一段可改为简短说明：已改为 Docker 模式，dev 使用持久化容器，test 使用 in-memory 容器，无需再依赖插件或 Java。

- **.env.example**  
  - `DYNAMODB_ENDPOINT`：说明 dev 为 `http://localhost:7102`，local-test 为 `http://localhost:7112`；本地由脚本或 Docker 提供，无需安装 Java/插件。

### 10. 验收

- 在 `apps/server-next` 下：  
  - `bun run dev` 与 `bun run dev:cognito`：能自动或手动起 dynamodb（7102）、建表、启动 offline，API 正常访问。  
  - `bun run dev:test`：起 dynamodb-test（7112）、建表、offline 7111，API 正常。  
  - `bun run test:e2e`：依赖 dev:test 的流程，E2E 全部通过。  
- 不再安装 Java、不执行 `serverless dynamodb install`、不依赖 serverless-dynamodb 插件。
- 若同时运行 `apps/server` 与 `apps/server-next`，DynamoDB 端口不冲突（8700/8701 vs 7102/7112）。

## 风险与回退

- **风险**：CI 或本机未装 Docker 时无法跑本地 dev/test。缓解：README 明确写“需要 Docker”；CI 若需跑 E2E，需提供 Docker（或保留一条“仅单元测试、不启 DynamoDB”的路径）。
- **回退**：保留原 serverless-dynamodb 配置的注释或单独分支，需要时可恢复插件与 `custom.serverless-dynamodb`，并恢复 dev/dev-cognito/dev-test 中“不启 Docker、由插件起 DynamoDB”的逻辑。

## 小结

| 项目           | 变更说明 |
|----------------|----------|
| 新增           | `docker-compose.yml`（dynamodb 7102 + dynamodb-test 7112）、`scripts/create-local-tables.ts` |
| serverless.yml | 移除 serverless-dynamodb 插件及 custom 配置 |
| dev / dev-cognito | 先 Docker 起 dynamodb、建表，再 serverless offline；DYNAMODB_ENDPOINT=7102 |
| dev-test       | 先 Docker 起 dynamodb-test、建表，再 serverless offline；DYNAMODB_ENDPOINT=7112 |
| e2e-offline    | 确保使用带 Docker + 建表的 dev:test 流程 |
| package.json  | 移除 serverless-dynamodb |
| README / .env.example | 更新为 Docker 前置、端口说明，去掉 Java/插件相关说明 |

按上述步骤实施后，server-next 本地 DynamoDB 与 apps/server 一致，改为 Docker 模式，dev 用持久化实例、test 用 in-memory 实例，不再依赖 serverless-dynamodb 插件。
