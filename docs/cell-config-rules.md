# Cell 配置规则

本文档约定 Cell 应用的环境变量与 `cell.yaml` 的配置原则，适用于所有使用 cell-cli 的 cell（如 sso、server-next、image-workshop 等）。

## 1. 基本原则

### 1.1 配置放在哪里

- **`cell.yaml`**：写死所有**非敏感、且同一实例本地与线上一致、且不随部署实例变化**的配置（如 cookie 名称与 path/max-age、PORT_BASE 的约定等）。
- **`.env` / `.env.local`**：放**敏感信息**、**本地与线上可能不同的值**、以及**随部署实例变化的值**（如 Cognito 的 region/userPoolId/clientId、域名、LOG_LEVEL、密钥等）。
- **根目录 `.env`**：放跨 cell 共享的配置（如 Cognito User Pool、DOMAIN_ZONE、IdP 凭据等）。cell-level `.env` 可覆盖。

### 1.2 没有「可选」env

- `cell.yaml` 里出现的每一个 **`!Env` / `!Secret`** 都**必须**在 `.env`（或由 `.env.local` 覆盖）中提供。
- 不允许「可选环境变量」：若某 key 在 params 中声明为 `!Env`，则未提供时会报错（MissingParamsError）。

### 1.3 非 secret 必须写推荐值并提交

- 所有**非 secret** 的、需要在 `.env` 中提供的项，都应在 **`.env.example`** 和 **`.env.local.example`** 里写上**推荐值**，并提交到代码库。
- 这样其他人复制 example 即可得到一套可用的默认配置。

---

## 2. 文件职责

| 文件 | 用途 | 是否提交 |
|------|------|----------|
| `cell.yaml` | 写死固定配置；声明 `!Env` / `!Secret` 的 key | 是 |
| `.env.example` | 部署/共享环境所需 env 的模板，**必填项 + 推荐值** | 是 |
| `.env.local.example` | 本地覆盖的模板，**必填项 + 推荐值**（用于覆盖 .env） | 是 |
| `.env` | 实际使用的部署/共享配置（含 secret 或线上线下不同的值） | 否（gitignore） |
| `.env.local` | 本地覆盖，**必须显式覆盖** .env 中需要不同的项 | 否（gitignore） |

---

## 3. 本地与 .env.local

### 3.1 本地专用配置

- 仅本地需要的配置（如 **PORT_BASE**、本地 DynamoDB 等）放在 **`.env.local`**，不放在 `.env`。
- cell-cli 根据 **PORT_BASE** 推算本地端口（如 DynamoDB = `PORT_BASE+2`），无需单独配置 `DYNAMODB_ENDPOINT`。

### 3.2 覆盖规则

- `.env.local` 中的变量应**显式覆盖** `.env` 中同 key 的值；若不在 `.env.local` 里写，则按 cell-cli 的加载顺序，`.env` 的值会继续生效。
- 因此：凡在 **`.env.local.example`** 里列出的项，都应视为**必须在本机 .env.local 中设置**的覆盖项，并填推荐值（如 `AUTH_COOKIE_DOMAIN=`、`LOG_LEVEL=debug`）。

---

## 4. 实践清单

- [ ] **cell.yaml**：能写死的都写死（非 secret 且本地/线上一致）；只对「secret 或本地/线上可能不同」的项使用 `!Env` / `!Secret`。
- [ ] **.env.example**：列出所有 `!Env` 的 key，每项一行并带推荐值；注释说明「每个 !Env 必须在此设置」。
- [ ] **.env.local.example**：列出本地必须覆盖的项（如 PORT_BASE、AUTH_COOKIE_DOMAIN、LOG_LEVEL 等），每项带推荐值；注释说明「此处列出的项均需在 .env.local 中设置以覆盖 .env」。
- [ ] 不在 .env.example / .env.local.example 中写「optional」；若在 cell.yaml 中声明了 `!Env`，则 example 中必须有对应项与推荐值。

---

## 5. 参考

- SSO cell 的配置示例：`apps/sso/cell.yaml`、`apps/sso/.env.example`、`apps/sso/.env.local.example`。
- cell-cli 解析逻辑：`apps/cell-cli/src/config/resolve-config.ts`（params → envVars）、`apps/cell-cli/src/utils/env.ts`（loadEnvFiles）。
