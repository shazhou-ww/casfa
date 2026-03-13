# Otavia 工具链设计

> 设计文档。实施计划由 writing-plans 产出。

## 命名由来

Otavia 取自古生物 **Otavia antiqua**（已知最古老的动物化石之一，前寒武纪）。与「Cell」并列：Cell 为生命的基本单元，Otavia 为最早期的简单有机体，均喻指「基础构建单元」——用于命名管理 cells 的单一 stack、path 路由工具链。

---

## §1 目标与范围

- **目标**：提供替代 cell-cli 的 otavia 工具链，采用单 stack、单域 path 路由，配置收敛到顶层 `otavia.yaml` 与各 cell 的 `cell.yaml`。
- **范围**：
  - 新 CLI 位于 `apps/otavia`，与 cell-cli 并存；cell-cli 仅作参考，不为其做兼容。
  - 所有命令在**项目根**（存在 `otavia.yaml` 的目录，如 `apps/main`）执行；**仓库根不再放置 otavia.yaml**，根目录脚本通过 `bun run -C apps/main <script>` 委托给 stack host。
- **成功标准**：新 clone 上 `otavia setup` → `otavia dev` 可本地跑全 stack；`otavia test` 跑单测 + 非持久 Docker 的 e2e；`otavia deploy` 生成并部署单份 CloudFormation；typecheck/lint 覆盖所有 cell 的前后端与测试代码。

---

## §2 配置文件

### 2.1 otavia.yaml（stack 配置，如 apps/main/otavia.yaml）

| 字段 | 必填 | 说明 |
|------|------|------|
| **stackName** | 是 | CloudFormation stack 名；用于资源命名前缀 `<stackName>-<mount>-<resourceKey>`。 |
| **cells** | 是 | **规范形态（推荐）**：列表项 `{ package, mount?, params? }`。`mount` 用于 path（`/<mount>/`）与资源后缀；`params` 为该 cell 覆盖值。**兼容输入**：对象 `mount -> package`（无 cell 级 params）与字符串数组（简写，按约定推导 package/mount）；loader 统一归一化为规范形态。 |
| **domain** | 是 | 单域：`host`（如 `casfa.shazhou.me`）、可选 `dns`（provider、zone 等）。 |
| **params** | 否 | stack 级默认；与各 cell 的 params 合并（stack 可覆盖）。 |

### 2.2 cell.yaml（各 cell package 根目录，如 apps/sso/cell.yaml）

| 字段 | 必填 | 说明 |
|------|------|------|
| **name** | 是 | cell 显示/逻辑名；**不参与** path 或资源命名（path 与资源后缀由 stack 的 mount 决定）。 |
| **backend** | 否 | `dir`、`runtime`、`entries`。entry：`handler`、`app`、`timeout`、`memory`、`routes`。routes 为相对 cell 根路径的子路由（如 `/api/*`）。 |
| **frontend** | 否 | `dir`、`entries`。entry：`entry`、`routes`，相对 cell 路径。 |
| **testing** | 否 | `unit`（如 `backend/`）、`e2e`（如 `tests/*.test.ts`）。 |
| **tables** | 否 | DynamoDB 表**逻辑**声明（key + schema）；物理表名由 stack 生成：`<stackName>-<mount>-<key>`。 |
| **buckets** | 否 | S3 桶**逻辑**声明（key + 配置）；物理桶名由 stack 生成：`<stackName>-<mount>-<bucketKey>`，超 63 字符则截断+hash。 |
| **params** | 否 | 本 cell 所需参数及可选默认值；实际值由 stack 在 dev/deploy 时注入。 |

**Cell 不包含**：pathPrefix、stackName、domain、bucketNameSuffix、dev（portBase）等任何「属于某个 stack」的配置。职责边界见 §8。

**params 解析**：支持 `!Env VAR`、`!Secret`；先合并 stack params 与 cell params（cell 覆盖），再对合并结果做 env/secret 解析。.env 加载顺序：根目录 .env → cell 的 .env → cell 的 .env.local。

---

## §3 子命令行为

**约定**：所有命令在**项目根**（包含 otavia.yaml 的目录，如 apps/main）执行；未找到 `otavia.yaml` 则报错退出。从仓库根执行时使用 `bun run dev` 等，由根 package.json 委托到 apps/main。

### setup

