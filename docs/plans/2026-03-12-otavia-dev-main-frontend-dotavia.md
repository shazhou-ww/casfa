# Otavia Dev Main Frontend in `.otavia/dev`

## Background

`apps/main/frontend` previously mixed two concerns:

- stack-owned source files
- otavia dev generated files (`src/generated/*`) and runtime behavior

This made ownership unclear and coupled dev bootstrapping to repository paths.

## Decision

`otavia dev` now generates and runs the main frontend shell directly from:

- `apps/main/.otavia/dev/main-frontend`

This directory is fully ephemeral and regenerated on each dev start.

## What Is Generated

`startViteDev` writes:

- `index.html`
- `src/main.ts`
- `vite.config.ts`
- `src/generated/mount-loaders.ts`
- `src/generated/main-dev-config.json`

and starts Vite with:

- `cwd = apps/main/.otavia/dev/main-frontend`
- `--config apps/main/.otavia/dev/main-frontend/vite.config.ts`

## Path Resolution Rule

For module proxy entries in generated config:

- `sourcePath` is emitted relative to `apps/main`
- runtime Vite config resolves relative paths back to absolute `/@fs/...` paths
- absolute and Windows drive paths are still supported

## Scope Boundary

In dev mode, `apps/main/frontend` is no longer part of the startup runtime chain.
It can remain temporarily for compatibility/history, but otavia does not depend on it.

## Follow-up

- Remove or archive legacy `apps/main/frontend` files after transition window
- Keep all dev shell evolution in otavia templates (single source of truth)
