# Branch 访问 URL 内嵌校验（Presigned-style）设计

## 1. 目标与背景

- **目标**：服务/脚本（如 image-workshop、MCP）访问 branch API 时，使用「一条 URL 即可」的方式，无需再单独传 `Authorization: Bearer` 或 `branchAccessToken`；同时避免「仅 branchId 泄露即完全授权」。
- **约束**：仅服务端调用场景（B）；不用于浏览器主流程。Branch 生命周期上限 10 分钟（与本方案配套的 TTL 策略）。
- **形态**：Path 前缀 + 不透明 verification，格式为 128 位 Crockford Base32（26 字符）。

## 2. 方案对比与推荐

### 方案一：服务端存储 verification（推荐）

- **生成**：创建 branch 时（或「为已有 branch 签发访问 URL」时）生成 128-bit 随机数，转为 Crockford Base32（26 字符），写入存储：`(verification, branchId, expiresAt)` 或挂在 branch 元数据上（每个 branch 可有一个当前有效的 verification）。
- **校验**：请求 `/branch/:branchId/:verification/...` 时，用 verification 查表，校验 branchId 一致且 `now <= expiresAt`，通过则注入 worker auth 并重写 path 到 `/api/...`。
- **优点**：可撤销（删 verification 即失效）、可审计、实现直观；verification 与 branch 解耦，branchId 泄露不会直接暴露 verification。
- **缺点**：需要存储与一次查表（可与 branch 同表或单独表）。

### 方案二：无状态 verification（HMAC）

- **生成**：`verification = CrockfordB32(expiresAt_uint64 || HMAC(branchId||expiresAt)[0:8])`，保证 128 位；不落库。
- **校验**：解析出 expiresAt，校验 `now <= expiresAt` 且 HMAC 一致。
- **优点**：无存储、无查表，水平扩展友好。
- **缺点**：无法单次撤销（只能等过期）；若需「提前作废某条 URL」则做不到。

**推荐**：方案一（存储 verification）。理由：branch 本身已有存储与 TTL，多一项 verification 存储成本低；且支持「撤销某条 branch 访问链接」而不必 revoke 整个 branch，安全语义更清晰。若后续确认无需撤销能力，可再考虑改为方案二。

## 3. URL 与路由形态

- **格式**：`/branch/{branchId}/{verification}/api/...`  
  示例：`https://drive.casfa.shazhou.me/branch/550e8400-e29b-41d4-a716-446655440000/3MXV2J5K8N9PQRSTVWXYZ012345/api/realm/me/files`
- **verification**：26 字符，Crockford Base32 字符集 `[0-9A-Z]` 排除 I,L,O,U（即 `0123456789ABCDEFGHJKMNPQRSTVWXYZ`），大小写不敏感（解码时统一转大写）。
- **路由**：所有 `/branch/:branchId/:verification/*` 由同一路由处理：校验通过后，将 context 设为该 branch 的 worker auth，并将 path 重写为 `/*`（即去掉 `/branch/:branchId/:verification` 前缀），再交给现有 `/api/...` 等路由。未匹配 `/branch/...` 的请求行为不变（含现有 Bearer 认证）。

## 4. verification 的生成与存储（方案一）

- **128 位**：使用 CSPRNG 生成 16 字节，按大端解释为 128-bit 整数，再编码为 Crockford Base32（26 字符，高位不足补 0）。
- **存储**：  
  - 选项 A：在 branch 元数据中增加可选字段 `accessVerification?: { value: string; expiresAt: number }`，创建 branch 时写入；revoke branch 时一并删除。  
  - 选项 B：独立表/GSI，如 `PK=BRANCH#branchId`, `SK=VERIFICATION#verification`，属性 `expiresAt`；便于「一个 branch 多条 verification」或按 verification 查。  
  推荐先采用选项 A，一个 branch 一个当前有效的 verification，创建时覆盖更新即可；若未来需要多链接并存再改为 B。
- **TTL**：verification 的 `expiresAt` 与 branch 的 `expiresAt` 一致；创建 branch 时 TTL 上限为 10 分钟（见下节）。

## 5. Branch TTL 上限 10 分钟

- **策略**：对所有 branch，`maxBranchTtlMs` 配置为不超过 10 分钟（600_000 ms）；创建 branch 时若请求的 `ttl` 超过此值则截断为 10 分钟。
- **影响**：现有 `config.auth.maxBranchTtlMs` 在 server-next 部署时设为 600_000；若未配置则默认 10 分钟。文档中说明：branch 为短期工作区，最长 10 分钟，适合 MCP/image-workshop 等单次任务。

## 6. 安全与风险简述

- **URL 泄露**：整条 URL 含 branchId + verification；泄露后在该 URL 过期前可被滥用。通过 10 分钟 TTL 和「verification 可撤销」限制影响面；建议调用方不要在日志中打印完整 URL。
- **branchId 单独泄露**：仅 branchId 无法通过 path 方式访问（必须带有效 verification）；Bearer 方式仍为 base64url(branchId)，行为与现有一致，不因本方案变差。
- **Referer / 代理 / 历史**：服务端调用通常不走浏览器，Referer 与历史记录风险小；若未来有浏览器场景再考虑 query 改为 path、或仅短期在内存中使用该 URL。
- **结论**：在「服务端调用 + 短 TTL + verification 绑定 branchId 与过期」前提下，安全风险可控；不引入明显新风险。

