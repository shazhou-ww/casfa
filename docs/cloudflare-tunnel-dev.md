# 用 Cloudflare Tunnel 暴露本地 Dev Server

已安装 `cloudflared` 的前提下，可以用两种方式把本机 `cell dev` 暴露到公网（方便手机/外网访问或 OAuth 回调）。

**Platform 模式（单域 path）**：在仓库根目录存在 `stack.yaml` 时，在根目录执行 `cell dev` 可在一个进程内启动所有 cell，访问地址为 `http://localhost:8900/sso/`、`/agent/` 等。平台构建用 `cell build`，产出到 `dist/<pathPrefix>`；单 stack 部署用 `cell deploy`（需存在 `stack.yaml`）。详见 `docs/plans/2026-03-11-single-domain-path-design.md`。

## 端口说明

`cell dev` 默认 `PORT_BASE=7100`：

- **7100**：前端（Vite），API 经 Vite 代理到后端
- **7101**：后端（Bun）

对外只需暴露 **7100** 即可访问完整应用。

若你在 `.env` 里设置了 `PORT_BASE=7200`（或其他值），下面所有 `7100` 改为你的 `PORT_BASE`。

---

## 方式一：Devbox（推荐，固定子域名）

适合长期使用、多 cell 共用一条 tunnel、按 Host 自动分流到各服务。Dev 使用**两级子域**（如 `sso.casfa.mymbp.shazhou.work`），与线上形式一致，便于 SSO/Cognito 与 cookie 配置。

配置与 tunnel 统一放在 **本机** `~/.config/casfa/`，不依赖项目里的 `.cloudflared/`。

### 前置条件：Total TLS

Dev 地址为两级子域（`<subdomain>.<devboxName>.<devRoot>`），Universal SSL 只覆盖一级子域，因此**必须在 Cloudflare 该 zone 上启用 Total TLS**，边缘才会为 `sso.casfa.mymbp.shazhou.work` 等签发证书，否则会出现 ERR_SSL_VERSION_OR_CIPHER_MISMATCH。

**`cell devbox prepare` 会尝试通过 Cloudflare API 自动启用 Total TLS**（仅当从 zone 列表中选择了 dev 根域时）。若自动启用失败，常见原因：

- **该 zone 未开通 Advanced Certificate Manager (ACM)**：Total TLS 是 ACM 的功能，仅当 zone 已开通 ACM 时才能开启。请在 Cloudflare Dashboard → 该 zone → **SSL/TLS** → **Edge Certificates** 中查看是否有 **Advanced** / Total TLS 入口；若没有，需先为该 zone 开通 ACM（部分计划已包含，或需单独购买）。
- Token 权限不足：需包含 **Zone → SSL and Certificates → Edit**（见下方 Token 说明）。

