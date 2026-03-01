# server-next 实现计划 · 审阅（风险与缓解）

**日期**：2026-03-01  
**对应**：[2026-03-01-server-next-implementation.md](./2026-03-01-server-next-implementation.md)

实现前建议通读本文，并在实现中按缓解措施落实或显式接受风险。

**首版简化**：实现计划已简化为**单 node 文件**（约 4MB，单 node 上限），**不实现** NodeService（nodes/check、nodes/raw、commit、manifest）。审阅中与「nodes/check、reachable_set、文件链下载、commit」相关的风险在首版不适用；path 解析、list、usage 等仍适用。后续若做大文件再参考本文与 [2026-03-01-file-chunk-upload-download.md](./2026-03-01-file-chunk-upload-download.md)。

**派生数据（Derived Data）**：利用 CAS 不可变性，用「node_key + derive_key → data」的派生数据加速读路径、list、usage 等，见 [2026-03-01-derived-data-design.md](./2026-03-01-derived-data-design.md)。首版仅使用 path_index、dir_entries、realm_stats。审阅中的慢查询/超时缓解可与该设计结合：优先读派生数据，未命中再现场计算并回填。

---

## 1. 慢查询与 N+1

| 风险点 | 说明 | 缓解 |
|--------|------|------|
| **Path 解析** | `resolvePath(rootKey, path)` 按段逐级 `getNode`，深度 D 需要 D+1 次 CAS 读（root + 每段一个 node）。远程存储（如 S3）每次 50–200ms 时，`/a/b/c/d` 约 200–800ms。 | ① 限制 path 深度（如 ≤32 段）并返回 400。② 若后端为 Lambda+S3，考虑对「热点路径」做短期缓存（path → nodeKey，TTL 秒级），commit 时失效。③ 文档约定「过深路径不保证 SLA」。 |
| **nodes/check** | 若实现为「从当前根遍历整棵可达树」再对 keys 取交集，则大 realm 会极慢。 | **必须**做成：对 body 中每个 key 仅做 `hasNode(key)` + 一次 ownership 查询，即 O(keys.length) 次存储/DB 访问，**不做**从 root 的全图遍历。若 ownership 依赖「从 root 可达」，则用「当前根闭包」的索引或按 key 的 ownership 表查询。 |
| **listDelegates(realmId)** | 若存储为线性表且无索引，列出某 realm 下所有 Branch = 全表扫描。 | 内存版可接受；若用 DB，**必须**对 realmId 建索引（或 partition key）。 |
| **getByAccessTokenHash(realmId, hash)** | 每次 Delegate/User 请求都会调用，若线性扫描则 O(n)。 | 内存版用 Map<(realmId,hash), grant>；若用 DB，**必须** (realmId, accessTokenHash) 唯一索引或 GSI。 |
| **文件下载链** | 大文件 f-node→s-node→… 每块一次 CAS get；100 块 ≈ 100 次读。 | 已采用流式：每块读完后立即 pipe 到响应，不攒在内存。Lambda 下需用 **Response Streaming**，避免整响应缓冲。若存储为 S3，可考虑 Range 读合并为更少请求（若 CAS 按 key 单对象存储）。 |

---

## 2. Lambda 超时

| 风险点 | 说明 | 缓解 |
|--------|------|------|
| **默认 3s** | Lambda 默认超时 3s，多级 path 解析 + 多块下载易超时。 | ① 将 Lambda 超时调高（如 30s–60s）用于文件/路径类接口。② 下载**必须**用 Lambda Response Streaming，边读边写，避免等待「整文件读完」再 200。③ 上传单请求 body 已限制 ≤6MB，单次 invoke 内完成；大文件走分块上传，单块 ≤6MB。 |
| **GC** | `realmFacade.gc(realmId, cutOffTime)` 需从 root 做可达性分析并删未引用节点，大 realm 可能需数十秒甚至更长。 | **不要**在同步 HTTP 请求内对「大 realm」调 gc。推荐：POST `/api/realm/:realmId/gc` 仅对「小 realm」同步执行，或改为写入「待执行 GC」任务（队列/DB），由异步 worker/另一 Lambda 执行；响应 202 Accepted + 任务 id。 |
| **commit** | 多节点写入 + setRoot：若一次请求内先 putNode 多个再 setRoot，存储慢时可能超时。 | 单次 commit 尽量只写「增量的」新节点 + 一次 setRoot；大变更由客户端拆成多次小 commit。若后端为 Lambda，可对该路由配置更长超时（如 15s）。 |
| **JWT 校验** | 若通过 JWKS 拉公钥，网络抖动或冷启动会拉长首请求。 | 缓存 JWKS（内存 + TTL，如 24h）；或使用本地验证（对称/预置公钥），避免每次请求请求 JWKS。 |

