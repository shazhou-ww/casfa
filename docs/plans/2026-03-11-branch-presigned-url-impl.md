# Branch 访问 URL（Presigned-style）实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 支持通过 path 前缀 `/branch/:branchId/:verification` 访问 branch API，verification 为 128 位 Crockford Base32，服务端存储并校验；branch TTL 上限 10 分钟；创建 branch 时返回 `accessUrlPrefix` 供调用方使用。

**Architecture:** 在 Branch 类型与存储中增加可选 `accessVerification`；创建 branch 时生成 16 字节随机并编码为 Crockford Base32 写入；在 app 最前挂载路由，匹配 `/branch/:branchId/:verification/*` 时查 branch、校验 verification 与过期，注入 worker auth 并重写 path 为 `/*`；revoke/complete 时 removeBranch 自然清除 verification。maxBranchTtlMs 默认 600_000。

**Tech Stack:** Hono, server-next backend (TypeScript/Bun), DynamoDB (METADATA 项增加字段), Memory store 同构。

**Design ref:** [2026-03-11-branch-presigned-url-design.md](./2026-03-11-branch-presigned-url-design.md)

---

## Task 1: Crockford Base32 工具与单元测试

**Files:**
- Create: `apps/server-next/backend/utils/crockford-base32.ts`
- Create: `apps/server-next/backend/utils/__tests__/crockford-base32.test.ts`

**Step 1: 写失败的测试**

在 `apps/server-next/backend/utils/__tests__/crockford-base32.test.ts` 中：

```ts
import { describe, it, expect } from "bun:test";
import { encodeCrockfordBase32, decodeCrockfordBase32 } from "../crockford-base32.ts";

describe("crockford-base32", () => {
  it("encodes 16 bytes to 26 characters", () => {
    const bytes = new Uint8Array(16);
    bytes[15] = 1;
    const s = encodeCrockfordBase32(bytes);
    expect(s).toHaveLength(26);
    expect(s).toMatch(/^[0-9A-Z]+$/);
    expect(s).not.toMatch(/[ILOU]/);
  });

  it("round-trip preserves 128 bits", () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const s = encodeCrockfordBase32(bytes);
    const decoded = decodeCrockfordBase32(s);
    expect(decoded).not.toBeNull();
    expect(new Uint8Array(decoded!)).toEqual(bytes);
  });

  it("decode is case-insensitive", () => {
    const bytes = new Uint8Array(16);
    bytes[0] = 0xff;
    const s = encodeCrockfordBase32(bytes);
    const lower = s.toLowerCase();
    expect(decodeCrockfordBase32(lower)).toEqual(decodeCrockfordBase32(s));
  });

  it("decode returns null for invalid length or chars", () => {
    expect(decodeCrockfordBase32("abc")).toBeNull();
    expect(decodeCrockfordBase32("0O0")).toBeNull(); // O not in alphabet
  });
});
```

**Step 2: 运行测试确认失败**

Run: `cd apps/server-next && bun test backend/utils/__tests__/crockford-base32.test.ts`
Expected: FAIL (encodeCrockfordBase32 / decodeCrockfordBase32 not defined or module not found)

**Step 3: 实现 Crockford Base32**

Create `apps/server-next/backend/utils/crockford-base32.ts`:

- Alphabet: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (Crockford: no I,L,O,U).
- `encodeCrockfordBase32(bytes: Uint8Array): string`: 仅支持 16 字节输入；每 5 bits 对应一个字符，128 bits → 26 字符（padding 到 130 bits 即 26*5）；大端顺序。
- `decodeCrockfordBase32(s: string): Uint8Array | null`: 仅支持 26 字符；忽略大小写（统一转大写）；若含非法字符或长度非 26 返回 null；输出 16 字节。

参考：Crockford Base32 将每 5 bits 映射到一个字符；128 bits 需 26 字符（130 bits，高 2 位补 0）。

**Step 4: 运行测试确认通过**

Run: `cd apps/server-next && bun test backend/utils/__tests__/crockford-base32.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server-next/backend/utils/crockford-base32.ts apps/server-next/backend/utils/__tests__/crockford-base32.test.ts
git commit -m "feat(server-next): add Crockford Base32 encode/decode for 128-bit verification"
```

---

## Task 2: Branch 类型与 Memory 存储支持 accessVerification

**Files:**
- Modify: `apps/server-next/backend/types/branch.ts`
- Modify: `apps/server-next/backend/db/branch-store.ts` (memory impl)

**Step 1: 扩展 Branch 类型**

在 `apps/server-next/backend/types/branch.ts` 的 `Branch` 中增加可选字段：

```ts
export type Branch = {
  branchId: string;
  realmId: string;
  parentId: string | null;
  mountPath: string;
  expiresAt: number;
  /** When set, path-based access /branch/:branchId/:value is allowed until expiresAt. */
  accessVerification?: { value: string; expiresAt: number };
};
```

**Step 2: Memory store 读写 accessVerification**

在 `apps/server-next/backend/db/branch-store.ts` 的 memory 实现中，`insertBranch` 已存整个 branch 对象，无需改；`getBranch` 返回的 branch 已包含任意字段。确保 TypeScript 编译通过。

Run: `cd apps/server-next && bun run build` (或 `tsc --noEmit` 若有)
Expected: 通过（若其他地方构造 Branch 未带 accessVerification 则兼容，可选字段）。

**Step 3: Commit**

```bash
git add apps/server-next/backend/types/branch.ts
git commit -m "feat(server-next): add accessVerification to Branch type"
```

---

## Task 3: DynamoDB 存储 accessVerification

