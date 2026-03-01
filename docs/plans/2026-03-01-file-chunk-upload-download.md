# 文件分块上传与分块下载（API 详细）

**日期**：2026-03-01  
**归属**：server-next API 设计附录，对应 [2026-03-01-server-next-api-design.md](./2026-03-01-server-next-api-design.md) §8。

**首版范围说明**：当前 server-next **首版仅支持单 node 文件**（约 4MB，单 node 上限），**不实现**本文中的 nodes/check、nodes/raw、commit、manifest 等端点。本文保留供后续大文件功能扩展参考。

需求中约定：上传「拆成 Block，逐个 block 上传，再逐级创建父 node，最后 update root」；下载支持「Web UI 的 Service Worker 或客户端按 block 下载后拼装」。本文说明 CAS 侧数据模型、两种上传/下载方式及对应 API。

---

## 1. CAS 侧数据模型（简要）

- **文件**在 CAS 中由 **f-node**（首块）与若干 **s-node**（后继块）组成一条链；每个 node 含一段 **data** 和可选的 **children**（指向下一块 s-node 的 hash）。
- **单块小文件**：一个 f-node 即可（data + 可选 FileInfo）。
- **大文件**：f-node（data0 + child→s1）→ s-node（data1 + child→s2）→ … → s-node（dataN，无 child）。根 key 即「文件 node」的 key；读取时按链顺序拼接各块 data 得到完整内容。
- **Block**：本文中「block」指一个已存储的 CAS node（f-node 或 s-node），由 **content-addressed key** 唯一标识。客户端上传时先传 block 再组链再挂到路径。

---

## 2. 分块上传（两种方式）

### 2.1 方式 A：客户端按 block 上传，再挂路径（适合大文件、SW/客户端控制分块）

流程概览：

1. **检查/上传 block**  
   客户端将文件切分为若干块，每块编码为 CAS 二进制（f-node 或 s-node），在本地算出每块的 key。  
   - 调用 **POST** `/api/realm/:realmId/nodes/check`，body：`{ "keys": ["nod_...", "nod_...", ...] }`，服务端返回 `{ "missing": [...], "unowned": [...] }`。  
   - 对 `missing` 中的 key：**PUT** `/api/realm/:realmId/nodes/raw/:key`，body 为该块的 CAS 二进制（流式或整块）。  
   - 对 `unowned` 中的 key（已存在但当前 delegate 未拥有）：**POST** `/api/realm/:realmId/nodes/claim`，body：`{ "key": "nod_...", "proof": "..." }`（PoP 等，与现有一致），完成「认领」。  

2. **挂到路径并更新根**  
   客户端已拥有「文件根 node」的 key（即 f-node 的 key，该 f-node 的 children 指向后续 s-node）。  
   - 调用 **POST** `/api/realm/:realmId/fs/write-at-path` 或等价端点，body：`{ "path": "/foo/bar.txt", "fileNodeKey": "nod_..." }`，表示「把以 `fileNodeKey` 为根的 file 链挂到 path」；服务端在当前根下按 path 创建/覆盖条目，生成新 root key，再调用 **POST** `/api/realm/:realmId/commit`，body：`{ "newRootKey": "nod_...", "oldRootKey": "nod_..." }` 完成乐观锁更新。  
   - 若实现将「写 path + commit」合并为一步，则可只提供一个 **PUT** `/api/realm/:realmId/files/*path`，body 为 `fileNodeKey`（或 manifest），服务端内部完成 path 更新与 commit。

