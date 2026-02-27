# Step 3: 创建 Delegate — 表单对话框 + Token 一次性展示

## 目标

实现创建 Delegate 的完整交互流程：表单填写 → 提交 → Token 一次性展示。

---

## 3.1 创建对话框

**修改文件**：`apps/server/frontend/src/components/delegates/create-delegate-dialog.tsx`

参考 `@casfa/explorer` 中 `CreateFolderDialog` 的模式（Dialog + 表单 + 校验 + 提交）。

### 对话框结构

```
CreateDelegateDialog
├── DialogTitle: "Create Delegate"
├── DialogContent
│   ├── TextField: name（可选，1-64 字符）
│   ├── 权限区域
│   │   ├── Switch: canUpload
│   │   └── Switch: canManageDepot
│   ├── Depot 选择器（条件展示：仅当 canManageDepot=true）
│   │   └── Autocomplete（多选）: delegatedDepots
│   ├── Scope 选择
│   │   └── 初版简化：仅提供 "Inherit all scopes" 选项
│   ├── Token TTL 选择
│   │   └── Select: 预设选项（1h / 6h / 24h / 7d / 30d / Custom）
│   └── Delegate 有效期
│       └── TextField(type=number) + Select(单位：hours/days/months) 或 "No expiration"
└── DialogActions
    ├── Button: Cancel
    └── Button: Create（loading 状态）
```

### Props

```tsx
type CreateDelegateDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (response: CreateDelegateResponse) => void;
};
```

---

## 3.2 表单字段详解

### name
```tsx
<TextField
  label="Name"
  placeholder="e.g. CI/CD Pipeline, MCP Tool, Code Review Bot"
  value={name}
  onChange={(e) => setName(e.target.value)}
  inputProps={{ maxLength: 64 }}
  helperText="Optional. A human-readable label for this delegate."
  fullWidth
/>
```

### canUpload / canManageDepot
```tsx
<FormGroup>
  <FormControlLabel
    control={<Switch checked={canUpload} onChange={(_, v) => setCanUpload(v)} />}
    label="Can upload nodes"
  />
  <FormControlLabel
    control={<Switch checked={canManageDepot} onChange={(_, v) => setCanManageDepot(v)} />}
    label="Can manage depots"
  />
</FormGroup>
```

**注意**：这两个开关的初始值都是 `false`（对应 schema 默认值）。无需校验是否超过 parent 权限 —— Root Delegate 两项都是 `true`，所以从 Root 创建的 child 任意组合都合法。

### delegatedDepots

仅当 `canManageDepot=true` 时展示。需要先获取 Depot 列表：

```tsx
// 获取 Depot 列表
useEffect(() => {
  if (!open) return;
  getAppClient().then((client) =>
    client.depots.list({ limit: 100 }).then((result) => {
      if (result.ok) setDepots(result.data.depots);
    })
  );
}, [open]);

// Autocomplete 多选
<Autocomplete
  multiple
  options={depots}
  getOptionLabel={(d) => d.name || d.depotId}
  value={selectedDepots}
  onChange={(_, v) => setSelectedDepots(v)}
  renderInput={(params) => <TextField {...params} label="Delegated Depots" />}
  renderTags={(value, getTagProps) =>
    value.map((d, i) => (
      <Chip label={d.name || d.depotId.slice(0, 12)} {...getTagProps({ index: i })} />
    ))
  }
/>
```

### Scope

初版简化处理：

```tsx
<Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
  Scope: Inherits all parent scopes
</Typography>
```

创建时传 `scope: ["."]`（继承全部）。高级 scope 选择器留到后续优化。

### Token TTL

```tsx
const TTL_OPTIONS = [
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
  { label: "30 days", value: 2592000 },
];

<TextField
  select
  label="Access Token TTL"
  value={tokenTtl}
  onChange={(e) => setTokenTtl(Number(e.target.value))}
  fullWidth
>
  {TTL_OPTIONS.map((opt) => (
    <MenuItem key={opt.value} value={opt.value}>
      {opt.label}
    </MenuItem>
  ))}
</TextField>
```

### Delegate 有效期

```tsx
const [hasExpiry, setHasExpiry] = useState(false);
const [expiryValue, setExpiryValue] = useState(24);
const [expiryUnit, setExpiryUnit] = useState<"hours" | "days">("hours");

<FormControlLabel
  control={<Switch checked={hasExpiry} onChange={(_, v) => setHasExpiry(v)} />}
  label="Set expiration"
/>
{hasExpiry && (
  <Box sx={{ display: "flex", gap: 1 }}>
    <TextField
      type="number"
      value={expiryValue}
      onChange={(e) => setExpiryValue(Number(e.target.value))}
      inputProps={{ min: 1 }}
      sx={{ width: 120 }}
    />
    <TextField
      select
      value={expiryUnit}
      onChange={(e) => setExpiryUnit(e.target.value)}
      sx={{ width: 120 }}
    >
      <MenuItem value="hours">Hours</MenuItem>
      <MenuItem value="days">Days</MenuItem>
    </TextField>
  </Box>
)}
```

### Token TTL 与 Delegate 有效期的合理性校验

`tokenTtlSeconds`（AT 有效期）和 `expiresIn`（Delegate 有效期）是独立字段，但当 Delegate 有效期短于 Token TTL 时，Token 的长 TTL 没有实际意义（Delegate 先过期）。

**UI 策略**：当 `hasExpiry=true` 时，计算 `expiresInSeconds`，若 `tokenTtl > expiresInSeconds`，在 Token TTL 下方显示提示：

