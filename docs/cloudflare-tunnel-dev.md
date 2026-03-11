# 用 Cloudflare Tunnel 暴露本地 Dev Server

已安装 `cloudflared` 的前提下，可以用两种方式把本机 `cell dev` 暴露到公网（方便手机/外网访问或 OAuth 回调）。

## 端口说明

`cell dev` 默认 `PORT_BASE=7100`：

- **7100**：前端（Vite），API 经 Vite 代理到后端
- **7101**：后端（Bun）

对外只需暴露 **7100** 即可访问完整应用。

若你在 `.env` 里设置了 `PORT_BASE=7200`（或其他值），下面所有 `7100` 改为你的 `PORT_BASE`。

---

## 方式一：Quick Tunnel（零配置，临时链接）

适合临时分享或快速验证，无需登录 Cloudflare、无需配置文件。

```bash
# 先在本机启动 dev（例如在 apps/server-next 下）
cd apps/server-next && cell dev

# 另开一个终端，运行（端口与上面 PORT_BASE 一致）
cloudflared tunnel --url http://localhost:7100
```

终端会打印类似：

```
Your quick Tunnel has been created! Visit it at:
https://random-name-xxx.trycloudflare.com
```

用该 URL 即可从外网访问当前 dev。链接在进程退出后失效。

---

## 方式二：Named Tunnel（固定域名）

适合长期使用、固定子域名（如 `dev.casfa.shazhou.me`）。

### 1. 在 Cloudflare 创建 Tunnel

1. 登录 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) 或 [Dashboard](https://dash.cloudflare.com/) → **Networks** → **Tunnels**。
2. **Create a tunnel** → 选 **Cloudflared**。
3. 输入名称（如 `casfa-dev`），创建后进入 **Configure**。
4. **Public Hostname**：选你的域名（如 `dev.casfa.shazhou.me`），Service 类型 **HTTP**，URL 填 `localhost:7100`（或你的 `PORT_BASE`）。
5. **Save tunnel**。
6. 在安装说明里下载 **credentials 文件**，放到本项目：

   ```bash
   mkdir -p .cloudflared
   # 把下载的 xxx.json 放到 .cloudflared/credentials.json
   ```

### 2. 使用项目内配置

```bash
# 复制示例配置
cp .cloudflared/config.yml.example .cloudflared/config.yml

# 编辑 .cloudflared/config.yml：
# - 把 <TUNNEL_ID> 换成 Zero Trust 里该 tunnel 的 ID（一串 UUID）
# - 把 hostname: dev.example.com 改成你的 hostname（需与第 1 步里 Public Hostname 一致）
```

### 3. DNS（若在 Cloudflare 管理 DNS）

在 **Zero Trust → Tunnels → 你的 tunnel → Public Hostname** 里已经绑定了 hostname 时，通常会自动或提示你添加 CNAME：  
`dev.xxx.com` → `<TUNNEL_ID>.cfargotunnel.com`。  
若没有，到 **DNS** 里手动加一条 CNAME 即可。

### 4. 启动 tunnel

```bash
# 确保 cell dev 已在运行（例如在 apps/server-next 下）
# 在项目根目录执行：
cloudflared tunnel run --config .cloudflared/config.yml
```

之后用你配置的域名（如 `https://dev.casfa.shazhou.me`）即可访问当前本机的 dev。

---

## 多应用 / 多端口（可选）

若同时跑多个 cell 应用（例如 server-next 用 7100、sso 用 7200），可以用同一 tunnel、多条 ingress，例如在 `config.yml` 里：

```yaml
ingress:
  - hostname: dev-next.example.com
    service: http://localhost:7100
  - hostname: dev-sso.example.com
    service: http://localhost:7200
  - service: http_status:404
```

并在 Cloudflare 里为这两个 hostname 都配好 Public Hostname 和 DNS。

---

## Casfa-Dev 多服务子域名（shazhou.work）

本机同时跑 SSO、drive、image-workshop、agent 时，可用固定子域名 `*.casfa-dev.shazhou.work` 访问，浏览器与服务间调用与线上一致（含 Cookie、OAuth 回调）。详见设计文档 [docs/plans/2026-03-11-casfa-dev-tunnel-design.md](plans/2026-03-11-casfa-dev-tunnel-design.md)。

### 子域名与端口区段

| 服务 | 子域名 | PORT_BASE |
|------|--------|-----------|
| SSO | sso.casfa-dev.shazhou.work | 7100 |
| server-next (drive) | drive.casfa-dev.shazhou.work | 7120 |
| image-workshop | workshop.casfa-dev.shazhou.work | 7140 |
| agent | agent.casfa-dev.shazhou.work | 7160 |

每服务预留 20 个端口（如 drive 使用 7120–7139），Tunnel 只暴露各服务前端端口（即 PORT_BASE）。配置文件见 `.cloudflared/config.yml.example`。

### 首次配置 Cloudflare（二选一）

**A) 命令行一键配置（推荐）**

