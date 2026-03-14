# Artist Flux Image-to-Image Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `artist` MCP 中新增基于 Casfa branch URL 的 Flux image-to-image 能力，并按两阶段引入受限临时访问机制，降低外放 URL 风险。

**Architecture:** 阶段 1 在 `cells/artist` 新增独立工具 `flux_image_edit`，调用 BFL `flux-kontext-pro` 并复用既有 branch 写回链路。阶段 2 在 `cells/drive` 增加文件级只读短期票据，中间件按方法/路径/过期时间校验后再转发，`artist` 切换为优先使用该受限 URL。全过程遵循 TDD，小步提交。

**Tech Stack:** Bun、TypeScript、Hono、Zod、@casfa/cell-mcp、BFL HTTP API、Casfa Drive branch URL auth。

---

### Task 1: 准备 Artist 的测试骨架

**Files:**
- Create: `cells/artist/backend/__tests__/flux-image-edit.test.ts`
- Modify: `cells/artist/cell.yaml`
- Test: `cells/artist/backend/__tests__/flux-image-edit.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { fluxImageEditInputSchema } from "../index";

describe("fluxImageEditInputSchema", () => {
  it("rejects traversal path", () => {
    const parsed = fluxImageEditInputSchema.safeParse({
      casfaBranchUrl: "https://drive.example.com/branch/bid/ver",
      inputImagePath: "../secret.png",
      prompt: "edit it",
    });
    expect(parsed.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit`  
Expected: FAIL，提示 `fluxImageEditInputSchema` 未定义或校验未实现。

**Step 3: Write minimal implementation**

```ts
export const fluxImageEditInputSchema = z.object({
  casfaBranchUrl: z.string().url(),
  inputImagePath: z.string(),
  prompt: z.string(),
});
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit`  
Expected: PASS（仅该最小用例通过，后续任务继续补齐）。

**Step 5: Commit**

```bash
git add cells/artist/backend/__tests__/flux-image-edit.test.ts cells/artist/backend/index.ts cells/artist/cell.yaml
git commit -m "test: scaffold artist img2img schema tests"
```

---

### Task 2: 在 Artist 中实现 `flux_image_edit` 输入校验与路径规范化

**Files:**
- Create: `cells/artist/backend/path-utils.ts`
- Modify: `cells/artist/backend/index.ts`
- Test: `cells/artist/backend/__tests__/flux-image-edit.test.ts`

**Step 1: Write the failing test**

```ts
it("accepts normalized safe path", () => {
  const parsed = fluxImageEditInputSchema.parse({
    casfaBranchUrl: "https://drive.example.com/branch/bid/ver",
    inputImagePath: "inputs/ref image.png",
    prompt: "change background to blue",
  });
  expect(parsed.inputImagePath).toBe("inputs/ref image.png");
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit`  
Expected: FAIL（路径规范化/拒绝规则未实现）。

**Step 3: Write minimal implementation**

```ts
export function normalizeInputImagePath(raw: string): string {
  const p = raw.trim().replace(/^\/+/, "");
  if (!p || p.includes("..") || p.includes("//")) throw new Error("invalid inputImagePath");
  return p;
}
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit`  
Expected: PASS（schema + normalize 相关用例通过）。

**Step 5: Commit**

```bash
git add cells/artist/backend/path-utils.ts cells/artist/backend/index.ts cells/artist/backend/__tests__/flux-image-edit.test.ts
git commit -m "feat: validate and normalize img2img input path"
```

---

### Task 3: 扩展 BFL client 支持 Kontext（image-to-image）

**Files:**
- Modify: `cells/artist/backend/bfl.ts`
- Test: `cells/artist/backend/__tests__/flux-image-edit.test.ts`

**Step 1: Write the failing test**

```ts
it("submits kontext request with input_image", async () => {
  // mock fetch: first call submit, second call poll ready, third call download bytes
  // assert submit body includes input_image and prompt
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit`  
Expected: FAIL（BFL client 尚无 kontext 方法）。

**Step 3: Write minimal implementation**