**Files:**
- Modify: `apps/server-next/backend/db/dynamo-branch-store.ts`

**Step 1: itemToBranch 读取 accessVerification**

在 `itemToBranch` 中：若存在 `item.accessVerificationValue` (string) 且 `item.accessVerificationExpiresAt` (number)，则 `accessVerification: { value: item.accessVerificationValue, expiresAt: item.accessVerificationExpiresAt }`，否则不设。

**Step 2: branchToItem 写入 accessVerification**

在 `branchToItem` 中：若 `branch.accessVerification` 存在，则 item 增加 `accessVerificationValue: branch.accessVerification.value`、`accessVerificationExpiresAt: branch.accessVerification.expiresAt`。

**Step 3: 运行现有测试**

Run: `cd apps/server-next && bun test backend/db/`
Expected: 全部通过（若有）；否则修复兼容。

**Step 4: Commit**

```bash
git add apps/server-next/backend/db/dynamo-branch-store.ts
git commit -m "feat(server-next): persist accessVerification in DynamoDB branch METADATA"
```

---

## Task 4: 创建 branch 时生成 verification 并返回 accessUrlPrefix

**Files:**
- Modify: `apps/server-next/backend/controllers/branches.ts`
- Modify: `apps/server-next/backend/config.ts`（maxBranchTtlMs 默认 600_000）

**Step 1: 默认 maxBranchTtlMs 改为 10 分钟**

在 `apps/server-next/backend/config.ts` 的 `loadConfig` 中，`maxBranchTtlMs` 当前为 `process.env.MAX_BRANCH_TTL_MS ? Number(...) : undefined`。改为未设置时默认 `600_000`（10 分钟）：

```ts
maxBranchTtlMs: process.env.MAX_BRANCH_TTL_MS
  ? Number(process.env.MAX_BRANCH_TTL_MS)
  : 600_000,
```

**Step 2: branches 控制器 create 中生成 verification**

在 `apps/server-next/backend/controllers/branches.ts` 中：

- 引入 `encodeCrockfordBase32` from `../utils/crockford-base32.ts`。
- 在每次 `insertBranch` 之前（两处：realm root 下创建、parent branch 下创建），生成 16 字节随机：`const verificationBytes = new Uint8Array(16); crypto.getRandomValues(verificationBytes);`，然后 `const verification = encodeCrockfordBase32(verificationBytes)`。
- 构造的 branch 对象增加 `accessVerification: { value: verification, expiresAt }`（expiresAt 与 branch 的 expiresAt 一致）。
- 返回的 JSON 中增加 `accessUrlPrefix`：当 `deps.config.baseUrl` 存在且非空时，`accessUrlPrefix: `${deps.config.baseUrl.replace(/\/$/, "")}/branch/${branchId}/${verification}``；否则不返回该字段。

**Step 3: 运行 branches 相关测试**

Run: `cd apps/server-next && bun test backend/controllers/ tests/branches.test.ts`
Expected: 通过；且创建 branch 的响应中包含 `accessUrlPrefix`（在 baseUrl 配置时）。

**Step 4: Commit**

```bash
git add apps/server-next/backend/config.ts apps/server-next/backend/controllers/branches.ts
git commit -m "feat(server-next): generate accessVerification on branch create, return accessUrlPrefix"
```

---

## Task 5: /branch/:branchId/:verification 路由与 auth 注入

**Files:**
- Create: `apps/server-next/backend/middleware/branch-url-auth.ts`（或内联到 app）
- Modify: `apps/server-next/backend/app.ts`

**Step 1: 实现 branch-url 中间件与 auth 对 X-Branch-Auth 的支持**

- 新建 `apps/server-next/backend/middleware/branch-url-auth.ts`：导出 `createBranchUrlAuthMiddleware(deps: { branchStore: BranchStore; app: Hono })`（需传入 app 以便 forward 时调用 `app.fetch`）。若 `c.req.path` 不以 `/branch/` 开头则 `next()`。否则解析 path：`/branch/:branchId/:verification/...`，restPath 为第三段之后的路径并带前导 `/`（如 `/api/realm/me/files`）。校验：`getBranch(branchId)` 存在、`branch.accessVerification?.value === verification`、`Date.now() <= branch.accessVerification.expiresAt`。失败则 `return c.json({ error: "UNAUTHORIZED", message: "Invalid or expired branch access" }, 401)`。通过则构造 `newReq = new Request(new URL(restPath, c.req.url), { method: c.req.method, headers: new Headers(c.req.raw.headers), body: c.req.raw.body })`，并 `newReq.headers.set("X-Branch-Auth", base64urlEncode(branchId))`（base64url(branchId) 与现有 accessToken 一致），然后 `return deps.app.fetch(newReq)`。
- 在 `app.ts` 中：CORS 之后、现有 auth `app.use("*", ...)` 之前，挂载 `app.use("*", createBranchUrlAuthMiddleware({ branchStore: deps.branchStore, app }))`（注意 createApp 内 app 已存在，可传 app）。
- 在现有 auth middleware 中：当 `getTokenFromRequest` 得到 token 为空时，检查 `c.req.header("X-Branch-Auth")`；若存在则用现有 `decodeBranchToken` 解码 branchId，`getBranch(branchId)`，若 branch 且 `branch.accessVerification` 且 `Date.now() <= branch.accessVerification.expiresAt`，则 set worker auth 并 `return next()`；否则不 set，继续后续逻辑。
</think>
采用“内部 forward + 请求头”实现 path 重写。正在补全 Task 5 及后续任务。
<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
StrReplace