前提：`shazhou.work` 已添加到 Cloudflare，且域名 NS 已指向 Cloudflare；本机已安装 `cloudflared`。

```bash
# 1. 一次性登录（会打开浏览器授权）
cloudflared tunnel login

# 2. 在项目根目录执行脚本：创建 tunnel、写 credentials、配 4 条 DNS、生成 config.yml
./scripts/setup-cloudflare-tunnel.sh
```

脚本会：创建名为 `casfa-dev` 的 tunnel、把 credentials 写到 `.cloudflared/credentials.json`、为 `sso/drive/workshop/agent.casfa-dev.shazhou.work` 各建一条 CNAME、从 example 生成 `.cloudflared/config.yml`。若 tunnel 已存在，会提示你确保 credentials 已放在上述路径（可从 Dashboard 下载）。

**B) 在 Dashboard 里手动配置**

1. 登录 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) 或 [Dashboard](https://dash.cloudflare.com/) → **Networks** → **Tunnels**。
2. **Create a tunnel** → 选 **Cloudflared**，名称填 `casfa-dev`，创建。
3. **Configure**：在 **Public Hostname** 里为每个子域名添加一条：
   - `sso.casfa-dev.shazhou.work` → HTTP → `localhost:7100`
   - `drive.casfa-dev.shazhou.work` → HTTP → `localhost:7120`
   - `workshop.casfa-dev.shazhou.work` → HTTP → `localhost:7140`
   - `agent.casfa-dev.shazhou.work` → HTTP → `localhost:7160`
4. **Save** 后到安装说明里下载 **credentials**，保存到项目 `.cloudflared/credentials.json`。
5. 复制配置并改 tunnel ID：`cp .cloudflared/config.yml.example .cloudflared/config.yml`，把其中的 `<TUNNEL_ID>` 换成该 tunnel 的 UUID（Tunnels 列表里可见）或名称 `casfa-dev`。

DNS 若由 Cloudflare 管理，添加 Public Hostname 时通常会提示或自动创建 CNAME；否则到 **DNS** 里为上述 4 个 hostname 各加一条 CNAME，指向 `<TUNNEL_ID>.cfargotunnel.com`。

### Env 配置

复制根目录 `.env.casfa-dev.example` 为 `.env.casfa-dev`，或把其中对应服务的变量合并到各 app 的 `.env`。每个 app 需设置本 app 的 `PORT_BASE` 以及依赖的 `SSO_BASE_URL` / `CELL_BASE_URL`。

- **SSO** 必须设置 `AUTH_COOKIE_DOMAIN=.casfa-dev.shazhou.work`，以便 sso/drive/workshop/agent 共享登录态。
- 各 app 在 tunnel 模式下也应设置本 app 的 `CELL_BASE_URL`（如 SSO 设为 `https://sso.casfa-dev.shazhou.work`），这样 `cell dev` 会将该 origin 的 `/oauth/callback` 自动注册到 Cognito。

### 启动顺序

1. 在项目根目录启动 tunnel：`cloudflared tunnel run --config .cloudflared/config.yml`。
2. 在各 app 目录分别启动 `cell dev`，并确保该终端已加载对应 env（例如 `export $(grep -v '^#' .env.casfa-dev | xargs)` 后只保留当前 app 需要的变量，或在各 app 的 `.env` 中写好 PORT_BASE 与 base URL）。

浏览器只访问 `https://drive.casfa-dev.shazhou.work` 等子域名，不再使用 localhost。

### Cognito

当 env 中存在 `CELL_BASE_URL` 且为 https 时，`cell dev` 会自动将该 origin 的 `/oauth/callback` 注册到 Cognito App Client，无需在控制台手动添加。

---

## 安全提醒

- Quick Tunnel 的链接谁拿到都能访问，不要用于敏感数据。
- `.cloudflared/credentials.json` 已加入 `.gitignore`，不要提交到仓库。
- 若 dev 里用了本地 Cognito 回调，在 Cognito 的「回调 URL」里加上你的 tunnel 地址（Quick 的 `https://xxx.trycloudflare.com/oauth/callback` 或 Named 的 `https://dev.xxx.com/oauth/callback`）。