---

## 3. 内存与 Payload

| 风险点 | 说明 | 缓解 |
|--------|------|------|
| **上传 body 缓冲** | 单请求 6MB body 在 Lambda 内可行，但不宜多请求并发各 6MB。 | 保持单请求 body 上限 6MB；大文件只走分块上传。 |
| **path 段数** | 恶意或错误 path 如 10000 段会导致大量 getNode 与高延迟/超时。 | 对 path 段数做上限（如 ≤64 或 ≤128），超则 400。 |
| **decodeNode** | 单 node 解码进内存，CAS 单 node 若 ≤4MB 可接受。 | 保持「单 node 大小」限制（与现有 core 一致）；流式下载时不要一次性 decode 整条链，按块读一块解一块写出一块。 |

---

## 4. 一致性与并发

| 风险点 | 说明 | 缓解 |
|--------|------|------|
| **commit 冲突** | 乐观锁 commit(oldRootKey, newRootKey)：并发两请求同时基于同一 oldRoot，仅一个成功。 | 返回 409 Conflict 与明确错误码（如 `ROOT_CHANGED`），客户端重试（重新 get 当前根、重算 diff、再 commit）。计划或 API 文档中补充「客户端重试与退避」说明。 |
| **Branch complete** | Worker 调用 complete 时，parent 的 root 可能已被其他请求更新。 | realm 的 close() 在实现里用乐观锁：读 parent 当前根，合并，写回；若 parent 根已变则失败并返回 409，由客户端重试或提示。 |
| **Delegate 撤销** | 撤销后 token 仍可能被缓存或在途请求使用。 | 撤销时使该 delegateId 的 token 立即失效（删或更新 grant）；校验时严格查 store。可选：短期黑名单（tokenId/jti）缓存 1–5 分钟，减少撤销后窗口。 |

---

## 5. 存储与索引（后续上 DB 时）

| 风险点 | 说明 | 缓解 |
|--------|------|------|
| **DelegateGrant** | 若迁 DynamoDB/SQL，list(realmId)、getByAccessTokenHash(realmId, hash) 需高效。 | Partition key realmId；GSI 或唯一索引 (realmId, accessTokenHash)。 |
| **Branch（Delegate 实体）** | listDelegates(realmId)、getRoot(delegateId)、getDelegate(delegateId)。 | realmId 作 partition key；delegateId 唯一；getRoot 可存于同一行或单独 root 表。 |
| **ownership** | nodes/check、claim 依赖「某 key 是否属当前 delegate 链」。 | 若不做全图遍历，需「按 key 的 ownership 表」：key → delegateId 或 (realmId, delegateId)；check 时批量查 keys 的 ownership。与现有 v2 ownership 设计对齐。 |

---

## 6. 对实现计划的建议补充

在 [2026-03-01-server-next-implementation.md](./2026-03-01-server-next-implementation.md) 中建议：

- **Task 4.1 或 4.2**：在 `resolvePath` 或路由层对 path 段数做上限（如 64），超则 400。
- **Task 4.3**：首版为单 node 下载，无链；若后续做大文件，GET 文件下载使用 Response Streaming，不缓冲整响应。
- **Task 7.1**（原 7.2）：将 POST `/api/realm/:realmId/gc` 定为「同步仅支持小 realm 或返回 202 + 异步任务」；或新增 Task「GC 异步化」。
- **Phase 3（auth）**：若用 JWKS，增加「JWKS 缓存」步骤。
- ~~**Task 7.1**：nodes/check…~~ 首版已移除 NodeService，此项不适用。

以上作为实现时的检查项；若不采纳某条，需在代码或配置中注明原因。
