---
name: api-polish
description: Reviews and polishes API design through route inventory, route consistency review, route contract review (input/output/auth), and compatibility rollout planning with TDD-first execution. Use when the user asks to梳理 API 设计, review routes, API consistency cleanup, contract alignment, or API refactor/migration planning.
---

# API Polish Workflow

Use this workflow when reviewing and polishing a fast-evolving API surface.

## Scope

- Default target: one service/module (for example `cells/drive/backend`).
- First pass focuses on route topology only.
- Later passes cover request/response/auth contract per route.

## Output Document Structure

Create or update one working doc with these sections:

1. `#1 current API design (routes only)`
2. `#2 routes review (issues + suggestions + decisions)`
3. `#3 route contract review (input/output/auth)`
4. `#4 compatibility & execution plan`

Keep section order stable. Add decision timestamps only when needed.

## Step 1: Route Inventory Only

Goal: produce a complete route map without discussing payload details.

Checklist:

- Enumerate every mounted route from entry app/router files.
- Include method, path, mount source, and conditional registration.
- Mark external-package mounted routes explicitly.
- Do not include body/header/auth/output details yet.

Suggested table columns:

- Method
- Path
- Registered in
- Route owner (controller/module)
- Condition/notes

## Step 2: Route Design Review

Goal: find route-level design problems and discuss with the user.

Review dimensions:

- Redundancy (duplicate semantics on different paths)
- Naming consistency (resource/action wording)
- REST style consistency (resource vs verb routes)
- Prefix consistency (`/api`, `/api/realm/:realmId`, special mounts)
- Lifecycle naming consistency (`close` vs `complete`)
- Internal/external route discoverability

Rules:

- List issues one by one with impact.
- Provide 1-2 actionable options per issue.
- Do not auto-apply; confirm with user per issue.
- Record agreed decisions into section `#2`.

## Step 3: Contract Review Per Route

Goal: review route IO/auth contract in detail.

For each route group:

- Input: path/query/body/header/cookie source and validation
- Auth: required identity type and permission checks
- Output: status code, body schema, key headers
- Error model: code/message shape consistency

Rules:

- Process route groups incrementally (files, fs, branches, realm, me, oauth, mcp).
- Mark each item as `合理` / `建议修改`.
- Discuss and confirm with user before writing final decision.
- Write confirmed items into section `#3`.

## Step 4: Compatibility & Execution Plan

Goal: define migration strategy before implementation.

Must cover:

- Which APIs will change
- Affected callers (frontend, MCP clients, other cells/services)
- Compatibility method (alias, dual-write/read, versioning, deprecation window)
- Rollout order and verification plan
- Batch plan: each batch must include verify checklist and rollback trigger.

Write agreed strategy to section `#4`.

## Step 5: Execute API Polish

Only after user reviews section `#1` to `#4`.

Execution order (TDD required):

1. Write or adjust failing test cases first (unit and e2e) to capture agreed API behavior.
2. Run tests and confirm expected failures (red).
3. Apply route-level and contract changes (input/output/auth/error) to satisfy tests.
4. Re-run unit and e2e tests until all pass (green).
5. Refactor safely without changing behavior, then re-run tests.
6. Update docs/changelog to reflect final contract.
7. Refresh section `#1 current API design (routes only)` to match final routes.

TDD rules:

- Do not start implementation changes before tests are updated for the target behavior.
- For API behavior changes: unit tests are required; e2e assertions are required when user flow or cross-route contract is affected.
- If e2e setup is flaky, fix test infrastructure first, then continue TDD flow.
- Run tests using project scripts (`bun run test:unit`, `bun run test:e2e`, or `bun run test`) instead of ad-hoc commands.
- Prefer local module changes first; if shared packages must change, keep backward-compatible defaults.

