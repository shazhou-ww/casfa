# CASFA 系统需求分析（用例）

**日期**：2026-03-01  
**状态**：已认可  
**概念依据**：Branch / Delegate / Realm 概念定义（见下文）

本文档基于已确定的业务概念，整理参与者、术语与主用例，供 server-next 设计与实现使用。

---

## 1. 概念定义

### 1.1 核心概念

| 概念 | 定义 |
|------|------|
| **Realm** | 用户的命名空间，realmId = userId。包含一棵 **Branch 树**、一份 CAS 存储，以及由 root branch 持有的「当前根」node key。 |
| **Root Branch** | 每个 Realm 唯一。持有该 Realm 的「当前根」node key；不对任何主体签发 token。User 通过 OAuth Access Token 隐式对应到 root branch。 |
| **Branch** | **任务型**工作分支。有 parent、mountPath、当前 root、TTL；用于 Worker（Tool、Subagent 等）「有明确结束」的场景。结束时调用 **complete()**（完成/提交），将当前 root 合并回 parent，随后该 Branch 失效。**仅此一种分支语义，不再区分 limited/unlimited。** |
| **Delegate** | **长期授权**主体。表示某客户端（OAuth client_id）或 AI Agent 被授权访问该 Realm；无独立 Branch、无独立 root；所有读写直接作用于 **Realm 的当前根**。权限**可配置**，典型配置为「User 权限减去 Delegate 授权管理」。可创建 Branch（将 token 交给 Worker 使用）。 |
| **User** | Realm 的拥有者。凭 OAuth Access Token 隐式对应 root branch；具备文件访问、Branch 管理、Delegate 授权管理。 |

### 1.2 概念关系简图

```
                    ┌─────────────────────────────────────────┐
                    │  Realm (realmId = userId)                │
                    │  · 当前根 → Root Branch 持有（无 token）   │
                    │  · CAS + Branch 树                       │
                    └─────────────────────────────────────────┘
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         │                               │                               │
         ▼                               ▼                               ▼
  ┌─────────────┐               ┌─────────────────┐               ┌─────────────┐
  │ User        │               │ Delegate         │               │ Branch      │
  │ OAuth AT    │               │ (长期授权)       │               │ (任务型)    │
  │ 隐式 → root │               │ 无 Branch 行     │               │ parent +    │
  │             │               │ 直接操作当前根    │               │ mountPath + │
  │ 全权限      │               │ 可创建 Branch   │               │ complete→merge │
  └─────────────┘               │ 权限可配置，    │               └─────────────┘
                                │ 典型=无Delegate │                        ▲
                                │ 授权管理        │                        │
                                └─────────────────┘                        │
                                         │                                 │
                                         │ createBranch()                   │
                                         │ 返回 Branch token ───────────────┘
                                         │ 交给 Worker (Tool/Subagent) 使用
                                         ▼
                                ┌─────────────────┐
                                │ Worker          │
                                │ (Tool/Subagent) │
                                │ 持 Branch token │
                                │ 可创建 subbranch│
                                │ 任务结束 complete│
                                └─────────────────┘
```

### 1.3 术语与访问凭证

| 主体 | 访问凭证 | 说明 |
|------|----------|------|
| **User** | OAuth Access Token | 校验后 subject = userId → 隐式对应该 Realm 的 root branch；不签发 root 的 token。 |
| **Delegate** | OAuth Access Token 或用户主动分配的 Token | 长期有效（可 refresh 或限时）；标识「某 client_id 被授权访问该 Realm」，直接操作当前根。 |
| **Worker**（Tool / Subagent） | Branch Token | 任务型 Branch 的 access token；有 TTL；**complete()**（完成/提交）后失效并合并回 parent。 |

---

## 2. 参与者

