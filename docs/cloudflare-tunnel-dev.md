# 用 Cloudflare Tunnel 暴露本地 Dev Server

已安装 `cloudflared` 的前提下，可以用两种方式把本机 `cell dev` 暴露到公网（方便手机/外网访问或 OAuth 回调）。

## 端口说明

`cell dev` 默认 `PORT_BASE=7100`：

- **7100**：前端（Vite），API 经 Vite 代理到后端
- **7101**：后端（Bun）

对外只需暴露 **7100** 即可访问完整应用。

若你在 `.env` 里设置了 `PORT_BASE=7200`（或其他值），下面所有 `7100` 改为你的 `PORT_BASE`。

---

## 方式一：Devbox（推荐，固定子域名）

适合长期使用、多 cell 共用一条 tunnel、按 Host 自动分流到各服务。

配置与 tunnel 统一放在 **本机** `~/.config/casfa/`，不依赖项目里的 `.cloudflared/`。

### 首次配置

```bash
# 1. 一次性登录（会打开浏览器授权）
cloudflared tunnel login

# 2. 在任意目录执行（会写 ~/.config/casfa/devbox.yaml、config.yml、credentials 等）
cell devbox prepare
```

按提示选择 dev 根域（如 `shazhou.work`）、本机名（默认来自 hostname），可选填写 Cloudflare API token（用于 zone 列表与 DNS）。完成后会生成 tunnel 和 DNS 路由。

### 日常使用

```bash
# 启动 proxy + tunnel（后台）
cell devbox start

# 在各 cell 目录（如 apps/server-next）运行 dev，路由会自动注册
cd apps/server-next && cell dev
```

访问地址形如：`https://<subdomain>.<devboxName>.<devRoot>`（例如 `https://server-next.mymbp.shazhou.work`）。  
查看/停止：`cell devbox status`、`cell devbox stop`；查看配置：`cell devbox info`。

---

## 方式二：Quick Tunnel（零配置，临时链接）

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

## 方式三：Named Tunnel（手动配置，单机单域）

适合只需要一个固定域名、不想用 devbox 的场景。

### 1. 在 Cloudflare 创建 Tunnel

1. 登录 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) 或 [Dashboard](https://dash.cloudflare.com/) → **Networks** → **Tunnels**。
2. **Create a tunnel** → 选 **Cloudflared**。
3. 输入名称（如 `my-dev`），创建后进入 **Configure**。
4. **Public Hostname**：选你的域名（如 `dev.casfa.shazhou.me`），Service 类型 **HTTP**，URL 填 `localhost:7100`（或你的 `PORT_BASE`）。
5. **Save tunnel**。
6. 在安装说明里下载 **credentials 文件**，放到本机目录（例如 `~/.config/casfa/` 或项目下的 `.cloudflared/`，需自建 `config.yml`）。

### 2. 编写 config.yml

在放 credentials 的目录新建 `config.yml`，内容示例：

```yaml
tunnel: <你的 TUNNEL_ID 或名称>
credentials-file: <credentials.json 的路径>

ingress:
  - hostname: dev.casfa.shazhou.me
    service: http://localhost:7100
  - service: http_status:404
```

### 3. 启动 tunnel

```bash
cloudflared tunnel run --config <你的 config.yml 路径>
```

之后用你配置的域名（如 `https://dev.casfa.shazhou.me`）即可访问当前本机的 dev。

---

## 多应用 / 多端口（可选）

若同时跑多个 cell 应用且**不用 devbox**，可在同一 tunnel 的 `config.yml` 里写多条 ingress，例如：

```yaml
ingress:
  - hostname: dev-next.example.com
    service: http://localhost:7100
  - hostname: dev-sso.example.com
    service: http://localhost:7200
  - service: http_status:404
```

并在 Cloudflare 里为这两个 hostname 都配好 Public Hostname 和 DNS。  
**推荐**：直接用 `cell devbox prepare` + `cell devbox start`，一条 tunnel + 本地 proxy 按 Host 分流，无需手写多条 ingress。

---

## 安全提醒

- Quick Tunnel 的链接谁拿到都能访问，不要用于敏感数据。
- 若 dev 里用了 Cognito 回调，在 Cognito 的「回调 URL」里加上你的 tunnel 地址（Quick 的 `https://xxx.trycloudflare.com/oauth/callback` 或 Named 的 `https://dev.xxx.com/oauth/callback`）。Devbox 下 `cell dev` 会自动为当前 cell 的 origin 注册 callback。
