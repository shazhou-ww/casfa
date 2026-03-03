# Branch 允许挂载不存在的路径（NUL root）设计

**日期**：2026-03-03  
**状态**：设计  
**目标**：允许创建 branch 时指向尚不存在的 path，branch 通过 commits 构建内容，通过 complete 在 parent 上创建或删除该路径。Realm 未初始化、branch 不存在等错误用异常 + 4xx 表示，不用 null。

---

## 1. 语义约定

- **NUL**：用 `null` 表示「不存在的 node」。仅在「branch 存在且其 root 为 NUL」时使用；**不**用 null 表示 realm 未初始化或 branch 不存在。
- **Realm 未初始化**：应抛异常，HTTP API 返回 4xx（如 404）。
- **Branch 不存在**：应抛异常，HTTP API 返回 404。
- **Branch root 为 NUL**：`getBranchRoot(branchId)` 返回 `null`，且仅在对**已存在**的 branch 调用时出现；表示该 branch 挂载在「不存在的 path」上，尚未有 commit 或显式设为 NUL。
- **Complete 时 root 为 NUL**：视为**删除** parent 上该路径的内容；若路径本就不存在则 no-op。

---

## 2. 行为变更摘要

| 场景 | 当前行为 | 目标行为 |
|------|----------|----------|
| 创建 branch，mountPath 不存在 | 400 mountPath does not resolve | 允许：insertBranch，**不**调用 setBranchRoot（root 保持 NUL） |
| getRealmRoot(realmId) 无 root 记录 | 返回 null | 抛异常（如 `RealmNotInitialized`），API 层映射为 404 |
| getBranch(branchId) 不存在 | 返回 null | 保持返回 null，**API 层必须先 getBranch，为 null 时返回 404**，不继续调 getBranchRoot |
| getBranchRoot(branchId)，branch 存在但无 root | 返回 null | 明确约定：仅当 branch 存在时调用；返回 null = NUL |
| Worker getCurrentRoot，root 为 NUL | 当前可能 404 / null | 返回 null；fs/files 第一次写时创建空 dict 并 setBranchRoot，再执行写 |
| Complete，branch root 为 NUL | 当前会报 "Branch has no root" | 从 parent 上 **remove** 该 path；若 path 不存在则 no-op，然后 removeBranch |
| Complete，branch root 非 NUL，path 在 parent 不存在 | 当前 replaceSubtreeAtPath 报 Entry not found | 先 **ensure path 存在**（创建中间目录），再 replace/add |

---

## 3. 错误与 API 契约

- **Realm 未初始化**：在需要 realm root 的接口（如创建 root 下 branch、commit、fs）中，若 `getRealmRootRecord(realmId)` 为 null，则抛 `RealmNotInitialized`（或等价错误），控制器返回 `404`，message 如 "Realm not initialized"。
- **Branch 不存在**：凡需要 branch 存在的接口（complete、worker 的 fs/files、getBranchRoot），先 `getBranch(branchId)`；若为 null，返回 `404`，message 如 "Branch not found"。不在此情况下调用 `getBranchRoot`。
- **null 仅用于 NUL**：`getBranchRoot(branchId)` 的契约为「仅当 branch 已存在时调用」；返回 `null` 唯一表示「该 branch 的 root 为 NUL」。

可选：若希望存储层也统一用异常，可将 `getRealmRoot` 改为「无 root 记录时 throw」，`getBranch` 改为「不存在时 throw」，这样所有调用方无需判 null 再抛，由存储层统一抛。设计上二选一即可，建议在实现计划里选定其一。

---

## 4. 创建 Branch（允许 path 不存在）

- 从 realm 根创建：`rootKey = getRealmRoot(realmId)`，若 realm 未初始化则**抛异常**（不返回 null）。`childRootKey = resolvePath(cas, rootKey, mountPath)`；若 `childRootKey === null`（path 不存在），仍允许创建：`insertBranch(...)`，**不**调用 `setBranchRoot`（即 root 保持 NUL）。若 `childRootKey !== null`，行为不变：`setBranchRoot(branchId, childRootKey)`。
- 从父 branch 创建：先 `getBranch(parentBranchId)`，为 null 则 404。`parentRootKey = getBranchRoot(parentBranchId)`；若为 null（父 branch 为 NUL），可规定不允许在 NUL 下再建子 branch（返回 400），或允许且子 branch 也为 NUL；建议**不允许**（400 "Parent branch has no root"）。若 parentRootKey 非 null，再 `resolvePath(cas, parentRootKey, mountPath)`；为 null 则允许创建且**不** setBranchRoot；非 null 则 setBranchRoot 同前。

---

## 5. getCurrentRoot(worker) 与第一次写（NUL → 真实根）