| 参与者 | 说明 | 典型代表 |
|--------|------|----------|
| **User** | Realm 拥有者，通过 Web / 客户端以 OAuth Token 访问 API。 | 使用 CASFA 的用户本人。 |
| **Delegate** | 被授权访问该 Realm 的客户端或 Agent；长期授权，无独立分支，直接操作主树。**权限可配置**，典型为「User 权限减去 Delegate 授权管理」。 | Cursor、GitHub Copilot、Claude Code、自定义 CLI、MCP 客户端等。 |
| **Worker** | 持有 Branch Token 的调用方；在某一 Branch 上工作，可创建子 Branch 将部分工作交给下级 Worker，任务结束后 **complete** 该 Branch，将修改合并回 parent。Tool、Subagent 等均属 Worker。 | 某次任务中由 User 或 Delegate 创建的 Branch 的使用者（子任务、插件、工具进程等）。 |

---

## 3. 用例（主用例）

### 3.1 User（凭 OAuth Token 通过 API 访问）

#### 3.1.1 文件访问

| 编号 | 用例名称 | 简要说明 |
|------|----------|----------|
| U-F1 | 查看路径下文件列表 | 列出指定路径下的条目，包含文件名、大小等元数据。 |
| U-F2 | 下载文件 | 支持 Web UI 的 Service Worker 或客户端按 block 下载后拼装。 |
| U-F3 | 上传文件 | 拆成 Block 逐个上传，逐级创建父 node，最后更新 Realm 当前根。 |
| U-F4 | 查看文件详细信息 | 获取指定路径对应节点的元数据与属性。 |
| U-F5 | 整理文件夹 | 重命名、移动、复制、删除、创建文件夹等。 |
| U-F6 | 查看空间用量 | 查询该 Realm 的存储统计（如 node 数、总字节等）。 |
| U-F7 | 主动触发垃圾回收 | 对 Realm 执行 GC（需指定 cutOffTime 等参数）。 |

#### 3.1.2 Branch 管理

| 编号 | 用例名称 | 简要说明 |
|------|----------|----------|
| U-B1 | 创建 Branch | 在当前根下创建任务型 Branch（指定 mountPath、TTL），返回 Branch token。 |
| U-B2 | 撤销 Branch | 使指定 Branch 失效，不再接受其 token。 |
| U-B3 | 查看 Branch 列表 | 列出该 Realm 下所有 Branch（含状态、创建时间等）。 |

#### 3.1.3 Delegate 授权管理

| 编号 | 用例名称 | 简要说明 |
|------|----------|----------|
| U-D1 | 查看 Delegate 列表 | 列出已授权访问该 Realm 的 Delegate（如 client_id、授权方式、创建时间等）。 |
| U-D2 | 撤销 Delegate | 撤销某 Delegate 的授权，其 token  thereafter 失效。 |
| U-D3 | 增加 Delegate 授权 | 两种方式：(1) Delegate 方通过 OAuth 申请，用户批准后授权；(2) 用户主动为该 Realm 创建限时 token，将 token 分配给某客户端（如复制给 Cursor 配置）。 |

---

### 3.2 Delegate（凭 OAuth Token 或用户分配的 Token，通过 MCP 或 API 访问）

Delegate 拥有 **可配置的** 权限，典型配置为 **User 权限减去「Delegate 授权管理」**：文件访问、Branch 管理；不能查看/撤销/增加 Delegate 授权（除非在配置中显式授予）。

#### 3.2.1 文件访问

与 User 的文件访问用例一致（U-F1～U-F7），操作对象均为 **Realm 的当前根**。

| 编号 | 用例名称 | 说明 |
|------|----------|------|
| D-F1 | 查看路径下文件列表 | 同 U-F1。 |
| D-F2 | 下载文件 | 同 U-F2。 |
| D-F3 | 上传文件 | 同 U-F3。 |
| D-F4 | 查看文件详细信息 | 同 U-F4。 |
| D-F5 | 整理文件夹 | 同 U-F5。 |
| D-F6 | 查看空间用量 | 同 U-F6。 |
| D-F7 | 主动触发垃圾回收 | 同 U-F7。 |

#### 3.2.2 Branch 管理

Delegate 可在 Realm 当前根下创建 Branch（如交给 Worker 使用），并可查看/撤销自己创建的或有权访问的 Branch。