```ts
async generateImageEdit(params: {
  prompt: string;
  input_image: string;
  seed?: number;
  safety_tolerance?: number;
  output_format?: "jpeg" | "png";
  aspect_ratio?: string;
}): Promise<Uint8Array> {
  return submitPollAndDownload("/v1/flux-kontext-pro", params);
}
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit`  
Expected: PASS（kontext 提交字段断言通过）。

**Step 5: Commit**

```bash
git add cells/artist/backend/bfl.ts cells/artist/backend/__tests__/flux-image-edit.test.ts
git commit -m "feat: add bfl kontext image-edit client method"
```

---

### Task 4: 注册 MCP 工具 `flux_image_edit` 并复用 branch 写回流程

**Files:**
- Modify: `cells/artist/backend/index.ts`
- Modify: `cells/artist/backend/prompts/flux-image-gen.md`
- Test: `cells/artist/backend/__tests__/flux-image-edit.test.ts`

**Step 1: Write the failing test**

```ts
it("returns success payload when flux_image_edit completes", async () => {
  // mock bfl.generateImageEdit + casfa.setRootToFile + casfa.completeBranch
  // expect success true and completed/key fields
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit`  
Expected: FAIL（工具未注册或 handler 未实现）。

**Step 3: Write minimal implementation**

```ts
cellMcp.registerTool("flux_image_edit", { inputSchema: fluxImageEditInputSchema, ... }, async (args) => {
  const inputUrl = `${args.casfaBranchUrl}/api/realm/me/files/${encodeURIComponent(normalizeInputImagePath(args.inputImagePath))}`;
  const imageBytes = await bfl.generateImageEdit({ prompt: args.prompt, input_image: inputUrl, ... });
  const setRootResult = await casfa.setRootToFile(imageBytes, contentTypeForFormat(args.output_format ?? "png"));
  const completeResult = await casfa.completeBranch();
  return okResult(completeResult.completed, setRootResult.key);
});
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit`  
Expected: PASS（注册与返回结构符合预期）。

**Step 5: Commit**

```bash
git add cells/artist/backend/index.ts cells/artist/backend/prompts/flux-image-gen.md cells/artist/backend/__tests__/flux-image-edit.test.ts
git commit -m "feat: add flux_image_edit mcp tool using branch image url"
```

---

### Task 5: 增加 Artist 回归测试（text-to-image 不受影响）

**Files:**
- Modify: `cells/artist/backend/__tests__/flux-image-edit.test.ts`
- Modify: `cells/artist/backend/index.ts`
- Test: `cells/artist/backend/__tests__/flux-image-edit.test.ts`

**Step 1: Write the failing test**

```ts
it("keeps flux_image text-to-image path unchanged", async () => {
  // call old handleFluxImage args
  // assert bfl.generateImage called, not generateImageEdit
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit`  
Expected: FAIL（当前 mock/断言未覆盖或行为被改动）。

**Step 3: Write minimal implementation**

```ts
// keep existing flux_image code path untouched
// only add new tool, do not change old tool's modelPath/body
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit`  
Expected: PASS（旧工具回归通过）。

**Step 5: Commit**

```bash
git add cells/artist/backend/__tests__/flux-image-edit.test.ts cells/artist/backend/index.ts
git commit -m "test: ensure flux_image text2img path remains stable"
```

---

### Task 6: 设计并实现 Drive 文件级受限临时访问票据（阶段 2）

**Files:**
- Create: `cells/drive/backend/types/restricted-access.ts`
- Create: `cells/drive/backend/services/restricted-access.ts`
- Modify: `cells/drive/backend/middleware/branch-url-auth.ts`
- Modify: `cells/drive/backend/controllers/branches.ts`
- Modify: `cells/drive/backend/db/branch-store.ts` (若需持久化)
- Modify: `cells/drive/backend/db/dynamo-branch-store.ts` (若需持久化)
- Test: `cells/drive/backend/__tests__/middleware/branch-url-auth.test.ts` (new)
- Test: `cells/drive/tests/branches.test.ts`

**Step 1: Write the failing test**

