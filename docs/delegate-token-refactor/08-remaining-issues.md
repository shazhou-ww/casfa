# 剩余问题 - 待后续迭代优化

> 版本: 1.0  
> 日期: 2026-02-05

---

本文档记录了在架构评审中发现的非关键性问题，这些问题不影响核心功能，可在后续迭代中逐步解决。

---

## 已修复的问题

以下问题已在当前版本修复：

| 问题 | 描述 | 修复位置 |
|------|------|----------|
| A1 | Issuer Chain 级联撤销事务保证 | 03-token-issuance.md 5.3 节 |
| A2 | set-node 引用计数事务保证 | 03-token-issuance.md 2.4 节 |
| S1 | 客户端 Token 存储安全指南 | README.md 附录 B |
| M2 | Token 记录添加 name/description 字段 | 05-data-model.md 2.2 节 |
| Issue 1 | clientSecret 示例长度修正 | 06-client-auth-flow.md 3.4 节 |
| Issue 2 | 密钥派生代码补充解码步骤 | 06-client-auth-flow.md 4.4 节 |
| Issue 6 | Ticket pending 状态 root 为 null | 07-api-changes.md 3.4 节 |
| Issue 8 | submittedAt 字段说明补充 | 07-api-changes.md 3.4 节 |
| Issue 11 | encryptedToken 格式说明 | 06-client-auth-flow.md 4.4 节 |

---

## 架构级待优化项

### R1. [中等] Ticket Submit 后 root 节点的孤儿问题

**描述**：

Ticket submit 时设置 `root` 字段并增加该节点的引用计数。需要明确以下边界情况：

1. 如果 submit 的 `rootNodeHash` 指向的节点不存在会怎样？
2. 如果用户从未读取 submitted Ticket 的 root，该数据永远不会被 GC？

**建议**：

1. Submit 时应验证 `rootNodeHash` 对应的节点确实存在于存储中
2. 考虑为 Ticket 添加 `expiresAt` 或保留策略，在 Ticket 删除时递减 root 的引用计数
3. 明确文档化：Ticket 删除策略和 root 节点的生命周期绑定关系

**优先级**：中等（影响数据清理）

---

### R2. [中等] Token Replay Attack 窗口

**描述**：

Token 验证仅检查 `isRevoked` 和 `expiresAt`。如果 Token 被泄露，在被发现并撤销之前，存在一个攻击窗口。

**建议**：

考虑以下缓解措施（可在后续版本实现）：

1. **Token 绑定 IP/设备**：签发时记录 IP 或设备指纹，使用时验证
2. **使用频率异常检测**：同一 Token 短时间内从多个地理位置使用时告警
3. **Token 轮换机制**：为长期 Token 提供自动轮换 API

**优先级**：中等（安全增强）

---

### R3. [低] Token 深度限制的硬编码

**描述**：

Token 深度硬编码为最大 15 层（4 bits）。这个限制合理，但如果未来需要调整，会涉及二进制格式变更。

**建议**：

当前设计已预留了 Magic Number 中的版本号（`0x01`），未来可通过版本号区分不同格式。建议在文档中明确：

> 深度限制 15 是 v1 格式的固定约束。如需更大深度，将通过新版本 Magic Number（如 `0x02`）引入新格式。

**优先级**：低（当前限制足够）

---

### R4. [低] 客户端授权流程与 PKCE 的关系说明

**描述**：

当前设计使用 `clientSecret` + URL hash 传递机制，与 OAuth 2.0 PKCE 流程相似但不完全一致。

**建议**：

在 06-client-auth-flow.md 中补充说明：

> 此设计受 OAuth 2.0 PKCE 启发，但做了简化：
> - PKCE 使用 `code_verifier` + `code_challenge`（SHA256）
> - 本设计使用对称加密（AES-256-GCM）保护 Token 传输

**优先级**：低（文档完善性）

---

## API/数据模型待优化项

### R5. [中等] DynamoDB GSI 投影优化

**描述**：

当前所有 GSI 的投影类型为 `ALL`（`gsi4` 除外为 `KEYS_ONLY`）。这意味着每次写入主表都会复制完整记录到所有 GSI，增加写入成本和延迟。

**建议**：

评估每个 GSI 的实际查询需求，改用 `INCLUDE` 投影：

| GSI | 当前投影 | 建议 | 理由 |
|-----|---------|------|------|
| gsi1 (realm → token) | ALL | INCLUDE: tokenType, expiresAt, isRevoked, name | 列表查询只需关键字段 |
| gsi2 (issuer → token) | ALL | INCLUDE: tokenType, isRevoked | 级联撤销只需判断状态 |
| gsi3 (creator → depot) | ALL | INCLUDE: title, createdAt | 列表查询 |
| gsi4 (audit) | KEYS_ONLY | 保持 | 正确 |

