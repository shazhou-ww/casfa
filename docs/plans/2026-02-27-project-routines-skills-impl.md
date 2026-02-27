# Project Routines Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a single source of truth (`.github/copilot-instructions.md`) for build/test/lint/deploy/publish and a Cursor project skill that reads it, so both Cursor and GitHub Copilot use the same routines.

**Architecture:** One markdown file in `.github/` for Copilot and humans; one Cursor skill under `.cursor/skills/project-routines/` that triggers on routine keywords and instructs the agent to read that file. No duplication of the routine content in the skill.

**Tech Stack:** Markdown, Cursor SKILL.md frontmatter, GitHub Copilot instructions format.

**Design doc:** `docs/plans/2026-02-27-project-routines-skills-design.md`

---

### Task 1: Create `.github/copilot-instructions.md`

**Files:**
- Create: `.github/copilot-instructions.md`

**Step 1: Add file with intro and environment section**

Create `.github/copilot-instructions.md` with:

- Short intro: This repo is a Bun monorepo (`packages/*`, `apps/*`). Run scripts from repo root for whole-repo operations, or from a package/app directory for that workspace only.
- Section **Environment & tools**: Use Bun. Commands: `bun run <script>`, `bun install` (use `--no-cache` if cache causes issues). Run from root vs from a package as above.

**Step 2: Add Build section**

- **Build:** From root: `bun run build` (runs `build:packages` — builds all packages in dependency order, then `apps/cli`). In a single package: `cd packages/<name>` then `bun run build` (uses `scripts/build-pkg.ts`). For the server app: in `apps/server`, `bun run build` runs frontend + backend; `bun run build:frontend`, `bun run build:backend` for each part.

**Step 3: Add Test section**

- **Test:** From root: `bun run test` runs `test:unit` then `test:e2e`. In a package/app: `bun run test` or `bun run test:unit` / `bun run test:e2e` as applicable. Always use `bun run test` or `bun run test:unit` / `bun run test:e2e`; do not run `bun test` directly. E2E lives in `packages/storage-http`, `apps/cli`, `apps/server`.

**Step 4: Add Lint / Typecheck section**

- **Lint & typecheck:** From root: `bun run lint` (Biome check), `bun run lint:fix` (Biome fix), `bun run typecheck` (multiple packages), `bun run check` (typecheck + lint). In a package: same script names from that directory.

**Step 5: Add Deploy section**

- **Deploy:** Production/staging deploy is via GitHub Actions: push to `main` or run workflow_dispatch on `.github/workflows/deploy.yml` (deploys server: SAM, S3, CloudFront). Locally: from `apps/server`, scripts like `bun run deploy:frontend`, `bun run deploy:staging`, `bun run deploy:all` (see repo README or script comments for when to use which).

**Step 6: Add Publish section**

- **Publish packages:** Use Changesets. `bun run changeset` to add a changeset, `bun run version` to bump versions and update CHANGELOGs, `bun run release` to build packages then `changeset publish`. Some packages are linked in `.changeset/config.json` (e.g. storage-*); follow Changesets docs for linked packages.

**Step 7: Commit**

```bash
git add .github/copilot-instructions.md
git commit -m "chore: add copilot-instructions for build/test/lint/deploy/publish"
```

---

### Task 2: Create Cursor project skill `.cursor/skills/project-routines/SKILL.md`

**Files:**
- Create: `.cursor/skills/project-routines/SKILL.md`

**Step 1: Create skill directory and SKILL.md**

Create `.cursor/skills/project-routines/` and add `SKILL.md` with:

- **Frontmatter:** `name: project-routines`. `description:` One sentence that this skill is used when the user runs or asks about build, test, lint, deploy, or publish in this repo; the agent should read `.github/copilot-instructions.md` and follow it. Include trigger terms: build, test, lint, deploy, publish, unit test, e2e, changeset, release, deploy.

- **Body:** When the user wants to run or ask about build, test, lint, deploy, or publish, first read the repo root file `.github/copilot-instructions.md`. Then follow that file (suggest commands or steps). If the file distinguishes root vs single-package, use the user’s current context (root vs inside a package/app). For tests, always use `bun run test`, `bun run test:unit`, or `bun run test:e2e`; do not suggest `bun test` directly. Do not copy the full content of copilot-instructions into this skill.

**Step 2: Commit**

```bash
git add .cursor/skills/project-routines/SKILL.md
git commit -m "chore: add project-routines skill that reads copilot-instructions"
```

---

### Verification

- Open `.github/copilot-instructions.md`: all six sections present and consistent with root `package.json` and `apps/server` scripts.
- Open `.cursor/skills/project-routines/SKILL.md`: frontmatter and body match design; no full copy of copilot-instructions.
- In Cursor, ask “how do I run tests?” or “how do I publish packages?” — agent should read `.github/copilot-instructions.md` and answer using it.
