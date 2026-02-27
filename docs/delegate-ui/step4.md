# Step 4: Delegate 详情 — 完整信息展示 + Chain 可视化

## 目标

实现 Delegate 详情页面，展示完整的权限配置、委托链、作用域等信息。

---

## 4.1 详情组件

**修改文件**：`apps/server/frontend/src/components/delegates/delegate-detail.tsx`

### 数据获取

通过 `client.delegates.get(delegateId)` 获取 `DelegateDetail`：

```tsx
type DelegateDetailProps = {
  delegateId: string;
};

export function DelegateDetail({ delegateId }: DelegateDetailProps) {
  const [delegate, setDelegate] = useState<DelegateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getAppClient().then((client) =>
      client.delegates.get(delegateId).then((result) => {
        if (result.ok) {
          setDelegate(result.data);
        } else {
          setError(result.error?.message ?? "Not found");
        }
        setLoading(false);
      })
    );
  }, [delegateId]);

  // ...
}
```

### 返回导航

页面顶部提供返回按钮：

```tsx
<Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
  <IconButton onClick={() => navigate("/delegates")}>
    <ArrowBackIcon />
  </IconButton>
  <Typography variant="h5">
    {delegate.name || `Delegate ${delegate.delegateId.slice(0, 12)}...`}
  </Typography>
  {delegate.isRevoked && <Chip label="Revoked" color="default" size="small" />}
</Box>
```

---

## 4.2 信息卡片布局

使用多个 Card 或 Paper 区域分组展示信息：

### 基础信息卡片

```
┌─────────────────────────────────────────┐
│ Basic Info                               │
│                                          │
│ ID:        dlt_XXXXX...          [Copy]  │
│ Name:      CI/CD Pipeline                │
│ Realm:     usr_XXXXX...                  │
│ Depth:     1                             │
│ Created:   Feb 14, 2026, 10:30 AM       │
│ Status:    ● Active                      │
│ Expires:   Mar 14, 2026 (28d remaining) │
└─────────────────────────────────────────┘
```

### 权限卡片

```
┌─────────────────────────────────────────┐
│ Permissions                              │
│                                          │
│ Upload Nodes:    ✅ Allowed              │
│ Manage Depots:   ❌ Not allowed          │
│                                          │
│ Delegated Depots:                        │
│   [dpt_main] [dpt_staging]              │
│                                          │
│ Scope:                                   │
│   Single scope: nod_XXXXX...            │
│   (or) Multi-scope set: XXXXX...        │
│   (or) No scope restriction             │
└─────────────────────────────────────────┘
```

### Delegation Chain 卡片

```
┌────────────────────────────────────────────────────┐
│ Delegation Chain                                    │
│                                                     │
│ [Root]  →  [Current Delegate]                       │
│  dlt_A...    dlt_B... (CI/CD Pipeline)              │
│  depth=0     depth=1                                │
│                                                     │
│ 对于更深层的：                                        │
│ [Root] → [Parent] → [Current] → ...                 │
└────────────────────────────────────────────────────┘
```

### 撤销信息（仅当 isRevoked=true）

```
┌─────────────────────────────────────────┐
│ Revocation                               │
│                                          │
│ Revoked At:  Feb 14, 2026, 11:45 AM     │
│ Revoked By:  dlt_XXXXX...               │
└─────────────────────────────────────────┘
```

---

## 4.3 Delegation Chain 可视化

chain 通常只有 2 个元素（root → child），Stepper 对此场景过重。使用 **Breadcrumbs + Chip** 方案，轻量且直观：

```tsx
import { Breadcrumbs, Chip } from "@mui/material";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { useAuthStore } from "../../stores/auth-store.ts";

function DelegationChain({ chain, currentId }: { chain: string[]; currentId: string }) {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  return (
    <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />}>
      {chain.map((id, index) => {
        const isRoot = index === 0;
        const isCurrent = id === currentId;
        const label = isRoot
          ? `Root (${id.slice(0, 8)}…)`
          : isCurrent
            ? `Current (${id.slice(0, 8)}…)`
            : `${id.slice(0, 8)}…`;

        return (
          <Chip
            key={id}
            label={label}
            size="small"
            variant={isCurrent ? "filled" : "outlined"}
            color={isRoot ? "default" : "primary"}
            sx={{ fontFamily: "monospace", fontSize: "0.8em" }}
            onClick={
              !isCurrent && !isRoot
                ? () => navigate(`/delegates/${id}`)
                : undefined
            }
          />
        );
      })}
    </Breadcrumbs>
  );
}
```

**设计决策**：
- Root 节点标注 "Root"（可通过 `auth-store` 的 `rootDelegateId` 进一步确认）
- 当前节点用 filled variant 高亮
- 中间节点可点击跳转到对应详情页（前提是当前用户有权限查看）
- chain 很长时（depth > 4），Breadcrumbs 自带省略号处理（`maxItems` prop）

---

## 4.4 操作按钮

详情页顶部或底部的操作区域：

```tsx
<Box sx={{ display: "flex", gap: 1, mt: 3 }}>
  {!delegate.isRevoked && (
    <Button
      variant="outlined"
      color="error"
      startIcon={<BlockIcon />}
      onClick={() => setRevokeDialogOpen(true)}
    >
      Revoke
    </Button>
  )}
  <Button
    variant="outlined"
    startIcon={<ContentCopyIcon />}
    onClick={() => {
      navigator.clipboard.writeText(delegate.delegateId);
    }}
  >
    Copy ID
  </Button>
</Box>
```

---

## 4.5 子 Delegate 列表（可选增强）

在详情页底部展示该 Delegate 的子级（如果有）：

```tsx
// 需要注意：只有当前用户的 delegate 有权限查询其后代
// 由于 list API 以调用者身份查询，Root delegate 只能看到自己的直接子级
// 要看 depth=2 的孙 delegate，需要用 depth=1 的 delegate token 调用 API
// 这个功能涉及 token 切换，初版可暂不实现
```

初版在详情页底部展示文字提示："To view this delegate's children, use the CLI or API with this delegate's token."

---

## 4.6 整合到 DelegatesPage

在 `delegates-page.tsx` 中根据 URL 参数切换列表/详情视图：

```tsx
const { delegateId } = useParams();

return delegateId
  ? <DelegateDetail delegateId={delegateId} />
  : <DelegateList />;
```

同时在列表的表格行上添加点击事件：

```tsx
<TableRow
  hover
  sx={{ cursor: "pointer" }}
  onClick={() => navigate(`/delegates/${row.delegateId}`)}
>
```

---

## 验收标准

- [ ] 从列表点击某行可进入详情页，URL 变为 `/delegates/{delegateId}`
- [ ] 详情页正确展示基础信息、权限、状态
- [ ] Delegation Chain 以可视化方式展示
- [ ] 已撤销的 Delegate 显示撤销信息
- [ ] Scope 信息展示（至少展示 raw hash）
- [ ] 有返回列表的按钮
- [ ] 有复制 ID 的功能
- [ ] 有撤销按钮（连接到 Step 5 的撤销对话框）
- [ ] 加载/错误状态正确处理