**优先级**：中等（成本优化）

---

### R6. [低] Quota 字段实现规范

**描述**：

Quota 字段在二进制格式中预留了 8 字节，但标注为 "Reserved - 当前版本不启用"。

**建议**：

即使当前版本不启用 quota 验证，也应明确：

1. 签发时：子 Token 的 quota 字段必须 <= 父 Token 的 quota（0 表示不限）
2. 如果父 Token quota > 0，子 Token quota 为 0 应视为"继承父 quota"
3. 在文档中补充这些规则，以便后续实现时有据可依

**优先级**：低（预留功能）

---

## 文档完善项

### R7. [低] expiresAt 字段命名风格

**位置**：06-client-auth-flow.md 多处

**描述**：

- 创建申请响应：`expiresAt`
- 轮询响应：`requestExpiresAt`、`tokenExpiresAt`

命名风格不完全一致。

**建议**：

文档已区分不同语义的过期时间，可保持现状。如需统一，可考虑创建申请响应也改为 `requestExpiresAt`。

**优先级**：低

---

### R8. [低] 轮询超时逻辑优化

**位置**：06-client-auth-flow.md TypeScript 示例

**描述**：

```typescript
while (Date.now() < expiresAt) {
```

`expiresAt` 是申请过期时间（10分钟），但 approved 后还有 1 小时可以获取 Token。

**建议**：

客户端示例中的循环条件可优化为根据状态判断，或添加注释说明。

**优先级**：低

---

### R9. [低] requestId 编码方式说明

**位置**：06-client-auth-flow.md

**描述**：

`requestId` 说明使用 "Base64 编码"，与 `clientSecret` 使用 Crockford Base32 不同，可能引起困惑。

**建议**：

添加说明区分两者的编码选择原因：
- `requestId`：使用 Base64，因为只在 API 通信中使用，不需要手动输入
- `clientSecret`：使用 Crockford Base32，因为需要通过 URL 传递，且 URL 安全

**优先级**：低

---

### R10. [低] Token 列表与详情响应差异

**位置**：07-api-changes.md 2.2 节

**描述**：

- 列表响应不包含 `issuerChain`
- 详情响应包含 `issuerChain`

差异未说明。

**建议**：

添加说明：

> 列表接口为了减少响应大小，不包含 `issuerChain`，如需完整信息请查询详情接口。

**优先级**：低

---

### R11. [低] Ticket 列表响应缺少 expiresAt

**位置**：07-api-changes.md 2.4 节

**描述**：

创建 Ticket 的响应包含 `expiresAt`，但列表响应不包含。

**建议**：

- 如果是有意省略（减少响应大小），添加说明
- 如果需要，补充 `expiresAt` 字段

**优先级**：低

---

### R12. [低] Ticket 创建权限说明

**位置**：07-api-changes.md 2.4 节

**描述**：

只说明需要 Delegate Token，未说明权限要求。创建 Depot 需要 `canManageDepot` 权限，创建 Ticket 是否需要特定权限未说明。

**建议**：

补充说明：
- 创建 Ticket 需要 Delegate Token，无需额外权限
- 或者：需要指定权限（如 `canCreateTicket`）

**优先级**：低

---

## 文档结构改进

### R13. [低] 补充时序图

建议为以下关键流程补充 Mermaid 时序图：

1. Token 级联撤销流程
2. set-node 引用计数增减流程
3. Issuer Chain 验证流程

**优先级**：低

---

### R14. [低] 补充术语表

建议在 README 中添加术语对照表：

| 术语 | 英文 | 说明 |
|------|------|------|
| 再授权 Token | Delegation Token | 可转签发，不可访问数据 |
| 访问 Token | Access Token | 可访问数据，不可转签发 |
| 签发链 | Issuer Chain | Token 的签发者追溯链 |
| 作用域 | Scope | 可读取的 CAS 节点范围 |

**优先级**：低

---

## 优先级汇总

| 优先级 | 问题列表 | 建议处理时机 |
|--------|----------|-------------|
| 中等 | R1, R2, R5 | 下一个迭代 |
| 低 | R3, R4, R6-R14 | 按需处理 |

---

## 后续行动

- [ ] R1: 明确 Ticket root 节点生命周期管理
- [ ] R2: 评估 Token 安全增强措施的必要性
- [ ] R5: 评估 GSI 投影优化的 ROI
- [ ] 其他问题按需在后续版本中处理