| 编号 | 用例名称 | 简要说明 |
|------|----------|----------|
| D-B1 | 创建 Branch | 在 Realm 当前根下创建任务型 Branch，返回 Branch token（可交给 Tool）。 |
| D-B2 | 撤销 Branch | 使某 Branch 失效（权限边界由实现定义，如仅限自己创建的）。 |
| D-B3 | 查看 Branch 列表 | 列出该 Realm 下可见的 Branch。 |

#### 3.2.3 不包含

- **Delegate 授权管理**：Delegate 不能查看 Delegate 列表、不能撤销或增加 Delegate 授权。

---

### 3.3 Worker（凭 Branch Token 通过 API 访问）

Worker 在**某一 Branch** 上操作，可将部分工作通过创建 **子 Branch（subbranch）** 交给下级 Worker；任务结束后 **complete** 该 Branch，将修改合并回 parent（Realm 当前根或上一级 Branch）。Tool、Subagent 等均属 Worker。

#### 3.3.1 文件访问（在 Branch 范围内）

| 编号 | 用例名称 | 简要说明 |
|------|----------|----------|
| W-F1 | 查看路径下文件列表 | 在 Branch 当前根下按路径列出条目（含文件名、大小等）。 |
| W-F2 | 下载文件 | 在 Branch 内下载，方式同 U-F2。 |
| W-F3 | 上传文件 | 在 Branch 内上传，更新 Branch 的当前根，不直接改 Realm 主树。 |
| W-F4 | 查看文件详细信息 | 在 Branch 内查看指定路径的元数据。 |
| W-F5 | 整理文件夹 | 在 Branch 内重命名、移动、复制、删除、创建文件夹等。 |

#### 3.3.2 Branch 管理（当前 Branch 下）

| 编号 | 用例名称 | 简要说明 |
|------|----------|----------|
| W-B1 | 创建子 Branch | 在当前 Branch 下创建子 Branch（指定 mountPath、TTL），返回 Branch token，可将部分工作交给下级 Worker。 |

#### 3.3.3 完成与退出

| 编号 | 用例名称 | 简要说明 |
|------|----------|----------|
| W-C1 | Complete Branch | **完成/提交**当前 Branch：将当前 Branch 的修改合并回 parent（Realm 当前根或上一级 Branch），随后该 Branch 失效，其 token 不可再使用。语义等同于「任务完成、提交结果」。 |

#### 3.3.4 不包含

- Worker 不查看空间用量、不触发 GC（可选：由实现决定是否只读暴露）。
- Worker 不管理「Delegate 授权」、不列出/撤销 Realm 下其他 Branch（仅可创建子 Branch 并 complete 自身 Branch）。

---

## 4. 用例与权限对照

| 能力 | User | Delegate | Worker |
|------|------|----------|--------|
| 文件：列表 / 下载 / 上传 / 详情 / 整理 | ✓ | ✓（权限可配置） | ✓（Branch 内） |
| 空间用量 / GC | ✓ | ✓（权限可配置） | ✗ |
| 创建 / 撤销 / 列出 Branch | ✓ | ✓ | ✓（仅创建子 Branch） |
| Delegate 授权管理（列表 / 撤销 / 增加） | ✓ | ✗（典型配置） | ✗ |
| Complete Branch（提交并合并回 parent） | — | — | ✓ |

---

## 5. 与非功能需求的衔接

- **认证**：User 与 Delegate 的 OAuth/Token 形态、Branch Token 的编码与校验，在 server-next 架构设计中单独定义。
- **路径与存储**：文件访问采用路径型 REST API，底层仍通过 Realm/Branch 的 path 语义（getNode(path)、commit 等）与 CAS 对接。
- **大文件与流**：上传/下载、Block 切分与拼装、流式透传等，与现有 facade-delegate 设计中的流式语义一致，在 API 与实现层细化。

---

## 6. 文档变更与参考

- 本需求基于 **Branch / Delegate / Realm** 概念定义（2026-03-01 讨论结论）。
- 与 `docs/plans/2026-02-28-facade-delegate-design.md` 的对应关系：该文档中的「Delegate」在本需求中拆分为 **Branch**（任务型、complete & merge）与 **Delegate**（长期授权、直接操作主树）；类型与 API 的迁移在后续设计文档中说明。
- **术语**：Branch 的结束动作为 **complete()**（完成/提交），不用 close；任务型调用方统一称 **Worker**（含 Tool、Subagent）；Worker 可创建子 Branch（subbranch）将工作分包给下级。

