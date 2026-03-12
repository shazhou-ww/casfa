# Global `.well-known` for Path Issuer Design

## Goal

Move OAuth/OIDC discovery from per-cell root routing to a single domain-level `.well-known` entry, while keeping each MCP provider as an independent issuer.

## Final Decisions

- Issuer model: **per-cell path issuer** (e.g. `https://{host}/agent`, `https://{host}/drive`)
- RFC 8414 discovery URL: `https://{host}/.well-known/oauth-authorization-server/{issuer-path}`
- Root discovery without suffix (`/.well-known/oauth-authorization-server`) returns **404**
- Ownership: `.well-known/*` is provided by **platform gateway**, not by individual business cells
- OAuth participation is **explicitly declared in `cell.yaml`**; not all cells are OAuth/MCP cells
- v1 OAuth config is minimal:
  - `oauth.enabled: true|false`
  - `oauth.role: resource_server | authorization_server | both`
  - `oauth.scopes: string[]` (non-empty when enabled)
- v1 does **not** support `oauth.discovery.enabled` or `oauth.issuerPath`; discovery is auto-enabled for OAuth cells and issuer path is always `/{mount}`
- Deployment shape:
  - Local dev: `otavia dev` gateway handles `.well-known/*`
  - Production: primary root gateway handles `.well-known/*` (edge function only if no root backend exists)

## Why Gateway Owns It

`.well-known` is domain-global by RFC semantics. Putting it in individual cells causes path ambiguity, default-mount leakage, and inconsistent behavior between environments. A single gateway owner guarantees:

- one authoritative route surface
- consistent 404/error policy
- centralized caching/security headers
- stable behavior across dev and prod

## Architecture

## 1) Cell Responsibilities

Each cell exposes issuer metadata capability (not root routes), including:

- whether OAuth is enabled (`oauth.enabled`)
- OAuth role (`oauth.role`)
- protocol scopes (`oauth.scopes`) as machine-readable contract
- metadata fields needed for discovery response
- endpoint templates for authorization/token/registration as applicable

Cells should not be treated as owners of `/.well-known/*`.

### v1 `cell.yaml` shape

```yaml
oauth:
  enabled: true
  role: resource_server # resource_server | authorization_server | both
  scopes:
    - use_mcp
    - manage_threads
```

Notes:
- scope explanations are not stored in `cell.yaml` in v1
- user-facing explanations are rendered in authorization UI by scope key mapping

## 2) Gateway Responsibilities

Gateway provides:

- `GET /.well-known/oauth-authorization-server/*` (path-suffix aware)
- optional `GET /.well-known/openid-configuration/*` if needed
- strict `404` for root `/.well-known/oauth-authorization-server` without suffix

Gateway resolves suffix path to a registered issuer and returns canonical metadata.

## 3) Discovery Resolution

Given issuer `https://{host}/{mount}`, compute:

- origin = `https://{host}`
- issuerPath = `/{mount}`
- metadata URL = `${origin}/.well-known/oauth-authorization-server${issuerPath}`

Do not use `/{mount}/.well-known/...`.
Only cells with `oauth.enabled=true` are registered into discovery resolver.

## 4) Dev/Prod Consistency

Use one shared resolver contract so both local and production gateways produce identical metadata behavior and errors.

## Migration Strategy

1. Add global well-known resolver and root routes in dev gateway.
2. Add `oauth` capability schema in `cell.yaml` and update relevant cells.
3. Update client discovery logic to RFC 8414 path-suffix construction.
4. Ensure mount-aware rewrite/proxy never hijacks `/.well-known/*`.
5. Apply same gateway behavior to production root ingress.
6. Keep root no-suffix endpoint returning 404.

## Risks and Guardrails

- Risk: old clients still calling `/{mount}/.well-known/...`
  - Mitigation: explicit migration note and temporary diagnostics in logs
- Risk: wrong issuer-path mapping
  - Mitigation: explicit registry keyed by mount/path with startup validation
- Risk: dev/prod divergence
  - Mitigation: shared resolver utility + mirrored tests

## Acceptance Criteria

- `/.well-known/oauth-authorization-server/{mount}` returns correct per-mount metadata
- `/.well-known/oauth-authorization-server` returns 404
- No request to `/.well-known/*` is rewritten to default mount
- MCP OAuth discovery succeeds for at least `agent` and `drive` path issuers
