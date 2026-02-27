# Step 6: UI 完善 — 权限可视化、状态指示、交互优化

## 目标

完善整体 UI 质量：权限可视化增强、Delegate 状态指示器、交互细节打磨、错误处理统一。

---

## 6.1 权限可视化增强

### 列表中的权限展示

将布尔权限转为直观的 Chip 组合：

```tsx
function PermissionChips({ canUpload, canManageDepot }: { canUpload: boolean; canManageDepot: boolean }) {
  return (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
      {canUpload && (
        <Chip
          icon={<CloudUploadIcon />}
          label="Upload"
          size="small"
          color="primary"
          variant="outlined"
        />
      )}
      {canManageDepot && (
        <Chip
          icon={<StorageIcon />}
          label="Depot"
          size="small"
          color="secondary"
          variant="outlined"
        />
      )}
      {!canUpload && !canManageDepot && (
        <Chip label="Read only" size="small" variant="outlined" />
      )}
    </Box>
  );
}
```

### 详情页的权限矩阵

```tsx
function PermissionMatrix({ delegate }: { delegate: DelegateDetail }) {
  const rows = [
    { label: "Upload Nodes", value: delegate.canUpload },
    { label: "Manage Depots", value: delegate.canManageDepot },
  ];

  return (
    <Table size="small">
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell>{row.label}</TableCell>
            <TableCell>
              {row.value ? (
                <Chip label="Allowed" color="success" size="small" />
              ) : (
                <Chip label="Denied" color="default" size="small" />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

### Delegated Depots 展示

```tsx
{delegate.delegatedDepots && delegate.delegatedDepots.length > 0 ? (
  <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
    {delegate.delegatedDepots.map((depotId) => (
      <Chip
        key={depotId}
        label={depotId.slice(0, 16) + "..."}
        size="small"
        variant="outlined"
        icon={<StorageIcon />}
        onClick={() => navigator.clipboard.writeText(depotId)}
        sx={{ cursor: "pointer" }}
      />
    ))}
  </Box>
) : (
  <Typography variant="body2" color="text.secondary">
    {delegate.canManageDepot ? "All depots" : "N/A"}
  </Typography>
)}
```

---

## 6.2 Delegate 状态指示

### 状态计算逻辑

```tsx
type DelegateStatus = "active" | "expired" | "revoked";

function getDelegateStatus(delegate: { isRevoked: boolean; expiresAt?: number }): DelegateStatus {
  if (delegate.isRevoked) return "revoked";
  if (delegate.expiresAt && delegate.expiresAt < Date.now()) return "expired";
  return "active";
}

function StatusChip({ status }: { status: DelegateStatus }) {
  const config = {
    active: { label: "Active", color: "success" as const },
    expired: { label: "Expired", color: "warning" as const },
    revoked: { label: "Revoked", color: "default" as const },
  };
  const { label, color } = config[status];
  return <Chip label={label} color={color} size="small" />;
}
```

### 列表行样式

已撤销或已过期的 Delegate 使用降低透明度：

```tsx
<TableRow
  hover
  sx={{
    cursor: "pointer",
    opacity: status === "active" ? 1 : 0.6,
    textDecoration: status === "revoked" ? "line-through" : "none",
  }}
>
```

---

## 6.3 Scope 信息展示

### 详情页中的 Scope 展示

```tsx
function ScopeDisplay({ delegate }: { delegate: DelegateDetail }) {
  if (!delegate.scopeNodeHash && !delegate.scopeSetNodeId) {
    return (
      <Typography variant="body2" color="text.secondary">
        No scope restriction (full access)
      </Typography>
    );
  }

  if (delegate.scopeNodeHash) {
    return (
      <Box>
        <Typography variant="body2">Single scope</Typography>
        <Chip
          label={delegate.scopeNodeHash.slice(0, 24) + "..."}
          size="small"
          variant="outlined"
          sx={{ fontFamily: "monospace" }}
          onClick={() => navigator.clipboard.writeText(delegate.scopeNodeHash!)}
        />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="body2">Multi-scope set</Typography>
      <Chip
        label={delegate.scopeSetNodeId!.slice(0, 24) + "..."}
        size="small"
        variant="outlined"
        sx={{ fontFamily: "monospace" }}
        onClick={() => navigator.clipboard.writeText(delegate.scopeSetNodeId!)}
      />
    </Box>
  );
}
```

---

## 6.4 通知与反馈

### 统一 Snackbar

在 DelegatesPage 层级提供 Snackbar 状态：

```tsx
const [snackbar, setSnackbar] = useState<{
  message: string;
  severity: "success" | "error" | "info";
} | null>(null);

<Snackbar
  open={!!snackbar}
  autoHideDuration={4000}
  onClose={() => setSnackbar(null)}
  anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
>
  {snackbar && (
    <Alert severity={snackbar.severity} onClose={() => setSnackbar(null)}>
      {snackbar.message}
    </Alert>
  )}
</Snackbar>
```

使用场景：
- 创建成功："Delegate created successfully"
- 撤销成功："Delegate revoked"
- 复制 ID："Delegate ID copied"
- 错误："Failed to fetch delegates"

---

## 6.5 ID 显示与复制

Delegate ID 较长（CB32 编码），统一截断展示 + 复制功能：

```tsx
function DelegateId({ id, full }: { id: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <Tooltip title={copied ? "Copied!" : "Click to copy"}>
      <Typography
        component="code"
        variant="body2"
        sx={{
          fontFamily: "monospace",
          fontSize: "0.85em",
          cursor: "pointer",
          "&:hover": { textDecoration: "underline" },
        }}
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {full ? id : `${id.slice(0, 12)}...`}
      </Typography>
    </Tooltip>
  );
}
```

---

## 6.6 响应式适配

确保列表在不同屏幕宽度下可用：

```tsx
// 在小屏幕上隐藏次要列
<TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>
  {formatTime(row.createdAt)}
</TableCell>
```

---

## 6.7 键盘导航

列表行支持键盘回车进入详情：

```tsx
<TableRow
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === "Enter") navigate(`/delegates/${row.delegateId}`);
  }}
>
```

---

## 6.8 最终检查清单

- [ ] 所有时间正确格式化
- [ ] 长 ID 截断展示 + 点击复制
- [ ] 权限以 Chip/图标直观展示
- [ ] 状态颜色区分（Active 绿/Expired 橙/Revoked 灰）
- [ ] Scope 信息有基础展示
- [ ] Snackbar 统一通知
- [ ] 响应式布局在不同屏宽可用
- [ ] `bun run typecheck` 通过
- [ ] `bun run lint` 通过
- [ ] 手动测试完整流程：列表 → 创建 → Token 展示 → 详情 → 撤销

---

## 验收标准

- [ ] 权限以图标+Chip 形式直观展示
- [ ] Delegate 状态有清晰的颜色区分
- [ ] Scope 信息在详情页展示
- [ ] Delegated Depots 以 Chip 形式展示
- [ ] ID 截断展示 + 点击复制
- [ ] 操作成功/失败有统一的 Snackbar 通知
- [ ] 基本的响应式适配
- [ ] 完整流程端到端可用
- [ ] TypeScript 类型检查通过
- [ ] Lint 检查通过
