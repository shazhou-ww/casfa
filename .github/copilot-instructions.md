# CASFA — Project routines (build, test, lint, deploy, publish)

This repo is a **Bun monorepo** with workspaces `packages/*` and `apps/*`. Run scripts from the **repo root** for whole-repo operations, or from a **package/app directory** for that workspace only.

---

## Coding conventions (required)

When writing or modifying code, **follow the coding conventions** in **`docs/CODING-CONVENTIONS.md`**:

- **Functional style**: prefer pure functions and create functions that return objects; avoid mutable shared state.
- **Use `type` for ADT and data shapes**; do not use `interface`.
- **No `class`**: use create functions (e.g. `createCasService(ctx)`) to build service objects; for errors use a `type` plus a create function (e.g. `createCasError(code, message?)`), not a class extending `Error`.

Agents must apply these conventions in all new code and when touching existing code in scope.

---

## Environment & tools

- Use **Bun**. Commands: `bun run <script>`, `bun install`. If install cache causes issues, use `bun install --no-cache`.
- Root vs single package: run from root for full monorepo; run from `packages/<name>` or `apps/<name>` for that workspace only.

---

## Build

- **From root:** `bun run build` — runs `build:packages` (builds all packages in dependency order, then `apps/cli`).
- **Single package:** `cd packages/<name>` then `bun run build` (uses `scripts/build-pkg.ts`).
- **Server app** (`apps/server`): `bun run build` runs frontend + backend; `bun run build:frontend`, `bun run build:backend` for each part.

---

## Test

- **From root:** `bun run test` runs `test:unit` then `test:e2e`.
- **Single package/app:** `bun run test` or `bun run test:unit` / `bun run test:e2e` as applicable.
- Always use `bun run test`, `bun run test:unit`, or `bun run test:e2e`; do **not** run `bun test` directly.
- E2E tests live in `packages/storage-http`, `apps/cli`, `apps/server`.

---

## Lint & typecheck

- **From root:** `bun run lint` (Biome check), `bun run lint:fix` (Biome fix), `bun run typecheck` (multiple packages), `bun run check` (typecheck + lint).
- **Single package:** same script names from that directory (`bun run lint`, `bun run typecheck`, `bun run check`).

---

## Deploy

- **CI:** Production/staging deploy is via GitHub Actions — push to `main` or run `workflow_dispatch` on `.github/workflows/deploy.yml` (deploys server: SAM, S3, CloudFront).
- **Local:** From `apps/server`, scripts: `bun run deploy:frontend`, `bun run deploy:staging`, `bun run deploy:all`, `bun run deploy:staging:all`, `bun run deploy:frontend:staging` (see repo README or script comments for when to use which).

---

## Publish packages

- Use **Changesets.** `bun run changeset` to add a changeset, `bun run version` to bump versions and update CHANGELOGs, `bun run release` to build packages then `changeset publish`.
- Some packages are **linked** in `.changeset/config.json` (e.g. `@casfa/storage-*`); follow Changesets docs for linked packages.
