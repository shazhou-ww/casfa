# CASFA — Project routines (build, test, lint, deploy, publish)

This repo is a **Bun monorepo** with workspaces `packages/*`, `apps/*`, and `cells/*`. Run scripts from the **repo root** for whole-repo operations, or from a **package/app/cell directory** for that workspace only.

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
- Root vs single package: run from root for full monorepo; run from `packages/<name>`, `apps/<name>`, or `cells/<name>` for that workspace only.

---

## Build

- **From root:** `bun run build` — runs `build:packages` (builds all packages in dependency order).
- **Single package:** `cd packages/<name>` then `bun run build` (uses `scripts/build-pkg.ts`).

---

## Test

- **From root:** `bun run test` runs unit tests across packages and cells.
- **Single package/cell:** `bun run test` or `bun run test:unit` as applicable.
- Always use `bun run test` or `bun run test:unit`; do **not** run `bun test` directly.

---

## Lint & typecheck

- **From root:** `bun run lint` (Biome check), `bun run lint:fix` (Biome fix), `bun run typecheck` (multiple packages), `bun run check` (typecheck + lint).
- **Single package:** same script names from that directory (`bun run lint`, `bun run typecheck`, `bun run check`).

---

## Dev

- **From root:** `bun run dev` starts the Otavia dev server with all cells.
- **With tunnel:** `bun run otavia dev --tunnel` enables Cloudflare Tunnel for remote access.
- Requires Docker Desktop (DynamoDB Local + MinIO) and AWS SSO login.

---

## Deploy

- **CI:** Production/staging deploy via GitHub Actions — push to `main` or run `workflow_dispatch` on `.github/workflows/deploy.yml`.
- **Local:** From `apps/main`, use `bun run deploy` or `bun run deploy:frontend`.

---

## Publish packages

- Use **Changesets.** `bun run changeset` to add a changeset, `bun run version` to bump versions and update CHANGELOGs, `bun run release` to build packages then `changeset publish`.
- Some packages are **linked** in `.changeset/config.json` (e.g. `@casfa/storage-*`); follow Changesets docs for linked packages.