```ts
it("allows only GET on exact file path for restricted token", async () => {
  // issue restricted token for /api/realm/me/files/inputs/ref.png
  // GET exact path => 200
  // GET sibling path => 401/403
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:e2e`  
Expected: FAIL（restricted token 功能未实现）。

**Step 3: Write minimal implementation**

```ts
type RestrictedAccess = {
  branchId: string;
  path: string;
  method: "GET";
  expiresAt: number;
  singleUse?: boolean;
};
```

**Step 4: Run test to verify it passes**

Run: `bun run test:e2e`  
Expected: PASS（仅匹配 path/method/TTL 的请求通过）。

**Step 5: Commit**

```bash
git add cells/drive/backend/types/restricted-access.ts cells/drive/backend/services/restricted-access.ts cells/drive/backend/middleware/branch-url-auth.ts cells/drive/backend/controllers/branches.ts cells/drive/backend/__tests__/middleware/branch-url-auth.test.ts cells/drive/tests/branches.test.ts
git commit -m "feat: add restricted file-read branch access tokens"
```

---

### Task 7: Artist 切换优先使用受限票据 URL（保留回退）

**Files:**
- Modify: `cells/artist/backend/casfa-branch.ts`
- Modify: `cells/artist/backend/index.ts`
- Test: `cells/artist/backend/__tests__/flux-image-edit.test.ts`

**Step 1: Write the failing test**

```ts
it("prefers restricted file URL when available", async () => {
  // mock casfa client returns restrictedFileUrl
  // assert bfl.generateImageEdit called with restricted URL
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit`  
Expected: FAIL（尚未接入 restricted URL）。

**Step 3: Write minimal implementation**

```ts
const inputImageUrl = restrictedFileUrl ?? legacyBranchFileUrl;
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit`  
Expected: PASS（优先级与回退逻辑正确）。

**Step 5: Commit**

```bash
git add cells/artist/backend/casfa-branch.ts cells/artist/backend/index.ts cells/artist/backend/__tests__/flux-image-edit.test.ts
git commit -m "feat: use restricted file url for flux_image_edit with fallback"
```

---

### Task 8: 文档与联调验收

**Files:**
- Modify: `cells/artist/README.md`
- Modify: `cells/artist/backend/prompts/flux-image-gen.md`
- Modify: `docs/plans/2026-03-14-artist-flux-img2img-branch-url-design.md` (状态更新)
- Test: `cells/artist` + `cells/drive` 关键用例

**Step 1: Write the failing test**

```ts
// 文档任务无单元测试；改为验收脚本检查：
// 1) branch_create 拿 URL
// 2) 上传 ref 图
// 3) 调 flux_image_edit
// 4) complete 后在 parent 路径可读到图像
```

**Step 2: Run validation commands**

Run:
- `bun run test:unit`（在 `cells/artist`）
- `bun run test:e2e`（在 `cells/drive`）

Expected:
- PASS（无新增 lint/type error，回归通过）。

**Step 3: Write minimal implementation**

```md
在 README 增加 flux_image_edit 参数说明、输入图路径约束、错误码示例与安全注意事项。
```

**Step 4: Re-run validation**

Run:
- `bun run test:unit`
- `bun run test:e2e`

Expected:
- PASS（最终可发布状态）。

**Step 5: Commit**

```bash
git add cells/artist/README.md cells/artist/backend/prompts/flux-image-gen.md docs/plans/2026-03-14-artist-flux-img2img-branch-url-design.md
git commit -m "docs: document flux image-to-image and restricted access flow"
```

---

## 执行前检查清单

- 确认 `inputImagePath` 前缀策略（建议仅允许 `inputs/`）。
- 确认受限票据默认 TTL（建议 120 秒）。
- 确认 `singleUse` 默认值（建议 `true`）。

---

## 回滚策略

- 若阶段 1 上线后发现稳定性问题：快速禁用 `flux_image_edit` 注册，保留 `flux_image`。
- 若阶段 2 出现兼容问题：保留受限票据逻辑但临时回退到 legacy `accessUrlPrefix`。

