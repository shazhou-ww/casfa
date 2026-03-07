# MCP Prompt Bundle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace runtime `readFileSync` with build-time esbuild text loader, and migrate MCP resource to MCP prompt with Mustache template support.

**Architecture:** esbuild `text` loader inlines `.md` files as strings at build time. Mustache renders prompt templates with client-supplied arguments. MCP `registerPrompt` replaces `registerResource`.

**Tech Stack:** esbuild (text loader), mustache, @modelcontextprotocol/sdk (registerPrompt), zod

---

### Task 1: Add `.md` text loader to cell-cli esbuild config

**Files:**
- Modify: `apps/cell-cli/src/commands/build.ts:24-33`

**Step 1: Add loader config**

In `build.ts`, add `loader` to the esbuild `build()` call:

```typescript
await build({
  entryPoints: [handlerPath],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile,
  sourcemap: true,
  external: ["@aws-sdk/*"],
  loader: { ".md": "text" },
});
```

**Step 2: Verify build still works**

Run: `cd apps/image-workshop && bun run build`
Expected: Build succeeds (no behavior change yet, `.md` files aren't imported yet).

**Step 3: Commit**

```bash
git add apps/cell-cli/src/commands/build.ts
git commit -m "feat(cell-cli): add esbuild text loader for .md files"
```

---

### Task 2: Add TypeScript declaration for `.md` imports

**Files:**
- Create: `apps/image-workshop/backend/md.d.ts`

The file `backend/**/*.ts` include pattern in `apps/image-workshop/tsconfig.json` already matches `*.d.ts` files.

**Step 1: Create the declaration file**

```typescript
declare module "*.md" {
  const content: string;
  export default content;
}
```

**Step 2: Verify typecheck**

Run: `cd apps/image-workshop && bun run typecheck`
Expected: PASS (no `.md` imports yet, declaration is just ambient).

**Step 3: Commit**

```bash
git add apps/image-workshop/backend/md.d.ts
git commit -m "feat(image-workshop): add TypeScript declaration for .md imports"
```

---

### Task 3: Add mustache dependency

**Files:**
- Modify: `apps/image-workshop/package.json`

**Step 1: Install mustache**

```bash
cd apps/image-workshop
bun add --no-cache mustache @types/mustache
```

**Step 2: Verify install**

Run: `cd apps/image-workshop && bun run typecheck`
Expected: PASS.

**Step 3: Commit**

```bash
git add apps/image-workshop/package.json ../../bun.lock
git commit -m "feat(image-workshop): add mustache template dependency"
```

---

### Task 4: Rename skills → prompts and update template

**Files:**
- Rename: `backend/skills/flux-image-gen.md` → `backend/prompts/flux-image-gen.md`
- Modify: `backend/prompts/flux-image-gen.md` (add Mustache placeholders)

**Step 1: Rename directory**

```bash
cd apps/image-workshop
mkdir -p backend/prompts
mv backend/skills/flux-image-gen.md backend/prompts/flux-image-gen.md
rmdir backend/skills
```

**Step 2: Update template with Mustache placeholders**

Keep the current content as-is for now — the prompt arguments are defined in the `registerPrompt` call's `argsSchema`, and the template will receive those args. Update the markdown to include relevant `{{param}}` placeholders where appropriate. The template content depends on what arguments the prompt should accept — design those in the next task.

**Step 3: Commit**

```bash
git add backend/prompts/ backend/skills/
git commit -m "refactor(image-workshop): rename skills/ to prompts/"
```

---

### Task 5: Migrate index.ts — import + resource + prompt with Mustache

**Files:**
- Modify: `apps/image-workshop/backend/index.ts:1-18` (imports)
- Modify: `apps/image-workshop/backend/index.ts:104-121` (resource data source + add prompt)

**Step 1: Update imports**

Remove:
```typescript
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
```

Remove:
```typescript
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const skillContent = readFileSync(
  resolve(__dirname, "skills", "flux-image-gen.md"),
  "utf-8"
);
```

Add:
```typescript
import Mustache from "mustache";
import fluxImageGenPrompt from "./prompts/flux-image-gen.md";
```

**Step 2: Update registerResource data source**

Keep `server.registerResource(...)` but change URI from `skill://` to `prompt://` and switch data source from `skillContent` to `fluxImageGenPrompt`:

```typescript
server.registerResource(
  "FLUX Image Generation",
  "prompt://flux-image-gen",
  {
    description: "Prompt template for FLUX image generation",
    mimeType: "text/markdown",
    annotations: { audience: ["assistant"], priority: 1 },
  },
  async () => ({
    contents: [{
      uri: "prompt://flux-image-gen",
      mimeType: "text/markdown",
      text: fluxImageGenPrompt,
    }],
  })
);
```

**Step 3: Add registerPrompt**

Add prompt registration after the resource:

```typescript
server.registerPrompt("flux-image-gen", {
  description: "Generate images from text prompts using BFL FLUX",
  argsSchema: {
    // Define prompt arguments here based on what the template needs
  },
}, async (args) => ({
  messages: [{
    role: "user",
    content: { type: "text", text: Mustache.render(fluxImageGenPrompt, args) },
  }],
}));
```

The exact `argsSchema` and template content should be designed together — they must match.

**Step 4: Verify typecheck**

Run: `cd apps/image-workshop && bun run typecheck`
Expected: PASS.

**Step 5: Verify build**

Run: `cd apps/image-workshop && bun run build`
Expected: Build succeeds with `.md` inlined.

**Step 6: Commit**

```bash
git add apps/image-workshop/backend/index.ts
git commit -m "feat(image-workshop): add MCP prompt with Mustache, keep resource for download"
```

---

### Task 6: Smoke test

**Step 1: Run dev server**

Run: `cd apps/image-workshop && bun run dev`
Expected: Server starts without errors.

**Step 2: Test MCP prompt listing**

Send a `prompts/list` JSON-RPC call to the MCP endpoint and verify `flux-image-gen` appears.

**Step 3: Test prompt execution**

Send a `prompts/get` JSON-RPC call with args, verify rendered template is returned.

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(image-workshop): address smoke test issues"
```
