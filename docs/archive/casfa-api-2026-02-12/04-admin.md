# Admin 管理 API

用于管理用户和权限的管理员 API 端点。

> **注意**: 所有 Admin API 都需要管理员权限（role = "admin"）。

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/admin/users` | 列出所有用户 | Admin |
| PATCH | `/api/admin/users/:userId` | 修改用户角色 | Admin |

---

## GET /api/admin/users

列出所有已授权的用户，包含 Cognito 用户信息。

### 请求

需要管理员认证：

```http
Authorization: Bearer {adminToken}
```

### 响应

```json
{
  "users": [
    {
      "userId": "usr_A6JCHNMFWRT90AXMYWHJ8HKS90",
      "role": "authorized",
      "email": "user@example.com",
      "name": "用户名"
    },
    {
      "userId": "usr_B7KDJOQGXSU01BYNZXIK9ILT01",
      "role": "admin",
      "email": "admin@example.com",
      "name": "管理员"
    }
  ]
}
```

### 用户角色说明

| 角色 | 描述 |
|------|------|
| `unauthorized` | 未授权用户，无法访问 CAS 资源 |
| `authorized` | 已授权用户，可以创建和管理 Token |
| `admin` | 管理员，可以管理所有用户 |

---

## PATCH /api/admin/users/:userId

修改指定用户的角色。可用于授权、提升为管理员或封禁用户。

### 请求

需要管理员认证：

```http
PATCH /api/admin/users/usr_A6JCHNMFWRT90AXMYWHJ8HKS90
Authorization: Bearer {adminToken}
Content-Type: application/json

{
  "role": "authorized"
}
```

路径参数：

- `userId`: 用户 ID（URL 编码）

请求体：

| 字段 | 类型 | 描述 |
|------|------|------|
| `role` | `"unauthorized" \| "authorized" \| "admin"` | 要设置的角色 |

### 响应

```json
{
  "userId": "usr_A6JCHNMFWRT90AXMYWHJ8HKS90",
  "role": "authorized"
}
```

### 使用场景

| 操作 | 请求体 |
|------|--------|
| 授权新用户 | `{"role": "authorized"}` |
| 提升为管理员 | `{"role": "admin"}` |
| 封禁用户 | `{"role": "unauthorized"}` |
| 降级为普通用户 | `{"role": "authorized"}` |

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求格式错误或角色无效 |
| 401 | 未认证 |
| 403 | 需要管理员权限 |
| 404 | 用户不存在 |

---

## 权限说明

### 角色层级

```
unauthorized < authorized < admin
```

### 权限矩阵

| 操作 | unauthorized | authorized | admin |
|------|--------------|------------|-------|
| 创建 Delegate Token | ❌ | ✅ | ✅ |
| 管理自己的 Token | ❌ | ✅ | ✅ |
| 审批授权申请 | ❌ | ✅ | ✅ |
| 管理用户 | ❌ | ❌ | ✅ |
| 查看所有用户 | ❌ | ❌ | ✅ |

> **注意**：实际数据访问（Node、Depot、Ticket）由 Access Token 控制，不受用户角色直接影响。