**Token 权限说明（建议一次配齐，脚本完成所有步骤）**：在 [API Tokens](https://dash.cloudflare.com/profile/api-tokens) 选择 **Create Custom Token**（不要用「Edit zone DNS」模板，该模板无法追加 SSL 权限）。权限勾选：**Zone → Zone → Read**、**Zone → DNS → Edit**、**Zone → SSL and Certificates → Edit**；Zone Resources 选 **Include → All zones**（或仅指定 dev 用的 zone）。

### 首次配置

```bash
# 1. 一次性登录（会打开浏览器授权）
cloudflared tunnel login

# 2. 在任意目录执行（会写 ~/.config/casfa/devbox.yaml、config.yml、credentials 等）
cell devbox prepare
```

按提示选择 dev 根域（如 `shazhou.work`）、本机名（默认来自 hostname），并粘贴 Cloudflare API token（需包含 Zone 读、DNS 编辑、SSL and Certificates 编辑，见下方 Token 说明）。完成后会生成 tunnel、**一条** base DNS（`<devboxName>.<devRoot>`）、以及 config；**不会**在 prepare 时为所有 cell 创建子域名。

**子域名何时创建**：只有当你进入某个 cell 并运行 `cell dev` 时，才会为该 cell 创建 dev  host 的 CNAME（如 `sso.casfa.mymbp.shazhou.work`）并注册到本地 proxy。Dev host 始终由该 cell 的 `cell.yaml` 里 `domain.subdomain`（如 `sso.casfa`）计算，不会使用 instance 或 .env 的 `SUBDOMAIN`，因此不会出现误用其他 zone（如 symbiontlabs.me）的错误 host。

### 日常使用

```bash
# 启动 proxy + tunnel（后台）
cell devbox start

# 在各 cell 目录（如 apps/server-next）运行 dev，路由会自动注册
cd apps/server-next && cell dev
```

访问地址形如：`https://<subdomain>.<devboxName>.<devRoot>`（两级子域，例如 `https://sso.casfa.mymbp.shazhou.work`）。  
查看/停止：`cell devbox status`、`cell devbox stop`；查看配置：`cell devbox info`。  
Cognito 需在 App Client 的 Callback URL 中加入 dev 的 callback（如 `https://sso.casfa.mymbp.shazhou.work/oauth/callback`）；多应用共享登录态时设 `AUTH_COOKIE_DOMAIN=.<devboxName>.<devRoot>`（如 `.mymbp.shazhou.work`），与线上 `.casfa.shazhou.me` 行为一致。

**登录跳转**：dev 与线上使用同一套子域（sso.casfa.*、agent.casfa.* 等）。agent、server-next、image-workshop 等依赖 SSO 的 cell 在 **dev 且未设置 `SSO_BASE_URL`** 时，后端会根据 `CELL_BASE_URL` 自动推导 SSO 地址（如 `https://agent.casfa.mymbp.shazhou.work` → `https://sso.casfa.mymbp.shazhou.work`）。因此用 tunnel 时 **无需** 在 `.env` / `.env.local` 里配置 `SSO_BASE_URL`。只有「全部走 localhost、不经过 tunnel」时才需要在 `.env.local` 里写 `SSO_BASE_URL=http://localhost:7100`。

### 访问不了 / ERR_SSL_VERSION_OR_CIPHER_MISMATCH 时排查

1. **确认已启用 Total TLS**  
   若 prepare 时从列表选了 dev 根域，会尝试通过 API 自动开启；否则或自动开启失败时，到 Cloudflare → 该 zone → SSL/TLS 中手动启用 **Total TLS**。

2. **确认 DNS 指到 tunnel**  
   在要访问的 cell 目录至少跑过一次 `cell dev`（会为该 host 通过 Cloudflare API 创建 CNAME）。然后检查：
   ```bash
   dig sso.casfa.mymbp.shazhou.work CNAME +short
   ```
   应看到 `xxx.cfargotunnel.com`。若不是，说明该 host 的 CNAME 未创建或未生效。

3. **确认 config 有通配符 ingress**  
   打开 `~/.config/casfa/config.yml`，`ingress` 里应有 `*.mymbp.shazhou.work`（即 `*.<devboxName>.<devRoot>`）指向 `http://127.0.0.1:8443`。修改后执行 `cell devbox stop` 再 `cell devbox start`。

4. **确认 proxy 与 tunnel 在跑**  
   `cell devbox status` 应显示 proxy 和 tunnel 都在运行；`~/.config/casfa/devbox-routes.json` 里应有当前要访问的 host → 端口。

**证书 pending 时**：新 host 首次建 CNAME 后，Total TLS 会为该 hostname 签发证书。**证书通常在对该 hostname 的首次 HTTPS 请求时才会触发签发**，因此 Dashboard 里可能要在 `cell dev` 开始轮询（发出首次请求）几秒后，才能在 **SSL/TLS → Edge Certificates**（或 Advanced / Total TLS 证书列表）里看到对应条目或 pending 状态。`cell dev` 会每 5 秒探测一次并打印进度（如 `Checking certificate... (attempt 2, 10s)`），通常 2–3 分钟内会就绪，最多等 5 分钟。启动完成后会打印 **Open: https://...** 方便直接点击打开。

**Advanced Certificate 配额**：Total TLS 使用的证书占用该 zone 的 **Advanced Certificate** 配额（Dashboard → SSL/TLS → Edge Certificates 可看到「X of Y advanced certificates used」）。每个 dev hostname（如 sso.casfa.mymbp、image-workshop.casfa.mymbp）各占一个。若配额已满，新 hostname 不会签发证书，探测会一直失败。可删除不用的 hostname 对应证书或升级计划；若暂时无法解决，可在运行 `cell dev` 前设置 **`CELL_DEV_SKIP_CERT_WAIT=1`**（或在项目 `.env` 里写一行），则跳过证书等待直接启动，此时用浏览器访问该 URL 仍可能遇到 SSL 错误，但本地 localhost 可正常用。

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
cloudflared tunnel --config <你的 config.yml 路径> run
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
