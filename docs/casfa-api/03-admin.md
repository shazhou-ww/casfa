# Admin 管理 API

用于管理用户和权限的管理员 API 端点。

> **注意**: 所有 Admin API 都需要管理员权限（role = "admin"）。认证链路：JWT → `jwtAuthMiddleware` → `adminAccessMiddleware`。

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/admin/users` | 列出所有用户 | Admin JWT |
| PATCH | `/api/admin/users/:userId` | 修改用户角色 | Admin JWT |

---

## GET /api/admin/users

列出所有已授权的用户。

### 请求

```http
GET /api/admin/users
Authorization: Bearer {admin_jwt}
```

### 响应

```json
{
  "users": [
    {
      "userId": "usr_A6JCHNMFWRT90AXMYWHJ8HKS90",
      "role": "authorized",
      "email": "",
      "name": null
    },
    {
      "userId": "usr_B7KDJOQGXSU01BYNZXIK9ILT01",
      "role": "admin",
      "email": "",
      "name": null
    }
  ]
}
```

> **注意**：当前版本 email 和 name 为占位值，生产环境需要从 Cognito 获取。

---

## PATCH /api/admin/users/:userId

修改指定用户的角色。

### 请求

```http
PATCH /api/admin/users/usr_A6JCHNMFWRT90AXMYWHJ8HKS90
Authorization: Bearer {admin_jwt}
Content-Type: application/json

{
  "role": "authorized"
}
```

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `role` | `"unauthorized" \| "authorized" \| "admin"` | 是 | 要设置的角色 |

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

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求格式错误或角色无效 |
| 401 | 未认证 |
| 403 | 需要管理员权限 |

---

## 权限矩阵

| 操作 | unauthorized | authorized | admin |
|------|--------------|------------|-------|
| 创建 Root Delegate | ❌ | ✅ | ✅ |
| 管理自己的 Delegate | ❌ | ✅ | ✅ |
| 访问 Realm 数据 | ❌ | ✅ | ✅ |
| 管理用户 | ❌ | ❌ | ✅ |

> **注意**：实际数据访问（Node、Depot）由 Delegate 权限（`canUpload`、`canManageDepot`、scope）控制，不受用户角色直接影响。
