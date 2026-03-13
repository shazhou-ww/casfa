# server-next 迁移到 Cell 设计文档

## 1. 目标与范围

- 将 server-next 从 Serverless Framework 迁移到 Cell，单一生产环境，域名 **drive.casfa.shazhou.me**。
- 不迁移旧 beta 数据（新 Cell 全新表/桶）；一次性切流量，完全改用 Cell（移除 Serverless、相关脚本与依赖）。
- **Cognito 登录与 delegate 授权**统一到 cell 方案：使用 `@casfa/cell-cognito`、`@casfa/cell-oauth`，前端使用 `@casfa/cell-auth-client`，参考 image-workshop。
- **OAuth、delegate、MCP 路由**与 image-workshop 规范化一致（见第 4 节）。

## 2. 架构概览

- **Cell 配置**：`cell.yaml`（name: `casfa-next`），backend 单 entry、frontend、tables（realms、grants）、buckets（blob）、params、cognito、domain（host: `drive.casfa.shazhou.me`）。
- **认证**：cell-cognito（JWT 校验）+ cell-oauth（OAuth Server + grant store）。Bearer 解析用 `oauthServer.resolveAuth(token)`；**branch token**（worker）保留在 server-next 内：`resolveAuth` 为 null 时再解析 base64 branchId + BranchStore。
- **前端**：cell-auth-client，登录走 `/oauth/authorize` → `/oauth/callback` → `/oauth/token`，不再直连 Cognito Hosted UI。
- **环境变量**：Cell 注入 `DYNAMODB_TABLE_REALMS`、`DYNAMODB_TABLE_GRANTS`、`S3_BUCKET_BLOB`、`FRONTEND_BUCKET`、`APP_ORIGIN`（cloud）及 params；backend 读 `S3_BUCKET_BLOB`（不再用 `S3_BUCKET`）。

## 3. 表结构

### 3.1 realms（原 delegates 表，改名）

- **用途**：BranchStore（realm 根 + branch 元数据），与「委托」无关，故改名。
- **主键**：pk (S), sk (S)。
- **GSI**：realm-index (gsi1pk, gsi1sk)。
- **数据形态**：
  - Realm 根：pk=`REALM#realmId`, sk=`REALM`, rootBranchId。
  - Branch 行：pk=`BRANCH#branchId`, sk=`METADATA`|`ROOT`；属性用 **branchId**（不再用 delegateId）；GSI1：gsi1pk=`REALM#realmId`, gsi1sk=`PARENT#parentId`。
- **环境变量**：`DYNAMODB_TABLE_REALMS`。
- **代码**：`dynamo-branch-store.ts` 中 `PK_PREFIX` 改为 `BRANCH#`，item 统一用 branchId。

### 3.2 grants（与 image-workshop 一致）

- **用途**：cell-oauth 的 DelegateGrantStore（OAuth delegate token）。
- **主键**：pk (S), sk (S)。
- **GSI**：user-hash-index (gsi1pk, gsi1sk)，user-refresh-index (gsi2pk, gsi2sk)。
- **键**：USER#userId（与 image-workshop/cell-oauth 一致）；server-next 侧 realmId 当 userId 使用。
- **环境变量**：`DYNAMODB_TABLE_GRANTS`。
- **实现**：直接使用 cell-oauth 的 `createDynamoGrantStore`，不再保留 server-next 的 dynamo-delegate-grant-store。

### 3.3 衍生数据（本次不落表）

- **DerivedDataStore**（path_index、dir_entries、realm_stats）当前为内存实现，本次迁移**不**新增 DynamoDB 表。
- **TODO**：后续增加 DynamoDB 表（如 derived_data）并实现 `createDynamoDerivedDataStore`；见 `backend/db/derived-data.ts` 内 TODO。

## 4. 路由规范化（与 image-workshop 一致）

| 类别 | 路径 | 说明 |
|------|------|------|
| **OAuth** | `/.well-known/oauth-authorization-server`，`/oauth/register`，`/oauth/authorize`，`/oauth/callback`，`/oauth/token`，`/oauth/consent-info`，`/oauth/approve`，`/oauth/deny` | cell-oauth 提供 |
| **Delegates** | `GET /api/delegates`，`POST /api/delegates`，`POST /api/delegates/:id/revoke` | realm 从 auth.userId 取，不再放 path |
| **MCP** | `POST /mcp`，`GET /mcp`（及可选 `/mcp/*`） | 去掉 `/api` 前缀，与 image-workshop 一致 |

