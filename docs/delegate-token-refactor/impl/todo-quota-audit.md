# TODO: Quota 审计与管理

> 状态: TODO  
> 优先级: 中  
> 创建日期: 2026-02-05

---

## 概述

本文档记录 Quota（配额）审计与管理功能的待办事项。该功能在当前版本中暂不实现，留待后续版本完善。

---

## 1. 需求背景

### 1.1 用户配额管理

用户需要能够：
- 查看自己的存储配额使用情况
- 了解各 Token 的配额消耗分布
- 设置子 Token 的配额限制

### 1.2 审计需求

管理员需要能够：
- 追踪配额变化历史
- 识别配额滥用行为
- 生成配额使用报告

---

## 2. 待实现功能

### 2.1 UserQuota 数据模型

```typescript
// 参考 05-data-model.md 中的 UserQuotaRecord
type UserQuotaRecord = {
  userId: string;
  quotaBytes: number;      // 配额上限
  usedBytes: number;       // 已使用
  reservedBytes: number;   // 预留（pending tickets）
  updatedAt: number;
};
```

### 2.2 Quota 更新逻辑

| 事件 | Quota 变化 |
|------|-----------|
| Node 上传成功 | usedBytes += nodeSize |
| Ticket 创建 | reservedBytes += estimatedSize（可选） |
| Ticket 提交 | reservedBytes -= estimated, usedBytes += actualSize |
| Node 垃圾回收 | usedBytes -= reclaimedSize |

### 2.3 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/quota` | GET | 获取当前用户配额使用情况 |
| `/api/quota/history` | GET | 获取配额变化历史 |
| `/api/admin/quotas` | GET | 管理员查看所有用户配额 |
| `/api/admin/quotas/:userId` | PUT | 管理员调整用户配额 |

### 2.4 审计日志

```typescript
type QuotaAuditRecord = {
  auditId: string;
  userId: string;
  action: "upload" | "gc" | "admin_adjust";
  deltaBytes: number;
  previousUsed: number;
  newUsed: number;
  relatedEntity?: string;  // tokenId, nodeKey, etc.
  timestamp: number;
};
```

---

## 3. 实现建议

### 3.1 Phase 1: 基础监控
- 实现 UserQuota 数据模型
- 在 Node 上传时更新 usedBytes
- 提供基础的 GET /api/quota 端点

### 3.2 Phase 2: 审计日志
- 实现 QuotaAuditRecord 数据模型
- 记录所有配额变化事件
- 提供历史查询 API

### 3.3 Phase 3: 管理功能
- 管理员配额调整 API
- 配额告警机制
- 使用报告生成

---

## 4. 注意事项

1. **原子性**：配额更新必须与存储操作在同一事务中
2. **一致性**：需要定期对账，确保 usedBytes 与实际存储一致
3. **性能**：高频更新场景需要考虑计数器分片
4. **垃圾回收**：需要与 GC 流程集成，正确回收配额

---

## 5. 相关文档

- [05-data-model.md](../05-data-model.md) - UserQuotaRecord 定义
- [01-dynamodb-changes.md](./01-dynamodb-changes.md) - DynamoDB 表结构