- 检查：bun 可用、存在且可解析 `otavia.yaml`、cells 指向的目录存在且含 `cell.yaml`。
- 对每个 cell（由 `cells` 解析得到 `package/mount` 并定位 `cellDir`）：若 `cellDir/.env` 不存在，则从 `cellDir/.env.example` 复制；无 `.env.example` 则跳过。
- 可选：校验 params 中 `!Env`/`!Secret` 在 .env 中是否有提供，缺则打印并提示，不阻塞。
- **`otavia setup --tunnel`**：在上述通过后，创建/更新 tunnel 配置（如 cloudflared + 本地 proxy）；写入固定目录（如 `~/.config/otavia/` 或 `.otavia/`），并输出如何启动 tunnel。
- With --tunnel, otavia writes tunnel config and prints instructions; starting the daemon is manual or a future otavia tunnel start.

### dev

- **进程模型**：两个 Bun 进程。
  - **后端进程**：单端口（如 8900），运行 gateway（Hono），按 path 挂载各 cell 的 backend；需要时连接 Docker 中的 DynamoDB Local 与 MinIO。
  - **前端进程（目标态）**：仅启动 main 的单一 Vite root（普通 MPA），另一端口（如 7100）；main 通过 import 组合各 cell 的 frontend entry。Vite 将后端请求代理到后端进程（如 `proxy → http://localhost:8900`），浏览器只连 Vite。
- **本地数据**：Docker 中 DynamoDB Local 与 MinIO 使用**与线上相同的资源名**（`<stackName>-<mount>-<resourceKey>`），仅 endpoint 不同。
- 注入 `CELL_BASE_URL`、`SSO_BASE_URL`（sso 为 cells 列表第一个或显式标记）。

### test

- `otavia test`：先 test:unit，再 test:e2e；任一步失败则非 0。
- **test:unit**：对每个 cell 在其 `cellDir` 下按 `testing.unit` 执行 `bun test <pattern>`；汇总退出码。
- **test:e2e**：非持久 Docker（DynamoDB Local + MinIO，--rm、不挂 volume）；启动 gateway 或单 cell 后端，注入测试 env；在对应 cell 下执行 e2e；结束后停容器与进程。

### deploy

- 读 otavia.yaml 与所有 cell.yaml；解析 params（cloud）；生成单份 CloudFormation（Lambda、API、DynamoDB、S3、CloudFront path behaviors、DNS 等）；打包上传 backend、构建上传 frontend；create/update stack。资源命名见 §4。

### typecheck

- 对每个 cell 在其 `cellDir` 下执行 `tsc --noEmit`（或该 cell 的 tsconfig）；覆盖前后端与测试。汇总退出码。

### lint

- 对每个 cell 在其 `cellDir` 下执行 linter（如 biome check）；支持 `--fix`、`--unsafe`。汇总退出码。

### aws login / aws logout

- 使用根目录或当前环境的 `.env` 中 `AWS_PROFILE`（缺省 `default`），执行 `aws sso login/logout --profile <profile>`；stdio inherit，退出码与 aws 一致。

### clean

- 删除仓库根及所有 cell 下的临时目录（如 `.cell`、`.esbuild`、`.otavia`）；**不**删除 `.env`/`.env.local`。

---

## §4 资源命名与 S3 长度

- **DynamoDB 表名**：`<stackName>-<mount>-<tableKey>`，全小写连字符；mount 由 stack 的 cells 项给出（§8）。
- **S3 桶名**：`<stackName>-<mount>-<bucketKey>`；总长 ≤63。若超 63：截断并加短 hash 保证唯一（实现时约定截断顺序，如先缩 key 再 mount）。
- **前端静态桶**（若有）：如 `frontend-<stackName>-<suffix>`，suffix 来自 domain 或配置，总长 ≤63。

*实现中若仍使用变量名 `cellId`，在 stack 上下文中其语义为 mount。*

---

## §5 错误处理与测试

- **错误处理**：缺 otavia.yaml、解析失败、cell 目录/cell.yaml 缺失 → 明确报错并退出非 0。params 未提供 `!Env`/`!Secret` → MissingParamsError 列出缺失 key。deploy 失败 → 透传 AWS/CloudFormation 错误并退出非 0。
- **单元测试**：各 cell 的 Hono 按根 path 测；path 剥离在 gateway 层。
- **E2E**：非持久 Docker；表/桶名与线上一致；可启动完整 dev 形态（Vite + gateway + DynamoDB Local + MinIO）或仅后端+本地 DB/S3，对真实 path 发请求。

---

## §6 前端：package export 与 MPA（讨论）