```tsx
{hasExpiry && tokenTtl > expiresInSeconds && (
  <Typography variant="caption" color="warning.main">
    Token TTL exceeds delegate lifetime — token will be invalidated when the delegate expires.
  </Typography>
)}
```

这是**纯提示**，不阻止提交（后端不强制此约束）。

---

## 3.3 表单提交

```tsx
const handleSubmit = async () => {
  setSubmitting(true);
  try {
    const client = await getAppClient();
    const expiresIn = hasExpiry
      ? expiryValue * (expiryUnit === "days" ? 86400 : 3600)
      : undefined;

    const result = await client.delegates.create({
      name: name.trim() || undefined,
      canUpload,
      canManageDepot,
      delegatedDepots: canManageDepot && selectedDepots.length > 0
        ? selectedDepots.map((d) => d.depotId)
        : undefined,
      scope: ["."], // 初版：继承全部
      tokenTtlSeconds: tokenTtl,
      expiresIn,
    });

    if (result.ok) {
      onCreated(result.data);
    } else {
      setError(result.error?.message ?? "Failed to create delegate");
    }
  } catch (e) {
    setError(String(e));
  } finally {
    setSubmitting(false);
  }
};
```

---

## 3.4 Token 一次性展示组件

**修改文件**：`apps/server/frontend/src/components/delegates/token-display.tsx`

创建成功后，对话框切换为 Token 展示模式（或打开新的 Dialog）。

### 设计要点

- **醒目警告**：使用 MUI `Alert` severity="warning"
- **Token 展示**：monospace 字体，每个 Token 一行 + 复制按钮
- **Delegate 信息摘要**：ID、名称、权限
- **关闭确认**：关闭时二次确认 "Have you saved the tokens?"

```tsx
type TokenDisplayProps = {
  open: boolean;
  onClose: () => void;
  data: {
    delegateId: string;
    name?: string;
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: number;
  };
};

export function TokenDisplay({ open, onClose, data }: TokenDisplayProps) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [rtCopied, setRtCopied] = useState(false);
  const [atCopied, setAtCopied] = useState(false);

  const handleClose = () => {
    if (!confirmClose) {
      setConfirmClose(true); // 第一次点关闭，显示确认
      return;
    }
    onClose(); // 第二次确认后关闭
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Delegate Created Successfully</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Save these tokens now. They cannot be retrieved again after closing this dialog.
        </Alert>

        <Typography variant="subtitle2" gutterBottom>Refresh Token</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <TextField
            value={data.refreshToken}
            fullWidth
            size="small"
            slotProps={{ input: { readOnly: true, sx: { fontFamily: "monospace", fontSize: "0.85em" } } }}
          />
          <IconButton onClick={() => { navigator.clipboard.writeText(data.refreshToken); setRtCopied(true); }}>
            {rtCopied ? <CheckIcon color="success" /> : <ContentCopyIcon />}
          </IconButton>
        </Box>

        <Typography variant="subtitle2" gutterBottom>Access Token</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <TextField
            value={data.accessToken}
            fullWidth
            size="small"
            slotProps={{ input: { readOnly: true, sx: { fontFamily: "monospace", fontSize: "0.85em" } } }}
          />
          <IconButton onClick={() => { navigator.clipboard.writeText(data.accessToken); setAtCopied(true); }}>
            {atCopied ? <CheckIcon color="success" /> : <ContentCopyIcon />}
          </IconButton>
        </Box>

        <Typography variant="body2" color="text.secondary">
          AT expires: {formatTime(data.accessTokenExpiresAt)}
        </Typography>

        {confirmClose && (
          <Alert severity="error" sx={{ mt: 2 }}>
            Are you sure? Click close again to confirm you have saved the tokens.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} color={confirmClose ? "error" : "primary"}>
          {confirmClose ? "Confirm Close" : "Close"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

---

## 3.5 整合到 DelegatesPage

在 `delegates-page.tsx` 中管理 Dialog 开关：

```tsx
const [createOpen, setCreateOpen] = useState(false);
const [tokenData, setTokenData] = useState<...>(null);

const handleCreated = (response: CreateDelegateResponse) => {
  setCreateOpen(false);
  setTokenData({
    delegateId: response.delegate.delegateId,
    name: response.delegate.name,
    refreshToken: response.refreshToken,
    accessToken: response.accessToken,
    accessTokenExpiresAt: response.accessTokenExpiresAt,
  });
  // 刷新列表
  fetchDelegates();
};

// ...
<CreateDelegateDialog
  open={createOpen}
  onClose={() => setCreateOpen(false)}
  onCreated={handleCreated}
/>
{tokenData && (
  <TokenDisplay
    open={!!tokenData}
    onClose={() => setTokenData(null)}
    data={tokenData}
  />
)}
```

---

## 验收标准

- [ ] 点击 "Create Delegate" 打开创建对话框
- [ ] 表单字段完整：name、canUpload、canManageDepot、Depot 选择器、Token TTL、有效期
- [ ] Depot 选择器仅在 canManageDepot=true 时显示
- [ ] 提交后成功创建 Delegate
- [ ] 创建成功后显示 Token 展示对话框
- [ ] Token 可一键复制，且有警告提示
- [ ] 关闭 Token 对话框需要二次确认
- [ ] 创建成功后列表自动刷新
- [ ] 提交中显示 loading 状态
- [ ] 错误时显示错误信息
