# Global `.well-known` Path-Issuer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement domain-level `.well-known` discovery for per-cell path issuers, with gateway ownership and strict RFC 8414 path-suffix behavior.

**Architecture:** Add a global discovery resolver in the gateway layer, keep per-cell issuer definitions as data providers, and prevent mount-aware rewriting from hijacking `/.well-known/*`. Apply the same behavior contract in local dev and production ingress.

**Tech Stack:** Bun, TypeScript, Hono, otavia dev gateway/runtime, agent frontend OAuth discovery.

---

### Task 1: Add explicit OAuth capability schema in `cell.yaml`

**Files:**
- Modify: `apps/otavia/src/config/cell-yaml-schema.ts`
- Modify: `apps/otavia/src/config/load-cell-yaml.ts`
- Modify: `apps/otavia/src/config/__tests__/*` (schema/parser tests)
- Modify: `apps/agent/cell.yaml`
- Modify: `apps/sso/cell.yaml`
- Modify: `apps/server-next/cell.yaml`
- Modify: `apps/image-workshop/cell.yaml`

**Step 1: Write the failing test**

Add schema/parse tests for:
- accepts:
  - `oauth.enabled`
  - `oauth.role` in `resource_server | authorization_server | both`
  - non-empty `oauth.scopes: string[]` when enabled
- rejects:
  - `oauth.enabled=true` with empty/missing scopes
  - unknown role values
  - unsupported fields (`issuerPath`, `discovery.enabled`) in v1

**Step 2: Run test to verify it fails**

Run: `bun test apps/otavia/src/config`  
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement `CellConfig.oauth` with minimal v1 shape:
- `enabled: boolean`
- `role: "resource_server" | "authorization_server" | "both"`
- `scopes: string[]`

Update cell yaml files:
- OAuth cells provide the new `oauth` section
- non-OAuth cells omit it (or set `enabled: false`, choose one style and standardize)

**Step 4: Run test to verify it passes**

Run: `bun test apps/otavia/src/config`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/otavia/src/config/cell-yaml-schema.ts apps/otavia/src/config/load-cell-yaml.ts apps/otavia/src/config/__tests__ apps/agent/cell.yaml apps/sso/cell.yaml apps/server-next/cell.yaml apps/image-workshop/cell.yaml
git commit -m "feat(otavia-config): add explicit oauth capability in cell yaml" -m "Require role and non-empty scopes for oauth-enabled cells."
```

### Task 2: Add RFC 8414 URL builder for path issuers

**Files:**
- Create: `apps/agent/frontend/lib/oauth-discovery-url.ts`
- Test: `apps/agent/frontend/lib/oauth-discovery-url.test.ts`
- Modify: `apps/agent/frontend/lib/mcp-oauth-flow.ts`

**Step 1: Write the failing test**

Add tests for:
- issuer `https://casfa.shazhou.me/agent` -> `https://casfa.shazhou.me/.well-known/oauth-authorization-server/agent`
- issuer with trailing slash still normalizes
- root issuer `https://casfa.shazhou.me/` -> `https://casfa.shazhou.me/.well-known/oauth-authorization-server`

**Step 2: Run test to verify it fails**

Run: `bun test apps/agent/frontend/lib/oauth-discovery-url.test.ts`  
Expected: FAIL (new file/function not found).

**Step 3: Write minimal implementation**

Implement:
- `buildOAuthAuthorizationServerMetadataUrl(issuerUrl: string): string`
- path-suffix construction per RFC 8414
- safe normalization (origin + pathname without duplicate slash)

Update `fetchAuthorizationServerMetadata()` in `mcp-oauth-flow.ts` to try:
- RFC URL first (new builder)
- optional fallback for compatibility

**Step 4: Run test to verify it passes**

Run: `bun test apps/agent/frontend/lib/oauth-discovery-url.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/agent/frontend/lib/oauth-discovery-url.ts apps/agent/frontend/lib/oauth-discovery-url.test.ts apps/agent/frontend/lib/mcp-oauth-flow.ts
git commit -m "feat(agent): build RFC8414 metadata URL for path issuers" -m "Use origin-level .well-known with issuer path suffix for discovery."
```

### Task 3: Add global well-known resolver in otavia dev gateway

**Files:**
- Create: `apps/otavia/src/commands/dev/well-known.ts`
- Create: `apps/otavia/src/commands/dev/__tests__/well-known.test.ts`
- Modify: `apps/otavia/src/commands/dev/gateway.ts`

**Step 1: Write the failing test**