**现状**：dev 时工具链通过 `cell.yaml` 的 `frontend.dir` 找到 `apps/<cellId>/<frontend.dir>`，把各 cell 的前端目录 symlink 到 `.otavia/gateway-vite-root/<cellId>`，用单 Vite root + 多 path 组成 MPA；根路径 `/` 重定向到第一个 cell（如 `/sso/`）。

**提议**：与后端一致，**契约放在 package 边界**——每个 cell 的 package 通过 `exports` 导出 **frontend** 与 **backend**（命名与代码目录一致），工具链只依赖包名解析。

- **Package 约定**：在 cell 的 `package.json` 中增加导出，例如  
  `"exports": { "./frontend": "./frontend", "./backend": "./backend" }`  
  或更细粒度：`"./frontend": "./frontend/App"`、`"./backend": "./backend/app"` 等。含义：该 package 提供「可挂到 MPA 的前端入口」与「可挂到聚合后端的 backend 入口」。
- **工具链**：
  - 发现：对 `otavia.cells` 的每个 cell，用其 package 的 `exports["./frontend"]`（或约定子路径）解析出前端根目录或 entry；若无该 export 则视为无前端，跳过。backend 同理用 `exports["./backend"]`。
  - 组织 MPA：与 §9 一致——main 为常规 MPA，import 各 cell 的 `./frontend`；根 `/` 由 main 或工具链生成（重定向或简单导航页）。
- **好处**：命名与代码一致（frontend/backend）；新增 cell 只需在 package 里声明 export；便于多 entry 与不同前端类型通过 export 区分。

**可选实现顺序**：先保留当前按 `cell.yaml` + 路径的发现方式，在 `vite-dev` 中增加「若 package 有 `./frontend` export 则优先用其解析路径」的 fallback；再逐步改为仅按 package export 发现，`cell.yaml` 的 `frontend` 仅作兼容或弃用。

---

## §7 apps/main 作为 Stack Host（讨论）

**提议**：用独立 package **apps/main** 作为整个 stack 的 host，把 `otavia.yaml` 放在 `apps/main/` 下，而不是仓库根。main 通过 package 依赖引用各 cell，otavia 命令以 main 为「项目根」执行。

### 结构

