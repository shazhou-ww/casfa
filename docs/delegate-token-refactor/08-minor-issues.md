# Minor Issues - 待后续优化

> 版本: 1.0  
> 日期: 2026-02-05

---

本文档记录了在最终评审中发现的小问题，这些问题不影响整体设计，可在后续迭代中逐步修复。

---

## 06-client-auth-flow.md

### Issue 1: clientSecret 示例值长度不正确

**位置**：3.4 批准授权申请请求示例（line 318）

**现状**：
```json
"clientSecret": "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
```

**问题**：这是 32 字符（完整 Crockford Base32 字符集），但 128 位随机数编码后应为 26 字符。

**建议**：更正为 26 字符的示例，如 `"0A1B2C3D4E5F6G7H8J9KMNPQRS"`

---

### Issue 2: 密钥派生代码需要先解码

**位置**：4.4 密钥派生代码片段（line 455）

**现状**：
```typescript
const key = createHash('sha256').update(clientSecret).digest();
```

**问题**：实际使用时 clientSecret 是 Crockford Base32 编码的字符串，需要先解码为 Buffer。

**建议**：补充说明或修改为：
```typescript
const clientSecretBytes = decodeCrockfordBase32(clientSecretEncoded);
const key = createHash('sha256').update(clientSecretBytes).digest();
```

---

### Issue 3: expiresAt 字段命名风格

**位置**：多处

**现状**：
- 创建申请响应：`expiresAt`
- 轮询响应：`requestExpiresAt`、`tokenExpiresAt`

**问题**：命名风格不完全一致。

**建议**：文档已区分不同语义的过期时间，可保持现状。如需统一，可考虑：
- 创建申请响应也改为 `requestExpiresAt`

---

### Issue 4: 轮询超时逻辑优化

**位置**：TypeScript 示例（line 646）

**现状**：
```typescript
while (Date.now() < expiresAt) {
```

**问题**：`expiresAt` 是申请过期时间（10分钟），但 approved 后还有 1 小时可以获取 Token。

**建议**：客户端示例中的循环条件可优化为根据状态判断，或添加注释说明。

---

### Issue 5: requestId 编码方式说明

**位置**：line 188, line 485

**现状**：`requestId` 说明使用 "Base64 编码"

**问题**：与 clientSecret 使用 Crockford Base32 不同，可能引起困惑。

**建议**：添加说明区分两者的编码选择原因：
- `requestId`：使用 Base64，因为只在 API 通信中使用，不需要手动输入
- `clientSecret`：使用 Crockford Base32，因为需要通过 URL 传递，且 URL 安全

---

## 07-api-changes.md

### Issue 6: Ticket pending 状态示例不一致

**位置**：3.4 Ticket 状态查询响应（line 458 vs line 467）

**现状**：
- 示例 JSON 中：`"root": "node:..."`
- 说明文字中：pending 状态时 root 为 `null`

**建议**：修改示例 JSON 为：
```json
{
  "ticketId": "ticket:...",
  "status": "pending",
  "root": null,
  ...
}
```

---

### Issue 7: Ticket 列表响应缺少 expiresAt

**位置**：2.4 GET /api/realm/{realmId}/tickets 响应（line 303-309）

**现状**：
```json
{
  "ticketId": "...",
  "title": "...",
  "status": "pending",
  "createdAt": 1738497600000
}
```

**问题**：创建响应包含 `expiresAt`，但列表响应不包含。

**建议**：
- 如果是有意省略（减少响应大小），添加说明
- 如果需要，补充 `expiresAt` 字段

---

### Issue 8: submittedAt 字段未在说明中提及

**位置**：3.4 字段说明（line 465-469）

**现状**：submitted 状态示例中出现 `submittedAt` 字段，但字段说明未列出。

**建议**：在字段说明中补充：
- `submittedAt`：Ticket 提交时间（仅 submitted 状态时存在）

---

### Issue 9: Token 列表与详情响应差异

**位置**：2.2 GET /api/tokens vs GET /api/tokens/:tokenId

**现状**：
- 列表响应不包含 `issuerChain`
- 详情响应包含 `issuerChain`

**问题**：差异未说明。

**建议**：添加说明：
> 列表接口为了减少响应大小，不包含 `issuerChain`，如需完整信息请查询详情接口。

---

### Issue 10: Ticket 创建权限说明

**位置**：2.4 POST /api/realm/{realmId}/tickets

**现状**：只说明需要 Delegate Token，未说明权限要求。

**问题**：创建 Depot 需要 `canManageDepot` 权限，创建 Ticket 是否需要特定权限未说明。

**建议**：补充说明：
- 创建 Ticket 需要 Delegate Token，无需额外权限
- 或者：需要指定权限（如 `canCreateTicket`）

---

## 跨文档一致性

### Issue 11: encryptedToken 格式说明

**位置**：06 文档多处

**现状**：`encryptedToken` 格式为 "base64_encrypted_token..."

**问题**：未明确说明加密后的数据格式（IV + ciphertext + authTag 的顺序）。

**建议**：在安全考量部分补充：
```
encryptedToken = Base64(IV[12 bytes] + ciphertext + authTag[16 bytes])
```

---

## 优先级建议

| 优先级 | Issue | 影响 |
|--------|-------|------|
| 高 | Issue 6 | 示例错误可能误导实现 |
| 中 | Issue 1, 2, 8, 11 | 补充说明和示例 |
| 低 | Issue 3, 4, 5, 7, 9, 10 | 文档完善性 |

---

## 后续行动

- [ ] Issue 6: 修正 pending 状态示例
- [ ] Issue 1: 更正 clientSecret 示例长度
- [ ] Issue 8: 补充 submittedAt 字段说明
- [ ] Issue 11: 补充 encryptedToken 格式说明
- [ ] 其他 Issue 在后续版本中逐步完善