## 7. 安全评估与约束（专家视角）

### 7.1 威胁模型（简要）

- **资产**：某 branch 下的数据与操作（读/写/complete 等）。
- **信任**：持有「完整 URL」或「Bearer token」的人视为授权方。
- **威胁**：URL/token 泄露、重放、伪造、权限提升、滥用时效等。

### 7.2 风险与结论

| 风险 | 分析 | 结论 |
|------|------|------|
| URL 全量泄露 | 整条 URL 含 branchId + verification，泄露即等于授权到过期。10 min TTL + 可撤销限损；日志/历史/代理可能留存。 | **中**：可接受。调用方不把完整 URL 写日志；审计只记 branchId + 时间。 |
| 仅 branchId 泄露 | Path 方式必须带有效 verification；仅 branchId 无法访问。Bearer 仍为 base64url(branchId)，与现有一致。 | **低**：未引入新风险。 |
| Verification 猜测/暴力 | 128-bit 随机，暴力不可行。 | **低**：无需额外措施。 |
| 重放 | 同一 URL 在有效期内可多次使用，属设计如此（方便 MCP/脚本连续调用）。若需「单次使用」可后续加 use-once。 | **低**：当前可接受。 |
| Path 与 Host 绑定 | 未对「哪个 host 可接受」做签名。多域/多实例共享存储时，一条 URL 可在任一域用。通常同一 cell 多域等价；若有严格域隔离再考虑绑 host。 | **低**：多数部署无影响。 |
| 中间人/传输 | 生产应全站 HTTPS；path 内 token 受 TLS 保护，与 Bearer 在 header 的暴露面类似。 | **低**：依赖现有 HTTPS。 |
| Referer/第三方泄露 | 服务端调用一般不经过浏览器，Referer 风险小。若未来有浏览器场景需注意外链与 Referer 策略。 | **低**：当前仅服务端可接受。 |

### 7.3 与经典 Presigned URL 的差异

- 典型 S3 presigned：签名 = f(method, path, expires, secret)，无状态。
- 本方案：verification 为服务端生成并存储的随机 token，绑定 branchId + expiresAt，校验时查库。**优点**：可撤销、可审计、不暴露签名密钥；branchId 单独泄露不能访问。**注意**：verification 泄露等价于「该 branch 在该时效内的访问权」，与「知道 Bearer token」等价；无 method/path 边界，靠 10 min + 可撤销限损。

### 7.4 硬性约束（实施必须遵守）

- **HTTPS only**：生产环境禁止在 HTTP 下使用带 verification 的 URL。
- **TTL 上限**：branch（及 verification）最大 10 分钟，配置不开放更大值。
- **不记录完整 URL**：日志/监控只记录 branchId、时间、路径前缀（如 `/branch/:id/:ver`），不记录完整 verification 或完整 URL。
- **revoke 即失效**：revoke/complete 时立刻清除 verification，确保撤销后旧链接不可用。

### 7.5 总体结论

无明显设计级漏洞；可撤销、短 TTL、128-bit verification、仅服务端使用均在合理范围。主要剩余风险为「完整 URL 泄露后在有效期内被滥用」，通过 TTL 上限、可撤销与「不记录完整 URL」可控制在可接受水平。

## 8. 实现要点（方案一）

| 模块 | 内容 |
|------|------|
| **Crockford Base32** | 新增 util：`encodeCrockfordBase32(bytes: Uint8Array): string`、`decodeCrockfordBase32(s: string): Uint8Array \| null`；128 位 = 16 字节 ↔ 26 字符。 |
| **branch 创建** | 生成 16 字节随机 → Crockford B32 → 写入 branch 的 `accessVerification = { value, expiresAt }`（与 branch.expiresAt 一致）；返回 body 增加 `accessUrlPrefix?: string`，如 `CELL_BASE_URL + "/branch/" + branchId + "/" + verification`，便于调用方拼 path。 |
| **路由与中间件** | 在现有 app 最前挂载：匹配 `GET|POST|PUT|PATCH|DELETE /branch/:branchId/:verification/*`，查 verification（从 branch 或独立表），校验 branchId 一致且未过期，设置 worker auth，重写 path 为 `/*`，`next()`。 |
| **revoke/complete** | revoke branch 或 complete 时清除该 branch 的 `accessVerification`（或删除对应 VERIFICATION 记录）。 |
| **配置** | `maxBranchTtlMs` 默认 600_000，部署可覆盖但建议 ≤10 min。 |

## 9. 调用方约定

- **image-workshop / MCP**：创建 branch 后使用返回的 `accessUrlPrefix`（或 `baseUrl` + `/branch/{branchId}/{verification}`）作为 base URL，后续请求如 `GET {base}/api/realm/me/files` 不再带 Bearer。若返回体无 `accessUrlPrefix`（旧版或未配置 CELL_BASE_URL），则回退为 Bearer。
- **向后兼容**：继续支持 `Authorization: Bearer <base64url(branchId)>`，无需修改现有只传 token 的客户端。

## 10. 文档与后续

- 在 server-next README 或 docs 中增加「Branch 访问 URL」一节：说明 path 格式、verification 含义、10 分钟 TTL、以及不要在日志中记录完整 URL。
- 实施计划由 writing-plans 产出（路由、存储、创建/revoke/complete、Crockford B32 util、测试与迁移）。
