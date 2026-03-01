# 派生数据（Derived Data）设计

**日期**：2026-03-01  
**归属**：server-next 审阅与实现；利用 CAS 不可变性加速读路径、缓解慢查询与 Lambda 超时。

---

## 1. 动机

CAS 节点**不可变**：同一 node-key 对应的内容永远不变。因此可以对「以某 node 为根的 DAG」预先计算并持久化**派生数据**，读路径时直接查 DB 而非多次 getNode，从而：

- 减少 path 解析的 N+1 CAS 读；
- 将 nodes/check、ownership 从「全图遍历」变为按 key 的集合查询；
- 将文件 manifest、目录列表变为一次派生数据读取；
- 降低 Lambda 内延迟与超时风险。

---

## 2. 统一形式

每条派生数据为三元组：

| 字段 | 含义 |
|------|------|
| **node_key** | CAS 节点 key；表示「以该节点为根的 DAG」的入口。 |
| **derive_key** | 对应一个**已注册的 derive-function** 的标识（如字符串常量）。 |
| **data** | `derive_function(dag_from_node_key)` 的结果，可序列化（JSON 或二进制）存 DB。 |

约定：同一 `(node_key, derive_key)` 只保留一条记录。因 node 不可变，该派生结果**永久有效**，无需 TTL 或失效（除非显式删表/迁移）。

---

## 3. 存储与访问

- **存储**：表或索引形式为 `(node_key, derive_key) -> data`。若按 realm 隔离，可用复合主键 `(realm_id, node_key, derive_key)`。
- **写入**：在写路径（commit、putNode 后）或**异步 worker** 中，对「新出现的 node」按需调用已注册的 derive-function，将结果写入。也可**懒计算**：读时若缺失则计算并回填。
- **读取**：读路径先查派生数据；命中则直接用 `data`，未命中再回退到「现场遍历 DAG」（并可选回填）。

---

## 4. 建议的 derive-function（与风险对应）

| derive_key | 含义 | 输入 DAG | data 形状（示例） | 缓解的风险 |
|------------|------|----------|-------------------|------------|
| **path_index** | 从根出发的「路径 → node_key」索引 | 以 root 为根的整棵树 | `Record<path, node_key>`，path 为规范化路径（如 `/a/b/c`） | **Path 解析**：一次 DB 查 path_index(root_key) 得到 node_key，避免 D+1 次 CAS getNode。 |
| **reachable_set** | 从该 node 可达的所有 node key 集合（闭包） | 以 root 为根的整棵树 | `Set<node_key>` 或有序列表（用于 membership） | **nodes/check、ownership**：判断 key 是否在 reachable_set(root_key) 中，O(1)/O(log n)，不做全图遍历。 |
| **file_manifest** | 文件链的元数据与 block 列表 | 以 file 的 f-node 为根的链（仅沿 file/successor） | `{ size, contentType, blockKeys: string[] }` | **文件 manifest**：一次查 file_manifest(file_node_key) 得 blockKeys；流式下载仍按 blockKeys 顺序读 CAS。 |
| **dir_entries** | 直接子节点列表（一层） | 以 dict node 为根（仅自身） | `Array<{ name, nodeKey, kind, size? }>` | **文件列表 list**：对 dict node_key 查 dir_entries(node_key)，一次读出当前层。 |
| **realm_stats** | 以 root 为根的 DAG 的统计量 | 以 root 为根的整棵树 | `{ nodeCount, totalBytes }` | **usage、info**：一次查 realm_stats(root_key)，避免遍历整树。 |

每个 derive-function 的**签名**可统一为：

- 输入：`(cas, node_key)` 或 `(cas, node_key, keyProvider)`；
- 行为：通过 getNode 遍历所需子图（仅限该 function 关心的部分）；
- 输出：可序列化的 data（JSON 或固定格式）。

---

## 5. 与实现计划、审阅的衔接

- **首版**：server-next 仅支持单 node 文件，**不实现** reachable_set、file_manifest 及 nodes/check、manifest 等；**仅使用** path_index、dir_entries、realm_stats。
- **Phase 2（存储）**：增加 DerivedDataStore 抽象：`get(nodeKey, deriveKey)`、`set(nodeKey, deriveKey, data)`；可先内存实现，后续迁 DB（如 DynamoDB (node_key, derive_key) 为主键）。
- **Phase 4（path 解析）**：resolvePath 时优先查 `path_index(root_key)`；若存在则用 path 直接取 node_key，否则回退逐段 getNode；commit 后对新 root 更新 path_index（或异步回填）。
- **Phase 4（文件 list）**：list 时对已解析到的 dict node 查 `dir_entries(node_key)`；缺失则现场计算并回填。
- **审阅文档** [2026-03-01-server-next-plan-review.md](./2026-03-01-server-next-plan-review.md) 中的「慢查询、Lambda 超时」缓解措施，在引入派生数据后可由「限制 + 缓存」改为「优先读派生数据，未命中再算+回填」。

（后续若做大文件：Phase 7 可增加 nodes/check 与 reachable_set、GET manifest 与 file_manifest 等。）

派生数据的**写入时机**：可在 commit/putNode 成功后**同步**写入（仅对新产生的 node 计算）；或由**后台 job** 按「未计算过的 (node_key, derive_key)」批量计算，避免阻塞请求路径。读路径始终「先查派生，未命中再算+回填」。
