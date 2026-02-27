# Step 2: Delegate 列表 — 数据获取、表格展示、分页与过滤

## 目标

实现 Delegate 列表的核心功能：从后端获取数据、表格展示、分页加载、已撤销过滤。

---

## 2.1 实现 Delegates Store 的数据获取

**修改文件**：`apps/server/frontend/src/stores/delegates-store.ts`

实现 `fetchDelegates` 和 `fetchMore`：

```tsx
// 核心逻辑
fetchDelegates: async () => {
  set({ isLoading: true, error: null });
  try {
    const client = await getAppClient();
    const result = await client.delegates.list({
      limit: 50,
      includeRevoked: get().includeRevoked,
    });
    if (result.ok) {
      set({
        delegates: result.data.delegates,
        nextCursor: result.data.nextCursor,
        isLoading: false,
      });
    } else {
      set({ error: result.error?.message ?? "Failed to fetch", isLoading: false });
    }
  } catch (e) {
    set({ error: String(e), isLoading: false });
  }
},
```

**重要**：`client.delegates.list()` 返回的是当前 delegate（Root）的**直接子级**。由于 Root Delegate 使用 JWT 认证，前端调用时自动以 Root 身份发起请求，返回 depth=1 的 Delegate 列表。

**关于递归获取子孙 Delegate**：
- 初版只展示直接子级（depth=1），这是最简单且符合 API 设计的方案
- 若后续需要展示多层级，可在详情页面中提供"查看子 Delegate"功能，逐级展开

---

## 2.2 实现 Delegate 列表组件

**修改文件**：`apps/server/frontend/src/components/delegates/delegate-list.tsx`

使用 MUI `Table` 组件（不引入 DataGrid 以避免额外依赖）：

### 列定义

| 列 | 字段 | 说明 |
|-----|------|------|
| Name | `name` 或 `delegateId` 截断 | 主要标识 |
| Depth | `depth` | 层级深度 |
| Permissions | `canUpload`, `canManageDepot` | 权限图标/Chip |
| Created | `createdAt` | 格式化时间 |
| Expires | `expiresAt` | 格式化时间 或 "Never" |
| Status | `isRevoked` | 状态标签（Active / Revoked） |
| Actions | — | 详情、撤销按钮 |

### 状态标签样式

- **Active**：绿色 Chip
- **Revoked**：灰色 Chip + 删除线文字
- **Expired**（`expiresAt < Date.now()`）：橙色 Chip

### 权限展示

使用小图标 + Tooltip：
- `canUpload` → Upload 图标（CloudUpload）
- `canManageDepot` → Storage 图标（Storage）
- 有权限时图标正常色，无权限时灰色

---

## 2.3 工具栏

在列表上方添加工具栏：

```tsx
<Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
  <Typography variant="h6">Delegates</Typography>
  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
    <FormControlLabel
      control={
        <Switch
          checked={includeRevoked}
          onChange={(_, v) => setIncludeRevoked(v)}
          size="small"
        />
      }
      label="Show revoked"
    />
    <Button
      variant="contained"
      startIcon={<AddIcon />}
      onClick={onCreateClick}
    >
      Create Delegate
    </Button>
  </Box>
</Box>
```

---

## 2.4 分页加载

使用 "Load More" 按钮模式（而非页码，因为后端是 cursor-based）：

```tsx
{nextCursor && (
  <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
    <Button onClick={fetchMore} disabled={isLoading}>
      Load More
    </Button>
  </Box>
)}
```

`fetchMore` 将 `nextCursor` 传给 API，把返回的新数据追加到现有列表。

---

## 2.5 空状态

当列表为空时显示引导信息：

```tsx
{delegates.length === 0 && !isLoading && (
  <Box sx={{ textAlign: "center", py: 8 }}>
    <KeyIcon sx={{ fontSize: 64, opacity: 0.3, mb: 2 }} />
    <Typography variant="h6" color="text.secondary">
      No delegates yet
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
      Create a delegate to share access with tools or collaborators
    </Typography>
    <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateClick}>
      Create Delegate
    </Button>
  </Box>
)}
```

---

## 2.6 时间格式化

项目没有日期库。使用 `Intl.DateTimeFormat` 或简单的格式化函数：

```tsx
function formatTime(epochMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

function formatRelativeExpiry(epochMs: number): string {
  const diff = epochMs - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d remaining`;
}
```

---

## 2.7 整合到 DelegatesPage

**修改文件**：`apps/server/frontend/src/pages/delegates-page.tsx`

```tsx
export function DelegatesPage() {
  const { delegateId } = useParams();

  // 如果 URL 有 delegateId，显示详情（Step 4）
  // 否则显示列表
  return (
    <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
      {delegateId ? (
        <DelegateDetail delegateId={delegateId} />  {/* Step 4 */}
      ) : (
        <DelegateList />
      )}
    </Box>
  );
}
```

---

## 验收标准

- [ ] 列表正确展示来自后端的 Delegate 数据
- [ ] 每行显示：名称/ID、层级、权限、创建时间、过期时间、状态
- [ ] "Show revoked" 开关可过滤已撤销的 Delegate
- [ ] "Load More" 按钮可加载下一页
- [ ] 空状态有引导信息
- [ ] 加载中显示 loading 指示器
- [ ] 错误时显示错误信息
- [ ] 行可点击，导航到详情页（Step 4 实现具体内容）
- [ ] "Create Delegate" 按钮就位（Step 3 实现对话框）
