# Cells Folder Reorganization Design

**Date:** 2026-03-13  
**Status:** Approved (Option A)

## Goal

Reorganize all Cell packages from `apps/` into `cells/`, and rename:

- `server-next` -> `drive`
- `image-workshop` -> `artist`

The rename must include cell identity and runtime wiring (cell name, package name, stack references, mount references), with no backward-compatibility aliases.

## Scope

### In scope

- Move all current Cell packages:
  - `apps/sso` -> `cells/sso`
  - `apps/agent` -> `cells/agent`
  - `apps/server-next` -> `cells/drive`
  - `apps/image-workshop` -> `cells/artist`
- Rename package names:
  - `@casfa/server-next` -> `@casfa/drive`
  - `@casfa/image-workshop` -> `@casfa/artist`
- Rename cell names in `cell.yaml`:
  - `casfa-next` -> `drive`
  - `image-workshop` -> `artist`
- Update stack and mount wiring:
  - `stack.yaml` entries
  - `apps/main/otavia.yaml` package references and mount values
- Update runtime/build references in source/config/tests that resolve cell dirs/packages.

### Out of scope

- Historical plan/docs mass renaming under `docs/` (keep history as-is).
- Compatibility aliases for old package names or old mounts.
- Behavior changes unrelated to naming/path migration.

## Design Decisions

1. **Single-step cutover:** perform migration and rename in one changeset.
2. **No compatibility layer:** old names/paths stop being first-class immediately.
3. **Keep non-cell app layout unchanged:** only Cell packages move to `cells/`.
4. **Prioritize runtime correctness:** update code/config/tests that drive loading, deploy, and local dev.

## Affected Areas

- Workspace discovery (`package.json` workspaces)
- Cell stack config (`stack.yaml`)
- Main deploy config (`apps/main/otavia.yaml`, `apps/main/package.json`)
- Cell package manifests and cell configs (`cells/*/package.json`, `cells/*/cell.yaml`)
- Otavia config/path resolution logic and related tests
- Cell CLI schema/help strings that mention example paths
- Environment example comments containing old folder labels

## Risk & Mitigation

- **Risk:** missed string references can break local dev or deploy.
  - **Mitigation:** broad search for old names/paths in non-doc files after edits.
- **Risk:** lockfile drift after workspace/package rename.
  - **Mitigation:** run `bun install --no-cache` to regenerate lock consistency.
- **Risk:** schema/tests expect old package names.
  - **Mitigation:** update affected tests and run focused verification.

## Validation Plan

- Static checks:
  - verify no runtime references remain to old paths/packages in non-doc files
- Runtime/tooling checks:
  - run targeted unit tests around otavia config/loading and dev routing
  - run root lint/typecheck/test subset as needed for touched surfaces

## Acceptance Criteria

- All four Cells are under `cells/`.
- `drive` and `artist` names are fully wired in package + cell + stack + mount.
- Root workspace resolves all moved/renamed packages.
- Touched tests pass and no new lints are introduced in edited files.
