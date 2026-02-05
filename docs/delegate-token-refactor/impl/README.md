# 实现规划文档

本目录包含 Delegate Token 重构的具体实现规划文档。

---

## 文档索引

| 文档 | 内容 | 状态 |
|------|------|------|
| [01-dynamodb-changes.md](./01-dynamodb-changes.md) | DynamoDB 表结构变更与数据库操作层实现 | 草案 |

---

## 计划文档

后续将根据需要添加以下实现文档：

| 文档 | 内容 |
|------|------|
| `02-token-service.md` | Token 签发与验证服务层实现 |
| `03-api-handlers.md` | API Handler 层实现变更 |
| `04-auth-middleware.md` | 认证中间件重构 |
| `05-migration-guide.md` | 迁移指南与回滚计划 |

---

## 实现顺序建议

```
1. DynamoDB 表结构变更（01-dynamodb-changes.md）
   ├── 类型定义
   ├── 表结构脚本
   └── 数据库操作层
   
2. Token 服务层
   ├── Token 编码/解码
   ├── Token 签发逻辑
   └── Token 验证逻辑
   
3. API Handler 层
   ├── Token 管理 API
   ├── 客户端授权申请 API
   └── Realm 数据访问 API
   
4. 认证中间件
   └── 统一 Delegate Token 认证
```

---

## 依赖关系

```
设计文档 (../05-data-model.md)
       │
       ▼
DynamoDB 实现 (01-dynamodb-changes.md)
       │
       ▼
服务层实现 (02-token-service.md)
       │
       ▼
API 层实现 (03-api-handlers.md)
       │
       ▼
中间件实现 (04-auth-middleware.md)
```
