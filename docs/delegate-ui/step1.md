# Step 1: 基础骨架 — 路由、页面结构、导航入口

## 目标

搭建 Delegate 管理功能的基础框架：路由注册、空页面、导航入口、Zustand store 骨架。完成后应能从前端导航到 `/delegates` 页面并看到基本的页面框架。

---

## 1.1 新增路由

**修改文件**：`apps/server/frontend/src/app.tsx`

在 `<Route element={<Layout />}>` 内新增：

```tsx
<Route path="/delegates" element={<DelegatesPage />} />
<Route path="/delegates/:delegateId" element={<DelegatesPage />} />
```

第二条路由用于直接通过 URL 访问某个 Delegate 的详情。

---

## 1.2 修改 Layout 添加导航

**修改文件**：`apps/server/frontend/src/components/layout.tsx`

在顶部 AppBar 中添加导航按钮，让用户可以在 Explorer 和 Delegates 之间切换。

参考现有模式，在 `<Typography variant="h6">CASFA</Typography>`（`flexGrow: 1`）和用户菜单之间添加导航区域。

> ⚠️ 当前 AppBar 是**浅色**（背景 `#fafafa`，文字 `#09090b`），导航按钮应适配此风格。
> 全局已设 `Button: textTransform: "none"`，无需重复设置。

```tsx
import { useNavigate, useLocation } from "react-router-dom";
import KeyIcon from "@mui/icons-material/Key";
import FolderIcon from "@mui/icons-material/Folder";

// 在 Toolbar 中，CASFA 标题与用户菜单之间：
<Box sx={{ display: "flex", gap: 0.5, ml: 2 }}>
  <Button
    color="inherit"
    startIcon={<FolderIcon />}
    onClick={() => navigate("/")}
    sx={{
      fontWeight: isExplorerActive ? 600 : 400,
      borderBottom: isExplorerActive ? "2px solid currentColor" : "2px solid transparent",
      borderRadius: 0,
      px: 1.5,
    }}
  >
    Explorer
  </Button>
  <Button
    color="inherit"
    startIcon={<KeyIcon />}
    onClick={() => navigate("/delegates")}
    sx={{
      fontWeight: isDelegatesActive ? 600 : 400,
      borderBottom: isDelegatesActive ? "2px solid currentColor" : "2px solid transparent",
      borderRadius: 0,
      px: 1.5,
    }}
  >
    Delegates
  </Button>
</Box>

// active 状态判断：
const location = useLocation();
const isExplorerActive = location.pathname === "/" || location.pathname.startsWith("/depot");
const isDelegatesActive = location.pathname.startsWith("/delegates");
```

使用 `fontWeight` + `borderBottom` 指示激活态，在浅色 AppBar 上视觉清晰。
保持简洁，不引入侧边栏（与现有单栏布局一致）。

---

## 1.3 创建 Delegates 页面骨架

**新建文件**：`apps/server/frontend/src/pages/delegates-page.tsx`

```tsx
import { Box, Typography } from "@mui/material";

export function DelegatesPage() {
  return (
    <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
      <Typography variant="h5" gutterBottom>
        Delegate Management
      </Typography>
      {/* Step 2 将填充列表组件 */}
    </Box>
  );
}
```

---

## 1.4 创建 Delegate Store

**新建文件**：`apps/server/frontend/src/stores/delegates-store.ts`

用 Zustand 管理 Delegate 列表状态，参考 `auth-store.ts` 的模式：

```tsx
import type { DelegateDetail, DelegateListItem } from "@casfa/protocol";
import { create } from "zustand";

type DelegatesState = {
  // 列表
  delegates: DelegateListItem[];
  isLoading: boolean;
  error: string | null;
  nextCursor?: string;
  includeRevoked: boolean;

  // 选中的 Delegate 详情
  selectedDelegate: DelegateDetail | null;
  detailLoading: boolean;

  // 创建成功后的 Token（一次性展示）
  createdTokens: {
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: number;
    delegateId: string;
  } | null;
};

type DelegatesActions = {
  fetchDelegates: () => Promise<void>;
  fetchMore: () => Promise<void>;
  fetchDetail: (delegateId: string) => Promise<void>;
  revokeDelegate: (delegateId: string) => Promise<boolean>;
  setIncludeRevoked: (value: boolean) => void;
  setCreatedTokens: (tokens: DelegatesState["createdTokens"]) => void;
  clearCreatedTokens: () => void;
  reset: () => void;
};

export type DelegatesStore = DelegatesState & DelegatesActions;
```

实际的 API 调用逻辑在 Step 2 实现。此步骤只搭建 store 的类型定义和初始状态。

---

## 1.5 创建组件目录

**新建目录**：`apps/server/frontend/src/components/delegates/`

准备以下空文件（后续步骤填充）：

```
components/delegates/
├── delegate-list.tsx        # Step 2: 列表组件
├── create-delegate-dialog.tsx  # Step 3: 创建对话框
├── delegate-detail.tsx      # Step 4: 详情面板
├── revoke-dialog.tsx        # Step 5: 撤销确认对话框
└── token-display.tsx        # Step 3: Token 一次性展示
```

---

## 验收标准

- [ ] 访问 `/delegates` 能看到空的管理页面
- [ ] 顶栏有 Explorer / Delegates 导航按钮，点击可切换
- [ ] 当前页面的导航按钮高亮
- [ ] Zustand store 类型定义完成
- [ ] 组件目录结构创建完成
- [ ] `bun run typecheck` 通过