**所需端点小结**：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/realm/:realmId/nodes/check` | Body: `{ keys: string[] }`；返回 `{ missing, unowned }`。 |
| PUT | `/api/realm/:realmId/nodes/raw/:key` | Body: CAS 节点二进制（流式）；服务端校验 hash、ownership（及配额）。 |
| POST | `/api/realm/:realmId/nodes/claim` | Body: `{ key, proof }`；认领已存在但未拥有的 node。 |
| POST | `/api/realm/:realmId/commit` 或 合并到 PUT files | 提交新根：`{ newRootKey, oldRootKey }`；或由「按 path 写文件」内部触发。 |

Worker 作用域下：上述 `nodes/check`、`nodes/raw/:key`、`nodes/claim`、`commit` 均针对 **当前 Branch 的根**；path 写与 commit 更新的是该 Branch 的当前根，不是 realm root。

### 2.2 方式 B：整文件流式上传（服务端切块，适合中小文件或简化客户端）

客户端不关心 block 边界，只发一整段 body：

- **PUT** `/api/realm/:realmId/files/*path`，Body: 文件字节流（`application/octet-stream`），可选 Header `Content-Length`、`Content-Type`。  
- 服务端：按配置的 block 大小（如 4MB）切分流，依次生成 f-node/s-node 并写入 CAS（或调用现有 writeFile/uploadFileNode 逻辑），得到文件根 key，再在当前根下把 path 指向该 key，执行 commit。  
- 优点：客户端实现简单；缺点：大文件时服务端内存/CPU 需支持流式切块，且断点续传需额外协议（见下）。

**与方式 A 的关系**：方式 B 可视为「单请求版」；超过一定大小的文件可要求或建议客户端走方式 A（显式 block 上传），以利于 SW 缓存、重试单块等。

**断点续传（可选）**：  
- 方式 A：天然支持——每个 block 独立上传，失败重传该 key 即可。  
- 方式 B：可增加 **resumable** 流程：**POST** `.../files/*path?resumable=1` 返回 `uploadId`；**PUT** `.../uploads/:uploadId/parts/:partIndex` 上传分片；**POST** `.../uploads/:uploadId/complete` 传入 part 列表，服务端组链并 commit。与 S3 multipart 类似，实现时再定 part 与 CAS block 的对应关系。

---

## 3. 分块下载（两种方式）

### 3.1 方式 A：服务端流式拼接 + Range（推荐默认）

- **GET** `/api/realm/:realmId/files/*path`：  
  - 服务端根据 path 解析出文件 node key，按 f-node → s-node 链顺序从 CAS 拉取各块 data，**不缓存在内存**，直接 pipe 到响应 body（流式）。  
  - 支持 **Range**：请求头 `Range: bytes=0-1023`，服务端只发送对应字节区间（需根据链上每块 data 的 offset 找到对应块并切齐），响应 `206 Partial Content`、`Content-Range`。  
- 优点：客户端无需理解 CAS；适合普通下载、视频拖拽、大文件按需读。  
- 无需额外「block 列表」端点即可满足「下载文件」用例。

### 3.2 方式 B：客户端按 block 拉取后拼装（适合 SW 缓存、并行下载）

- **获取文件元数据与 block 列表**：  
  **GET** `/api/realm/:realmId/files/*path?meta=1` 或 **GET** `/api/realm/:realmId/files/*path/manifest`，响应除 size、contentType 外，增加 **blockKeys**（或 **ranges**）：该文件链上各 node 的 key 顺序列表（及可选每块字节长度），例如：  
  `{ "size": 10485760, "contentType": "application/octet-stream", "blockKeys": ["nod_abc...", "nod_def...", ...] }`  

- **按 key 拉取单块**：  
  **GET** `/api/realm/:realmId/nodes/raw/:key`，返回该 node 的 **原始 CAS 二进制**（含 header、children、data）。  
  若希望「只取该 node 的 data 段」（便于客户端直接拼装字节），可增加：  
  **GET** `/api/realm/:realmId/nodes/raw/:key?part=body`，响应仅该 node 的 data 部分（无 header/children），便于 SW 或客户端按 blockKeys 顺序 fetch 并 concat。  

- 客户端流程：先 GET manifest 得到 blockKeys，再并行 GET 各 `nodes/raw/:key?part=body`（或 raw/:key 自行解析），按顺序拼接即得完整文件。  
- 优点：SW 可按 key 缓存；可并行请求多个 key；断点续传只需重拉未完成的 key。

**所需端点小结（下载）**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/realm/:realmId/files/*path` | 流式下载；支持 Range。 |
| GET | `/api/realm/:realmId/files/*path?meta=1` 或 `.../manifest` | 元数据 + blockKeys（及可选每块长度）。 |
| GET | `/api/realm/:realmId/nodes/raw/:key` | 原始 CAS node 二进制。 |
| GET | `/api/realm/:realmId/nodes/raw/:key?part=body` | 仅 node 的 data 段（可选，便于拼装）。 |

Worker 作用域下：path 相对于 Branch 根；`nodes/raw/:key` 需校验该 key 属于当前 Branch 可访问的 CAS 子图（例如在当前 root 的闭包内），避免跨 Branch 越权。

---

## 4. 小结

| 场景 | 上传 | 下载 |
|------|------|------|
| **默认/简单** | PUT files/*path 整文件流（方式 B）；服务端切块写 CAS + commit | GET files/*path 流式 + Range（方式 A） |
| **大文件 / SW / 控制力强** | 方式 A：nodes/check → nodes/raw/:key（+ claim）→ 写 path + commit | 方式 B：GET files/*path?meta=manifest → GET nodes/raw/:key（?part=body）并行拉取再拼装 |

实现时建议：  
- 先支持「整文件 PUT + 流式 GET（含 Range）」与「nodes/raw/:key」；  
- 再补 nodes/check、nodes/claim、commit（或合并到 path 写）及 manifest/blockKeys、?part=body，以完整支持需求中的「按 block 上传、按 block 下载后拼装」。

---

## 5. Lambda / FaaS 部署约束

当 server 部署在 **AWS Lambda**（或 API Gateway → Lambda）时，请求/响应有 **6MB** payload 限制，整文件「一体流式」上传无法经 Lambda 适配；下载可用 Lambda Response Streaming 流式返回（总长约 200MB），可适配。

**上传**：Lambda 请求 body 有 6MB 硬限制，无请求体流式进 Lambda。  
- 方式 B（整文件 PUT）仅适用于 ≤ 6MB。  
- 大文件须用方式 A（按 block 上传，**单块 ≤ 6MB**），或预签名 URL 直写 S3 后由 Lambda 做 commit。

**下载**：Lambda 支持 Response Streaming，响应可流式写出，不整文件缓冲。  
- 方式 A（GET files/*path 流式 + Range）可与 Lambda 兼容。  
- 若不启用响应流式，则需方式 B（manifest + 按 key 拉 block），单 block 响应 ≤ 6MB 或走预签名 GET。

结论：**大文件整体流式上传**在 Lambda 上无法直接适配；**大文件整体流式下载**在启用 response streaming 时可适配。
