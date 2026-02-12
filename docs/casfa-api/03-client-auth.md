# 客户端授权申请

> **⚠️ 未实现**：以下描述的是设计规划，尚未在服务端实现。Protocol 层已定义相关 schemas（`CreateAuthRequestSchema`, `ApproveRequestSchema` 等），但路由和控制器未注册。

用于桌面/CLI 应用向用户申请 Delegate Token 的流程，无需用户手动复制粘贴 Token。

## 适用场景

| 场景 | 说明 |
|------|------|
| IDE 插件 | Cursor、VS Code 等编辑器插件 |
| CLI 工具 | 命令行工具的首次认证 |
| 桌面应用 | 原生桌面客户端 |

## 设计流程

```
┌───────────┐                    ┌───────────┐                    ┌────────┐
│  Client   │                    │  Server   │                    │  User  │
└─────┬─────┘                    └─────┬─────┘                    └────┬───┘
      │                                │                               │
      │ 1. Generate clientSecret       │                               │
      │    (local)                     │                               │
      │                                │                               │
      │ 2. POST /tokens/requests       │                               │
      │    {clientName}                │                               │
      │───────────────────────────────>│                               │
      │                                │                               │
      │ 3. {requestId, displayCode,    │                               │
      │     authorizeUrl, expiresAt}   │                               │
      │<───────────────────────────────│                               │
      │                                │                               │
      │ 4. Show link & display code    │                               │
      │    "Verify code: ABCD-1234"    │                               │
      │───────────────────────────────────────────────────────────────>│
      │                                │                               │
      │                                │ 5. User opens link, approves  │
      │                                │<──────────────────────────────│
      │                                │                               │
      │ 6. GET /requests/:id/poll      │                               │
      │    (polling)                   │                               │
      │───────────────────────────────>│                               │
      │                                │                               │
      │ 7. status: "approved"          │                               │
      │    encryptedToken              │                               │
      │<───────────────────────────────│                               │
      │                                │                               │
      │ 8. Decrypt with clientSecret   │                               │
```

## 计划端点

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/tokens/requests` | 发起授权申请 | 无 |
| GET | `/api/tokens/requests/:requestId/poll` | 轮询状态 | 无 |
| GET | `/api/tokens/requests/:requestId` | 查看详情 | User JWT |
| POST | `/api/tokens/requests/:requestId/approve` | 批准申请 | User JWT |
| POST | `/api/tokens/requests/:requestId/reject` | 拒绝申请 | User JWT |

> 详细设计请参考 archived 版本：`docs/archive/casfa-api-2026-02-12/03-client-auth.md`
