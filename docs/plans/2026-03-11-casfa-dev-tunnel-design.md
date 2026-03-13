# 本地多微服务 Cloudflare Tunnel 方案设计（casfa-dev.shazhou.work）

## 1. 目标与约束

- **目标**：本机同时跑多个 cell 微服务（SSO、server-next/drive、image-workshop、agent），通过 Cloudflare Tunnel 用固定子域名暴露，浏览器和服务间调用都走子域名，行为与线上一致（含 Cookie、OAuth 回调）。
- **根域**：使用自有域名 `shazhou.work`，dev 子域为 `*.casfa-dev.shazhou.work`。
- **线上**：server-next 生产域名已从 `beta.casfa.shazhou.me` 改为 `drive.casfa.shazhou.me`（与本文无关，已落地）。

## 2. 子域名与端口区段

每服务预留 20 个端口的区段，Tunnel 只暴露前端端口（PORT_BASE）。

| 服务 | 子域名 | PORT_BASE | 区段 |
|------|--------|-----------|------|
| SSO | sso.casfa-dev.shazhou.work | 7100 | 7100–7119 |
| server-next (drive) | drive.casfa-dev.shazhou.work | 7120 | 7120–7139 |
| image-workshop | workshop.casfa-dev.shazhou.work | 7140 | 7140–7159 |
| agent | agent.casfa-dev.shazhou.work | 7160 | 7160–7179 |

## 3. Tunnel 配置

- **方式**：一个 Named Tunnel，一份 `.cloudflared/config.yml`，多条 ingress。
- **内容**：见 `.cloudflared/config.yml.example`。credentials 放在 `.cloudflared/credentials.json`（已 gitignore）。
- **DNS**：在 Cloudflare 为 `shazhou.work` 添加 CNAME，将 `*.casfa-dev.shazhou.work` 或各 hostname 指到 `<TUNNEL_ID>.cfargotunnel.com`。

## 4. 各 Cell 的 env 与 Cookie（casfa-dev 模式）

本地用子域名访问时，各 app 需通过 env 指定 PORT_BASE 和互访 base URL，且 Cookie 根域需一致。

**建议**：在仓库根或各 app 下提供 `.env.casfa-dev.example`（不提交 `.env.casfa-dev`，可 gitignore），内容示例：

```bash
# 端口区段：sso 7100, drive 7120, workshop 7140, agent 7160
# 以下为 drive (server-next) 示例
PORT_BASE=7120
CELL_BASE_URL=https://drive.casfa-dev.shazhou.work
SSO_BASE_URL=https://sso.casfa-dev.shazhou.work
# workshop 还需 CELL_BASE_URL（指向 drive）；agent 同 drive 只需 SSO_BASE_URL
```

**SSO 的 Cookie**：`AUTH_COOKIE_DOMAIN=.casfa-dev.shazhou.work`，使 sso/drive/workshop/agent 共享登录态。在 SSO 的 `.env` 或 `.env.casfa-dev` 中设置（SSO 使用 `AUTH_COOKIE_DOMAIN: !Env AUTH_COOKIE_DOMAIN`）。SSO 在 tunnel 模式下也需设置 `CELL_BASE_URL=https://sso.casfa-dev.shazhou.work`，以便 `cell dev` 将该 origin 的 `/oauth/callback` 注册到 Cognito。

**CELL_BASE_URL 注入**：当前 `cell dev` 会覆盖 `CELL_BASE_URL` 为 `http://localhost:${frontendPort}`。为支持 tunnel 模式，需改为：若 env 中已设置 `CELL_BASE_URL`（如来自 .env），则使用该值，否则再用 localhost。这样在 casfa-dev 模式下各服务会使用子域名互访。

## 5. Cognito 回调 URL

- **现有逻辑**：`cell dev` 启动时调用 `ensureCognitoDevCallbackUrl`，将 `http://localhost:${frontendPort}/oauth/callback` 加入 Cognito App Client。
- **Tunnel 模式**：回调应为 `https://<子域名>/oauth/callback`。两种做法：
  - **推荐**：当 env 中存在 `CELL_BASE_URL` 且为 https 时，`ensureCognitoDevCallbackUrl` 使用该 origin 的 `/oauth/callback`（即 `CELL_BASE_URL` 来自 env 时，同时用该 origin 注册 callback）；这样首次用 tunnel 跑各 app 的 `cell dev` 时即可自动注册。
  - 或：在 Cognito 控制台为每个 casfa-dev 子域名手动添加 Callback URL / Logout URL（一次性操作，文档说明即可）。

## 6. 启动流程

1. **一次性**：Cloudflare 创建 Tunnel、下载 credentials、配置 DNS、复制并编辑 `.cloudflared/config.yml`。
2. **每次开发**：
   - 启动 tunnel：`cloudflared tunnel run --config .cloudflared/config.yml`（项目根目录）。
   - 在各 app 目录用对应 PORT_BASE 与 base URL 启动：例如在 `apps/sso` 下设置 `PORT_BASE=7100`、`SSO_BASE_URL` 可不设（SSO 自身不需要）、`AUTH_COOKIE_DOMAIN=.casfa-dev.shazhou.work`，执行 `cell dev`；在 `apps/server-next` 下设置 `PORT_BASE=7120`、`CELL_BASE_URL=https://drive.casfa-dev.shazhou.work`、`SSO_BASE_URL=https://sso.casfa-dev.shazhou.work`，执行 `cell dev`；workshop、agent 同理。
3. 浏览器只访问 `https://drive.casfa-dev.shazhou.work` 等，不再用 localhost。

可选：提供脚本或文档，从 `.env.casfa-dev.example` 复制为 `.env.casfa-dev` 并导出，再按顺序启动各 app 的 `cell dev`（或用 tmux/split 多终端）。

## 7. 错误处理与测试

- Tunnel 未启动时访问子域名会得到 Cloudflare 错误页；文档中说明需先启动 cloudflared。
- 端口冲突：若某 app 的 PORT_BASE 被占用，cell dev 会报错，提示检查端口或其它进程。
- 单元测试不依赖 tunnel；e2e 若需多服务联调，可复用同一套 env 与端口约定。

## 8. 文档与示例

- 更新 `docs/cloudflare-tunnel-dev.md`：增加「casfa-dev 多服务子域名」一节，说明子域名、端口区段、.env 示例、启动顺序、Cognito 与 Cookie。
- `.cloudflared/config.yml.example` 已包含四服务 ingress 与注释。
- 各 app 的 `.env.example` 或 README 可简要说明：本地 tunnel 模式时复制 `.env.casfa-dev.example` 并设置 PORT_BASE 与 base URL。