---

## 7. AI Agent（Delegate）视角：MVP 充分性自检

从**被授权为 Delegate 的 AI Agent**（如 Cursor、Copilot、本对话中的 Agent）视角，自检当前用例是否满足 MVP：**帮用户管理云文件系统** + **通过该云文件系统与 subagent/tools 进行 blob 交换**。

### 7.1 帮用户管理云文件系统

| 需求 | 对应用例 | 结论 |
|------|----------|------|
| 查看某路径下有哪些文件、大小等 | D-F1（列表）、D-F4（详情） | ✓ 满足 |
| 按路径下载/上传文件 | D-F2、D-F3 | ✓ 满足 |
| 重命名、移动、复制、删除、建目录 | D-F5（整理） | ✓ 满足 |
| 查看空间占用、触发 GC | D-F6、D-F7 | ✓ 满足 |

**结论**：文件侧用例足以支撑「帮用户管理云文件」的 MVP；我作为 Delegate 可直接读写当前根、整理目录、看用量与 GC。

### 7.2 与 Worker（subagent/tools）的 blob 交换

典型流程：我（Delegate）需要把一部分工作交给 Worker（如一个 tool 或 subagent），让它读写一批 blob，完成后把结果合并回主树。

| 步骤 | 所需能力 | 对应用例 | 结论 |
|------|----------|----------|------|
| 划定工作范围并开「任务分支」 | 在某个路径下创建 Branch，拿到 token | D-B1（创建 Branch，指定 mountPath、TTL） | ✓ 满足 |
| 把 token 交给 Worker | 返回 Branch token 给调用方（MCP/API 响应等） | 同上，返回 token | ✓ 满足 |
| Worker 在分支内读 blob | 列表、下载、详情 | W-F1、W-F2、W-F4 | ✓ 满足 |
| Worker 在分支内写 blob | 上传、整理（建目录、移动等） | W-F3、W-F5 | ✓ 满足 |
| Worker 把部分工作再交给下级 | 创建子 Branch，再传 token | W-B1（创建子 Branch） | ✓ 满足 |
| Worker 完成任务并交回结果 | 提交分支、合并回 parent | W-C1（Complete Branch） | ✓ 满足 |
| 我（Agent）看到合并后的结果 | 再次读主树该路径 | D-F1 / D-F2 / D-F4 | ✓ 满足 |
| 异常时撤销未完成的 Branch | 撤销 Branch | D-B2、D-B3（列表后撤销） | ✓ 满足 |

**结论**：创建 Branch → 交 token 给 Worker → Worker 在分支内读写 blob、可再建子 Branch → complete 合并回主树，整条链在用例上闭合；**从 Agent 视角，当前用例足以支撑「通过云文件系统与 subagent/tools 进行 blob 交换」的 MVP**。

### 7.3 MVP 可接受的约定与后续可增强点

- **创建 Branch 的初始内容**：创建时若指定 mountPath，约定 Branch 的「当前根」对应主树该路径的子树（或空）；实现时在 API/设计里明确即可，不改变用例。
- **Blob 的标识方式**：MVP 以**路径**为主（路径即文件/blob 的标识）；若未来 Worker 或工具链需要按 **CAS key** 直接读某 node，可在 API 层增加「按 key 读 node」的扩展，当前路径型读写已覆盖「按路径取/放 blob」的交换需求。
- **多 Branch 并发与冲突**：多 Worker 并行、合并冲突策略等可在实现中约定（如 disjoint 路径或简单策略）；用例层面不强制，MVP 可接受单 Worker 或路径不交叠的假设。

**总结**：以「AI Agent 作为 Delegate」的视角，当前用例**满足**「帮用户管理云文件系统」和「通过该云文件系统与 subagent/tools 进行 blob 交换」的 MVP 需求；无需为 MVP 新增用例，只需在设计与实现阶段明确 Branch 创建语义、大文件/流与（可选）按 key 读的细节即可。