- **保留的 server-next 业务 API**（路径不变）：`/api/health`，`/api/info`，`/api/me`，`/api/realm/:realmId/*`（files、fs、branches、realm 等），不再有 `/api/realm/:realmId/delegates`。
- **删除**：`/api/oauth/*`、`/api/oauth/mcp/*` 全部由 `/oauth/*` 与 `/mcp` 替代；MCP 客户端与 discovery 指向 `/mcp`。

## 5. cell.yaml 要点

```yaml
name: casfa-next

backend:
  runtime: nodejs20.x
  entries:
    api:
      handler: backend/lambda.ts
      timeout: 30
      memory: 1024
      routes:
        - /api/*
        - /oauth/*
        - /.well-known/*
        - /mcp

frontend:
  dir: frontend
  entries:
    main:
      src: main.tsx   # 或当前入口路径

tables:
  realms:
    keys: { pk: S, sk: S }
    gsi:
      realm-index:
        keys: { gsi1pk: S, gsi1sk: S }
        projection: ALL
  grants:
    keys: { pk: S, sk: S }
    gsi:
      user-hash-index:
        keys: { gsi1pk: S, gsi1sk: S }
        projection: ALL
      user-refresh-index:
        keys: { gsi2pk: S, gsi2sk: S }
        projection: ALL

buckets:
  blob: {}

params:
  COGNITO_REGION: !Env
  COGNITO_USER_POOL_ID: !Env
  COGNITO_CLIENT_ID: !Env
  COGNITO_HOSTED_UI_URL: !Env
  COGNITO_CLIENT_SECRET: !Secret   # 可选，PKCE 可不配
  MOCK_JWT_SECRET: !Secret         # 仅 dev
  API_BASE_URL: !Env               # 可选
  MAX_BRANCH_TTL_MS: !Env          # 可选
  LOG_LEVEL: !Env                  # 可选

cognito:
  region: !Param COGNITO_REGION
  userPoolId: !Param COGNITO_USER_POOL_ID
  clientId: !Param COGNITO_CLIENT_ID
  hostedUiUrl: !Param COGNITO_HOSTED_UI_URL

domain:
  zone: shazhou.me
  host: drive.casfa.shazhou.me
```

## 6. 后端改动清单

- 增加依赖：`@casfa/cell-cognito`、`@casfa/cell-oauth`。
- 用 cell-cognito + cell-oauth 构造 oauthServer，挂载 OAuth 路由（与 image-workshop 相同形态）、`/api/delegates`（与 image-workshop 相同路径与语义）、`/mcp`（POST/GET）。
- Auth 中间件：先 `oauthServer.resolveAuth(bearer)`，再 branch token 解析；将 cell-oauth 的 Auth 映射为现有 AuthContext（含 worker）。
- Config：读 `DYNAMODB_TABLE_REALMS`、`DYNAMODB_TABLE_GRANTS`、`S3_BUCKET_BLOB`；BranchStore 用 realms 表。
- dynamo-branch-store：`PK_PREFIX` → `BRANCH#`，item 用 branchId；表名来自 `DYNAMODB_TABLE_REALMS`。
- 删除：`backend/auth/cognito-jwks.ts`、`backend/services/mcp-oauth.ts`、自实现 OAuth/MCP 路由、`dynamo-delegate-grant-store.ts`（改用 cell-oauth createDynamoGrantStore）。

## 7. 前端改动清单

- 增加依赖：`@casfa/cell-auth-client`。
- 登录与带 token 请求：`createAuthClient`、`createApiFetch`；登录入口跳转 `/oauth/authorize`；callback 页用 code 调 `/oauth/token` 写 auth 状态。
- Delegates 请求：改为 `GET /api/delegates`、`POST /api/delegates`、`POST /api/delegates/:id/revoke`。
- MCP / OAuth discovery：issuer 同源，discovery `/.well-known/oauth-authorization-server`；MCP 端点 `/mcp`。

## 8. 删除与迁移

- 删除：`serverless.yml`，serverless 相关依赖与插件，scripts 内 dev/deploy 等（改为 `cell dev`、`cell test`、`cell deploy`）。
- 更新：`package.json` 脚本、README、`.env.example`（Cell params 与 PORT_BASE 等）。

## 9. 部署与域名

- 部署：在 server-next 目录执行 `cell deploy`；DNS 已指 drive.casfa.shazhou.me 则直接生效。
- 不迁数据；旧 beta stack 可下线。

## 10. 后续工作

- **DerivedDataStore 持久化**：后续增加 DynamoDB 表（如 derived_data）并实现 `createDynamoDerivedDataStore`；见 `backend/db/derived-data.ts` TODO。