- **apps/main/**
  - `package.json`：name 如 `@casfa/main`；依赖 `@casfa/sso`、`@casfa/server-next`、`@casfa/agent`、`@casfa/image-workshop`（workspace:\*），以及 otavia CLI（如 `@casfa/otavia` 或 `bun run ../otavia/src/cli.ts`）。
  - `otavia.yaml`：当前顶层内容移入（stackName、cells、domain、params）。
  - 可选：`.env.example`、简单 README 说明「本包是单 stack 的入口」。

- **仓库根**：不再放 `otavia.yaml`。根 `package.json` 的 dev/setup/deploy 等改为委托给 main，例如 `"dev": "bun run -C apps/main dev"`。

### 好处

1. **依赖即契约**：main 的 dependencies 显式列出本 stack 包含哪些 cell；`import("@casfa/sso/backend")` 等由 Node/Bun 从 main 的 node_modules 解析，无需 GATEWAY_REPO_ROOT、merged root 下 react 解析等 workaround。
2. **单一项目根**：otavia 的「当前目录」= `apps/main`，发现 cells、加载 .env、解析 otavia.yaml 都在 main 下；cell 目录统一通过 package 解析得到 `cellDir`（可兼容历史目录推导）。
3. **多 stack 友好**：若将来有第二个 stack（如 otavia-pro），可再建 `apps/main-pro`，另一份 otavia.yaml 和依赖列表，互不干扰。
4. **与 §6 一致**：前端也可由 main 依赖各 cell，Vite 以 main 为 cwd 时自然解析各 cell 的 `./frontend` export。

### 实施要点

- **otavia CLI**：保持「在包含 otavia.yaml 的目录下执行」的约定；根脚本通过 `bun run -C apps/main ...` 把 cwd 设为 main，再调 otavia。
- **cell 发现**：otavia.yaml 仍在 main 里列出 cells；main 的 package.json 应对这些 cell 有对应 dependency，以便运行时 resolve。目录定位统一走 package→`cellDir`（保留历史 fallback 仅作兼容）。
- **env 与路径**：.env 可放在 main 下和/或根；otavia 的 loadEnvForCell 等以「项目根 = main、cell 目录 = `cellDir`」为准。
- **gateway / Vite**：dev 时以 main 为 cwd 启动聚合后端与 Vite，则 `import("@casfa/sso/backend")`、react 等均从 main 的 node_modules 解析，无需额外 alias 或 resolveId 插件。

### 迁移顺序建议

1. 新建 `apps/main`（package.json + otavia.yaml 从根移入 + 各 cell 的 workspace 依赖）。
2. 根 package.json 的 dev/setup/deploy 等改为 `bun run -C apps/main <script>`，main 内 script 调用 otavia。
3. otavia 代码中若有「默认项目根 = process.cwd()」的假设，确认在 cwd=apps/main 时 cell 路径、.env、GATEWAY_REPO_ROOT 等仍正确；可逐步去掉 GATEWAY_REPO_ROOT，统一用 cwd（即 main）作为 repoRoot。
4. 前端 Vite：main 前端采用唯一 root（如 `apps/main/frontend`），不再使用 merged root；react 等从 main/node_modules 或 workspace 根按默认机制解析。

---

## §8 Cell 与 Stack 职责边界（多对多）

Cell 不假设自己属于某个 stack；同一 cell 可被多个 stack 引用，同一 stack 可包含多个 cell。配置与运行时职责划分如下。

### 8.1 Cell 的职责（cell.yaml + package）

Cell 描述**可复用单元**本身，与「被谁引用、挂在哪条 path、用哪个 stack 名」无关。

| 归属 | 内容 | 说明 |
|------|------|------|
| **身份** | package 名（package.json `name`） | 唯一标识；cell.yaml 放在该 package 根目录。 |
| **导出** | 仅 3 类：**frontend 各 entry**、**backend 各 entry**、**cell.yaml**（描述资源与 MCP 的相对路径） | 其中 frontend/backend 通过 package `exports` 暴露；cell.yaml 由工具链按包根固定路径读取（不要求写进 exports）；详见 §9.1。 |
| **能力** | backend / frontend / testing | 如何启动、构建、测试；不涉及 path 或 stack。 |
| **资源声明** | tables / buckets（仅逻辑 key + schema） | 如 `tables.grants`、`buckets.uploads`；**不包含**物理名（表名/桶名）。物理名由 stack 在部署时用 `(stackName, mount, key)` 生成。 |
| **参数** | params（逻辑名 + 可选默认值） | 如 `COGNITO_USER_POOL_ID`；实际值由 stack 在 dev/deploy 时通过 .env 或 otavia.params 注入，同一 cell 在不同 stack 可得到不同值。 |
| **禁止** | 不出现 stackName、path、pathPrefix、domain、其他 stack 或 cell 的 id | 保证 cell 可在任意 stack 中复用。 |

**约定**：cell 不写「我在这个 stack 里叫啥、挂在哪」；只写「我有哪些 backend/frontend、需要哪些表/桶（逻辑 key）、需要哪些参数」。

### 8.2 Stack 的职责（otavia.yaml，如放在 apps/main）

Stack 描述**一次组合与部署**：包含哪些 cell、各自在本次 stack 中的挂载方式、以及 stack 级配置。

| 归属 | 内容 | 说明 |
|------|------|------|
| **stackName** | 字符串 | CloudFormation 栈名；用于资源物理名前缀、S3 桶名等。 |
| **cells** | 列表，每项为「cell 引用 + 可选 mount」 | 见下。 |
| **domain** | host + 可选 dns | 本 stack 的单域；与 cell 无关。 |
| **params** | key-value | stack 级默认；与各 cell 的 params 合并后解析（stack 可覆盖 cell 默认）。 |

**cells 形态**：

1. **规范形态（推荐）**：`cells: [ { package, mount?, params? } ]`  
   - `package`：必填，cell 的 package 名（与 package.json `name` 一致）。  
   - `mount`：可选；未给时从 package 名推导 slug（如 `@casfa/server-next` → `server-next`）。  
   - `params`：可选；该 cell 的参数覆盖（优先于 stack 级 params 与 cell 默认值）。  
   - **mount 语义**：该 cell 的 path 为 `/<mount>/`，DynamoDB/S3 物理名中的「cell 段」为 `<mount>`。
2. **兼容输入（历史）**：  
   - 对象：`cells: { sso: "@casfa/sso", drive: "@casfa/server-next" }`（等价于只给 `mount+package`）。  
   - 字符串数组：`cells: [ "sso", "server-next" ]`（简写，按约定推导 package/mount）。  
   - 实现上统一由 loader 归一化为规范形态后再处理。

这样，同一 cell（如 `@casfa/sso`）可在 Stack A 中 mount 为 `sso`（path `/sso/`），在 Stack B 中 mount 为 `auth`（path `/auth/`）；资源名分别为 `<stackA>-sso-*` 与 `<stackB>-auth-*`。

### 8.3 资源命名与注入（由 stack 完成）

- **物理名**：始终由 stack 侧公式生成，**仅使用 stack 提供的 (stackName, mount) + cell 提供的 logicalKey**。  
  - 表：`tablePhysicalName(stackName, mount, tableKey)`  
  - 桶：`bucketPhysicalName(stackName, mount, bucketKey)`  
  - cell 只提供 `tableKey`/`bucketKey`（来自 cell.yaml 的 tables/buckets 的 key）。
- **运行时注入**：stack（或 otavia 工具链）在 dev/deploy 时向 cell 注入例如：  
  - `CELL_BASE_URL` = origin + `/<mount>/`  
  - `SSO_BASE_URL` = 本 stack 中第一个 cell 的 base URL 或显式配置  
  - 表名/桶名等（由 stack 按上述公式算出后写入 env）。  
  Cell 只消费这些 env，不假设 path 或 stack 名。

### 8.4 与当前实现的对应关系

- **当前**：`otavia.cells` 为字符串数组，既用于「找 cell 目录」又用于 path 与资源后缀（等价于 mount = 字符串）。  
- **收敛后**：  
  - 发现 cell：以 package 名解析（main 的 dependency 或显式 `package` 字段）。  
  - path 与资源后缀：统一用 **mount**（来自 cells 项的 mount 或简写时的字符串）。  
  - 文档中凡写「cellId」处，在「stack 上下文」内统一理解为 **mount**；cell 自身只有 package 名，不持有 cellId/mount。

这样 **cell.yaml 与 otavia.yaml 的职责边界**清晰：cell 描述「我是谁、我能做什么、需要哪些逻辑资源与参数」；stack 描述「我包含谁、以什么 mount 挂载、用啥 stack 名和域名」，并负责生成物理名与注入 env。

---

## §9 本地开发：main 为常规 MPA（架构收敛）

**问题**：当前通过「单 Vite + 多 root / path 映射」把各 cell 的 frontend 目录挂到不同 path 下，打破了 Vite 对「单一 root、单一 node_modules 解析上下文」的预设，导致 react 等依赖解析、workspace 链接与 symlink 混在一起，需要大量 workaround 且仍不稳定。

**原则**：本地开发时**回归 Vite 预设**——main 就是一个普通的 MPA 应用包，在一个 Vite root 下组织多页/多路由；cell 不直接暴露「一整块目录」给 Vite，而是**导出可被 main import 的入口模块**。部署与复用单元仍是 cell；开发时由 main 把各 cell 的「前端能力」当作模块拼进自己的 MPA。

### 9.1 Cell 的导出（三组）

每个 cell 通过 package **只导出 3 类东西**，与代码结构一致，命名统一为 **frontend / backend**（不再使用 gateway）：

| 导出 | 说明 |
|------|------|
| **frontend 的各个 entry** | package.json `exports["./frontend"]` 及子路径（如 `./frontend/App`），指向前端入口文件；main 通过 import 挂到 MPA 的对应 route。 |
| **backend 的各个 entry** | package.json `exports["./backend"]` 及子路径（如 `./backend/app`），指向后端入口文件；dev 时聚合后端按 path 挂载这些 entry。 |
| **cell.yaml** | 位于 cell 包根目录，描述资源（tables、buckets 等）与 MCP 的**相对路径**；工具链读取后做资源命名、注入与 `.well-known/mcp` 拼装。 |

其中 frontend/backend 通过 package.json `exports` 暴露；cell.yaml 通过包根固定路径读取，不要求作为 JS module export。

**约定**：不使用 `./gateway` 等命名，与代码目录 frontend/backend 一致。

### 9.2 角色重定义

| 角色 | 职责 |
|------|------|
| **main** | 普通 MPA package。拥有自己的前端源码树（如 `apps/main/frontend` 或 `apps/main/src`），**唯一的** Vite root；依赖各 cell 的 package，通过 **import** 使用 cell 导出的 frontend 入口（组件或根 App）。路由 / 多页由 main 自己定义（如 `/sso/*`、`/drive/*`），每个 route 挂载对应 cell 导出的根组件。 |
| **cell** | 可复用、可独立验证的 fullstack 单元。**只导出上述 3 类**：frontend 各 entry、backend 各 entry、cell.yaml（资源与 MCP 相对路径）。**不**在 dev 时「把整块 frontend 目录交给工具链挂到 Vite」；而是提供可被 main **import** 的模块。cell.yaml 描述能力与 params；**不**决定自己在哪个 path 下、属于哪个 stack。 |
| **cell.yaml（可复用）** | 视为抽象「函数」：**输入** = 依赖的 params（及可选默认值），**输出** = 完整的可部署单元（backend、frontend 构建产物、表/桶声明等）。同一 cell 在不同 stack 中可得到不同 param 值。cell.yaml 内描述资源和 MCP 的**相对路径**。 |
| **otavia.yaml** | 对每个 cell 的引用 = 指明 **package、mount（path 段）、以及传给该 cell 的每个 param 的值**。stack 级 params 可作为默认，cell 项内 params 覆盖。 |

### 9.3 前端契约（cell 导出 → main 引用）

- **Cell 的 package.json exports**（与代码一致，仅 frontend/backend）：
  - `"./backend"` 或 `"./backend/app"`：后端入口，供 dev 时聚合后端按 path 挂载。
  - `"./frontend"` 或 `"./frontend/App"`：前端根组件或入口模块，供 main **import** 后挂到对应 route。可以是默认导出一个 React 组件，或具名导出 `App`。
- **Main 的前端**：
  - 一个 Vite 项目（root = main 的 frontend 目录），标准 MPA：多 HTML 或多路由由 main 自己组织。
  - 每个 path 前缀（如 `/sso/`、`/drive/`）对应 main 中的一个 route 或 entry，该 route/entry 里 `import App from "@casfa/sso/frontend"`（或 `"@casfa/sso/frontend/App"`）并渲染。所有依赖解析都在 main 的 node_modules 下完成，无 path 映射、无 symlink、无多 root。
- **好处**：Vite 只看到一个 root、一套 node_modules；react、workspace 包解析完全符合预设，无额外插件。

### 9.4 otavia.yaml 中 cells 与 params

- **cells 规范为列表**，每项包含：
  - **package**：cell 的 package 名（必填）。
  - **mount**：path 段（可选，默认可由 package 名推导）。
  - **params**：传给该 cell 的 param 值（覆盖 stack 级 params 与 cell 默认值）。例如：
    - `{ package: "@casfa/sso", mount: "sso", params: { COGNITO_USER_POOL_ID: "!Env COGNITO_USER_POOL_ID" } }`
- **兼容输入**：对象 `mount -> package` 与字符串数组；由 loader 归一化为上述规范列表后执行。
- 这样「可复用的 cell.yaml = 函数」与「stack 给每个 cell 传哪些 param」在 otavia.yaml 里一目了然。

### 9.5 部署与 MCP

- **部署**：仍以 cell 为单位；cell.yaml + 本次 stack 传入的 params → 生成该 cell 的 deploy 单元（Lambda、静态资源、表/桶等）。main 在部署时仅作为「谁引用了哪些 cell、传了哪些 param」的声明方，不要求 main 自己先打一个整包。
- **MCP**：cell.yaml 中描述 MCP 的**相对路径**；otavia 或 main 可汇总各 cell 的 MCP 描述，拼装 `.well-known/mcp` 等。

### 9.6 实施顺序建议

1. **约定 cell 前端导出**：各 cell 的 package.json 增加 `"./frontend"`（或 `"./frontend/App"`）export，指向可被 React 挂载的入口模块。
2. **在 main 中新建标准 MPA 前端**：如 `apps/main/frontend`，含唯一 Vite root、index.html、router 或多 entry，按 path 挂载 `import "@casfa/sso/frontend"` 等。
3. **otavia dev**：前端只启动 main 的 Vite（cwd = main 的 frontend 目录），不再建 merged root、不做 path 映射、不加载 gateway-vite-multi-root 等插件；后端聚合服务按 path 挂载各 cell 的 **backend** entry。
4. **otavia.yaml**：扩展 cells 为带 **params** 的形态，loader 与 deploy 使用这些 param 值注入 cell。
5. **清理**：移除 gateway-vite-root、gateway-vite-multi-root-plugin、gatewayReactFromRepoRoot 等与「多 root / path 映射」相关的代码。

---

## 参考

- 单域 path 架构：`docs/plans/2026-03-11-single-domain-path-design.md`
- 现有实现参考：`apps/cell-cli`（gateway-dev、resolve-config、generators、local）