Test resolver behavior:
- resolves mount suffix `/agent` to agent metadata
- returns not-found for unknown suffix
- root no-suffix request is explicitly rejected (404 policy)

**Step 2: Run test to verify it fails**

Run: `bun test apps/otavia/src/commands/dev/__tests__/well-known.test.ts`  
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement `well-known.ts`:
- build a registry from discovered cells (`mount -> issuer metadata provider`) filtered by `cell.config.oauth.enabled === true`
- function to resolve request path suffix to a cell issuer
- function to produce standardized metadata response payload

Wire in `gateway.ts` before mount forwarding:
- `GET /.well-known/oauth-authorization-server` -> 404
- `GET /.well-known/oauth-authorization-server/*` -> resolver output

**Step 4: Run test to verify it passes**

Run: `bun test apps/otavia/src/commands/dev/__tests__/well-known.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/otavia/src/commands/dev/well-known.ts apps/otavia/src/commands/dev/__tests__/well-known.test.ts apps/otavia/src/commands/dev/gateway.ts
git commit -m "feat(otavia-dev): serve global .well-known for path issuers" -m "Move OAuth metadata discovery to gateway-owned root routes."
```

### Task 4: Protect `.well-known` from mount-aware rewrite/proxy drift

**Files:**
- Modify: `apps/otavia/src/commands/dev/main-frontend-runtime/vite-config.ts`
- Modify: `apps/otavia/src/commands/dev/vite-dev.ts`
- Modify: `apps/otavia/src/commands/dev/__tests__/vite-dev-proxy-rules.test.ts`

**Step 1: Write the failing test**

Add tests asserting:
- `/.well-known/*` remains global and is not rewritten to `/{mount}/.well-known/*`
- generated proxy rules include deterministic handling for global well-known route

**Step 2: Run test to verify it fails**

Run: `bun test apps/otavia/src/commands/dev/__tests__/vite-dev-proxy-rules.test.ts`  
Expected: FAIL on new expectations.

**Step 3: Write minimal implementation**

In `vite-config.ts` plugin:
- short-circuit `/.well-known/*` before mount inference and referer-based rewriting

In `vite-dev.ts` config generation:
- add explicit global route/proxy rule for `.well-known` ahead of mount-prefixed rules

**Step 4: Run test to verify it passes**

Run: `bun test apps/otavia/src/commands/dev/__tests__/vite-dev-proxy-rules.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/otavia/src/commands/dev/main-frontend-runtime/vite-config.ts apps/otavia/src/commands/dev/vite-dev.ts apps/otavia/src/commands/dev/__tests__/vite-dev-proxy-rules.test.ts
git commit -m "fix(otavia-dev): keep .well-known routes global in dev rewrite" -m "Prevent mount-aware proxy from hijacking root discovery endpoints."
```

### Task 5: Verification and docs alignment

**Files:**
- Modify: `docs/casfa-api/02-auth.md`
- Modify: `docs/casfa-api/README.md`
- Modify: `docs/plans/2026-03-12-global-well-known-design.md`

**Step 1: Write the failing check**

Define verification matrix:
- `GET /.well-known/oauth-authorization-server` -> 404
- `GET /.well-known/oauth-authorization-server/agent` -> 200 + issuer `.../agent`
- `GET /.well-known/oauth-authorization-server/drive` -> 200 + issuer `.../drive`
- non-oauth cell path -> 404 (not registered in discovery)

**Step 2: Run verification commands**

Run:
- `bun test apps/otavia/src/config`
- `bun test apps/otavia/src/commands/dev/__tests__/well-known.test.ts`
- `bun test apps/otavia/src/commands/dev/__tests__/vite-dev-proxy-rules.test.ts`
- `bun test apps/agent/frontend/lib/oauth-discovery-url.test.ts`

Expected: all PASS.

**Step 3: Update docs**

Document:
- path-suffix discovery requirement
- root no-suffix 404 policy
- gateway ownership model for `.well-known/*`
- minimal `cell.yaml` oauth schema (`enabled/role/scopes`) and v1 non-goals (`issuerPath`, `discovery.enabled`, scope descriptions)

**Step 4: Final commit**

```bash
git add docs/casfa-api/02-auth.md docs/casfa-api/README.md docs/plans/2026-03-12-global-well-known-design.md
git commit -m "docs(auth): document global .well-known path-issuer discovery" -m "Clarify RFC8414 path suffix and root 404 behavior."
```

## Notes

- Keep old discovery URL format only as short-lived fallback if needed.
- Do not claim task complete until all three verification test commands pass.
- If production ingress is not yet centralized, create a thin root-level handler with the same resolver contract before enabling this rollout.