- `getCurrentRoot(auth, deps)`：当 auth 为 worker 时，`rootKey = getBranchRoot(auth.branchId)`。**约定**此处仅在有 branch 时调用（上层已保证 branch 存在）。若 `rootKey === null`，返回 `null`（表示 NUL）。
- 所有使用「当前根」的 fs/files 路径（mkdir、write、upload、list 等）：若 `getCurrentRoot` 返回 `null`（仅 worker 可能）：
  - **list/stat**：可返回空目录或 404，由产品决定；建议视为空目录（空 list）。
  - **mkdir / write / upload**：视为「第一次写」。先 `ensureEmptyRoot(cas, key)` 得到 `emptyRootKey`，`setBranchRoot(branchId, emptyRootKey)`，再在该 `emptyRootKey` 上执行本次 mkdir/write/upload（即本次操作的结果会再通过 commit 更新 branch root）。

---

## 6. Complete 逻辑

- 取 branch、parentId、parentRootKey（parent 为 realm root 或另一 branch）；任一「不存在/未初始化」均已在前面以异常/4xx 处理。
- `childRootKey = getBranchRoot(branchId)`。
- **若 `childRootKey === null`（NUL）**：
  - 语义：删除 parent 上该路径的内容。
  - 实现：在 parent 的 root 上对 `mountPath` 做 **remove**。若当前已有 `removeEntryAtPath`，调用之；若 path 或 parent 不存在（resolvePath 或 entry 找不到），则**不抛**，视为 no-op，直接得到「当前 parent root 不变」。
  - 然后 `setRealmRoot` 或 `setBranchRoot(parentId, newParentRootKey)`（no-op 时 newParentRootKey = parentRootKey），最后 `removeBranch(branchId)`。
- **若 `childRootKey !== null`**：
  - 语义：将 branch 的子树挂到 parent 的 mountPath 上；若 path 不存在则先创建。
  - 实现：先用 `resolvePath(cas, parentRootKey, mountPath)` 判断 path 是否存在。
    - 若存在：`newParentRootKey = replaceSubtreeAtPath(cas, key, parentRootKey, segments, childRootKey)`。
    - 若不存在：需要「ensure path 存在再添加」：即对 mountPath 的每一级缺失目录创建空 dict 并写回，得到新的 parentRootKey，再在最后一层 add 该 branch root（等价于 `addOrReplaceAtPath` 所需 parent 存在）。可在 `tree-mutations` 中新增 `ensurePathThenAddOrReplace(cas, key, rootKey, pathStr, newChildKey)`，内部：逐段 resolve，首段缺失则创建空 dict 并挂到 root，递归直至 path 存在，再调用 `addOrReplaceAtPath`。
  - 然后 `setRealmRoot` / `setBranchRoot(parentId, newParentRootKey)`，`removeBranch(branchId)`。

---

## 7. 存储层（NUL 的表示）

- **方案 2（null 表示 NUL）**：创建 branch 时若 path 不存在，**不**调用 `setBranchRoot`。Dynamo 中该 branch 无 ROOT 项（或 ROOT 项不存在）。`getBranchRoot(branchId)` 在 branch 存在时：若 ROOT 不存在则返回 `null`（NUL）。  
- Memory 实现：branch 存在但 `roots.get(branchId)` 为 undefined 时，`getBranchRoot` 返回 `null`。

---

## 8. 测试与兼容性

- 新增 / 调整用例：
  - 创建 branch：mountPath 不存在 → 201，且 getBranchRoot 为 null；complete 时 NUL → remove path（或 no-op）。
  - 创建 branch：mountPath 存在 → 行为与现有一致。
  - Worker 第一次 write/mkdir 当 root 为 NUL → 创建空根并写入成功。
  - Complete 时 NUL → parent 上该 path 被删除或 no-op；complete 时非 NUL 且 path 不存在 → ensure path 后挂上子树。
- Realm 未初始化、branch 不存在：对应接口返回 4xx，不依赖 null 表示这些错误。

---

## 9. 文件与改动点（概要）

| 位置 | 改动 |
|------|------|
| `branch-store` 契约 / 实现 | 明确：getBranchRoot 仅在对已存在 branch 调用时返回 null = NUL；getRealmRoot 无记录时抛异常（若采用存储层抛） |
| `controllers/branches.ts` | create：path 不存在时仍 insertBranch，不 setBranchRoot；先 getBranch，null 则 404 |
| `services/root-resolver.ts` | getCurrentRoot(worker)：getBranchRoot 返回 null 时返回 null（NUL） |
| `services/branch-complete.ts` | 若 childRootKey === null：remove path（或 no-op），再更新 parent root 并 removeBranch；否则 ensure path + replace |
| `services/tree-mutations.ts` | 新增 ensurePathThenAddOrReplace（或等价）；remove 分支需支持「path 不存在则 no-op」 |
| `controllers/fs.ts`, `controllers/files.ts`, `mcp/handler.ts` | 使用 getCurrentRoot 后若为 null（worker NUL）：第一次写先 ensureEmptyRoot + setBranchRoot，再执行写；list/stat 约定 |
| 错误处理 | 所有需要 realm root / branch 的地方：getRealmRootRecord / getBranch 为 null 时统一 4xx，不把 null 当 NUL |

以上设计在实现时可拆成小步：先统一 4xx 与异常契约，再允许创建时 path 不存在（NUL），再实现 complete 的两种分支，最后实现 worker 第一次写。
