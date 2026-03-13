# Devbox 开发机配置与 subdomain 方案设计

## 1. 目标与约束

- **目标**：每台 dev machine 分配一个 shazhou.work 下的子域名作为 tunnel 入口；cell 只描述相对子域名（subdomain），dev 时由 devbox + 本地反向代理按 Host 分流到各 cell 的本地端口；prod 时由 instance 的根域拼出完整 host。本机可多 repo、多 cell，tunnel 只暴露一个入口。
- **约束**：cell 开发强制要求本机已安装并运行 Docker；不再支持 `domain.host`，统一使用 `domain.subdomain`。

## 2. 整体架构（方案二：单 tunnel + 本地代理）

- **Tunnel**：每台机器一个 tunnel，只暴露一个 hostname `<devboxName>.<devRoot>`（如 `my-mbp.shazhou.work`）→ 本机固定端口（如 8443）。
- **本地反向代理**：监听该端口，按 Host 头将请求转发到不同 `localhost:<port>`；路由表 host → port 存于本机全局（如 `~/.config/casfa/devbox-routes.json`），与 repo 无关，可被多 repo 的多个 cell 共用。
- **cell dev**：启动时在路由表中登记当前 cell 的 dev host → port，退出时移除该条。
- **devbox prepare**：检查 bun、Docker（必须）、cloudflared 登录、创建 tunnel + DNS、安装/配置并启动本地代理；不扫描 repo。

## 3. 配置形态

### 3.1 本机 devbox 配置（全局）

- **路径**：`~/.config/casfa/devbox.yaml`。
- **内容示例**：`devboxName`、`devRoot`、`tunnelPort`（如 8443）、tunnel 名称/ID、credentials 路径、代理路由表路径（如 `devbox-routes.json`）、代理启动命令或路径。
- **路由表**：`~/.config/casfa/devbox-routes.json`，格式 `{ "<full-dev-host>": <port>, ... }`，由各次 `cell dev` 写入/删除。

### 3.2 cell.yaml：只保留 subdomain，移除 host

- **domain.subdomain**（必填，当有 domain 时）：相对子域名，如 `sso.casfa`、`drive.casfa`。
- **domain.host**：**移除**，不再支持。所有完整 host 均由 subdomain + 根域拼出。
- **domain.dns**：保留（Route53 / Cloudflare 等），zone/zoneId 等可与根域一致；根域来自 params 的 DOMAIN_ROOT（见下）。
- **params.DOMAIN_ROOT**（deploy 必填）：prod 根域，如 `shazhou.me`。resolved host = `<subdomain>.<DOMAIN_ROOT>`。
- **dev.portBase**（可选）：本地 dev 端口区段起点，如 7100；缺省时可由约定或分配表给出。

**迁移**：现有使用 `domain.host` / `DOMAIN_HOST` 的 cell，改为 `domain.subdomain` + params 中 `DOMAIN_ROOT`；例如 `DOMAIN_HOST: "sso.casfa.shazhou.me"` → `domain.subdomain: "sso.casfa"` 且 `DOMAIN_ROOT: "shazhou.me"`（或 instance 覆盖 DOMAIN_ROOT）。

## 4. devbox 子命令

- **cell devbox prepare**（交互式）：  
  - 检查 bun、**Docker（必须，未安装或未运行则失败）**、cloudflared tunnel login；  
  - 提示输入 dev 根域（如 shazhou.work）、本机 devbox 名（如 my-mbp）；  
  - 创建 tunnel、DNS 一条 `<devboxName>.<devRoot>` → localhost:tunnelPort；  
  - 安装/配置本地反向代理（监听 tunnelPort，读 devbox-routes.json 按 Host 转发）；  
  - 写入 `~/.config/casfa/devbox.yaml`（及 credentials、tunnel config 等）。

- **cell devbox info**：读 devbox.yaml，打印 devboxName、devRoot、tunnel 状态、代理与路由表路径；无配置时提示先执行 prepare。

## 5. resolve-config 与 cell dev

- **stage === "cloud"**：`domain.host` 由 `domain.subdomain` + params 中的 `DOMAIN_ROOT` 拼出；`CELL_BASE_URL` 等沿用现有逻辑。
- **stage === "dev"**：若存在 devbox 配置，dev host = `<subdomain>.<devboxName>.<devRoot>`；port 用 `dev.portBase` 或约定；`cell dev` 用该 host 设 CELL_BASE_URL，并在 devbox-routes.json 中 upsert/delete 该 host → port。
- **Docker**：cell dev 在需要 DynamoDB/MinIO 时检查 Docker，不可用则报错退出；prepare 的依赖检查中 Docker 为必选项。

## 6. 错误处理与兼容性

- 无 devbox 配置时，dev 且 cell 使用 subdomain → 提示先执行 `cell devbox prepare` 并退出。
- 代理未运行时，cell dev 仍可登记路由并启动服务；访问 dev host 可能得到连接失败或 502，由 devbox info/文档说明需启动代理与 tunnel。
- **破坏性变更**：移除 `domain.host` 与 `DOMAIN_HOST`；所有 cell 需改为 `domain.subdomain` + `DOMAIN_ROOT`，并在实现时一并迁移现有 cell.yaml 与 instance 配置。

## 7. 文档与实施

- 设计文档即本文；实施计划由 writing-plans 产出，包含 schema 变更、resolve-config、dev 命令、devbox 子命令、代理选型与脚本、迁移步骤及测试。
