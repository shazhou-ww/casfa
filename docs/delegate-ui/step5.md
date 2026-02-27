# Step 5: 撤销 Delegate — 确认对话框 + 级联影响提示

## 目标

实现撤销 Delegate 的完整交互：确认对话框、级联影响提示、执行撤销、列表刷新。

---

## 5.1 撤销确认对话框

**修改文件**：`apps/server/frontend/src/components/delegates/revoke-dialog.tsx`

### Props

```tsx
type RevokeDelegateDialogProps = {
  open: boolean;
  onClose: () => void;
  delegate: {
    delegateId: string;
    name?: string;
    depth: number;
  };
  onRevoked: () => void;
};
```

### 对话框结构

```
┌─────────────────────────────────────────┐
│ Revoke Delegate                          │
│                                          │
│ ⚠️ Warning                               │
│ Revoking this delegate will permanently  │
│ invalidate it and all its descendants.   │
│ This action cannot be undone.            │
│                                          │
│ Delegate: CI/CD Pipeline                 │
│ ID: dlt_XXXXX...                         │
│                                          │
│ ⚠️ Cascade Impact                        │
│ This will also revoke N child delegates. │
│ (or: No child delegates will be affected)│
│                                          │
│           [Cancel]  [Revoke]             │
└─────────────────────────────────────────┘
```

---

## 5.2 级联影响检测

撤销前查询该 Delegate 的子级数量，提示用户影响范围。

**技术限制**：当前 API 只能以调用者身份列出直接子级，从 Root Delegate 发起的 `list` 只返回 depth=1 的子级。要获取某个 Delegate 的子级，理论上需要用该 Delegate 的 token。

**可行方案**：
- 如果 delegate 是 depth=1（Root 的直接子级），可以通过 `client.delegates.get(delegateId)` 获取其信息，但无法直接获取其子级数量
- **简化处理**：在撤销确认对话框中使用通用警告文案，不精确显示受影响数量

```tsx
<Alert severity="warning" sx={{ mb: 2 }}>
  <AlertTitle>Warning</AlertTitle>
  Revoking this delegate will <strong>permanently invalidate</strong> it along with
  all its descendant delegates. This action cannot be undone.
</Alert>
```

如果后续需要精确数量，可以考虑添加后端 API（如 `GET /delegates/:id/descendants/count`）。

---

## 5.3 执行撤销

```tsx
const handleRevoke = async () => {
  setRevoking(true);
  try {
    const client = await getAppClient();
    const result = await client.delegates.revoke(delegate.delegateId);
    if (result.ok) {
      onRevoked();
      onClose();
    } else {
      setError(result.error?.message ?? "Failed to revoke");
    }
  } catch (e) {
    setError(String(e));
  } finally {
    setRevoking(false);
  }
};
```

---

## 5.4 从列表页撤销

在列表的操作列添加撤销按钮：

```tsx
// delegate-list.tsx 中的每行操作
<TableCell align="right">
  {!row.isRevoked && (
    <Tooltip title="Revoke">
      <IconButton
        size="small"
        color="error"
        onClick={(e) => {
          e.stopPropagation(); // 阻止行点击导航
          setRevokeTarget(row);
        }}
      >
        <BlockIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )}
  <Tooltip title="View details">
    <IconButton
      size="small"
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/delegates/${row.delegateId}`);
      }}
    >
      <InfoOutlinedIcon fontSize="small" />
    </IconButton>
  </Tooltip>
</TableCell>
```

---

## 5.5 从详情页撤销

详情页的撤销按钮打开同样的对话框，撤销成功后：
- 刷新详情数据（显示 revoked 状态）
- 或返回列表（`navigate("/delegates")`）

---

## 5.6 撤销成功后的 UI 更新

```tsx
const handleRevoked = () => {
  // 方案 A：刷新列表
  fetchDelegates();

  // 方案 B：乐观更新 — 直接在本地标记为 revoked
  setDelegates((prev) =>
    prev.map((d) =>
      d.delegateId === revokeTarget.delegateId
        ? { ...d, isRevoked: true }
        : d
    )
  );

  // 可选：显示成功 Snackbar
  setSnackbar("Delegate revoked successfully");
};
```

推荐方案 A（重新获取），简单可靠。

---

## 5.7 批量撤销（可选增强）

如果列表支持多选（checkbox），可以提供批量撤销功能：

```tsx
// 批量撤销 — 串行调用
const handleBatchRevoke = async (delegateIds: string[]) => {
  const client = await getAppClient();
  const results = await Promise.allSettled(
    delegateIds.map((id) => client.delegates.revoke(id))
  );
  // 统计成功/失败数量
  const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
  const failed = delegateIds.length - succeeded;
  // 刷新列表并提示
};
```

**初版可暂不实现批量撤销**，聚焦单个撤销。后续可根据需要添加列表多选 + 批量操作工具栏。

---

## 验收标准

- [ ] 列表行操作列有撤销按钮（仅活跃的 Delegate 显示）
- [ ] 详情页有撤销按钮
- [ ] 点击撤销后弹出确认对话框
- [ ] 对话框展示 Delegate 信息和级联影响警告
- [ ] 确认后调用 API 执行撤销
- [ ] 撤销成功后列表刷新
- [ ] 撤销中显示 loading 状态
- [ ] 错误时显示错误信息
- [ ] 已撤销的 Delegate 不再显示撤销按钮
